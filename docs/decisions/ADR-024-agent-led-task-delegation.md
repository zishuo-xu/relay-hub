# ADR-024：Agent 主导的任务委派与主子任务编排

- 状态：Accepted（第一实现切片已完成）
- 日期：2026-08-14

## 背景

RelayHub 已有 Thread/Message、动态 Handoff、独立 Review、受控 Consultation、并行回答和 Lead 咨询模式，但这些能力仍不能表达参考项目最重要的一类协作：用户只把目标交给一个 Agent；该 Agent 根据任务判断直接完成、交接、咨询，或拆出独立可交付子任务；子任务自治闭环后再把结果带回主任务。

现有 `coordinated` 模式要求用户预先选择 Lead 和协作者，并把协作者限制为只读 Consultation。它适合“主导者综合多个意见”，不是真正的任务分工。另一方面，把产品经理、系统工程师、开发者和测试写成固定平台阶段，会违背参考项目的风险路由原则，也会把 RelayHub 扩张成通用 Workflow Engine。

## 决策

### 1. 用户只指定初始负责人

Thread 的默认入口仍是用户向一个 AgentProfile 发送自然语言任务。该 Agent 成为根 Task 的当前 Owner；只有当它实际拆出子任务时，才在产品语义上成为 Lead。RelayHub 不新增固定 `Leader` 身份，也不要求用户在发消息前选择完整团队。

现有“分别回答”保留为显式征求多份独立意见的辅助入口；现有 Lead Consultation 保留为有限问题咨询能力，但两者都不再代表主协作路径。

### 2. TeamAct 继续作为每个任务的统一循环

根 Task 和每个子 Task 都复用：

```text
State -> Owner -> Action -> Evidence -> Verdict -> Route
```

Agent 只提出结构化 Route，Orchestrator 是唯一状态迁移者。Route 扩展为三种容易混淆但必须分离的协作动作：

- `consult`：向另一个平台 Agent 询问有限问题；不转移责任，回答后恢复原 Agent。
- `handoff`：把当前 Task 的剩余责任整体移交给另一个 Agent。
- `delegate`：原 Agent 保留父 Task 总目标，创建一个独立子 Task 交给另一个 Agent，等待约定的结果回报。

`continue`、`request_review`、`wait_for_user` 和 `complete` 语义保持不变。

### 3. 委派对象是独立可交付单元

`delegate` 不能只携带一句“你处理一下”，必须形成版本化委派包：

- objective 与 why；
- scope；
- deliverables；
- acceptance criteria；
- required specialties；
- 可选 preferred Agent；
- reporting mode；
- artifact/evidence refs、decisions、risks 和 open questions。

平台新增 `Delegation` 事实，连接 `parentTask/sourceRun/targetAgent/childThread/childTask`，并持久化委派包摘要、审批、执行和回报状态。`Task` 增加可空 `parentTaskId`；一个独立可交付单元仍对应一个 Task、一个当前 Owner 和独立 Run 链，不把多个 Agent 塞进同一个 Task 状态机。

第一版限制每个父 Task 最多 4 个子任务、委派深度 1。顺序接力继续使用 Handoff；第一版 `delegate` 只同时释放彼此独立的子任务，不实现任意 DAG、表达式条件或无限递归。

### 4. 主 Thread 是指挥面，子 Thread 是执行面

每个正式子任务创建独立 Thread/Task/Run。子 Thread 具有父 Task/Thread 来源、不可变任务包和自己的公开消息上下文；代码写入 Run 使用独立 Worktree，Reviewer 继续在受控只读边界中验证。

默认 `reportingMode=final_only`：子任务自治完成实现、自检、Review 和合法完成策略后，只向父 Task 回报一次结构化最终结果。后续可按真实需要增加：

- `autonomous`：不要求例行回报，但阻塞、高风险和用户决策仍升级；
- `state_transitions`：阶段边界回报，不等待确认；
- `blocking_ack`：仅遇阻塞时等待父任务或用户确认。

reporting mode 是委派创建时的契约，不能由执行 Agent 在运行中静默改变。第一实现切片只开放 `final_only`，把其他模式保留在合约演进位，避免一次引入过多状态。

### 5. Agent 通过能力画像选择协作者，平台执行硬过滤

AgentProfile 的信息分成四层：

- `capabilities`：可强制校验的动作能力，例如 implement、review；
- `specialties`：产品、架构、前端、后端、UX、测试、安全等用户可配置专业标签；
- `instructions`：长期身份、工作方式和偏好；
- `policy`：文件、网络、Git、CLI 内部子 Agent 等最大权限。

当前 Owner 的 Prompt 只注入同 Workspace、启用且可路由的精简 Agent roster。Agent 可以给出 required specialties 和 preferred target；平台按 Workspace、启用状态、能力、权限、独立性、并发预算和可用性过滤后才创建目标 Run。没有合格目标时转 `wait_for_user`，不能让 Agent 自报身份或扩大权限。

CLI 内部子 Agent 继续只是父 Run 的内部实现细节，不形成 AgentProfile、Task、Run、Handoff、Delegation 或 Review authority。

### 6. 独立 Review 是平台门禁，不依赖作者自觉

Agent 可以决定是否咨询专家，但不能自行跳过适用的 ReviewPolicy。默认规则：产生代码写入的 Task 在完成前必须得到非作者 Agent 的独立 Review；纯分析、产品规格或设计产物按 Workspace 风险策略决定是否需要独立验证。

Reviewer 由平台从合格候选中选择或校验用户/Lead 的建议，至少保证：

- Reviewer AgentProfile 不等于作者；
- Review Run 具有独立身份和强制只读权限；
- 可配置要求不同模型、CLI 或 provider；
- 无合格 Reviewer 时阻塞，不降级为作者自审；
- `changes_requested` 进入既有 repair loop，修复后重新 Review；
- 只有 ReviewPolicy、Evidence 和 CompletionPolicy 同时满足，Task 才能完成。

因此即使作者输出 `complete`，Orchestrator 也可以确定性改路由为 `request_review`，Agent 文本不能绕过门禁。

### 7. 父任务等待并由平台恢复 Lead

批准委派后，父 Task 进入可投影的 `waiting_on_children` Route；父 Agent 不轮询子任务。子 Task 在终态事务中写入结构化 `TaskReport`，包含 status、summary、deliverables、evidence、open issues 和 next recommendation，并回投父 Thread。

当全部必需子任务回报，或任一子任务产生 blocker/failure 时，Orchestrator 创建原 Lead 的 continuation Run。Lead 负责综合结果、解决分歧、继续委派、Handoff、请求 Review 或向用户给出最终结果。平台负责可靠唤醒和事实聚合，不替模型生成业务结论。

### 8. 委派审批可配置，但第一版保守

Workspace 增加委派审批策略：

- `always_confirm`：所有新子任务先生成可编辑计划卡，用户批准后创建；第一版默认。
- `risk_based`：普通可逆任务自动批准，高权限、外部副作用或不可逆任务要求用户确认。
- `auto_safe`：满足平台安全策略的委派自动创建；硬权限和不可逆门禁仍不可关闭。

CompletionPolicy 继续独立控制 Review 通过后自动完成还是等待用户最终确认。委派审批和最终完成审批不能合并成一个开关。

## UX

1. Composer 默认只选择一个 Agent；用户以自然语言交给它任务。
2. Agent 提出委派时，Thread 内显示“工作计划”卡：子任务、负责人、范围、交付物、验收条件和是否并行。
3. 用户可以批准、修改目标 Agent 或拒绝；自动策略下显示平台已批准的审计依据。
4. 主 Thread 只展示当前 Owner、子任务摘要和最终回报；详细执行、工具事件和技术 Timeline 继续进入按需审计抽屉。
5. 子任务可打开为独立 Thread；长列表内部滚动，保持单屏工作台。
6. “分别回答”移到辅助动作，不再与“协作完成”并列成为默认入口；协作由被 @ 的 Owner 在任务中自然发起。

## 第一实现切片

1. 为 AgentProfile 增加 `specialties`，并向 Agent 注入受平台过滤的精简 roster。
2. 增加 `NextAction=delegate`、`Delegation`、`parentTaskId` 和版本化委派包。
3. 实现 `always_confirm` 计划卡：批准后原子创建 child Thread/Task/Run/Outbox，拒绝不产生执行事实。
4. 第一版只支持最多 4 个独立子任务、深度 1 和 `final_only`。
5. 子 Task 完成后写 `TaskReport`，全部回报或失败时自动创建 Lead continuation Run。
6. 把代码任务的独立 ReviewPolicy 变成完成硬门禁；无 Reviewer 时转用户，不允许作者跳过。
7. 用 Mock 验证 Lead -> 两个并行子任务 -> 独立 Review -> final report -> Lead 汇总，再用真实 OpenCode/Codex/Claude Code 中至少两个不同 Agent 验证一次完整路径。

## 实施结果

2026-08-14 已完成第一实现切片：

- AgentProfile 已支持可配置 `specialties`，Worker 只向当前 Owner 注入同 Workspace 的可路由精简 roster。
- `NextAction=delegate`、`DelegationPlan`、`Delegation`、`parentTaskId`、`TaskReport` 和 `waiting_on_children` 已成为持久合约与数据库事实。
- 用户批准计划后，API 在一个事务中创建独立 child Thread/Task/Run 和 Outbox；拒绝计划不会创建子执行事实。
- 第一版严格限制深度 1、最多 4 个独立工作包和 `final_only`；子 Agent 不能递归创建平台级委派。
- 实现类子 Task 即使作者声明 `complete`，Worker 仍确定性改路由为独立 Review；Reviewer 不能等于作者。
- 全部子 Task 到达终态并写入 TaskReport 后，平台只创建一次原 Lead continuation Run，并将最终报告注入 Lead 上下文。
- Web 默认只选择一个负责人，Thread 内展示待批准或已回报的分工计划卡，子 Thread 作为可打开的独立执行面。

Mock 端到端路径已经验证 `Lead -> 用户批准 -> 分析与实现子任务 -> 独立 Review -> final report -> Lead 恢复`。真实跨 CLI/跨模型委派作为下一轮兼容性验收，不扩大本 ADR 的领域边界。

## 明确不做

- 不硬编码产品经理、系统工程师、开发者、测试等固定平台阶段；它们是可配置 Agent 专业方向。
- 不让平台用关键词猜完整工作流；模型做分解和选择，平台做验证和执行。
- 不建设通用 Workflow DSL、任意 DAG、无限递归委派或开放式 swarm。
- 不把并行回答、Consultation、Handoff 和 Delegation 合并成一个模糊的“多 Agent”动作。
- 不复制参考项目的品牌、代码、完整球权账本或大规模治理体系。

## 与现有决策的关系

- 延续 ADR-017 的 TeamAct、Orchestrator 唯一迁移者和非通用 Workflow Engine 边界。
- 延续 ADR-018/019 的 Thread、Message、Task、Run 分层。
- ADR-021 的并行回答保留为辅助能力。
- ADR-022 的 Consultation 保留为“不转移责任的有限问题”。
- ADR-023 的 Lead 咨询模式保留兼容，但不再作为目标协作主干；本 ADR 提出的 Delegation 才表达真实分工。
