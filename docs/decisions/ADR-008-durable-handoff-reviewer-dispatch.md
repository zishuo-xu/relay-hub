# ADR-008：Handoff 先持久化，Builder 完成后再派发 Reviewer Run

- 状态：Implemented
- 日期：2026-08-07

## 背景

RelayHub 需要从单 Builder 执行升级为可恢复的多 Agent 协作。直接让 Builder 调用 Reviewer 会共享临时进程状态、绕过平台校验，并可能让 Reviewer 在代码尚未完成时读取半成品。Reviewer 也不能依赖 Builder 的隐藏推理或共享同一个 Session。

## 决策

1. Task 显式保存可选 `reviewerAgentId`；Builder 与 Reviewer 必须是同 Workspace 中不同、启用的 AgentProfile，Reviewer 必须具有 `review` capability。
2. Builder 在 running 状态通过受 Run Token 保护的 `handoff.requested` Event 提交 objective、context summary、artifact refs 和 acceptance criteria。
3. Handoff 请求事务只写 pending Handoff 和审计 Event，不创建 Reviewer Run；每个来源 Run 最多一个 Handoff。
4. Builder 的 `run.completed` 事务同时保存 Outcome、创建 `triggerType=review` 的子 Run、关联 parentRun/targetRun、把 Handoff 标记为 dispatched、把 Task 切到 reviewing，并写入 Outbox。
5. Queue job 继续只携带 `runId`。Reviewer claim 后由 PostgreSQL 读取 Task、独立 AgentProfile 和对应 Handoff，不接收 Builder Session 或隐藏 reasoning。
6. Reviewer 继承 Builder 已完成的 Worktree。真实 Codex Reviewer 使用 read-only sandbox，不创建第二个写入分支，也不运行可能修改环境的 Workspace Bootstrap。
7. Reviewer Run 不能请求另一个 Reviewer，避免递归派发。结构化 Review/Finding、CompletionPolicy 裁决和返工 Run 留给下一切片。

## 结果

- 交接事实先于唤醒持久化，API 或 Worker 重启后仍可重建完整因果链。
- Reviewer 不会审查半成品，Builder 与 Reviewer 的身份、Token、Session 和执行记录相互隔离。
- PostgreSQL 负责事实与原子状态，Outbox/BullMQ 负责可靠唤醒；没有新增服务或第二套执行系统。
- 未配置 Reviewer 的旧任务保持单 Builder 行为，成功后继续等待用户检查。
