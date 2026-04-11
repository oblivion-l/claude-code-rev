$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

if (-not $env:CLAUDE_CODE_USE_CODEX) {
  $env:CLAUDE_CODE_USE_CODEX = '1'
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Error '[codex.ps1] 未找到 bun，请先安装 Bun 并加入 PATH。'
}

if (-not $env:OPENAI_API_KEY) {
  $claudeConfigDir = $env:CLAUDE_CONFIG_DIR
  if (-not $claudeConfigDir) {
    $claudeConfigDir = Join-Path $HOME '.claude'
  }

  $codexConfigPath = $env:CLAUDE_CODE_CODEX_CONFIG_PATH
  if (-not $codexConfigPath) {
    $codexConfigPath = Join-Path $claudeConfigDir 'codex-provider.json'
  }

  if (-not (Test-Path -LiteralPath $codexConfigPath)) {
    Write-Error @"
[codex.ps1] 未检测到 OPENAI_API_KEY，也未找到 Codex 配置文件：
  $codexConfigPath
[codex.ps1] 可在该文件中写入 apiKey/baseUrl/model，或先设置 OPENAI_API_KEY。
"@
  }
}

Push-Location $repoRoot
try {
  & bun run ./src/bootstrap-entry.ts @args
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
