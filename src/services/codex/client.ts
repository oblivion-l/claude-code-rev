import type {
  CodexRequestTool,
  CodexResponseInput,
  CodexRuntimeConfig,
  CodexStreamEvent,
  CodexStructuredOutputFormat,
} from './types.js'
import {
  formatCodexApiError,
  tryParseCodexApiErrorBody,
} from './errors.js'
import { summarizeCodexRequestTooling } from './orchestration.js'

async function buildHttpError({
  response,
  model,
  usedStructuredOutput,
  tools,
}: {
  response: Response
  model: string
  usedStructuredOutput: boolean
  tools?: CodexRequestTool[]
}): Promise<Error> {
  const bodyText = await response.text()
  const parsed = tryParseCodexApiErrorBody(bodyText)
  const toolingUsage = summarizeCodexRequestTooling(tools ?? [])

  if (parsed) {
    return new Error(
      formatCodexApiError({
        status: response.status,
        body: parsed,
        model,
        usedStructuredOutput,
        usedMcpTools: toolingUsage.usedMcpTools,
        usedBridgedMcpTools: toolingUsage.usedBridgedMcpTools,
        usedFunctionTools: toolingUsage.usedFunctionTools,
      }),
    )
  }

  const detail = bodyText.trim() || response.statusText || 'Unknown error'
  return new Error(`Codex API error (${response.status}): ${detail}`)
}

export async function createCodexResponseStream({
  config,
  input,
  instructions,
  previousResponseId,
  structuredOutputFormat,
  tools,
  signal,
}: {
  config: CodexRuntimeConfig
  input: CodexResponseInput
  instructions?: string
  previousResponseId?: string
  structuredOutputFormat?: CodexStructuredOutputFormat
  tools?: CodexRequestTool[]
  signal?: AbortSignal
}): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }

  if (config.organization) {
    headers['OpenAI-Organization'] = config.organization
  }

  if (config.project) {
    headers['OpenAI-Project'] = config.project
  }

  const response = await fetch(`${config.baseUrl}/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      input,
      stream: true,
      ...(previousResponseId
        ? {
            previous_response_id: previousResponseId,
          }
        : {}),
      ...(structuredOutputFormat
        ? {
            text: {
              format: structuredOutputFormat,
            },
          }
        : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(instructions ? { instructions } : {}),
    }),
    signal,
  })

  if (!response.ok) {
    throw await buildHttpError({
      response,
      model: config.model,
      usedStructuredOutput: Boolean(structuredOutputFormat),
      tools,
    })
  }

  if (!response.body) {
    throw new Error('Codex API returned an empty response body')
  }

  return response
}

export async function* parseCodexSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<CodexStreamEvent, void, unknown> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        const dataLines = frame
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())

        if (dataLines.length > 0) {
          const data = dataLines.join('\n')
          if (data !== '[DONE]') {
            yield JSON.parse(data) as CodexStreamEvent
          }
        }

        boundary = buffer.indexOf('\n\n')
      }

      if (done) {
        break
      }
    }

    const trailing = buffer.trim()
    if (!trailing) {
      return
    }

    const dataLines = trailing
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())

    if (dataLines.length === 0) {
      return
    }

    const data = dataLines.join('\n')
    if (data !== '[DONE]') {
      yield JSON.parse(data) as CodexStreamEvent
    }
  } finally {
    reader.releaseLock()
  }
}
