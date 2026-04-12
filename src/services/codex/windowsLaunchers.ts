import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { getClaudeConfigHomeDir } from 'src/utils/envUtils.js'
import { formatCodexWindowsScriptError } from './windowsDiagnostics.js'

export type CodexLauncherTarget = {
  fileName: string
  sourceRelativePath: string
}

const CODEX_WINDOWS_LAUNCHERS: CodexLauncherTarget[] = [
  {
    fileName: 'codex.cmd',
    sourceRelativePath: 'scripts\\codex.cmd',
  },
  {
    fileName: 'codex.ps1',
    sourceRelativePath: 'scripts\\codex.ps1',
  },
  {
    fileName: 'codex-setup.cmd',
    sourceRelativePath: 'scripts\\setup-codex.cmd',
  },
  {
    fileName: 'codex-setup.ps1',
    sourceRelativePath: 'scripts\\setup-codex.ps1',
  },
  {
    fileName: 'codex-selfcheck.cmd',
    sourceRelativePath: 'scripts\\codex-selfcheck.cmd',
  },
  {
    fileName: 'codex-selfcheck.ps1',
    sourceRelativePath: 'scripts\\codex-selfcheck.ps1',
  },
]

export function getCodexLauncherDir(): string {
  return (
    process.env.CLAUDE_CODE_LAUNCHER_DIR?.trim() ||
    join(getClaudeConfigHomeDir(), 'bin')
  )
}

function buildCmdLauncher(targetPath: string): string {
  return [
    '@echo off',
    'setlocal',
    '',
    `call "${targetPath}" %*`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n')
}

function buildPs1Launcher(targetPath: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    '',
    `& '${targetPath.replace(/'/g, "''")}' @args`,
    'exit $LASTEXITCODE',
    '',
  ].join('\n')
}

export function writeCodexWindowsLaunchers(args?: {
  launcherDir?: string
  repoRoot?: string
}): string[] {
  const launcherDir = args?.launcherDir ?? getCodexLauncherDir()
  const repoRoot = resolve(args?.repoRoot ?? process.cwd())
  try {
    mkdirSync(launcherDir, { recursive: true })
  } catch (error) {
    throw new Error(
      formatCodexWindowsScriptError({
        script: 'launcher-runtime',
        error,
      }),
    )
  }

  const writtenPaths: string[] = []
  for (const launcher of CODEX_WINDOWS_LAUNCHERS) {
    const outputPath = join(launcherDir, launcher.fileName)
    const targetPath = join(repoRoot, launcher.sourceRelativePath)
    const content = launcher.fileName.endsWith('.ps1')
      ? buildPs1Launcher(targetPath)
      : buildCmdLauncher(targetPath)

    try {
      writeFileSync(outputPath, content, 'utf8')
    } catch (error) {
      throw new Error(
        formatCodexWindowsScriptError({
          script: 'launcher-runtime',
          error: `${error instanceof Error ? error.message : String(error)} launcher=${outputPath} target=${targetPath}`,
        }),
      )
    }
    writtenPaths.push(outputPath)
  }

  return writtenPaths
}
