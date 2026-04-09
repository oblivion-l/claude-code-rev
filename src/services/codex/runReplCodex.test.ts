import { afterEach, describe, expect, it } from 'bun:test'
import {
  createCodexReplSession,
  type CodexReplTurnEvent,
  type CodexReplTurnResult,
} from './runReplCodex.js'

const originalEnv = {
  CLAUDE_CODE_USE_CODEX: process.env.CLAUDE_CODE_USE_CODEX,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  CODEX_MODEL: process.env.CODEX_MODEL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
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

async function collectTurn(
  session: ReturnType<typeof createCodexReplSession>,
  prompt: string,
): Promise<{
  events: CodexReplTurnEvent[]
  result: CodexReplTurnResult
}> {
  const iterator = session.submitTurn(prompt)
  const events: CodexReplTurnEvent[] = []

  for (;;) {
    const next = await iterator.next()
    if (next.done) {
      return {
        events,
        result: next.value,
      }
    }

    events.push(next.value)
  }
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

describe('createCodexReplSession', () => {
  it('streams a single successful turn', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'

    globalThis.fetch = async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body))
      expect(requestBody.previous_response_id).toBeUndefined()
      expect(requestBody.input).toBe('hello')

      return buildSseResponse([
        {
          type: 'response.output_text.delta',
          delta: 'Hello',
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_1',
            output_text: 'Hello',
            usage: {
              input_tokens: 3,
              output_tokens: 1,
            },
          },
        },
      ])
    }

    const session = createCodexReplSession()
    const { events, result } = await collectTurn(session, 'hello')

    expect(events).toEqual([
      {
        type: 'assistant.delta',
        delta: 'Hello',
      },
    ])
    expect(result.responseText).toBe('Hello')
    expect(result.responseId).toBe('resp_1')
    expect(result.conversationState.providerId).toBe('codex-repl')
    expect(result.conversationState.lastResponseId).toBe('resp_1')
    expect(result.conversationState.history).toHaveLength(1)
    expect(result.conversationState.history?.[0]?.responseId).toBe('resp_1')
  })

  it('reuses the previous response id on the next turn', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'

    const requestBodies: Record<string, unknown>[] = []
    let callCount = 0

    globalThis.fetch = async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body))
      requestBodies.push(requestBody)
      callCount += 1

      if (callCount === 1) {
        return buildSseResponse([
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              output_text: 'First turn',
              usage: {
                input_tokens: 2,
                output_tokens: 2,
              },
            },
          },
        ])
      }

      return buildSseResponse([
        {
          type: 'response.completed',
          response: {
            id: 'resp_2',
            output_text: 'Second turn',
            usage: {
              input_tokens: 4,
              output_tokens: 2,
            },
          },
        },
      ])
    }

    const session = createCodexReplSession()
    await collectTurn(session, 'first')
    const secondTurn = await collectTurn(session, 'second')

    expect(requestBodies[0]?.previous_response_id).toBeUndefined()
    expect(requestBodies[1]?.previous_response_id).toBe('resp_1')
    expect(secondTurn.result.conversationState.lastResponseId).toBe('resp_2')
  })

  it('starts from persisted state when a previous response id is provided', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'

    const requestBodies: Record<string, unknown>[] = []

    globalThis.fetch = async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body))
      requestBodies.push(requestBody)

      return buildSseResponse([
        {
          type: 'response.completed',
          response: {
            id: 'resp_after_resume',
            output_text: 'Resumed turn',
            usage: {
              input_tokens: 5,
              output_tokens: 2,
            },
          },
        },
      ])
    }

    const session = createCodexReplSession({
      cwd: '/tmp/repl-project',
      conversationState: {
        providerId: 'codex-repl',
        stateId: 'state_resume_1',
        cwd: '/tmp/repl-project',
        conversationId: 'state_resume_1',
        lastResponseId: 'resp_before_resume',
        history: [
          {
            assistantMessageUuid: 'msg_before_resume',
            responseId: 'resp_before_resume',
            createdAt: '2026-04-09T00:00:00.000Z',
          },
        ],
      },
    })

    const { result } = await collectTurn(session, 'resume me')

    expect(requestBodies[0]?.previous_response_id).toBe('resp_before_resume')
    expect(result.conversationState.stateId).toBe('state_resume_1')
    expect(result.conversationState.history).toHaveLength(2)
  })

  it('fails fast when OPENAI_API_KEY is missing', () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    delete process.env.OPENAI_API_KEY

    expect(() => createCodexReplSession()).toThrow(
      'Codex provider requires OPENAI_API_KEY when CLAUDE_CODE_USE_CODEX=1.',
    )
  })

  it('surfaces unsupported model errors from the API', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.CODEX_MODEL = 'gpt-unknown'

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'This model is not supported for realtime responses.',
            param: 'model',
            code: 'model_not_found',
          },
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )

    const session = createCodexReplSession()

    await expect(collectTurn(session, 'hello')).rejects.toThrow(
      'Codex model gpt-unknown is not supported for this request: This model is not supported for realtime responses.',
    )
  })
})
