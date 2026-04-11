import { createCodexHeadlessProvider } from 'src/services/codex/runHeadlessCodex.js'
import { isCodexHeadlessEnabled } from 'src/services/codex/config.js'
import type { HeadlessProvider } from './provider.js'

export function getHeadlessProviderRegistry(): HeadlessProvider[] {
  return [createCodexHeadlessProvider()]
}

function getConfiguredHeadlessProviderId(): string | null {
  if (isCodexHeadlessEnabled()) {
    return 'codex'
  }

  return null
}

export function resolveHeadlessProvider(): HeadlessProvider | null {
  const providerId = getConfiguredHeadlessProviderId()
  if (!providerId) {
    return null
  }

  return (
    getHeadlessProviderRegistry().find(
      provider => provider.metadata.id === providerId,
    ) ?? null
  )
}

export function shouldSkipRemoteMcpBootstrapForHeadlessProvider(
  provider: HeadlessProvider | null,
): boolean {
  return provider?.metadata.id === 'codex'
}
