import type { ReplProvider } from 'src/services/repl/provider.js'

export function createCodexReplProvider(): ReplProvider {
  return {
    metadata: {
      id: 'codex',
      displayName: 'Codex',
    },
    capabilities: {
      supportsContinue: false,
      supportsResume: false,
      supportsPersistedState: false,
      supportsTools: false,
    },
  }
}
