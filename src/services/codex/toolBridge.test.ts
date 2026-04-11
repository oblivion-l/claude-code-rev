import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import { getEmptyToolPermissionContext, type Tool } from 'src/Tool.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import { ToolSearchTool } from 'src/tools/ToolSearchTool/ToolSearchTool.js'
import { resetHooksConfigSnapshot } from 'src/utils/hooks/hooksConfigSnapshot.js'
import {
  executeCodexFunctionCalls,
  extractCodexFunctionCalls,
  mapCodexFunctionTools,
  selectCodexFunctionTools,
} from './toolBridge.js'
import type { CodexToolRuntime } from './toolRuntime.js'

const originalConfigDirEnv = process.env.CLAUDE_CONFIG_DIR
const originalSimpleEnv = process.env.CLAUDE_CODE_SIMPLE
const originalToolSearchEnv = process.env.ENABLE_TOOL_SEARCH
let configDir: string

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'codex-tool-bridge-config-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env.CLAUDE_CODE_SIMPLE = '1'
  resetHooksConfigSnapshot()
})

afterEach(() => {
  resetHooksConfigSnapshot()

  if (originalConfigDirEnv === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDirEnv
  }

  if (originalSimpleEnv === undefined) {
    delete process.env.CLAUDE_CODE_SIMPLE
  } else {
    process.env.CLAUDE_CODE_SIMPLE = originalSimpleEnv
  }

  if (originalToolSearchEnv === undefined) {
    delete process.env.ENABLE_TOOL_SEARCH
  } else {
    process.env.ENABLE_TOOL_SEARCH = originalToolSearchEnv
  }

  if (configDir) {
    rmSync(configDir, { recursive: true, force: true })
  }
})

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

describe('selectCodexFunctionTools', () => {
  it('keeps only the supported local development tools', () => {
    const readTool = createFakeTool('Read')
    const unsupportedTool = createFakeTool('TodoWrite')

    expect(selectCodexFunctionTools([readTool, unsupportedTool])).toEqual([
      readTool,
    ])
  })

  it('includes locally bridged MCP tools for connected stdio servers', () => {
    const bridgedMcpTool = createFakeTool('mcp__docs__search', {
      isMcp: true,
      mcpInfo: {
        serverName: 'docs',
        toolName: 'search',
      },
    })
    const remoteMcpTool = createFakeTool('mcp__remote__search', {
      isMcp: true,
      mcpInfo: {
        serverName: 'remote',
        toolName: 'search',
      },
    })

    const selected = selectCodexFunctionTools(
      [bridgedMcpTool, remoteMcpTool],
      createFakeRuntime([], [
        createConnectedMcpClient('docs'),
        {
          ...createConnectedMcpClient('remote'),
          config: {
            type: 'sse',
            url: 'https://example.com/mcp',
            scope: 'user',
          },
        },
      ]),
    )

    expect(selected).toEqual([bridgedMcpTool])
  })

  it('keeps ToolSearch available and loads deferred MCP tools only after discovery', () => {
    process.env.ENABLE_TOOL_SEARCH = 'true'
    const bridgedMcpTool = createFakeTool('mcp__docs__search', {
      isMcp: true,
      mcpInfo: {
        serverName: 'docs',
        toolName: 'search',
      },
    })

    const runtime = createFakeRuntime(
      [ToolSearchTool, bridgedMcpTool],
      [createConnectedMcpClient('docs')],
    )

    expect(
      selectCodexFunctionTools(runtime.tools, runtime),
    ).toEqual([ToolSearchTool])

    expect(
      selectCodexFunctionTools(runtime.tools, runtime, {
        discoveredToolNames: new Set(['mcp__docs__search']),
      }),
    ).toEqual([ToolSearchTool, bridgedMcpTool])
  })
})

describe('mapCodexFunctionTools', () => {
  it('maps eligible tools to Codex function schemas', async () => {
    const readTool = createFakeTool('Read')
    const runtime = createFakeRuntime([readTool])

    const tools = await mapCodexFunctionTools({
      tools: [readTool],
      runtime,
      model: 'gpt-5-codex',
    })

    expect(tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'Read',
        description: 'Read prompt',
      }),
    ])
  })

  it('maps locally bridged MCP tools to Codex function schemas', async () => {
    const mcpTool = createFakeTool('mcp__docs__search', {
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
    const runtime = createFakeRuntime([mcpTool], [
      createConnectedMcpClient('docs'),
    ])

    const tools = await mapCodexFunctionTools({
      tools: [mcpTool],
      runtime,
      model: 'gpt-5-codex',
    })

    expect(tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'mcp__docs__search',
        description: 'docs search prompt',
      }),
    ])
  })
})

describe('extractCodexFunctionCalls', () => {
  it('extracts function calls from completed responses', () => {
    expect(
      extractCodexFunctionCalls({
        output: [
          {
            type: 'function_call',
            name: 'Read',
            call_id: 'call_1',
            arguments: '{"path":"src/index.ts"}',
          },
        ],
      }),
    ).toEqual([
      {
        name: 'Read',
        callId: 'call_1',
        argumentsText: '{"path":"src/index.ts"}',
      },
    ])
  })
})

describe('executeCodexFunctionCalls', () => {
  it('executes mapped local tools through the existing tool runtime', async () => {
    const readTool = createFakeTool('Read')
    const runtime = createFakeRuntime([readTool])

    const execution = await executeCodexFunctionCalls({
      runtime,
      tools: [readTool],
      functionCalls: [
        {
          name: 'Read',
          callId: 'call_1',
          argumentsText: '{"path":"src/index.ts"}',
        },
      ],
      model: 'gpt-5-codex',
      abortController: new AbortController(),
    })

    expect(execution.outputs).toEqual([
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"ok":"src/index.ts"}',
      },
    ])
    expect(execution.selectedToolNames).toEqual([])
  })

  it('returns a readable error output for invalid JSON arguments', async () => {
    const readTool = createFakeTool('Read')
    const runtime = createFakeRuntime([readTool])

    const execution = await executeCodexFunctionCalls({
      runtime,
      tools: [readTool],
      functionCalls: [
        {
          name: 'Read',
          callId: 'call_invalid',
          argumentsText: '{not-json}',
        },
      ],
      model: 'gpt-5-codex',
      abortController: new AbortController(),
    })

    expect(execution.outputs[0]).toEqual(
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_invalid',
      }),
    )
    expect(execution.outputs[0]?.output).toContain(
      'Codex tool call Read returned invalid JSON arguments',
    )
  })

  it('tracks selected tool names from ToolSearch outputs', async () => {
    process.env.ENABLE_TOOL_SEARCH = 'true'
    const deferredRead = createFakeTool('Read', {
      shouldDefer: true,
    })
    const deferredEdit = createFakeTool('Edit', {
      shouldDefer: true,
    })
    const runtime = createFakeRuntime([ToolSearchTool, deferredRead, deferredEdit])

    const execution = await executeCodexFunctionCalls({
      runtime,
      tools: [ToolSearchTool],
      functionCalls: [
        {
          name: 'ToolSearch',
          callId: 'call_search',
          argumentsText: '{"query":"select:Read,Edit"}',
        },
      ],
      model: 'gpt-5-codex',
      abortController: new AbortController(),
    })

    expect(execution.outputs[0]).toEqual(
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_search',
      }),
    )
    expect(execution.selectedToolNames).toEqual(['Read', 'Edit'])
  })
})
