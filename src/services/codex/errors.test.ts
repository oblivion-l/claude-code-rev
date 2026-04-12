import { describe, expect, it } from 'bun:test'
import {
  classifyCodexApiError,
  formatCodexApiError,
  tryParseCodexApiErrorBody,
} from './errors.js'

describe('tryParseCodexApiErrorBody', () => {
  it('parses JSON error bodies', () => {
    expect(
      tryParseCodexApiErrorBody(
        '{"error":{"message":"Unsupported parameter","param":"text.format","code":"unsupported_parameter"}}',
      ),
    ).toEqual({
      error: {
        message: 'Unsupported parameter',
        param: 'text.format',
        code: 'unsupported_parameter',
      },
    })
  })

  it('returns null for invalid JSON', () => {
    expect(tryParseCodexApiErrorBody('not-json')).toBeNull()
  })
})

describe('formatCodexApiError', () => {
  it('formats model support rejections clearly', () => {
    expect(
      formatCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'The model gpt-4o-mini does not support this feature',
            param: 'model',
          },
        },
        model: 'gpt-4o-mini',
        usedStructuredOutput: false,
        usedMcpTools: false,
        usedBridgedMcpTools: false,
        usedFunctionTools: false,
      }),
    ).toContain('Codex model gpt-4o-mini is not supported for this request')
  })

  it('formats structured output parameter rejections clearly', () => {
    expect(
      formatCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Unsupported parameter: text.format',
            param: 'text.format',
            code: 'unsupported_parameter',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: true,
        usedMcpTools: false,
        usedBridgedMcpTools: false,
        usedFunctionTools: false,
      }),
    ).toContain('Codex structured outputs are not supported for model gpt-5-codex')
  })

  it('formats generic structured output request rejections clearly', () => {
    expect(
      formatCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Invalid schema for text.format',
            type: 'invalid_request_error',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: true,
        usedMcpTools: false,
        usedBridgedMcpTools: false,
        usedFunctionTools: false,
      }),
    ).toContain(
      'Codex structured outputs are not supported for model gpt-5-codex or this API parameter set',
    )
  })

  it('formats MCP tool rejections clearly', () => {
    expect(
      formatCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Unsupported parameter: tools[0].type',
            param: 'tools[0].type',
            code: 'unsupported_parameter',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: false,
        usedMcpTools: true,
        usedBridgedMcpTools: false,
        usedFunctionTools: false,
      }),
    ).toContain('Codex MCP tools are not supported for model gpt-5-codex')
  })

  it('formats local function tool rejections clearly', () => {
    expect(
      formatCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Unsupported parameter: tools[0].type',
            param: 'tools[0].type',
            code: 'unsupported_parameter',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: false,
        usedMcpTools: false,
        usedBridgedMcpTools: false,
        usedFunctionTools: true,
      }),
    ).toContain(
      'Codex local function tools are not supported for model gpt-5-codex',
    )
  })

  it('formats bridged MCP tool rejections clearly', () => {
    expect(
      formatCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Unsupported parameter: tools[0].type',
            param: 'tools[0].type',
            code: 'unsupported_parameter',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: false,
        usedMcpTools: false,
        usedBridgedMcpTools: true,
        usedFunctionTools: true,
      }),
    ).toContain(
      'Codex locally bridged MCP tools are not supported for model gpt-5-codex',
    )
  })

  it('formats mixed tool rejections generically when MCP and local tools are both enabled', () => {
    expect(
      formatCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Unsupported parameter: tools[0].type',
            param: 'tools[0].type',
            code: 'unsupported_parameter',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: false,
        usedMcpTools: true,
        usedBridgedMcpTools: false,
        usedFunctionTools: true,
      }),
    ).toContain('Codex tools are not supported for model gpt-5-codex')
  })

  it('classifies remote MCP and local tool conflicts with a stable error code and hint', () => {
    expect(
      classifyCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Unsupported parameter: tools[0].type',
            param: 'tools[0].type',
            code: 'unsupported_parameter',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: false,
        usedMcpTools: true,
        usedBridgedMcpTools: false,
        usedLocalFunctionTools: true,
        usedToolSearch: true,
        usedFunctionTools: true,
      }),
    ).toEqual(
      expect.objectContaining({
        category: 'tooling',
        errorCode: 'CODEX_TOOLING_CONFLICT_REMOTE_LOCAL',
        hint: 'disable-remote-mcp-or-local-tools',
        requestedSources: ['local', 'remote-mcp', 'tool-search'],
      }),
    )
  })

  it('classifies local and bridged tool conflicts with a stable error code and hint', () => {
    expect(
      classifyCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Unsupported parameter: tools[1].type',
            param: 'tools[1].type',
            code: 'unsupported_parameter',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: false,
        usedMcpTools: false,
        usedBridgedMcpTools: true,
        usedLocalFunctionTools: true,
        usedToolSearch: false,
        usedFunctionTools: true,
      }),
    ).toEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          'Codex tools are not supported for model gpt-5-codex',
        ),
        category: 'tooling',
        errorCode: 'CODEX_TOOLING_CONFLICT_LOCAL_BRIDGE',
        hint: 'disable-bridge-or-local-tools',
        requestedSources: ['local', 'mcp-bridge'],
      }),
    )
  })

  it('classifies remote MCP plus ToolSearch-only combinations as remote-local conflicts', () => {
    expect(
      classifyCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Unsupported parameter: tools[0].type',
            param: 'tools[0].type',
            code: 'unsupported_parameter',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: false,
        usedMcpTools: true,
        usedBridgedMcpTools: false,
        usedLocalFunctionTools: false,
        usedToolSearch: true,
        usedFunctionTools: true,
      }),
    ).toEqual(
      expect.objectContaining({
        errorCode: 'CODEX_TOOLING_CONFLICT_REMOTE_LOCAL',
        hint: 'disable-remote-mcp-or-local-tools',
        requestedSources: ['remote-mcp', 'tool-search'],
      }),
    )
  })

  it('classifies bridged MCP plus ToolSearch combinations as bridged-tool rejections when no plain local tools are present', () => {
    expect(
      classifyCodexApiError({
        status: 400,
        body: {
          error: {
            message: 'Unsupported parameter: tools[1].type',
            param: 'tools[1].type',
            code: 'unsupported_parameter',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: false,
        usedMcpTools: false,
        usedBridgedMcpTools: true,
        usedLocalFunctionTools: false,
        usedToolSearch: true,
        usedFunctionTools: true,
      }),
    ).toEqual(
      expect.objectContaining({
        errorCode: 'CODEX_TOOLING_BRIDGED_MCP_UNSUPPORTED',
        hint: 'disable-bridge-or-switch-model',
        requestedSources: ['mcp-bridge', 'tool-search'],
      }),
    )
  })

  it('falls back to a generic API error when no special case matches', () => {
    expect(
      formatCodexApiError({
        status: 429,
        body: {
          error: {
            message: 'Rate limit exceeded',
          },
        },
        model: 'gpt-5-codex',
        usedStructuredOutput: false,
        usedMcpTools: false,
        usedBridgedMcpTools: false,
        usedFunctionTools: false,
      }),
    ).toBe('Codex API error (429): Rate limit exceeded')
  })
})

describe('classifyCodexApiError tooling matrix', () => {
  const unsupportedToolsBody = {
    error: {
      message: 'Unsupported parameter: tools[0].type',
      param: 'tools[0].type',
      code: 'unsupported_parameter',
    },
  } as const

  const matrix: Array<{
    name: string
    args: {
      usedMcpTools: boolean
      usedBridgedMcpTools: boolean
      usedLocalFunctionTools?: boolean
      usedToolSearch?: boolean
      usedFunctionTools: boolean
    }
    expected: {
      errorCode: string
      hint: string
      requestedSources: string[]
    }
  }> = [
    {
      name: 'local only',
      args: {
        usedMcpTools: false,
        usedBridgedMcpTools: false,
        usedLocalFunctionTools: true,
        usedToolSearch: false,
        usedFunctionTools: true,
      },
      expected: {
        errorCode: 'CODEX_TOOLING_LOCAL_FUNCTION_UNSUPPORTED',
        hint: 'disable-local-tools-or-switch-model',
        requestedSources: ['local'],
      },
    },
    {
      name: 'bridge only',
      args: {
        usedMcpTools: false,
        usedBridgedMcpTools: true,
        usedLocalFunctionTools: false,
        usedToolSearch: false,
        usedFunctionTools: true,
      },
      expected: {
        errorCode: 'CODEX_TOOLING_BRIDGED_MCP_UNSUPPORTED',
        hint: 'disable-bridge-or-switch-model',
        requestedSources: ['mcp-bridge'],
      },
    },
    {
      name: 'remote only',
      args: {
        usedMcpTools: true,
        usedBridgedMcpTools: false,
        usedLocalFunctionTools: false,
        usedToolSearch: false,
        usedFunctionTools: false,
      },
      expected: {
        errorCode: 'CODEX_TOOLING_REMOTE_MCP_UNSUPPORTED',
        hint: 'disable-remote-mcp-or-switch-model',
        requestedSources: ['remote-mcp'],
      },
    },
    {
      name: 'tool-search only',
      args: {
        usedMcpTools: false,
        usedBridgedMcpTools: false,
        usedLocalFunctionTools: false,
        usedToolSearch: true,
        usedFunctionTools: true,
      },
      expected: {
        errorCode: 'CODEX_TOOLING_LOCAL_FUNCTION_UNSUPPORTED',
        hint: 'disable-local-tools-or-switch-model',
        requestedSources: ['tool-search'],
      },
    },
    {
      name: 'local plus tool-search',
      args: {
        usedMcpTools: false,
        usedBridgedMcpTools: false,
        usedLocalFunctionTools: true,
        usedToolSearch: true,
        usedFunctionTools: true,
      },
      expected: {
        errorCode: 'CODEX_TOOLING_LOCAL_FUNCTION_UNSUPPORTED',
        hint: 'disable-local-tools-or-switch-model',
        requestedSources: ['local', 'tool-search'],
      },
    },
    {
      name: 'bridge plus tool-search',
      args: {
        usedMcpTools: false,
        usedBridgedMcpTools: true,
        usedLocalFunctionTools: false,
        usedToolSearch: true,
        usedFunctionTools: true,
      },
      expected: {
        errorCode: 'CODEX_TOOLING_BRIDGED_MCP_UNSUPPORTED',
        hint: 'disable-bridge-or-switch-model',
        requestedSources: ['mcp-bridge', 'tool-search'],
      },
    },
    {
      name: 'remote plus tool-search',
      args: {
        usedMcpTools: true,
        usedBridgedMcpTools: false,
        usedLocalFunctionTools: false,
        usedToolSearch: true,
        usedFunctionTools: true,
      },
      expected: {
        errorCode: 'CODEX_TOOLING_CONFLICT_REMOTE_LOCAL',
        hint: 'disable-remote-mcp-or-local-tools',
        requestedSources: ['remote-mcp', 'tool-search'],
      },
    },
    {
      name: 'local bridge remote and tool-search',
      args: {
        usedMcpTools: true,
        usedBridgedMcpTools: true,
        usedLocalFunctionTools: true,
        usedToolSearch: true,
        usedFunctionTools: true,
      },
      expected: {
        errorCode: 'CODEX_TOOLING_CONFLICT_REMOTE_LOCAL',
        hint: 'disable-remote-mcp-or-local-tools',
        requestedSources: ['local', 'mcp-bridge', 'remote-mcp', 'tool-search'],
      },
    },
  ]

  for (const testCase of matrix) {
    it(`returns a stable explanation for ${testCase.name}`, () => {
      expect(
        classifyCodexApiError({
          status: 400,
          body: unsupportedToolsBody,
          model: 'gpt-5-codex',
          usedStructuredOutput: false,
          ...testCase.args,
        }),
      ).toEqual(
        expect.objectContaining({
          category: 'tooling',
          ...testCase.expected,
        }),
      )
    })
  }
})
