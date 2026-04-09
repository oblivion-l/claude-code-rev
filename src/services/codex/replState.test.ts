import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearCodexReplState,
  getCodexReplState,
  setCodexReplState,
} from './replState.js'

let stateDir: string

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'codex-repl-state-'))
  process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = stateDir
})

afterEach(() => {
  delete process.env.CLAUDE_CODE_HEADLESS_STATE_DIR
  clearCodexReplState()
  rmSync(stateDir, { recursive: true, force: true })
})

describe('codex repl persisted state', () => {
  it('persists and reloads the latest state for a cwd', () => {
    const savedState = setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'repl_state_1',
        cwd: '/tmp/repl-project',
        lastResponseId: 'resp_1',
        history: [
          {
            assistantMessageUuid: 'msg_1',
            responseId: 'resp_1',
            createdAt: '2026-04-09T00:00:00.000Z',
          },
        ],
      },
      {
        cwd: '/tmp/repl-project',
      },
    )

    clearCodexReplState()

    expect(
      getCodexReplState({
        cwd: '/tmp/repl-project',
      }),
    ).toEqual(savedState)
  })

  it('loads a persisted state by explicit resume id', () => {
    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'repl_resume_1',
        cwd: '/tmp/repl-project-2',
        lastResponseId: 'resp_2',
      },
      {
        cwd: '/tmp/repl-project-2',
      },
    )

    clearCodexReplState()

    expect(
      getCodexReplState({
        stateId: 'repl_resume_1',
      }),
    )?.toMatchObject({
      providerId: 'codex-repl',
      stateId: 'repl_resume_1',
      lastResponseId: 'resp_2',
    })
  })
})
