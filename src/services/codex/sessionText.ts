export type CodexSessionSurface = 'provider' | 'repl'

function getCodexSessionDisplayName(
  surface: CodexSessionSurface,
): string {
  return surface === 'provider' ? 'Codex provider' : 'Codex REPL'
}

export function buildCodexContinueMissingStateMessage(
  surface: CodexSessionSurface,
): string {
  return `${getCodexSessionDisplayName(surface)} continue requested but no persisted conversation state is available for the current directory.`
}

export function buildCodexResumeMissingStateMessage(
  surface: CodexSessionSurface,
): string {
  return `${getCodexSessionDisplayName(surface)} resume requested but no persisted conversation state is available.`
}

export function buildCodexResumeSessionAtMissingTurnMessage(args: {
  surface: CodexSessionSurface
  assistantMessageUuid: string
}): string {
  return `${getCodexSessionDisplayName(args.surface)} could not find persisted assistant turn ${args.assistantMessageUuid} for --resume-session-at.`
}

export function buildCodexPersistedConversationStateStatus(args: {
  hasCurrentWorkingDirectory: boolean
  hasPersistedConversationState: boolean
}): string {
  if (!args.hasCurrentWorkingDirectory) {
    return 'Persisted conversation state: unavailable because no current working directory is available.'
  }

  if (!args.hasPersistedConversationState) {
    return 'Persisted conversation state: no persisted conversation state is available for the current directory yet.'
  }

  return 'Persisted conversation state: persisted conversation state is available for the current directory.'
}

export function buildCodexReplResumeHint(args: {
  hasCurrentWorkingDirectory: boolean
  hasPersistedConversationState: boolean
}): string {
  if (!args.hasCurrentWorkingDirectory) {
    return 'Resume hint: use /resume <state-id> with an explicit persisted conversation state id.'
  }

  if (args.hasPersistedConversationState) {
    return 'Resume hint: use /resume to reload the latest persisted conversation state for the current directory.'
  }

  return 'Resume hint: complete a Codex turn in this directory, or use /sessions to find another persisted conversation state.'
}
