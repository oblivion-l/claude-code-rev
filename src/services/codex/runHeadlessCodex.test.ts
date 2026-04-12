import { afterEach, describe, expect, it } from 'bun:test'
import { z } from 'zod/v4'
import { getEmptyToolPermissionContext, type Tool } from 'src/Tool.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import { ToolSearchTool } from 'src/tools/ToolSearchTool/ToolSearchTool.js'
import type { CodexToolRuntime } from './toolRuntime.js'
import {
  runHeadlessCodex,
} from './runHeadlessCodex.js'

const originalEnv = {
  CLAUDE_CODE_USE_CODEX: process.env.CLAUDE_CODE_USE_CODEX,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  CODEX_MODEL: process.env.CODEX_MODEL,
  ENABLE_TOOL_SEARCH: process.env.ENABLE_TOOL_SEARCH,
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

function createFakeTool(
  name: string,
  overrides?: Partial<Tool>,
): Tool {
  return {
    name,
    inputSchema: z.object({
      query: z.string().optional(),
    }),
    async call(input) {
      return {
        data: {
          ok: input.query ?? 'done',
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

function createConnectedMcpClient(name: string): MCPServerConnection {
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
  }
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
  it('fails fast with aligned continue wording when no persisted state is available', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'

    const writes: unknown[] = []
    const structuredIO = {
      write: async (message: unknown) => {
        writes.push(message)
      },
    }

    const result = await runHeadlessCodex({
      inputPrompt: 'Follow up on the prior answer',
      structuredIO: structuredIO as any,
      options: {
        outputFormat: 'stream-json',
        continue: true,
      } as any,
      conversationState: null,
    })

    expect(result.exitCode).toBe(1)
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'result',
        subtype: 'error_during_execution',
        error_code: 'HEADLESS_PROVIDER_INVALID_INPUT',
        errors: [
          'Codex provider continue requested but no persisted conversation state is available for the current directory.',
        ],
      }),
    )
  })

  it('fails fast with aligned resume wording when no persisted state is available', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'

    const writes: unknown[] = []
    const structuredIO = {
      write: async (message: unknown) => {
        writes.push(message)
      },
    }

    const result = await runHeadlessCodex({
      inputPrompt: 'Follow up on the prior answer',
      structuredIO: structuredIO as any,
      options: {
        outputFormat: 'stream-json',
        resume: 'missing_state_id',
      } as any,
      conversationState: null,
    })

    expect(result.exitCode).toBe(1)
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'result',
        subtype: 'error_during_execution',
        error_code: 'HEADLESS_PROVIDER_INVALID_INPUT',
        errors: [
          'Codex provider resume requested but no persisted conversation state is available.',
        ],
      }),
    )
  })

  it('fails fast with aligned resume-session-at wording when the assistant turn is missing', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'

    const writes: unknown[] = []
    const structuredIO = {
      write: async (message: unknown) => {
        writes.push(message)
      },
    }

    const result = await runHeadlessCodex({
      inputPrompt: 'Branch from that earlier answer',
      structuredIO: structuredIO as any,
      options: {
        outputFormat: 'stream-json',
        resume: 'resume_state_1',
        resumeSessionAt: 'missing_turn_id',
      } as any,
      conversationState: {
        providerId: 'codex',
        stateId: 'resume_state_1',
        conversationId: 'resume_state_1',
        lastResponseId: 'resp_resume_1',
        history: [
          {
            assistantMessageUuid: 'msg_resume_1',
            responseId: 'resp_resume_1',
            createdAt: '2026-04-10T00:00:00.000Z',
          },
        ],
      },
    })

    expect(result.exitCode).toBe(1)
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'result',
        subtype: 'error_during_execution',
        error_code: 'HEADLESS_PROVIDER_INVALID_INPUT',
        errors: [
          'Codex provider could not find persisted assistant turn missing_turn_id for --resume-session-at.',
        ],
      }),
    )
  })

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

  it('executes locally bridged MCP tools through the shared headless runtime', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'

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
              id: 'resp_tool_round',
              output: [
                {
                  type: 'function_call',
                  name: 'mcp__docs__search',
                  call_id: 'call_mcp_1',
                  arguments: '{"query":"bun install"}',
                },
              ],
              usage: {
                input_tokens: 8,
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
            output_text: 'Bridge complete',
            usage: {
              input_tokens: 4,
              output_tokens: 2,
            },
          },
        },
      ])
    }

    const writes: unknown[] = []
    const structuredIO = {
      write: async (message: unknown) => {
        writes.push(message)
      },
    }

    const result = await runHeadlessCodex({
      inputPrompt: 'Use docs MCP',
      structuredIO: structuredIO as any,
      options: {
        outputFormat: 'stream-json',
      } as any,
      runtime: createFakeRuntime([bridgedMcpTool], [
        createConnectedMcpClient('docs'),
      ]),
    })

    expect(result.exitCode).toBe(0)
    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]?.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'mcp__docs__search',
      }),
    ])
    expect(requestBodies[1]?.previous_response_id).toBe('resp_tool_round')
    expect(requestBodies[1]?.input).toEqual([
      {
        type: 'function_call_output',
        call_id: 'call_mcp_1',
        output: '{"ok":"bun install"}',
      },
    ])
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'result',
        subtype: 'success',
        result: 'Bridge complete',
      }),
    )
  })

  it('loads deferred bridged MCP tools after ToolSearch selection in headless mode', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.ENABLE_TOOL_SEARCH = 'true'

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

    const writes: unknown[] = []
    const structuredIO = {
      write: async (message: unknown) => {
        writes.push(message)
      },
    }

    const result = await runHeadlessCodex({
      inputPrompt: 'Find docs tool',
      structuredIO: structuredIO as any,
      options: {
        outputFormat: 'stream-json',
      } as any,
      runtime: createFakeRuntime(
        [ToolSearchTool, bridgedMcpTool],
        [createConnectedMcpClient('docs')],
      ),
    })

    expect(result.exitCode).toBe(0)
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
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'result',
        subtype: 'success',
        result: 'Search complete',
      }),
    )
  })

  it('reuses discovered deferred tools from conversation state in later headless runs', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.ENABLE_TOOL_SEARCH = 'true'

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
            id: 'resp_second_run',
            output_text: 'Second run ready',
            usage: {
              input_tokens: 3,
              output_tokens: 2,
            },
          },
        },
      ])
    }

    const structuredIO = {
      write: async (_message: unknown) => {},
    }

    const firstRun = await runHeadlessCodex({
      inputPrompt: 'discover docs',
      structuredIO: structuredIO as any,
      options: {
        outputFormat: 'stream-json',
      } as any,
      runtime: createFakeRuntime(
        [ToolSearchTool, bridgedMcpTool],
        [createConnectedMcpClient('docs')],
      ),
    })

    const secondRun = await runHeadlessCodex({
      inputPrompt: 'use remembered docs',
      structuredIO: structuredIO as any,
      options: {
        outputFormat: 'stream-json',
        continue: true,
      } as any,
      conversationState: firstRun.conversationState,
      runtime: createFakeRuntime(
        [ToolSearchTool, bridgedMcpTool],
        [createConnectedMcpClient('docs')],
      ),
    })

    expect(firstRun.conversationState?.metadata).toEqual(
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
    expect(secondRun.exitCode).toBe(0)
  })

  it('preserves discovered tool state when a later headless round fails', async () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.ENABLE_TOOL_SEARCH = 'true'

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

    const writes: unknown[] = []
    const structuredIO = {
      write: async (message: unknown) => {
        writes.push(message)
      },
    }

    const result = await runHeadlessCodex({
      inputPrompt: 'discover docs then fail',
      structuredIO: structuredIO as any,
      options: {
        outputFormat: 'stream-json',
      } as any,
      runtime: createFakeRuntime(
        [ToolSearchTool, bridgedMcpTool],
        [createConnectedMcpClient('docs')],
      ),
    })

    expect(result.exitCode).toBe(1)
    expect(result.conversationState?.metadata).toEqual(
      expect.objectContaining({
        codexDiscoveredToolNames: ['mcp__docs__search'],
      }),
    )
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'result',
        subtype: 'error_during_execution',
      }),
    )
  })
})
