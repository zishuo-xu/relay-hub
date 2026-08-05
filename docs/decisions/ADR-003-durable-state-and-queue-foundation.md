# ADR-003：PostgreSQL 与 Redis/BullMQ 同属正式基础设施

- 状态：Accepted
- 日期：2026-08-06

## 背景

Phase 1A 使用 JSON 文件和 Worker HTTP 短轮询验证了最小链路。早期路线把 PostgreSQL 放在真实 Agent 前、把 Redis/BullMQ 放在更后阶段，容易让人误以为 Queue 只是性能优化或可选组件。

多 Agent 系统同时需要两类不同真相：业务事实和待执行工作。一个组件不能可靠地同时承担两者。

## 决策

1. PostgreSQL 是 Task、Run、Handoff、Review 和 Event 的 canonical truth。
2. Redis/BullMQ 是正式执行投递层，负责延迟、重试、并发和 Worker 消费。
3. 两者都在第一个真实 Agent Adapter 前落地。
4. Transactional Outbox 连接数据库提交和 Queue 投递。
5. Queue job 完成、失败或消失不能直接决定业务状态；Worker 必须向 PostgreSQL 状态机提交结果。
6. Phase 1A 的 JSON Store 和 HTTP 短轮询是可删除原型，不进入正式运行架构。

## 为什么仍然区分两者

“一直存在”不等于“职责相同”：

- PostgreSQL 回答“现在和过去发生了什么”。
- BullMQ 回答“下一步应该让哪个 Worker 执行什么”。

职责分离可以容忍 Queue 的重复投递，同时通过 PostgreSQL 的原子状态迁移避免同一 Run 被重复执行。

## 结果

Phase 1B 从单独数据库迁移调整为基础设施层：PostgreSQL schema、Repository、Outbox、Redis/BullMQ 和 Worker 消费边界一起设计与验证。

## 实施记录

- 状态：Implemented（2026-08-06）。
- PostgreSQL 与 Redis 使用 RelayHub 独立端口 `55432`、`56379` 和独立持久卷。
- Queue job 只携带 `runId`；Worker 必须调用 PostgreSQL 原子 claim，队列状态不推进业务状态。
- 旧 JSON 数据通过幂等命令导入，原文件不修改、不删除。
