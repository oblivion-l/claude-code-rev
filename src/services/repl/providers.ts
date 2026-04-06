import { createCodexReplProvider } from 'src/services/codex/runReplCodex.js'
import { isCodexHeadlessEnabled } from 'src/services/codex/config.js'
import type { ReplProvider } from './provider.js'

export function getReplProviderRegistry(): ReplProvider[] {
  return [createCodexReplProvider()]
}

function getConfiguredReplProviderId(): string | null {
  if (isCodexHeadlessEnabled()) {
    return 'codex'
  }

  return null
}

export function resolveReplProvider(): ReplProvider | null {
  const providerId = getConfiguredReplProviderId()
  if (!providerId) {
    return null
  }

  return (
    getReplProviderRegistry().find(
      provider => provider.metadata.id === providerId,
    ) ?? null
  )
}
