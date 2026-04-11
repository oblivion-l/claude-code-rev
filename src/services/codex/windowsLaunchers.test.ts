import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getCodexLauncherDir,
  writeCodexWindowsLaunchers,
} from './windowsLaunchers.js'

const originalEnv = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_LAUNCHER_DIR: process.env.CLAUDE_CODE_LAUNCHER_DIR,
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(() => {
  restoreEnv()
})

describe('getCodexLauncherDir', () => {
  it('defaults to the Claude config bin directory', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'codex-launchers-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    delete process.env.CLAUDE_CODE_LAUNCHER_DIR

    expect(getCodexLauncherDir()).toBe(join(configDir, 'bin'))

    rmSync(configDir, { recursive: true, force: true })
  })

  it('prefers the explicit launcher dir override', () => {
    process.env.CLAUDE_CODE_LAUNCHER_DIR = '/tmp/custom-codex-bin'

    expect(getCodexLauncherDir()).toBe('/tmp/custom-codex-bin')
  })
})

describe('writeCodexWindowsLaunchers', () => {
  it('writes stable launcher files into the target directory', () => {
    const launcherDir = mkdtempSync(join(tmpdir(), 'codex-launchers-'))
    const repoRoot = '/repo/root'

    const writtenPaths = writeCodexWindowsLaunchers({
      launcherDir,
      repoRoot,
    })

    expect(writtenPaths.length).toBe(6)
    expect(readFileSync(join(launcherDir, 'codex.cmd'), 'utf8')).toContain(
      'call "/repo/root/scripts\\codex.cmd" %*',
    )
    expect(readFileSync(join(launcherDir, 'codex.ps1'), 'utf8')).toContain(
      "& '/repo/root/scripts\\codex.ps1' @args",
    )
    expect(
      readFileSync(join(launcherDir, 'codex-selfcheck.cmd'), 'utf8'),
    ).toContain('codex-selfcheck.cmd')

    rmSync(launcherDir, { recursive: true, force: true })
  })
})
