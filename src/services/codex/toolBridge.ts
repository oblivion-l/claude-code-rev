import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { randomUUID } from 'crypto'
import { runToolUse } from 'src/services/tools/toolExecution.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
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
import { TOOL_SEARCH_TOOL_NAME } from 'src/tools/ToolSearchTool/constants.js'
import { isDeferredTool } from 'src/tools/ToolSearchTool/prompt.js'
import { isCodexMcpConfigHandledByLocalBridge } from './mcp.js'
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

const CODEX_FUNCTION_TOOL_SOURCE_PRIORITY = {
  local: 400,
  'mcp-bridge': 300,
  'tool-search': 100,
} as const

export type CodexFunctionToolSource =
  keyof typeof CODEX_FUNCTION_TOOL_SOURCE_PRIORITY

export type CodexFunctionToolVisibility = {
  tool: Tool
  name: string
  source: CodexFunctionToolSource
  priority: number
  deferred: boolean
  discovered: boolean
  recovered: boolean
  selected: boolean
  reason:
    | 'always-visible'
    | 'discovered-match'
    | 'discovered-legacy'
    | 'awaiting-tool-search'
    | 'stale-discovery'
    | 'duplicate-lower-priority'
    | 'tool-search-for-deferred'
  signature?: string
}

function getCodexBridgeMcpClientForTool(
  tool: Tool,
  runtime?: CodexToolRuntime,
): MCPServerConnection | null {
  if (!tool.isMcp || !tool.mcpInfo || !runtime) {
    return null
  }

  const matchingClients = runtime.mcpClients.filter(
    candidate => candidate.name === tool.mcpInfo?.serverName,
  )
  const connectedClient = matchingClients.find(
    candidate => candidate.type === 'connected',
  )
  const client = connectedClient ?? matchingClients[0]

  if (!client) {
    return null
  }

  return isCodexMcpConfigHandledByLocalBridge(client.config) ? client : null
}

function isCodexLocalBridgeMcpTool(
  tool: Tool,
  runtime?: CodexToolRuntime,
): boolean {
  return getCodexBridgeMcpClientForTool(tool, runtime) !== null
}

function isCodexToolSearchTool(tool: Tool): boolean {
  return tool.name === TOOL_SEARCH_TOOL_NAME
}

function getCodexFunctionToolSource(
  tool: Tool,
  runtime?: CodexToolRuntime,
): CodexFunctionToolSource | null {
  if (isCodexToolSearchTool(tool)) {
    return 'tool-search'
  }

  if (isCodexLocalBridgeMcpTool(tool, runtime)) {
    return 'mcp-bridge'
  }

  if (CODEX_LOCAL_TOOL_ALLOWLIST.has(tool.name)) {
    return 'local'
  }

  return null
}

function isCodexFunctionToolEligible(
  tool: Tool,
  runtime?: CodexToolRuntime,
): boolean {
  if (!getCodexFunctionToolSource(tool, runtime)) {
    return false
  }

  if (!tool.isEnabled()) {
    return false
  }

  if (tool.requiresUserInteraction?.()) {
    return false
  }

  return true
}

function getConnectedCodexMcpClientForTool(
  tool: Tool,
  runtime?: CodexToolRuntime,
): Extract<MCPServerConnection, { type: 'connected' }> | null {
  if (!tool.isMcp || !tool.mcpInfo || !runtime) {
    return null
  }

  const client = runtime.mcpClients.find(
    candidate =>
      candidate.type === 'connected' &&
      candidate.name === tool.mcpInfo?.serverName,
  )

  return (client as Extract<MCPServerConnection, { type: 'connected' }>) ?? null
}

function getCodexFunctionToolSignature(
  tool: Tool,
  runtime?: CodexToolRuntime,
): string | undefined {
  const source = getCodexFunctionToolSource(tool, runtime)
  if (!source) {
    return undefined
  }

  if (source === 'local' || source === 'tool-search') {
    return `${source}:${tool.name}`
  }

  const client = getConnectedCodexMcpClientForTool(tool, runtime)
  if (!client) {
    return undefined
  }

  const config = client.config
  const transport = config.type ?? 'stdio'
  if (transport === 'stdio' || transport === undefined) {
    return [
      source,
      tool.name,
      tool.mcpInfo?.serverName ?? 'unknown',
      transport,
      config.scope,
      config.pluginSource ?? '',
      config.command,
      ...(config.args ?? []),
    ].join(':')
  }

  return [
    source,
    tool.name,
    tool.mcpInfo?.serverName ?? 'unknown',
    transport,
    config.scope,
    config.pluginSource ?? '',
    'url' in config ? config.url : '',
    'id' in config ? config.id : '',
    'name' in config ? config.name : '',
  ].join(':')
}

function getCodexFunctionToolBaseVisibility(args: {
  tool: Tool
  runtime?: CodexToolRuntime
  discoveredToolNames: Set<string>
  discoveredToolSignatures: Map<string, string>
}): Omit<CodexFunctionToolVisibility, 'selected' | 'reason'> & {
  baseVisible: boolean
  baseReason: CodexFunctionToolVisibility['reason']
} | null {
  const source = getCodexFunctionToolSource(args.tool, args.runtime)
  if (!source || !isCodexFunctionToolEligible(args.tool, args.runtime)) {
    return null
  }

  const deferred = isDeferredTool(args.tool)
  const discovered = args.discoveredToolNames.has(args.tool.name)
  const signature = getCodexFunctionToolSignature(args.tool, args.runtime)
  const discoveredSignature = args.discoveredToolSignatures.get(args.tool.name)

  if (source === 'tool-search') {
    return {
      tool: args.tool,
      name: args.tool.name,
      source,
      priority: CODEX_FUNCTION_TOOL_SOURCE_PRIORITY[source],
      deferred,
      discovered,
      recovered: false,
      signature,
      baseVisible: false,
      baseReason: 'tool-search-for-deferred',
    }
  }

  if (!deferred) {
    return {
      tool: args.tool,
      name: args.tool.name,
      source,
      priority: CODEX_FUNCTION_TOOL_SOURCE_PRIORITY[source],
      deferred,
      discovered,
      recovered: false,
      signature,
      baseVisible: true,
      baseReason: 'always-visible',
    }
  }

  if (!discovered) {
    return {
      tool: args.tool,
      name: args.tool.name,
      source,
      priority: CODEX_FUNCTION_TOOL_SOURCE_PRIORITY[source],
      deferred,
      discovered,
      recovered: false,
      signature,
      baseVisible: false,
      baseReason: 'awaiting-tool-search',
    }
  }

  if (source === 'mcp-bridge' && !signature) {
    return {
      tool: args.tool,
      name: args.tool.name,
      source,
      priority: CODEX_FUNCTION_TOOL_SOURCE_PRIORITY[source],
      deferred,
      discovered,
      recovered: false,
      signature,
      baseVisible: false,
      baseReason: 'stale-discovery',
    }
  }

  if (
    discoveredSignature &&
    signature &&
    discoveredSignature !== signature
  ) {
    return {
      tool: args.tool,
      name: args.tool.name,
      source,
      priority: CODEX_FUNCTION_TOOL_SOURCE_PRIORITY[source],
      deferred,
      discovered,
      recovered: false,
      signature,
      baseVisible: false,
      baseReason: 'stale-discovery',
    }
  }

  return {
    tool: args.tool,
    name: args.tool.name,
    source,
    priority: CODEX_FUNCTION_TOOL_SOURCE_PRIORITY[source],
    deferred,
    discovered,
    recovered: Boolean(discoveredSignature && signature),
    signature,
    baseVisible: true,
    baseReason: discoveredSignature
      ? 'discovered-match'
      : 'discovered-legacy',
  }
}

export function getCodexDiscoveredToolSignatureMap(
  tools: Tools,
  runtime?: CodexToolRuntime,
): Map<string, string> {
  const signatures = new Map<string, string>()
  const visibilities = analyzeCodexFunctionToolVisibility(tools, runtime, {
    discoveredToolNames: new Set<string>(),
    discoveredToolSignatures: new Map<string, string>(),
  })

  for (const visibility of visibilities) {
    if (!visibility.signature || signatures.has(visibility.name)) {
      continue
    }

    signatures.set(visibility.name, visibility.signature)
  }

  return signatures
}

export function analyzeCodexFunctionToolVisibility(
  tools: Tools,
  runtime?: CodexToolRuntime,
  options?: {
    discoveredToolNames?: Set<string>
    discoveredToolSignatures?: Map<string, string>
  },
): CodexFunctionToolVisibility[] {
  const discoveredToolNames = options?.discoveredToolNames ?? new Set<string>()
  const discoveredToolSignatures =
    options?.discoveredToolSignatures ?? new Map<string, string>()
  const baseCandidates = tools
    .map(tool =>
      getCodexFunctionToolBaseVisibility({
        tool,
        runtime,
        discoveredToolNames,
        discoveredToolSignatures,
      }),
    )
    .filter((value): value is NonNullable<typeof value> => value !== null)

  const toolSearchCandidates = baseCandidates.filter(
    candidate => candidate.source === 'tool-search',
  )
  const nonToolSearchCandidates = baseCandidates
    .filter(candidate => candidate.source !== 'tool-search')
    .map(candidate => {
      if (
        toolSearchCandidates.length === 0 &&
        candidate.baseReason === 'awaiting-tool-search' &&
        candidate.signature
      ) {
        return {
          ...candidate,
          baseVisible: true,
          baseReason: 'always-visible' as const,
        }
      }

      return candidate
    })
  const groupedCandidates = new Map<string, typeof nonToolSearchCandidates>()
  for (const candidate of nonToolSearchCandidates) {
    const group = groupedCandidates.get(candidate.name) ?? []
    group.push(candidate)
    groupedCandidates.set(candidate.name, group)
  }

  const dedupedValues: CodexFunctionToolVisibility[] = []
  for (const group of groupedCandidates.values()) {
    const sortedGroup = [...group].sort((left, right) => {
      const leftRank = left.baseVisible ? 1 : 0
      const rightRank = right.baseVisible ? 1 : 0
      if (leftRank !== rightRank) {
        return rightRank - leftRank
      }

      if (left.priority !== right.priority) {
        return right.priority - left.priority
      }

      return left.name.localeCompare(right.name)
    })
    const leader = sortedGroup[0]
    if (!leader) {
      continue
    }

    dedupedValues.push({
      tool: leader.tool,
      name: leader.name,
      source: leader.source,
      priority: leader.priority,
      deferred: leader.deferred,
      discovered: leader.discovered,
      recovered: leader.recovered && leader.baseVisible,
      signature: leader.signature,
      selected: leader.baseVisible,
      reason: leader.baseReason,
    })

    for (const duplicate of sortedGroup.slice(1)) {
      dedupedValues.push({
        tool: duplicate.tool,
        name: duplicate.name,
        source: duplicate.source,
        priority: duplicate.priority,
        deferred: duplicate.deferred,
        discovered: duplicate.discovered,
        recovered: false,
        signature: duplicate.signature,
        selected: false,
        reason: 'duplicate-lower-priority',
      })
    }
  }

  const hasDeferredCandidates = dedupedValues.some(
    candidate => candidate.deferred,
  )
  const toolSearchVisibilities = hasDeferredCandidates
    ? toolSearchCandidates.map(candidate => ({
        tool: candidate.tool,
        name: candidate.name,
        source: candidate.source,
        priority: candidate.priority,
        deferred: candidate.deferred,
        discovered: candidate.discovered,
        recovered: false,
        signature: candidate.signature,
        selected: true,
        reason: 'tool-search-for-deferred' as const,
      }))
    : []

  return [...dedupedValues, ...toolSearchVisibilities].sort((left, right) => {
    if (left.selected !== right.selected) {
      return left.selected ? -1 : 1
    }

    if (left.priority !== right.priority) {
      return right.priority - left.priority
    }

    return left.name.localeCompare(right.name)
  })
}

export function selectCodexFunctionTools(
  tools: Tools,
  runtime?: CodexToolRuntime,
  options?: {
    discoveredToolNames?: Set<string>
    discoveredToolSignatures?: Map<string, string>
  },
): Tools {
  return analyzeCodexFunctionToolVisibility(tools, runtime, options)
    .filter(visibility => visibility.selected)
    .map(visibility => visibility.tool)
}

export async function mapCodexFunctionTools(args: {
  tools: Tools
  runtime: CodexToolRuntime
  model: string
}): Promise<CodexFunctionTool[]> {
  return Promise.all(
    args.tools.map(async tool => {
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
  execute(functionCalls: CodexFunctionCall[]): Promise<{
    outputs: CodexFunctionCallOutput[]
    selectedToolNames: string[]
  }>
}

function parseSelectedToolNamesFromOutput(outputText: string): string[] {
  try {
    const parsed = JSON.parse(outputText)
    if (
      parsed &&
      typeof parsed === 'object' &&
      'matches' in parsed &&
      Array.isArray(parsed.matches)
    ) {
      return parsed.matches.filter(
        (match): match is string => typeof match === 'string',
      )
    }
  } catch {
    // Ignore non-JSON tool outputs.
  }

  return []
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
}): Promise<{
  outputs: CodexFunctionCallOutput[]
  selectedToolNames: string[]
}> {
  const messages: Message[] = []
  const toolUseContext = buildHeadlessToolUseContext({
    runtime: args.runtime,
    model: args.model,
    tools: args.runtime.tools,
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
}): Promise<{
  outputs: CodexFunctionCallOutput[]
  selectedToolNames: string[]
}> {
  const outputs: CodexFunctionCallOutput[] = []
  const selectedToolNames = new Set<string>()

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

    if (call.name === TOOL_SEARCH_TOOL_NAME) {
      for (const toolName of parseSelectedToolNamesFromOutput(outputText)) {
        selectedToolNames.add(toolName)
      }
    }
  }

  return {
    outputs,
    selectedToolNames: [...selectedToolNames],
  }
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
