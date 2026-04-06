import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearHeadlessConversationState,
  getHeadlessConversationState,
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
})
