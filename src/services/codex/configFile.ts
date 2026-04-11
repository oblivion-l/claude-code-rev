import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from 'src/utils/envUtils.js'

export type CodexConfigFile = {
  apiKey?: string
  baseUrl?: string
  model?: string
  organization?: string
  project?: string
}

export function getCodexConfigFilePath(): string {
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

export function readCodexConfigFile(): CodexConfigFile {
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

export function writeCodexConfigFile(config: CodexConfigFile): string {
  const filePath = getCodexConfigFilePath()
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return filePath
}
