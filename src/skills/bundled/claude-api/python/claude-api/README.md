# Python Claude API

如果你想在 Python 中直接调用 Claude API，优先使用官方 Anthropic Python SDK。

## 安装

```bash
pip install anthropic
```

可选扩展：

```bash
pip install anthropic[aiohttp]
pip install anthropic[bedrock]
pip install anthropic[vertex]
```

## 基础同步请求

```python
import os
from anthropic import Anthropic

client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

message = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Summarize the latest changelog."}
    ],
)

print(message.content)
```

## 异步请求

```python
import os
import asyncio
from anthropic import AsyncAnthropic


async def main() -> None:
    client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    message = await client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1024,
        messages=[{"role": "user", "content": "Hello, Claude"}],
    )
    print(message.content)


asyncio.run(main())
```

## 适合在这些场景使用

- 你需要直接访问原始的 `messages.create(...)`
- 你需要同步或异步 Python 客户端
- 你准备直接实现 streaming、tool use、batches 或 Files API

## 实践建议

- 优先使用当前稳定的模型别名，或你在应用中明确支持的精确模型 ID。
- 把长期稳定的上下文放在请求前部，便于利用 prompt caching。
- 长输出或对延迟敏感的 UI，优先用 streaming。
- 大规模异步任务优先用 Batches。
- 同一文档或图片需要跨请求复用时，优先用 Files API。

## 官方参考

- Python SDK：`https://platform.claude.com/docs/en/api/sdks/python`
- Client SDK 概览：`https://platform.claude.com/docs/en/api/client-sdks`
- Messages API 参考：`https://platform.claude.com/docs/en/api/python/messages`
