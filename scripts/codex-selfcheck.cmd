@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."

where bun >nul 2>nul
if errorlevel 1 (
  echo [codex-selfcheck.cmd] 未找到 bun，请先安装 Bun 并加入 PATH。
  exit /b 1
)

pushd "%REPO_ROOT%" >nul
bun run .\scripts\codex-selfcheck.ts %*
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

exit /b %EXIT_CODE%
