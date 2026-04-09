type CodexApiErrorBody = {
  error?: {
    message?: string
    type?: string
    param?: string | null
    code?: string | null
  }
  message?: string
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

export function formatCodexApiError({
  status,
  body,
  model,
  usedStructuredOutput,
  usedMcpTools,
}: {
  status: number
  body: CodexApiErrorBody
  model: string
  usedStructuredOutput: boolean
  usedMcpTools?: boolean
}): string {
  const message = getErrorMessage(body)
  const errorType = body.error?.type
  const errorParam = body.error?.param ?? undefined
  const errorCode = body.error?.code ?? undefined

  if (
    errorCode === 'model_not_found' ||
    errorParam === 'model' ||
    message?.toLowerCase().includes('model') &&
      message.toLowerCase().includes('not supported')
  ) {
    return `Codex model ${model} is not supported for this request: ${message ?? `HTTP ${status}`}`
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
    return `Codex structured outputs are not supported for model ${model} or this API parameter set: ${message ?? `HTTP ${status}`}`
  }

  if (
    usedStructuredOutput &&
    errorType === 'invalid_request_error' &&
    status >= 400 &&
    status < 500
  ) {
    return `Codex structured output request was rejected by the API for model ${model}: ${message ?? `HTTP ${status}`}`
  }

  if (
    usedMcpTools &&
    (
      errorCode === 'unsupported_parameter' ||
      errorParam?.startsWith('tools') ||
      errorParam?.startsWith('tool_choice') ||
      message?.toLowerCase().includes('mcp') ||
      message?.toLowerCase().includes('tool type') &&
        message.toLowerCase().includes('not supported')
    )
  ) {
    return `Codex MCP tools are not supported for model ${model} or this API parameter set: ${message ?? `HTTP ${status}`}`
  }

  if (message) {
    return `Codex API error (${status}): ${message}`
  }

  return `Codex API error (${status}): Unknown error`
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
