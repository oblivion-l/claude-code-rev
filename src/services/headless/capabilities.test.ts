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

    expect(providerSupportsResume(provider)).toBe(true)
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
        'Codex provider continue requested but no conversation state is available for the current directory.',
      errorCode: 'HEADLESS_PROVIDER_INVALID_INPUT',
    })
  })

  it('allows resume when persisted state is available', () => {
    const provider = createCodexHeadlessProvider()

    expect(
      checkProviderContinuationSupport(
        provider,
        {
          continue: undefined,
          resume: true,
          resumeSessionAt: undefined,
        },
        {
          providerId: 'codex',
          stateId: 'state_123',
          lastResponseId: 'resp_123',
          history: [
            {
              assistantMessageUuid: 'msg_123',
              responseId: 'resp_123',
              createdAt: '2026-04-06T00:00:00.000Z',
            },
          ],
        },
      ),
    ).toEqual({
      ok: true,
      conversationState: {
        providerId: 'codex',
        stateId: 'state_123',
        lastResponseId: 'resp_123',
        history: [
          {
            assistantMessageUuid: 'msg_123',
            responseId: 'resp_123',
            createdAt: '2026-04-06T00:00:00.000Z',
          },
        ],
      },
    })
  })

  it('fails resume when no persisted state is available', () => {
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
        'Codex provider resume requested but no persisted conversation state is available.',
      errorCode: 'HEADLESS_PROVIDER_INVALID_INPUT',
    })
  })

  it('allows resumeSessionAt when the persisted assistant turn exists', () => {
    const provider = createCodexHeadlessProvider()

    expect(
      checkProviderContinuationSupport(
        provider,
        {
          continue: undefined,
          resume: true,
          resumeSessionAt: 'msg_123',
        },
        {
          providerId: 'codex',
          stateId: 'state_123',
          lastResponseId: 'resp_456',
          history: [
            {
              assistantMessageUuid: 'msg_123',
              responseId: 'resp_123',
              createdAt: '2026-04-06T00:00:00.000Z',
            },
            {
              assistantMessageUuid: 'msg_456',
              responseId: 'resp_456',
              createdAt: '2026-04-06T01:00:00.000Z',
            },
          ],
        },
      ),
    ).toEqual({
      ok: true,
      conversationState: {
        providerId: 'codex',
        stateId: 'state_123',
        lastResponseId: 'resp_123',
        lastAssistantMessageUuid: 'msg_123',
        history: [
          {
            assistantMessageUuid: 'msg_123',
            responseId: 'resp_123',
            createdAt: '2026-04-06T00:00:00.000Z',
          },
        ],
      },
    })
  })

  it('fails resumeSessionAt when the persisted assistant turn does not exist', () => {
    const provider = createCodexHeadlessProvider()

    expect(
      checkProviderContinuationSupport(
        provider,
        {
          continue: undefined,
          resume: true,
          resumeSessionAt: 'missing_msg',
        },
        {
          providerId: 'codex',
          stateId: 'state_123',
          lastResponseId: 'resp_456',
          history: [
            {
              assistantMessageUuid: 'msg_123',
              responseId: 'resp_123',
              createdAt: '2026-04-06T00:00:00.000Z',
            },
          ],
        },
      ),
    ).toEqual({
      ok: false,
      message:
        'Codex provider could not find persisted assistant turn missing_msg for --resume-session-at.',
      errorCode: 'HEADLESS_PROVIDER_INVALID_INPUT',
    })
  })
})
