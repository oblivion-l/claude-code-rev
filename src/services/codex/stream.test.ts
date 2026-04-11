import { describe, expect, it } from 'bun:test'
import {
  extractCompletedResponse,
  extractResponseText,
  extractTextDelta,
  extractTextSnapshot,
  extractUsage,
  getCodexFailureMessage,
} from './stream.js'

describe('extractTextDelta', () => {
  it('reads output text deltas from response.output_text.delta events', () => {
    expect(
      extractTextDelta({
        type: 'response.output_text.delta',
        delta: 'hello',
      }),
    ).toBe('hello')
  })

  it('returns an empty string for non-text events', () => {
    expect(
      extractTextDelta({
        type: 'response.created',
      }),
    ).toBe('')
  })
})

describe('extractResponseText', () => {
  it('reads the convenience output_text field when present', () => {
    expect(
      extractResponseText({
        output_text: 'final answer',
      }),
    ).toBe('final answer')
  })

  it('falls back to output content arrays', () => {
    expect(
      extractResponseText({
        output: [
          {
            content: [
              { type: 'output_text', text: 'part 1' },
              { type: 'output_text', text: ' part 2' },
            ],
          },
        ],
      }),
    ).toBe('part 1 part 2')
  })
})

describe('extractTextSnapshot', () => {
  it('reads completed output_text snapshots', () => {
    expect(
      extractTextSnapshot({
        type: 'response.output_text.done',
        text: 'final answer',
      }),
    ).toBe('final answer')
  })

  it('reads completed output item snapshots when response.completed output is empty', () => {
    expect(
      extractTextSnapshot({
        type: 'response.output_item.done',
        item: {
          content: [
            {
              type: 'output_text',
              text: 'fallback answer',
            },
          ],
        },
      }),
    ).toBe('fallback answer')
  })
})

describe('extractCompletedResponse', () => {
  it('returns the completed response payload', () => {
    const response = { id: 'resp_123' }

    expect(
      extractCompletedResponse({
        type: 'response.completed',
        response,
      }),
    ).toBe(response)
  })
})

describe('extractUsage', () => {
  it('maps OpenAI token usage into the local usage shape', () => {
    expect(
      extractUsage({
        usage: {
          input_tokens: 12,
          output_tokens: 34,
        },
      }),
    ).toMatchObject({
      input_tokens: 12,
      output_tokens: 34,
    })
  })
})

describe('getCodexFailureMessage', () => {
  it('extracts top-level error messages', () => {
    expect(
      getCodexFailureMessage({
        type: 'error',
        error: {
          message: 'boom',
        },
      }),
    ).toBe('boom')
  })

  it('reports incomplete responses', () => {
    expect(
      getCodexFailureMessage({
        type: 'response.incomplete',
      }),
    ).toBe('Codex response ended before completion')
  })
})
