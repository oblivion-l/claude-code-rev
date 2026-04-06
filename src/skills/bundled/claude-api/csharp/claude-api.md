# C# Claude API

如果你只需要一个最小可用的 C# 接入方式，直接通过 HTTPS 调 Messages API 即可。

## 前置条件

- 设置 `ANTHROPIC_API_KEY`
- 使用 Messages 端点：`https://api.anthropic.com/v1/messages`
- 发送以下请求头：
  - `x-api-key`
  - `anthropic-version: 2023-06-01`
  - `content-type: application/json`

## 最小示例

```csharp
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

var apiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");
using var http = new HttpClient();

http.DefaultRequestHeaders.Add("x-api-key", apiKey);
http.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
http.DefaultRequestHeaders.Accept.Add(
    new MediaTypeWithQualityHeaderValue("application/json")
);

var payload = new
{
    model = "{{SONNET_ID}}",
    max_tokens = 512,
    messages = new[]
    {
        new
        {
            role = "user",
            content = "Summarize why prompt caching helps repeated requests."
        }
    }
};

var body = new StringContent(
    JsonSerializer.Serialize(payload),
    Encoding.UTF8,
    "application/json"
);

var response = await http.PostAsync(
    "https://api.anthropic.com/v1/messages",
    body
);
response.EnsureSuccessStatusCode();

var json = await response.Content.ReadAsStringAsync();
Console.WriteLine(json);
```

## 说明

- 普通文本输出时，读取第一个 `type: "text"` 的 `content` 块。
- 多次请求之间复用同一个 `HttpClient`。
- 对 `429` 和 `5xx` 响应增加重试。
- 如果需要 structured output，提示词要写得明确，并在收到结果后自行校验 JSON。
