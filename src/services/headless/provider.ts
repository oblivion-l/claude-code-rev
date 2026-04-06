import type { StructuredIO } from 'src/cli/structuredIO.js'

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
}

export type HeadlessProvider = {
  id: string
  capabilities: HeadlessProviderCapabilities
  run(args: HeadlessProviderRunArgs): Promise<HeadlessProviderRunResult>
}
