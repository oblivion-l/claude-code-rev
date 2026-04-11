import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
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
export type CodexReplPersistedStateRecord = {
  state: CodexReplPersistedState
  filePath: string
}

export {
  HeadlessConversationStateError as CodexReplStateError,
}

function getCodexReplStateRoot(): string {
  return (
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR ??
    join(homedir(), '.claude', 'headless-provider-state')
  )
}

function getCodexReplStatesDir(): string {
  return join(getCodexReplStateRoot(), CODEX_REPL_STATE_PROVIDER_ID, 'states')
}

export function getCodexReplStateFilePath(stateId: string): string {
  return join(getCodexReplStatesDir(), `${stateId}.json`)
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

export function listCodexReplStates(options: {
  limit?: number
} = {}): CodexReplPersistedStateRecord[] {
  const statesDir = getCodexReplStatesDir()
  if (!existsSync(statesDir)) {
    return []
  }

  const limit = Math.max(options.limit ?? 10, 0)
  if (limit === 0) {
    return []
  }

  const records = readdirSync(statesDir)
    .filter(entry => entry.endsWith('.json'))
    .map(entry => entry.slice(0, -'.json'.length))
    .map(stateId => ({
      state: getCodexReplState({
        stateId,
      })!,
      filePath: getCodexReplStateFilePath(stateId),
    }))
    .sort((left, right) => {
      const leftTime =
        Date.parse(left.state.updatedAt ?? left.state.createdAt ?? '') || 0
      const rightTime =
        Date.parse(right.state.updatedAt ?? right.state.createdAt ?? '') || 0

      if (leftTime !== rightTime) {
        return rightTime - leftTime
      }

      return (right.state.stateId ?? '').localeCompare(left.state.stateId ?? '')
    })

  return records.slice(0, limit)
}
