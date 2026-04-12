import { existsSync } from 'fs'
import { getCodexConfigFilePath, readCodexConfigFile } from '../src/services/codex/configFile.js'
import {
  classifyCodexWindowsSelfCheckFailure,
  formatCodexWindowsScriptError,
} from '../src/services/codex/windowsDiagnostics.js'

type SelfCheckOptions = {
  skipApi: boolean
}

type CheckResult = {
  name: string
  ok: boolean
  detail: string
}

function parseArgs(argv: string[]): SelfCheckOptions {
  const options: SelfCheckOptions = {
    skipApi: false,
  }

  for (const arg of argv) {
    if (arg === '--skip-api') {
      options.skipApi = true
      continue
    }

    if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          '用法：bun run ./scripts/codex-selfcheck.ts [--skip-api]',
          '',
          '选项：',
          '  --skip-api   只做本地环境与配置检查，不发起真实 API 请求',
          '  --help       显示帮助',
          '',
        ].join('\n'),
      )
      process.exit(0)
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function maskApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    return '(unset)'
  }

  if (apiKey.length <= 8) {
    return '***'
  }

  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
}

function runCommand(args: string[]): {
  ok: boolean
  detail: string
} {
  const result = Bun.spawnSync(args, {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  })

  const stdout = result.stdout.toString().trim()
  const stderr = result.stderr.toString().trim()
  const detail = [stdout, stderr].filter(Boolean).join(' | ')

  return {
    ok: result.exitCode === 0,
    detail: detail || `exit=${result.exitCode}`,
  }
}

function formatResult(result: CheckResult): string {
  const status = result.ok ? 'PASS' : 'FAIL'
  return `[${status}] ${result.name}: ${result.detail}`
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const results: CheckResult[] = []

  const configPath = getCodexConfigFilePath()
  const hasEnvApiKey = Boolean(process.env.OPENAI_API_KEY?.trim())
  const hasConfigFile = existsSync(configPath)
  let configDetail = `path=${configPath}`

  if (hasConfigFile) {
    const config = readCodexConfigFile()
    configDetail =
      `${configDetail}, apiKey=${maskApiKey(config.apiKey)}, baseUrl=${config.baseUrl ?? '(unset)'}, model=${config.model ?? '(unset)'}`
  }

  results.push({
    name: 'bun',
    ...runCommand(['bun', '--version']),
  })

  results.push({
    name: 'node',
    ...runCommand(['node', '--version']),
  })

  const versionCheck = runCommand(['bun', 'run', 'version'])
  results.push({
    name: 'cli-version',
    ok: versionCheck.ok,
    detail: versionCheck.detail,
  })

  const helpCheck = runCommand(['bun', 'run', 'dev', '--help'])
  results.push({
    name: 'cli-help',
    ok: helpCheck.ok,
    detail: helpCheck.detail,
  })

  results.push({
    name: 'codex-config-source',
    ok: hasEnvApiKey || hasConfigFile,
    detail: hasEnvApiKey
      ? `OPENAI_API_KEY=${maskApiKey(process.env.OPENAI_API_KEY)}`
      : hasConfigFile
        ? configDetail
        : `未找到 OPENAI_API_KEY，且配置文件不存在: ${configPath}`,
  })

  if (!options.skipApi) {
    const apiEnv = {
      ...process.env,
      CLAUDE_CODE_USE_CODEX: '1',
    }
    const apiCheck = Bun.spawnSync(
      [
        'bun',
        'run',
        'dev',
        '-p',
        'Reply with OK only. Do not use any tools. Output exactly OK.',
      ],
      {
        cwd: process.cwd(),
        env: apiEnv,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
      },
    )

    const stdout = apiCheck.stdout.toString().trim()
    const stderr = apiCheck.stderr.toString().trim()
    const detail = [stdout, stderr].filter(Boolean).join(' | ')
    results.push({
      name: 'codex-api',
      ok: apiCheck.exitCode === 0 && stdout.includes('OK'),
      detail: detail || `exit=${apiCheck.exitCode}`,
    })
  }

  const failed = results.filter(result => !result.ok)

  process.stdout.write(
    [
      'Codex 自检结果：',
      ...results.map(formatResult),
      '',
      `汇总：${results.length - failed.length}/${results.length} 通过`,
      ...(failed.length > 0
        ? [
            '',
            '修复建议：',
            ...failed.map(result => {
              const diagnostic = classifyCodexWindowsSelfCheckFailure({
                name: result.name,
                detail: result.detail,
              })
              return `- ${result.name} error_code=${diagnostic.errorCode} hint=${diagnostic.hint} detail=${diagnostic.message}`
            }),
          ]
        : []),
      '',
    ].join('\n'),
  )

  if (failed.length > 0) {
    process.exit(1)
  }
}

try {
  await main()
} catch (error) {
  process.stderr.write(
    `Error: ${formatCodexWindowsScriptError({
      script: 'codex-selfcheck',
      error,
    })}\n`,
  )
  process.stderr.write('Use --help to see selfcheck options.\n')
  process.exit(1)
}
