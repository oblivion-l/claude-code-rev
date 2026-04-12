import type { StructuredIO } from 'src/cli/structuredIO.js'
import { randomUUID } from 'crypto'
import { getSessionId } from 'src/bootstrap/state.js'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { registerProcessOutputErrorHandlers, writeToStdout } from 'src/utils/process.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import {
  HeadlessConversationStateError,
  type PersistedHeadlessConversationStateDiagnostics,
  resolvePersistedHeadlessConversationStateWithRepair,
  setHeadlessConversationState,
} from './conversationState.js'
import {
  getHeadlessProviderInvalidInputCode,
  writeHeadlessProviderError,
} from './errors.js'
import type {
  HeadlessProvider,
  HeadlessProviderOptions,
  HeadlessProviderRuntime,
} from './provider.js'
import {
  buildCodexContinueMissingStateMessage,
  buildCodexGlobalFallbackStatusLine,
  buildCodexResumeMissingStateMessage,
} from '../codex/sessionText.js'

type DirectStructuredIO = Pick<StructuredIO, 'write'>

type HeadlessRecoveryDiagnosticEvent = StdoutMessage & {
  subtype: 'codex_session_source'
  message: string
  source_cwd: string
  requested_cwd: string
  reason: string
  error_code: string
  ts: string
}

function createDirectStructuredIO(): DirectStructuredIO {
  return {
    async write(message: unknown) {
      writeToStdout(jsonStringify(message) + '\n')
    },
  }
}

function buildCodexGlobalFallbackNoticeEvent(args: {
  sourceCwd: string
  requestedCwd: string
}): HeadlessRecoveryDiagnosticEvent {
  const ts = new Date().toISOString()

  return {
    type: 'system',
    subtype: 'codex_session_source',
    message: buildCodexGlobalFallbackStatusLine(args),
    source_cwd: args.sourceCwd,
    requested_cwd: args.requestedCwd,
    reason: 'global-fallback',
    error_code: '',
    ts,
    uuid: randomUUID(),
    session_id: getSessionId(),
  }
}

export async function writeHeadlessRecoveryDiagnostic(args: {
  structuredIO: StructuredIO
  outputFormat: string | undefined
  event: HeadlessRecoveryDiagnosticEvent
}): Promise<void> {
  if (args.outputFormat === 'stream-json') {
    await args.structuredIO.write(args.event)
    return
  }

  process.stderr.write(`${args.event.message}\n`)
}

export async function runDirectHeadlessProvider(args: {
  provider: HeadlessProvider
  inputPrompt: string | AsyncIterable<string>
  options: HeadlessProviderOptions
  runtime?: HeadlessProviderRuntime
  structuredIO?: DirectStructuredIO
  cwd?: string
}): Promise<number> {
  registerProcessOutputErrorHandlers()

  const cwd = args.cwd ?? process.cwd()
  const structuredIO = (args.structuredIO ??
    createDirectStructuredIO()) as StructuredIO

  let conversationState = null
  let persistedStateDiagnostics: PersistedHeadlessConversationStateDiagnostics | null =
    null

  try {
    if (typeof args.options.resume === 'string') {
      const resolution = resolvePersistedHeadlessConversationStateWithRepair(
        args.provider.metadata.id,
        {
          stateId: args.options.resume,
        },
      )
      conversationState = resolution.state
      persistedStateDiagnostics = resolution.diagnostics
    } else if (args.options.continue || args.options.resume) {
      const resolution = resolvePersistedHeadlessConversationStateWithRepair(
        args.provider.metadata.id,
        {
          cwd,
        },
      )
      conversationState = resolution.state
      persistedStateDiagnostics = resolution.diagnostics
    }
  } catch (error) {
    if (error instanceof HeadlessConversationStateError) {
      await writeHeadlessProviderError(
        structuredIO,
        args.options.outputFormat,
        error.message,
        getHeadlessProviderInvalidInputCode(),
      )
      return 1
    }

    throw error
  }

  if (
    args.provider.metadata.id === 'codex' &&
    !conversationState &&
    persistedStateDiagnostics?.skippedBrokenCount &&
    (args.options.continue || args.options.resume === true)
  ) {
    const message = args.options.continue
      ? buildCodexContinueMissingStateMessage('provider', {
          skippedBrokenCount: persistedStateDiagnostics.skippedBrokenCount,
        })
      : buildCodexResumeMissingStateMessage('provider', {
          skippedBrokenCount: persistedStateDiagnostics.skippedBrokenCount,
        })
    await writeHeadlessProviderError(
      structuredIO,
      args.options.outputFormat,
      message,
      getHeadlessProviderInvalidInputCode(),
    )
    return 1
  }

  if (
    args.provider.metadata.id === 'codex' &&
    persistedStateDiagnostics?.usedGlobalFallback &&
    (args.options.continue || args.options.resume === true) &&
    conversationState?.cwd &&
    conversationState.cwd !== cwd
  ) {
    await writeHeadlessRecoveryDiagnostic({
      structuredIO,
      outputFormat: args.options.outputFormat,
      event: buildCodexGlobalFallbackNoticeEvent({
        sourceCwd: conversationState.cwd,
        requestedCwd: cwd,
      }),
    })
  }

  const { exitCode, conversationState: nextConversationState } =
    await args.provider.run({
      inputPrompt: args.inputPrompt,
      structuredIO,
      options: args.options,
      conversationState,
      runtime: args.runtime,
    })

  if (nextConversationState) {
    setHeadlessConversationState(
      args.provider.metadata.id,
      nextConversationState,
      {
        cwd,
      },
    )
  }

  return exitCode
}
