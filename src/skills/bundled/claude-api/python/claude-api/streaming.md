# Python Streaming

如果你希望文本边到边显示，而不是等到最终消息完成后一次性拿到结果，就使用 streaming。

## 简单文本流式输出

```python
from anthropic import Anthropic

client = Anthropic()

with client.messages.stream(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Write a short release note."}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

## 获取最终消息

如果你既想要 streaming 传输，又希望拿到最终结构化的 `Message`，可以先使用 stream helper，再调用 SDK 中返回完整响应对象的方法。

## 什么时候值得用 streaming

- 聊天或终端 UI
- 长文本生成
- 需要给用户提供进度反馈
- 对“尽早看到中间结果”很重要的 tool use 流程

## 实践建议

- 把流式事件当成 UI 的增量更新。
- 最终拼装完成的消息才是权威结果。
- 很长的非流式请求比 streaming 或 batches 更容易暴露在空闲网络超时风险下。
- 如果你不需要实时 token，普通 `messages.create(...)` 会更简单。

## 官方参考

- Streaming 指南：`https://platform.claude.com/docs/en/build-with-claude/streaming`
- Python SDK：`https://platform.claude.com/docs/en/api/sdks/python`
