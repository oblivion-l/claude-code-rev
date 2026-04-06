import { describe, expect, it } from 'bun:test'
import { createCodexHeadlessProvider } from 'src/services/codex/runHeadlessCodex.js'
import {
  checkProviderContinuationSupport,
  providerSupportsContinue,
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

  it('reads the Codex continue capability', () => {
    const provider = createCodexHeadlessProvider()

    expect(providerSupportsContinue(provider)).toBe(true)
  })

  it('reads the Codex conversation-state capability', () => {
    const provider = createCodexHeadlessProvider()

    expect(providerSupportsConversationState(provider)).toBe(true)
  })

  it('allows continue when in-process state is available', () => {
    const provider = createCodexHeadlessProvider()

    expect(
      checkProviderContinuationSupport(
        provider,
        {
          continue: true,
          resume: undefined,
          resumeSessionAt: undefined,
        },
        {
          providerId: 'codex',
          lastResponseId: 'resp_123',
        },
      ),
    ).toEqual({
      ok: true,
      conversationState: {
        providerId: 'codex',
        lastResponseId: 'resp_123',
      },
    })
  })

  it('fails continue when no in-process state is available', () => {
    const provider = createCodexHeadlessProvider()

    expect(
      checkProviderContinuationSupport(provider, {
        continue: true,
        resume: undefined,
        resumeSessionAt: undefined,
      }),
    ).toEqual({
      ok: false,
      message:
        'Codex provider continue requested but no in-process conversation state is available. Continue only works within the same process.',
      errorCode: 'HEADLESS_PROVIDER_INVALID_INPUT',
    })
  })

  it('keeps resume fail-fast for Codex', () => {
    const provider = createCodexHeadlessProvider()

    expect(
      checkProviderContinuationSupport(provider, {
        continue: undefined,
        resume: true,
        resumeSessionAt: undefined,
      }),
    ).toEqual({
      ok: false,
      message:
        'Codex provider does not support --resume or --resume-session-at in this mode. Use a fresh request, or use --continue within the same process when conversation state is available.',
      errorCode: 'HEADLESS_PROVIDER_UNSUPPORTED_MODE',
    })
  })

  it('keeps resumeSessionAt fail-fast for Codex', () => {
    const provider = createCodexHeadlessProvider()

    expect(
      checkProviderContinuationSupport(provider, {
        continue: undefined,
        resume: undefined,
        resumeSessionAt: 'msg_123',
      }),
    ).toEqual({
      ok: false,
      message:
        'Codex provider does not support --resume or --resume-session-at in this mode. Use a fresh request, or use --continue within the same process when conversation state is available.',
      errorCode: 'HEADLESS_PROVIDER_UNSUPPORTED_MODE',
    })
  })
})
