import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { randomUUID } from 'crypto'
import { runToolUse } from 'src/services/tools/toolExecution.js'
import type { AssistantMessage, Message, UserMessage } from 'src/types/message.js'
import type { Tool, ToolUseContext, Tools } from 'src/Tool.js'
import { toolToAPISchema } from 'src/utils/api.js'
import {
  READ_FILE_STATE_CACHE_SIZE,
  createFileStateCacheWithSizeLimit,
} from 'src/utils/fileStateCache.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import {
  shouldEnableThinkingByDefault,
} from 'src/utils/thinking.js'
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
import { POWERSHELL_TOOL_NAME } from 'src/tools/PowerShellTool/toolName.js'
import type { CodexToolRuntime } from './toolRuntime.js'
import type {
  CodexFunctionCall,
  CodexFunctionCallOutput,
  CodexFunctionTool,
} from './types.js'

const CODEX_LOCAL_TOOL_ALLOWLIST = new Set([
  FILE_READ_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  BASH_TOOL_NAME,
  POWERSHELL_TOOL_NAME,
])

function isCodexFunctionToolEligible(tool: Tool): boolean {
  if (!CODEX_LOCAL_TOOL_ALLOWLIST.has(tool.name)) {
    return false
  }

  if (tool.isMcp || tool.shouldDefer || !tool.isEnabled()) {
    return false
  }

  if (tool.requiresUserInteraction?.()) {
    return false
  }

  return true
}

export function selectCodexFunctionTools(tools: Tools): Tools {
  return tools.filter(isCodexFunctionToolEligible)
}

export async function mapCodexFunctionTools(args: {
  tools: Tools
  runtime: CodexToolRuntime
  model: string
}): Promise<CodexFunctionTool[]> {
  const eligibleTools = selectCodexFunctionTools(args.tools)

  return Promise.all(
    eligibleTools.map(async tool => {
      const apiSchema = await toolToAPISchema(tool, {
        getToolPermissionContext: async () =>
          args.runtime.getAppState().toolPermissionContext,
        tools: args.tools,
        agents: args.runtime.agents,
        model: args.model,
      })

      return {
        type: 'function',
        name: apiSchema.name,
        description: apiSchema.description,
        parameters: apiSchema.input_schema as Record<string, unknown>,
      } satisfies CodexFunctionTool
    }),
  )
}

function normalizeArgumentsText(argumentsValue: unknown): string {
  if (typeof argumentsValue === 'string') {
    return argumentsValue
  }

  if (argumentsValue && typeof argumentsValue === 'object') {
    return jsonStringify(argumentsValue)
  }

  return '{}'
}

export function extractCodexFunctionCalls(
  response: unknown,
): CodexFunctionCall[] {
  if (
    !response ||
    typeof response !== 'object' ||
    !('output' in response) ||
    !Array.isArray(response.output)
  ) {
    return []
  }

  return response.output.flatMap(item => {
    if (!item || typeof item !== 'object') {
      return []
    }

    if (
      item.type !== 'function_call' ||
      typeof item.name !== 'string' ||
      typeof item.call_id !== 'string'
    ) {
      return []
    }

    return [
      {
        name: item.name,
        callId: item.call_id,
        argumentsText: normalizeArgumentsText(item.arguments),
      },
    ]
  })
}

export type CodexFunctionToolExecutor = {
  execute(functionCalls: CodexFunctionCall[]): Promise<CodexFunctionCallOutput[]>
}

function buildHeadlessToolUseContext(args: {
  runtime: CodexToolRuntime
  model: string
  tools: Tools
  messages: Message[]
  abortController: AbortController
}): ToolUseContext {
  return {
    options: {
      commands: args.runtime.commands,
      debug: false,
      mainLoopModel: args.model,
      tools: args.tools,
      verbose: false,
      thinkingConfig:
        shouldEnableThinkingByDefault() !== false
          ? { type: 'adaptive' }
          : { type: 'disabled' },
      mcpClients: args.runtime.mcpClients,
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: {
        activeAgents: args.runtime.agents,
        allAgents: [],
      },
    },
    abortController: args.abortController,
    readFileState: createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE),
    getAppState: args.runtime.getAppState,
    setAppState: args.runtime.setAppState,
    messages: args.messages,
    nestedMemoryAttachmentTriggers: new Set<string>(),
    loadedNestedMemoryPaths: new Set<string>(),
    dynamicSkillDirTriggers: new Set<string>(),
    discoveredSkillNames: new Set<string>(),
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: updater => {
      args.runtime.setAppState(prev => {
        const nextFileHistory = updater(prev.fileHistory)
        if (nextFileHistory === prev.fileHistory) {
          return prev
        }

        return {
          ...prev,
          fileHistory: nextFileHistory,
        }
      })
    },
    updateAttributionState: updater => {
      args.runtime.setAppState(prev => {
        const nextAttribution = updater(prev.attribution)
        if (nextAttribution === prev.attribution) {
          return prev
        }

        return {
          ...prev,
          attribution: nextAttribution,
        }
      })
    },
  }
}

function createToolUseBlock(
  call: CodexFunctionCall,
  input: Record<string, unknown>,
): ToolUseBlock {
  return {
    type: 'tool_use',
    id: call.callId,
    name: call.name,
    input,
  }
}

function createAssistantToolCallMessage(call: CodexFunctionCall): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    message: {
      id: randomUUID(),
      content: [
        {
          type: 'tool_use',
          id: call.callId,
          name: call.name,
          input: {},
        },
      ],
    },
  }
}

function serializeToolOutput(message: UserMessage): string {
  if (typeof message.toolUseResult === 'string') {
    return message.toolUseResult
  }

  if (message.toolUseResult !== undefined) {
    return jsonStringify(message.toolUseResult)
  }

  const content = message.message.content
  if (!Array.isArray(content)) {
    return 'Tool completed with no output.'
  }

  const toolResultBlock = content.find(
    item =>
      item &&
      typeof item === 'object' &&
      'type' in item &&
      item.type === 'tool_result',
  ) as
    | {
        content?: unknown
      }
    | undefined

  if (!toolResultBlock) {
    return 'Tool completed with no output.'
  }

  if (typeof toolResultBlock.content === 'string') {
    return toolResultBlock.content
  }

  if (toolResultBlock.content !== undefined) {
    return jsonStringify(toolResultBlock.content)
  }

  return 'Tool completed with no output.'
}

function buildInvalidArgumentsOutput(
  call: CodexFunctionCall,
  error: unknown,
): CodexFunctionCallOutput {
  const message =
    error instanceof Error ? error.message : 'Invalid JSON tool arguments'

  return {
    type: 'function_call_output',
    call_id: call.callId,
    output: `Error: Codex tool call ${call.name} returned invalid JSON arguments: ${message}`,
  }
}

export async function executeCodexFunctionCalls(args: {
  runtime: CodexToolRuntime
  tools: Tools
  functionCalls: CodexFunctionCall[]
  model: string
  abortController: AbortController
}): Promise<CodexFunctionCallOutput[]> {
  const messages: Message[] = []
  const toolUseContext = buildHeadlessToolUseContext({
    runtime: args.runtime,
    model: args.model,
    tools: args.tools,
    messages,
    abortController: args.abortController,
  })

  return executeCodexFunctionCallsWithContext({
    functionCalls: args.functionCalls,
    messages,
    toolUseContext,
    canUseTool: args.runtime.canUseTool,
  })
}

async function executeCodexFunctionCallsWithContext(args: {
  functionCalls: CodexFunctionCall[]
  messages: Message[]
  toolUseContext: ToolUseContext
  canUseTool: CodexToolRuntime['canUseTool']
}): Promise<CodexFunctionCallOutput[]> {
  const outputs: CodexFunctionCallOutput[] = []

  for (const call of args.functionCalls) {
    let parsedInput: Record<string, unknown>
    try {
      const parsed = JSON.parse(call.argumentsText)
      parsedInput =
        parsed && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>)
          : {}
    } catch (error) {
      outputs.push(buildInvalidArgumentsOutput(call, error))
      continue
    }

    const assistantMessage = createAssistantToolCallMessage(call)
    const toolUse = createToolUseBlock(call, parsedInput)

    args.messages.push(assistantMessage)

    let outputText = 'Tool completed with no output.'
    for await (const update of runToolUse(
      toolUse,
      assistantMessage,
      args.canUseTool,
      args.toolUseContext,
    )) {
      if (!update.message) {
        continue
      }

      args.messages.push(update.message)
      if (update.message.type === 'user') {
        outputText = serializeToolOutput(update.message)
      }
    }

    outputs.push({
      type: 'function_call_output',
      call_id: call.callId,
      output: outputText,
    })
  }

  return outputs
}

export function createCodexFunctionToolExecutor(args: {
  runtime: CodexToolRuntime
  tools: Tools
  model: string
  abortController: AbortController
}): CodexFunctionToolExecutor {
  const messages: Message[] = []
  const toolUseContext = buildHeadlessToolUseContext({
    runtime: args.runtime,
    model: args.model,
    tools: args.tools,
    messages,
    abortController: args.abortController,
  })

  return {
    async execute(functionCalls: CodexFunctionCall[]) {
      return executeCodexFunctionCallsWithContext({
        functionCalls,
        messages,
        toolUseContext,
        canUseTool: args.runtime.canUseTool,
      })
    },
  }
}
