$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Error '[install-codex.ps1] 未找到 bun，请先安装 Bun 并加入 PATH。'
}

Push-Location $repoRoot
try {
  & bun run ./scripts/install-codex.ts @args
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
