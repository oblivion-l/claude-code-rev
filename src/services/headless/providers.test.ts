import { afterEach, describe, expect, it } from 'bun:test'
import { createCodexHeadlessProvider } from 'src/services/codex/runHeadlessCodex.js'
import { resolveHeadlessProvider } from './providers.js'

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

    expect(provider.id).toBe('codex')
    expect(provider.capabilities).toEqual({
      supportsResume: false,
      supportsStructuredOutput: true,
    })
  })
})

describe('resolveHeadlessProvider', () => {
  it('returns null when Codex is disabled', () => {
    delete process.env.CLAUDE_CODE_USE_CODEX

    expect(resolveHeadlessProvider()).toBeNull()
  })

  it('returns the Codex provider when Codex is enabled', () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'

    expect(resolveHeadlessProvider()?.id).toBe('codex')
  })
})
