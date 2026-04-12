import { describe, expect, it } from 'bun:test'
import {
  buildCodexContinueMissingStateMessage,
  buildCodexPersistedConversationStateStatus,
  buildCodexResumeMissingStateMessage,
  buildCodexResumeSessionAtMissingTurnMessage,
} from './sessionText.js'

describe('sessionText', () => {
  it('builds aligned continue and resume missing-state messages', () => {
    expect(buildCodexContinueMissingStateMessage('provider')).toBe(
      'Codex provider continue requested but no persisted conversation state is available for the current directory.',
    )
    expect(buildCodexContinueMissingStateMessage('repl')).toBe(
      'Codex REPL continue requested but no persisted conversation state is available for the current directory.',
    )
    expect(buildCodexResumeMissingStateMessage('provider')).toBe(
      'Codex provider resume requested but no persisted conversation state is available.',
    )
    expect(buildCodexResumeMissingStateMessage('repl')).toBe(
      'Codex REPL resume requested but no persisted conversation state is available.',
    )
  })

  it('builds aligned resume-session-at missing-turn messages', () => {
    expect(
      buildCodexResumeSessionAtMissingTurnMessage({
        surface: 'provider',
        assistantMessageUuid: 'msg_1',
      }),
    ).toBe(
      'Codex provider could not find persisted assistant turn msg_1 for --resume-session-at.',
    )
    expect(
      buildCodexResumeSessionAtMissingTurnMessage({
        surface: 'repl',
        assistantMessageUuid: 'msg_1',
      }),
    ).toBe(
      'Codex REPL could not find persisted assistant turn msg_1 for --resume-session-at.',
    )
  })

  it('formats persisted conversation state availability consistently', () => {
    expect(
      buildCodexPersistedConversationStateStatus({
        hasCurrentWorkingDirectory: false,
        hasPersistedConversationState: false,
      }),
    ).toBe(
      'Persisted conversation state: unavailable because no current working directory is available.',
    )
    expect(
      buildCodexPersistedConversationStateStatus({
        hasCurrentWorkingDirectory: true,
        hasPersistedConversationState: false,
      }),
    ).toBe(
      'Persisted conversation state: no persisted conversation state is available for the current directory yet.',
    )
    expect(
      buildCodexPersistedConversationStateStatus({
        hasCurrentWorkingDirectory: true,
        hasPersistedConversationState: true,
      }),
    ).toBe(
      'Persisted conversation state: persisted conversation state is available for the current directory.',
    )
  })
})
