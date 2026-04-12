import { formatCodexWindowsScriptError } from '../src/services/codex/windowsDiagnostics.js'

type InstallOptions = {
  apiKey?: string
  baseUrl?: string
  model?: string
  organization?: string
  project?: string
  launcherDir?: string
  skipApi: boolean
  skipInstall: boolean
  skipLaunchers: boolean
}

type Step = {
  name: string
  command: string[]
}

function printUsage(): void {
  process.stdout.write(
    [
      '用法：bun run ./scripts/install-codex.ts [options]',
      '',
      '选项：',
      '  --api-key <value>      传给 setup-codex 的 apiKey',
      '  --base-url <value>     传给 setup-codex 的 baseUrl',
      '  --model <value>        传给 setup-codex 的 model',
      '  --org-id <value>       传给 setup-codex 的 organization',
      '  --project-id <value>   传给 setup-codex 的 project',
      '  --launcher-dir <path>  launcher 输出目录，默认 ~/.claude/bin',
      '  --skip-install         跳过 bun install',
      '  --skip-launchers       跳过 launcher 生成',
      '  --skip-api             自检时只做本地检查，不发真实 API 请求',
      '  --help                 显示帮助',
      '',
      '默认流程：',
      '  1. bun install',
      '  2. bun run codex:setup ...',
      '  3. bun run codex:install-launchers',
      '  4. bun run codex:selfcheck [--skip-api]',
      '',
    ].join('\n'),
  )
}

function parseArgs(argv: string[]): InstallOptions {
  const options: InstallOptions = {
    skipApi: false,
    skipInstall: false,
    skipLaunchers: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current) {
      continue
    }

    if (current === '--help' || current === '-h') {
      printUsage()
      process.exit(0)
    }

    if (current === '--skip-api') {
      options.skipApi = true
      continue
    }

    if (current === '--skip-install') {
      options.skipInstall = true
      continue
    }

    if (current === '--skip-launchers') {
      options.skipLaunchers = true
      continue
    }

    const nextValue = argv[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for ${current}`)
    }

    switch (current) {
      case '--api-key':
        options.apiKey = nextValue
        index += 1
        break
      case '--base-url':
        options.baseUrl = nextValue
        index += 1
        break
      case '--model':
        options.model = nextValue
        index += 1
        break
      case '--org-id':
        options.organization = nextValue
        index += 1
        break
      case '--project-id':
        options.project = nextValue
        index += 1
        break
      case '--launcher-dir':
        options.launcherDir = nextValue
        index += 1
        break
      default:
        throw new Error(`Unknown argument: ${current}`)
    }
  }

  return options
}

function buildSetupCommand(options: InstallOptions): string[] {
  const command = ['bun', 'run', 'codex:setup']

  if (options.apiKey) {
    command.push('--api-key', options.apiKey)
  }
  if (options.baseUrl) {
    command.push('--base-url', options.baseUrl)
  }
  if (options.model) {
    command.push('--model', options.model)
  }
  if (options.organization) {
    command.push('--org-id', options.organization)
  }
  if (options.project) {
    command.push('--project-id', options.project)
  }

  return command
}

function buildSelfCheckCommand(options: InstallOptions): string[] {
  const command = ['bun', 'run', 'codex:selfcheck']

  if (options.skipApi) {
    command.push('--skip-api')
  }

  return command
}

function buildLauncherCommand(options: InstallOptions): string[] {
  const command = ['bun', 'run', 'codex:install-launchers']

  if (options.launcherDir) {
    command.push('--launcher-dir', options.launcherDir)
  }

  return command
}

function quoteCommand(command: string[]): string {
  return command
    .map(part => (/\s/.test(part) ? `"${part}"` : part))
    .join(' ')
}

function runStep(step: Step): void {
  process.stdout.write(`\n[install-codex] ${step.name}\n`)
  process.stdout.write(`[install-codex] > ${quoteCommand(step.command)}\n`)

  const proc = Bun.spawnSync(step.command, {
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
    env: process.env,
  })

  if (proc.exitCode !== 0) {
    throw new Error(
      formatCodexWindowsScriptError({
        script: 'install-codex',
        stepName: step.name,
        error: `${step.name} failed with exit code ${proc.exitCode}.`,
      }),
    )
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))

  const steps: Step[] = []
  if (!options.skipInstall) {
    steps.push({
      name: '安装依赖',
      command: ['bun', 'install'],
    })
  }

  steps.push({
    name: '初始化 Codex 配置',
    command: buildSetupCommand(options),
  })

  if (!options.skipLaunchers) {
    steps.push({
      name: '生成 Windows launcher',
      command: buildLauncherCommand(options),
    })
  }

  steps.push({
    name: options.skipApi ? '执行本地自检' : '执行完整自检',
    command: buildSelfCheckCommand(options),
  })

  for (const step of steps) {
    runStep(step)
  }

  process.stdout.write(
    [
      '',
      '[install-codex] 安装流程完成。',
      '[install-codex] 现在可以直接运行：',
      '  scripts/codex.cmd -p "Reply with OK only."',
      '  ./scripts/codex.ps1 -p "Reply with OK only."',
      '  ./scripts/codex.ps1',
      options.skipLaunchers
        ? '  (已跳过 launcher 生成)'
        : `  launcher 目录：${options.launcherDir ?? '~/.claude/bin'}`,
      '',
    ].join('\n'),
  )
}

try {
  main()
} catch (error) {
  process.stderr.write(
    `Error: ${formatCodexWindowsScriptError({
      script: 'install-codex',
      error,
    })}\n`,
  )
  process.stderr.write('Use --help to see install options.\n')
  process.exit(1)
}
