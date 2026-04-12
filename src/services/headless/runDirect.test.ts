import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getHeadlessConversationState } from './conversationState.js'
import { setHeadlessConversationState } from './conversationState.js'
import { runDirectHeadlessProvider } from './runDirect.js'
import type { HeadlessProvider } from './provider.js'

const originalStateDir = process.env.CLAUDE_CODE_HEADLESS_STATE_DIR
const originalStderrWrite = process.stderr.write.bind(process.stderr)

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
  process.stderr.write = originalStderrWrite
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

  it('repairs stale pointers for continue by scanning another usable persisted state', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'headless-direct-'))
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = stateDir

    const cwd = '/tmp/headless-repair'
    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state-old',
        conversationId: 'conv-old',
        lastResponseId: 'resp-old',
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
      {
        cwd,
      },
    )
    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state-broken',
        conversationId: 'conv-broken',
        lastResponseId: 'resp-broken',
        updatedAt: '2026-04-11T00:00:00.000Z',
      },
      {
        cwd,
      },
    )

    writeFileSync(
      join(stateDir, 'codex', 'states', 'state-broken.json'),
      '{invalid json',
      'utf8',
    )

    const provider = createProvider({
      async run(args) {
        expect(args.conversationState?.stateId).toBe('state-old')
        expect(args.conversationState?.lastResponseId).toBe('resp-old')
        return {
          exitCode: 0,
        }
      },
    })

    const exitCode = await runDirectHeadlessProvider({
      provider,
      inputPrompt: 'hello',
      options: {
        continue: true,
      } as any,
      cwd,
      structuredIO: {
        write: async () => {},
      },
    })

    expect(exitCode).toBe(0)

    rmSync(stateDir, { recursive: true, force: true })
  })

  it('does not emit a cross-directory notice when continue resumes from the same cwd', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'headless-direct-'))
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = stateDir

    const cwd = '/tmp/headless-same-cwd'
    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state-same-cwd',
        conversationId: 'conv-same-cwd',
        lastResponseId: 'resp-same-cwd',
      },
      {
        cwd,
      },
    )

    const stderrWrites: string[] = []
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk))
      return true
    }) as typeof process.stderr.write

    const provider = createProvider({
      async run(args) {
        expect(args.conversationState?.stateId).toBe('state-same-cwd')
        return {
          exitCode: 0,
        }
      },
    })

    const exitCode = await runDirectHeadlessProvider({
      provider,
      inputPrompt: 'hello',
      options: {
        continue: true,
      } as any,
      cwd,
      structuredIO: {
        write: async () => {},
      },
    })

    expect(exitCode).toBe(0)
    expect(stderrWrites).toEqual([])

    rmSync(stateDir, { recursive: true, force: true })
  })

  it('emits a transparent stream-json notice when continue falls back to a global session', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'headless-direct-'))
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = stateDir

    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state-global',
        conversationId: 'conv-global',
        lastResponseId: 'resp-global',
        updatedAt: '2026-04-11T00:00:00.000Z',
      },
      {
        cwd: '/tmp/global-headless-repo',
      },
    )

    const writes: unknown[] = []
    const provider = createProvider({
      async run(args) {
        expect(args.conversationState?.stateId).toBe('state-global')
        return {
          exitCode: 0,
        }
      },
    })

    const exitCode = await runDirectHeadlessProvider({
      provider,
      inputPrompt: 'hello',
      options: {
        continue: true,
        outputFormat: 'stream-json',
      } as any,
      cwd: '/tmp/current-headless-repo',
      structuredIO: {
        write: async message => {
          writes.push(message)
        },
      },
    })

    expect(exitCode).toBe(0)
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'system',
        subtype: 'codex_session_source',
        message:
          'Session source: global-fallback source-cwd=/tmp/global-headless-repo requested-cwd=/tmp/current-headless-repo',
        source_cwd: '/tmp/global-headless-repo',
        requested_cwd: '/tmp/current-headless-repo',
      }),
    )

    rmSync(stateDir, { recursive: true, force: true })
  })

  it('fails fast with aligned diagnostics when all scanned continue states are broken', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'headless-direct-'))
    process.env.CLAUDE_CODE_HEADLESS_STATE_DIR = stateDir

    const cwd = '/tmp/headless-only-broken'
    setHeadlessConversationState(
      'codex',
      {
        providerId: 'codex',
        stateId: 'state-only-broken',
        conversationId: 'conv-only-broken',
        lastResponseId: 'resp-only-broken',
      },
      {
        cwd,
      },
    )

    writeFileSync(
      join(stateDir, 'codex', 'states', 'state-only-broken.json'),
      '{invalid json',
      'utf8',
    )

    const writes: unknown[] = []
    const provider = createProvider({
      async run() {
        throw new Error('provider should not run when all states are broken')
      },
    })

    const exitCode = await runDirectHeadlessProvider({
      provider,
      inputPrompt: 'hello',
      options: {
        continue: true,
        outputFormat: 'stream-json',
      } as any,
      cwd,
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
        validation_error:
          'Codex provider continue requested but no persisted conversation state is available for the current directory. Skipped 1 broken persisted conversation state while scanning recovery candidates.',
        errors: [
          'Codex provider continue requested but no persisted conversation state is available for the current directory. Skipped 1 broken persisted conversation state while scanning recovery candidates.',
        ],
      }),
    )

    rmSync(stateDir, { recursive: true, force: true })
  })
})
