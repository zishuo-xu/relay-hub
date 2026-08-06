# ADR-010：Review 驱动的有界返工循环

状态：Accepted / Implemented（2026-08-07）

## 背景

结构化 Review 已能给出 `changes_requested` 和 Findings，但如果平台只停在该状态，用户仍需手工复制问题、重新启动 Builder 并再次安排 Reviewer。自动返工又不能成为无界的模型循环，也不能覆盖原 Run、Review 或代码执行证据。

## 决策

1. Task 保存稳定的 `builder_agent_id` 和 `max_review_rounds`；默认最多 3 轮 Review，创建 API 允许 1–10。
2. Reviewer Run 完成且 verdict 为 `changes_requested` 时，Orchestrator 在同一个 PostgreSQL 事务中保存状态迁移、创建 Builder repair Run、写 Outbox 和审计事件。
3. repair Run 使用 `trigger_type=retry`；`parent_run_id` 指向来源 Reviewer Run，`retry_of_run_id` 指向上一轮 Builder Run。旧 Run 和 Review 永不改写。
4. repair Run 继承已准备的 Worktree、working directory 和 branch，跳过新 Worktree 与 Bootstrap；Agent 仍获得独立 Run Token。
5. Worker claim 根据 repair Run 的父 Reviewer Run读取来源 Review 和 Findings，并把结构化事实注入 Builder Prompt，不传递 Reviewer 的隐藏推理或 Session。
6. repair Builder 完成后必须提交新的 Handoff，平台才创建下一轮独立 Reviewer Run；每轮 Review 保存新记录。
7. Review round 达到预算且仍为 `changes_requested` 时，不再创建 repair Run；Task 进入 `waiting_for_user` 并记录 `task.repair_limit_reached`。
8. 复用既有 Task、Run、Handoff、Review 和 Outbox，不引入通用工作流 DSL、额外队列或新部署单元。

## 结果

- 自动化减少了用户在 Agent 之间搬运 Findings 的工作，同时保留每一轮的独立身份和可审计证据。
- `parent_run_id` 表达“谁触发了我”，`retry_of_run_id` 表达“我在修复哪次实现”，协作链可以仅从数据库重建。
- 有界轮次防止 Reviewer 与 Builder 无限循环；超限后明确把责任交还用户。
- repair Run 复用 Worktree 可以直接修复原变更，但同一 Task 的这条主链因此按顺序执行；未来并行工作需要额外的文件所有权或合并策略。
