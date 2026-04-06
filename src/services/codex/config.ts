import { isEnvTruthy } from 'src/utils/envUtils.js'
import type { CodexRuntimeConfig } from './types.js'

const DEFAULT_CODEX_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_CODEX_MODEL = 'gpt-5-codex'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export function isCodexHeadlessEnabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_CODEX)
}

export function getCodexRuntimeConfig(
  modelOverride?: string,
): CodexRuntimeConfig {
  if (!isCodexHeadlessEnabled()) {
    throw new Error(
      'Codex provider is disabled. Set CLAUDE_CODE_USE_CODEX=1 to enable it.',
    )
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      'Codex provider requires OPENAI_API_KEY when CLAUDE_CODE_USE_CODEX=1.',
    )
  }

  const rawBaseUrl =
    process.env.OPENAI_BASE_URL?.trim() || DEFAULT_CODEX_BASE_URL
  let baseUrl: string

  try {
    baseUrl = normalizeBaseUrl(new URL(rawBaseUrl).toString())
  } catch {
    throw new Error(
      `Invalid OPENAI_BASE_URL for Codex provider: ${rawBaseUrl}`,
    )
  }

  const model =
    modelOverride?.trim() ||
    process.env.CODEX_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    DEFAULT_CODEX_MODEL

  return {
    apiKey,
    baseUrl,
    model,
    organization: process.env.OPENAI_ORG_ID?.trim() || undefined,
    project: process.env.OPENAI_PROJECT_ID?.trim() || undefined,
  }
}
