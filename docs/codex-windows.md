# Codex Windows 部署指南

这份文档用于在 Windows 机器上把当前仓库部署成一个可长期使用的 Codex 个人开发工具。

当前范围：

- 适用于当前仓库的 Codex provider 接入能力
- 覆盖首次安装、初始化配置、自检和最小运行
- 不扩展现有功能边界
- 不改变 Anthropic 默认路径

## 1. 安装前提

需要先安装：

- Bun
- Node.js
- Git

建议先在 PowerShell 中确认：

```powershell
bun --version
node --version
git --version
```

预期：

- 三条命令都能正常输出版本号

## 2. 获取仓库

```powershell
git clone https://github.com/oblivion-l/claude-code-rev.git
cd claude-code-rev
bun install
```

## 3. 一键安装

如果你希望尽量少手工操作，推荐直接运行一键安装脚本：

```powershell
.\scripts\install-codex.ps1 --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4 --skip-api
```

如果使用 `cmd.exe`：

```bat
scripts\install-codex.cmd --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4 --skip-api
```

说明：

- 默认会执行 `bun install`
- 会自动调用 `setup-codex`
- 会自动生成 launcher 到 `~/.claude/bin`
- 会自动调用 `codex-selfcheck`
- 加 `--skip-api` 时，只做本地自检，不发真实 API 请求

如果你希望保留手工分步控制，再继续看下面的分步方式。

可选：

- `--skip-install`：跳过 `bun install`
- `--skip-launchers`：跳过 launcher 生成
- `--launcher-dir <path>`：自定义 launcher 输出目录

## 4. 初始化 Codex 配置

推荐不要手工编辑 JSON，直接运行初始化脚本：

```powershell
.\scripts\setup-codex.ps1 --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4
```

如果使用 `cmd.exe`：

```bat
scripts\setup-codex.cmd --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4
```

脚本会：

- 写入 `~/.claude/codex-provider.json`
- 复用已有配置，只更新你显式传入的字段
- 对写入结果做一次本地校验

## 5. 执行本地自检

推荐先做本地自检，不直接上真实请求：

```powershell
.\scripts\codex-selfcheck.ps1 --skip-api
```

或：

```bat
scripts\codex-selfcheck.cmd --skip-api
```

预期：

- `bun`
- `node`
- `cli-version`
- `cli-help`
- `codex-config-source`

都显示 `PASS`

## 6. 执行真实 API 自检

确认本地检查通过后，再做真实 API 检查：

```powershell
.\scripts\codex-selfcheck.ps1
```

如果中转 API、模型或 key 可用，预期：

- `codex-api` 显示 `PASS`
- 汇总显示全部通过

如果这里只失败，而本地检查都通过，优先排查：

- API key 是否正确
- `baseUrl` 是否正确
- 模型是否受当前中转服务支持
- 本机网络或代理配置

## 7. 最小运行方式

headless：

```powershell
.\scripts\codex.ps1 -p "Reply with OK only."
```

REPL：

```powershell
.\scripts\codex.ps1
```

如果已经把 `~/.claude/bin` 加入 Windows PATH，也可以直接运行新生成的 launcher：

```powershell
codex.ps1 -p "Reply with OK only."
codex-selfcheck.ps1 --skip-api
```

## 8. 常见问题

`error_code=CODEX_WINDOWS_DEPENDENCY_BUN_MISSING`

- 说明 Bun 未安装，或当前终端没有刷新 PATH。
- 先安装 Bun，并重新打开 PowerShell / cmd。
- 包装脚本会同时给出 `hint=install-bun`，便于 grep 与日志检索。

`error_code=CODEX_WINDOWS_SETUP_API_KEY_MISSING` 或 `error_code=CODEX_WINDOWS_CONFIG_MISSING`

- 说明既没有环境变量，也没有 `codex-provider.json`。
- 先运行 `setup-codex.ps1`。
- 如果是 setup 直接报错，优先补 `--api-key` 或设置 `OPENAI_API_KEY`。

`error_code=CODEX_WINDOWS_API_CHECK_FAILED`

- 说明本地环境没问题，但真实 API 请求没有通过。
- 先检查 `~/.claude/codex-provider.json` 中的 `baseUrl`、`model`、`apiKey`。
- 如果只是想先验证本地链路，先执行 `codex-selfcheck.ps1 --skip-api`。

`error_code=CODEX_WINDOWS_INSTALL_DEPENDENCY_FAILED` / `CODEX_WINDOWS_INSTALL_LAUNCHER_FAILED` / `CODEX_WINDOWS_INSTALL_SELFCHECK_FAILED`

- 说明安装链路中的某一步失败了。
- 先看终端里最后一个失败步骤，是 `bun install`、`setup-codex` 还是 `codex-selfcheck`。
- 这些错误行会同时带 `step=...` 与 `hint=...`，可直接按步骤定位。

`error_code=CODEX_WINDOWS_LAUNCHER_WRITE_FAILED` 或找不到 `codex.ps1` / `codex.cmd`

- 说明 launcher 目录还没加入 PATH，或安装时跳过了 launcher 生成。
- 可重新执行 `bun run codex:install-launchers`，或在安装器里不要加 `--skip-launchers`。
- 如果是写入失败，优先检查 launcher 目录是否可写、是否被同名文件占用，错误行会带 `hint=check-launcher-dir` 或 `hint=check-permissions`。

## 8.1 失败到修复建议速查

| error_code | 常见原因 | 建议动作 |
| --- | --- | --- |
| `CODEX_WINDOWS_DEPENDENCY_BUN_MISSING` | Bun 未安装或 PATH 未刷新 | 安装 Bun，重开终端后重试 |
| `CODEX_WINDOWS_SETUP_API_KEY_MISSING` | setup 阶段没有可用 apiKey | 传 `--api-key` 或设置 `OPENAI_API_KEY` |
| `CODEX_WINDOWS_CONFIG_MISSING` | selfcheck 没找到环境变量和配置文件 | 先运行 `setup-codex.ps1` |
| `CODEX_WINDOWS_PERMISSION_DENIED` | 配置目录或 launcher 目录无写权限 | 切换到可写目录，或检查权限/安全软件拦截 |
| `CODEX_WINDOWS_PATH_ERROR` | 目标路径不存在、被文件占用或路径错误 | 检查 `--launcher-dir`、仓库路径和配置目录 |
| `CODEX_WINDOWS_INSTALL_SELFCHECK_FAILED` | 安装流程最终卡在自检 | 先单独运行 `codex-selfcheck.ps1 --skip-api` 缩小范围 |
| `CODEX_WINDOWS_API_CHECK_FAILED` | 本地 OK，但 API 请求失败 | 检查 `apiKey/baseUrl/model`，必要时先走 `--skip-api` |

## 9. 推荐日常流程

首次部署：

1. `bun install`
2. 或者直接运行 `.\scripts\install-codex.ps1 ...`
2. `.\scripts\setup-codex.ps1 ...`
3. `.\scripts\codex-selfcheck.ps1 --skip-api`
4. `.\scripts\codex-selfcheck.ps1`
5. `.\scripts\codex.ps1 -p "Reply with OK only."`

后续日常使用：

1. 直接运行 `.\scripts\codex.ps1`
2. 如果改了 key/baseUrl/model，重新执行 `.\scripts\setup-codex.ps1`
3. 出现异常时，优先执行 `.\scripts\codex-selfcheck.ps1 --skip-api`
