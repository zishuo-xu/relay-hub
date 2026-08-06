# ADR-005：首个真实 Adapter 使用 Codex CLI 与隔离 Worktree

- 状态：Implemented
- 日期：2026-08-06

## 背景

RelayHub 需要验证平台能够管理真实 Agent，而不只运行 Mock 流程。真实执行必须满足身份独立、文件隔离、机器可读事件、可取消和可审计，同时不能让 Queue 或模型自由文本直接改变业务状态。

## 决策

1. 第一个真实 Builder Adapter 使用 Codex CLI，但 AgentAdapter 接口和 AgentProfile 保持 provider/model-neutral。
2. 使用官方非交互入口 `codex exec --json`，只解析 stdout JSONL；stderr 作为受限诊断信息。
3. 使用 `workspace-write` sandbox、`approval_policy=never` 和参数数组启动，不使用危险的 sandbox bypass。
4. 每个写入 Run 创建独立 `relayhub/run-<runId>` 分支与 Git Worktree。
5. Run 创建时固化 workspace root；执行时持久化 worktree、working directory、branch 和 Codex thread ID。
6. reasoning 事件不进入 RelayHub；平台只保存公开消息、工具摘要、文件变化与终态。
7. Worktree 默认保留，不在任务结束时自动删除；用户检查结果后再决定如何集成或清理。
8. 用户取消先把 PostgreSQL Run 改为 `cancelling`，Worker 观察后只终止自己启动的 Codex 子进程，再提交 `run.cancelled`。

## 结果

- Mock 与 Codex Builder 可以通过 AgentProfile 在同一任务入口选择。
- Codex session 不与其他 Agent 共享，thread ID 只属于对应 Run。
- 原始 Workspace 不被直接写入，所有修改留在可检查的独立分支。
- Worker control/event API 已由 Phase 2.7 单次 Run token 保护；claim 的 Worker 身份认证与 lease 仍属于后续可靠性增强。
