import type { CodexMcpTool } from './types.js'
import type { CodexToolRuntime } from './toolRuntime.js'

export type CodexToolingMode = 'headless' | 'repl'

export type CodexToolingCapabilities = {
  supportsRemoteMcpTools: boolean
  supportsLocalFunctionTools: boolean
  supportsMixedTooling: boolean
}

const CODEX_TOOLING_CAPABILITIES: Record<
  CodexToolingMode,
  CodexToolingCapabilities
> = {
  headless: {
    supportsRemoteMcpTools: false,
    supportsLocalFunctionTools: true,
    supportsMixedTooling: false,
  },
  repl: {
    supportsRemoteMcpTools: true,
    supportsLocalFunctionTools: true,
    supportsMixedTooling: true,
  },
}

export function getCodexToolingCapabilities(
  mode: CodexToolingMode,
): CodexToolingCapabilities {
  return CODEX_TOOLING_CAPABILITIES[mode]
}

export function assertCodexToolingRequestSupported(args: {
  mode: CodexToolingMode
  runtime?: CodexToolRuntime
  mcpTools?: CodexMcpTool[]
}): void {
  const capabilities = getCodexToolingCapabilities(args.mode)
  const hasRemoteMcpTools = (args.mcpTools?.length ?? 0) > 0
  const hasLocalToolRuntime = Boolean(args.runtime)

  if (hasRemoteMcpTools && !capabilities.supportsRemoteMcpTools) {
    throw new Error(
      args.mode === 'headless'
        ? 'Codex provider currently does not support remote MCP tools in --print mode.'
        : 'Codex REPL currently does not support remote MCP tools in this mode.',
    )
  }

  if (hasLocalToolRuntime && !capabilities.supportsLocalFunctionTools) {
    throw new Error(
      args.mode === 'headless'
        ? 'Codex provider currently does not support local function tools in --print mode.'
        : 'Codex REPL currently does not support local function tools in this mode.',
    )
  }

  if (
    hasRemoteMcpTools &&
    hasLocalToolRuntime &&
    !capabilities.supportsMixedTooling
  ) {
    throw new Error(
      args.mode === 'headless'
        ? 'Codex provider currently does not support combining remote MCP tools with local function tools in --print mode.'
        : 'Codex REPL currently does not support combining remote MCP tools with local function tools in this mode.',
    )
  }
}
