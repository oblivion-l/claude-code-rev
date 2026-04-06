# 实时资料来源

当答案依赖会变化的 Anthropic 文档时，应该使用 WebFetch 或浏览能力。

## 以下情况要查实时资料

- 当前模型 ID、别名或弃用情况
- 价格、速率限制或功能可用性
- 新增的工具类型或服务端工具
- Files、Batches 或 streaming API 的精确请求字段
- 当用户询问特定版本行为时，对应的 SDK 发布细节

## 优先使用的官方来源

- 文档总入口：`https://docs.anthropic.com/`
- 模型概览：`https://docs.anthropic.com/en/docs/about-claude/models/all-models`
- 功能概览：`https://docs.anthropic.com/en/docs/build-with-claude/overview`
- Tool use：`https://docs.anthropic.com/en/docs/build-with-claude/tool-use`
- Prompt caching：`https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching`
- API 参考：`https://docs.anthropic.com/en/api/`
- Anthropic SDK 仓库：Anthropic GitHub 组织下各语言 SDK 示例仓库

## 使用规则

只要问题有可能过时，就优先以官方文档页面为准，而不是凭记忆回答。引用时只摘录必要内容，其余部分做摘要，并附上实际使用的页面链接。
