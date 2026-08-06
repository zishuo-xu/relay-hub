# ADR-009：Review 先持久化，Verdict 再驱动 Task 完成

状态：Accepted / Implemented（2026-08-07）

## 背景

Reviewer 的自然语言输出不能直接成为 Task 状态迁移依据。平台需要证明结论来自被授权的独立 Reviewer Run，并保存可查询的裁决、问题和轮次；同时，用户要求 Reviewer approved 后的行为可以配置为自动完成或最终人工确认。

## 决策

1. Reviewer 必须在 `run.completed` 前提交结构化 `review.submitted`；Review 与 Findings 是不可变记录。
2. 只有 `trigger_type=review`、AgentProfile 与 Task `reviewer_agent_id` 一致且 Task 正处于 reviewing 的 Run 可以提交。
3. 每个 Reviewer Run 只能提交一个 Review；同一 Task 的 Review round 唯一。新一轮审查创建新记录，不覆盖历史。
4. verdict 与 Finding 严重度必须一致：approved 不允许 actionable Finding，changes_requested 要求 blocking/should_fix，blocked 要求 blocking。
5. Reviewer `run.completed` 事务读取已持久化 Review 后，才由 Orchestrator 应用 CompletionPolicy。
6. `auto_on_approval` 直接完成；`require_user_confirmation` 等待用户确认；`risk_based` 当前只在 Builder 有非空且全部成功的命令证据时自动完成。
7. blocked 进入 waiting_for_user；changes_requested 进入显式状态。后续 ADR-010 已实现有界的 Builder 修复 Run。
8. Reviewer 协议错误或执行失败不会让 Task 永久停留在 reviewing，而是转入 waiting_for_user 并保留失败事件。

## 结果

- Builder 或普通 Run 无法伪造 Review，Reviewer 也不能只凭一段自由文本完成 Task。
- PostgreSQL 可以完整重建 Handoff、Review、Finding、CompletionPolicy 与用户确认的因果链。
- 完成策略与模型解耦，风险路由使用确定性证据而不是让模型自行决定是否需要审批。
- Phase 3.3 的返工规则由 ADR-010 补充；本 ADR 的 Review 先持久化原则保持不变。
