import type { HeadlessConversationState } from 'src/services/headless/provider.js'

const CODEX_DISCOVERED_TOOLS_METADATA_KEY = 'codexDiscoveredToolNames'

export function getCodexDiscoveredToolNames(
  state?: Pick<HeadlessConversationState, 'metadata'> | null,
): Set<string> {
  const rawValue = state?.metadata?.[CODEX_DISCOVERED_TOOLS_METADATA_KEY]
  if (!Array.isArray(rawValue)) {
    return new Set<string>()
  }

  return new Set(
    rawValue.filter((value): value is string => typeof value === 'string'),
  )
}

export function withCodexDiscoveredToolNames(args: {
  state: HeadlessConversationState
  discoveredToolNames: Set<string>
}): HeadlessConversationState {
  return {
    ...args.state,
    metadata: {
      ...(args.state.metadata ?? {}),
      [CODEX_DISCOVERED_TOOLS_METADATA_KEY]: [...args.discoveredToolNames].sort(),
    },
  }
}
