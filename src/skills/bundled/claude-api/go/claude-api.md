# Go Claude API

在 Go 中，直接用 `net/http` 调 Messages API 就足够起步。

## 最小示例

```go
package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	body := []byte(`{
	  "model": "{{SONNET_ID}}",
	  "max_tokens": 512,
	  "messages": [
	    {"role": "user", "content": "Draft a concise deployment checklist."}
	  ]
	}`)

	req, err := http.NewRequest(
		http.MethodPost,
		"https://api.anthropic.com/v1/messages",
		bytes.NewReader(body),
	)
	if err != nil {
		panic(err)
	}

	req.Header.Set("x-api-key", os.Getenv("ANTHROPIC_API_KEY"))
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()

	out, err := io.ReadAll(res.Body)
	if err != nil {
		panic(err)
	}

	fmt.Println(string(out))
}
```

## 说明

- 生产环境里不要依赖 `DefaultClient`，而是创建带超时配置、可复用的 `http.Client`。
- 当返回结构稳定后，把 JSON 响应解析进结构体。
- 对 `429`、`500`、`529` 和瞬时网络错误要配合 backoff 重试。
- 把请求构造逻辑单独封装，便于后续复用到 tool use、prompt caching 或 files 流程。
