# TypeScript Agent SDK 模式

## 收窄工具权限

先从“足以完成任务的最小工具面”开始。

```ts
const agent = new Agent({
  model: 'claude-sonnet-4-6',
  systemPrompt: 'Review code and report findings only.',
  allowedTools: ['Read', 'Glob', 'Grep'],
})
```

只有任务确实需要修改时，才启用具备写能力的工具。

## 把规划和执行分开

对于较长工作流，先跑一轮分析，再跑第二轮允许编辑或执行的流程。

```ts
const review = await reviewAgent.run('Find the highest-risk regression.')
const fix = await fixAgent.run(`Implement this change:\n\n${review.outputText}`)
```

这样可以减少误改，也更方便审计日志。

## 限定工作区范围

- 当任务限定在某个仓库范围内时，显式传入目录或文件列表。
- 优先使用简短且成功标准明确的用户提示词。
- 如果任务风险高，就强制使用 JSON、checklist 之类的结构化输出。

## 把 agent 用于编排，而不是隐藏业务逻辑

- 校验、持久化和授权逻辑要放在应用代码里。
- 在你定义好的边界内，让 agent 决定如何完成任务。
- 在把结果应用到生产系统前，再做一次复核。

## 适用场景

- 仓库审查机器人
- 迁移助手
- 事故分诊助手
- 可控的代码编辑工作流

## 不建议这样做

- 默认就给单个 agent 完全开放 shell、网络和文件权限
- 依赖隐式上下文，而不是明确附上文件和指令
- 不做校验就把 agent 文本当作可信的结构化数据
