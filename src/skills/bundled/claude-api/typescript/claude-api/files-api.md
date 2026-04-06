# TypeScript Files API

如果同一个文件需要在多个请求里重复引用，而不是每次都重新上传字节内容，就使用 Files API。

## 典型流程

1. 上传一次文件。
2. 保存返回的 file ID。
3. 在后续请求中引用这个 file ID。

## 上传示例

```ts
const file = await client.files.create({
  file: new File(['hello'], 'example.txt', { type: 'text/plain' }),
  purpose: 'user_data',
})
```

## 使用建议

- 在你自己的数据库中持久化 file ID；它是复用文件的稳定句柄。
- Files API 适合重复访问，不适合一次性的小 payload。
- 在应用代码里先校验文件类型和大小，再上传。
- 把上传文件当作用户数据处理，并遵循你现有的数据保留规则。

## 适用场景

- 多轮文档工作流
- 重复评测输入
- 复用同一份源材料的分析流水线

## 不建议这样做

- 同一份内容会复用时，却在每次请求里都重新上传文件
- 假设本地路径对 API 有意义

## 参考资料

- Anthropic 文档：Files API
