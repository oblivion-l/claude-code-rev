import { afterEach, describe, expect, it } from 'bun:test'
import {
  runHeadlessCodex,
} from './runHeadlessCodex.js'

const originalEnv = {
  CLAUDE_CODE_USE_CODEX: process.env.CLAUDE_CODE_USE_CODEX,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  CODEX_MODEL: process.env.CODEX_MODEL,
}

const originalFetch = globalThis.fetch

function buildSseResponse(events: unknown[]): Response {
  const body = events
    .map(event => `data: ${JSON.stringify(event)}\n\n`)
    .join('')

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('runHeadlessCodex', () => {
  it('falls back to done snapshots when response.completed has no output text', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'

    globalThis.fetch = async () =>
      buildSseResponse([
        {
          type: 'response.output_item.done',
          item: {
            id: 'msg_1',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'OK',
              },
            ],
          },
          output_index: 0,
          sequence_number: 0,
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_1',
            output: [],
            usage: {
              input_tokens: 3,
              output_tokens: 1,
            },
          },
          sequence_number: 1,
        },
      ])

    const writes: unknown[] = []
    const structuredIO = {
      write: async (message: unknown) => {
        writes.push(message)
      },
    }

    const result = await runHeadlessCodex({
      inputPrompt: 'Reply with OK only.',
      structuredIO: structuredIO as any,
      options: {
        outputFormat: 'stream-json',
      } as any,
    })

    expect(result.exitCode).toBe(0)
    expect(result.conversationState?.lastResponseId).toBe('resp_1')
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'result',
        subtype: 'success',
        result: 'OK',
      }),
    )
  })
})
