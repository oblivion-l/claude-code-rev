# Python Files API

当你需要“上传一次、多次引用”的能力，并且会跨多个 Claude API 请求复用同一文件时，使用 Files API。

## 重要限制

- Files API 目前仍是 beta。
- 请求中需要带上你当前 SDK 版本所接受的 Files API beta header/version。
- 上传后的文件之后不能再下载；只有由 skills 或代码执行生成的文件才可下载。
- Bedrock 和 Vertex AI 目前不支持 Files API。

## 上传文件

```python
from anthropic import Anthropic

client = Anthropic()

with open("document.pdf", "rb") as f:
    meta = client.beta.files.upload(
        file=("document.pdf", f, "application/pdf"),
    )

print(meta.id)
```

## 在消息里引用文件

```python
message = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    betas=["files-api-2025-04-14"],
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Summarize this PDF."},
                {
                    "type": "document",
                    "source": {"type": "file", "file_id": meta.id},
                },
            ],
        }
    ],
)
```

## 管理文件

```python
files = client.beta.files.list()
info = client.beta.files.retrieve_metadata(meta.id)
client.beta.files.delete(meta.id)
```

## 实践建议

- 同一个文档、图片或数据集需要重复复用时，优先使用 Files API。
- 上传前先校验 MIME type 和文件大小。
- 在你自己的存储中记录 `file_id`。
- 不再需要的文件要主动删除；文件持久化是显式管理的。

## 官方参考

- Files API 指南：`https://platform.claude.com/docs/en/build-with-claude/files`
- Python Files API 参考：`https://platform.claude.com/docs/en/api/python/beta/files`
