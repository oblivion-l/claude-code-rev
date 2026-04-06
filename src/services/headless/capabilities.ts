import type { HeadlessProvider } from './provider.js'

export function providerSupportsStructuredOutput(
  provider: HeadlessProvider,
): boolean {
  return provider.capabilities.supportsStructuredOutput
}

export function providerSupportsResume(provider: HeadlessProvider): boolean {
  return provider.capabilities.supportsResume
}
