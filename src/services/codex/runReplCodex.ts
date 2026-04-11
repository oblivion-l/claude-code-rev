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
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import { TOOL_SEARCH_TOOL_NAME } from 'src/tools/ToolSearchTool/constants.js'
import { isDeferredTool } from 'src/tools/ToolSearchTool/prompt.js'
import type { NonNullableUsage } from 'src/entrypoints/sdk/sdkUtilityTypes.js'
import {
  extractCodexFunctionCalls,
  selectCodexFunctionTools,
} from './toolBridge.js'
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
  getCodexReplStateFilePath,
  listCodexReplStates,
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

export type CodexReplPromptOutcome =
  | {
      kind: 'continue'
    }
  | {
      kind: 'exit'
      exitCode: number
    }

type CodexReplSlashCommand =
  | {
      name:
        | 'help'
        | 'status'
        | 'resume'
        | 'model'
        | 'tools'
        | 'new'
        | 'sessions'
      argText: string
    }
  | {
      name: 'exit'
      argText: string
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

const CODEX_REPL_MODEL_METADATA_KEY = 'codexModel'

function getCodexReplInteractiveResumePickerUnsupportedMessage(): string {
  return 'Codex REPL does not support the interactive resume picker. Pass an explicit persisted resume id to --resume.'
}

function getCodexReplContinueMissingCwdMessage(): string {
  return 'Codex REPL continue requested but no current working directory is available.'
}

function getCodexReplContinueMissingStateMessage(): string {
  return 'Codex REPL continue requested but no conversation state is available for the current directory.'
}

function getCodexReplResumeMissingCwdMessage(): string {
  return 'Codex REPL resume requested but no current working directory is available.'
}

function getCodexReplResumeMissingStateMessage(): string {
  return 'Codex REPL resume requested but no persisted conversation state is available.'
}

function getCodexReplResumeSessionAtMissingTurnMessage(
  assistantMessageUuid: string,
): string {
  return `Codex REPL could not find persisted assistant turn ${assistantMessageUuid} for --resume-session-at.`
}

function parseCodexReplSlashCommand(
  input: string,
): CodexReplSlashCommand | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) {
    return null
  }

  const withoutSlash = trimmed.slice(1).trim()
  if (!withoutSlash) {
    return null
  }

  const [rawName, ...rest] = withoutSlash.split(/\s+/)
  const name = rawName.toLowerCase()
  const argText = rest.join(' ').trim()

  switch (name) {
    case 'help':
    case 'status':
    case 'resume':
    case 'model':
    case 'tools':
    case 'new':
    case 'sessions':
    case 'exit':
    case 'quit':
      return {
        name: name === 'quit' ? 'exit' : name,
        argText,
      } as CodexReplSlashCommand
    default:
      return null
  }
}

function formatCodexReplMcpFailureReason(
  client: Exclude<MCPServerConnection, { type: 'connected' }>,
): string | undefined {
  if (client.type === 'failed') {
    return client.error ?? 'connection failed'
  }

  if (client.type === 'needs-auth') {
    return 'authentication required'
  }

  if (client.type === 'pending') {
    return client.reconnectAttempt
      ? `connecting (attempt ${client.reconnectAttempt}/${client.maxReconnectAttempts ?? '?'})`
      : 'connecting'
  }

  if (client.type === 'disabled') {
    return 'disabled'
  }

  return undefined
}

function summarizeCodexReplMcpClients(
  clients: MCPServerConnection[],
): string[] {
  if (clients.length === 0) {
    return ['MCP bridge servers: none']
  }

  const counts = {
    connected: clients.filter(client => client.type === 'connected').length,
    pending: clients.filter(client => client.type === 'pending').length,
    failed: clients.filter(client => client.type === 'failed').length,
    needsAuth: clients.filter(client => client.type === 'needs-auth').length,
    disabled: clients.filter(client => client.type === 'disabled').length,
  }

  const lines = [
    `MCP bridge servers: ${clients.length} total (${counts.connected} connected, ${counts.pending} pending, ${counts.failed} failed, ${counts.needsAuth} needs-auth, ${counts.disabled} disabled)`,
  ]

  for (const client of clients) {
    const transport = client.config.type ?? 'stdio'
    const reason =
      client.type === 'connected'
        ? undefined
        : formatCodexReplMcpFailureReason(client)
    lines.push(
      `- ${client.name} [${client.type}] transport=${transport}${reason ? ` reason=${reason}` : ''}`,
    )
  }

  return lines
}

function summarizeCodexReplRemoteMcpTools(mcpTools: CodexMcpTool[]): string[] {
  if (mcpTools.length === 0) {
    return ['Remote MCP passthrough: none']
  }

  return [
    `Remote MCP passthrough: ${mcpTools.length} server(s)`,
    ...mcpTools.map(
      tool => `- ${tool.server_label} [remote-mcp] url=${tool.server_url}`,
    ),
  ]
}

function resolveCodexReplPersistedStateForResume(options: {
  cwd?: string
  stateId?: string
}): CodexReplPersistedState {
  let state: CodexReplPersistedState | null = null

  try {
    state = options.stateId
      ? getCodexReplState({
          stateId: options.stateId,
        })
      : options.cwd
        ? getCodexReplState({
            cwd: options.cwd,
          })
        : null
  } catch (error) {
    const message = errorMessage(error)
    if (
      message.startsWith('No persisted codex-repl conversation state was found') ||
      message.startsWith('Persisted codex-repl latest-conversation pointer')
    ) {
      throw new Error(getCodexReplResumeMissingStateMessage())
    }

    throw error
  }

  if (!state?.lastResponseId) {
    throw new Error(getCodexReplResumeMissingStateMessage())
  }

  return state
}

function summarizeCodexReplPersistedConversationState(
  state: CodexReplConversationState,
): string {
  if (!state.cwd) {
    return 'Persisted conversation state: unavailable because no current working directory is available.'
  }

  if (!state.lastResponseId) {
    return 'Persisted conversation state: no conversation state is available for the current directory yet.'
  }

  return 'Persisted conversation state: conversation state is available for the current directory.'
}

function getCodexReplPersistedModel(
  state?: Pick<CodexReplConversationState, 'metadata'> | null,
): string | undefined {
  const value = state?.metadata?.[CODEX_REPL_MODEL_METADATA_KEY]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function withCodexReplModelMetadata(args: {
  state: CodexReplConversationState
  model: string
}): CodexReplConversationState {
  return {
    ...args.state,
    metadata: {
      ...(args.state.metadata ?? {}),
      [CODEX_REPL_MODEL_METADATA_KEY]: args.model,
    },
  }
}

function formatCodexReplResumeSuccessMessage(
  state: CodexReplPersistedState | CodexReplConversationState,
): string {
  return `Resumed persisted conversation state ${state.stateId}${state.lastResponseId ? ` (last response ${state.lastResponseId})` : ''}.`
}

function formatCodexReplNewSessionMessage(
  state: CodexReplConversationState,
): string {
  return `Started new persisted conversation state ${state.stateId}.`
}

function formatCodexReplStateFilePath(
  state: Pick<CodexReplConversationState, 'stateId'>,
): string {
  if (!state.stateId) {
    return 'unavailable'
  }

  return getCodexReplStateFilePath(state.stateId)
}

function formatCodexReplLastSavedAt(
  state: Pick<CodexReplConversationState, 'updatedAt'>,
): string {
  return state.updatedAt ?? 'not saved yet'
}

function summarizeCodexReplFunctionTools(args: {
  runtime?: CodexToolRuntime
  discoveredToolNames: Set<string>
}): string[] {
  const tools = args.runtime?.tools ?? []
  if (tools.length === 0) {
    return ['Function tools exposed: none']
  }

  const selectedTools = selectCodexFunctionTools(tools, args.runtime, {
    discoveredToolNames: args.discoveredToolNames,
  })
  if (selectedTools.length === 0) {
    return ['Function tools exposed: none']
  }

  const lines = [`Function tools exposed: ${selectedTools.length}`]
  for (const tool of [...selectedTools].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const source =
      tool.name === TOOL_SEARCH_TOOL_NAME
        ? 'tool-search'
        : tool.isMcp
          ? 'mcp-bridge'
          : 'local'
    const flags = [
      isDeferredTool(tool) ? 'deferred' : null,
      args.discoveredToolNames.has(tool.name) ? 'discovered' : null,
    ].filter((value): value is string => value !== null)
    lines.push(
      `- ${tool.name} [${source}]${flags.length > 0 ? ` ${flags.join(', ')}` : ''}`,
    )
  }

  const hiddenDeferredTools = tools
    .filter(tool => isDeferredTool(tool))
    .filter(
      tool => !selectedTools.some(selectedTool => selectedTool.name === tool.name),
    )
    .map(tool => tool.name)
    .sort((left, right) => left.localeCompare(right))
  if (hiddenDeferredTools.length > 0) {
    lines.push(
      `Deferred tools hidden until ToolSearch selects them: ${hiddenDeferredTools.join(', ')}`,
    )
  }

  return lines
}

async function handleCodexReplSlashCommand(args: {
  session: CodexReplSession
  command: CodexReplSlashCommand | null
  prompt: string
  writeLine: (message?: string) => void
  writeError: (message: string) => void
  persistState: (state: CodexReplConversationState) => void
}): Promise<CodexReplPromptOutcome> {
  const command = args.command
  if (!command) {
    args.writeError(
      `Unknown Codex REPL command "${args.prompt.trim()}". Use /help to see available commands.`,
    )
    return { kind: 'continue' }
  }

  switch (command.name) {
    case 'exit':
      return {
        kind: 'exit',
        exitCode: 0,
      }
    case 'help':
      args.writeLine('Codex REPL commands:')
      args.writeLine('- /help Show available REPL commands')
      args.writeLine(
        '- /new Start a new persisted conversation state with the current configuration',
      )
      args.writeLine('- /sessions List recent persisted conversation states')
      args.writeLine('- /status Show provider, session, and MCP status')
      args.writeLine(
        '- /resume [state-id] Load persisted conversation state for the current directory or an explicit state id',
      )
      args.writeLine('- /model Show the current model and API base URL')
      args.writeLine('- /tools Show local, MCP bridge, and remote MCP tool visibility')
      args.writeLine('- /exit Exit the REPL')
      return { kind: 'continue' }
    case 'new': {
      const newState = args.session.startNewConversation()
      args.persistState(newState)
      args.writeLine(formatCodexReplNewSessionMessage(newState))
      return { kind: 'continue' }
    }
    case 'sessions': {
      const sessionRecords = listCodexReplStates()
      if (sessionRecords.length === 0) {
        args.writeLine('Recent persisted Codex REPL sessions: none')
        return { kind: 'continue' }
      }

      args.writeLine(
        `Recent persisted Codex REPL sessions: ${sessionRecords.length}`,
      )
      for (const record of sessionRecords) {
        args.writeLine(
          `- ${record.state.stateId ?? 'unknown'} cwd=${record.state.cwd ?? 'unknown'} time=${record.state.updatedAt ?? record.state.createdAt ?? 'unknown'} model=${getCodexReplPersistedModel(record.state) ?? 'unknown'}`,
        )
      }
      return { kind: 'continue' }
    }
    case 'model':
      args.writeLine(`Provider: Codex`)
      args.writeLine(`Model: ${args.session.model}`)
      args.writeLine(`API base URL: ${args.session.baseUrl}`)
      return { kind: 'continue' }
    case 'status':
      for (const line of args.session.describeStatusLines()) {
        args.writeLine(line)
      }
      return { kind: 'continue' }
    case 'tools':
      for (const line of args.session.describeToolLines()) {
        args.writeLine(line)
      }
      return { kind: 'continue' }
    case 'resume': {
      try {
        const resumeState = command.argText
          ? resolveCodexReplPersistedStateForResume({
              stateId: command.argText,
            })
          : args.session.cwd
            ? resolveCodexReplPersistedStateForResume({
                cwd: args.session.cwd,
              })
            : (() => {
                throw new Error(getCodexReplResumeMissingCwdMessage())
              })()

        args.session.replaceConversationState(resumeState)
        args.persistState(args.session.state)
        args.writeLine(formatCodexReplResumeSuccessMessage(args.session.state))
      } catch (error) {
        args.writeError(formatCodexReplError(error))
      }

      return { kind: 'continue' }
    }
  }
}

export async function handleCodexReplPrompt(args: {
  session: CodexReplSession
  prompt: string
  signal?: AbortSignal
  writeStdout?: (text: string) => void
  writeLine?: (message?: string) => void
  writeError?: (message: string) => void
  persistState?: (state: CodexReplConversationState) => void
}): Promise<CodexReplPromptOutcome> {
  const prompt = args.prompt.trim()
  const emitStdout = args.writeStdout ?? (text => process.stdout.write(text))
  const emitLine = args.writeLine ?? writeLine
  const emitError = args.writeError ?? writeError
  const persistState =
    args.persistState ??
    (state => {
      setCodexReplState(state, {
        cwd: state.cwd,
      })
    })

  if (!prompt) {
    return { kind: 'continue' }
  }

  if (isExitCommand(prompt)) {
    return {
      kind: 'exit',
      exitCode: 0,
    }
  }

  if (isSlashCommand(prompt)) {
    return handleCodexReplSlashCommand({
      session: args.session,
      command: parseCodexReplSlashCommand(prompt),
      prompt,
      writeLine: emitLine,
      writeError: emitError,
      persistState,
    })
  }

  const iterator = args.session.submitTurn(prompt, args.signal)
  let result: CodexReplTurnResult | undefined
  let streamedText = ''

  try {
    for (;;) {
      const next = await iterator.next()
      if (next.done) {
        result = next.value
        break
      }

      if (next.value.type === 'assistant.delta') {
        streamedText += next.value.delta
        emitStdout(next.value.delta)
      }
    }

    if (!streamedText && result?.responseText) {
      emitStdout(result.responseText)
    }

    if (!result?.responseText.endsWith('\n')) {
      emitLine()
    }

    persistState(result.conversationState)
    emitLine()
    return { kind: 'continue' }
  } catch (error) {
    persistState(args.session.state)
    if (streamedText && !streamedText.endsWith('\n')) {
      emitLine()
    }
    emitError(formatCodexReplError(error))
    emitLine()
    return { kind: 'continue' }
  }
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
    throw new Error(getCodexReplInteractiveResumePickerUnsupportedMessage())
  }

  let state: CodexReplPersistedState | null = null

  if (typeof providerContext?.resume === 'string') {
    state = getCodexReplState({
      stateId: providerContext.resume,
    })
  } else if (providerContext?.continue) {
    if (!cwd) {
      throw new Error(getCodexReplContinueMissingCwdMessage())
    }

    state = getCodexReplState({
      cwd,
    })
    if (!state?.lastResponseId) {
      throw new Error(getCodexReplContinueMissingStateMessage())
    }
  }

  if (providerContext?.resumeSessionAt) {
    if (!state?.lastResponseId) {
      throw new Error(getCodexReplResumeMissingStateMessage())
    }

    const matchedTurnIndex =
      state.history?.findIndex(
        turn => turn.assistantMessageUuid === providerContext.resumeSessionAt,
      ) ?? -1

    if (matchedTurnIndex < 0) {
      throw new Error(
        getCodexReplResumeSessionAtMissingTurnMessage(
          providerContext.resumeSessionAt,
        ),
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
    this.conversationState = withCodexReplModelMetadata({
      state: {
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
      },
      model: this.config.model,
    })
    this.discoveredToolNames = getCodexDiscoveredToolNames(
      this.options.conversationState,
    )
  }

  get model(): string {
    return this.config.model
  }

  get baseUrl(): string {
    return this.config.baseUrl
  }

  get cwd(): string | undefined {
    return this.conversationState.cwd ?? this.options.cwd ?? this.options.runtime?.cwd
  }

  get state(): CodexReplConversationState {
    return { ...this.conversationState }
  }

  replaceConversationState(
    state: CodexReplConversationState | CodexReplPersistedState,
  ): void {
    this.conversationState = withCodexReplModelMetadata({
      state: {
        providerId: 'codex-repl',
        version: state.version,
        stateId: state.stateId ?? this.conversationState.stateId,
        cwd: state.cwd ?? this.cwd,
        createdAt: state.createdAt ?? this.conversationState.createdAt,
        updatedAt: state.updatedAt ?? this.conversationState.updatedAt,
        conversationId:
          state.conversationId ??
          state.stateId ??
          this.conversationState.conversationId,
        lastResponseId: state.lastResponseId,
        lastAssistantMessageUuid: state.lastAssistantMessageUuid,
        metadata: state.metadata,
        history: state.history ?? [],
      },
      model: this.model,
    })
    this.discoveredToolNames.clear()
    for (const toolName of getCodexDiscoveredToolNames(state)) {
      this.discoveredToolNames.add(toolName)
    }
  }

  startNewConversation(): CodexReplConversationState {
    const stateId = randomUUID()
    const createdAt = new Date().toISOString()

    this.discoveredToolNames.clear()
    this.conversationState = withCodexReplModelMetadata({
      state: {
        providerId: 'codex-repl',
        version: this.conversationState.version,
        stateId,
        cwd: this.cwd,
        createdAt,
        updatedAt: createdAt,
        conversationId: stateId,
        history: [],
      },
      model: this.model,
    })

    return this.state
  }

  describeStatusLines(): string[] {
    const historyLength = this.conversationState.history?.length ?? 0
    const lines = [
      'Provider: Codex',
      `Model: ${this.model}`,
      `API base URL: ${this.baseUrl}`,
      `Session id: ${this.conversationState.stateId ?? 'unavailable'}`,
      `Conversation id: ${this.conversationState.conversationId ?? 'unavailable'}`,
      `Current working directory: ${this.cwd ?? 'unavailable'}`,
      summarizeCodexReplPersistedConversationState(this.conversationState),
      `State file path: ${formatCodexReplStateFilePath(this.conversationState)}`,
      `Last saved at: ${formatCodexReplLastSavedAt(this.conversationState)}`,
      `Assistant turns: ${historyLength}`,
      `Last response id: ${this.conversationState.lastResponseId ?? 'none'}`,
    ]

    return [
      ...lines,
      ...summarizeCodexReplMcpClients(this.options.runtime?.mcpClients ?? []),
      ...summarizeCodexReplRemoteMcpTools(this.options.mcpTools ?? []),
    ]
  }

  describeToolLines(): string[] {
    const lines = summarizeCodexReplFunctionTools({
      runtime: this.options.runtime,
      discoveredToolNames: this.discoveredToolNames,
    })

    return [
      ...lines,
      ...summarizeCodexReplRemoteMcpTools(this.options.mcpTools ?? []),
      ...summarizeCodexReplMcpClients(this.options.runtime?.mcpClients ?? []),
    ]
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
    `Codex REPL ${resumeMode} (${session.model})${sessionId ? ` · session ${sessionId}` : ''}. Type /help for commands or /exit to quit.`,
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

      const abortController = new AbortController()
      const sigintHandler = () => abortController.abort()
      process.on('SIGINT', sigintHandler)

      try {
        const outcome = await handleCodexReplPrompt({
          session,
          prompt,
          signal: abortController.signal,
        })
        if (outcome.kind === 'exit') {
          return outcome.exitCode
        }
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
