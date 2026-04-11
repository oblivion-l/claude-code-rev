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

## 3. 初始化 Codex 配置

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

## 4. 执行本地自检

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

## 5. 执行真实 API 自检

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

## 6. 最小运行方式

headless：

```powershell
.\scripts\codex.ps1 -p "Reply with OK only."
```

REPL：

```powershell
.\scripts\codex.ps1
```

## 7. 常见问题

`未找到 bun，请先安装 Bun 并加入 PATH。`

- 说明 Bun 未安装，或当前终端没有刷新 PATH。
- 重新打开 PowerShell 后再试。

`未检测到 OPENAI_API_KEY，也未找到 Codex 配置文件`

- 说明既没有环境变量，也没有 `codex-provider.json`。
- 先运行 `setup-codex.ps1`。

`codex-api` 自检失败

- 说明本地环境没问题，但真实 API 请求没有通过。
- 先检查 `~/.claude/codex-provider.json` 中的 `baseUrl`、`model`、`apiKey`。

## 8. 推荐日常流程

首次部署：

1. `bun install`
2. `.\scripts\setup-codex.ps1 ...`
3. `.\scripts\codex-selfcheck.ps1 --skip-api`
4. `.\scripts\codex-selfcheck.ps1`
5. `.\scripts\codex.ps1 -p "Reply with OK only."`

后续日常使用：

1. 直接运行 `.\scripts\codex.ps1`
2. 如果改了 key/baseUrl/model，重新执行 `.\scripts\setup-codex.ps1`
3. 出现异常时，优先执行 `.\scripts\codex-selfcheck.ps1 --skip-api`
