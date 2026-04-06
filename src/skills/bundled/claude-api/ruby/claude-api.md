# Ruby Claude API

Ruby 可以直接用 `Net::HTTP` 调用 Messages API。

## 最小示例

```ruby
require 'json'
require 'net/http'
require 'uri'

uri = URI('https://api.anthropic.com/v1/messages')
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::Post.new(uri)
request['x-api-key'] = ENV.fetch('ANTHROPIC_API_KEY')
request['anthropic-version'] = '2023-06-01'
request['content-type'] = 'application/json'
request.body = JSON.generate(
  model: '{{SONNET_ID}}',
  max_tokens: 512,
  messages: [
    {
      role: 'user',
      content: 'Write a compact incident summary for a failed deploy.'
    }
  ]
)

response = http.request(request)
raise response.body unless response.is_a?(Net::HTTPSuccess)

puts response.body
```

## 说明

- 解析 JSON 响应后，从 `content` 中提取文本块。
- 生产环境里要给 HTTP client 设置连接和读取超时。
- 重试和限流处理应收敛在一个共享 client 对象里，不要在多个 job 或 controller 中重复实现。
