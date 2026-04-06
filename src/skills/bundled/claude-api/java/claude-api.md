# Java Claude API

在 Java 中，直接用一个简单的 `HttpClient` 集成就可以起步。

## 最小示例

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("ANTHROPIC_API_KEY");
    String json = """
      {
        "model": "{{SONNET_ID}}",
        "max_tokens": 512,
        "messages": [
          {"role": "user", "content": "List three production-readiness checks."}
        ]
      }
      """;

    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://api.anthropic.com/v1/messages"))
        .header("x-api-key", apiKey)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(json))
        .build();

    HttpClient client = HttpClient.newHttpClient();
    HttpResponse<String> response =
        client.send(request, HttpResponse.BodyHandlers.ofString());

    System.out.println(response.body());
  }
}
```

## 说明

- 当你明确需要哪些字段后，用 Jackson 或你偏好的 JSON 库解析响应。
- 优先复用共享的 `HttpClient`，并显式设置超时。
- 服务端应用里要记录 request ID 和状态码，便于快速排查限流和非法请求。
