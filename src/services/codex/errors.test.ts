import { describe, expect, it } from 'bun:test'
import {
  formatCodexApiError,
  tryParseCodexApiErrorBody,
} from './errors.js'

describe('tryParseCodexApiErrorBody', () => {
  it('parses JSON error bodies', () => {
    expect(
      tryParseCodexApiErrorBody(
        '{"error":{"message":"Unsupported parameter","param":"text.format","code":"unsupported_parameter"}}',
      ),
    ).toEqual({
      error: {
        message: 'Unsupported parameter',
        param: 'text.format',
        code: 'unsupported_parameter',
      },
    })
  })

  it('returns null for invalid JSON', () => {
    expect(tryParseCodexApiErrorBody('not-json')).toBeNull()
  })
})

describe('formatCodexApiError', () => {
  it('formats model support rejections clearly', () => {
    expect(
      formatCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'The model gpt-4o-mini does not support this feature',
            param: 'model',
          },
        },
        model: 'gpt-4o-mini',
        usedStructuredOutput: false,
        usedMcpTools: false,
      }),
    ).toContain('Codex model gpt-4o-mini is not supported for this request')
  })

  it('formats structured output parameter rejections clearly', () => {
    expect(
      formatCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Unsupported parameter: text.format',
            param: 'text.format',
            code: 'unsupported_parameter',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: true,
        usedMcpTools: false,
      }),
    ).toContain('Codex structured outputs are not supported for model gpt-5-codex')
  })

  it('formats generic structured output request rejections clearly', () => {
    expect(
      formatCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Invalid schema for text.format',
            type: 'invalid_request_error',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: true,
        usedMcpTools: false,
      }),
    ).toContain('Codex structured output request was rejected by the API for model gpt-5-codex')
  })

  it('formats MCP tool rejections clearly', () => {
    expect(
      formatCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Unsupported parameter: tools[0].type',
            param: 'tools[0].type',
            code: 'unsupported_parameter',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: false,
        usedMcpTools: true,
      }),
    ).toContain('Codex MCP tools are not supported for model gpt-5-codex')
  })

  it('falls back to a generic API error when no special case matches', () => {
    expect(
      formatCodexApiError({
        status: 429,
        body: {
          error: {
            message: 'Rate limit exceeded',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: false,
        usedMcpTools: false,
      }),
    ).toBe('Codex API error (429): Rate limit exceeded')
  })
})
