# 07. 实现状态

## 2026-08-06：独立仓库运行切换

### 已实现与验证

- Web、API 和 Worker 已停止使用旧嵌套目录，并从 `/Users/xuzishuo/Documents/relay-hub` 重新启动。
- PostgreSQL 与 Redis 没有重启或清理；原任务和事件仍可查询。
- 默认 Workspace 已更新为独立仓库路径。
- Mock 冒烟 Task `48fbfb07-a7b6-46e3-b9dd-63b6df91b634` 完成，Run `d2c8404f-5318-42c2-8530-34bab5a04250` succeeded，产生 10 个持久事件。
- 真实 Codex 隔离 Task `6e23b6d2-a719-4f18-b25c-19d5ab66c523` 完成，Run `97d7b2c4-b501-496c-a8f9-f4947a8095f8` succeeded。
- Codex 在独立 `relayhub/run-*` 分支和 Worktree 中执行只读命令，正确报告 Worktree、分支、Node 版本和 README 内容。
- 独立源仓库和 Codex Worktree 最终都没有 tracked 修改。

### 验证发现的边界

- 新 Worktree 默认没有 `node_modules`；直接运行依赖型测试会因依赖不可解析而失败。
- Codex 沙箱内在线安装受本机 `registry.npmmirror.com` DNS 影响，且不能假定可以读取完整宿主 pnpm store。
- 当前 `run.completed` 表示 Agent 协议正常结束，不表示验收标准通过；即使 Agent 明确报告测试失败，Run/Task 仍会进入 succeeded/completed。
- 因此进入 Reviewer 前必须补齐显式 Worktree bootstrap policy，并将“Agent 正常结束”和“任务验收通过”拆成不同判定。

## 2026-08-06：独立公开仓库

### 已实现

- 从参考项目目录提取 RelayHub 专属 Git 历史，提交路径重写为独立仓库根目录。
- 独立本地仓库位于 `/Users/xuzishuo/Documents/relay-hub`，默认分支为 `main`。
- 独立公开仓库为 `https://github.com/zishuo-xu/relay-hub`，后续改动直接推送 `origin/main`。
- 原嵌套目录保留为迁移备份，没有删除或覆盖数据。
- 提取后的历史只包含 RelayHub 的提交，不包含 Clowder AI 的项目历史。

### 迁移验证

- `pnpm install --frozen-lockfile`：通过，锁文件无需修改。
- `pnpm check`：类型检查、10 个非数据库测试和全部 workspace 生产构建通过。
- 独立测试数据库 migration：通过，没有使用或清理正式运行数据。
- PostgreSQL Repository 集成测试：2/2 通过；合计 12 个自动化测试通过。

## 2026-08-06：单屏控制台 UX

### 已实现

- 控制台固定为单视口布局，不再依赖整页纵向滚动。
- 常见桌面宽度下，任务队列、执行时间线和创建表单三列同屏。
- 窄桌面宽度下，任务队列与执行时间线保持同屏，创建表单改为右侧抽屉。
- 任务队列、执行时间线和创建表单的长内容在各自面板内滚动。
- 小于等于 640px 时，任务队列压缩为横向任务条，时间线保留剩余主要空间。

### 浏览器验收

- `741 x 772` 视口下，文档尺寸为 `741 x 772`，不存在全局横向或纵向滚动。
- 任务队列与执行时间线同时位于视口内；13 条任务通过任务面板内部滚动访问。
- “新建任务”抽屉完整位于视口内，打开和关闭均不会引入页面级滚动。
- 页面运行日志只有 React 开发工具提示，没有运行时错误。

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
