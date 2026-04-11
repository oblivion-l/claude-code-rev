import { getCodexRuntimeConfig } from '../src/services/codex/config.js'
import {
  getCodexConfigFilePath,
  readCodexConfigFile,
  writeCodexConfigFile,
} from '../src/services/codex/configFile.js'

type SetupArgs = {
  apiKey?: string
  baseUrl?: string
  model?: string
  organization?: string
  project?: string
}

function printUsage(): void {
  process.stdout.write(
    [
      '用法：bun run ./scripts/setup-codex.ts [options]',
      '',
      '选项：',
      '  --api-key <value>      写入 apiKey',
      '  --base-url <value>     写入 baseUrl',
      '  --model <value>        写入 model',
      '  --org-id <value>       写入 organization',
      '  --project-id <value>   写入 project',
      '  --help                 显示帮助',
      '',
      '说明：',
      '  1. 未显式传参时，会优先回退到当前环境变量',
      '  2. 再回退到现有 codex-provider.json 中的值',
      `  3. 默认写入 ${getCodexConfigFilePath()}`,
      '',
    ].join('\n'),
  )
}

function parseArgs(argv: string[]): SetupArgs {
  const args: SetupArgs = {}

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current) {
      continue
    }

    if (current === '--help' || current === '-h') {
      printUsage()
      process.exit(0)
    }

    const nextValue = argv[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for ${current}`)
    }

    switch (current) {
      case '--api-key':
        args.apiKey = nextValue
        index += 1
        break
      case '--base-url':
        args.baseUrl = nextValue
        index += 1
        break
      case '--model':
        args.model = nextValue
        index += 1
        break
      case '--org-id':
        args.organization = nextValue
        index += 1
        break
      case '--project-id':
        args.project = nextValue
        index += 1
        break
      default:
        throw new Error(`Unknown argument: ${current}`)
    }
  }

  return args
}

function pickFirstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.trim()
    if (normalized) {
      return normalized
    }
  }

  return undefined
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return '***'
  }

  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
}

function validateWrittenConfig(): void {
  const previousEnv = {
    CLAUDE_CODE_USE_CODEX: process.env.CLAUDE_CODE_USE_CODEX,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    CODEX_MODEL: process.env.CODEX_MODEL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    OPENAI_ORG_ID: process.env.OPENAI_ORG_ID,
    OPENAI_PROJECT_ID: process.env.OPENAI_PROJECT_ID,
  }

  process.env.CLAUDE_CODE_USE_CODEX = '1'
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.CODEX_MODEL
  delete process.env.OPENAI_MODEL
  delete process.env.OPENAI_ORG_ID
  delete process.env.OPENAI_PROJECT_ID

  try {
    void getCodexRuntimeConfig()
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

function main(): void {
  const input = parseArgs(process.argv.slice(2))
  const existing = readCodexConfigFile()

  const nextConfig = {
    apiKey: pickFirstNonEmpty(input.apiKey, process.env.OPENAI_API_KEY, existing.apiKey),
    baseUrl: pickFirstNonEmpty(
      input.baseUrl,
      process.env.OPENAI_BASE_URL,
      existing.baseUrl,
    ),
    model: pickFirstNonEmpty(
      input.model,
      process.env.CODEX_MODEL,
      process.env.OPENAI_MODEL,
      existing.model,
    ),
    organization: pickFirstNonEmpty(
      input.organization,
      process.env.OPENAI_ORG_ID,
      existing.organization,
    ),
    project: pickFirstNonEmpty(
      input.project,
      process.env.OPENAI_PROJECT_ID,
      existing.project,
    ),
  }

  if (!nextConfig.apiKey) {
    throw new Error(
      'Missing apiKey. Pass --api-key, set OPENAI_API_KEY, or ensure codex-provider.json already contains apiKey.',
    )
  }

  const filePath = writeCodexConfigFile(nextConfig)
  validateWrittenConfig()

  process.stdout.write(
    [
      `Codex 配置已写入：${filePath}`,
      `apiKey: ${maskApiKey(nextConfig.apiKey)}`,
      `baseUrl: ${nextConfig.baseUrl ?? '(default)'}`,
      `model: ${nextConfig.model ?? '(default)'}`,
      `organization: ${nextConfig.organization ?? '(unset)'}`,
      `project: ${nextConfig.project ?? '(unset)'}`,
      '',
      '现在可以直接运行：',
      '  bun run dev -p "Reply with OK only."',
      '  scripts/codex.cmd -p "Reply with OK only."',
      '  ./scripts/codex.ps1 -p "Reply with OK only."',
      '',
    ].join('\n'),
  )
}

try {
  main()
} catch (error) {
  process.stderr.write(
    `Error: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.stderr.write('Use --help to see setup options.\n')
  process.exit(1)
}
