# Python Agent SDK 模式

## 模式 1：一次性自动化

对于“修这个文件”“审这个 diff”“生成 release notes”这类独立任务，使用 `query()`。

```python
async for message in query(
    prompt="Inspect src/main.py and explain the bug.",
    options=ClaudeAgentOptions(cwd="."),
):
    print(message)
```

适合不需要会话历史的场景。

## 模式 2：对话式工作流

当每一轮回答都需要建立在前文上下文之上时，使用 `ClaudeSDKClient`。

```python
client = ClaudeSDKClient(options=ClaudeAgentOptions(cwd="."))
await client.connect()
await client.query("Read the auth flow.")
await client.query("Now propose a refactor with minimal risk.")
```

适合 REPL、聊天 UI 或多步骤修复循环。

## 模式 3：自定义工具

把确定性的本地逻辑暴露成工具，让 Claude 决定何时调用。

```python
from claude_agent_sdk import tool


@tool("get_build_id", "Return the current build identifier", {})
async def get_build_id(_args):
    return {"content": [{"type": "text", "text": "build-2026-03-31"}]}
```

工具要尽量收窄、强类型，并且明确副作用边界。

## 模式 4：hooks 与策略

如果你需要在 tool use 前后加入审批、日志或组织级约束，就使用 hooks。策略应放在 hooks 或权限设置里，而不是只写在 prompt 中。

## 模式 5：streaming UI

构建终端或 Web 界面，并且希望文本和工具调用边到边显示时，应启用 partial messages。把流式事件当作增量更新，最终仍以 `AssistantMessage` 或 `ResultMessage` 为准。

## 模式 6：稳健的 session 控制

- 显式设置 `cwd`。
- 明确选择 permission mode。
- 在 `finally` 中关闭 `ClaudeSDKClient`。
- 把 `CLINotFoundError`、连接错误和权限拒绝明确抛给调用方。

## 什么时候不该用 Agent SDK

- 只需要普通 `messages.create(...)` 工作流时，使用 Anthropic Python SDK。
- 如果你需要原始 API 语义、provider 可移植性，或者完全不依赖 Claude Code，就直接调用 Messages API。
