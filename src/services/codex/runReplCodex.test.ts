import { afterEach, describe, expect, it } from 'bun:test'
import { z } from 'zod/v4'
import { getEmptyToolPermissionContext, type Tool } from 'src/Tool.js'
import {
  createCodexReplSession,
  type CodexReplTurnEvent,
  type CodexReplTurnResult,
} from './runReplCodex.js'
import type { CodexToolRuntime } from './toolRuntime.js'

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

function createFakeTool(name: string): Tool {
  return {
    name,
    inputSchema: z.object({
      path: z.string().optional(),
      query: z.string().optional(),
      file_path: z.string().optional(),
      content: z.string().optional(),
    }),
    async call(input) {
      return {
        data: {
          ok:
            input.path ??
            input.file_path ??
            input.query ??
            input.content ??
            'done',
        },
      }
    },
    async description() {
      return `${name} description`
    },
    async prompt() {
      return `${name} prompt`
    },
    async checkPermissions() {
      return {
        behavior: 'allow',
        updatedInput: undefined,
        decisionReason: {
          type: 'mode',
          mode: 'default',
        },
      }
    },
    isConcurrencySafe() {
      return false
    },
    isEnabled() {
      return true
    },
    isReadOnly() {
      return true
    },
    userFacingName() {
      return name
    },
    toAutoClassifierInput() {
      return ''
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: JSON.stringify(content),
      }
    },
    renderToolUseMessage() {
      return null
    },
    maxResultSizeChars: 1000,
  } as unknown as Tool
}

function createFakeRuntime(
  tools: Tool[],
): CodexToolRuntime {
  let appState: any = {
    toolPermissionContext: getEmptyToolPermissionContext(),
    fileHistory: {},
    attribution: {},
  }

  return {
    cwd: '/tmp/project',
    commands: [],
    tools,
    mcpClients: [],
    agents: [],
    canUseTool: async () => ({
      behavior: 'allow',
      updatedInput: undefined,
      decisionReason: {
        type: 'mode',
        mode: 'default',
      },
    }),
    getAppState: () => appState,
    setAppState: updater => {
      appState = updater(appState)
    },
  }
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

  it('passes mapped MCP tools through to the Codex API request', async () => {
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
            id: 'resp_with_mcp',
            output_text: 'Used MCP',
            usage: {
              input_tokens: 6,
              output_tokens: 2,
            },
          },
        },
      ])
    }

    const session = createCodexReplSession({
      mcpTools: [
        {
          type: 'mcp',
          server_label: 'docs',
          server_url: 'https://example.com/mcp',
        },
      ],
    })

    await collectTurn(session, 'use docs')

    expect(requestBodies[0]?.tools).toEqual([
      {
        type: 'mcp',
        server_label: 'docs',
        server_url: 'https://example.com/mcp',
      },
    ])
  })

  it('executes local function tools through the shared Codex runtime', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'

    const readTool = createFakeTool('Read')
    const requestBodies: Record<string, unknown>[] = []
    let requestCount = 0

    globalThis.fetch = async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body))
      requestBodies.push(requestBody)
      requestCount += 1

      if (requestCount === 1) {
        return buildSseResponse([
          {
            type: 'response.completed',
            response: {
              id: 'resp_tool_round',
              output: [
                {
                  type: 'function_call',
                  name: 'Read',
                  call_id: 'call_read_1',
                  arguments: '{"path":"src/index.ts"}',
                },
              ],
              usage: {
                input_tokens: 7,
                output_tokens: 3,
              },
            },
          },
        ])
      }

      return buildSseResponse([
        {
          type: 'response.completed',
          response: {
            id: 'resp_final',
            output_text: 'Read complete',
            usage: {
              input_tokens: 4,
              output_tokens: 2,
            },
          },
        },
      ])
    }

    const session = createCodexReplSession({
      runtime: createFakeRuntime([readTool]),
    })

    const { result } = await collectTurn(session, 'inspect project')

    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]?.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'Read',
      }),
    ])
    expect(requestBodies[1]?.previous_response_id).toBe('resp_tool_round')
    expect(requestBodies[1]?.input).toEqual([
      {
        type: 'function_call_output',
        call_id: 'call_read_1',
        output: '{"ok":"src/index.ts"}',
      },
    ])
    expect(result.responseText).toBe('Read complete')
    expect(result.responseId).toBe('resp_final')
    expect(result.usage.input_tokens).toBe(11)
    expect(result.usage.output_tokens).toBe(5)
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

  it('surfaces MCP parameter errors from the API clearly', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'Unsupported parameter: tools[0].type',
            param: 'tools[0].type',
            code: 'unsupported_parameter',
          },
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )

    const session = createCodexReplSession({
      mcpTools: [
        {
          type: 'mcp',
          server_label: 'docs',
          server_url: 'https://example.com/mcp',
        },
      ],
    })

    await expect(collectTurn(session, 'hello')).rejects.toThrow(
      'Codex MCP tools are not supported for model gpt-5-codex or this API parameter set: Unsupported parameter: tools[0].type',
    )
  })
})
