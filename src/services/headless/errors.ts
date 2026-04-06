import { randomUUID } from 'crypto'
import type { StructuredIO } from 'src/cli/structuredIO.js'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { getSessionId } from 'src/bootstrap/state.js'
import { EMPTY_USAGE } from 'src/services/api/logging.js'
import { writeToStdout } from 'src/utils/process.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import {
  HEADLESS_PROVIDER_ERROR_PREFIX,
  type HeadlessProviderErrorCode,
} from './provider.js'

function buildHeadlessProviderErrorCode(
  suffix: 'UNSUPPORTED_MODE' | 'UNSUPPORTED_CAPABILITY' | 'INVALID_INPUT' | 'EXECUTION_ERROR',
): HeadlessProviderErrorCode {
  return `${HEADLESS_PROVIDER_ERROR_PREFIX}_${suffix}`
}

export function getHeadlessProviderUnsupportedModeCode(): HeadlessProviderErrorCode {
  return buildHeadlessProviderErrorCode('UNSUPPORTED_MODE')
}

export function getHeadlessProviderUnsupportedCapabilityCode(): HeadlessProviderErrorCode {
  return buildHeadlessProviderErrorCode('UNSUPPORTED_CAPABILITY')
}

export function getHeadlessProviderInvalidInputCode(): HeadlessProviderErrorCode {
  return buildHeadlessProviderErrorCode('INVALID_INPUT')
}

export function getHeadlessProviderExecutionErrorCode(): HeadlessProviderErrorCode {
  return buildHeadlessProviderErrorCode('EXECUTION_ERROR')
}

export function buildHeadlessProviderErrorResult({
  error,
  durationMs,
  errorCode,
}: {
  error: string
  durationMs: number
  errorCode: HeadlessProviderErrorCode
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
    validation_error: error,
    error_code: errorCode,
    uuid: randomUUID(),
    session_id: getSessionId(),
  }
}

export async function writeHeadlessProviderError(
  structuredIO: StructuredIO,
  outputFormat: string | undefined,
  message: string,
  errorCode: HeadlessProviderErrorCode,
): Promise<void> {
  const result = buildHeadlessProviderErrorResult({
    error: message,
    durationMs: 0,
    errorCode,
  })

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
