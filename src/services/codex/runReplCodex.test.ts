import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import { getEmptyToolPermissionContext, type Tool } from 'src/Tool.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import { ToolSearchTool } from 'src/tools/ToolSearchTool/ToolSearchTool.js'
import { resetHooksConfigSnapshot } from 'src/utils/hooks/hooksConfigSnapshot.js'
import {
  createCodexReplSession,
  handleCodexReplPrompt,
  type CodexReplTurnEvent,
  type CodexReplTurnResult,
} from './runReplCodex.js'
import { setCodexReplState } from './replState.js'
import type { CodexToolRuntime } from './toolRuntime.js'

const originalEnv = {
  CLAUDE_CODE_USE_CODEX: process.env.CLAUDE_CODE_USE_CODEX,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_SIMPLE: process.env.CLAUDE_CODE_SIMPLE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  CODEX_MODEL: process.env.CODEX_MODEL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  ENABLE_TOOL_SEARCH: process.env.ENABLE_TOOL_SEARCH,
  CLAUDE_CODE_HEADLESS_STATE_DIR: process.env.CLAUDE_CODE_HEADLESS_STATE_DIR,
}

const originalFetch = globalThis.fetch
let configDir: string

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

function createFakeTool(
  name: string,
  overrides?: Partial<Tool>,
): Tool {
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
    ...overrides,
  } as unknown as Tool
}

function createFakeRuntime(
  tools: Tool[],
  mcpClients: MCPServerConnection[] = [],
): CodexToolRuntime {
  let appState: any = {
    toolPermissionContext: getEmptyToolPermissionContext(),
    fileHistory: {},
    attribution: {},
    sessionHooks: new Map(),
  }

  return {
    cwd: '/tmp/project',
    commands: [],
    tools,
    mcpClients,
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

function createConnectedMcpClient(
  name: string,
  overrides?: Partial<Extract<MCPServerConnection, { type: 'connected' }>>,
): MCPServerConnection {
  return {
    name,
    type: 'connected',
    capabilities: {
      tools: {},
    },
    client: {} as never,
    cleanup: async () => {},
    config: {
      command: 'node',
      args: ['server.js'],
      scope: 'user',
    },
    ...overrides,
  }
}

function createFailedMcpClient(
  name: string,
  error = 'connection failed',
  overrides?: Partial<Extract<MCPServerConnection, { type: 'failed' }>>,
): MCPServerConnection {
  return {
    name,
    type: 'failed',
    error,
    config: {
      type: 'http',
      url: 'https://example.com/mcp',
      scope: 'user',
    },
    ...overrides,
  }
}

function expectLineToContainDiagnosticKeys(
  line: string | undefined,
  keys: string[],
): void {
  expect(line).toBeDefined()
  for (const key of keys) {
    expect(line).toContain(`${key}=`)
  }
}

function expectLineToContainDiagnostics(
  line: string | undefined,
  diagnostics: Record<string, string>,
): void {
  expect(line).toBeDefined()
  for (const [key, value] of Object.entries(diagnostics)) {
    expect(line).toContain(`${key}=${value}`)
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
  resetHooksConfigSnapshot()

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  if (configDir) {
    rmSync(configDir, { recursive: true, force: true })
  }
})

describe('createCodexReplSession', () => {
  it('streams a single successful turn', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

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
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

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
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

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
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

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

  it('loads deferred bridged MCP tools after ToolSearch selection', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.ENABLE_TOOL_SEARCH = 'true'
    resetHooksConfigSnapshot()

    const bridgedMcpTool = createFakeTool('mcp__docs__search', {
      isMcp: true,
      mcpInfo: {
        serverName: 'docs',
        toolName: 'search',
      },
      async description() {
        return 'docs search description'
      },
      async prompt() {
        return 'docs search prompt'
      },
    })

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
              id: 'resp_search',
              output: [
                {
                  type: 'function_call',
                  name: 'ToolSearch',
                  call_id: 'call_tool_search',
                  arguments: '{"query":"select:mcp__docs__search"}',
                },
              ],
              usage: {
                input_tokens: 5,
                output_tokens: 2,
              },
            },
          },
        ])
      }

      if (requestCount === 2) {
        return buildSseResponse([
          {
            type: 'response.completed',
            response: {
              id: 'resp_mcp_tool',
              output: [
                {
                  type: 'function_call',
                  name: 'mcp__docs__search',
                  call_id: 'call_docs_search',
                  arguments: '{"query":"bun install"}',
                },
              ],
              usage: {
                input_tokens: 6,
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
            id: 'resp_final',
            output_text: 'Search complete',
            usage: {
              input_tokens: 4,
              output_tokens: 2,
            },
          },
        },
      ])
    }

    const session = createCodexReplSession({
      runtime: createFakeRuntime(
        [ToolSearchTool, bridgedMcpTool],
        [createConnectedMcpClient('docs')],
      ),
    })

    const { result } = await collectTurn(session, 'find docs tool')

    expect(requestBodies).toHaveLength(3)
    expect(requestBodies[0]?.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'ToolSearch',
      }),
    ])
    expect(requestBodies[1]?.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'mcp__docs__search',
      }),
      expect.objectContaining({
        type: 'function',
        name: 'ToolSearch',
      }),
    ])
    expect(requestBodies[2]?.input).toEqual([
      {
        type: 'function_call_output',
        call_id: 'call_docs_search',
        output: '{"ok":"bun install"}',
      },
    ])
    expect(result.responseText).toBe('Search complete')
    expect(result.responseId).toBe('resp_final')
  })

  it('reuses discovered deferred tools on the next REPL turn', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.ENABLE_TOOL_SEARCH = 'true'
    resetHooksConfigSnapshot()

    const bridgedMcpTool = createFakeTool('mcp__docs__search', {
      isMcp: true,
      mcpInfo: {
        serverName: 'docs',
        toolName: 'search',
      },
    })

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
              id: 'resp_search',
              output: [
                {
                  type: 'function_call',
                  name: 'ToolSearch',
                  call_id: 'call_tool_search',
                  arguments: '{"query":"select:mcp__docs__search"}',
                },
              ],
              usage: {
                input_tokens: 5,
                output_tokens: 2,
              },
            },
          },
        ])
      }

      if (requestCount === 2) {
        return buildSseResponse([
          {
            type: 'response.completed',
            response: {
              id: 'resp_first_done',
              output_text: 'Discovery stored',
              usage: {
                input_tokens: 4,
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
            id: 'resp_second_turn',
            output_text: 'Second turn ready',
            usage: {
              input_tokens: 3,
              output_tokens: 2,
            },
          },
        },
      ])
    }

    const session = createCodexReplSession({
      runtime: createFakeRuntime(
        [ToolSearchTool, bridgedMcpTool],
        [createConnectedMcpClient('docs')],
      ),
    })

    const firstTurn = await collectTurn(session, 'discover docs')
    const secondTurn = await collectTurn(session, 'use remembered docs')

    expect(firstTurn.result.conversationState.metadata).toEqual(
      expect.objectContaining({
        codexDiscoveredToolNames: ['mcp__docs__search'],
      }),
    )
    expect(requestBodies[2]?.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'mcp__docs__search',
      }),
      expect.objectContaining({
        type: 'function',
        name: 'ToolSearch',
      }),
    ])
    expect(secondTurn.result.responseText).toBe('Second turn ready')
  })

  it('starts from persisted state when a previous response id is provided', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

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
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    delete process.env.OPENAI_API_KEY
    resetHooksConfigSnapshot()

    expect(() => createCodexReplSession()).toThrow(
      'Codex provider requires OPENAI_API_KEY when CLAUDE_CODE_USE_CODEX=1.',
    )
  })

  it('surfaces unsupported model errors from the API', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.CODEX_MODEL = 'gpt-unknown'
    resetHooksConfigSnapshot()

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
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

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

  it('retains discovered tool state when a later REPL round fails', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.ENABLE_TOOL_SEARCH = 'true'
    resetHooksConfigSnapshot()

    const bridgedMcpTool = createFakeTool('mcp__docs__search', {
      isMcp: true,
      mcpInfo: {
        serverName: 'docs',
        toolName: 'search',
      },
    })

    let requestCount = 0
    globalThis.fetch = async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body))
      requestCount += 1

      if (requestCount === 1) {
        expect(requestBody.tools).toEqual([
          expect.objectContaining({
            type: 'function',
            name: 'ToolSearch',
          }),
        ])

        return buildSseResponse([
          {
            type: 'response.completed',
            response: {
              id: 'resp_search',
              output: [
                {
                  type: 'function_call',
                  name: 'ToolSearch',
                  call_id: 'call_tool_search',
                  arguments: '{"query":"select:mcp__docs__search"}',
                },
              ],
              usage: {
                input_tokens: 5,
                output_tokens: 2,
              },
            },
          },
        ])
      }

      expect(requestBody.tools).toEqual([
        expect.objectContaining({
          type: 'function',
          name: 'mcp__docs__search',
        }),
        expect.objectContaining({
          type: 'function',
          name: 'ToolSearch',
        }),
      ])

      return new Response(
        JSON.stringify({
          error: {
            message: 'Unsupported parameter: tools[1].type',
            param: 'tools[1].type',
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
    }

    const session = createCodexReplSession({
      runtime: createFakeRuntime(
        [ToolSearchTool, bridgedMcpTool],
        [createConnectedMcpClient('docs')],
      ),
    })

    await expect(collectTurn(session, 'discover docs then fail')).rejects.toThrow(
      'Codex locally bridged MCP tools are not supported for model gpt-5-codex or this API parameter set: Unsupported parameter: tools[1].type',
    )

    expect(session.state.metadata).toEqual(
      expect.objectContaining({
        codexDiscoveredToolNames: ['mcp__docs__search'],
      }),
    )
  })

  it('continues the REPL after a failing prompt and allows the next prompt to succeed', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    let requestCount = 0
    globalThis.fetch = async () => {
      requestCount += 1

      if (requestCount === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: 'temporary upstream failure',
            },
          }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      return buildSseResponse([
        {
          type: 'response.completed',
          response: {
            id: 'resp_after_error',
            output_text: 'Recovered turn',
            usage: {
              input_tokens: 4,
              output_tokens: 2,
            },
          },
        },
      ])
    }

    const session = createCodexReplSession()
    const stdout: string[] = []
    const stderr: string[] = []
    const persistedStates: CodexReplTurnResult['conversationState'][] = []

    const firstOutcome = await handleCodexReplPrompt({
      session,
      prompt: 'first prompt fails',
      writeStdout: text => stdout.push(text),
      writeLine: message => stdout.push((message ?? '') + '\n'),
      writeError: message => stderr.push(message),
      persistState: state => persistedStates.push(state),
    })

    const secondOutcome = await handleCodexReplPrompt({
      session,
      prompt: 'second prompt works',
      writeStdout: text => stdout.push(text),
      writeLine: message => stdout.push((message ?? '') + '\n'),
      writeError: message => stderr.push(message),
      persistState: state => persistedStates.push(state),
    })

    expect(firstOutcome).toEqual({ kind: 'continue' })
    expect(secondOutcome).toEqual({ kind: 'continue' })
    expect(stderr).toContain('Codex API error (500): temporary upstream failure')
    expect(stdout.join('')).toContain('Recovered turn')
    expect(persistedStates).toHaveLength(2)
    expect(persistedStates[1]?.lastResponseId).toBe('resp_after_error')
  })

  it('shows help output for /help without leaving the REPL', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    const lines: string[] = []
    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession(),
      prompt: '/help',
      writeLine: message => lines.push(message ?? ''),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines).toContain('Codex REPL commands:')
    expect(lines).toContain(
      '- /new Start a new persisted conversation state with the current configuration',
    )
    expect(lines).toContain(
      '- /sessions [options] List recent persisted conversation states with filtering and pagination',
    )
    expect(lines).toContain('- /status Show provider, session, and MCP status')
    expect(lines).toContain('- /exit Exit the REPL')
  })

  it('shows current provider model information for /model', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.OPENAI_BASE_URL = 'https://example.com/v1'
    process.env.CODEX_MODEL = 'gpt-5.4'
    resetHooksConfigSnapshot()

    const lines: string[] = []
    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession(),
      prompt: '/model',
      writeLine: message => lines.push(message ?? ''),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines).toEqual([
      'Provider: Codex',
      'Model: gpt-5.4',
      'API base URL: https://example.com/v1',
    ])
  })

  it('shows session and MCP status for /status', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    const session = createCodexReplSession({
      cwd: '/tmp/status-project',
      runtime: createFakeRuntime(
        [createFakeTool('Read')],
        [
          createConnectedMcpClient('docs'),
          createFailedMcpClient('github', 'auth expired', {
            config: {
              type: 'http',
              url: 'https://example.com/github-mcp',
              scope: 'project',
              pluginSource: 'github@acme',
            },
          }),
        ],
      ),
      mcpTools: [
        {
          type: 'mcp',
          server_label: 'remote-docs',
          server_url: 'https://example.com/remote-mcp',
        },
      ],
      conversationState: {
        providerId: 'codex-repl',
        stateId: 'status_state_1',
        cwd: '/tmp/status-project',
        conversationId: 'status_state_1',
        lastResponseId: 'resp_status_1',
        history: [
          {
            assistantMessageUuid: 'msg_status_1',
            responseId: 'resp_status_1',
            createdAt: '2026-04-10T00:00:00.000Z',
          },
        ],
      },
    })

    const lines: string[] = []
    const outcome = await handleCodexReplPrompt({
      session,
      prompt: '/status',
      writeLine: message => lines.push(message ?? ''),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines).toContain('Provider: Codex')
    expect(lines).toContain('Session id: status_state_1')
    expect(lines).toContain(
      'Persisted conversation state: persisted conversation state is available for the current directory.',
    )
    expect(lines).toContain(
      `State file path: ${join(configDir, 'codex-repl', 'states', 'status_state_1.json')}`,
    )
    expect(lines).toContain('Last saved at: not saved yet')
    expect(lines).toContain(
      'MCP bridge servers: 2 total (1 connected, 0 pending, 1 failed, 0 needs-auth, 0 disabled)',
    )
    const bridgeConnectedLine = lines.find(line => line.startsWith('- docs [connected]'))
    const bridgeFailedLine = lines.find(line => line.startsWith('- github [failed]'))
    const remoteLine = lines.find(line => line.startsWith('- remote-docs [remote-mcp]'))

    expectLineToContainDiagnosticKeys(bridgeConnectedLine, [
      'source',
      'server',
      'transport',
      'scope',
      'endpoint',
      'status',
      'capabilities',
      'reason',
    ])
    expectLineToContainDiagnostics(bridgeConnectedLine, {
      source: 'mcp-bridge',
      server: 'docs',
      transport: 'stdio',
      scope: 'user',
      endpoint: 'node server.js',
      status: 'connected',
      capabilities: 'tools',
      reason: 'none',
    })
    expect(bridgeConnectedLine).toContain('server-info=unknown')
    expect(bridgeConnectedLine).toContain('command=node server.js')

    expectLineToContainDiagnosticKeys(bridgeFailedLine, [
      'source',
      'server',
      'transport',
      'scope',
      'endpoint',
      'status',
      'capabilities',
      'reason',
    ])
    expectLineToContainDiagnostics(bridgeFailedLine, {
      source: 'mcp-bridge',
      server: 'github',
      transport: 'http',
      scope: 'project',
      endpoint: 'https://example.com/github-mcp',
      status: 'failed',
      capabilities: 'none',
      reason: 'auth expired',
    })
    expect(bridgeFailedLine).toContain('plugin=github@acme')

    expectLineToContainDiagnosticKeys(remoteLine, [
      'source',
      'server',
      'transport',
      'scope',
      'endpoint',
      'status',
      'capabilities',
      'reason',
    ])
    expectLineToContainDiagnostics(remoteLine, {
      source: 'remote-mcp',
      server: 'remote-docs',
      transport: 'unknown',
      scope: 'unknown',
      endpoint: 'https://example.com/remote-mcp',
      status: 'connected',
      capabilities: 'none',
      reason: 'none',
    })
    expect(remoteLine).toContain('decision=selected')
    expect(remoteLine).toContain('selection-reason=passthrough')
  })

  it('shows tool visibility and sources for /tools', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.ENABLE_TOOL_SEARCH = 'true'
    resetHooksConfigSnapshot()

    const bridgedMcpTool = createFakeTool('mcp__docs__search', {
      isMcp: true,
      mcpInfo: {
        serverName: 'docs',
        toolName: 'search',
      },
    })

    const session = createCodexReplSession({
      runtime: createFakeRuntime(
        [createFakeTool('Read'), ToolSearchTool, bridgedMcpTool],
        [
          createConnectedMcpClient('docs', {
            config: {
              command: 'node',
              args: ['docs-server.js'],
              scope: 'project',
              pluginSource: 'docs@acme',
            },
            serverInfo: {
              name: 'docs-server',
              version: '1.2.3',
            },
            capabilities: {
              tools: {},
              resources: {},
            },
          }),
        ],
      ),
      mcpTools: [
        {
          type: 'mcp',
          server_label: 'remote-docs',
          server_url: 'https://example.com/remote-mcp',
        },
      ],
    })

    const lines: string[] = []
    const outcome = await handleCodexReplPrompt({
      session,
      prompt: '/tools',
      writeLine: message => lines.push(message ?? ''),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines).toContain('Function tools exposed: 2')
    expect(lines).toContain(
      '- Read [local] source=local, decision=selected, selection-reason=always-visible',
    )
    expect(lines).toContain(
      '- ToolSearch [tool-search] source=tool-search, decision=selected, selection-reason=tool-search-for-deferred',
    )
    expect(lines).toContain(
      'Deferred/hidden tools: 1',
    )
    const bridgeToolLine = lines.find(
      line => line.startsWith('- mcp__docs__search [mcp-bridge]'),
    )
    const remoteToolLine = lines.find(
      line => line.startsWith('- remote-docs [remote-mcp]'),
    )

    expectLineToContainDiagnosticKeys(bridgeToolLine, [
      'source',
      'server',
      'transport',
      'scope',
      'endpoint',
      'status',
      'capabilities',
      'reason',
    ])
    expectLineToContainDiagnostics(bridgeToolLine, {
      source: 'mcp-bridge',
      server: 'docs',
      transport: 'stdio',
      scope: 'project',
      endpoint: 'node docs-server.js',
      status: 'connected',
      capabilities: 'resources,tools',
      reason: 'none',
    })
    expect(bridgeToolLine).toContain('deferred')
    expect(bridgeToolLine).toContain('selection-reason=awaiting-tool-search')
    expect(bridgeToolLine).toContain('plugin=docs@acme')
    expect(bridgeToolLine).toContain('command=node docs-server.js')

    expectLineToContainDiagnosticKeys(remoteToolLine, [
      'source',
      'server',
      'transport',
      'scope',
      'endpoint',
      'status',
      'capabilities',
      'reason',
    ])
    expectLineToContainDiagnostics(remoteToolLine, {
      source: 'remote-mcp',
      server: 'remote-docs',
      transport: 'unknown',
      scope: 'unknown',
      endpoint: 'https://example.com/remote-mcp',
      status: 'connected',
      capabilities: 'none',
      reason: 'none',
    })
    expect(remoteToolLine).toContain('decision=selected')
    expect(remoteToolLine).toContain('selection-reason=passthrough')
    expect(remoteToolLine).not.toContain('recovered=')
    expect(lines).toContain(
      'MCP bridge servers: 1 total (1 connected, 0 pending, 0 failed, 0 needs-auth, 0 disabled)',
    )
  })

  it('shows stale discovery reasons in /tools when a deferred source signature changes', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.ENABLE_TOOL_SEARCH = 'true'
    resetHooksConfigSnapshot()

    const bridgedMcpTool = createFakeTool('mcp__docs__search', {
      isMcp: true,
      mcpInfo: {
        serverName: 'docs',
        toolName: 'search',
      },
    })

    const session = createCodexReplSession({
      runtime: createFakeRuntime(
        [ToolSearchTool, bridgedMcpTool],
        [
          createConnectedMcpClient('docs', {
            config: {
              command: 'node',
              args: ['changed-docs-server.js'],
              scope: 'project',
            },
          }),
        ],
      ),
      conversationState: {
        providerId: 'codex-repl',
        stateId: 'stale_tools_state',
        conversationId: 'stale_tools_state',
        metadata: {
          codexDiscoveredToolNames: ['mcp__docs__search'],
          codexDiscoveredToolSignatures: {
            mcp__docs__search:
              'mcp-bridge:mcp__docs__search:docs:stdio:project::node:original-docs-server.js',
          },
        },
      },
    })

    const lines: string[] = []
    const outcome = await handleCodexReplPrompt({
      session,
      prompt: '/tools',
      writeLine: message => lines.push(message ?? ''),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines).toContain('Function tools exposed: 1')
    expect(lines).toContain(
      '- ToolSearch [tool-search] source=tool-search, decision=selected, selection-reason=tool-search-for-deferred',
    )
    expect(lines).toContain(
      '- mcp__docs__search [mcp-bridge] source=mcp-bridge, deferred, discovered, recovered=false, decision=hidden, selection-reason=stale-discovery server=docs tool=search status=connected transport=stdio scope=project command=node changed-docs-server.js capabilities=tools endpoint=node changed-docs-server.js reason=none',
    )
  })

  it('shows recovered=true in /tools when a discovered deferred bridge tool matches again after reconnect', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.ENABLE_TOOL_SEARCH = 'true'
    resetHooksConfigSnapshot()

    const bridgedMcpTool = createFakeTool('mcp__docs__search', {
      isMcp: true,
      mcpInfo: {
        serverName: 'docs',
        toolName: 'search',
      },
    })

    const session = createCodexReplSession({
      runtime: createFakeRuntime(
        [ToolSearchTool, bridgedMcpTool],
        [
          createConnectedMcpClient('docs', {
            config: {
              command: 'node',
              args: ['docs-server.js'],
              scope: 'project',
            },
          }),
        ],
      ),
      conversationState: {
        providerId: 'codex-repl',
        stateId: 'recovered_tools_state',
        conversationId: 'recovered_tools_state',
        metadata: {
          codexDiscoveredToolNames: ['mcp__docs__search'],
          codexDiscoveredToolSignatures: {
            mcp__docs__search:
              'mcp-bridge:mcp__docs__search:docs:stdio:project::node:docs-server.js',
          },
        },
      },
    })

    const lines: string[] = []
    const outcome = await handleCodexReplPrompt({
      session,
      prompt: '/tools',
      writeLine: message => lines.push(message ?? ''),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines).toContain('Function tools exposed: 2')
    expect(lines).toContain(
      '- mcp__docs__search [mcp-bridge] source=mcp-bridge, deferred, discovered, recovered=true, decision=selected, selection-reason=discovered-match server=docs tool=search status=connected transport=stdio scope=project command=node docs-server.js capabilities=tools endpoint=node docs-server.js reason=none',
    )
  })

  it('starts a fresh conversation for /new and preserves configuration', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.CODEX_MODEL = 'gpt-5.4'
    resetHooksConfigSnapshot()

    const session = createCodexReplSession({
      cwd: '/tmp/new-session-project',
      conversationState: {
        providerId: 'codex-repl',
        stateId: 'old_state_1',
        cwd: '/tmp/new-session-project',
        conversationId: 'old_state_1',
        lastResponseId: 'resp_old_1',
        history: [
          {
            assistantMessageUuid: 'msg_old_1',
            responseId: 'resp_old_1',
            createdAt: '2026-04-10T00:00:00.000Z',
          },
        ],
      },
    })
    const lines: string[] = []
    const persistedStates: CodexReplTurnResult['conversationState'][] = []

    const outcome = await handleCodexReplPrompt({
      session,
      prompt: '/new',
      writeLine: message => lines.push(message ?? ''),
      persistState: state => persistedStates.push(state),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^Started new persisted conversation state .+\.$/)
    expect(session.state.stateId).not.toBe('old_state_1')
    expect(session.state.lastResponseId).toBeUndefined()
    expect(session.state.history).toEqual([])
    expect(session.state.metadata).toEqual(
      expect.objectContaining({
        codexModel: 'gpt-5.4',
      }),
    )
    expect(persistedStates).toHaveLength(1)
    expect(persistedStates[0]?.stateId).toBe(session.state.stateId)
  })

  it('lists recent persisted sessions for /sessions', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'session_old',
        cwd: '/tmp/project-old',
        conversationId: 'session_old',
        lastResponseId: 'resp_old',
        updatedAt: '2026-04-10T00:00:00.000Z',
        metadata: {
          codexModel: 'gpt-5-codex',
        },
      },
      {
        cwd: '/tmp/project-old',
      },
    )
    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'session_new',
        cwd: '/tmp/project-new',
        conversationId: 'session_new',
        lastResponseId: 'resp_new',
        updatedAt: '2026-04-11T00:00:00.000Z',
        metadata: {
          codexModel: 'gpt-5.4',
        },
      },
      {
        cwd: '/tmp/project-new',
      },
    )

    const lines: string[] = []
    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession(),
      prompt: '/sessions',
      writeLine: message => lines.push(message ?? ''),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines[0]).toBe('Recent persisted Codex REPL sessions: 2')
    expect(lines[1]).toBe('Page: 1/1 page-size=10')
    expect(lines[2]).toBe('Current directory priority: not applied')
    expect(lines[3]).toBe('Filters: provider=codex')
    expect(lines.slice(4)).toContainEqual(
      expect.stringContaining('- session_new cwd=/tmp/project-new'),
    )
    expect(lines.slice(4)).toContainEqual(
      expect.stringContaining('model=gpt-5.4'),
    )
    expect(lines.slice(4)).toContainEqual(
      expect.stringContaining('- session_old cwd=/tmp/project-old'),
    )
    expect(lines.slice(4)).toContainEqual(
      expect.stringContaining('model=gpt-5-codex'),
    )
  })

  it('shows an empty message when no persisted sessions exist for /sessions', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    const lines: string[] = []
    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession(),
      prompt: '/sessions',
      writeLine: message => lines.push(message ?? ''),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines).toEqual(['Recent persisted Codex REPL sessions: none'])
  })

  it('prioritizes sessions from the current directory by default for /sessions', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'session_old',
        cwd: '/tmp/project-old',
        conversationId: 'session_old',
        lastResponseId: 'resp_old',
        updatedAt: '2026-04-10T00:00:00.000Z',
        metadata: {
          codexModel: 'gpt-5-codex',
        },
      },
      {
        cwd: '/tmp/project-old',
      },
    )
    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'session_new',
        cwd: '/tmp/project-new',
        conversationId: 'session_new',
        lastResponseId: 'resp_new',
        updatedAt: '2026-04-11T00:00:00.000Z',
        metadata: {
          codexModel: 'gpt-5.4',
        },
      },
      {
        cwd: '/tmp/project-new',
      },
    )

    const lines: string[] = []
    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession({
        cwd: '/tmp/project-old',
      }),
      prompt: '/sessions',
      writeLine: message => lines.push(message ?? ''),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines[2]).toBe(
      'Current directory priority: applied (/tmp/project-old)',
    )
    expect(lines[4]).toContain('- session_old cwd=/tmp/project-old')
    expect(lines[5]).toContain('- session_new cwd=/tmp/project-new')
  })

  it('supports filtering and pagination for /sessions', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'alpha_repo_state',
        cwd: '/tmp/alpha-repo',
        conversationId: 'alpha_repo_state',
        lastResponseId: 'resp_alpha',
        updatedAt: '2026-04-09T00:00:00.000Z',
        metadata: {
          codexModel: 'gpt-5.4',
        },
      },
      {
        cwd: '/tmp/alpha-repo',
      },
    )
    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'beta_repo_state',
        cwd: '/tmp/beta-repo',
        conversationId: 'beta_repo_state',
        lastResponseId: 'resp_beta',
        updatedAt: '2026-04-10T00:00:00.000Z',
        metadata: {
          codexModel: 'gpt-5-mini',
        },
      },
      {
        cwd: '/tmp/beta-repo',
      },
    )
    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'gamma_notes_state',
        cwd: '/tmp/gamma-notes',
        conversationId: 'gamma_notes_state',
        lastResponseId: 'resp_gamma',
        updatedAt: '2026-04-11T00:00:00.000Z',
        metadata: {
          codexModel: 'gpt-5.4',
        },
      },
      {
        cwd: '/tmp/gamma-notes',
      },
    )

    const lines: string[] = []
    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession(),
      prompt: '/sessions --provider all --query repo --page-size 1 --page 2',
      writeLine: message => lines.push(message ?? ''),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines).toEqual([
      'Recent persisted Codex REPL sessions: 2',
      'Page: 2/2 page-size=1',
      'Current directory priority: not applied',
      'Filters: provider=all query=repo',
      expect.stringContaining('- alpha_repo_state cwd=/tmp/alpha-repo'),
    ])
  })

  it('filters /sessions by explicit cwd', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'project_a_state',
        cwd: '/tmp/project-a',
        conversationId: 'project_a_state',
        lastResponseId: 'resp_a',
        updatedAt: '2026-04-10T00:00:00.000Z',
        metadata: {
          codexModel: 'gpt-5.4',
        },
      },
      {
        cwd: '/tmp/project-a',
      },
    )
    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'project_b_state',
        cwd: '/tmp/project-b',
        conversationId: 'project_b_state',
        lastResponseId: 'resp_b',
        updatedAt: '2026-04-11T00:00:00.000Z',
        metadata: {
          codexModel: 'gpt-5.4',
        },
      },
      {
        cwd: '/tmp/project-b',
      },
    )

    const lines: string[] = []
    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession({
        cwd: '/tmp/project-b',
      }),
      prompt: '/sessions --cwd /tmp/project-a',
      writeLine: message => lines.push(message ?? ''),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines[0]).toBe('Recent persisted Codex REPL sessions: 1')
    expect(lines[2]).toBe('Current directory priority: not applied')
    expect(lines[3]).toBe('Filters: provider=codex cwd=/tmp/project-a')
    expect(lines[4]).toContain('- project_a_state cwd=/tmp/project-a')
  })

  it('fails fast for invalid /sessions pagination input', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    const errors: string[] = []
    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession(),
      prompt: '/sessions --page 0',
      writeError: message => errors.push(message),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(errors).toEqual([
      'Codex REPL /sessions --page must be a positive integer. Usage: /sessions [--cwd <path>] [--provider codex|all] [--query <keyword>] [--page <n>] [--page-size <n>]',
    ])
  })

  it('fails fast for out-of-range /sessions page-size and unsupported provider', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    const errors: string[] = []
    await handleCodexReplPrompt({
      session: createCodexReplSession(),
      prompt: '/sessions --page-size 100',
      writeError: message => errors.push(message),
    })
    await handleCodexReplPrompt({
      session: createCodexReplSession(),
      prompt: '/sessions --provider anthropic',
      writeError: message => errors.push(message),
    })

    expect(errors).toEqual([
      'Codex REPL /sessions --page-size must be between 1 and 50. Usage: /sessions [--cwd <path>] [--provider codex|all] [--query <keyword>] [--page <n>] [--page-size <n>]',
      'Codex REPL /sessions does not yet support --provider anthropic. Use --provider codex or --provider all.',
    ])
  })

  it('resumes persisted state with /resume <state-id>', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'resume_state_1',
        cwd: '/tmp/resume-project',
        conversationId: 'resume_state_1',
        lastResponseId: 'resp_resume_1',
        history: [
          {
            assistantMessageUuid: 'msg_resume_1',
            responseId: 'resp_resume_1',
            createdAt: '2026-04-10T00:00:00.000Z',
          },
        ],
        metadata: {
          codexDiscoveredToolNames: ['mcp__docs__search'],
        },
      },
      {
        cwd: '/tmp/resume-project',
      },
    )

    const session = createCodexReplSession({
      cwd: '/tmp/other-project',
    })
    const lines: string[] = []
    const persistedStates: CodexReplTurnResult['conversationState'][] = []

    const outcome = await handleCodexReplPrompt({
      session,
      prompt: '/resume resume_state_1',
      writeLine: message => lines.push(message ?? ''),
      persistState: state => persistedStates.push(state),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines).toEqual([
      'Resumed persisted conversation state resume_state_1 (last response resp_resume_1).',
    ])
    expect(session.state.stateId).toBe('resume_state_1')
    expect(session.state.lastResponseId).toBe('resp_resume_1')
    expect(session.state.metadata).toEqual(
      expect.objectContaining({
        codexDiscoveredToolNames: ['mcp__docs__search'],
      }),
    )
    expect(persistedStates).toHaveLength(1)
    expect(persistedStates[0]?.stateId).toBe('resume_state_1')
  })

  it('uses the same success wording for /resume without an explicit state id', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'resume_state_cwd',
        cwd: '/tmp/resume-by-cwd',
        conversationId: 'resume_state_cwd',
        lastResponseId: 'resp_resume_cwd',
      },
      {
        cwd: '/tmp/resume-by-cwd',
      },
    )

    const lines: string[] = []
    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession({
        cwd: '/tmp/resume-by-cwd',
      }),
      prompt: '/resume',
      writeLine: message => lines.push(message ?? ''),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(lines).toEqual([
      'Resumed persisted conversation state resume_state_cwd (last response resp_resume_cwd).',
    ])
  })

  it('surfaces readable resume errors for /resume', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    const errors: string[] = []
    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession({
        cwd: '/tmp/missing-project',
      }),
      prompt: '/resume',
      writeError: message => errors.push(message),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(errors).toEqual([
      'Codex REPL resume requested but no persisted conversation state is available.',
    ])
  })

  it('uses the same readable missing-state error for /resume <state-id>', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    const errors: string[] = []
    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession({
        cwd: '/tmp/missing-project',
      }),
      prompt: '/resume missing_state_id',
      writeError: message => errors.push(message),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(errors).toEqual([
      'Codex REPL resume requested but no persisted conversation state is available.',
    ])
  })

  it('treats unknown slash commands as non-fatal prompt errors', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    const errors: string[] = []
    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession(),
      prompt: '/unknown',
      writeError: message => errors.push(message),
    })

    expect(outcome).toEqual({ kind: 'continue' })
    expect(errors).toEqual([
      'Unknown Codex REPL command "/unknown". Use /help to see available commands.',
    ])
  })

  it('returns an exit outcome for /exit', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'codex-repl-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    resetHooksConfigSnapshot()

    const outcome = await handleCodexReplPrompt({
      session: createCodexReplSession(),
      prompt: '/exit',
    })

    expect(outcome).toEqual({
      kind: 'exit',
      exitCode: 0,
    })
  })
})
