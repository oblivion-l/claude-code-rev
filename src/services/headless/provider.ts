import type { StructuredIO } from 'src/cli/structuredIO.js'

export const HEADLESS_PROVIDER_ERROR_PREFIX = 'HEADLESS_PROVIDER'

export type HeadlessProviderErrorCode =
  | `${typeof HEADLESS_PROVIDER_ERROR_PREFIX}_UNSUPPORTED_MODE`
  | `${typeof HEADLESS_PROVIDER_ERROR_PREFIX}_UNSUPPORTED_CAPABILITY`
  | `${typeof HEADLESS_PROVIDER_ERROR_PREFIX}_INVALID_INPUT`
  | `${typeof HEADLESS_PROVIDER_ERROR_PREFIX}_EXECUTION_ERROR`

export type HeadlessConversationState = {
  providerId: string
  conversationId?: string
  lastResponseId?: string
  metadata?: Record<string, unknown>
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
}

export type HeadlessProviderRunResult = {
  exitCode: number
}

export type HeadlessProviderCapabilities = {
  supportsResume: boolean
  supportsStructuredOutput: boolean
  supportsConversationState: boolean
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
