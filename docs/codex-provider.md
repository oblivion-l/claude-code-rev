# Codex Provider 使用说明

当前仓库已经加入一个最小可用的 Codex provider 路径，用于 headless CLI 和最小交互式 REPL 场景。

这条接入路径的范围刻意保持很窄：

- 不替换现有 Claude/Anthropic provider 栈
- 不改动现有命令树和 CLI bootstrap
- 只有显式打开环境变量开关时才会启用
- 当前已支持 headless `--print` 与 Codex REPL

## 当前已支持

- `claude -p "question"` 这一类单次问答
- 文本流式输出到 stdout
- `--output-format stream-json --verbose` 的事件流加最终结果
- `--output-format json` 的最终结果输出
- `--system-prompt` 和 `--append-system-prompt`
- `--json-schema` 的严格结构化输出校验
- headless 跨进程 `--continue`
- headless `--resume <state-id>`
- headless `--resume --resume-session-at <assistant-message-uuid>`
- headless `--print` 下最小本地开发工具闭环
- 已连接 MCP server 的本地 bridge 工具闭环
- Codex REPL 文本多轮
- Codex REPL 下最小本地开发工具闭环
- Codex REPL 的同进程 `--continue`
- Codex REPL 的持久化 `--resume <state-id>` / `--resume-session-at`
- Codex REPL 下远程 MCP 直连
- Codex REPL 下本地 bridge MCP 工具执行

## 当前暂不支持

- rewind、fork session
- `--input-format stream-json`
- 接入现有 Anthropic 工具编排链路的 tool calling
- agent 工作流
- 在 structured output 回合里进行交互式工具使用或 agent orchestration
- REPL 里的 slash command 工具流

当前 MCP 仅支持以下范围：

- Codex API 原生远程 MCP 透传仍只在 Codex REPL 路径启用
- 原生远程 MCP 透传只接受绝对 `http(s)` URL 的 `http` / `sse` 服务
- 已由仓库现有 MCP client 成功连接的服务，可在 Codex 路径下通过本地 function bridge 暴露给模型
- 当前本地 bridge 会接住 `stdio`、`ws`，以及依赖 `headers`、`headersHelper`、`oauth` 的远程 MCP 配置
- `sdk`、`sse-ide`、`ws-ide`、`claudeai-proxy` 仍不直接暴露给 Codex provider
- 不接入现有 Anthropic agent 工作流与更复杂的 tool orchestration UI

当前 headless 本地工具仅支持以下范围：

- 仅在 `CLAUDE_CODE_USE_CODEX=1` 的 `--print` 路径启用
- 复用仓库现有工具执行框架，而不是提示词伪装
- 底层已抽成共享 Codex tool runtime，方便后续在其他 provider 路径复用，但当前对外开放范围仍只限 `--print`
- 当前只开放高价值本地开发工具：`Read`、`Glob`、`Grep`、`Write`、`Edit`、`Bash`、`PowerShell`
- 继续复用现有权限检查与工具执行逻辑
- 不开放 Agent、REPL slash command、交互式本地 JSX 工具
- 不保证与 Anthropic 路径的全部工具编排能力完全对齐

当前 REPL 本地工具仅支持以下范围：

- 仅在 `CLAUDE_CODE_USE_CODEX=1` 的 Codex REPL 路径启用
- 与 headless 共享同一套 Codex local function tool runtime
- 当前只开放高价值本地开发工具：`Read`、`Glob`、`Grep`、`Write`、`Edit`、`Bash`、`PowerShell`
- 继续复用仓库现有工具 schema、权限检查和工具执行逻辑
- 不接 REPL slash command 工具流，不开放 Agent 工具编排
- 与远程 MCP 透传保持并列关系，不合并成新的 orchestration 协议

当前 Codex MCP 的执行方式分为两类：

- 远程直连：适用于简单 `http` / `sse` 远程 MCP，直接把 `mcp` tool 定义发给 Codex Responses API
- 本地 bridge：适用于需要本地进程、认证辅助或 websocket 的 MCP，先由本仓库 MCP client 连接，再以 Codex function tool 方式暴露

当前 Codex tool capability matrix 为：

- headless `--print`：支持本地 function tools；可通过本地 bridge 使用已连接 MCP 工具；不支持远程 MCP 透传；不支持 remote MCP 与本地 function tools 混合
- Codex REPL：支持本地 function tools；支持远程 MCP 透传；支持本地 bridge MCP；支持两者混合装配

不支持的组合会直接 fail-fast，返回明确错误，而不是静默回退到其他路径。

## 如何启用

运行 CLI 前先设置以下环境变量：

```bash
export CLAUDE_CODE_USE_CODEX=1
export OPENAI_API_KEY=your_api_key
```

如果你希望长期稳定使用，尤其是在 Windows 上，不建议每次手工设置环境变量。当前 Codex provider 还支持从本地配置文件读取运行参数：

- 默认路径：`~/.claude/codex-provider.json`
- 可通过 `CLAUDE_CODE_CODEX_CONFIG_PATH` 指向自定义路径
- 环境变量优先级高于配置文件

配置文件示例：

```json
{
  "apiKey": "your_api_key",
  "baseUrl": "https://www.xmapi.cc/v1",
  "model": "gpt-5.4",
  "organization": "org_123",
  "project": "proj_123"
}
```

推荐用法：

- 临时调试：直接设置环境变量
- 长期本机使用：先运行 setup 脚本，再由脚本写入 `~/.claude/codex-provider.json`
- 多环境切换：设置 `CLAUDE_CODE_CODEX_CONFIG_PATH`

## 初始化脚本

为了减少手工编辑 JSON 的出错率，仓库中新增了 Codex 初始化脚本：

```bash
bun run codex:setup --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4
```

它会：

- 从命令行参数、当前环境变量和现有配置文件中合并最终配置
- 写入 `~/.claude/codex-provider.json`
- 对写入后的配置做一次本地校验
- 输出最终使用的配置路径和摘要

也可以只传部分参数，用于更新已有配置：

```bash
bun run codex:setup --base-url https://www.xmapi.cc/v1 --model gpt-5.4
```

可选环境变量：

```bash
export CODEX_MODEL=gpt-5-codex
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_ORG_ID=org_123
export OPENAI_PROJECT_ID=proj_123
```

`CODEX_MODEL` 会优先使用自身；如果未设置，则回退到 `OPENAI_MODEL`，再回退到 `gpt-5-codex`。

## Windows 启动方式

仓库中新增了两个 Windows 启动脚本：

- `scripts/codex.cmd`
- `scripts/codex.ps1`
- `scripts/setup-codex.cmd`
- `scripts/setup-codex.ps1`

它们会自动：

- 在未显式设置时补上 `CLAUDE_CODE_USE_CODEX=1`
- 优先使用已有环境变量
- 当未设置 `OPENAI_API_KEY` 时，检查 `~/.claude/codex-provider.json`
- 用当前仓库的 CLI bootstrap 启动 Codex provider
- 安装器可额外生成 launcher 到 `~/.claude/bin`

`cmd` 方式：

```bat
scripts\setup-codex.cmd --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4
scripts\codex.cmd -p "Explain this repository"
scripts\codex.cmd
```

PowerShell 方式：

```powershell
.\scripts\install-codex.ps1 --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4 --skip-api
.\scripts\setup-codex.ps1 --api-key your_api_key --base-url https://www.xmapi.cc/v1 --model gpt-5.4
.\scripts\codex-selfcheck.ps1 --skip-api
.\scripts\codex-selfcheck.ps1
.\scripts\codex.ps1 -p "Explain this repository"
.\scripts\codex.ps1
```

如果需要单独重建 launcher：

```powershell
bun run codex:install-launchers
```

默认输出到 `~/.claude/bin`。如果你把这个目录加入 Windows PATH，后续可以不进仓库目录直接运行这些脚本。

Windows 首次部署建议参考：

- [codex-windows.md](./codex-windows.md)

## 使用示例

普通文本流式输出：

```bash
bun run dev -p "Explain the repository structure"
```

`stream-json` 事件流：

```bash
bun run dev -p --output-format stream-json --verbose "Summarize src/cli/print.ts"
```

`json` 最终结果：

```bash
bun run dev -p --output-format json "List the top risks in this codebase"
```

搭配 `--json-schema` 的结构化输出：

```bash
bun run dev -p \
  --json-schema '{"type":"object","properties":{"summary":{"type":"string"},"risk":{"type":"string"}},"required":["summary"],"additionalProperties":false}' \
  "Summarize this repository as JSON"
```

搭配 `stream-json` 的结构化输出：

```bash
bun run dev -p \
  --output-format stream-json \
  --verbose \
  --json-schema '{"type":"object","properties":{"files":{"type":"array","items":{"type":"string"}}},"required":["files"],"additionalProperties":false}' \
  "Return the main source files as JSON"
```

跨进程 `--continue`：

```bash
bun run dev -p "Explain the repository structure"
bun run dev -p --continue "Now summarize the main risks"
```

显式 `--resume <state-id>`：

```bash
bun run dev -p --output-format json "Explain the repository structure"
bun run dev -p --resume <session_id> "Now summarize the main risks"
```

基于 assistant turn 的 `--resume-session-at`：

```bash
bun run dev -p --output-format stream-json --verbose "Explain the repository structure"
bun run dev -p --resume <session_id> --resume-session-at <assistant_message_uuid> "Branch from that earlier answer"
```

Codex REPL：

```bash
export CLAUDE_CODE_USE_CODEX=1
export OPENAI_API_KEY=your_api_key
bun run dev
```

带远程 MCP 配置的 Codex REPL：

```bash
export CLAUDE_CODE_USE_CODEX=1
export OPENAI_API_KEY=your_api_key
bun run dev --mcp-config ./mcp.remote.json
```

示例 `mcp.remote.json`：

```json
{
  "mcpServers": {
    "docs": {
      "type": "http",
      "url": "https://example.com/mcp"
    }
  }
}
```

## 验收说明

完整的发布验收清单和逐条命令预期见 [codex-acceptance.md](./codex-acceptance.md)。

当启用 `--json-schema` 时：

- CLI 会把 schema 以 strict structured output 模式发送给 Codex Responses API
- 最终响应会在本地解析为 JSON
- 解析后的 JSON 会按照提供的 schema 做校验
- 校验失败时返回非零退出码
- 在 `stream-json` 模式下，最终会输出一个 `system` 事件，`subtype` 为 `codex_json_schema`，并携带 `parsed_result` 或 `validation_error`

当启用 `--continue` / `--resume` 时：

- provider 会把 conversation state 持久化到本地磁盘
- `--continue` 会按当前工作目录加载最近一次成功的 Codex headless state
- `--resume <state-id>` 会按显式 state id 加载持久化 state
- `--resume-session-at` 会在持久化的 assistant turn history 中查找目标 turn，并从该 turn 对应的 response id 继续
- 当前默认持久化目录为 `~/.claude/headless-provider-state`
- 如需定向覆盖，可设置 `CLAUDE_CODE_HEADLESS_STATE_DIR`

## 常见错误

`Invalid JSON Schema for --json-schema`

- 说明本地无法编译该 schema。
- 先检查 `properties`、`type`、嵌套 schema 结构等字段是否写错。

`Model ... is not enabled for Codex --json-schema mode in this CLI build`

- 说明当前模型不在这版 CLI 的 structured output allowlist 里。
- 如果没有特别验证过其他模型，优先使用 `CODEX_MODEL=gpt-5-codex`。

`Codex model ... is not supported for this request`

- 说明请求已经到达 API，但 API 明确拒绝了该模型。
- 这个错误比本地 allowlist 更具体，表示后端明确不接受当前模型或能力组合。

`Codex structured outputs are not supported for model ... or this API parameter set`

- 说明请求已经到达 API，但 API 明确拒绝了 `text.format` 或相关 structured-output 参数。
- 通常表示当前模型、后端或参数组合不支持 Responses API 上的 structured output。

`Codex structured output is not valid JSON`

- 说明模型返回的文本无法解析成 JSON。
- 建议把提示词收紧，减少非结构化输出空间。

`Codex structured output does not match the provided schema`

- 说明模型虽然返回了 JSON，但没有通过本地 schema 校验。
- 重点检查必填字段、字段类型和 `additionalProperties`。

`Codex provider requires OPENAI_API_KEY when CLAUDE_CODE_USE_CODEX=1. You can also provide apiKey in ...`

- 说明既没有设置 `OPENAI_API_KEY`，也没有在本地 `codex-provider.json` 中提供 `apiKey`。
- 如果你在 Windows 上长期使用，建议写入本地配置文件而不是每次手工设置环境变量。

`Invalid Codex config file at ...`

- 说明本地 `codex-provider.json` 不是合法 JSON，或字段类型不正确。
- 检查 `apiKey`、`baseUrl`、`model`、`organization`、`project` 是否都是字符串。

`Codex provider continue requested but no conversation state is available for the current directory.`

- 说明使用了 `--continue`，但当前工作目录下没有可恢复的持久化 state。
- 先发起一次成功的 Codex headless 请求，或改用 `--resume <state-id>`。

`Codex provider resume requested but no persisted conversation state is available.`

- 说明使用了 `--resume`，但没有找到对应的持久化 state。
- 检查 `--resume <state-id>` 是否来自此前一次 Codex headless 结果的 `session_id`。

`Codex provider could not find persisted assistant turn ... for --resume-session-at.`

- 说明当前 state 中不存在你指定的 assistant turn。
- 这个值应来自此前 `json` 或 `stream-json` 输出中的 assistant 结果 `uuid`。

API 侧 schema 拒绝或不支持关键字

- 说明 schema 虽然能在本地编译，但被 OpenAI API 的 structured output 子集拒绝了。
- 优先删除不受支持的关键字，或简化 schema 结构。

`Codex MCP server "..." uses unsupported transport "..."`

- 说明当前 MCP 配置里包含 Codex 原生远程透传无法处理的 transport。
- 对于 `stdio`、`ws` 或需要认证辅助的远程 MCP，当前新版会优先尝试走本地 bridge；只有在未接上本地 bridge 的上下文里才会继续报这个错误。

`Codex MCP server "..." uses headers, headersHelper, or oauth ...`

- 说明该 MCP 服务依赖本地认证或请求改写能力。
- 当前推荐走本地 bridge；如果你仍然触发这个错误，通常表示这次请求没有拿到已连接的 MCP runtime。

`Codex local function tools are not supported for model ... or this API parameter set`

- 说明请求里启用了 Codex 本地 function tools，但 API 明确拒绝了 `tools` 参数或对应能力组合。
- 这通常表示当前模型或当前 Responses API 参数组合不支持本地 function tools。

`Codex locally bridged MCP tools are not supported for model ... or this API parameter set`

- 说明你当前使用的是通过本仓库 MCP client 桥接出来的 MCP 工具，而不是直接透传的远程 `mcp` tool。
- 这通常表示当前模型或当前 Responses API 参数组合不支持这类 function-tool 形式的桥接工具。

`Codex provider currently does not support remote MCP tools in --print mode.`

- 说明你触发了超出当前 headless capability matrix 的工具组合。
- 当前远程 MCP 只在 Codex REPL 路径支持。

## 回滚方式

如果想回到之前的默认行为，直接关闭特性开关：

```bash
unset CLAUDE_CODE_USE_CODEX
```

关闭后，`--print` 会重新走现有 Claude provider 路径。

## 实现位置

Codex headless 路径的接入口位于 `src/cli/print.ts`。

Codex REPL 路径的接入口位于 `src/replLauncher.tsx`。

provider 具体实现位于 `src/services/codex`。

其中本地工具执行的共享 runtime 定义位于 `src/services/codex/toolRuntime.ts`。

远程 MCP 与本地 function tools 的共享装配层位于 `src/services/codex/orchestration.ts`。

请求级工具策略决策层位于 `src/services/codex/requestPolicy.ts`。

模型级能力策略位于 `src/services/codex/modelPolicy.ts`。

该层目前采用“默认策略 + 按模型前缀覆盖”的方式组织，便于后续按新模型小步扩展，而不改执行层。

当前已进一步整理为“按能力分组的 declarative registry”，便于分别维护 structured output、工具能力等模型差异。

这样可以把改动限制在隔离区域内，后续继续扩展时不需要一次性重写整条查询链路。
