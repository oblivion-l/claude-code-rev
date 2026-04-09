import { randomUUID } from 'crypto'
import { createInterface } from 'readline/promises'
import { getSessionId } from 'src/bootstrap/state.js'
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js'
import { errorMessage, isAbortError } from 'src/utils/errors.js'
import type { Props as REPLProps } from 'src/screens/REPL.js'
import type {
  ReplProvider,
  ReplProviderLaunchArgs,
} from 'src/services/repl/provider.js'
import { EMPTY_USAGE } from 'src/services/api/logging.js'
import type { NonNullableUsage } from 'src/entrypoints/sdk/sdkUtilityTypes.js'
import {
  createCodexResponseStream,
  parseCodexSSE,
} from './client.js'
import { getCodexRuntimeConfig } from './config.js'
import {
  extractCompletedResponse,
  extractResponseId,
  extractResponseText,
  extractTextDelta,
  extractUsage,
  getCodexFailureMessage,
} from './stream.js'
import type { CodexRuntimeConfig } from './types.js'
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

  constructor(
    private readonly options: {
      userSpecifiedModel?: string
      systemPrompt?: string
      appendSystemPrompt?: string
      cwd?: string
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

    const response = await createCodexResponseStream({
      config: this.config,
      input: prompt,
      instructions: this.instructions,
      previousResponseId: this.conversationState.lastResponseId,
      signal,
    })

    let accumulatedText = ''
    let responseId: string | undefined
    let usage: NonNullableUsage = EMPTY_USAGE

    for await (const event of parseCodexSSE(response.body!)) {
      const failureMessage = getCodexFailureMessage(event)
      if (failureMessage) {
        throw new Error(failureMessage)
      }

      const delta = extractTextDelta(event)
      if (delta) {
        accumulatedText += delta
        yield {
          type: 'assistant.delta',
          delta,
        }
      }

      const completedResponse = extractCompletedResponse(event)
      if (!completedResponse) {
        continue
      }

      const completedText = extractResponseText(completedResponse)
      if (completedText && !accumulatedText) {
        accumulatedText = completedText
      }

      responseId = extractResponseId(completedResponse)
      usage = extractUsage(completedResponse)
    }

    const assistantMessageUuid = responseId ? randomUUID() : undefined
    const createdAt = new Date().toISOString()

    this.conversationState = {
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
    }

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
  conversationState?: CodexReplConversationState | null
}): CodexReplSession {
  return new CodexReplSession(options)
}

export async function runCodexRepl({
  replProps,
}: ReplProviderLaunchArgs): Promise<number> {
  const unsupportedMessage = getUnsupportedCodexReplMessage(replProps)
  if (unsupportedMessage) {
    writeError(unsupportedMessage)
    return 1
  }

  let session: CodexReplSession
  let initialConversationState: CodexReplPersistedState | null
  try {
    initialConversationState = resolveInitialConversationState({
      replProps,
    })
    session = createCodexReplSession({
      userSpecifiedModel: replProps.providerContext?.userSpecifiedModel,
      systemPrompt: replProps.systemPrompt,
      appendSystemPrompt: replProps.appendSystemPrompt,
      cwd: replProps.providerContext?.cwd,
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

        for (;;) {
          const next = await iterator.next()
          if (next.done) {
            result = next.value
            break
          }

          if (next.value.type === 'assistant.delta') {
            process.stdout.write(next.value.delta)
          }
        }

        if (!result?.responseText.endsWith('\n')) {
          writeLine()
        }

        setCodexReplState(result.conversationState, {
          cwd: result.conversationState.cwd,
        })

        writeLine()
      } catch (error) {
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
      supportsTools: false,
    },
    async launch(args: ReplProviderLaunchArgs): Promise<void> {
      const exitCode = await runCodexRepl(args)
      await gracefulShutdown(exitCode)
    },
  }
}
