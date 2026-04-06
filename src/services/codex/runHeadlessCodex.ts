import { randomUUID } from 'crypto'
import type { StructuredIO } from 'src/cli/structuredIO.js'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import type {
  HeadlessProvider,
  HeadlessProviderErrorCode,
  HeadlessProviderOptions,
} from 'src/services/headless/provider.js'
import {
  getProviderMultiTurnUnsupportedMessage,
  providerSupportsStructuredOutput,
} from 'src/services/headless/capabilities.js'
import {
  getHeadlessProviderExecutionErrorCode,
  getHeadlessProviderInvalidInputCode,
  getHeadlessProviderUnsupportedCapabilityCode,
  getHeadlessProviderUnsupportedModeCode,
} from 'src/services/headless/errors.js'
import { getSessionId } from 'src/bootstrap/state.js'
import { EMPTY_USAGE } from 'src/services/api/logging.js'
import type { NonNullableUsage } from 'src/entrypoints/sdk/sdkUtilityTypes.js'
import { errorMessage, isAbortError } from 'src/utils/errors.js'
import { writeToStdout } from 'src/utils/process.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import {
  createCodexResponseStream,
  parseCodexSSE,
} from './client.js'
import { getCodexRuntimeConfig } from './config.js'
import {
  compileCodexJsonSchema,
  type CompiledCodexJsonSchema,
  validateCodexStructuredOutput,
} from './schema.js'
import {
  extractCompletedResponse,
  extractResponseText,
  extractTextDelta,
  extractUsage,
  getCodexFailureMessage,
} from './stream.js'

function buildUnsupportedModeMessage(
  options: HeadlessProviderOptions,
): string | null {
  if (options.sdkUrl || options.replayUserMessages || options.includePartialMessages) {
    return 'Codex provider currently only supports local text input in --print mode.'
  }

  if (options.forkSession || options.rewindFiles) {
    return 'Codex provider currently does not support session rewind or fork operations.'
  }

  if (options.agent) {
    return 'Codex provider currently does not support agent-mode execution.'
  }

  return null
}

function buildInstructions({
  systemPrompt,
  appendSystemPrompt,
}: {
  systemPrompt?: string
  appendSystemPrompt?: string
}): string | undefined {
  const parts = [systemPrompt, appendSystemPrompt].filter(
    (value): value is string => Boolean(value?.trim()),
  )

  if (parts.length === 0) {
    return undefined
  }

  return parts.join('\n\n')
}

async function resolvePrompt(inputPrompt: string | AsyncIterable<string>): Promise<string> {
  if (typeof inputPrompt === 'string') {
    return inputPrompt
  }

  throw new Error(
    'Codex provider currently only supports text input. Remove --input-format=stream-json or unset CLAUDE_CODE_USE_CODEX.',
  )
}

function buildStreamEvent(delta: string): StdoutMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'response.output_text.delta',
      delta,
    },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: getSessionId(),
  }
}

function buildSuccessResult({
  result,
  durationMs,
  usage,
}: {
  result: string
  durationMs: number
  usage: NonNullableUsage
}): StdoutMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: durationMs,
    duration_api_ms: durationMs,
    is_error: false,
    num_turns: 1,
    result,
    stop_reason: null,
    total_cost_usd: 0,
    usage,
    modelUsage: {},
    permission_denials: [],
    structured_output: undefined,
    uuid: randomUUID(),
    session_id: getSessionId(),
  }
}

function buildErrorResult({
  error,
  durationMs,
}: {
  error: string
  durationMs: number
}): StdoutMessage {
  return {
    type: 'result',
    subtype: 'error_during_execution',
    duration_ms: durationMs,
    duration_api_ms: durationMs,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: EMPTY_USAGE,
    modelUsage: {},
    permission_denials: [],
    errors: [error],
    validation_error: undefined,
    uuid: randomUUID(),
    session_id: getSessionId(),
  }
}

function buildStructuredOutputEvent({
  parsedResult,
  validationError,
}: {
  parsedResult?: unknown
  validationError?: string
}): StdoutMessage {
  return {
    type: 'system',
    subtype: 'codex_json_schema',
    ...(parsedResult !== undefined ? { parsed_result: parsedResult } : {}),
    ...(validationError ? { validation_error: validationError } : {}),
    uuid: randomUUID(),
    session_id: getSessionId(),
  }
}

async function writeCodexError(
  structuredIO: StructuredIO,
  outputFormat: string | undefined,
  message: string,
  errorCode: HeadlessProviderErrorCode,
): Promise<void> {
  const result = buildErrorResult({
    error: message,
    durationMs: 0,
  })
  result.error_code = errorCode

  if (outputFormat === 'json' || outputFormat === 'stream-json') {
    if (outputFormat === 'json') {
      writeToStdout(jsonStringify(result) + '\n')
    } else {
      await structuredIO.write(result)
    }
    return
  }

  process.stderr.write(`Error: ${message}\n`)
}

export async function runHeadlessCodex({
  inputPrompt,
  structuredIO,
  options,
}: {
  inputPrompt: string | AsyncIterable<string>
  structuredIO: StructuredIO
  options: HeadlessProviderOptions
}): Promise<{ exitCode: number }> {
  const provider = createCodexHeadlessProvider()
  const multiTurnUnsupportedMessage = getProviderMultiTurnUnsupportedMessage(
    provider,
    options,
  )
  if (multiTurnUnsupportedMessage) {
    await writeCodexError(
      structuredIO,
      options.outputFormat,
      multiTurnUnsupportedMessage,
      getHeadlessProviderUnsupportedModeCode(),
    )
    return { exitCode: 1 }
  }

  const unsupportedModeMessage = buildUnsupportedModeMessage(options)
  if (unsupportedModeMessage) {
    await writeCodexError(
      structuredIO,
      options.outputFormat,
      unsupportedModeMessage,
      getHeadlessProviderUnsupportedModeCode(),
    )
    return { exitCode: 1 }
  }

  const prompt = await resolvePrompt(inputPrompt)
  if (!prompt.trim()) {
    await writeCodexError(
      structuredIO,
      options.outputFormat,
      'Input must be provided either through stdin or as a prompt argument when using --print',
      getHeadlessProviderInvalidInputCode(),
    )
    return { exitCode: 1 }
  }

  const config = getCodexRuntimeConfig(options.userSpecifiedModel)
  let compiledSchema: CompiledCodexJsonSchema | undefined
  if (options.jsonSchema) {
    if (!providerSupportsStructuredOutput(provider)) {
      const message =
        'Codex provider currently does not support structured output in this mode.'
      if (options.outputFormat === 'stream-json') {
        await structuredIO.write(
          buildStructuredOutputEvent({
            validationError: message,
          }),
        )
      }
      await writeCodexError(
        structuredIO,
        options.outputFormat,
        message,
        getHeadlessProviderUnsupportedCapabilityCode(),
      )
      return { exitCode: 1 }
    }

    try {
      compiledSchema = compileCodexJsonSchema({
        jsonSchema: options.jsonSchema,
        model: config.model,
      })
    } catch (error) {
      const message = errorMessage(error)
      if (options.outputFormat === 'stream-json') {
        await structuredIO.write(
          buildStructuredOutputEvent({
            validationError: message,
          }),
        )
      }
      await writeCodexError(
        structuredIO,
        options.outputFormat,
        message,
        getHeadlessProviderUnsupportedCapabilityCode(),
      )
      return { exitCode: 1 }
    }
  }

  const instructions = buildInstructions({
    systemPrompt: options.systemPrompt,
    appendSystemPrompt: options.appendSystemPrompt,
  })

  const start = Date.now()
  const abortController = new AbortController()
  const sigintHandler = () => abortController.abort()
  process.on('SIGINT', sigintHandler)

  let accumulatedText = ''
  let usage: NonNullableUsage = EMPTY_USAGE

  try {
    const response = await createCodexResponseStream({
      config,
      input: prompt,
      instructions,
      structuredOutputFormat: compiledSchema?.format,
      signal: abortController.signal,
    })

    for await (const event of parseCodexSSE(response.body!)) {
      const failureMessage = getCodexFailureMessage(event)
      if (failureMessage) {
        throw new Error(failureMessage)
      }

      const delta = extractTextDelta(event)
      if (delta) {
        accumulatedText += delta

        if (options.outputFormat === 'stream-json') {
          await structuredIO.write(buildStreamEvent(delta))
        } else if (options.outputFormat !== 'json' && !compiledSchema) {
          writeToStdout(delta)
        }
      }

      const completedResponse = extractCompletedResponse(event)
      if (completedResponse) {
        const completedText = extractResponseText(completedResponse)
        if (completedText && !accumulatedText) {
          accumulatedText = completedText
          if (
            options.outputFormat !== 'json' &&
            options.outputFormat !== 'stream-json' &&
            !compiledSchema
          ) {
            writeToStdout(completedText)
          }
        }
        usage = extractUsage(completedResponse)
      }
    }

    let structuredOutput: unknown
    if (compiledSchema) {
      const validation = validateCodexStructuredOutput({
        rawText: accumulatedText,
        validate: compiledSchema.validate,
      })

      if (!validation.ok) {
        if (options.outputFormat === 'stream-json') {
          await structuredIO.write(
            buildStructuredOutputEvent({
              validationError: validation.error,
            }),
          )
        }

        const result = buildErrorResult({
          error: validation.error,
          durationMs: Date.now() - start,
        })

        result.error_code = getHeadlessProviderUnsupportedCapabilityCode()
        result.validation_error = validation.error

        switch (options.outputFormat) {
          case 'json':
            writeToStdout(jsonStringify(result) + '\n')
            break
          case 'stream-json':
            await structuredIO.write(result)
            break
          default:
            process.stderr.write(`Error: ${validation.error}\n`)
        }

        return { exitCode: 1 }
      }

      structuredOutput = validation.parsedResult

      if (options.outputFormat === 'stream-json') {
        await structuredIO.write(
          buildStructuredOutputEvent({
            parsedResult: structuredOutput,
          }),
        )
      }
    }

    const result = buildSuccessResult({
      result: accumulatedText,
      durationMs: Date.now() - start,
      usage,
    })
    result.structured_output = structuredOutput

    switch (options.outputFormat) {
      case 'json':
        writeToStdout(jsonStringify(result) + '\n')
        break
      case 'stream-json':
        await structuredIO.write(result)
        break
      default:
        if (compiledSchema) {
          writeToStdout(
            accumulatedText.endsWith('\n')
              ? accumulatedText
              : accumulatedText + '\n',
          )
        } else if (!accumulatedText.endsWith('\n')) {
          writeToStdout('\n')
        }
    }

    return { exitCode: 0 }
  } catch (error) {
    const message = isAbortError(error)
      ? 'Request interrupted by user'
      : errorMessage(error)
    const result = buildErrorResult({
      error: message,
      durationMs: Date.now() - start,
    })
    result.error_code = getHeadlessProviderExecutionErrorCode()
    result.validation_error = message

    switch (options.outputFormat) {
      case 'json':
        writeToStdout(jsonStringify(result) + '\n')
        break
      case 'stream-json':
        await structuredIO.write(result)
        break
      default:
        process.stderr.write(`Error: ${message}\n`)
    }

    return { exitCode: 1 }
  } finally {
    process.off('SIGINT', sigintHandler)
  }
}

export function createCodexHeadlessProvider(): HeadlessProvider {
  return {
    metadata: {
      id: 'codex',
      displayName: 'Codex',
    },
    capabilities: {
      supportsResume: false,
      supportsStructuredOutput: true,
      supportsConversationState: false,
    },
    run: runHeadlessCodex,
  }
}
