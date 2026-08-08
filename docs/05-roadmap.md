# 05. 开发路线

## 总体策略

按可运行纵向切片推进，而不是先把所有基础设施搭完。每个阶段都必须有可见结果、自动化测试和明确退出条件。

## Phase 0：项目定义（已完成）

产物：

- 项目定位和范围。
- 参考项目分析与 clean-room 边界。
- MVP 用户故事和验收标准。
- 架构、数据模型、接口草案。
- 面试叙事初稿。

退出条件：可以在不阅读 Clowder AI 源码的情况下说明 RelayHub 要实现什么。

## Phase 0B：整体设计基线（已完成）

目标：从最终产品形态反推稳定领域边界，在创建 PostgreSQL schema 前完成一次整体评审。

当前状态：**Accepted。** 产品定位、核心实体、状态机、通信边界、ReviewPolicy、CompletionPolicy 和基础设施职责已经确认。参见 `09-overall-design-baseline.md`。

工作项：

1. 补齐系统上下文、目标用户、外部依赖和非目标。
2. 固定 Workspace、AgentProfile、Task、Run、RunEvent、Handoff、Review 的职责与所有权。
3. 完成 Task、Run、Handoff、Review 四组状态机及异常路径。
4. 定义命令、领域事件、实时事件和 Queue message 的区别。
5. 定义 Agent Session、身份注入、Handoff、文件 worktree 和回调鉴权边界。
6. 画出单 Agent、多 Agent Review、失败恢复三条端到端时序。
7. 将必须稳定的字段与允许演进的字段分开，形成 schema baseline。
8. 对整体设计做一致性检查，再进入 PostgreSQL migration。

退出条件：能够从总体蓝图解释每张核心表、每个状态和每条消息为什么存在；SQL 不引入尚未定义的业务概念。

## Phase 1：单 Agent 纵向切片

目标：从 Web 创建 Task，Mock Agent 在 Worker 中执行，前端实时看到结果。

当前状态：**Phase 1B 已完成**。Phase 1A 的 JSON + HTTP 领取链路已升级为 PostgreSQL canonical truth、Transactional Outbox 和 Redis/BullMQ 正式基础设施层。

工作项：

1. [x] 初始化独立 pnpm workspace。
2. [x] 创建 `apps/web`、`apps/api`、`apps/worker` 和 `packages/contracts`。
3. [x] 建立 PostgreSQL schema 和迁移，替换原型 JSON Store。
4. [x] 引入 Redis/BullMQ，替换 Worker HTTP 短轮询领取。
5. [x] 实现 Task / Run 最小状态机。
6. [x] 实现 Worker 领取端口和 Mock Adapter。
7. [x] 写入持久事件并通过 WebSocket 广播。
8. [x] 实现 Task 列表、创建页和 Timeline。

退出条件：无外部模型账号也能稳定演示，刷新页面后历史不丢失。

## Phase 2：真实 Agent 与生命周期

目标：接入一个真实 Agent CLI，并处理真实执行的不确定性。

当前状态：**真实 Codex/OpenCode 运行、执行结果语义、Workspace Bootstrap 和单次 Run token 已完成。** Codex CLI 与 OpenCode CLI Adapter、事件转换、隔离 Worktree、子进程超时与取消状态已经实现。`RunOutcome` 区分 Agent 协议成功、命令证据和 Task 验收；provider-neutral Bootstrap 在 Agent 启动前确定性准备项目环境；Worker 回调已绑定单次 Run 的临时执行身份。Worker lease 和崩溃 reconciliation 留到 Phase 4。

工作项：

1. [x] 实现 Codex CLI Adapter。
2. [x] 实现 JSONL 增量解析和统一事件转换。
3. [x] 实现 ProcessSupervisor、用户取消、超时和退出码归类。
4. [x] 实现 Git Workspace 校验与独立 Worktree。
5. [x] 固化 Run workspace 快照，并持久化 thread、branch 和 working directory。
6. [x] 实现显式、可观测、可失败的 Worktree bootstrap policy，并在 Run 创建时固化配置快照。
7. [x] 区分 Agent 协议完成、命令/测试失败和验收通过；成功 Run 保存 `RunOutcome`，Task 不再自动 completed。
8. [x] 加入单次 Run token，保护 Worker control/event 内部接口；claim 身份认证随 lease/heartbeat 后续补齐。
9. [x] 实现 OpenCode AgentProfile 配置、运行时目录检测和 Builder/Reviewer Adapter。
10. [ ] 实现 Worker lease、heartbeat 与重启 reconciliation。

退出条件：真实 Agent 能在隔离 Worktree 完成任务；取消、超时、异常退出和重复队列消息均有确定状态。首次真实运行已通过；lease/reconciliation 作为可靠性增强继续保留在 Phase 4。

## Phase 3：多 Agent 交接与 Review

目标：完成简历项目的核心差异化能力。

工作项：

1. [x] Handoff schema、Task Reviewer 选择与目标 AgentProfile 校验。
2. [x] Builder → Reviewer 父子 Run、持久 Handoff 与 Outbox/BullMQ 可靠派发。
3. [x] Reviewer 独立上下文、Run Token 和继承 Worktree 的只读执行边界。
4. [x] Review、Finding 与 `approved/changes_requested/blocked` 结构化裁决。
5. [x] `changes_requested` 后的修复 Run、结构化 Finding 注入和 Review 轮次预算。
6. [ ] Timeline 中展示完整协作图与审查详情。

退出条件：标准演示场景端到端通过，且交接链可以由数据库查询重建。

## Phase 4：可靠性与可观测性

目标：把“能跑”升级为“可解释地可靠”。

工作项：

1. Worker restart reconciliation。
2. WebSocket gap detection 与补拉。
3. OpenTelemetry trace，关联 taskId/runId。
4. 运行时指标：队列等待、执行时长、失败率、重试次数。
5. Testcontainers 集成测试和故障注入。
6. 演示环境与一键启动脚本。

退出条件：可以主动演示断网、重复消息和 Worker 异常后的恢复过程。

## Phase 5：轻量记忆（可选）

目标：展示任务知识沉淀，而不是构建完整记忆平台。

只实现：

1. 用户确认 Task 总结后写入 `knowledge_entries`。
2. 基于 PostgreSQL 全文搜索检索历史结论。
3. 创建 Task 时由用户主动选择注入哪些知识。
4. 保留来源 Task、版本和废弃状态。

第一版不使用向量数据库。只有全文检索无法满足已定义案例时，再补 Embedding 投影。

## 每阶段质量门槛

- 状态迁移有表驱动测试。
- 新边界输入经过 Schema 校验。
- 错误有稳定的机器可读 code。
- 文档在实现改变后同步更新。
- 演示路径不依赖无法控制的外部模型输出；Mock Adapter 始终保留。

## 推荐的下一步

进入 Phase 3 前的小型 hardening slice 已完成：

1. Web 页面与 API `store.ts` 职责拆分均已完成；仍保持模块化单体和一个稳定 Store 门面。
2. Workspace Bootstrap 与执行结果语义已完成。
3. 单次 Run token 已完成，为后续 Handoff/Review 提交建立了最小可信执行身份。

Phase 3.3 自动返工主链和 OpenCode 可配置 Adapter 已完成。`changes_requested` 会创建继承 Worktree 的 Builder repair Run，claim 时注入来源 Review/Findings，修复后再走 Handoff 并产生新的 Review round；达到可配置轮次预算则停止自动循环并转交用户。用户现在可以从 Web 新建 OpenCode Builder 或 Reviewer，并把它与 Codex/Mock Profile 组合使用。架构继续保持 provider/model-neutral。下一步是 Phase 3.4：在一屏 Timeline 中更直观地展示 Builder、Reviewer、返工和多轮 Review 的完整协作图。

Phase 2 完成后的“可真实运行”边界是：用户可以从 RelayHub 创建一个真实开发任务，由 Codex CLI 在隔离 Worktree 中读取和修改代码、执行命令，并把流式输出与最终结果回传到持久 Timeline。此时不再依赖 Mock Agent，但仍然是单 Builder 流程。

以下能力仍需要后续阶段继续完成：

- 使用用户有效 provider 凭证完成真实 OpenCode Builder/Reviewer 的外部模型验收；无凭证时仍由独立 Mock Reviewer 提供确定性全链路演示。
- Worker 崩溃后的 lease reconciliation 与完整故障演示。

因此里程碑应区分为：

```text
Phase 2：真实单 Agent 可运行
-> Phase 3：真实多 Agent 协作可运行
-> Phase 4：具备完整恢复与演示可靠性
```
