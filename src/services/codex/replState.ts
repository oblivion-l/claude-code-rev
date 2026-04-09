import {
  type HeadlessConversationState,
  type HeadlessConversationTurnState,
} from 'src/services/headless/provider.js'
import {
  clearHeadlessConversationState,
  getHeadlessConversationState,
  HeadlessConversationStateError,
  setHeadlessConversationState,
} from 'src/services/headless/conversationState.js'

export const CODEX_REPL_STATE_PROVIDER_ID = 'codex-repl'

export type CodexReplPersistedState = HeadlessConversationState
export type CodexReplPersistedTurnState = HeadlessConversationTurnState

export {
  HeadlessConversationStateError as CodexReplStateError,
}

export function getCodexReplState(options: {
  cwd?: string
  stateId?: string
}): CodexReplPersistedState | null {
  return getHeadlessConversationState(CODEX_REPL_STATE_PROVIDER_ID, options)
}

export function setCodexReplState(
  state: CodexReplPersistedState,
  options: {
    cwd?: string
  } = {},
): CodexReplPersistedState {
  return setHeadlessConversationState(
    CODEX_REPL_STATE_PROVIDER_ID,
    state,
    options,
  )
}

export function clearCodexReplState(options: {
  cwd?: string
  stateId?: string
} = {}): void {
  clearHeadlessConversationState(CODEX_REPL_STATE_PROVIDER_ID, options)
}
