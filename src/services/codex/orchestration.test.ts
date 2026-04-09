import { describe, expect, it } from 'bun:test'
import { z } from 'zod/v4'
import { getEmptyToolPermissionContext, type Tool } from 'src/Tool.js'
import {
  buildMissingCodexLocalToolRuntimeMessage,
  prepareCodexToolOrchestration,
  requireCodexFunctionToolExecutor,
} from './orchestration.js'
import type { CodexToolRuntime } from './toolRuntime.js'

function createFakeTool(name: string): Tool {
  return {
    name,
    inputSchema: z.object({
      path: z.string().optional(),
    }),
    async call(input) {
      return {
        data: {
          ok: input.path ?? 'done',
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

describe('prepareCodexToolOrchestration', () => {
  it('combines remote MCP tools and local function tools in one request set', async () => {
    const runtime = createFakeRuntime([createFakeTool('Read')])

    const orchestration = await prepareCodexToolOrchestration({
      mode: 'repl',
      runtime,
      model: 'gpt-5-codex',
      abortController: new AbortController(),
      mcpTools: [
        {
          type: 'mcp',
          server_label: 'docs',
          server_url: 'https://example.com/mcp',
        },
      ],
    })

    expect(orchestration.requestTools).toEqual([
      {
        type: 'mcp',
        server_label: 'docs',
        server_url: 'https://example.com/mcp',
      },
      expect.objectContaining({
        type: 'function',
        name: 'Read',
      }),
    ])
    expect(orchestration.functionToolExecutor).not.toBeNull()
  })

  it('keeps MCP-only requests valid when no local runtime is present', async () => {
    const orchestration = await prepareCodexToolOrchestration({
      mode: 'repl',
      model: 'gpt-5-codex',
      abortController: new AbortController(),
      mcpTools: [
        {
          type: 'mcp',
          server_label: 'docs',
          server_url: 'https://example.com/mcp',
        },
      ],
    })

    expect(orchestration.requestTools).toEqual([
      {
        type: 'mcp',
        server_label: 'docs',
        server_url: 'https://example.com/mcp',
      },
    ])
    expect(orchestration.functionToolExecutor).toBeNull()
  })

  it('returns mode-specific missing-runtime errors for unexpected function calls', () => {
    expect(() =>
      requireCodexFunctionToolExecutor({
        functionToolExecutor: null,
        mode: 'headless',
      }),
    ).toThrow(buildMissingCodexLocalToolRuntimeMessage('headless'))

    expect(() =>
      requireCodexFunctionToolExecutor({
        functionToolExecutor: null,
        mode: 'repl',
      }),
    ).toThrow(buildMissingCodexLocalToolRuntimeMessage('repl'))
  })
})
