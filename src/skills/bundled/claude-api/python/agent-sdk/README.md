# Python Agent SDK

如果你希望在 Python 里复用 Claude Code 的 agent loop、tools、hooks 和 session 管理，而不是直接调用 Messages API，就使用 Python Agent SDK。

## 安装

```bash
pip install claude-agent-sdk
```

这个 SDK 会和本地 Claude Code CLI 通信，因此运行 Python 代码的机器也需要安装并完成 Claude Code 认证。

## 如何选择入口

- `query(...)`：适合一次性任务。每次调用都会启动一个新 session。
- `ClaudeSDKClient(...)`：适合多轮或长生命周期会话。会复用 session 状态，并支持中断。

## 最小 `query()` 示例

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions


async def main() -> None:
    async for message in query(
        prompt="Review the repository and suggest the safest fix.",
        options=ClaudeAgentOptions(
            cwd=".",
            permission_mode="default",
        ),
    ):
        print(message)


asyncio.run(main())
```

## 最小 client 示例

```python
import asyncio
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions


async def main() -> None:
    client = ClaudeSDKClient(
        options=ClaudeAgentOptions(cwd=".")
    )
    await client.connect()
    try:
        await client.query("Summarize the current branch status.")
        await client.query("Now suggest the next test to run.")
    finally:
        await client.close()


asyncio.run(main())
```

## 实践说明

- 脚本、定时任务和单次任务执行，优先用 `query()`。
- 后续提示词依赖前面工具结果时，优先用 `ClaudeSDKClient`。
- 通过 `ClaudeAgentOptions` 传入 `cwd`、权限设置、allowed tools、hooks 和自定义工具。
- 如果需要增量输出，启用 partial message streaming，并处理 `StreamEvent` 消息。
- 如果只需要原始模型调用而不需要 Claude Code 工具，改用 Anthropic Python SDK。

## 官方参考

- Agent SDK 快速开始：`https://platform.claude.com/docs/en/agent-sdk/quickstart`
- Agent SDK Python 参考：`https://platform.claude.com/docs/en/agent-sdk/python`
