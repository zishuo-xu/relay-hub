# ADR-021：一条公开消息原子派发给多个独立 Agent

- 状态：Accepted / Implemented
- 日期：2026-08-13

## 背景

Thread、Message 与版本化 ConversationContext 已经让用户可以在同一线程中依次调用不同 Agent，但每次发送仍只能选择一个 Agent。用户要比较架构、UX 或实现观点时，需要重复输入同一问题；平台也无法明确表达“同一公开请求被哪些 Agent 分别接收”。

RelayHub 不应因此把一个 Task 改造成包含多个 Agent 的复合状态机，也不应引入通用 Workflow DAG。Task 仍代表一个明确责任主体；多 Agent 是消息派发维度。

## 决策

### 1. Message 只保存一次，Dispatch 表达派发

新增不可变 `message_dispatches`：

```text
User Message
  ├─ MessageDispatch -> Agent A -> Task A -> Run A
  ├─ MessageDispatch -> Agent B -> Task B -> Run B
  └─ MessageDispatch -> Agent C -> Task C -> Run C
```

每条 Dispatch 只保存 `message_id / task_id / agent_id / created_at`，并约束同一 Message 不能重复派给同一 Agent、一个 Task 只能来自一个初始 Dispatch。运行状态继续由 Task/Run 唯一持有，Dispatch 不复制 `queued/running/failed` 状态，避免双写和状态漂移。

历史单 Agent User Message 按原 `task_id` 与 `recipient_agent_id`（缺失时使用 Task Builder）无损回填一条 Dispatch。旧字段暂时保留兼容读取，新多 Agent Message 不再伪造单一 `task_id` 或 `recipient_agent_id`。

### 2. 一次请求原子完成 admission 与 fan-out

`POST /api/threads/:threadId/messages` 接收 1–4 个不重复的 `agentIds`。服务端在同一 PostgreSQL 事务中：

1. 预检所有目标 Agent 同 Workspace、启用且具有 Builder 能力；可选 Reviewer 也必须有效，且不能与任一目标相同。
2. 只分配一个 Thread Message sequence `S` 并写一条 User Message。
3. 为每个目标创建独立 Task、首个 Run、Task Event、Outbox 与 MessageDispatch。
4. 使用同一个 `conversationContextBeforeSequence=S` 和策略版本。

任一目标 admission 失败则整个事务回滚，不产生“部分 Agent 收到、部分未收到”的模糊消息。请求重试由 Thread 级 Idempotency-Key 保证不重复写 Message、Dispatch、Task 或 Run。

### 3. 每个 Task 独立执行，回复按完成顺序回流

每个初始 Run 保持独立 AgentProfile snapshot、execution token、Lease、Session 和非 Mock Worktree。BullMQ Worker 并发度由 `RELAY_HUB_WORKER_CONCURRENCY` 配置，默认 4，允许 1–8；它限制单 Worker 同时执行的 Run 数量，不改变业务事实。

各 Agent 看见相同的边界前公开历史，当前 User Message 仍通过各自 `Task.description` 注入一次。它们看不到尚未完成的兄弟 Run 回复。Agent `publicMessage` 按真实完成顺序获得新的 Thread sequence 并回流，UI 不伪造固定回答顺序。

并行派发只决定初始责任。某个 Task 后续仍可按既有结构化协议 Handoff、Review 或等待用户；这些 Route 不会改变其他兄弟 Task。ConversationContext、Handoff 和 Dispatch 继续保持不同语义。

### 4. UX 使用多选目标与每目标状态卡

输入区用紧凑 Agent chips 展示当前选择，最多 4 个，可随时移除或增加。发送按钮明确显示并行目标数量。

线程中 User Message 只显示一次，并列出全部接收 Agent。其下每条 Dispatch 投影对应 Task 当前状态，可分别打开审计；单个 Run 失败只把该目标卡片标为失败并提供原因入口，不掩盖其他成功回复。页面继续保持单屏和内部滚动。

## 边界

- 本切片是用户显式多选，不解析自由文本中的 `@name`。
- 不增加汇总 Agent，不等待所有结果后自动生成综合答案。
- 不让多个 Agent 共享一个 Task、Run、Token、Session 或 Worktree。
- 不保证回复显示顺序与选择顺序一致；完成顺序才是公开事实。
- Agent 主动邀请其他 Agent 属于后续结构化 `consult`/mention 设计；正式责任转移仍只能使用 Handoff。

## 验收结果

- Contracts 拒绝空列表、重复目标和超过 4 个目标。
- 隔离 PostgreSQL 验证一条 Message 原子创建多个 Dispatch/Task/Run，边界完全一致；任一目标无效时数据库保持空白。
- 历史 migration 验证旧 User Message 正确回填 Dispatch。
- 浏览器三 Mock Agent 验收显示三条 Run 在同一秒领取并分别回流。
- 浏览器两个真实 OpenCode Agent 验收显示一条 Message、两个初始 Dispatch、两条独立公开回复；其中一个 Task 后续 Handoff 不影响另一个 Task。

## 代价

新增一张轻量关系表和有限 Worker 并发带来数据库连接、CLI 进程与本机资源压力，因此第一版把目标数限制为 4、单 Worker 并发限制为 8。未来如需更大团队，应增加 Workspace/Provider 级配额和公平调度，而不是放大单次 fan-out。
