import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getHeadlessConversationState } from './conversationState.js'
import { runDirectHeadlessProvider } from './runDirect.js'
import type { HeadlessProvider } from './provider.js'

const originalStateDir = process.env.CLAUDE_CODE_HEADLESS_STATE_DIR

function createProvider(
  overrides?: Partial<HeadlessProvider>,
): HeadlessProvider {
  return {
    metadata: {
      id: 'codex',
      displayName: 'Codex',
    },
    capabilities: {
      supportsContinue: true,
      supportsResume: true,
      supportsStructuredOutput: true,
      supportsConversationState: true,
    },
    async run() {
      return {
        exitCode: 0,
      }
    },
    ...overrides,
  }
}

afterEach(() => {
  if (originalStateDir === undefined) {
    delete process.env.CLAUDE_CODE_HEADLESS_STATE_DIR
  } else {
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = originalStateDir
  }
})

describe('runDirectHeadlessProvider', () => {
  it('persists the provider conversation state for the cwd', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'headless-direct-'))
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = stateDir

    const cwd = mkdtempSync(join(tmpdir(), 'headless-direct-cwd-'))
    const provider = createProvider({
      async run() {
        return {
          exitCode: 0,
          conversationState: {
            providerId: 'codex',
            stateId: 'state-1',
            conversationId: 'conv-1',
            lastResponseId: 'resp-1',
          },
        }
      },
    })

    const exitCode = await runDirectHeadlessProvider({
      provider,
      inputPrompt: 'hello',
      options: {} as any,
      cwd,
      structuredIO: {
        write: async () => {},
      },
    })

    const persistedState = getHeadlessConversationState('codex', {
      cwd,
    })

    expect(exitCode).toBe(0)
    expect(persistedState.stateId).toBe('state-1')
    expect(persistedState.lastResponseId).toBe('resp-1')

    rmSync(stateDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })

  it('returns a friendly stream-json error when resume state is missing', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'headless-direct-'))
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = stateDir

    const writes: unknown[] = []
    const provider = createProvider({
      async run() {
        throw new Error('provider should not run when state is missing')
      },
    })

    const exitCode = await runDirectHeadlessProvider({
      provider,
      inputPrompt: 'hello',
      options: {
        resume: 'missing-state',
        outputFormat: 'stream-json',
      } as any,
      cwd: mkdtempSync(join(tmpdir(), 'headless-direct-cwd-')),
      structuredIO: {
        write: async message => {
          writes.push(message)
        },
      },
    })

    expect(exitCode).toBe(1)
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'result',
        subtype: 'error_during_execution',
        error_code: 'HEADLESS_PROVIDER_INVALID_INPUT',
      }),
    )

    rmSync(stateDir, { recursive: true, force: true })
  })
})
