# TypeScript Streaming

如果你希望用户逐步看到输出，或者希望更早观察到 tool use 和长文本生成过程，就使用 streaming。

## 基础模式

```ts
const stream = await client.messages.stream({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Draft a release note.' }],
})

for await (const event of stream) {
  // Handle text deltas, message state, and completion events.
}
```

## UI 建议

- 增量内容一到就渲染，不要等到最终消息完成。
- 在状态中保留最终拼装好的完整结果，便于持久化。
- 当用户关闭界面或提交新任务时，要显式处理取消逻辑。

## 可靠性说明

- 按事件驱动方式解析，而不是期待一次性收到完整 JSON。
- 如果你需要 usage 或 stop reason 等元数据，要保留最终完成的消息。
- 不要假设每条 stream 都只产出文本；兼容流程里也可能出现与工具相关的事件。

## 适用场景

- 聊天 UI
- 长摘要生成
- 代码生成视图
- 响应迅速的终端输出

## 参考资料

- Anthropic 文档：Messages 流式响应
