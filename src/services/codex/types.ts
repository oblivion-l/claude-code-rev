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

export type CodexStreamEvent = {
  type: string
  [key: string]: unknown
}

export type CodexResponseUsage = {
  input_tokens?: number
  output_tokens?: number
}
