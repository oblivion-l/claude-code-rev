import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getCodexRuntimeConfig,
  isCodexHeadlessEnabled,
} from './config.js'

const originalEnv = {
  CLAUDE_CODE_USE_CODEX: process.env.CLAUDE_CODE_USE_CODEX,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  CODEX_MODEL: process.env.CODEX_MODEL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_ORG_ID: process.env.OPENAI_ORG_ID,
  OPENAI_PROJECT_ID: process.env.OPENAI_PROJECT_ID,
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

describe('isCodexHeadlessEnabled', () => {
  it('returns false when the feature flag is absent', () => {
    delete process.env.CLAUDE_CODE_USE_CODEX

    expect(isCodexHeadlessEnabled()).toBe(false)
  })

  it('returns true when the feature flag is enabled', () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'

    expect(isCodexHeadlessEnabled()).toBe(true)
  })
})

describe('getCodexRuntimeConfig', () => {
  it('throws when Codex is enabled without an API key', () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    delete process.env.OPENAI_API_KEY

    expect(() => getCodexRuntimeConfig()).toThrow(
      'Codex provider requires OPENAI_API_KEY when CLAUDE_CODE_USE_CODEX=1.',
    )
  })

  it('builds config from environment variables', () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.OPENAI_BASE_URL = 'https://example.com/v1/'
    process.env.CODEX_MODEL = 'gpt-5-codex-custom'
    process.env.OPENAI_ORG_ID = 'org_123'
    process.env.OPENAI_PROJECT_ID = 'proj_456'

    expect(getCodexRuntimeConfig()).toEqual({
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-5-codex-custom',
      organization: 'org_123',
      project: 'proj_456',
    })
  })

  it('prefers the explicit model override', () => {
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.CODEX_MODEL = 'ignored-model'

    expect(getCodexRuntimeConfig('override-model').model).toBe(
      'override-model',
    )
  })

  it('loads Codex config from the Claude config directory when env vars are absent', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'codex-config-'))
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CONFIG_DIR = configDir
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.CODEX_MODEL
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_ORG_ID
    delete process.env.OPENAI_PROJECT_ID

    writeFileSync(
      join(configDir, 'codex-provider.json'),
      JSON.stringify({
        apiKey: 'file-key',
        baseUrl: 'https://relay.example.com/v1/',
        model: 'gpt-5.4',
        organization: 'org_file',
        project: 'proj_file',
      }),
    )

    expect(getCodexRuntimeConfig()).toEqual({
      apiKey: 'file-key',
      baseUrl: 'https://relay.example.com/v1',
      model: 'gpt-5.4',
      organization: 'org_file',
      project: 'proj_file',
    })

    rmSync(configDir, { recursive: true, force: true })
  })

  it('prefers environment variables over the Codex config file', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'codex-config-'))
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.OPENAI_API_KEY = 'env-key'
    process.env.OPENAI_BASE_URL = 'https://env.example.com/v1/'
    process.env.CODEX_MODEL = 'env-model'

    writeFileSync(
      join(configDir, 'codex-provider.json'),
      JSON.stringify({
        apiKey: 'file-key',
        baseUrl: 'https://file.example.com/v1',
        model: 'file-model',
      }),
    )

    expect(getCodexRuntimeConfig()).toEqual({
      apiKey: 'env-key',
      baseUrl: 'https://env.example.com/v1',
      model: 'env-model',
      organization: undefined,
      project: undefined,
    })

    rmSync(configDir, { recursive: true, force: true })
  })

  it('fails fast when the Codex config file contains invalid JSON', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'codex-config-'))
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CONFIG_DIR = configDir
    delete process.env.OPENAI_API_KEY

    writeFileSync(join(configDir, 'codex-provider.json'), '{broken-json')

    expect(() => getCodexRuntimeConfig()).toThrow(
      'Invalid Codex config file',
    )

    rmSync(configDir, { recursive: true, force: true })
  })

  it('fails fast when the Codex config file contains invalid field types', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'codex-config-'))
    process.env.CLAUDE_CODE_USE_CODEX = '1'
    process.env.CLAUDE_CONFIG_DIR = configDir
    delete process.env.OPENAI_API_KEY

    writeFileSync(
      join(configDir, 'codex-provider.json'),
      JSON.stringify({
        apiKey: 123,
      }),
    )

    expect(() => getCodexRuntimeConfig()).toThrow(
      '"apiKey" must be a string',
    )

    rmSync(configDir, { recursive: true, force: true })
  })
})
