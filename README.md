# 还原后的 Claude Code 源码

![Preview](preview.png)

这个仓库是一个主要通过 source map 逆向还原、再补齐缺失模块后得到的 Claude Code 源码树。

它并不是上游仓库的原始状态。部分文件无法仅凭 source map 恢复，因此目前仍包含兼容 shim 或降级实现，以便项目可以重新安装并运行。

## 当前状态

- 该源码树已经可以在本地开发流程中恢复并运行。
- `bun install` 可以成功执行。
- `bun run version` 可以成功执行。
- `bun run dev` 现在会通过还原后的真实 CLI bootstrap 启动，而不是临时的 `dev-entry`。
- `bun run dev --help` 可以显示还原后的完整命令树。
- 仍有部分模块保留恢复期 fallback，因此行为可能与原始 Claude Code 实现不同。

## 已恢复内容

最近一轮恢复工作已经补回了最初 source-map 导入之外的几个关键部分：

- 默认 Bun 脚本现在会走真实的 CLI bootstrap 路径。
- `claude-api` 和 `verify` 的 bundled skill 内容已经从占位文件恢复为可用参考文档。
- Chrome MCP 和 Computer Use MCP 的兼容层现在会暴露更接近真实的工具目录，并返回结构化的降级响应，而不是空 stub。
- 一些显式占位资源已经替换为可用的 planning 与 permission-classifier fallback prompt。

当前剩余缺口主要集中在私有或原生集成部分，这些实现无法仅凭 source map 完整恢复，因此这些区域仍依赖 shim 或降级行为。

## 为什么会有这个仓库

source map 本身并不能包含完整的原始仓库：

- 类型专用文件经常缺失。
- 构建时生成的文件可能不存在。
- 私有包包装层和原生绑定可能无法恢复。
- 动态导入和资源文件经常不完整。

这个仓库的目标是把这些缺口补到“可用、可运行”的程度，形成一个可继续修复的恢复工作区。

## 运行方式

环境要求：

- Bun 1.3.5 或更高版本
- Node.js 24 或更高版本

安装依赖：

```bash
bun install
```

运行恢复后的 CLI：

```bash
bun run dev
```

输出恢复后的版本号：

```bash
bun run version
```

## Codex Provider 最小接入

仓库中已经加入一个最小可用的 Codex provider headless 接入路径，但默认关闭，只有设置 `CLAUDE_CODE_USE_CODEX=1` 才会启用。

当前范围：

- 支持 `--print` 单轮文本问答
- 支持流式文本输出
- 支持 `--json-schema` 结构化输出最小兼容
- 支持持久化 `--continue` / `--resume`
- 保留现有 CLI bootstrap 和命令树
- 在环境变量关闭时，默认仍走原有 Claude provider 路径

快速开始：

```bash
export CLAUDE_CODE_USE_CODEX=1
export OPENAI_API_KEY=your_api_key
bun run dev -p "Explain this repository"
```

长期使用建议：

- Linux/macOS：可继续使用环境变量，或写入 `~/.claude/codex-provider.json`
- Windows：优先使用 `scripts\codex.cmd` 或 `.\scripts\codex.ps1`
- 如果使用第三方中转 API，可在本地配置文件中写入 `baseUrl` 和 `model`

Windows 一键安装：

```bat
scripts\install-codex.cmd --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4 --skip-api
```

```powershell
.\scripts\install-codex.ps1 --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4 --skip-api
```

安装器默认还会生成 launcher 到 `~/.claude/bin`，后续可把该目录加入 Windows PATH。

推荐先执行初始化脚本：

```bash
bun run codex:setup --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4
```

Windows：

```bat
scripts\setup-codex.cmd --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4
```

```powershell
.\scripts\setup-codex.ps1 --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4
```

建议在 Windows 上初始化后再执行一次自检：

```powershell
.\scripts\codex-selfcheck.ps1 --skip-api
.\scripts\codex-selfcheck.ps1
```

配置文件示例：

```json
{
  "apiKey": "your_api_key",
  "baseUrl": "https://www.xmapi.cc/v1",
  "model": "gpt-5.4"
}
```

详细说明见：

- [Codex Provider 使用说明](./docs/codex-provider.md)
- [Codex 验收清单](./docs/codex-acceptance.md)
- [Codex Windows 部署指南](./docs/codex-windows.md)
