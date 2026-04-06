# Verify CLI 示例

当改动影响命令、flag、formatter 或本地工作流时，使用这个模式。

## 示例

改动：更新 `claude doctor` 输出，或修改 bootstrap 行为。

验证方式：

1. 运行能命中改动代码路径的最小命令。
2. 如果改动涉及解析或帮助文案，就再带一个相近 flag 复跑一次。
3. 同时检查输出内容和退出行为。

```bash
bun run version
bun run dev --help
```

## 要关注什么

- 命令成功退出。
- 输出里包含预期的文本、选项或命令。
- 恢复后的入口能够进入真实 CLI 路径，而不是落到 stub。

## 好的结果摘要示例

- `Verified: bun run version 输出了恢复后的 Claude Code 版本号。`
- `Verified: bun run dev --help 显示了完整的 CLI 命令树。`
- `Risk: 非 TTY shell 下没有覆盖交互式 raw-mode 流程。`
