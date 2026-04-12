import { describe, expect, it } from 'bun:test'
import {
  buildCodexContinueMissingStateMessage,
  buildCodexPersistedConversationStateStatus,
  buildCodexReplGlobalFallbackStatusLine,
  buildCodexReplResumeHint,
  buildCodexReplResumeSourceSuffix,
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

  it('appends broken-state scan diagnostics when recovery candidates were skipped', () => {
    expect(
      buildCodexContinueMissingStateMessage('provider', {
        skippedBrokenCount: 2,
      }),
    ).toBe(
      'Codex provider continue requested but no persisted conversation state is available for the current directory. Skipped 2 broken persisted conversation states while scanning recovery candidates.',
    )
    expect(
      buildCodexResumeMissingStateMessage('repl', {
        skippedBrokenCount: 1,
      }),
    ).toBe(
      'Codex REPL resume requested but no persisted conversation state is available. Skipped 1 broken persisted conversation state while scanning recovery candidates.',
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

  it('builds REPL resume hints for available, missing, and cwd-less states', () => {
    expect(
      buildCodexReplResumeHint({
        hasCurrentWorkingDirectory: false,
        hasPersistedConversationState: false,
      }),
    ).toBe(
      'Resume hint: use /resume <state-id> with an explicit persisted conversation state id.',
    )
    expect(
      buildCodexReplResumeHint({
        hasCurrentWorkingDirectory: true,
        hasPersistedConversationState: false,
      }),
    ).toBe(
      'Resume hint: complete a Codex turn in this directory, or use /sessions to find another persisted conversation state.',
    )
    expect(
      buildCodexReplResumeHint({
        hasCurrentWorkingDirectory: true,
        hasPersistedConversationState: true,
      }),
    ).toBe(
      'Resume hint: use /resume to reload the latest persisted conversation state for the current directory.',
    )
  })

  it('formats repl resume source diagnostics for success and status output', () => {
    expect(
      buildCodexReplResumeSourceSuffix({
        sourceCwd: '/tmp/source-project',
      }),
    ).toBe(' source-cwd=/tmp/source-project')
    expect(
      buildCodexReplGlobalFallbackStatusLine({
        sourceCwd: '/tmp/source-project',
        requestedCwd: '/tmp/current-project',
      }),
    ).toBe(
      'Session source: global-fallback source-cwd=/tmp/source-project requested-cwd=/tmp/current-project',
    )
  })
})
