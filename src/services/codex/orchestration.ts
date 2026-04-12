import {
  analyzeCodexFunctionToolVisibility,
  createCodexFunctionToolExecutor,
  mapCodexFunctionTools,
  type CodexFunctionToolExecutor,
} from './toolBridge.js'
import type { CodexToolingMode } from './capabilities.js'
import { TOOL_SEARCH_TOOL_NAME } from 'src/tools/ToolSearchTool/constants.js'
import {
  resolveCodexToolingRequestPlan,
  type CodexToolingRequestPlan,
} from './requestPolicy.js'
import type { CodexMcpTool, CodexRequestTool } from './types.js'
import type { CodexToolRuntime } from './toolRuntime.js'

export const CODEX_MAX_LOCAL_TOOL_CALL_ROUNDS = 8

export type CodexToolingSource =
  | 'local'
  | 'mcp-bridge'
  | 'remote-mcp'
  | 'tool-search'

export type CodexToolingUsage = {
  usedMcpTools: boolean
  usedBridgedMcpTools: boolean
  usedLocalFunctionTools: boolean
  usedToolSearch: boolean
  usedFunctionTools: boolean
  sources: CodexToolingSource[]
}

export type CodexToolOrchestration = {
  requestPlan: CodexToolingRequestPlan
  requestTools: CodexRequestTool[]
  functionToolExecutor: CodexFunctionToolExecutor | null
  toolingUsage: CodexToolingUsage
}

export function summarizeCodexRequestTooling(
  requestTools: CodexRequestTool[],
): CodexToolingUsage {
  const usedMcpTools = requestTools.some(tool => tool.type === 'mcp')
  const usedBridgedMcpTools = requestTools.some(
    tool => tool.type === 'function' && tool.name.startsWith('mcp__'),
  )
  const usedToolSearch = requestTools.some(
    tool => tool.type === 'function' && tool.name === TOOL_SEARCH_TOOL_NAME,
  )
  const usedLocalFunctionTools = requestTools.some(
    tool =>
      tool.type === 'function' &&
      !tool.name.startsWith('mcp__') &&
      tool.name !== TOOL_SEARCH_TOOL_NAME,
  )
  const sources: CodexToolingSource[] = []

  if (usedLocalFunctionTools) {
    sources.push('local')
  }

  if (usedBridgedMcpTools) {
    sources.push('mcp-bridge')
  }

  if (usedMcpTools) {
    sources.push('remote-mcp')
  }

  if (usedToolSearch) {
    sources.push('tool-search')
  }

  return {
    usedMcpTools,
    usedBridgedMcpTools,
    usedLocalFunctionTools,
    usedToolSearch,
    usedFunctionTools: requestTools.some(tool => tool.type === 'function'),
    sources,
  }
}

export function buildMissingCodexLocalToolRuntimeMessage(
  mode: CodexToolingMode,
): string {
  return mode === 'repl'
    ? 'Codex REPL received a function tool call, but no local tool runtime is available.'
    : 'Codex provider received a function tool call, but no local tool runtime is available.'
}

export async function buildCodexRequestTools(args: {
  requestPlan: CodexToolingRequestPlan
  runtime?: CodexToolRuntime
  mcpTools?: CodexMcpTool[]
  model: string
  discoveredToolNames?: Set<string>
  discoveredToolSignatures?: Map<string, string>
}): Promise<CodexRequestTool[]> {
  const functionEnabledTools =
    args.requestPlan.enabled.localFunctionTools && args.runtime
      ? analyzeCodexFunctionToolVisibility(args.runtime.tools, args.runtime, {
          discoveredToolNames: args.discoveredToolNames,
          discoveredToolSignatures: args.discoveredToolSignatures,
        })
          .filter(visibility => visibility.selected)
          .map(visibility => visibility.tool)
      : []
  const functionTools =
    args.runtime && functionEnabledTools.length > 0
      ? await mapCodexFunctionTools({
          tools: functionEnabledTools,
          runtime: args.runtime,
          model: args.model,
        })
      : []

  const nonToolSearchFunctionTools = functionTools.filter(
    tool => tool.name !== TOOL_SEARCH_TOOL_NAME,
  )
  const toolSearchFunctionTools = functionTools.filter(
    tool => tool.name === TOOL_SEARCH_TOOL_NAME,
  )

  return [
    ...nonToolSearchFunctionTools,
    ...(args.requestPlan.enabled.remoteMcpTools
      ? (args.mcpTools ?? [])
      : []),
    ...toolSearchFunctionTools,
  ]
}

export function requireCodexFunctionToolExecutor(args: {
  functionToolExecutor: CodexFunctionToolExecutor | null
  mode: CodexToolingMode
}): CodexFunctionToolExecutor {
  if (!args.functionToolExecutor) {
    throw new Error(buildMissingCodexLocalToolRuntimeMessage(args.mode))
  }

  return args.functionToolExecutor
}

export async function prepareCodexToolOrchestration(args: {
  mode: CodexToolingMode
  model: string
  runtime?: CodexToolRuntime
  mcpTools?: CodexMcpTool[]
  abortController: AbortController
  discoveredToolNames?: Set<string>
  discoveredToolSignatures?: Map<string, string>
}): Promise<CodexToolOrchestration> {
  const requestPlan = resolveCodexToolingRequestPlan({
    mode: args.mode,
    model: args.model,
    runtime: args.runtime,
    mcpTools: args.mcpTools,
  })
  const requestTools = await buildCodexRequestTools({
    requestPlan,
    runtime: args.runtime,
    mcpTools: args.mcpTools,
    model: args.model,
    discoveredToolNames: args.discoveredToolNames,
    discoveredToolSignatures: args.discoveredToolSignatures,
  })

  return {
    requestPlan,
    requestTools,
    functionToolExecutor:
      args.runtime && requestPlan.enabled.localFunctionTools
        ? createCodexFunctionToolExecutor({
            runtime: args.runtime,
            tools: args.runtime.tools,
            model: args.model,
            abortController: args.abortController,
          })
        : null,
    toolingUsage: summarizeCodexRequestTooling(requestTools),
  }
}
