import { describe, expect, it } from 'bun:test'
import {
  assertCodexToolingRequestSupported,
  getCodexToolingCapabilities,
} from './capabilities.js'

describe('getCodexToolingCapabilities', () => {
  it('declares stable headless tooling capabilities', () => {
    expect(getCodexToolingCapabilities('headless')).toEqual({
      supportsRemoteMcpTools: false,
      supportsLocalFunctionTools: true,
      supportsMixedTooling: false,
    })
  })

  it('declares stable repl tooling capabilities', () => {
    expect(getCodexToolingCapabilities('repl')).toEqual({
      supportsRemoteMcpTools: true,
      supportsLocalFunctionTools: true,
      supportsMixedTooling: true,
    })
  })
})

describe('assertCodexToolingRequestSupported', () => {
  it('fails fast when headless is asked to use remote MCP tools', () => {
    expect(() =>
      assertCodexToolingRequestSupported({
        mode: 'headless',
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
