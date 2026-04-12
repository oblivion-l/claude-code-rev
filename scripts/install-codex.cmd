@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."

where bun >nul 2>nul
if errorlevel 1 (
  echo [install-codex.cmd] error_code=CODEX_WINDOWS_DEPENDENCY_BUN_MISSING hint=install-bun 未找到 bun，请先安装 Bun 并加入 PATH。
  exit /b 1
)

pushd "%REPO_ROOT%" >nul
bun run .\scripts\install-codex.ts %*
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

exit /b %EXIT_CODE%
