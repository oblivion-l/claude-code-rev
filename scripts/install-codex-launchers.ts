import {
  getCodexLauncherDir,
  writeCodexWindowsLaunchers,
} from '../src/services/codex/windowsLaunchers.js'

function printUsage(): void {
  process.stdout.write(
    [
      '用法：bun run ./scripts/install-codex-launchers.ts [--launcher-dir <path>]',
      '',
      '选项：',
      '  --launcher-dir <path>  指定 launcher 输出目录',
      '  --help                 显示帮助',
      '',
      `默认目录：${getCodexLauncherDir()}`,
      '',
    ].join('\n'),
  )
}

function parseArgs(argv: string[]): { launcherDir?: string } {
  const result: { launcherDir?: string } = {}

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current) {
      continue
    }

    if (current === '--help' || current === '-h') {
      printUsage()
      process.exit(0)
    }

    if (current === '--launcher-dir') {
      const nextValue = argv[index + 1]
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('Missing value for --launcher-dir')
      }
      result.launcherDir = nextValue
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${current}`)
  }

  return result
}

try {
  const args = parseArgs(process.argv.slice(2))
  const writtenPaths = writeCodexWindowsLaunchers({
    launcherDir: args.launcherDir,
  })

  process.stdout.write(
    [
      `Codex launcher 已生成到：${args.launcherDir ?? getCodexLauncherDir()}`,
      ...writtenPaths.map(path => `  - ${path}`),
      '',
      '建议把该目录加入 Windows PATH，或固定用绝对路径调用这些脚本。',
      '',
    ].join('\n'),
  )
} catch (error) {
  process.stderr.write(
    `Error: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.stderr.write('Use --help to see launcher options.\n')
  process.exit(1)
}
