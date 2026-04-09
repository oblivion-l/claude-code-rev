import { afterEach, describe, expect, it } from 'bun:test'
import { createCodexReplProvider } from 'src/services/codex/runReplCodex.js'
import {
  getReplProviderRegistry,
  resolveReplProvider,
} from './providers.js'

const originalCodexFlag = process.env.CLAUDE_CODE_USE_CODEX

afterEach(() => {
  if (originalCodexFlag === undefined) {
    delete process.env.CLAUDE_CODE_USE_CODEX
  } else {
    process.env.CLAUDE_CODE_USE_CODEX = originalCodexFlag
  }
})

describe('createCodexReplProvider', () => {
  it('exposes stable provider metadata and capabilities', () => {
    const provider = createCodexReplProvider()

    expect(provider.metadata).toEqual({
      id: 'codex',
      displayName: 'Codex',
    })
    expect(provider.capabilities).toEqual({
      supportsContinue: true,
      supportsResume: true,
      supportsPersistedState: true,
      supportsTools: true,
    })
    expect(typeof provider.launch).toBe('function')
  })
})

describe('getReplProviderRegistry', () => {
  it('returns a registry containing the Codex provider', () => {
    expect(getReplProviderRegistry().map(provider => provider.metadata.id)).toEqual([
      'codex',
    ])
  })
})

describe('resolveReplProvider', () => {
  it('returns null when Codex is disabled', () => {
    delete process.env.CLAUDE_CODE_USE_CODEX

    expect(resolveReplProvider()).toBeNull()
  })

  it('returns the Codex provider when Codex is enabled', () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'

    expect(resolveReplProvider()?.metadata.id).toBe('codex')
  })
})
