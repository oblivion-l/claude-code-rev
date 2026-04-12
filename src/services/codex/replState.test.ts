import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearCodexReplState,
  getCodexReplState,
  listCodexReplStates,
  resolveCodexReplStateWithRepair,
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

  it('repairs stale repl pointers by scanning other usable sessions', () => {
    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'repl_resume_old',
        cwd: '/tmp/repl-project-3',
        lastResponseId: 'resp_3_old',
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
      {
        cwd: '/tmp/repl-project-3',
      },
    )
    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'repl_resume_new',
        cwd: '/tmp/repl-project-3',
        lastResponseId: 'resp_3_new',
        updatedAt: '2026-04-11T00:00:00.000Z',
      },
      {
        cwd: '/tmp/repl-project-3',
      },
    )

    rmSync(join(stateDir, 'codex-repl', 'states', 'repl_resume_new.json'), {
      force: true,
    })
    clearCodexReplState()

    const resolution = resolveCodexReplStateWithRepair({
      cwd: '/tmp/repl-project-3',
    })

    expect(resolution.state?.stateId).toBe('repl_resume_old')
    expect(resolution.diagnostics.repairedPointer).toBe(true)
    expect(resolution.diagnostics.recoveredFromScan).toBe(true)
  })

  it('lists valid repl states and reports skipped broken files', () => {
    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'repl_list_good',
        cwd: '/tmp/repl-project-4',
        lastResponseId: 'resp_4_good',
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
      {
        cwd: '/tmp/repl-project-4',
      },
    )
    setCodexReplState(
      {
        providerId: 'codex-repl',
        stateId: 'repl_list_broken',
        cwd: '/tmp/repl-project-5',
        lastResponseId: 'resp_5_broken',
        updatedAt: '2026-04-11T00:00:00.000Z',
      },
      {
        cwd: '/tmp/repl-project-5',
      },
    )

    writeFileSync(
      join(stateDir, 'codex-repl', 'states', 'repl_list_broken.json'),
      '{invalid json',
      'utf8',
    )
    clearCodexReplState()

    expect(listCodexReplStates({ limit: 10 })).toEqual({
      records: [
        expect.objectContaining({
          state: expect.objectContaining({
            stateId: 'repl_list_good',
          }),
        }),
      ],
      skippedBrokenCount: 1,
    })
  })
})
