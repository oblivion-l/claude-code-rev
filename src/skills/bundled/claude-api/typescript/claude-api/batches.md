# TypeScript Batches

当场景不要求交互式延迟，并且你希望高效处理大量独立请求时，使用 message batches。

## 适用场景

- 大规模回填任务
- 离线分类任务
- 夜间摘要任务
- 每个任务彼此独立的文档处理队列

## 创建 batch

```ts
const batch = await client.messages.batches.create({
  requests: [
    {
      custom_id: 'item-1',
      params: {
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: 'Classify this ticket.' }],
      },
    },
  ],
})
```

## 运行建议

- 为每个请求设置稳定的 `custom_id`，便于把结果关联回你的任务记录。
- 每个请求都要自包含；batch 不是对话线程。
- 轮询 batch 状态，在处理完成后再拉取结果。
- 按“允许部分失败”的方式设计；有些请求成功，另一些失败是正常情况。

## 不建议这样做

- 把 batches 用在聊天 UI 上
- 假设结果顺序一定和输入顺序一致
- 发送彼此依赖、需要前一个模型输出的任务

## 参考资料

- Anthropic 文档：Message Batches API
