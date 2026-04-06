import { EMPTY_USAGE } from 'src/services/api/logging.js'
import type { NonNullableUsage } from '../../entrypoints/sdk/sdkUtilityTypes.js'
import type {
  CodexResponseUsage,
  CodexStreamEvent,
} from './types.js'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null
}

function readTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map(item => {
      if (!isObject(item)) {
        return ''
      }

      if (typeof item.text === 'string') {
        return item.text
      }

      if (
        isObject(item.text) &&
        typeof item.text.value === 'string'
      ) {
        return item.text.value
      }

      return ''
    })
    .join('')
}

export function extractTextDelta(event: CodexStreamEvent): string {
  if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
    return event.delta
  }

  if (
    event.type === 'response.content_part.added' &&
    isObject(event.part) &&
    typeof event.part.text === 'string'
  ) {
    return event.part.text
  }

  return ''
}

export function extractResponseText(response: unknown): string {
  if (!isObject(response)) {
    return ''
  }

  if (typeof response.output_text === 'string') {
    return response.output_text
  }

  if (!Array.isArray(response.output)) {
    return ''
  }

  return response.output
    .map(item => {
      if (!isObject(item)) {
        return ''
      }

      if (typeof item.text === 'string') {
        return item.text
      }

      return readTextContent(item.content)
    })
    .join('')
}

function getUsageObject(response: unknown): CodexResponseUsage | undefined {
  if (!isObject(response) || !isObject(response.usage)) {
    return undefined
  }

  return response.usage as CodexResponseUsage
}

export function extractUsage(response: unknown): NonNullableUsage {
  const usage = getUsageObject(response)

  return {
    ...EMPTY_USAGE,
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
  } as NonNullableUsage
}

export function extractCompletedResponse(
  event: CodexStreamEvent,
): unknown | undefined {
  if (event.type === 'response.completed' && 'response' in event) {
    return event.response
  }

  return undefined
}

export function extractResponseId(response: unknown): string | undefined {
  if (
    response &&
    typeof response === 'object' &&
    'id' in response &&
    typeof response.id === 'string'
  ) {
    return response.id
  }

  return undefined
}

export function getCodexFailureMessage(event: CodexStreamEvent): string | null {
  if (
    event.type === 'error' &&
    isObject(event.error) &&
    typeof event.error.message === 'string'
  ) {
    return event.error.message
  }

  if (
    event.type === 'response.failed' &&
    isObject(event.response) &&
    isObject(event.response.error) &&
    typeof event.response.error.message === 'string'
  ) {
    return event.response.error.message
  }

  if (event.type === 'response.incomplete') {
    return 'Codex response ended before completion'
  }

  return null
}
