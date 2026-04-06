import { randomUUID } from 'crypto'
import type { StructuredIO } from 'src/cli/structuredIO.js'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import type {
  HeadlessConversationState,
  HeadlessProvider,
  HeadlessProviderOptions,
} from 'src/services/headless/provider.js'
import {
  checkProviderContinuationSupport,
  providerSupportsStructuredOutput,
} from 'src/services/headless/capabilities.js'
import {
  buildHeadlessProviderErrorResult,
  getHeadlessProviderExecutionErrorCode,
  getHeadlessProviderInvalidInputCode,
  getHeadlessProviderUnsupportedCapabilityCode,
  getHeadlessProviderUnsupportedModeCode,
  writeHeadlessProviderError,
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
  extractResponseId,
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
  assistantMessageUuid,
}: {
  result: string
  durationMs: number
  usage: NonNullableUsage
  assistantMessageUuid: string
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
    uuid: assistantMessageUuid,
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

export async function runHeadlessCodex({
  inputPrompt,
  structuredIO,
  options,
  conversationState,
}: {
  inputPrompt: string | AsyncIterable<string>
  structuredIO: StructuredIO
  options: HeadlessProviderOptions
  conversationState?: HeadlessConversationState | null
}): Promise<{ exitCode: number; conversationState?: HeadlessConversationState | null }> {
  const provider = createCodexHeadlessProvider()
  const continuationCheck = checkProviderContinuationSupport(
    provider,
    options,
    conversationState,
  )
  if (!continuationCheck.ok) {
    await writeHeadlessProviderError(
      structuredIO,
      options.outputFormat,
      continuationCheck.message,
      continuationCheck.errorCode,
    )
    return { exitCode: 1 }
  }

  const unsupportedModeMessage = buildUnsupportedModeMessage(options)
  if (unsupportedModeMessage) {
    await writeHeadlessProviderError(
      structuredIO,
      options.outputFormat,
      unsupportedModeMessage,
      getHeadlessProviderUnsupportedModeCode(),
    )
    return { exitCode: 1 }
  }

  const prompt = await resolvePrompt(inputPrompt)
  if (!prompt.trim()) {
    await writeHeadlessProviderError(
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
      await writeHeadlessProviderError(
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
      await writeHeadlessProviderError(
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
  const currentSessionId = getSessionId()
  let responseIdForConversationState: string | undefined
  let nextConversationState: HeadlessConversationState | null =
    continuationCheck.conversationState
      ? {
          ...continuationCheck.conversationState,
          history: continuationCheck.conversationState.history ?? [],
        }
      : {
          providerId: provider.metadata.id,
          stateId: currentSessionId,
          conversationId: currentSessionId,
          history: [],
        }

  try {
    const response = await createCodexResponseStream({
      config,
      input: prompt,
      instructions,
      previousResponseId: continuationCheck.conversationState?.lastResponseId,
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
        const responseId = extractResponseId(completedResponse)
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
        if (responseId) {
          responseIdForConversationState = responseId
          nextConversationState = {
            ...(nextConversationState ?? {}),
            providerId: provider.metadata.id,
            lastResponseId: responseId,
          }
        }
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

        const result = buildHeadlessProviderErrorResult({
          error: validation.error,
          durationMs: Date.now() - start,
          errorCode: getHeadlessProviderUnsupportedCapabilityCode(),
        })
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

    const assistantMessageUuid = randomUUID()
    if (responseIdForConversationState) {
      nextConversationState = {
        ...(nextConversationState ?? {}),
        providerId: provider.metadata.id,
        stateId: nextConversationState?.stateId ?? currentSessionId,
        conversationId: nextConversationState?.conversationId ?? currentSessionId,
        lastResponseId: responseIdForConversationState,
        lastAssistantMessageUuid: assistantMessageUuid,
        history: [
          ...(nextConversationState?.history ?? []),
          {
            assistantMessageUuid,
            responseId: responseIdForConversationState,
            createdAt: new Date().toISOString(),
          },
        ],
      }
    }

    const result = buildSuccessResult({
      result: accumulatedText,
      durationMs: Date.now() - start,
      usage,
      assistantMessageUuid,
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

    return {
      exitCode: 0,
      conversationState: nextConversationState,
    }
  } catch (error) {
    const message = isAbortError(error)
      ? 'Request interrupted by user'
      : errorMessage(error)
    const result = buildHeadlessProviderErrorResult({
      error: message,
      durationMs: Date.now() - start,
      errorCode: getHeadlessProviderExecutionErrorCode(),
    })
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

    return {
      exitCode: 1,
      conversationState: nextConversationState,
    }
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
      supportsContinue: true,
      supportsResume: true,
      supportsStructuredOutput: true,
      supportsConversationState: true,
    },
    createConversationState() {
      return {
        providerId: 'codex',
      }
    },
    run: runHeadlessCodex,
  }
}
