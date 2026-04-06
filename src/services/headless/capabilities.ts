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
  if (options.resume || options.resumeSessionAt) {
    if (!providerSupportsResume(provider)) {
      return {
        ok: false,
        message: `${provider.metadata.displayName} provider currently only supports fresh single-turn --print requests. Resume/continue is not supported.`,
        errorCode: getHeadlessProviderUnsupportedModeCode(),
      }
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
        message: `${provider.metadata.displayName} provider continue requested but no in-process conversation state is available. Continue only works within the same process.`,
        errorCode: getHeadlessProviderInvalidInputCode(),
      }
    }
  }

  return {
    ok: true,
    conversationState,
  }
}
