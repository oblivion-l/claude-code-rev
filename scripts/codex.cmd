@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."

if "%CLAUDE_CODE_USE_CODEX%"=="" (
  set "CLAUDE_CODE_USE_CODEX=1"
)

where bun >nul 2>nul
if errorlevel 1 (
  echo [codex.cmd] 未找到 bun，请先安装 Bun 并加入 PATH。
  exit /b 1
)

if "%OPENAI_API_KEY%"=="" (
  set "CLAUDE_CONFIG_HOME=%CLAUDE_CONFIG_DIR%"
  if "%CLAUDE_CONFIG_HOME%"=="" (
    set "CLAUDE_CONFIG_HOME=%USERPROFILE%\.claude"
  )

  set "CODEX_CONFIG_PATH=%CLAUDE_CODE_CODEX_CONFIG_PATH%"
  if "%CODEX_CONFIG_PATH%"=="" (
    set "CODEX_CONFIG_PATH=%CLAUDE_CONFIG_HOME%\codex-provider.json"
  )

  if not exist "%CODEX_CONFIG_PATH%" (
    echo [codex.cmd] 未检测到 OPENAI_API_KEY，也未找到 Codex 配置文件：
    echo   %CODEX_CONFIG_PATH%
    echo [codex.cmd] 可在该文件中写入 apiKey/baseUrl/model，或先设置 OPENAI_API_KEY。
    exit /b 1
  )
)

pushd "%REPO_ROOT%" >nul
bun run .\src\bootstrap-entry.ts %*
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

exit /b %EXIT_CODE%
