# ADR-012：Agent 身份、CLI Runtime 与 Run 配置快照

状态：Accepted / Implemented（2026-08-08）

## 背景

首个自定义配置页面以“配置 OpenCode”为中心，容易把 Agent 身份和 CLI 产品混成一个概念。同时 Run 只保存 `agent_id`，Worker claim 时读取 AgentProfile 当前值；如果用户在排队期间修改 CLI 或模型，同一个 Run 的实际执行配置会漂移，历史也无法准确解释。

## 决策

1. AgentProfile 是用户命名的协作者身份；`adapterType` 选择 Mock、Codex CLI、OpenCode CLI 等运行载体，CLI 不是 Agent。
2. `implement` 与 `review` 是 Agent 能力，可以组合；独立 Review 仍要求 Builder 与 Reviewer 使用不同 AgentProfile。
3. 通用配置先保存名称、能力、CLI 和 enabled；CLI 专属字段由对应 Adapter schema 条件校验和展示。当前只有 OpenCode 接受 model、variant、内部 Agent 与 credential env 引用。
4. AgentProfile 是面向未来 Run 的可变配置。每个 Run 创建时在同一事务写入完整、非敏感 `agent_profile_snapshot`；不把 API Key 写入 Profile 或快照。
5. Worker claim 只使用 Run 快照，不查询 AgentProfile 当前值。AgentProfile 的修改和停用不能改变已经创建的 Run。
6. Reviewer、repair Builder 和下一轮 Reviewer 是新 Run，在各自创建时读取目标 Profile 当前值并立刻固化自己的快照。
7. 公有 Task detail 只返回快照中的身份、Adapter、模型标签和能力摘要，Timeline 用它展示历史执行身份；完整运行配置仅供 Worker claim，Agent 管理列表仍展示 Profile 当前值。
8. migration 对历史 Run 先新增可空列，通过 `agent_id` 外键关联 Profile 回填；存在任何空快照即中止，全部成功后才设置 NOT NULL。

## 结果

- 用户可以创建“后端开发”“代码审查员”等业务身份，再决定它运行在哪个 CLI；未来增加 Claude Code 只需新 Adapter 和专属配置，不重做 Agent 领域模型。
- 修改 Profile 只影响以后创建的 Run，排队与历史执行具备稳定、可审计的运行配置。
- 快照增加少量 JSONB 存储，但避免 Profile version 表和复杂时态查询，符合本地优先 MVP 的简洁性基线。
- Agent 名称与 OpenCode 内部 Agent preset 在 UI、API 和文档中保持明确区分。
