import { describe, expect, it } from 'bun:test'
import { createCodexHeadlessProvider } from 'src/services/codex/runHeadlessCodex.js'
import {
  providerSupportsResume,
  providerSupportsStructuredOutput,
} from './capabilities.js'

describe('headless capability helpers', () => {
  it('reads the Codex structured-output capability', () => {
    const provider = createCodexHeadlessProvider()

    expect(providerSupportsStructuredOutput(provider)).toBe(true)
  })

  it('reads the Codex resume capability', () => {
    const provider = createCodexHeadlessProvider()

    expect(providerSupportsResume(provider)).toBe(false)
  })
})
