import { randomUUID } from 'crypto'
import { createInterface } from 'readline/promises'
import { getSessionId } from 'src/bootstrap/state.js'
import { hasPermissionsToUseTool } from 'src/utils/permissions/permissions.js'
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js'
import { errorMessage, isAbortError } from 'src/utils/errors.js'
import { parseArguments } from 'src/utils/argumentSubstitution.js'
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
  analyzeCodexFunctionToolVisibility,
  extractCodexFunctionCalls,
  getCodexDiscoveredToolSignatureMap,
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
import { isCodexApiRequestError } from './errors.js'
import {
  getCodexDiscoveredToolState,
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
  resolveCodexReplStateWithRepair,
  setCodexReplState,
} from './replState.js'
import {
  buildCodexContinueMissingStateMessage,
  buildCodexReplGlobalFallbackStatusLine,
  buildCodexReplResumeSourceSuffix,
  buildCodexPersistedConversationStateStatus,
  buildCodexReplResumeHint,
  buildCodexResumeMissingStateMessage,
  buildCodexResumeSessionAtMissingTurnMessage,
} from './sessionText.js'

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

type CodexReplSessionsProviderFilter = 'codex' | 'all'

type CodexReplSessionsCommandOptions = {
  cwd?: string
  provider: CodexReplSessionsProviderFilter
  query?: string
  page: number
  pageSize: number
}

type CodexReplSessionsView = {
  lines: string[]
}

type CodexReplResumeResolution = {
  state: CodexReplPersistedState
  sourceCwd?: string
  globalFallback?: {
    sourceCwd: string
    requestedCwd: string
  }
}

type CodexReplInitialStateResolution = {
  state: CodexReplPersistedState | null
  globalFallback?: {
    sourceCwd: string
    requestedCwd: string
  }
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
  if (isAbortError(error)) {
    return 'Request interrupted by user.'
  }

  const message = errorMessage(error)
  if (isCodexApiRequestError(error) && error.category === 'tooling') {
    return `${message} error_code=${error.errorCode} hint=${error.hint}`
  }

  return message
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
const CODEX_REPL_SESSIONS_DEFAULT_PAGE = 1
const CODEX_REPL_SESSIONS_DEFAULT_PAGE_SIZE = 10
const CODEX_REPL_SESSIONS_MAX_PAGE_SIZE = 50

function getCodexReplSessionsUsage(): string {
  return 'Usage: /sessions [--cwd <path>] [--provider codex|all] [--query <keyword>] [--page <n>] [--page-size <n>]'
}

function getCodexReplInteractiveResumePickerUnsupportedMessage(): string {
  return 'Codex REPL does not support the interactive resume picker. Pass an explicit persisted resume id to --resume.'
}

function getCodexReplContinueMissingCwdMessage(): string {
  return 'Codex REPL continue requested but no current working directory is available.'
}

function getCodexReplContinueMissingStateMessage(): string {
  return buildCodexContinueMissingStateMessage('repl')
}

function getCodexReplResumeMissingCwdMessage(): string {
  return 'Codex REPL resume requested but no current working directory is available.'
}

function getCodexReplResumeMissingStateMessage(): string {
  return buildCodexResumeMissingStateMessage('repl')
}

function getCodexReplResumeMissingStateMessageWithDiagnostics(args: {
  skippedBrokenCount?: number
}): string {
  return buildCodexResumeMissingStateMessage('repl', {
    skippedBrokenCount: args.skippedBrokenCount,
  })
}

function getCodexReplResumeSessionAtMissingTurnMessage(
  assistantMessageUuid: string,
): string {
  return buildCodexResumeSessionAtMissingTurnMessage({
    surface: 'repl',
    assistantMessageUuid,
  })
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
    return client.error?.trim() || 'connection failed'
  }

  if (client.type === 'needs-auth') {
    return 'authentication required'
  }

  if (client.type === 'pending') {
    return client.reconnectAttempt
      ? `connecting attempt ${client.reconnectAttempt}/${client.maxReconnectAttempts ?? '?'}`
      : 'connecting'
  }

  if (client.type === 'disabled') {
    return 'disabled by configuration'
  }

  return undefined
}

type CodexReplDiagnosticSource =
  | 'local'
  | 'mcp-bridge'
  | 'remote-mcp'
  | 'tool-search'

type CodexReplDiagnosticFields = {
  source: CodexReplDiagnosticSource
  server: string
  transport: string
  scope: string
  endpoint: string
  status: 'connected' | 'failed' | 'disconnected' | 'unavailable'
  capabilities: string
  reason: string
  hint: string
}

function getCodexReplMcpTransport(
  client: MCPServerConnection,
): string {
  return client.config.type ?? 'stdio'
}

function formatCodexReplMcpEndpoint(
  client: MCPServerConnection,
): string {
  switch (client.config.type) {
    case undefined:
    case 'stdio':
      return [client.config.command, ...(client.config.args ?? [])].join(' ')
    case 'http':
    case 'sse':
    case 'ws':
    case 'sse-ide':
    case 'ws-ide':
    case 'claudeai-proxy':
      return client.config.url
    case 'sdk':
      return 'n/a'
  }
}

function getCodexReplNormalizedMcpStatus(
  client?: MCPServerConnection,
): CodexReplDiagnosticFields['status'] {
  if (!client) {
    return 'unavailable'
  }

  switch (client.type) {
    case 'connected':
      return 'connected'
    case 'failed':
      return 'failed'
    case 'pending':
    case 'needs-auth':
    case 'disabled':
      return 'disconnected'
  }
}

function formatCodexReplDiagnosticFields(
  fields: CodexReplDiagnosticFields,
): string[] {
  return [
    `source=${fields.source}`,
    `server=${fields.server}`,
    `transport=${fields.transport}`,
    `scope=${fields.scope}`,
    `endpoint=${fields.endpoint}`,
    `status=${fields.status}`,
    `capabilities=${fields.capabilities}`,
    `reason=${fields.reason}`,
    `hint=${fields.hint}`,
  ]
}

function formatCodexReplMcpRepairHint(
  client?: MCPServerConnection,
): string {
  if (!client) {
    return 'start-bridge'
  }

  if (client.type === 'connected') {
    return 'none'
  }

  if (client.type === 'needs-auth') {
    return 'refresh-auth'
  }

  if (client.type === 'pending') {
    return 'wait-retry'
  }

  if (client.type === 'disabled') {
    return 'enable-server'
  }

  const reason = client.error?.toLowerCase() ?? ''
  if (
    reason.includes('auth') ||
    reason.includes('token') ||
    reason.includes('oauth') ||
    reason.includes('credential')
  ) {
    return 'refresh-auth'
  }

  return 'check-connection'
}

function buildCodexReplBridgeDiagnosticFields(
  client?: MCPServerConnection,
): CodexReplDiagnosticFields {
  const capabilities =
    client?.type === 'connected'
      ? formatCodexReplMcpCapabilities(client)
      : 'none'
  const reason =
    client && client.type !== 'connected'
      ? (formatCodexReplMcpFailureReason(client) ?? 'none')
      : client
        ? 'none'
        : 'bridge server not connected'

  return {
    source: 'mcp-bridge',
    server: client?.name ?? 'unknown',
    transport: client ? getCodexReplMcpTransport(client) : 'unknown',
    scope: client?.config.scope ?? 'unknown',
    endpoint: client ? formatCodexReplMcpEndpoint(client) : 'n/a',
    status: getCodexReplNormalizedMcpStatus(client),
    capabilities,
    reason,
    hint: formatCodexReplMcpRepairHint(client),
  }
}

function buildCodexReplRemoteMcpDiagnosticFields(
  tool: CodexMcpTool,
): CodexReplDiagnosticFields {
  return {
    source: 'remote-mcp',
    server: tool.server_label,
    transport: 'unknown',
    scope: 'unknown',
    endpoint: tool.server_url,
    status: 'connected',
    capabilities: 'none',
    reason: 'none',
    hint: 'none',
  }
}

function formatCodexReplMcpConfigSegments(
  client: MCPServerConnection,
): string[] {
  const transport = getCodexReplMcpTransport(client)
  const segments = [`transport=${transport}`, `scope=${client.config.scope}`]

  if (client.config.pluginSource) {
    segments.push(`plugin=${client.config.pluginSource}`)
  }

  switch (client.config.type) {
    case undefined:
    case 'stdio':
      segments.push(
        `command=${[client.config.command, ...(client.config.args ?? [])].join(' ')}`,
      )
      break
    case 'http':
    case 'sse':
    case 'ws':
    case 'sse-ide':
    case 'ws-ide':
      segments.push(`endpoint=${client.config.url}`)
      if ('ideName' in client.config && client.config.ideName) {
        segments.push(`ide=${client.config.ideName}`)
      }
      break
    case 'sdk':
      segments.push(`sdk=${client.config.name}`)
      break
    case 'claudeai-proxy':
      segments.push(`endpoint=${client.config.url}`)
      segments.push(`proxy-id=${client.config.id}`)
      break
  }

  return segments
}

function formatCodexReplMcpCapabilities(client: MCPServerConnection): string {
  if (client.type !== 'connected') {
    return client.type
  }

  const capabilityKeys = Object.entries(client.capabilities)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right))

  return capabilityKeys.length > 0 ? capabilityKeys.join(',') : 'none'
}

function formatCodexReplMcpServerInfo(client: MCPServerConnection): string {
  if (client.type !== 'connected' || !client.serverInfo?.name) {
    return 'unknown'
  }

  return client.serverInfo.version
    ? `${client.serverInfo.name}@${client.serverInfo.version}`
    : client.serverInfo.name
}

function findCodexReplMcpClient(options: {
  runtime?: CodexToolRuntime
  serverName?: string
}): MCPServerConnection | undefined {
  if (!options.runtime || !options.serverName) {
    return undefined
  }

  return options.runtime.mcpClients.find(
    client => client.name === options.serverName,
  )
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
    const reason =
      client.type === 'connected'
        ? undefined
        : formatCodexReplMcpFailureReason(client)
    const segments = formatCodexReplMcpConfigSegments(client)
    const diagnostics = buildCodexReplBridgeDiagnosticFields(client)

    if (client.type === 'connected') {
      segments.push(`server-info=${formatCodexReplMcpServerInfo(client)}`)
      segments.push(`capabilities=${formatCodexReplMcpCapabilities(client)}`)
    }

    if (reason) {
      segments.push(`reason=${reason}`)
    }

    segments.push(...formatCodexReplDiagnosticFields(diagnostics))

    lines.push(
      `- ${client.name} [${client.type}] ${segments.join(' ')}`,
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
      tool => {
        const diagnostics = buildCodexReplRemoteMcpDiagnosticFields(tool)
        return `- ${tool.server_label} [remote-mcp] decision=selected, selection-reason=passthrough url=${tool.server_url} ${formatCodexReplDiagnosticFields(diagnostics).join(' ')}`
      },
    ),
  ]
}

function resolveCodexReplPersistedStateForResume(options: {
  cwd?: string
  stateId?: string
}): CodexReplResumeResolution {
  try {
    const resolution = resolveCodexReplStateWithRepair(options)
    const state = resolution.state

    if (!state?.lastResponseId) {
      throw new Error(
        getCodexReplResumeMissingStateMessageWithDiagnostics({
          skippedBrokenCount: resolution.diagnostics.skippedBrokenCount,
        }),
      )
    }

    return {
      state,
      sourceCwd: state.cwd,
      globalFallback:
        resolution.diagnostics.usedGlobalFallback &&
        options.cwd &&
        state.cwd &&
        state.cwd !== options.cwd
          ? {
              sourceCwd: state.cwd,
              requestedCwd: options.cwd,
            }
          : undefined,
    }
  } catch (error) {
    const message = errorMessage(error)
    if (message.startsWith('No persisted codex-repl conversation state was found')) {
      throw new Error(getCodexReplResumeMissingStateMessage())
    }

    throw error
  }
}

function summarizeCodexReplPersistedConversationState(
  state: CodexReplConversationState,
): string {
  return buildCodexPersistedConversationStateStatus({
    hasCurrentWorkingDirectory: Boolean(state.cwd),
    hasPersistedConversationState: Boolean(state.lastResponseId),
  })
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
  args: {
    state: CodexReplPersistedState | CodexReplConversationState
    sourceCwd?: string
  },
): string {
  const { state } = args
  return `Resumed persisted conversation state ${state.stateId}${state.lastResponseId ? ` (last response ${state.lastResponseId})` : ''}.${buildCodexReplResumeSourceSuffix({
    sourceCwd: args.sourceCwd,
  })}`
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

function formatCodexReplToolDecisionReason(reason: ReturnType<
  typeof analyzeCodexFunctionToolVisibility
>[number]['reason']): string {
  switch (reason) {
    case 'always-visible':
      return 'always-visible'
    case 'discovered-match':
      return 'discovered-match'
    case 'discovered-legacy':
      return 'discovered-legacy'
    case 'awaiting-tool-search':
      return 'awaiting-tool-search'
    case 'stale-discovery':
      return 'stale-discovery'
    case 'duplicate-lower-priority':
      return 'duplicate-lower-priority'
    case 'tool-search-for-deferred':
      return 'tool-search-for-deferred'
  }
}

function parsePositiveInteger(
  rawValue: string,
  optionName: '--page' | '--page-size',
): number {
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(
      `Codex REPL /sessions ${optionName} must be a positive integer. ${getCodexReplSessionsUsage()}`,
    )
  }

  const value = Number.parseInt(rawValue, 10)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(
      `Codex REPL /sessions ${optionName} must be a positive integer. ${getCodexReplSessionsUsage()}`,
    )
  }

  return value
}

function parseCodexReplSessionsCommandOptions(
  argText: string,
): CodexReplSessionsCommandOptions {
  const tokens = parseArguments(argText)
  const options: CodexReplSessionsCommandOptions = {
    provider: 'codex',
    page: CODEX_REPL_SESSIONS_DEFAULT_PAGE,
    pageSize: CODEX_REPL_SESSIONS_DEFAULT_PAGE_SIZE,
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token?.startsWith('--')) {
      throw new Error(
        `Unknown Codex REPL /sessions argument "${token}". ${getCodexReplSessionsUsage()}`,
      )
    }

    const nextValue = tokens[index + 1]
    switch (token) {
      case '--cwd':
        if (!nextValue) {
          throw new Error(
            `Codex REPL /sessions ${token} requires a path value. ${getCodexReplSessionsUsage()}`,
          )
        }
        options.cwd = nextValue
        index += 1
        break
      case '--provider':
        if (!nextValue) {
          throw new Error(
            `Codex REPL /sessions ${token} requires a provider value. ${getCodexReplSessionsUsage()}`,
          )
        }
        if (nextValue === 'anthropic') {
          throw new Error(
            'Codex REPL /sessions does not yet support --provider anthropic. Use --provider codex or --provider all.',
          )
        }
        if (nextValue !== 'codex' && nextValue !== 'all') {
          throw new Error(
            `Codex REPL /sessions --provider must be codex or all. ${getCodexReplSessionsUsage()}`,
          )
        }
        options.provider = nextValue
        index += 1
        break
      case '--query':
        if (!nextValue) {
          throw new Error(
            `Codex REPL /sessions ${token} requires a keyword value. ${getCodexReplSessionsUsage()}`,
          )
        }
        options.query = nextValue
        index += 1
        break
      case '--page':
        if (!nextValue) {
          throw new Error(
            `Codex REPL /sessions ${token} requires a numeric value. ${getCodexReplSessionsUsage()}`,
          )
        }
        options.page = parsePositiveInteger(nextValue, '--page')
        index += 1
        break
      case '--page-size':
        if (!nextValue) {
          throw new Error(
            `Codex REPL /sessions ${token} requires a numeric value. ${getCodexReplSessionsUsage()}`,
          )
        }
        options.pageSize = parsePositiveInteger(nextValue, '--page-size')
        index += 1
        break
      default:
        throw new Error(
          `Unknown Codex REPL /sessions option "${token}". ${getCodexReplSessionsUsage()}`,
        )
    }
  }

  if (options.pageSize > CODEX_REPL_SESSIONS_MAX_PAGE_SIZE) {
    throw new Error(
      `Codex REPL /sessions --page-size must be between 1 and ${CODEX_REPL_SESSIONS_MAX_PAGE_SIZE}. ${getCodexReplSessionsUsage()}`,
    )
  }

  return options
}

function matchesCodexReplSessionsQuery(args: {
  record: ReturnType<typeof listCodexReplStates>['records'][number]
  query?: string
}): boolean {
  const query = args.query?.trim().toLowerCase()
  if (!query) {
    return true
  }

  const fields = [
    args.record.state.stateId,
    args.record.state.cwd,
    getCodexReplPersistedModel(args.record.state),
  ]

  return fields.some(
    value => typeof value === 'string' && value.toLowerCase().includes(query),
  )
}

function buildCodexReplSessionsView(args: {
  options: CodexReplSessionsCommandOptions
  currentCwd?: string
}): CodexReplSessionsView {
  const { records: allRecords, skippedBrokenCount } = listCodexReplStates({
    limit: Number.MAX_SAFE_INTEGER,
  })

  const filteredRecords = allRecords.filter(record => {
    if (args.options.cwd && record.state.cwd !== args.options.cwd) {
      return false
    }

    if (args.options.provider === 'codex' || args.options.provider === 'all') {
      return matchesCodexReplSessionsQuery({
        record,
        query: args.options.query,
      })
    }

    return false
  })

  const currentCwdPriorityApplied = Boolean(
    args.currentCwd && !args.options.cwd && filteredRecords.length > 0,
  )
  const sortedRecords = [...filteredRecords].sort((left, right) => {
    if (currentCwdPriorityApplied) {
      const leftMatches = left.state.cwd === args.currentCwd
      const rightMatches = right.state.cwd === args.currentCwd
      if (leftMatches !== rightMatches) {
        return leftMatches ? -1 : 1
      }
    }

    const leftTime =
      Date.parse(left.state.updatedAt ?? left.state.createdAt ?? '') || 0
    const rightTime =
      Date.parse(right.state.updatedAt ?? right.state.createdAt ?? '') || 0

    if (leftTime !== rightTime) {
      return rightTime - leftTime
    }

    return (right.state.stateId ?? '').localeCompare(left.state.stateId ?? '')
  })

  const totalRecords = sortedRecords.length
  const totalPages = Math.max(
    1,
    Math.ceil(totalRecords / args.options.pageSize),
  )
  if (args.options.page > totalPages) {
    throw new Error(
      `Codex REPL /sessions page ${args.options.page} is out of range. There ${totalPages === 1 ? 'is' : 'are'} only ${totalPages} page${totalPages === 1 ? '' : 's'} for ${totalRecords} matching session${totalRecords === 1 ? '' : 's'}.`,
    )
  }

  const startIndex = (args.options.page - 1) * args.options.pageSize
  const pageRecords = sortedRecords.slice(
    startIndex,
    startIndex + args.options.pageSize,
  )

  if (totalRecords === 0 && !args.options.cwd && !args.options.query) {
    return {
      lines: ['Recent persisted Codex REPL sessions: none'],
    }
  }

  const lines = [
    `Recent persisted Codex REPL sessions: ${totalRecords}`,
    `Page: ${args.options.page}/${totalPages} page-size=${args.options.pageSize}`,
    `Current directory priority: ${currentCwdPriorityApplied ? `applied (${args.currentCwd})` : 'not applied'}`,
    `Filters: provider=${args.options.provider}${args.options.cwd ? ` cwd=${args.options.cwd}` : ''}${args.options.query ? ` query=${args.options.query}` : ''}`,
  ]

  if (skippedBrokenCount > 0) {
    lines.push(`skipped-broken-count=${skippedBrokenCount}`)
  }

  if (totalRecords === 0) {
    lines.push('No persisted Codex REPL sessions matched the current filters.')
    return { lines }
  }

  for (const record of pageRecords) {
    lines.push(
      `- ${record.state.stateId ?? 'unknown'} cwd=${record.state.cwd ?? 'unknown'} time=${record.state.updatedAt ?? record.state.createdAt ?? 'unknown'} model=${getCodexReplPersistedModel(record.state) ?? 'unknown'}`,
    )
  }

  return { lines }
}

function formatCodexReplFunctionToolLine(args: {
  visibility: ReturnType<typeof analyzeCodexFunctionToolVisibility>[number]
  runtime?: CodexToolRuntime
}): string {
  const source =
    args.visibility.tool.name === TOOL_SEARCH_TOOL_NAME
      ? 'tool-search'
      : args.visibility.tool.isMcp
        ? 'mcp-bridge'
        : 'local'
  const flags = [
    `source=${source}`,
    isDeferredTool(args.visibility.tool) ? 'deferred' : null,
    args.visibility.discovered ? 'discovered' : null,
    args.visibility.discovered && isDeferredTool(args.visibility.tool)
      ? `recovered=${args.visibility.recovered ? 'true' : 'false'}`
      : null,
    `decision=${args.visibility.selected ? 'selected' : 'hidden'}`,
    `selection-reason=${formatCodexReplToolDecisionReason(args.visibility.reason)}`,
  ].filter((value): value is string => value !== null)
  const segments = flags.length > 0 ? [flags.join(', ')] : []

  if (args.visibility.tool.isMcp) {
    const client = findCodexReplMcpClient({
      runtime: args.runtime,
      serverName: args.visibility.tool.mcpInfo?.serverName,
    })
    const diagnostics = buildCodexReplBridgeDiagnosticFields(client)

    segments.push(`server=${args.visibility.tool.mcpInfo?.serverName ?? 'unknown'}`)
    segments.push(`tool=${args.visibility.tool.mcpInfo?.toolName ?? args.visibility.tool.name}`)

    if (client) {
      segments.push(`status=${client.type}`)
      segments.push(...formatCodexReplMcpConfigSegments(client))
      if (client.type === 'connected') {
        segments.push(`capabilities=${formatCodexReplMcpCapabilities(client)}`)
      } else {
        const reason = formatCodexReplMcpFailureReason(client)
        if (reason) {
          segments.push(`reason=${reason}`)
        }
      }
    } else {
      segments.push('status=unavailable')
      segments.push('reason=bridge server not connected')
    }

    segments.push(`endpoint=${diagnostics.endpoint}`)
    if (client?.type !== 'connected') {
      segments.push(`capabilities=${diagnostics.capabilities}`)
    }
    if (client?.type === 'connected') {
      segments.push(`reason=${diagnostics.reason}`)
    }
    segments.push(`hint=${diagnostics.hint}`)
  }

  return `- ${args.visibility.tool.name} [${source}]${segments.length > 0 ? ` ${segments.join(' ')}` : ''}`
}

function summarizeCodexReplFunctionTools(args: {
  runtime?: CodexToolRuntime
  discoveredToolNames: Set<string>
  discoveredToolSignatures: Map<string, string>
}): string[] {
  const tools = args.runtime?.tools ?? []
  if (tools.length === 0) {
    return ['Function tools exposed: none']
  }

  const visibilities = analyzeCodexFunctionToolVisibility(tools, args.runtime, {
    discoveredToolNames: args.discoveredToolNames,
    discoveredToolSignatures: args.discoveredToolSignatures,
  })
  const selectedTools = visibilities.filter(visibility => visibility.selected)
  if (selectedTools.length === 0) {
    return ['Function tools exposed: none']
  }

  const lines = [`Function tools exposed: ${selectedTools.length}`]
  for (const visibility of selectedTools) {
    lines.push(
      formatCodexReplFunctionToolLine({
        visibility,
        runtime: args.runtime,
      }),
    )
  }

  const hiddenTools = visibilities.filter(visibility => !visibility.selected)
  if (hiddenTools.length > 0) {
    lines.push(
      `Deferred/hidden tools: ${hiddenTools.length}`,
    )
    for (const visibility of hiddenTools) {
      lines.push(
        formatCodexReplFunctionToolLine({
          visibility,
          runtime: args.runtime,
        }),
      )
    }
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
      args.writeLine(
        '- /sessions [options] List recent persisted conversation states with filtering and pagination',
      )
      args.writeLine(
        `  ${getCodexReplSessionsUsage()}`,
      )
      args.writeLine('- /status Show provider, session, and MCP status')
      args.writeLine(
        '- /resume [state-id] Load persisted conversation state for the current directory or an explicit state id',
      )
      args.writeLine('  Usage: /resume [state-id]')
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
      try {
        const options = parseCodexReplSessionsCommandOptions(command.argText)
        const view = buildCodexReplSessionsView({
          options,
          currentCwd: args.session.cwd,
        })
        for (const line of view.lines) {
          args.writeLine(line)
        }
      } catch (error) {
        args.writeError(formatCodexReplError(error))
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
        const resumeResolution = command.argText
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

        args.session.replaceConversationState(resumeResolution.state)
        args.session.setGlobalFallbackStatusLine(
          resumeResolution.globalFallback,
        )
        args.persistState(args.session.state)
        args.writeLine(
          formatCodexReplResumeSuccessMessage({
            state: args.session.state,
            sourceCwd: resumeResolution.sourceCwd,
          }),
        )
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

export function resolveInitialConversationState({
  replProps,
}: {
  replProps: REPLProps
}): CodexReplInitialStateResolution {
  const providerContext = replProps.providerContext
  const cwd = providerContext?.cwd

  if (providerContext?.resume === true) {
    throw new Error(getCodexReplInteractiveResumePickerUnsupportedMessage())
  }

  let state: CodexReplPersistedState | null = null
  let globalFallback:
    | {
        sourceCwd: string
        requestedCwd: string
      }
    | undefined

  if (typeof providerContext?.resume === 'string') {
    state = resolveCodexReplPersistedStateForResume({
      stateId: providerContext.resume,
    }).state
  } else if (providerContext?.continue) {
    if (!cwd) {
      throw new Error(getCodexReplContinueMissingCwdMessage())
    }

    const resolution = resolveCodexReplPersistedStateForResume({
      cwd,
    })
    state = resolution.state
    globalFallback = resolution.globalFallback
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
    state: {
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
    },
    globalFallback,
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
  private globalFallbackStatusLine?: string
  private readonly discoveredToolNames: Set<string>
  private readonly discoveredToolSignatures: Map<string, string>

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
    const discoveredToolState = getCodexDiscoveredToolState(
      this.options.conversationState,
    )
    this.discoveredToolNames = discoveredToolState.names
    this.discoveredToolSignatures = discoveredToolState.signatures
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

  setGlobalFallbackStatusLine(
    fallback?: {
      sourceCwd: string
      requestedCwd: string
    },
  ): void {
    this.globalFallbackStatusLine = fallback
      ? buildCodexReplGlobalFallbackStatusLine(fallback)
      : undefined
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
    this.discoveredToolSignatures.clear()
    const discoveredToolState = getCodexDiscoveredToolState(state)
    for (const toolName of discoveredToolState.names) {
      this.discoveredToolNames.add(toolName)
    }
    for (const [toolName, signature] of discoveredToolState.signatures) {
      this.discoveredToolSignatures.set(toolName, signature)
    }
  }

  startNewConversation(): CodexReplConversationState {
    const stateId = randomUUID()
    const createdAt = new Date().toISOString()

    this.discoveredToolNames.clear()
    this.discoveredToolSignatures.clear()
    this.globalFallbackStatusLine = undefined
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
    const hasCurrentWorkingDirectory = Boolean(this.cwd)
    const hasPersistedConversationState = Boolean(this.conversationState.lastResponseId)
    const lines = [
      'Provider: Codex',
      `Model: ${this.model}`,
      `API base URL: ${this.baseUrl}`,
      `Session id: ${this.conversationState.stateId ?? 'unavailable'}`,
      `Conversation id: ${this.conversationState.conversationId ?? 'unavailable'}`,
      `Current working directory: ${this.cwd ?? 'unavailable'}`,
      ...(this.globalFallbackStatusLine ? [this.globalFallbackStatusLine] : []),
      summarizeCodexReplPersistedConversationState(this.conversationState),
      buildCodexReplResumeHint({
        hasCurrentWorkingDirectory,
        hasPersistedConversationState,
      }),
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
      discoveredToolSignatures: this.discoveredToolSignatures,
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
      discoveredToolSignatures: this.discoveredToolSignatures,
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
                discoveredToolSignatures: this.discoveredToolSignatures,
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
          const currentSignatures = getCodexDiscoveredToolSignatureMap(
            this.options.runtime?.tools ?? [],
            this.options.runtime,
          )
          for (const toolName of execution.selectedToolNames) {
            this.discoveredToolNames.add(toolName)
            const signature = currentSignatures.get(toolName)
            if (signature) {
              this.discoveredToolSignatures.set(toolName, signature)
            }
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
        discoveredToolSignatures: this.discoveredToolSignatures,
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
      discoveredToolSignatures: this.discoveredToolSignatures,
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
  let initialConversationState: CodexReplInitialStateResolution
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
      conversationState: initialConversationState.state,
    })
    session.setGlobalFallbackStatusLine(initialConversationState.globalFallback)
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
