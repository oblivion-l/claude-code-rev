import { randomUUID } from 'crypto'
import { createInterface } from 'readline/promises'
import { getSessionId } from 'src/bootstrap/state.js'
import { hasPermissionsToUseTool } from 'src/utils/permissions/permissions.js'
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js'
import { errorMessage, isAbortError } from 'src/utils/errors.js'
import type { Props as REPLProps } from 'src/screens/REPL.js'
import type {
  ReplProvider,
  ReplProviderLaunchArgs,
} from 'src/services/repl/provider.js'
import { EMPTY_USAGE } from 'src/services/api/logging.js'
import type { NonNullableUsage } from 'src/entrypoints/sdk/sdkUtilityTypes.js'
import { extractCodexFunctionCalls } from './toolBridge.js'
import {
  buildCodexRequestTools,
  CODEX_MAX_LOCAL_TOOL_CALL_ROUNDS,
  prepareCodexToolOrchestration,
  requireCodexFunctionToolExecutor,
} from './orchestration.js'
import type { CodexToolRuntime } from './toolRuntime.js'
import {
  createCodexResponseStream,
  parseCodexSSE,
} from './client.js'
import { getCodexRuntimeConfig } from './config.js'
import {
  getCodexDiscoveredToolNames,
  withCodexDiscoveredToolNames,
} from './discoveredTools.js'
import { resolveCodexMcpTools } from './mcp.js'
import {
  extractCompletedResponse,
  extractResponseId,
  extractResponseText,
  extractTextDelta,
  extractTextSnapshot,
  extractUsage,
  getCodexFailureMessage,
} from './stream.js'
import type { CodexMcpTool, CodexRuntimeConfig } from './types.js'
import {
  type CodexReplPersistedState,
  getCodexReplState,
  setCodexReplState,
} from './replState.js'

export type CodexReplConversationState = {
  providerId: 'codex-repl'
  version?: number
  stateId?: string
  cwd?: string
  createdAt?: string
  updatedAt?: string
  conversationId?: string
  lastResponseId?: string
  lastAssistantMessageUuid?: string
  metadata?: Record<string, unknown>
  history?: Array<{
    assistantMessageUuid: string
    responseId: string
    createdAt: string
  }>
}

export type CodexReplTurnEvent = {
  type: 'assistant.delta'
  delta: string
}

export type CodexReplTurnResult = {
  responseText: string
  responseId?: string
  usage: NonNullableUsage
  conversationState: CodexReplConversationState
}

function accumulateCodexUsage(
  totalUsage: NonNullableUsage,
  roundUsage: NonNullableUsage,
): NonNullableUsage {
  return {
    ...totalUsage,
    input_tokens: totalUsage.input_tokens + roundUsage.input_tokens,
    output_tokens: totalUsage.output_tokens + roundUsage.output_tokens,
  }
}

function createForwardingAbortController(signal?: AbortSignal): {
  abortController: AbortController
  cleanup: () => void
} {
  const abortController = new AbortController()

  if (!signal) {
    return {
      abortController,
      cleanup: () => {},
    }
  }

  if (signal.aborted) {
    abortController.abort()
    return {
      abortController,
      cleanup: () => {},
    }
  }

  const handleAbort = () => abortController.abort()
  signal.addEventListener('abort', handleAbort, { once: true })

  return {
    abortController,
    cleanup: () => signal.removeEventListener('abort', handleAbort),
  }
}

function createCodexReplToolRuntime({
  replProps,
  appProps,
}: ReplProviderLaunchArgs): CodexToolRuntime {
  let appState = appProps.initialState

  return {
    cwd: replProps.providerContext?.cwd ?? process.cwd(),
    commands: replProps.commands,
    tools: replProps.initialTools,
    mcpClients: replProps.mcpClients ?? [],
    agents: appProps.initialState.agentDefinitions.activeAgents,
    canUseTool: hasPermissionsToUseTool,
    getAppState: () => appState,
    setAppState: updater => {
      appState = updater(appState)
    },
  }
}

function buildInstructions({
  systemPrompt,
  appendSystemPrompt,
}: {
  systemPrompt?: string
  appendSystemPrompt?: string
}): string | undefined {
  const parts = [systemPrompt, appendSystemPrompt].filter(
    (value): value is string => Boolean(value?.trim()),
  )

  if (parts.length === 0) {
    return undefined
  }

  return parts.join('\n\n')
}

function writeLine(message = ''): void {
  process.stdout.write(message + '\n')
}

function writeError(message: string): void {
  process.stderr.write(`Error: ${message}\n`)
}

function formatCodexReplError(error: unknown): string {
  return isAbortError(error) ? 'Request interrupted by user.' : errorMessage(error)
}

function isClosedInputError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()

  return (
    isAbortError(error) ||
    message.includes('closed') ||
    message.includes('cancelled') ||
    message.includes('canceled')
  )
}

function isExitCommand(input: string): boolean {
  const normalized = input.trim().toLowerCase()
  return normalized === '/exit' || normalized === '/quit'
}

function isSlashCommand(input: string): boolean {
  return input.trimStart().startsWith('/')
}

function resolveCodexReplStateId(
  state: CodexReplPersistedState | null,
  forkSession: boolean,
): string {
  if (!forkSession && state?.stateId) {
    return state.stateId
  }

  return getSessionId()
}

function resolveInitialConversationState({
  replProps,
}: {
  replProps: REPLProps
}): CodexReplPersistedState | null {
  const providerContext = replProps.providerContext
  const cwd = providerContext?.cwd

  if (providerContext?.resume === true) {
    throw new Error(
      'Codex REPL does not support the interactive resume picker. Pass an explicit persisted resume id to --resume.',
    )
  }

  let state: CodexReplPersistedState | null = null

  if (typeof providerContext?.resume === 'string') {
    state = getCodexReplState({
      stateId: providerContext.resume,
    })
  } else if (providerContext?.continue) {
    if (!cwd) {
      throw new Error(
        'Codex REPL continue requested but no current working directory is available.',
      )
    }

    state = getCodexReplState({
      cwd,
    })
    if (!state?.lastResponseId) {
      throw new Error(
        'Codex REPL continue requested but no conversation state is available for the current directory.',
      )
    }
  }

  if (providerContext?.resumeSessionAt) {
    if (!state?.lastResponseId) {
      throw new Error(
        'Codex REPL resume requested but no persisted conversation state is available.',
      )
    }

    const matchedTurnIndex =
      state.history?.findIndex(
        turn => turn.assistantMessageUuid === providerContext.resumeSessionAt,
      ) ?? -1

    if (matchedTurnIndex < 0) {
      throw new Error(
        `Codex REPL could not find persisted assistant turn ${providerContext.resumeSessionAt} for --resume-session-at.`,
      )
    }

    const truncatedHistory = state.history?.slice(0, matchedTurnIndex + 1) ?? []
    const matchedTurn = truncatedHistory[matchedTurnIndex]

    state = {
      ...state,
      lastResponseId: matchedTurn.responseId,
      lastAssistantMessageUuid: matchedTurn.assistantMessageUuid,
      history: truncatedHistory,
    }
  }

  const stateId = resolveCodexReplStateId(
    state,
    Boolean(providerContext?.forkSession),
  )

  return {
    providerId: 'codex-repl',
    stateId,
    cwd,
    conversationId: state?.conversationId ?? stateId,
    createdAt: state?.createdAt,
    updatedAt: state?.updatedAt,
    lastResponseId: state?.lastResponseId,
    lastAssistantMessageUuid: state?.lastAssistantMessageUuid,
    history: state?.history ?? [],
    metadata: state?.metadata,
  }
}

function getUnsupportedCodexReplMessage(replProps: REPLProps): string | null {
  if (
    (replProps.initialMessages?.length ?? 0) > 0 &&
    !replProps.providerContext?.continue &&
    !replProps.providerContext?.resume
  ) {
    return 'Codex REPL does not yet support interactive --continue, --resume, or restored sessions.'
  }

  if (
    replProps.pendingHookMessages ||
    (replProps.initialFileHistorySnapshots?.length ?? 0) > 0 ||
    (replProps.initialContentReplacements?.length ?? 0) > 0
  ) {
    return 'Codex REPL does not yet support restored interactive session state.'
  }

  if (
    replProps.remoteSessionConfig ||
    replProps.directConnectConfig ||
    replProps.sshSession
  ) {
    return 'Codex REPL currently only supports local interactive sessions.'
  }

  return null
}

export class CodexReplSession {
  private readonly instructions?: string
  private readonly config: CodexRuntimeConfig
  private conversationState: CodexReplConversationState
  private readonly discoveredToolNames: Set<string>

  constructor(
    private readonly options: {
      userSpecifiedModel?: string
      systemPrompt?: string
      appendSystemPrompt?: string
      cwd?: string
      mcpTools?: CodexMcpTool[]
      runtime?: CodexToolRuntime
      conversationState?: CodexReplConversationState | null
    } = {},
  ) {
    this.config = getCodexRuntimeConfig(this.options.userSpecifiedModel)
    this.instructions = buildInstructions(this.options)
    this.conversationState = {
      providerId: 'codex-repl',
      version: this.options.conversationState?.version,
      stateId:
        this.options.conversationState?.stateId ?? getSessionId(),
      cwd: this.options.cwd ?? this.options.conversationState?.cwd,
      createdAt: this.options.conversationState?.createdAt,
      updatedAt: this.options.conversationState?.updatedAt,
      conversationId:
        this.options.conversationState?.conversationId ??
        this.options.conversationState?.stateId ??
        getSessionId(),
      lastResponseId: this.options.conversationState?.lastResponseId,
      lastAssistantMessageUuid:
        this.options.conversationState?.lastAssistantMessageUuid,
      metadata: this.options.conversationState?.metadata,
      history: this.options.conversationState?.history ?? [],
    }
    this.discoveredToolNames = getCodexDiscoveredToolNames(
      this.options.conversationState,
    )
  }

  get model(): string {
    return this.config.model
  }

  get state(): CodexReplConversationState {
    return { ...this.conversationState }
  }

  async *submitTurn(
    prompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<CodexReplTurnEvent, CodexReplTurnResult, unknown> {
    if (!prompt.trim()) {
      throw new Error('Prompt must not be empty.')
    }

    const { abortController, cleanup } = createForwardingAbortController(signal)
    const orchestration = await prepareCodexToolOrchestration({
      mode: 'repl',
      runtime: this.options.runtime,
      mcpTools: this.options.mcpTools,
      model: this.config.model,
      abortController,
      discoveredToolNames: this.discoveredToolNames,
    })
    const { requestPlan, functionToolExecutor } = orchestration

    let accumulatedText = ''
    let responseId: string | undefined
    let usage: NonNullableUsage = EMPTY_USAGE
    let currentInput: string | Array<{
      type: 'function_call_output'
      call_id: string
      output: string
    }> = prompt
    let previousResponseId = this.conversationState.lastResponseId
    let completedFinalRound = false

    try {
      for (
        let round = 0;
        round < CODEX_MAX_LOCAL_TOOL_CALL_ROUNDS;
        round += 1
      ) {
        const requestTools =
          round === 0
            ? orchestration.requestTools
            : await buildCodexRequestTools({
                requestPlan,
                runtime: this.options.runtime,
                mcpTools: this.options.mcpTools,
                model: this.config.model,
                discoveredToolNames: this.discoveredToolNames,
              })
        const response = await createCodexResponseStream({
          config: this.config,
          input: currentInput,
          instructions: this.instructions,
          previousResponseId,
          tools: requestTools.length > 0 ? requestTools : undefined,
          signal: abortController.signal,
        })

        let roundText = ''
        let roundResponseId: string | undefined
        let completedResponse: unknown

        for await (const event of parseCodexSSE(response.body!)) {
          const failureMessage = getCodexFailureMessage(event)
          if (failureMessage) {
            throw new Error(failureMessage)
          }

          const delta = extractTextDelta(event)
          if (delta) {
            roundText += delta
            yield {
              type: 'assistant.delta',
              delta,
            }
          }

          const textSnapshot = extractTextSnapshot(event)
          if (textSnapshot && !roundText) {
            roundText = textSnapshot
          }

          const completed = extractCompletedResponse(event)
          if (!completed) {
            continue
          }

          completedResponse = completed
          roundResponseId = extractResponseId(completed)

          const completedText = extractResponseText(completed)
          if (completedText && !roundText) {
            roundText = completedText
          }

          usage = accumulateCodexUsage(usage, extractUsage(completed))
        }

        if (roundResponseId) {
          previousResponseId = roundResponseId
        }

        const functionCalls = extractCodexFunctionCalls(completedResponse)
        if (functionCalls.length > 0) {
          const execution = await requireCodexFunctionToolExecutor({
            functionToolExecutor,
            mode: 'repl',
          }).execute(functionCalls)
          currentInput = execution.outputs
          for (const toolName of execution.selectedToolNames) {
            this.discoveredToolNames.add(toolName)
          }
          continue
        }

        accumulatedText = roundText
        responseId = roundResponseId
        completedFinalRound = true
        break
      }
    } catch (error) {
      this.conversationState = withCodexDiscoveredToolNames({
        state: this.conversationState,
        discoveredToolNames: this.discoveredToolNames,
      })
      throw error
    } finally {
      cleanup()
    }

    if (!completedFinalRound) {
      throw new Error(
        'Codex REPL exceeded the maximum local tool-call rounds for a single prompt.',
      )
    }

    if (!accumulatedText && !responseId) {
      throw new Error('Codex REPL completed without text or tool output.')
    }

    const assistantMessageUuid = responseId ? randomUUID() : undefined
    const createdAt = new Date().toISOString()

    this.conversationState = withCodexDiscoveredToolNames({
      state: {
        ...this.conversationState,
        providerId: 'codex-repl',
        lastResponseId: responseId ?? this.conversationState.lastResponseId,
        lastAssistantMessageUuid:
          assistantMessageUuid ?? this.conversationState.lastAssistantMessageUuid,
        history:
          responseId && assistantMessageUuid
            ? [
                ...(this.conversationState.history ?? []),
                {
                  assistantMessageUuid,
                  responseId,
                  createdAt,
                },
              ]
            : this.conversationState.history,
      },
      discoveredToolNames: this.discoveredToolNames,
    })

    return {
      responseText: accumulatedText,
      responseId,
      usage,
      conversationState: this.state,
    }
  }
}

export function createCodexReplSession(options?: {
  userSpecifiedModel?: string
  systemPrompt?: string
  appendSystemPrompt?: string
  cwd?: string
  mcpTools?: CodexMcpTool[]
  runtime?: CodexToolRuntime
  conversationState?: CodexReplConversationState | null
}): CodexReplSession {
  return new CodexReplSession(options)
}

export async function runCodexRepl(
  args: ReplProviderLaunchArgs,
): Promise<number> {
  const { replProps } = args
  const unsupportedMessage = getUnsupportedCodexReplMessage(replProps)
  if (unsupportedMessage) {
    writeError(unsupportedMessage)
    return 1
  }

  let session: CodexReplSession
  let initialConversationState: CodexReplPersistedState | null
  let mcpTools: CodexMcpTool[]
  try {
    initialConversationState = resolveInitialConversationState({
      replProps,
    })
    mcpTools = await resolveCodexMcpTools({
      dynamicMcpConfig: replProps.dynamicMcpConfig,
      strictMcpConfig: replProps.strictMcpConfig,
      allowLocalBridge: true,
    })
    session = createCodexReplSession({
      userSpecifiedModel: replProps.providerContext?.userSpecifiedModel,
      systemPrompt: replProps.systemPrompt,
      appendSystemPrompt: replProps.appendSystemPrompt,
      cwd: replProps.providerContext?.cwd,
      mcpTools,
      runtime: createCodexReplToolRuntime(args),
      conversationState: initialConversationState,
    })
  } catch (error) {
    writeError(formatCodexReplError(error))
    return 1
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })

  const sessionId = session.state.stateId
  const resumeMode = replProps.providerContext?.continue
    ? 'continued'
    : replProps.providerContext?.resume
      ? 'resumed'
      : 'ready'
  writeLine(
    `Codex REPL ${resumeMode} (${session.model})${sessionId ? ` · session ${sessionId}` : ''}. Type /exit to quit.`,
  )

  try {
    for (;;) {
      let input: string
      try {
        input = await rl.question('codex> ')
      } catch (error) {
        if (isClosedInputError(error)) {
          return 0
        }

        writeError(formatCodexReplError(error))
        return 1
      }

      const prompt = input.trim()

      if (!prompt) {
        continue
      }

      if (isExitCommand(prompt)) {
        return 0
      }

      if (isSlashCommand(prompt)) {
        writeError('Codex REPL currently only supports text prompts and /exit.')
        continue
      }

      const abortController = new AbortController()
      const sigintHandler = () => abortController.abort()
      process.on('SIGINT', sigintHandler)

      try {
        const iterator = session.submitTurn(prompt, abortController.signal)
        let result: CodexReplTurnResult | undefined
        let streamedText = ''

        for (;;) {
          const next = await iterator.next()
          if (next.done) {
            result = next.value
            break
          }

          if (next.value.type === 'assistant.delta') {
            streamedText += next.value.delta
            process.stdout.write(next.value.delta)
          }
        }

        if (!streamedText && result?.responseText) {
          process.stdout.write(result.responseText)
        }

        if (!result?.responseText.endsWith('\n')) {
          writeLine()
        }

        setCodexReplState(result.conversationState, {
          cwd: result.conversationState.cwd,
        })

        writeLine()
      } catch (error) {
        setCodexReplState(session.state, {
          cwd: session.state.cwd,
        })
        writeError(formatCodexReplError(error))
        return 1
      } finally {
        process.off('SIGINT', sigintHandler)
      }
    }
  } finally {
    rl.close()
  }
}

export function createCodexReplProvider(): ReplProvider {
  return {
    metadata: {
      id: 'codex',
      displayName: 'Codex',
    },
    capabilities: {
      supportsContinue: true,
      supportsResume: true,
      supportsPersistedState: true,
      supportsTools: true,
    },
    async launch(args: ReplProviderLaunchArgs): Promise<void> {
      const exitCode = await runCodexRepl(args)
      await gracefulShutdown(exitCode)
    },
  }
}
