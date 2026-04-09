import { describe, expect, it } from 'bun:test'
import {
  getCodexModelPolicy,
  getCodexModelPolicyOverrides,
  modelSupportsCodexStructuredOutput,
} from './modelPolicy.js'

describe('modelSupportsCodexStructuredOutput', () => {
  it('keeps GPT-5/Codex structured output allowlist behavior stable', () => {
    expect(modelSupportsCodexStructuredOutput('gpt-5-codex')).toBe(true)
    expect(modelSupportsCodexStructuredOutput('gpt-5.3-codex')).toBe(true)
    expect(modelSupportsCodexStructuredOutput('gpt-5.4')).toBe(true)
    expect(modelSupportsCodexStructuredOutput('gpt-4o-mini')).toBe(false)
  })
})

describe('getCodexModelPolicy', () => {
  it('returns a stable default model policy scaffold', () => {
    expect(getCodexModelPolicy('gpt-5-codex')).toEqual({
      model: 'gpt-5-codex',
      supportsStructuredOutput: true,
      supportsRemoteMcpTools: true,
      supportsLocalFunctionTools: true,
      supportsMixedTooling: true,
    })
  })

  it('falls back to the default model policy when no override matches', () => {
    expect(getCodexModelPolicy('gpt-4o-mini')).toEqual({
      model: 'gpt-4o-mini',
      supportsStructuredOutput: false,
      supportsRemoteMcpTools: true,
      supportsLocalFunctionTools: true,
      supportsMixedTooling: true,
    })
  })
})

describe('getCodexModelPolicyOverrides', () => {
  it('exposes the prefix-based override registry for future model extensions', () => {
    expect(getCodexModelPolicyOverrides()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          matchPrefix: 'gpt-5-codex',
        }),
        expect.objectContaining({
          matchPrefix: 'gpt-5',
        }),
      ]),
    )
  })
})
