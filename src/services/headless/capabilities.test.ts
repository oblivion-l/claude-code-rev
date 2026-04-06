import { describe, expect, it } from 'bun:test'
import { createCodexHeadlessProvider } from 'src/services/codex/runHeadlessCodex.js'
import {
  getProviderMultiTurnUnsupportedMessage,
  providerSupportsConversationState,
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

  it('reads the Codex conversation-state capability', () => {
    const provider = createCodexHeadlessProvider()

    expect(providerSupportsConversationState(provider)).toBe(false)
  })

  it('returns the stable multi-turn unsupported message for Codex', () => {
    const provider = createCodexHeadlessProvider()

    expect(
      getProviderMultiTurnUnsupportedMessage(provider, {
        continue: true,
        resume: undefined,
        resumeSessionAt: undefined,
      }),
    ).toBe(
      'Codex provider currently only supports fresh single-turn --print requests. Resume/continue is not supported.',
    )
  })

  it('returns null when no multi-turn parameters are requested', () => {
    const provider = createCodexHeadlessProvider()

    expect(
      getProviderMultiTurnUnsupportedMessage(provider, {
        continue: undefined,
        resume: undefined,
        resumeSessionAt: undefined,
      }),
    ).toBeNull()
  })
})
