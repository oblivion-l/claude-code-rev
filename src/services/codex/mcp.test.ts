import { describe, expect, it } from 'bun:test'
import type { ScopedMcpServerConfig } from 'src/services/mcp/types.js'
import { mapCodexMcpTools } from './mcp.js'

describe('mapCodexMcpTools', () => {
  it('maps supported remote http and sse MCP servers', () => {
    const tools = mapCodexMcpTools({
      docs: {
        type: 'http',
        url: 'https://example.com/mcp',
        scope: 'user',
      } satisfies ScopedMcpServerConfig,
      search: {
        type: 'sse',
        url: 'https://example.com/sse',
        scope: 'project',
      } satisfies ScopedMcpServerConfig,
    })

    expect(tools).toEqual([
      {
        type: 'mcp',
        server_label: 'docs',
        server_url: 'https://example.com/mcp',
      },
      {
        type: 'mcp',
        server_label: 'search',
        server_url: 'https://example.com/sse',
      },
    ])
  })

  it('ignores internal-only MCP transports that Codex REPL does not manage directly', () => {
    const tools = mapCodexMcpTools({
      ide: {
        type: 'sse-ide',
        url: 'http://127.0.0.1:3210/sse',
        ideName: 'VS Code',
        scope: 'dynamic',
      } satisfies ScopedMcpServerConfig,
      sdk_bridge: {
        type: 'sdk',
        name: 'sdk-bridge',
        scope: 'dynamic',
      } satisfies ScopedMcpServerConfig,
    })

    expect(tools).toEqual([])
  })

  it('fails fast for unsupported stdio transports', () => {
    expect(() =>
      mapCodexMcpTools({
        local_tool: {
          command: 'node',
          args: ['server.js'],
          scope: 'user',
        } satisfies ScopedMcpServerConfig,
      }),
    ).toThrow(
      'Codex MCP server "local_tool" uses unsupported transport "stdio". Only remote http and sse servers are currently supported.',
    )
  })

  it('treats legacy stdio configs without type as stdio', () => {
    expect(() =>
      mapCodexMcpTools({
        legacy_local_tool: {
          command: 'node',
          args: ['legacy.js'],
          scope: 'project',
        } satisfies ScopedMcpServerConfig,
      }),
    ).toThrow(
      'Codex MCP server "legacy_local_tool" uses unsupported transport "stdio". Only remote http and sse servers are currently supported.',
    )
  })

  it('fails fast for unsupported remote auth helpers', () => {
    expect(() =>
      mapCodexMcpTools({
        secured: {
          type: 'http',
          url: 'https://example.com/mcp',
          headersHelper: 'node helper.js',
          scope: 'user',
        } satisfies ScopedMcpServerConfig,
      }),
    ).toThrow(
      'Codex MCP server "secured" uses headersHelper, which is not yet supported in Codex MCP mode.',
    )
  })

  it('fails fast for invalid URLs', () => {
    expect(() =>
      mapCodexMcpTools({
        broken: {
          type: 'sse',
          url: '/relative/path',
          scope: 'project',
        } satisfies ScopedMcpServerConfig,
      }),
    ).toThrow(
      'Codex MCP server "broken" must use an absolute http(s) URL.',
    )
  })
})
