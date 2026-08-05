# 07. 实现状态

## 2026-08-06：Phase 2 真实 Codex Builder

### 已实现

- `Codex Builder` AgentProfile，与 Mock Builder 使用相同 Task/Run contract。
- Workspace 路径读取、Git 仓库校验和 UI 配置。
- Run 创建时固化 `workspaceRoot`，避免排队后配置变化改变执行目标。
- 每个 Codex Run 创建独立 `relayhub/run-<runId>` 分支和 Worktree。
- 使用 `codex exec --json --sandbox workspace-write` 非交互执行，并继承本机 Codex 登录。
- ProcessSupervisor 使用参数数组启动、环境变量白名单、15 分钟默认超时和子进程定向回收。
- Codex JSONL 映射为 `run.started`、output、tool、file change 和 terminal AgentEvent。
- Codex thread ID、branch、worktree 和 working directory 持久化到 Run。
- reasoning 事件明确丢弃，不保存也不传给其他 Agent。
- 用户取消命令：PostgreSQL `cancelling` → Worker 中止对应 Codex 子进程 → `cancelled`。
- Worktree 任务完成后保留，用户可以检查 diff 和重新执行测试。

### 真实运行证据

在独立临时 Git 仓库中创建了一个失败的 Node.js greeting 测试，通过 RelayHub 选择 Codex Builder：

```text
Task queued
-> BullMQ delivery
-> Run claimed
-> Worktree + branch prepared
-> Codex thread started
-> Codex 修改 greet.js
-> Codex 执行 npm test
-> 1/1 test passed
-> Run succeeded + Task completed
```

验证结果：

- Task=`completed`，Run=`succeeded`。
- 生成 15 个有序持久事件。
- 只修改 Worktree 中的 `greet.js`，未修改测试文件。
- 原始 Git Workspace 保持 clean，原实现没有变化。
- 数据库保存 Codex thread ID `019fd2fa-fef5-7ba2-baf7-9ff920f4a076`。
- 数据库中没有包含 reasoning 的事件 payload。
- Worktree 中重新执行 `npm test`：1/1 通过。

### 自动化验证

- 12/12 测试通过：状态机 6、Queue 1、Codex Adapter 2、Worktree 1、PostgreSQL Repository 2。
- Codex Adapter fixture 覆盖 JSONL 映射、reasoning 丢弃和 AbortSignal → cancelled。
- Worktree 测试使用真实 Git 命令验证独立分支与源仓库边界。
- PostgreSQL 测试覆盖 active Run 的 `cancelling -> cancelled` 收敛。

### 仍未实现

- Builder → Reviewer Handoff、Review/Finding 和返工闭环。
- 单次 Run token、Worker lease、heartbeat 和崩溃 reconciliation。
- 用户批准后合并/提交 Worktree 的产品流程。
- Worktree 依赖安装/bootstrap 策略；当前由目标仓库与 Codex 任务自行处理。

## 2026-08-06：Phase 1B 正式基础设施层

### 已实现

- PostgreSQL + Drizzle schema 与两条可重复执行的 migration。
- Workspace、AgentProfile、Task、Run、RunEvent、IdempotencyKey、Outbox、Handoff、Review 与 Finding 共 10 张核心表。
- Task/Run 状态扩展到整体设计基线，并加入 `CompletionPolicy`。
- PostgreSQL Repository 替换 JSON Store；Task 创建、首个 Run、Event 与 Outbox 在同一事务提交。
- Outbox Publisher 将 `run.queued` 可靠投递到 BullMQ，成功后才标记 `published`。
- BullMQ Worker 按 `runId` 消费，并通过 `WHERE status = queued` 的 PostgreSQL 条件更新原子认领。
- 重复 Queue delivery 返回 non-claimable，不会重复执行；Agent Event 继续由 `(run_id, dedupe_key)` 去重。
- RelayHub 专用 PostgreSQL/Redis 容器使用 `55432`/`56379` 和独立持久卷。
- Phase 1A JSON 的幂等导入工具；已导入 4 个 Task、4 个 Run、40 个 Event，原 JSON 未修改。

### 当前完整链路

```text
POST Task
  -> PostgreSQL transaction: Task + Run + Event + Outbox
  -> Outbox Publisher: BullMQ job(runId)
  -> Worker consumes job
  -> PostgreSQL atomic claim: queued -> claimed
  -> run.started + output/tool events + run.completed
  -> PostgreSQL: Run succeeded + Task completed
  -> WebSocket notification + HTTP durable snapshot
```

### 验证证据

- 完整 TypeScript typecheck：通过。
- 状态机、Queue URL 与 PostgreSQL Repository 自动化测试：8/8 通过。
- PostgreSQL 集成测试覆盖：Task 幂等、Run 原子 claim、重复 claim 拒绝、Agent Event 和终态收敛。
- Next.js production build、API 与 Worker build：通过。
- 独立 Docker PostgreSQL 与 Redis healthcheck：healthy。
- 端到端冒烟：Task=`completed`、Run=`succeeded`、10 个有序 Event、Outbox=`published`。

### 尚未实现

- Worker lease、heartbeat 与崩溃 reconciliation。
- 真实 Agent CLI、Worktree 隔离与进程监管。
- Handoff/Review 应用服务和 Builder → Reviewer 闭环。
- `require_user_confirmation` 的交互流程；当前 Mock 单 Agent 纵向切片仍直接完成 Task。

### 下一个可运行里程碑

Phase 2 完成 Codex CLI Adapter、隔离 Worktree 和子进程监管后，RelayHub 将可以执行真实的单 Builder 本地开发任务。多 Agent Handoff、Reviewer 和审批闭环仍属于 Phase 3，不能把首次真实 Agent 运行表述成完整多 Agent 最终态。

## 2026-08-06：Phase 1A 单 Agent 纵向切片

### 已实现

- 独立 pnpm workspace，不加入 Clowder AI 根 workspace。
- `packages/contracts`：Task/Run 状态、Zod 输入协议、统一 AgentEvent。
- `apps/api`：Fastify API、JSON 原子持久化、幂等任务创建、Run 原子认领和 Socket.IO 广播。
- `apps/worker`：轮询领取任务、Mock Agent 流式事件和失败上报。
- `apps/web`：Next.js 任务创建、任务列表、运行状态和实时 Timeline。
- WebSocket 重连后重新订阅任务房间，并重新读取持久化快照。
- 生产依赖 override，修复审计发现的 Sharp 与 PostCSS 传递依赖漏洞。

### 当前完整链路

```text
POST Task
  -> Task queued + Run queued + task.created
  -> Worker atomic claim
  -> run.started
  -> output/tool events
  -> run.completed
  -> Run succeeded + Task completed
  -> Web Timeline realtime refresh
```

### 验证证据

- TypeScript typecheck：通过。
- 自动化测试：7/7 通过。
  - 状态机测试 5 个。
  - Store、幂等和持久化测试 2 个。
- Next.js production build：通过。
- API + 独立 Worker 冒烟测试：Task 最终为 `completed`，Run 最终为 `succeeded`，共生成 10 个有序事件。
- `pnpm audit --prod --registry=https://registry.npmjs.org`：无已知漏洞。

### 有意保留的原型边界

- 当前存储是 API 独占写入的 JSON 文件，不支持 API 多实例。
- Worker 使用短轮询领取任务，尚未接 Redis/BullMQ。
- 只有 Mock Adapter，尚未启动真实 Agent CLI 子进程。
- 尚未实现取消、lease、重启恢复、Handoff 和 Review。

这些不是隐藏缺陷，而是 Phase 1A 的明确范围；后续按路线逐项替换，同时保持 API、Worker 和 Web 之间的协议稳定。

### 当时的下一步

Phase 1B：基于已经确认的整体基线，同时引入 PostgreSQL、Drizzle migration、Transactional Outbox 和 Redis/BullMQ，并保持现有 Web、API 与 Worker 业务协议稳定。
