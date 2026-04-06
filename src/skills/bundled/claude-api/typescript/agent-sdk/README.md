# TypeScript Agent SDK

如果你希望在 Node 或 Bun 中获得 Claude Code 风格的 agent，而不只是做原始模型调用，就使用 Claude Agent SDK。安装依赖、创建 agent，然后通过 harness 执行任务。

## 安装

```bash
npm install @anthropic-ai/claude-agent-sdk
```

除非你的运行环境已经另外提供了 Claude Code 风格的认证，否则请设置 `ANTHROPIC_API_KEY`。

## 最小流程

```ts
import { Agent } from '@anthropic-ai/claude-agent-sdk'

const agent = new Agent({
  model: 'claude-sonnet-4-6',
  systemPrompt: 'You are a precise engineering assistant.',
})

const result = await agent.run('Summarize the repository layout.')
console.log(result.outputText)
```

## 什么时候适合用 Agent SDK

- 多步骤任务、tool use、文件修改、shell 执行或 MCP 访问，适合用 Agent SDK。
- 如果你只需要直接调用 Messages API，则改用 `@anthropic-ai/sdk`。

## 实践建议

- system prompt 尽量短，并且角色边界清晰。
- 启用的工具只保留完成任务所需的最小集合。
- 优先给出明确任务边界，例如“只分析”或“只修改这些文件”。
- 尽量在应用层接收结构化输出，而不是事后再从长篇文本里解析。

## 运行说明

- 如果你希望行为一致，相关任务之间可以复用同一个 agent 实例。
- 当权限、工具集合或任务角色发生明显变化时，应创建新的 agent。
- 把工具访问当作安全模型的一部分，不要默认暴露 shell 或文件工具。

## 参考资料

- Anthropic 文档：Claude Code SDK 概览与 API 参考
- GitHub：`anthropics/claude-agent-sdk-typescript`
