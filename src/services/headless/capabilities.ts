import {
  getHeadlessProviderInvalidInputCode,
  getHeadlessProviderUnsupportedModeCode,
} from './errors.js'
import type {
  HeadlessConversationState,
  HeadlessProvider,
  HeadlessProviderErrorCode,
  HeadlessProviderOptions,
} from './provider.js'

export type HeadlessContinuationGateResult =
  | {
      ok: true
      conversationState?: HeadlessConversationState | null
    }
  | {
      ok: false
      message: string
      errorCode: HeadlessProviderErrorCode
    }

export function providerSupportsStructuredOutput(
  provider: HeadlessProvider,
): boolean {
  return provider.capabilities.supportsStructuredOutput
}

export function providerSupportsContinue(provider: HeadlessProvider): boolean {
  return provider.capabilities.supportsContinue
}

export function providerSupportsResume(provider: HeadlessProvider): boolean {
  return provider.capabilities.supportsResume
}

export function providerSupportsConversationState(
  provider: HeadlessProvider,
): boolean {
  return provider.capabilities.supportsConversationState
}

export function checkProviderContinuationSupport(
  provider: HeadlessProvider,
  options: Pick<
    HeadlessProviderOptions,
    'continue' | 'resume' | 'resumeSessionAt'
  >,
  conversationState?: HeadlessConversationState | null,
): HeadlessContinuationGateResult {
  let resolvedConversationState = conversationState ?? null

  if (options.resume || options.resumeSessionAt) {
    if (
      !providerSupportsResume(provider) ||
      !providerSupportsConversationState(provider)
    ) {
      return {
        ok: false,
        message: `${provider.metadata.displayName} provider does not support --resume or --resume-session-at in this mode.`,
        errorCode: getHeadlessProviderUnsupportedModeCode(),
      }
    }

    if (!resolvedConversationState?.lastResponseId) {
      return {
        ok: false,
        message: `${provider.metadata.displayName} provider resume requested but no persisted conversation state is available.`,
        errorCode: getHeadlessProviderInvalidInputCode(),
      }
    }

    if (options.resumeSessionAt) {
      const matchedTurnIndex =
        resolvedConversationState.history?.findIndex(
          turn => turn.assistantMessageUuid === options.resumeSessionAt,
        ) ?? -1

      if (matchedTurnIndex < 0) {
        return {
          ok: false,
          message: `${provider.metadata.displayName} provider could not find persisted assistant turn ${options.resumeSessionAt} for --resume-session-at.`,
          errorCode: getHeadlessProviderInvalidInputCode(),
        }
      }

      const truncatedHistory =
        resolvedConversationState.history?.slice(0, matchedTurnIndex + 1) ?? []
      const matchedTurn = truncatedHistory[matchedTurnIndex]

      resolvedConversationState = {
        ...resolvedConversationState,
        lastResponseId: matchedTurn.responseId,
        lastAssistantMessageUuid: matchedTurn.assistantMessageUuid,
        history: truncatedHistory,
      }
    }

    return {
      ok: true,
      conversationState: resolvedConversationState,
    }
  }

  if (options.continue) {
    if (
      !providerSupportsContinue(provider) ||
      !providerSupportsConversationState(provider)
    ) {
      return {
        ok: false,
        message: `${provider.metadata.displayName} provider currently does not support continue in this mode.`,
        errorCode: getHeadlessProviderUnsupportedModeCode(),
      }
    }

    if (!conversationState?.lastResponseId) {
      return {
        ok: false,
        message: `${provider.metadata.displayName} provider continue requested but no conversation state is available for the current directory.`,
        errorCode: getHeadlessProviderInvalidInputCode(),
      }
    }

    return {
      ok: true,
      conversationState,
    }
  }

  return {
    ok: true,
    conversationState: null,
  }
}
