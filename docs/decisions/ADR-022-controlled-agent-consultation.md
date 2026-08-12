# ADR-022：受控 Agent 咨询与原责任 Agent 恢复

- 状态：Accepted / Implemented
- 日期：2026-08-13

## 背景

顺序型 Handoff 适合“把后续工作正式交给另一个 Agent”，但方案设计、UX、安全和测试场景还需要一种不同协作：当前 Agent 只向专家询问一个有限问题，拿到意见后继续对任务负责。

如果把咨询伪装成 Handoff，Task 责任会错误转移；如果允许 CLI 自己随意启动子 Agent，平台又无法审计独立身份、权限、问题与回答。RelayHub 需要一个比通用 DAG 更小、但可恢复和可治理的闭环。

## 决策

### 1. Consultation 与 Handoff 是不同领域事实

`NextAction=consult` 必须携带结构化 `question + contextSummary + targetAgentId`。平台持久化 `Consultation`，但 Task 的责任 Agent 不改变：

```text
负责 Agent Run
  -> Consultation（有限问题）
  -> 独立只读 consult Run
  -> 持久回答
  -> 原 Agent continuation Run
```

Handoff 改变后续责任 Agent；Consultation 只引入建议。咨询 Agent 的公开回答可以进入 Thread，但最终取舍和综合结果仍由原 Agent 给出。

### 2. Orchestrator 是唯一派发和恢复者

来源必须是 Task 当前 `running` Run，且不能是 Review 或 consult Run。平台校验目标 Agent 存在、启用、同 Workspace、不是来源 Agent，并限制每个 Task 最多 3 次咨询。

来源 Run 成功完成后，API 在同一事务中把 Consultation 置为 `dispatched`、创建 `triggerType=consult` 的目标 Run、更新 `currentRunId`、写 Outbox 和审计事件。咨询 Run 成功后，API 持久化回答并创建 `triggerType=continuation` 的原 Agent Run；Agent 不能自行伪造 continuation 或平台级身份。

### 3. 咨询 Run 具有强制只读边界

consult Run 创建独立 Run Token、Lease、Session 和 AgentProfile 快照。有效来源 worktree 存在时复用；Mock 或其他无 worktree 来源与真实 CLI 混用时，Worker 为咨询 Run 新建隔离环境。

无论目标 AgentProfile 原本是否可写，consult 的有效策略都强制为：文件只读、无外部网络、禁止 Git、禁止 CLI 内部子 Agent。Prompt 只允许回答当前问题，并要求 `nextAction=complete`；API 同时拒绝 consult Run 再次咨询，不能仅依赖 Prompt 自律。

### 4. 失败和预算确定性收敛

咨询执行失败时，Consultation 标为 `failed`，Task 转为 `waiting_for_user`，不会静默跳过建议或让原 Agent 在信息不完整时继续。第 4 次咨询请求在持久化前被拒绝，不创建 Consultation、Run 或 Outbox。

第一版只支持单层、串行咨询，不支持嵌套咨询、并行咨询、投票、任意 DAG 或自由文本 `@name` 解析。

### 5. 查询投影区分执行者与责任人

consult Run 运行期间，当前执行者是咨询 Agent，但 `TaskCoordinationView.owner` 仍投影为原责任 Agent，Route reason 为 `consultation_in_progress`。咨询结束后投影为 `continuation_in_progress`。页面显示咨询次数、问题、回答和恢复事件，不把咨询 Agent 标成新的 Task Owner。

## 验收结果

- 隔离 PostgreSQL 全量 migration 后，API 测试验证 source → consult → continuation、原 Agent 快照与 worktree 继承、嵌套咨询拒绝和三次预算。
- 正式环境完成 Mock 负责 Agent → 真实 Codex 咨询 Agent → Mock continuation；三个 Run 均 succeeded，真实回答持久化，Task 正确进入 `waiting_for_user`。
- 混合 Adapter 首次验收发现 Mock 无 worktree；Worker 修复为“完整环境才继承，否则新建隔离 worktree”，并增加回归测试。
- 浏览器线程和审计抽屉完整显示咨询消息与三段因果链；窄视口无页面级溢出，控制台无错误。

## 代价

新增一张 Consultation 表、两个 Run trigger 和一个 continuation Run，会增加一次真实咨询的执行成本。固定单层与三次预算让该成本可解释，也避免现在就引入通用工作流引擎。
