import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getCodexConfigFilePath,
  readCodexConfigFile,
  writeCodexConfigFile,
} from './configFile.js'

const originalEnv = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_CODEX_CONFIG_PATH: process.env.CLAUDE_CODE_CODEX_CONFIG_PATH,
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

describe('getCodexConfigFilePath', () => {
  it('uses the Claude config dir by default', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'codex-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    delete process.env.CLAUDE_CODE_CODEX_CONFIG_PATH

    expect(getCodexConfigFilePath()).toBe(
      join(configDir, 'codex-provider.json'),
    )

    rmSync(configDir, { recursive: true, force: true })
  })

  it('prefers the explicit config path override', () => {
    process.env.CLAUDE_CODE_CODEX_CONFIG_PATH =
      '/tmp/custom-codex-provider.json'

    expect(getCodexConfigFilePath()).toBe('/tmp/custom-codex-provider.json')
  })
})

describe('readCodexConfigFile', () => {
  it('returns an empty object when the config file is absent', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'codex-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir

    expect(readCodexConfigFile()).toEqual({})

    rmSync(configDir, { recursive: true, force: true })
  })
})

describe('writeCodexConfigFile', () => {
  it('creates the config file and writes normalized JSON content', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'codex-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir

    const filePath = writeCodexConfigFile({
      apiKey: 'test-key',
      baseUrl: 'https://www.xmapi.cc/v1',
      model: 'gpt-5.4',
    })

    expect(filePath).toBe(join(configDir, 'codex-provider.json'))
    expect(readCodexConfigFile()).toEqual({
      apiKey: 'test-key',
      baseUrl: 'https://www.xmapi.cc/v1',
      model: 'gpt-5.4',
      organization: undefined,
      project: undefined,
    })
    expect(readFileSync(filePath, 'utf8')).toContain('"apiKey": "test-key"')

    rmSync(configDir, { recursive: true, force: true })
  })

  it('works with a custom config path override', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'codex-config-'))
    const customPath = join(configDir, 'nested', 'custom-codex.json')
    process.env.CLAUDE_CODE_CODEX_CONFIG_PATH = customPath

    writeCodexConfigFile({
      apiKey: 'override-key',
    })

    expect(readCodexConfigFile()).toEqual({
      apiKey: 'override-key',
      baseUrl: undefined,
      model: undefined,
      organization: undefined,
      project: undefined,
    })

    rmSync(configDir, { recursive: true, force: true })
  })
})

describe('readCodexConfigFile validation', () => {
  it('fails fast when the config file is not valid JSON', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'codex-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    writeFileSync(join(configDir, 'codex-provider.json'), '{broken-json')

    expect(() => readCodexConfigFile()).toThrow('Invalid Codex config file')

    rmSync(configDir, { recursive: true, force: true })
  })
})
