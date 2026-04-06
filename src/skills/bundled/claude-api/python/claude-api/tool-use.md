# Python Tool Use

Tool use 允许 Claude 决定何时请求工具、发出 `tool_use` 块，并在你返回匹配的 `tool_result` 后继续执行。

## 定义工具

```python
tools = [
    {
        "name": "get_weather",
        "description": "Return current weather for a city",
        "input_schema": {
            "type": "object",
            "properties": {
                "city": {"type": "string"},
            },
            "required": ["city"],
        },
    }
]
```

## 第一次模型调用

```python
message = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    tools=tools,
    messages=[
        {"role": "user", "content": "What is the weather in Tokyo?"}
    ],
)
```

## 处理 `tool_use` 并继续

检查 `message.content` 中 `type == "tool_use"` 的块。执行对应工具后，再发送一条后续 user message，其中包含 `tool_result` 块，并保证 `tool_use_id` 与该次工具调用一致。

```python
messages = [
    {"role": "user", "content": "What is the weather in Tokyo?"},
    {"role": "assistant", "content": message.content},
    {
        "role": "user",
        "content": [
            {
                "type": "tool_result",
                "tool_use_id": tool_use.id,
                "content": [{"type": "text", "text": "18C and clear"}],
            }
        ],
    },
]
```

然后带着更新后的消息历史再次调用 `client.messages.create(...)`。

## 实践建议

- tool schema 要尽量小而严格。
- 能返回机器可读数据时，就不要只返回自然语言。
- `tool_use_id` 必须精确匹配。
- 要预期模型可能发起多次工具调用，甚至并行请求多个工具。
- 如果你需要更高层的编排能力，优先考虑 Agent SDK，而不是手写工具循环。

## 官方参考

- Tool use 概览：`https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview`
- Python Messages API 参考：`https://platform.claude.com/docs/en/api/python/messages`
