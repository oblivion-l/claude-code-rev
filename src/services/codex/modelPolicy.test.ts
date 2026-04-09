import { describe, expect, it } from 'bun:test'
import {
  getCodexModelPolicy,
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
})
