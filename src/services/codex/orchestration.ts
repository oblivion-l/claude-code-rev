import {
  createCodexFunctionToolExecutor,
  mapCodexFunctionTools,
  selectCodexFunctionTools,
  type CodexFunctionToolExecutor,
} from './toolBridge.js'
import type { CodexToolingMode } from './capabilities.js'
import {
  resolveCodexToolingRequestPlan,
  type CodexToolingRequestPlan,
} from './requestPolicy.js'
import type { CodexMcpTool, CodexRequestTool } from './types.js'
import type { CodexToolRuntime } from './toolRuntime.js'

export const CODEX_MAX_LOCAL_TOOL_CALL_ROUNDS = 8

export type CodexToolingUsage = {
  usedMcpTools: boolean
  usedFunctionTools: boolean
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
  return {
    usedMcpTools: requestTools.some(tool => tool.type === 'mcp'),
    usedFunctionTools: requestTools.some(tool => tool.type === 'function'),
  }
}

export function buildMissingCodexLocalToolRuntimeMessage(
  mode: CodexToolingMode,
): string {
  return mode === 'repl'
    ? 'Codex REPL received a function tool call, but no local tool runtime is available.'
    : 'Codex provider received a function tool call, but no local tool runtime is available.'
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
}): Promise<CodexToolOrchestration> {
  const requestPlan = resolveCodexToolingRequestPlan({
    mode: args.mode,
    model: args.model,
    runtime: args.runtime,
    mcpTools: args.mcpTools,
  })

  const functionEnabledTools =
    requestPlan.enabled.localFunctionTools && args.runtime
    ? selectCodexFunctionTools(args.runtime.tools)
    : []
  const functionTools =
    args.runtime && functionEnabledTools.length > 0
      ? await mapCodexFunctionTools({
          tools: functionEnabledTools,
          runtime: args.runtime,
          model: args.model,
        })
      : []

  const requestTools = [
    ...(requestPlan.enabled.remoteMcpTools
      ? (args.mcpTools ?? [])
      : []),
    ...functionTools,
  ]

  return {
    requestPlan,
    requestTools,
    functionToolExecutor:
      args.runtime && functionEnabledTools.length > 0
        ? createCodexFunctionToolExecutor({
            runtime: args.runtime,
            tools: functionEnabledTools,
            model: args.model,
            abortController: args.abortController,
          })
        : null,
    toolingUsage: summarizeCodexRequestTooling(requestTools),
  }
}
