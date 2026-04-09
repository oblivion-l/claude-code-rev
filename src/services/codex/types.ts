export type CodexRuntimeConfig = {
  apiKey: string
  baseUrl: string
  model: string
  organization?: string
  project?: string
}

export type CodexStructuredOutputFormat = {
  type: 'json_schema'
  name: string
  schema: Record<string, unknown>
  strict: true
}

export type CodexMcpTool = {
  type: 'mcp'
  server_label: string
  server_url: string
}

export type CodexFunctionTool = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type CodexFunctionCall = {
  name: string
  callId: string
  argumentsText: string
}

export type CodexFunctionCallOutput = {
  type: 'function_call_output'
  call_id: string
  output: string
}

export type CodexRequestTool = CodexMcpTool | CodexFunctionTool

export type CodexResponseInput = string | CodexFunctionCallOutput[]

export type CodexStreamEvent = {
  type: string
  [key: string]: unknown
}

export type CodexResponseUsage = {
  input_tokens?: number
  output_tokens?: number
}
