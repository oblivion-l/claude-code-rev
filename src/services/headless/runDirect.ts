import type { StructuredIO } from 'src/cli/structuredIO.js'
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
  buildCodexResumeMissingStateMessage,
} from '../codex/sessionText.js'

type DirectStructuredIO = Pick<StructuredIO, 'write'>

function createDirectStructuredIO(): DirectStructuredIO {
  return {
    async write(message: unknown) {
      writeToStdout(jsonStringify(message) + '\n')
    },
  }
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
