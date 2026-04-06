# Python Batches

当你有大量彼此独立的请求，并且不需要交互式低延迟时，使用 Message Batches。

## 适用场景

- 夜间批量评估
- 数据回填和迁移
- 大规模分类或摘要任务
- 那些“轮询结果比维持大量长连接更简单”的批量任务

## 创建 batch

```python
from anthropic import Anthropic

client = Anthropic()

batch = client.beta.messages.batches.create(
    requests=[
        {
            "custom_id": "ticket-1",
            "params": {
                "model": "claude-sonnet-4-5",
                "max_tokens": 512,
                "messages": [
                    {"role": "user", "content": "Summarize ticket #1"}
                ],
            },
        },
        {
            "custom_id": "ticket-2",
            "params": {
                "model": "claude-sonnet-4-5",
                "max_tokens": 512,
                "messages": [
                    {"role": "user", "content": "Summarize ticket #2"}
                ],
            },
        },
    ],
)
```

## 轮询完成状态

```python
batch = client.beta.messages.batches.retrieve(batch.id)
print(batch.processing_status)
print(batch.request_counts)
```

## 读取结果

结果不保证按请求顺序返回。要按 `custom_id` 对齐，而不是按数组位置。处理完成后，拉取或遍历 batch 结果，并按 `custom_id` 回填到你的应用记录里。

## 实践建议

- batches 只适合彼此独立的请求。
- 你自己要维护 `custom_id` 到源记录的映射关系。
- 要接受部分失败的现实：有些请求可能成功，另一些可能报错或过期。
- 如果用户需要即时反馈，改用普通的 Messages API。

## 官方参考

- Batch 指南/参考：`https://platform.claude.com/docs/en/api/messages/batches`
- Python batch 端点：`https://platform.claude.com/docs/en/api/python/beta/messages/batches/list`
