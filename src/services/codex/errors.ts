type CodexApiErrorBody = {
  error?: {
    message?: string
    type?: string
    param?: string | null
    code?: string | null
  }
  message?: string
}

export type CodexApiErrorClassification = {
  message: string
  errorCode: string
  hint: string
  category: 'model' | 'structured-output' | 'tooling' | 'api'
  requestedSources: string[]
}

export class CodexApiRequestError extends Error {
  readonly status: number
  readonly errorCode: string
  readonly hint: string
  readonly category: CodexApiErrorClassification['category']
  readonly requestedSources: string[]

  constructor(args: { status: number } & CodexApiErrorClassification) {
    super(args.message)
    this.name = 'CodexApiRequestError'
    this.status = args.status
    this.errorCode = args.errorCode
    this.hint = args.hint
    this.category = args.category
    this.requestedSources = [...args.requestedSources]
  }
}

export function isCodexApiRequestError(
  error: unknown,
): error is CodexApiRequestError {
  return error instanceof CodexApiRequestError
}

function getErrorMessage(body: CodexApiErrorBody): string | undefined {
  if (typeof body.error?.message === 'string') {
    return body.error.message
  }

  if (typeof body.message === 'string') {
    return body.message
  }

  return undefined
}

function messageLooksLikeStructuredOutputIssue(message: string): boolean {
  const normalized = message.toLowerCase()

  return (
    normalized.includes('structured output') ||
    normalized.includes('structured outputs') ||
    normalized.includes('json_schema') ||
    normalized.includes('text.format') ||
    normalized.includes('unsupported parameter')
  )
}

function buildRequestedSources(args: {
  usedMcpTools?: boolean
  usedBridgedMcpTools?: boolean
  usedLocalFunctionTools?: boolean
  usedToolSearch?: boolean
}): string[] {
  const sources: string[] = []

  if (args.usedLocalFunctionTools) {
    sources.push('local')
  }

  if (args.usedBridgedMcpTools) {
    sources.push('mcp-bridge')
  }

  if (args.usedMcpTools) {
    sources.push('remote-mcp')
  }

  if (args.usedToolSearch) {
    sources.push('tool-search')
  }

  return sources
}

export function classifyCodexApiError({
  status,
  body,
  model,
  usedStructuredOutput,
  usedMcpTools,
  usedBridgedMcpTools,
  usedLocalFunctionTools,
  usedToolSearch,
  usedFunctionTools,
}: {
  status: number
  body: CodexApiErrorBody
  model: string
  usedStructuredOutput: boolean
  usedMcpTools?: boolean
  usedBridgedMcpTools?: boolean
  usedLocalFunctionTools?: boolean
  usedToolSearch?: boolean
  usedFunctionTools?: boolean
}): CodexApiErrorClassification {
  const message = getErrorMessage(body)
  const errorType = body.error?.type
  const errorParam = body.error?.param ?? undefined
  const errorCode = body.error?.code ?? undefined
  const effectiveUsedLocalFunctionTools =
    usedLocalFunctionTools ??
    Boolean(
      usedFunctionTools &&
        !usedBridgedMcpTools &&
        !usedToolSearch,
    )
  const requestedSources = buildRequestedSources({
    usedMcpTools,
    usedBridgedMcpTools,
    usedLocalFunctionTools: effectiveUsedLocalFunctionTools,
    usedToolSearch,
  })
  const usedAnyLocalSources =
    Boolean(effectiveUsedLocalFunctionTools) ||
    Boolean(usedBridgedMcpTools) ||
    Boolean(usedToolSearch)

  if (
    errorCode === 'model_not_found' ||
    errorParam === 'model' ||
    message?.toLowerCase().includes('model') &&
      message.toLowerCase().includes('not supported')
  ) {
    return {
      message: `Codex model ${model} is not supported for this request: ${message ?? `HTTP ${status}`}`,
      errorCode: 'CODEX_MODEL_UNSUPPORTED',
      hint: 'switch-model',
      category: 'model',
      requestedSources,
    }
  }

  if (
    usedStructuredOutput &&
    (
      errorCode === 'unsupported_parameter' ||
      errorParam?.startsWith('text.format') ||
      errorParam?.startsWith('response_format') ||
      message &&
        messageLooksLikeStructuredOutputIssue(message)
    )
  ) {
    return {
      message: `Codex structured outputs are not supported for model ${model} or this API parameter set: ${message ?? `HTTP ${status}`}`,
      errorCode: 'CODEX_STRUCTURED_OUTPUT_UNSUPPORTED',
      hint: 'disable-structured-output-or-switch-model',
      category: 'structured-output',
      requestedSources,
    }
  }

  if (
    usedStructuredOutput &&
    errorType === 'invalid_request_error' &&
    status >= 400 &&
    status < 500
  ) {
    return {
      message: `Codex structured output request was rejected by the API for model ${model}: ${message ?? `HTTP ${status}`}`,
      errorCode: 'CODEX_STRUCTURED_OUTPUT_REJECTED',
      hint: 'check-json-schema-or-model',
      category: 'structured-output',
      requestedSources,
    }
  }

  if (
    (usedMcpTools || usedFunctionTools) &&
    (
      errorCode === 'unsupported_parameter' ||
      errorParam?.startsWith('tools') ||
      errorParam?.startsWith('tool_choice') ||
      message?.toLowerCase().includes('mcp') ||
      message?.toLowerCase().includes('tool type') &&
        message.toLowerCase().includes('not supported')
    )
  ) {
    if (usedMcpTools && usedAnyLocalSources) {
      return {
        message: `Codex tools are not supported for model ${model} or this API parameter set: ${message ?? `HTTP ${status}`}`,
        errorCode: 'CODEX_TOOLING_CONFLICT_REMOTE_LOCAL',
        hint: 'disable-remote-mcp-or-local-tools',
        category: 'tooling',
        requestedSources,
      }
    }

    if (usedBridgedMcpTools && effectiveUsedLocalFunctionTools) {
      return {
        message: `Codex tools are not supported for model ${model} or this API parameter set: ${message ?? `HTTP ${status}`}`,
        errorCode: 'CODEX_TOOLING_CONFLICT_LOCAL_BRIDGE',
        hint: 'disable-bridge-or-local-tools',
        category: 'tooling',
        requestedSources,
      }
    }

    if (usedBridgedMcpTools) {
      return {
        message: `Codex locally bridged MCP tools are not supported for model ${model} or this API parameter set: ${message ?? `HTTP ${status}`}`,
        errorCode: 'CODEX_TOOLING_BRIDGED_MCP_UNSUPPORTED',
        hint: 'disable-bridge-or-switch-model',
        category: 'tooling',
        requestedSources,
      }
    }

    if (usedFunctionTools) {
      return {
        message: `Codex local function tools are not supported for model ${model} or this API parameter set: ${message ?? `HTTP ${status}`}`,
        errorCode: 'CODEX_TOOLING_LOCAL_FUNCTION_UNSUPPORTED',
        hint: 'disable-local-tools-or-switch-model',
        category: 'tooling',
        requestedSources,
      }
    }

    return {
      message: `Codex MCP tools are not supported for model ${model} or this API parameter set: ${message ?? `HTTP ${status}`}`,
      errorCode: 'CODEX_TOOLING_REMOTE_MCP_UNSUPPORTED',
      hint: 'disable-remote-mcp-or-switch-model',
      category: 'tooling',
      requestedSources,
    }
  }

  if (message) {
    return {
      message: `Codex API error (${status}): ${message}`,
      errorCode: 'CODEX_API_REQUEST_FAILED',
      hint: 'retry-or-check-api',
      category: 'api',
      requestedSources,
    }
  }

  return {
    message: `Codex API error (${status}): Unknown error`,
    errorCode: 'CODEX_API_REQUEST_FAILED',
    hint: 'retry-or-check-api',
    category: 'api',
    requestedSources,
  }
}

export function formatCodexApiError(
  args: Parameters<typeof classifyCodexApiError>[0],
): string {
  return classifyCodexApiError(args).message
}

export function tryParseCodexApiErrorBody(
  bodyText: string,
): CodexApiErrorBody | null {
  try {
    const parsed = JSON.parse(bodyText)
    if (parsed && typeof parsed === 'object') {
      return parsed as CodexApiErrorBody
    }
  } catch {
    // Fall through to null.
  }

  return null
}
