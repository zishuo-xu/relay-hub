# ADR-017：简化 TeamAct 与动态责任流转

## 状态

Accepted（2026-08-09，第一实现切片已落地）

## 背景

RelayHub 已完成固定的 Builder → Reviewer → 用户确认/返工主链。继续为方案设计、UX、安全、测试等场景逐一增加硬编码角色和状态，会让领域模型随功能增长而腐化；相反，直接建设任意 DAG、脚本和表达式驱动的通用 Workflow Engine，又会把个人开发者控制平面扩张成高学习成本的定制化平台。

参考项目的高层 TeamAct 思想把团队协作表达为 `State → Owner → Action → Evidence → Verdict → Route`。任务路径可以动态变化，但身份、责任、证据和路由仍由平台契约约束。RelayHub 采用这一机制思想，并按自己的软件开发任务边界重新设计，不复制参考项目的代码、品牌语言、完整球权系统、Pack 生态或治理规模。

## 决策

1. RelayHub 的协作主循环采用六个稳定语义：
   - `State`：读取 Task、Run、Handoff、Review 和已授权上下文；
   - `Owner`：明确当前应由用户、某个 Agent Run 或平台等待条件负责；
   - `Action`：当前 Agent 在自己的 Run、Worktree 和权限快照内执行；
   - `Evidence`：提交代码差异、测试、命令结果、产物引用和摘要；
   - `Verdict`：由独立 Review、确定性规则或用户确认判断是否满足要求；
   - `Route`：提出继续、交接、审查、等待或完成。
2. Agent 只提交结构化 `NextAction` 意图，不能直接修改 Task 状态、创建目标 Run 或扩大权限。第一版只支持：
   - `continue`
   - `handoff`
   - `request_review`
   - `wait_for_user`
   - `complete`
3. Orchestrator 是唯一责任流转执行者。它校验来源 Run、当前责任、目标 Agent、能力、权限、循环预算和必要证据，再在事务中写入 Handoff、后续 Run、Event 与 Outbox。
4. 当前责任视图优先从既有 Task、current Run、Handoff、Review 和 append-only Event 推导。第一版不新增独立 Ball/Custody 表，也不创建与 Run 重复的生命周期实体；只有实际查询和恢复需求证明投影不足时，才考虑专门的责任投影表。
5. AgentProfile 继续定义“谁执行、在哪个 CLI/模型运行、长期偏好和最大权限”；方案设计、UX、安全、测试等是提示词、专业标签或节点用途，不成为新的平台权限身份。
6. SOP 或未来 CollaborationRecipe 只提供建议路径、风险门禁和默认路由，不能定义任意状态、运行脚本或越过平台守卫。任务不被强制经过无风险依据的固定阶段。
7. 现有 Builder → Reviewer → repair 闭环作为第一条默认路径保留，并逐步改由统一 NextAction 契约表达；历史 Task、Run、Handoff 和 Review 语义不改写。
8. `fan_out`、`wait_for_signal`、集体表决和跨任务汇总属于后续扩展。引入前必须先完成 Worker lease/reconciliation、责任去重、并发预算和可观测性。

## 结果

- RelayHub 获得动态多 Agent 演进空间，而不需要为每种专业角色修改状态机。
- Agent 保留对下一步的判断力，平台继续掌握身份、权限、状态和派发权。
- 现有七个核心实体和模块化单体架构保持稳定，不引入通用工作流引擎。
- UI 可以围绕“当前责任、现有证据、下一动作”组织，而不是要求用户理解任意流程图配置。
- 代价是 Orchestrator 需要对 NextAction 做严格、可测试的合法性校验；动态路由也必须通过循环预算和无悬空责任规则防止乒乓与虚空交接。

## 第一实现切片

1. 在合约层定义 `NextAction`，并为五种动作建立封闭 schema。
2. 让现有 Builder Handoff、Reviewer verdict 和用户确认路径映射到统一 Route 语义，不改变现有数据库事实。
3. 增加“当前责任 + 下一动作”查询投影和审计事件。
4. 在单屏任务概览中展示 State、Owner、Evidence、Verdict、Route，而不是先建设工作流编辑器。
5. 使用 Mock 和真实 OpenCode Builder → Codex Reviewer 两条链验证继续、审查、返工、等待用户和完成。

### 已实现范围（2026-08-09）

- 合约层已经定义五种封闭 `NextAction`；Builder Outcome 现在明确提出 `request_review` 或 `wait_for_user`，Handoff 只能携带目标一致的 `handoff/request_review`。
- Handoff V2 持久化 objective、context summary、artifact/evidence refs、验收标准、decisions、open questions、risks 和 NextAction；平台从 Task canonical truth 写入验收标准，不信任 Agent 改写。
- 每个 V2 交接包在写入时生成 SHA-256 内容摘要；Reviewer claim 在事务内复算摘要，目标 Worker 加载后回报 `handoff.consumed`，Handoff 从 `dispatched` 变为 `accepted`。
- Reviewer Prompt 从持久化交接包组装上下文；页面展示当前责任 Agent、Handoff 版本/状态/下一动作和接收事件。
- `TaskCoordinationView` 已作为只读查询投影加入 Task Detail：它只从 Task、current Run、Handoff、Review 和 RunOutcome 推导 State、Owner、Evidence、Verdict、Route，不读取 Event 猜测当前状态，也不写入新的生命周期事实。
- 非终态 Task 必须得到 Agent、用户或平台责任人；终态 Task 明确返回无责任人和 `terminal` Route。缺失 current Run 等异常会投影为平台责任和等待用户，而不是静默悬空。
- 尚未把 Reviewer verdict、repair、用户确认全部改造成统一 NextAction 输入；这些仍由现有确定性 Orchestrator 路径执行。
- 顺序型通用 Handoff 主干已按 WI-P3.4-001 实现（2026-08-12，待验收）：非 Review Agent 以 `<relayhub_result>` 结构化信封提出 `handoff`，Orchestrator 分流 `handoff`/`request_review`，通用交接创建 `triggerType=handoff` 目标 Run 且 Task 保持 running；固定预算 6 次，目标失效或预算耗尽时 Handoff `rejected` 并转交用户。Reviewer 裁决权限仍只认 `triggerType=review` + Task 固定 Reviewer。浏览器与真实 CLI 验收尚未执行。

## 明确不做

- 不复制参考项目的猫、球权、Pack、陪伴或跨领域产品模型。
- 不允许用户定义任意状态、脚本、条件表达式或插件代码。
- 不把自然语言中的“交给某人”直接当成状态迁移事实。
- 不在可靠性基础完成前开放无限并行、递归委派或开放式 swarm。
