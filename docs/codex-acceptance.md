# Codex 验收清单

这份文档用于 headless Codex 路径的发布验收。

本轮验收范围：

- 仅覆盖 headless `--print`
- 覆盖单轮请求和同进程 `--continue`
- 覆盖可选的 `--json-schema` structured outputs
- 不包含 REPL 改动
- 不包含 `--resume` 或跨进程恢复
- 不包含 MCP 或工具编排改动

## 环境准备

必备：

```bash
cd /home/qwer/claude-code-rev

bun --version
node --version
```

预期：

- `bun` 已安装，并且在 `PATH` 中可用
- Node.js 可用

设置运行时环境变量：

```bash
export CLAUDE_CODE_USE_CODEX=1
export OPENAI_API_KEY=your_api_key
export CODEX_MODEL=gpt-5-codex
```

可选：

```bash
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_ORG_ID=org_123
export OPENAI_PROJECT_ID=proj_123
```

## 脚本化验收

可使用仓库内置的验收脚本来执行这份文档中的可确定性检查：

```bash
bash scripts/codex-acceptance.sh --quick
bash scripts/codex-acceptance.sh --full
```

脚本模式：

- `--quick`：执行 preflight 和核心 happy path
- `--full`：执行完整脚本清单，包括可确定的 fail-fast 场景
- `--dry-run`：只打印将执行的命令，不实际运行

示例：

```bash
bash scripts/codex-acceptance.sh --dry-run --quick
bash scripts/codex-acceptance.sh --dry-run --full
```

说明：

- 非 dry-run 模式下，如果 `OPENAI_API_KEY` 未设置，脚本会友好报错并提前退出
- 单条命令失败后，脚本会继续执行后续项，并在最后统一汇总
- 只要有任一脚本化检查失败，脚本最终就会返回非零
- API 侧 structured-output rejection 仍保留为手工检查项，因为它依赖“能到达 API 但会拒绝 `text.format`”的特定模型或 base URL 组合

## 预检

执行：

```bash
bun test
bun run version
bun run dev --help
```

预期：

- 测试通过
- CLI 版本号可以正常输出
- `--help` 能正常渲染

## 验收命令

### 1. 纯文本成功路径

执行：

```bash
bun run dev -p "Explain the repository structure"
```

预期：

- 命令退出码为 `0`
- 文本正常流式输出或一次性输出
- 不出现 Codex schema 校验错误

### 2. `json` 最终结果成功路径

执行：

```bash
bun run dev -p --output-format json "List the top risks in this codebase"
```

预期：

- 命令退出码为 `0`
- 最终输出为单个 JSON 结果对象
- `subtype` 为 `success`

### 3. structured output 成功路径

执行：

```bash
bun run dev -p \
  --json-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}' \
  "Return a JSON object with summary"
```

预期：

- 命令退出码为 `0`
- 最终输出是满足 schema 的合法 JSON 文本
- 不打印 validation error

### 4. structured output `stream-json` 成功路径

执行：

```bash
bun run dev -p \
  --output-format stream-json \
  --verbose \
  --json-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}' \
  "Return a JSON object with summary"
```

预期：

- 命令退出码为 `0`
- 输出流中包含正常的流式事件
- 最终流中包含一个 `system` 事件，`subtype` 为 `codex_json_schema`
- 该事件包含 `parsed_result`
- 最终结果事件的 `subtype` 为 `"success"`

### 5. 本地 allowlist fail-fast 路径

执行：

```bash
CODEX_MODEL=gpt-4o-mini \
bun run dev -p \
  --json-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}' \
  "Return a JSON object with summary"
```

预期：

- 命令退出非零
- 请求会在成功发起 Codex structured-output 请求前 fail-fast
- 错误信息包含：
  `Model ... is not enabled for Codex --json-schema mode in this CLI build`

### 6. 非法 JSON schema fail-fast 路径

执行：

```bash
bun run dev -p \
  --json-schema '{"type":"object","properties":"broken"}' \
  "Return a JSON object with summary"
```

预期：

- 命令退出非零
- 错误信息包含：
  `Invalid JSON Schema for --json-schema`

### 7. API 侧 structured-output rejection 路径

执行：

使用一个“可以到达 API、但当前请求下不接受 `text.format`”的模型或 base URL 组合。

预期：

- 命令退出非零
- 错误信息比通用 HTTP 错误更具体
- 错误信息包含以下之一：
  - `Codex model ... is not supported for this request`
  - `Codex structured outputs are not supported for model ... or this API parameter set`
  - `Codex structured output request was rejected by the API for model ...`

### 8. 无同进程状态时的 `continue` fail-fast 路径

执行：

```bash
bun run dev -p --continue "Follow up on the prior answer"
```

预期：

- 在新进程中执行时，命令退出非零
- 错误信息包含：
  `Codex provider continue requested but no in-process conversation state is available. Continue only works within the same process.`

### 9. `resume` fail-fast 路径

执行：

```bash
bun run dev -p --resume "Follow up on the prior answer"
```

预期：

- 命令退出非零
- 错误信息包含：
  `Codex provider does not support --resume or --resume-session-at in this mode. Use a fresh request, or use --continue within the same process when conversation state is available.`

## 常见报错对照

| 错误文本 | 含义 | 建议处理方式 |
| --- | --- | --- |
| `Codex provider requires OPENAI_API_KEY when CLAUDE_CODE_USE_CODEX=1.` | 缺少 API key | 设置 `OPENAI_API_KEY` |
| `Model ... is not enabled for Codex --json-schema mode in this CLI build` | 本地 structured-output allowlist 拒绝了当前模型 | 使用 `CODEX_MODEL=gpt-5-codex` 或其他已明确支持的 Codex/GPT-5 模型 |
| `Codex model ... is not supported for this request` | API 明确拒绝了该模型或相关能力 | 更换模型或调整功能组合 |
| `Codex structured outputs are not supported for model ... or this API parameter set` | API 明确拒绝了 `text.format` 或相关 structured-output 参数 | 更换模型、后端、路径，或关闭 `--json-schema` |
| `Codex structured output request was rejected by the API for model ...` | API 拒绝了 structured-output 请求，但不属于更具体的 unsupported-parameter 分支 | 简化 schema 或调整模型/后端 |
| `Invalid JSON Schema for --json-schema` | 本地 schema 编译失败 | 修正 schema 结构 |
| `Codex structured output is not valid JSON` | 模型返回了非 JSON 文本 | 收紧提示词和输出目标 |
| `Codex structured output does not match the provided schema` | 返回的 JSON 没有通过本地 schema 校验 | 调整提示词或 schema |
| `Codex provider continue requested but no in-process conversation state is available. Continue only works within the same process.` | 在没有内存态会话链的情况下使用了 `--continue` | 在同一进程内重试，或改为 fresh request |
| `Codex provider does not support --resume or --resume-session-at in this mode. Use a fresh request, or use --continue within the same process when conversation state is available.` | Codex headless 路径仍不支持 `--resume` / `--resume-session-at` | 使用 fresh request，或仅在同进程内使用 `--continue` |

## 回滚方案

运行时回滚：

```bash
unset CLAUDE_CODE_USE_CODEX
```

预期：

- CLI 会回到现有 Claude/Anthropic headless 路径
- 不再走 Codex 专用请求链路

如果只想回滚 Codex 验收相关文档和脚本，可查看：

```bash
git log --oneline -- docs/codex-provider.md docs/codex-acceptance.md src/services/codex
```

如需回滚，只回退相关 Codex 提交即可，不要误回退无关的 Anthropic 或 CLI 提交。
