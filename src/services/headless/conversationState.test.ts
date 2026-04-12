import { createHash } from 'crypto'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearHeadlessConversationState,
  getHeadlessConversationState,
  resolvePersistedHeadlessConversationStateWithRepair,
  setHeadlessConversationState,
} from './conversationState.js'

let stateDir: string

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'codex-headless-state-'))
  process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = stateDir
})

afterEach(() => {
  delete process.env.CLAUDE_CODE_HEADLESS_STATE_DIR
  rmSync(stateDir, { recursive: true, force: true })
  clearHeadlessConversationState('codex')
})

describe('headless conversation state storage', () => {
  it('persists and reloads the latest state for a cwd', () => {
    const savedState = setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state_123',
        lastResponseId: 'resp_123',
      },
      {
        cwd: '/tmp/project-a',
      },
    )

    clearHeadlessConversationState('codex')

    expect(
      getHeadlessConversationState('codex', {
        cwd: '/tmp/project-a',
      }),
    ).toEqual(savedState)
  })

  it('loads a persisted state by explicit state id', () => {
    const savedState = setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state_resume_123',
        lastResponseId: 'resp_456',
        history: [
          {
            assistantMessageUuid: 'msg_123',
            responseId: 'resp_123',
            createdAt: '2026-04-06T00:00:00.000Z',
          },
        ],
      },
      {
        cwd: '/tmp/project-b',
      },
    )

    clearHeadlessConversationState('codex')

    expect(
      getHeadlessConversationState('codex', {
        stateId: 'state_resume_123',
      }),
    ).toEqual(savedState)
  })

  it('throws a friendly error when persisted state JSON is corrupted', () => {
    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state_bad_json',
        lastResponseId: 'resp_bad_json',
      },
      {
        cwd: '/tmp/project-c',
      },
    )

    writeFileSync(
      join(stateDir, 'codex', 'states', 'state_bad_json.json'),
      '{invalid json',
      'utf8',
    )
    clearHeadlessConversationState('codex')

    expect(() =>
      getHeadlessConversationState('codex', {
        stateId: 'state_bad_json',
      }),
    ).toThrow('Persisted codex conversation state is not valid JSON.')
  })

  it('throws a friendly error when persisted state version is unsupported', () => {
    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state_bad_version',
        lastResponseId: 'resp_bad_version',
      },
      {
        cwd: '/tmp/project-d',
      },
    )

    const statePath = join(stateDir, 'codex', 'states', 'state_bad_version.json')
    const stateContent = JSON.parse(readFileSync(statePath, 'utf8'))
    stateContent.version = 999
    writeFileSync(statePath, JSON.stringify(stateContent, null, 2) + '\n', 'utf8')
    clearHeadlessConversationState('codex')

    expect(() =>
      getHeadlessConversationState('codex', {
        stateId: 'state_bad_version',
      }),
    ).toThrow(
      'Persisted codex conversation state version 999 is not supported by this CLI build.',
    )
  })

  it('cleans up a stale latest pointer that references a missing state file', () => {
    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state_missing_target',
        lastResponseId: 'resp_missing_target',
      },
      {
        cwd: '/tmp/project-e',
      },
    )

    rmSync(join(stateDir, 'codex', 'states', 'state_missing_target.json'), {
      force: true,
    })
    clearHeadlessConversationState('codex')

    expect(() =>
      getHeadlessConversationState('codex', {
        cwd: '/tmp/project-e',
      }),
    ).toThrow(
      'Persisted codex latest-conversation pointer for /tmp/project-e referenced missing state state_missing_target. The stale pointer was cleaned up.',
    )

    expect(
      existsSync(
        join(
          stateDir,
          'codex',
          'latest',
          `${createHash('sha256').update('/tmp/project-e').digest('hex')}.json`,
        ),
      ),
    ).toBe(false)
  })

  it('repairs a stale pointer by scanning for another usable state in the same cwd', () => {
    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state_recoverable_old',
        lastResponseId: 'resp_recoverable_old',
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
      {
        cwd: '/tmp/project-f',
      },
    )
    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state_recoverable_new',
        lastResponseId: 'resp_recoverable_new',
        updatedAt: '2026-04-11T00:00:00.000Z',
      },
      {
        cwd: '/tmp/project-f',
      },
    )

    rmSync(join(stateDir, 'codex', 'states', 'state_recoverable_new.json'), {
      force: true,
    })
    clearHeadlessConversationState('codex')

    const resolution = resolvePersistedHeadlessConversationStateWithRepair(
      'codex',
      {
        cwd: '/tmp/project-f',
      },
    )

    expect(resolution.state?.stateId).toBe('state_recoverable_old')
    expect(resolution.diagnostics).toEqual({
      skippedBrokenCount: 0,
      repairedPointer: true,
      recoveredFromScan: true,
      usedGlobalFallback: false,
    })
    expect(
      getHeadlessConversationState('codex', {
        cwd: '/tmp/project-f',
      })?.stateId,
    ).toBe('state_recoverable_old')
  })

  it('skips broken states while recovering the latest usable persisted state', () => {
    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state_recoverable_good',
        lastResponseId: 'resp_recoverable_good',
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
      {
        cwd: '/tmp/project-g',
      },
    )
    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state_recoverable_broken',
        lastResponseId: 'resp_recoverable_broken',
        updatedAt: '2026-04-11T00:00:00.000Z',
      },
      {
        cwd: '/tmp/project-g',
      },
    )

    writeFileSync(
      join(stateDir, 'codex', 'states', 'state_recoverable_broken.json'),
      '{invalid json',
      'utf8',
    )
    clearHeadlessConversationState('codex')

    const resolution = resolvePersistedHeadlessConversationStateWithRepair(
      'codex',
      {
        cwd: '/tmp/project-g',
      },
    )

    expect(resolution.state?.stateId).toBe('state_recoverable_good')
    expect(resolution.diagnostics).toEqual({
      skippedBrokenCount: 1,
      repairedPointer: true,
      recoveredFromScan: true,
      usedGlobalFallback: false,
    })
  })

  it('returns null with diagnostics when every scanned state is broken', () => {
    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state_broken_only',
        lastResponseId: 'resp_broken_only',
      },
      {
        cwd: '/tmp/project-h',
      },
    )

    writeFileSync(
      join(stateDir, 'codex', 'states', 'state_broken_only.json'),
      '{invalid json',
      'utf8',
    )
    clearHeadlessConversationState('codex')

    const resolution = resolvePersistedHeadlessConversationStateWithRepair(
      'codex',
      {
        cwd: '/tmp/project-h',
      },
    )

    expect(resolution.state).toBeNull()
    expect(resolution.diagnostics).toEqual({
      skippedBrokenCount: 1,
      repairedPointer: true,
      recoveredFromScan: false,
      usedGlobalFallback: false,
    })
  })
})
