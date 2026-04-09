import type { StructuredIO } from 'src/cli/structuredIO.js'
import type { Command } from 'src/commands.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import type { AppState } from 'src/state/AppState.js'
import type { Tools } from 'src/Tool.js'
import type { AgentDefinition } from 'src/tools/AgentTool/loadAgentsDir.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'

export const HEADLESS_PROVIDER_ERROR_PREFIX = 'HEADLESS_PROVIDER'
export const HEADLESS_CONVERSATION_STATE_VERSION = 1

export type HeadlessProviderErrorCode =
  | `${typeof HEADLESS_PROVIDER_ERROR_PREFIX}_UNSUPPORTED_MODE`
  | `${typeof HEADLESS_PROVIDER_ERROR_PREFIX}_UNSUPPORTED_CAPABILITY`
  | `${typeof HEADLESS_PROVIDER_ERROR_PREFIX}_INVALID_INPUT`
  | `${typeof HEADLESS_PROVIDER_ERROR_PREFIX}_EXECUTION_ERROR`

export type HeadlessConversationState = {
  providerId: string
  version?: number
  stateId?: string
  cwd?: string
  createdAt?: string
  updatedAt?: string
  conversationId?: string
  lastResponseId?: string
  lastAssistantMessageUuid?: string
  history?: HeadlessConversationTurnState[]
  metadata?: Record<string, unknown>
}

export type HeadlessConversationTurnState = {
  assistantMessageUuid: string
  responseId: string
  createdAt: string
}

export type HeadlessProviderOptions = {
  continue: boolean | undefined
  resume: string | boolean | undefined
  resumeSessionAt: string | undefined
  outputFormat: string | undefined
  verbose: boolean | undefined
  jsonSchema: Record<string, unknown> | undefined
  systemPrompt: string | undefined
  appendSystemPrompt: string | undefined
  userSpecifiedModel: string | undefined
  sdkUrl: string | undefined
  replayUserMessages: boolean | undefined
  includePartialMessages: boolean | undefined
  forkSession: boolean | undefined
  rewindFiles: string | undefined
  agent: string | undefined
}

export type HeadlessProviderRunArgs = {
  inputPrompt: string | AsyncIterable<string>
  structuredIO: StructuredIO
  options: HeadlessProviderOptions
  conversationState?: HeadlessConversationState | null
  runtime?: HeadlessProviderRuntime
}

export type HeadlessProviderRunResult = {
  exitCode: number
  conversationState?: HeadlessConversationState | null
}

export type HeadlessProviderCapabilities = {
  supportsContinue: boolean
  supportsResume: boolean
  supportsStructuredOutput: boolean
  supportsConversationState: boolean
}

export type HeadlessProviderRuntime = {
  cwd: string
  commands: Command[]
  tools: Tools
  mcpClients: MCPServerConnection[]
  agents: AgentDefinition[]
  canUseTool: CanUseToolFn
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
}

export type HeadlessProviderMetadata = {
  id: string
  displayName: string
}

export type HeadlessProvider = {
  metadata: HeadlessProviderMetadata
  capabilities: HeadlessProviderCapabilities
  createConversationState?: () => HeadlessConversationState
  run(args: HeadlessProviderRunArgs): Promise<HeadlessProviderRunResult>
}
