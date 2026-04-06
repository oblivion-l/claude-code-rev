# TypeScript Tool Use

Tool use 允许 Claude 向你的应用请求结构化动作。你的代码负责定义工具、执行工具，再把工具结果发回对话。

## 定义工具

```ts
const tools = [
  {
    name: 'get_weather',
    description: 'Fetch the current weather for a city',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
      },
      required: ['city'],
    },
  },
]
```

## 搭配工具发起请求

```ts
const message = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  tools,
  messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
})
```

如果 Claude 返回 tool-use 块，就在应用里执行对应工具，然后追加一个 `tool_result` 轮次，再次调用 API。

## 实践建议

- tool schema 要尽量收窄并且明确。
- 工具执行前先验证输入。
- 能返回结构化、精简结果时，就不要直接回原始日志。
- 权限控制和副作用检查要放在你的代码里，而不是只写进模型 prompt。

## 不建议这样做

- 除非绝对必要，否则不要直接暴露 shell 或网络原语
- 给工具起模糊名字，或使用过宽的 schema
- 对真实集成省略重试和超时处理

## 参考资料

- Anthropic 文档：tool use
- Anthropic 文档：Messages API
