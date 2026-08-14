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
8. [x] 加入单次 Run token，保护 Worker heartbeat/control/event 内部接口；claim 身份认证仍位于本地单用户信任边界。
9. [x] 实现 OpenCode AgentProfile 配置、运行时目录检测和 Builder/Reviewer Adapter。
10. [x] 将 Agent 身份与 CLI 配置分层，并在每个 Run 固化不可变 AgentProfile 快照。
11. [x] 实现 Worker lease、heartbeat 与 fail-closed 重启 reconciliation；失联 Run 转 `lost` 并交给用户处理。

退出条件：真实 Agent 能在隔离 Worktree 完成任务；取消、超时、异常退出和重复队列消息均有确定状态。真实运行和 Lease 失联收敛均已通过；更完整的故障演示继续保留在 Phase 4。

## Phase 3：多 Agent 交接与 Review

目标：完成简历项目的核心差异化能力。

工作项：

1. [x] Handoff schema、Task Reviewer 选择与目标 AgentProfile 校验。
2. [x] Builder → Reviewer 父子 Run、持久 Handoff 与 Outbox/BullMQ 可靠派发。
3. [x] Reviewer 独立上下文、Run Token 和继承 Worktree 的只读执行边界；Codex Reviewer 可在只读代码前提下运行仅绑定回环地址的本地测试。
4. [x] Review、Finding 与 `approved/changes_requested/blocked` 结构化裁决。
5. [x] `changes_requested` 后的修复 Run、结构化 Finding 注入和 Review 轮次预算。
6. [x] 引入简化 TeamAct 的封闭 `NextAction` 合约，并让 Builder 的 `request_review/wait_for_user` 与 Handoff V2 使用统一 Route 语义。
7. [ ] 将 Review verdict、返工、用户确认和完成继续收敛到统一 Route 投影，同时保持 Orchestrator 为唯一状态迁移者。
8. [x] 从现有 Task/Run/Handoff/Review/RunOutcome 推导只读 `TaskCoordinationView`，在 Task Detail 和单屏概览统一展示 State、Owner、Evidence、Verdict、Route；Event 保持审计职责，不作为当前状态真相。
9. [x] 在不引入通用 Workflow Engine 的前提下，为方案、UX、安全等 AgentProfile 专业方向提供顺序型动态 Handoff 路径。
10. [x] 实现单层受控 Agent Consultation：独立只读咨询 Run、原 Agent continuation、每 Task 三次预算与失败转用户。

退出条件：标准演示场景端到端通过，且交接链可以由数据库查询重建。

## Phase 3.5：对话优先的多 Agent 协作空间

目标：把已经可运行的多 Agent 底座变成与参考项目愿景一致的用户体验，让用户在一个线程中自然地与 Agent 团队协作，而不是把技术 Timeline 当成产品主体。

当前状态：**Thread/Message、共享上下文与用户显式 multi-Agent 派发三个纵向切片均已实现（2026-08-13）。** Message 保存一次公开表达，MessageDispatch 原子映射到多个独立 Task/Run，RunEvent 保持技术审计。每个 Task 按 [ADR-020](decisions/ADR-020-versioned-conversation-context.md) 固定相同的版本化公开 ConversationContext 边界；真实双 Agent 已能并行处理同一请求并分别回流。自由文本 mention 解析和 Agent 主动 mention 尚未实现。

建议纵向切片：

1. [x] 定义协作线程、用户/Agent/平台消息、目标 Agent 和 Run 触发之间的唯一真相源与权限边界。
2. [x] 明确普通对话与正式 Handoff 的区别：Message 不迁移责任；结构化 Handoff 才改变 Task Route。
3. [x] 将中心区域改为多 Agent 对话流；技术 Timeline、工具调用和平台事件进入按需审计抽屉。
4. [x] 完成用户选择 `@Agent` → 独立 Task/Run → Agent 消息回到同一线程的闭环。
5. [x] 为 Task 固定版本化公开 ConversationContext，完成 Agent A 公开结论 → Agent B 读取并继续协作的闭环。
6. [x] 增加用户显式多 Agent 选择、原子 MessageDispatch、并行回流与每目标失败入口。
7. [x] 增加结构化 Agent 咨询协议；咨询不转移 Task 责任，结果返回后自动恢复原 Agent。自由文本 `@name` 解析继续不进入第一版。
8. [x] 复用现有 AgentProfile snapshot、Run Token、Queue、Handoff、Review、Lease 和 Coordination projection，没有引入通用 Workflow Engine。
9. [ ] 按 [ADR-024](decisions/ADR-024-agent-led-task-delegation.md) 增加 Agent 主导的受控 Delegation：用户只指定初始负责人，负责人提出独立子任务，平台审批/派发，子任务自治闭环后回报并恢复 Lead。

退出条件：用户可以在一个线程里连续与至少两个独立 Agent 协作；消息、Run、结构化交接和审计事实边界清楚，刷新后完整恢复，用户不需要在多个 Agent 页面之间搬运上下文。

## Phase 4：可靠性与可观测性

目标：把“能跑”升级为“可解释地可靠”。

工作项：

1. [x] Worker Lease、Heartbeat 与 restart reconciliation 第一切片：过期 Run 原子转 `lost`、撤销 Token、Task 转交用户；不自动并发重跑同一 Worktree。
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

Phase 3.3 自动返工主链、OpenCode 可配置 Adapter、Agent 长期提示词和统一执行权限已完成。`changes_requested` 会创建继承 Worktree 的 Builder repair Run，修复后再走 Handoff 并产生新的 Review round；真实 OpenCode Builder → Codex Reviewer 已通过配置快照与权限验收。

Phase 3.4 已完成：封闭 `NextAction`、版本化 Handoff V2、内容摘要校验、`handoff.consumed`、统一责任查询投影和任意已配置平台 AgentProfile 之间的顺序型 Handoff 均已接入。Mock A → B → Reviewer 与真实 OpenCode A → B 已通过浏览器、隔离数据库和真实 CLI 验收；[`WI-P3.4-001`](work-items/WI-P3.4-001-sequential-agent-handoff.md) 已关闭。暂不建设任意 Workflow DAG。

Phase 4 第一切片已完成：Worker claim 写入 Lease，执行期间定时 Heartbeat；过期 Lease 使旧 Token 立即失去 control/event 权限，Reconciler 原子将 Run 收敛为 `lost` 并把 Task 转为 `waiting_for_user`。第一版刻意不自动启动第二个 Agent 写同一 Worktree。

**产品优先级已于 2026-08-14 再次校准。** Thread/Message、版本化公开上下文、显式并行回答、受控 Consultation 和 Lead 咨询均已完成，但这些能力还没有形成参考项目式的真实分工。下一步按 ADR-024 实现 `delegate`：主 Agent 保留总目标，平台创建独立子 Thread/Task，子任务完成强制 Review 后以 `final_only` 回报并恢复 Lead。该切片完成后再补 WebSocket cursor/gap detection；指标、Tracing 和完整故障演示随后继续。

Phase 2 完成后的“可真实运行”边界是：用户可以从 RelayHub 创建一个真实开发任务，由 Codex CLI 在隔离 Worktree 中读取和修改代码、执行命令，并把流式输出与最终结果回传到持久 Timeline。此时不再依赖 Mock Agent，但仍然是单 Builder 流程。

以下能力仍需要后续阶段继续完成：WebSocket 断线补拉、指标/Tracing 和完整故障演示。

因此里程碑应区分为：

```text
Phase 2：真实单 Agent 可运行
-> Phase 3：真实多 Agent 协作可运行
-> Phase 3.5：对话优先的多 Agent 团队可使用
-> Phase 4：具备完整恢复与演示可靠性
```
