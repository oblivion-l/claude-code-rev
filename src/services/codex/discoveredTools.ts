import type { HeadlessConversationState } from 'src/services/headless/provider.js'

const CODEX_DISCOVERED_TOOLS_METADATA_KEY = 'codexDiscoveredToolNames'
const CODEX_DISCOVERED_TOOL_SIGNATURES_METADATA_KEY =
  'codexDiscoveredToolSignatures'

export type CodexDiscoveredToolState = {
  names: Set<string>
  signatures: Map<string, string>
}

export function getCodexDiscoveredToolState(
  state?: Pick<HeadlessConversationState, 'metadata'> | null,
): CodexDiscoveredToolState {
  const rawNames = state?.metadata?.[CODEX_DISCOVERED_TOOLS_METADATA_KEY]
  const names = new Set(
    Array.isArray(rawNames)
      ? rawNames.filter((value): value is string => typeof value === 'string')
      : [],
  )

  const rawSignatures =
    state?.metadata?.[CODEX_DISCOVERED_TOOL_SIGNATURES_METADATA_KEY]
  const signatures = new Map<string, string>()
  if (rawSignatures && typeof rawSignatures === 'object') {
    for (const [name, signature] of Object.entries(rawSignatures)) {
      if (typeof signature === 'string' && names.has(name)) {
        signatures.set(name, signature)
      }
    }
  }

  return {
    names,
    signatures,
  }
}

export function getCodexDiscoveredToolNames(
  state?: Pick<HeadlessConversationState, 'metadata'> | null,
): Set<string> {
  return getCodexDiscoveredToolState(state).names
}

export function withCodexDiscoveredToolNames(args: {
  state: HeadlessConversationState
  discoveredToolNames: Set<string>
  discoveredToolSignatures?: Map<string, string>
}): HeadlessConversationState {
  const metadata = {
    ...(args.state.metadata ?? {}),
  }
  delete metadata[CODEX_DISCOVERED_TOOL_SIGNATURES_METADATA_KEY]

  const sortedNames = [...args.discoveredToolNames].sort()
  const signatureEntries = sortedNames.flatMap(name => {
    const signature = args.discoveredToolSignatures?.get(name)
    return typeof signature === 'string' ? [[name, signature] as const] : []
  })

  return {
    ...args.state,
    metadata: {
      ...metadata,
      [CODEX_DISCOVERED_TOOLS_METADATA_KEY]: sortedNames,
      ...(signatureEntries.length > 0
        ? {
            [CODEX_DISCOVERED_TOOL_SIGNATURES_METADATA_KEY]:
              Object.fromEntries(signatureEntries),
          }
        : {}),
    },
  }
}
