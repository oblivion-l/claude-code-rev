import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir, isEnvTruthy } from 'src/utils/envUtils.js'
import type { CodexRuntimeConfig } from './types.js'

const DEFAULT_CODEX_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_CODEX_MODEL = 'gpt-5-codex'

type CodexConfigFile = {
  apiKey?: string
  baseUrl?: string
  model?: string
  organization?: string
  project?: string
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function getCodexConfigFilePath(): string {
  return (
    process.env.CLAUDE_CODE_CODEX_CONFIG_PATH?.trim() ||
    join(getClaudeConfigHomeDir(), 'codex-provider.json')
  )
}

function normalizeOptionalString(
  value: unknown,
  key: keyof CodexConfigFile,
  filePath: string,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(
      `Invalid Codex config file at ${filePath}: "${key}" must be a string.`,
    )
  }

  const normalized = value.trim()
  return normalized || undefined
}

function readCodexConfigFile(): CodexConfigFile {
  const filePath = getCodexConfigFilePath()
  if (!existsSync(filePath)) {
    return {}
  }

  let rawText: string
  try {
    rawText = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error(
      `Unable to read Codex config file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error(
      `Invalid Codex config file at ${filePath}: expected a valid JSON object.`,
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `Invalid Codex config file at ${filePath}: expected a JSON object.`,
    )
  }

  const configObject = parsed as Record<string, unknown>

  return {
    apiKey: normalizeOptionalString(configObject.apiKey, 'apiKey', filePath),
    baseUrl: normalizeOptionalString(
      configObject.baseUrl,
      'baseUrl',
      filePath,
    ),
    model: normalizeOptionalString(configObject.model, 'model', filePath),
    organization: normalizeOptionalString(
      configObject.organization,
      'organization',
      filePath,
    ),
    project: normalizeOptionalString(configObject.project, 'project', filePath),
  }
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

  const fileConfig = readCodexConfigFile()
  const apiKey = process.env.OPENAI_API_KEY?.trim() || fileConfig.apiKey
  if (!apiKey) {
    throw new Error(
      `Codex provider requires OPENAI_API_KEY when CLAUDE_CODE_USE_CODEX=1. You can also provide apiKey in ${getCodexConfigFilePath()}.`,
    )
  }

  const rawBaseUrl =
    process.env.OPENAI_BASE_URL?.trim() ||
    fileConfig.baseUrl ||
    DEFAULT_CODEX_BASE_URL
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
    fileConfig.model ||
    DEFAULT_CODEX_MODEL

  return {
    apiKey,
    baseUrl,
    model,
    organization:
      process.env.OPENAI_ORG_ID?.trim() || fileConfig.organization,
    project: process.env.OPENAI_PROJECT_ID?.trim() || fileConfig.project,
  }
}
