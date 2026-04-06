# Claude API

当用户要基于 Anthropic API 或 SDK 开发时，使用这个 skill，包括 `@anthropic-ai/sdk`、`anthropic` 以及 Agent SDK 集成。

## 这个 Skill 覆盖的内容

- 各支持语言下的 Messages API 基础用法
- Streaming 响应与增量渲染
- 重复上下文场景下的 prompt caching
- Tool use 与 agent 风格编排
- Batches 与 Files API 工作流
- 模型选择与错误处理

## 使用规则

- 优先采用 Anthropic 官方文档和 SDK 习惯用法，而不是泛化的 LLM 建议。
- 在可能的情况下，让示例代码和用户当前语言保持一致。
- 标准请求流程、认证和请求结构优先看各语言自己的 `README.md`。
- 模型、缓存、tool-use 概念、错误码等跨 SDK 主题，优先看 shared 文档。
- 如果用户问的是精确模型 ID、功能可用性或价格，这些容易变化的信息在回答前必须去核对 Anthropic 最新文档。

## 阅读指引

- 基础请求/响应流程：`{lang}/claude-api/README.md`
- Streaming 输出：`{lang}/claude-api/streaming.md`
- Tool use：`shared/tool-use-concepts.md` 和 `{lang}/claude-api/tool-use.md`
- Prompt caching：`shared/prompt-caching.md`
- Batch 处理：`{lang}/claude-api/batches.md`
- 文件上传流程：`{lang}/claude-api/files-api.md`
- 模型选择与命名：`shared/models.md`
- API 与 SDK 失败排查：`shared/error-codes.md`
- 需要最新信息时的来源：`shared/live-sources.md`

## 回答风格

- 当用户要求实现帮助时，给出可直接用于生产的示例，而不是伪代码。
- 如果某个结论是根据文档推断出来的，而不是文档明确保证的，要直接说明。
- 如果请求依赖模型名、价格等高频变化的信息，就去查 Anthropic 文档并引用对应页面。
