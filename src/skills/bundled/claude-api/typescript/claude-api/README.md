# TypeScript Claude API

如果你想在 TypeScript 中直接访问 Messages API，使用 `@anthropic-ai/sdk`。

## 安装

```bash
npm install @anthropic-ai/sdk
```

请在环境变量中设置 `ANTHROPIC_API_KEY`。

## 基础请求

```ts
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const message = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'Summarize this change in 3 bullets.' },
  ],
})
```

读取 `message.content` 中 `type === 'text'` 的部分即可拿到文本结果。

## 推荐的请求写法

- 始终显式设置 `model` 和 `max_tokens`。
- 如果一段指令需要跨轮持续生效，把它放进稳定的 system prompt。
- user message 尽量聚焦当前任务，只附带本轮真正需要的上下文。
- 响应式 UI 优先使用 streaming；需要结构化外部动作时再接 tool use。

## 会话组织方式

如果需要上下文连续性，就把前序轮次重新放回 `messages`。会话应尽量保持精简，优先总结或裁剪旧轮次，而不是无限回放整段长对话。

## 模型选择建议

- `claude-opus-4-6`：推理质量最高
- `claude-sonnet-4-6`：适合作为大多数产品工作负载的通用默认选择
- `claude-haiku-4-5`：适合更低延迟、更低成本的任务

在生产环境里硬编码模型 ID 前，先确认当前模型目录。

## 参考资料

- Anthropic 文档：Messages API
- Anthropic 文档：模型概览
