import type { HeadlessProvider, HeadlessProviderOptions } from './provider.js'

export function providerSupportsStructuredOutput(
  provider: HeadlessProvider,
): boolean {
  return provider.capabilities.supportsStructuredOutput
}

export function providerSupportsResume(provider: HeadlessProvider): boolean {
  return provider.capabilities.supportsResume
}

export function providerSupportsConversationState(
  provider: HeadlessProvider,
): boolean {
  return provider.capabilities.supportsConversationState
}

export function getProviderMultiTurnUnsupportedMessage(
  provider: HeadlessProvider,
  options: Pick<
    HeadlessProviderOptions,
    'continue' | 'resume' | 'resumeSessionAt'
  >,
): string | null {
  if (
    (options.continue || options.resume || options.resumeSessionAt) &&
    !providerSupportsResume(provider)
  ) {
    return `${provider.metadata.displayName} provider currently only supports fresh single-turn --print requests. Resume/continue is not supported.`
  }

  return null
}
