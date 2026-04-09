import { describe, expect, it } from 'bun:test'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import { resolveCodexToolingRequestPlan } from './requestPolicy.js'
import type { CodexToolRuntime } from './toolRuntime.js'

function createFakeRuntime(): CodexToolRuntime {
  let appState: any = {
    toolPermissionContext: getEmptyToolPermissionContext(),
    fileHistory: {},
    attribution: {},
  }

  return {
    cwd: '/tmp/project',
    commands: [],
    tools: [],
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

describe('resolveCodexToolingRequestPlan', () => {
  it('builds a stable repl mixed-tooling request plan', () => {
    const plan = resolveCodexToolingRequestPlan({
      mode: 'repl',
      runtime: createFakeRuntime(),
      mcpTools: [
        {
          type: 'mcp',
          server_label: 'docs',
          server_url: 'https://example.com/mcp',
        },
      ],
    })

    expect(plan.requested).toEqual({
      remoteMcpTools: true,
      localFunctionTools: true,
      mixedTooling: true,
    })
    expect(plan.enabled).toEqual({
      remoteMcpTools: true,
      localFunctionTools: true,
    })
  })

  it('fails fast for unsupported headless mixed-tooling requests', () => {
    expect(() =>
      resolveCodexToolingRequestPlan({
        mode: 'headless',
        runtime: createFakeRuntime(),
        mcpTools: [
          {
            type: 'mcp',
            server_label: 'docs',
            server_url: 'https://example.com/mcp',
          },
        ],
      }),
    ).toThrow(
      'Codex provider currently does not support remote MCP tools in --print mode.',
    )
  })
})
