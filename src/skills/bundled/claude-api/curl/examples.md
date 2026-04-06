# cURL 示例

当你还没切到 SDK、想先验证最原始的 HTTP 请求时，用这些示例。

## 基础消息请求

```bash
curl https://api.anthropic.com/v1/messages \
  --header "x-api-key: $ANTHROPIC_API_KEY" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --data '{
    "model": "{{SONNET_ID}}",
    "max_tokens": 256,
    "messages": [
      {"role": "user", "content": "Write a two-line release note summary."}
    ]
  }'
```

## 搭配 System Prompt

```bash
curl https://api.anthropic.com/v1/messages \
  --header "x-api-key: $ANTHROPIC_API_KEY" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --data '{
    "model": "{{SONNET_ID}}",
    "max_tokens": 256,
    "system": "You are a terse technical assistant.",
    "messages": [
      {"role": "user", "content": "Explain eventual consistency in one paragraph."}
    ]
  }'
```

## JSON 输出模式

```bash
curl https://api.anthropic.com/v1/messages \
  --header "x-api-key: $ANTHROPIC_API_KEY" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --data '{
    "model": "{{SONNET_ID}}",
    "max_tokens": 256,
    "messages": [
      {
        "role": "user",
        "content": "Return JSON only: {\"severity\": string, \"summary\": string} for a database outage."
      }
    ]
  }'
```

## 说明

- 调试请求头、认证或 payload 结构时，优先先用 cURL。
- 当请求体稳定后，再切换到语言 SDK。
- 如果要做 streaming、batches 或 files，优先看对应 skill 文档，而不是继续把这些一次性 shell 命令堆大。
