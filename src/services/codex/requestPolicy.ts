import {
  assertCodexToolingRequestSupported,
  getCodexToolingCapabilities,
  type CodexToolingCapabilities,
  type CodexToolingMode,
} from './capabilities.js'
import type { CodexMcpTool } from './types.js'
import type { CodexToolRuntime } from './toolRuntime.js'

export type CodexToolingRequestPlan = {
  mode: CodexToolingMode
  capabilities: CodexToolingCapabilities
  requested: {
    remoteMcpTools: boolean
    localFunctionTools: boolean
    mixedTooling: boolean
  }
  enabled: {
    remoteMcpTools: boolean
    localFunctionTools: boolean
  }
}

export function resolveCodexToolingRequestPlan(args: {
  mode: CodexToolingMode
  runtime?: CodexToolRuntime
  mcpTools?: CodexMcpTool[]
}): CodexToolingRequestPlan {
  assertCodexToolingRequestSupported(args)

  const capabilities = getCodexToolingCapabilities(args.mode)
  const requestedRemoteMcpTools = (args.mcpTools?.length ?? 0) > 0
  const requestedLocalFunctionTools = Boolean(args.runtime)

  return {
    mode: args.mode,
    capabilities,
    requested: {
      remoteMcpTools: requestedRemoteMcpTools,
      localFunctionTools: requestedLocalFunctionTools,
      mixedTooling:
        requestedRemoteMcpTools && requestedLocalFunctionTools,
    },
    enabled: {
      remoteMcpTools:
        requestedRemoteMcpTools &&
        capabilities.supportsRemoteMcpTools,
      localFunctionTools:
        requestedLocalFunctionTools &&
        capabilities.supportsLocalFunctionTools,
    },
  }
}
