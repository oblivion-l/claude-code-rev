import { afterEach, describe, expect, it } from 'bun:test'
import { createCodexHeadlessProvider } from 'src/services/codex/runHeadlessCodex.js'
import {
  getHeadlessProviderRegistry,
  resolveHeadlessProvider,
} from './providers.js'

const originalCodexFlag = process.env.CLAUDE_CODE_USE_CODEX

afterEach(() => {
  if (originalCodexFlag === undefined) {
    delete process.env.CLAUDE_CODE_USE_CODEX
  } else {
    process.env.CLAUDE_CODE_USE_CODEX = originalCodexFlag
  }
})

describe('createCodexHeadlessProvider', () => {
  it('exposes stable provider metadata and capabilities', () => {
    const provider = createCodexHeadlessProvider()

    expect(provider.metadata).toEqual({
      id: 'codex',
      displayName: 'Codex',
    })
    expect(provider.capabilities).toEqual({
      supportsContinue: true,
      supportsResume: false,
      supportsStructuredOutput: true,
      supportsConversationState: true,
    })
    expect(provider.createConversationState?.()).toEqual({
      providerId: 'codex',
    })
  })
})

describe('getHeadlessProviderRegistry', () => {
  it('returns a registry containing the Codex provider', () => {
    expect(getHeadlessProviderRegistry().map(provider => provider.metadata.id)).toEqual([
      'codex',
    ])
  })
})

describe('resolveHeadlessProvider', () => {
  it('returns null when Codex is disabled', () => {
    delete process.env.CLAUDE_CODE_USE_CODEX

    expect(resolveHeadlessProvider()).toBeNull()
  })

  it('returns the Codex provider when Codex is enabled', () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'

    expect(resolveHeadlessProvider()?.metadata.id).toBe('codex')
  })
})
