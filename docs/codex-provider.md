# Codex Provider 使用说明

当前仓库已经加入一个最小可用的 Codex provider 路径，用于 headless CLI 场景。

这条接入路径的范围刻意保持很窄：

- 不替换现有 Claude/Anthropic provider 栈
- 不改动现有命令树和 CLI bootstrap
- 只有显式打开环境变量开关时才会启用
- 当前阶段只支持 headless `--print` 请求，并额外提供基于持久化 state 的 `--continue` / `--resume`

## 当前已支持

- `claude -p "question"` 这一类单次问答
- 文本流式输出到 stdout
- `--output-format stream-json --verbose` 的事件流加最终结果
- `--output-format json` 的最终结果输出
- `--system-prompt` 和 `--append-system-prompt`
- `--json-schema` 的严格结构化输出校验
- 跨进程 `--continue`
- `--resume <state-id>`
- `--resume --resume-session-at <assistant-message-uuid>`

## 当前暂不支持

- 交互式 REPL 模式
- rewind、fork session
- `--input-format stream-json`
- 接入现有工具编排链路的 tool calling
- MCP / agent 工作流
- 在 structured output 回合里进行交互式工具使用或 agent orchestration

不支持的组合会直接 fail-fast，返回明确错误，而不是静默回退到其他路径。

## 如何启用

运行 CLI 前先设置以下环境变量：

```bash
export CLAUDE_CODE_USE_CODEX=1
export OPENAI_API_KEY=your_api_key
```

可选环境变量：

```bash
export CODEX_MODEL=gpt-5-codex
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_ORG_ID=org_123
export OPENAI_PROJECT_ID=proj_123
```

`CODEX_MODEL` 会优先使用自身；如果未设置，则回退到 `OPENAI_MODEL`，再回退到 `gpt-5-codex`。

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

## 回滚方式

如果想回到之前的默认行为，直接关闭特性开关：

```bash
unset CLAUDE_CODE_USE_CODEX
```

关闭后，`--print` 会重新走现有 Claude provider 路径。

## 实现位置

Codex 路径的接入口位于 `src/cli/print.ts`。

provider 具体实现位于 `src/services/codex`。

这样可以把改动限制在隔离区域内，后续继续扩展时不需要一次性重写整条查询链路。
