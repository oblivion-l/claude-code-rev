import {
  createCodexFunctionToolExecutor,
  mapCodexFunctionTools,
  selectCodexFunctionTools,
  type CodexFunctionToolExecutor,
} from './toolBridge.js'
import type { CodexMcpTool, CodexRequestTool } from './types.js'
import type { CodexToolRuntime } from './toolRuntime.js'

export const CODEX_MAX_LOCAL_TOOL_CALL_ROUNDS = 8

export type CodexToolOrchestration = {
  requestTools: CodexRequestTool[]
  functionToolExecutor: CodexFunctionToolExecutor | null
}

export async function prepareCodexToolOrchestration(args: {
  runtime?: CodexToolRuntime
  mcpTools?: CodexMcpTool[]
  model: string
  abortController: AbortController
}): Promise<CodexToolOrchestration> {
  const functionEnabledTools = args.runtime
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

  return {
    requestTools: [
      ...(args.mcpTools ?? []),
      ...functionTools,
    ],
    functionToolExecutor:
      args.runtime && functionEnabledTools.length > 0
        ? createCodexFunctionToolExecutor({
            runtime: args.runtime,
            tools: functionEnabledTools,
            model: args.model,
            abortController: args.abortController,
          })
        : null,
  }
}
