# ADR-019：分离 Thread、Message、Task 与 Run

- 状态：Accepted
- 日期：2026-08-13

## 背景

ADR-018 确认对话线程是 RelayHub 的主要用户入口。既有系统已经把 Task、Run、Handoff、Review 和 RunEvent 建模为可靠执行事实，但 Task 拥有终态和固定验收语义，不能同时承担可持续对话上下文。

## 决策

1. `Thread` 是持续协作空间，属于 Workspace，可以包含零到多个 Task。
2. `Message` 是用户、Agent 或平台公开表达的协作内容，属于 Thread；它可以引用 Task/Run，但不拥有执行状态。
3. `Task` 是一次有目标、责任、状态和完成策略的正式工作；用户向某个 Agent 派发消息时创建一个 Task。
4. `Run` 仍是某个 AgentProfile 的一次独立执行，继续拥有不可变 Profile 快照、Token、Lease、Session 和过程结果。
5. `RunEvent` 是 append-only 技术审计，不直接充当聊天消息。Agent 的公开回复由结构化 Outcome 生成 Message。
6. 第一切片使用显式 Agent 选择表达 `@Agent`；文本 mention 解析不能绕过权限、幂等、Workspace 或执行身份校验。

## 原子性与身份

用户消息与其首个 Task/Run/Event/Outbox 在一个 PostgreSQL 事务提交。Agent 回复保存 `senderAgentId` 和创建 Run 时的名称快照，后续修改 AgentProfile 不会重写历史发言。重复派发由既有 IdempotencyKey 拦截。

## 结果

- Thread 可以在多个 Agent 和多次 Task 之间持续存在，不受单个 Task 终态限制。
- Message、业务状态和技术事件各有唯一职责，前端不需要从日志文本反推对话。
- 旧 Task 的 `thread_id` 保持可空，迁移不要求伪造历史线程。
- 后续可以在同一边界上增加 Agent mention、multi-mention、并行回流和共享记忆，而不修改现有 Run 状态机。

## 被拒绝的方案

- **直接把 Task 重命名成 Thread**：Task 终态、Reviewer 和 CompletionPolicy 会污染持续对话语义。
- **把 RunEvent 直接渲染成消息**：技术日志与协作表达混在一起，并形成重复真相源。
- **只改前端、不新增持久 Message**：刷新后无法可靠恢复用户和 Agent 的对话身份与顺序。
