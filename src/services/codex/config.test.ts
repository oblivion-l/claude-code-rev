import { afterEach, describe, expect, it } from 'bun:test'
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
})
