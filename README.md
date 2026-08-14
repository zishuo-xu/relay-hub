# RelayHub

> 一个面向个人开发者的多 Agent 协作与任务编排平台。

RelayHub 是一个独立的公开简历项目。它参考 Clowder AI 的产品问题和架构经验，但不复制其源码，也不追求复刻全部功能。项目重点是从零实现一个以对话线程为主入口、可解释、可测试、可演示的多 Agent 协作控制平面。

GitHub：<https://github.com/zishuo-xu/relay-hub>

## 项目目标

让用户在一个对话线程中与多个具名 Agent 协作，由平台负责身份、消息路由、异步执行、Agent 间交接、审查、失败恢复和审计追踪，使用户不再充当 Agent 之间的人工路由器。

第一版完整演示链路：

```text
进入协作线程 -> @Agent 发起讨论或执行 -> Agent 独立 Run
        -> Agent 消息回到线程 -> 必要时结构化交接/咨询/审查 -> 用户处理关键决策
        -> Task/Run/Handoff/Consultation/Review 在后台留下可恢复审计事实
```

产品北极星是“Chat 主入口 + Agent/模型配置 Hub + Task/Run 治理与审计”。Git worktree、commit、push 和合并策略是 Agent 工具能力或开发 SOP，不是产品中心。Thread/Message、Task 级版本化公开上下文、用户显式多 Agent 并行派发与单层受控 Agent 咨询均已完成：同一线程中的多个 Agent 可以在固定、可审计的消息边界内独立处理请求；负责 Agent 也能向另一个独立只读 Agent 询问有限问题，再自动恢复并综合结果。详见 [ADR-020](docs/decisions/ADR-020-versioned-conversation-context.md)、[ADR-021](docs/decisions/ADR-021-atomic-multi-agent-message-dispatch.md) 与 [ADR-022](docs/decisions/ADR-022-controlled-agent-consultation.md)。

## 为什么适合作为简历项目

- 不只是一个 LLM 对话壳，而是包含状态机、队列、实时通信、进程管理和适配器设计的平台工程。
- 可以同时展示后端设计、前端状态管理、AI Agent 集成和可靠性思考。
- 项目边界足够小，可以独立完成；主链路又足够完整，适合现场演示和深入追问。
- 每一个关键设计都有文档和取舍依据，便于证明这是自己的工程判断。

## 当前状态

- [x] 项目定位与参考边界
- [x] Clowder AI 核心能力拆解
- [x] MVP 需求与验收标准
- [x] 第一版架构、数据模型和接口草案
- [x] 开发路线与面试表达草案
- [x] 完成面向最终形态的整体设计基线评审
- [x] 初始化独立 TypeScript workspace
- [x] 完成 Mock Agent 单 Agent 纵向切片
- [x] 完成 PostgreSQL、Drizzle migration、Transactional Outbox 与 Redis/BullMQ 基础设施层
- [x] 完成真实 Codex CLI Builder、隔离 Worktree、子进程监管与取消链路
- [x] 分离 Agent 执行结果与 Task 验收，持久化结构化 RunOutcome
- [x] 完成 provider-neutral Workspace Bootstrap、Run 配置快照与失败阻断
- [x] 完成单次 Run execution token、Worker 回调鉴权与终态撤销
- [x] 按 Task、Run execution 和 Workflow transaction 拆分 API 持久化职责
- [x] 完成结构化 Builder → Reviewer Handoff、父子 Run 和可靠队列派发
- [x] 完成结构化 Review/Finding、CompletionPolicy 与用户确认完成
- [x] 完成 `changes_requested` 自动返工、Review 多轮复审与轮次预算
- [x] 完成多 Agent 交接与 Review 主流程
- [x] 完成任意已配置平台 Agent 之间的顺序型动态 Handoff，并通过真实 OpenCode A → B 验收
- [x] 完成可配置 OpenCode Builder/Reviewer、运行时检测与统一事件适配
- [x] 完成 Claude Code 官方连接、Builder/Reviewer Adapter、权限映射与统一事件适配
- [x] 完成通用 Agent 创建、CLI/模型/长期提示词/权限模板配置与不可变 Run AgentProfile 快照
- [x] 完成 Worker Lease、Heartbeat、失联权限撤销和 `lost` 状态收敛
- [x] 完成对话优先第一切片：持久 Thread/Message、线程内 Agent Run、Agent 回复回流与按需审计抽屉
- [x] 完成 Task 级版本化公开 ConversationContext、跨 Agent 连续对话与上下文审计
- [x] 完成一条公开消息向最多 4 个 Agent 的原子并行派发、独立状态与结果回流
- [x] 完成受控 Agent 咨询：只读独立 Run、原 Agent 自动恢复、单层与三次预算约束
- [ ] 完成可观测性、测试和演示部署

## 目录约定

```text
relay-hub/
├── README.md
├── docs/                  # 本项目的全部分析、设计与决策文档
│   ├── 00-project-positioning.md
│   ├── 01-reference-analysis.md
│   ├── 02-mvp-requirements.md
│   ├── 03-architecture.md
│   ├── 04-data-model-and-api.md
│   ├── 05-roadmap.md
│   ├── 06-interview-story.md
│   └── decisions/
├── apps/
│   ├── api/               # Task/Run 状态、持久事件与实时广播
│   ├── worker/            # BullMQ Consumer、Mock/Codex/OpenCode/Claude Code Adapter 与 Worktree 隔离
│   └── web/               # 任务控制台与实时 Timeline
└── packages/
    ├── contracts/         # 跨进程共享协议与状态机
    ├── db/                # Drizzle schema、migration 与旧数据导入
    └── queue/             # BullMQ 队列工厂和连接契约
```

## 文档阅读顺序

1. [项目定位](docs/00-project-positioning.md)
2. [参考项目分析](docs/01-reference-analysis.md)
3. [MVP 需求](docs/02-mvp-requirements.md)
4. [系统架构](docs/03-architecture.md)
5. [数据模型与 API](docs/04-data-model-and-api.md)
6. [开发路线](docs/05-roadmap.md)
7. [面试表达](docs/06-interview-story.md)
8. [实现状态](docs/07-implementation-status.md)
9. [讨论沉淀规则](docs/08-documentation-workflow.md)
10. [整体设计基线草案](docs/09-overall-design-baseline.md)
11. [重大特性 Work Item 记录](docs/work-items/README.md)

## 独立性原则

RelayHub 拥有独立 Git 仓库、提交历史、依赖、包名、数据模型和 UI。Clowder AI 只作为研究材料；实现过程中通过公开接口思想和行为需求进行重新设计，避免复制其内部实现。

## 讨论沉淀约定

讨论中形成的稳定结论会在同一轮自动补充到相关文档。已经确认的方向、待验证设想和实际完成的功能必须分开标记，避免设计愿景与当前实现混在一起。详细规则见[讨论沉淀规则](docs/08-documentation-workflow.md)。

## 本地启动

使用真实 Codex Builder 时，需要先安装并登录 Codex CLI：

```bash
codex --version
codex login status
```

使用 OpenCode Builder 或 Reviewer 时，需要先安装 OpenCode，并通过 OpenCode 自己的登录流程或环境变量准备 provider 凭证：

```bash
opencode --version
opencode providers login
opencode models
```

使用 Claude Code Agent 时，需要先安装并登录 Claude Code：

```bash
claude --version
claude auth status
```

RelayHub 的“模型与连接”统一管理 URI、协议、模型目录和凭证环境变量名称，不保存 API Key。“Agent 配置”只引用连接和模型，并保存长期提示词与执行权限。运行时配置参考 OpenCode 官方的 [Config](https://opencode.ai/docs/config/)、[Providers](https://opencode.ai/docs/providers/) 和 [Permissions](https://opencode.ai/docs/permissions/) 约定。

```bash
cd relay-hub
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm dev
```

浏览器打开 `http://localhost:3000`。API 默认监听 `127.0.0.1:4100`；Worker 从 RelayHub 自己的 BullMQ 队列消费任务。PostgreSQL 使用 `127.0.0.1:55432`，Redis 使用 `127.0.0.1:56379`，并各自使用 Docker named volume 持久化数据。

在创建任务区域填写目标 Git Workspace 路径，并选择：

- `Mock Builder`：不调用外部模型，用于稳定演示平台链路。
- `Codex Builder`：创建 `relayhub/run-<runId>` 分支和独立 Worktree，再调用 `codex exec --json` 真实修改代码。
- 自定义 Agent：在“Agent 配置”中填写自定义名称和 Builder/Reviewer 能力，再选择 Mock、Codex CLI、OpenCode CLI 或 Claude Code。CLI 只是运行载体；OpenCode 选择连接模型目录，Codex 与 Claude Code 可选固定模型或跟随 CLI 默认模型。

AgentProfile 是可长期复用、可修改的当前配置。长期提示词定义角色偏好，Builder、Reviewer 和只读分析权限模板定义统一执行边界；CLI 内部子 Agent 只能继承父 Run 权限。每个 Run 在创建时保存不可变 AgentProfile 快照，因此修改 Agent 名称、CLI、模型、提示词或权限不会改变已经排队和历史 Run；后续 Run 才使用新配置。

Agent 健康检测只确认本机 CLI 可启动且所填模型出现在 `opencode models` 目录中，不会为了检测而发起计费模型请求；provider 凭证是否有效会在第一次真实任务中得到验证。

还可以独立选择 Reviewer。默认 `Mock Reviewer` 会稳定演示结构化 Handoff 和第二个 Reviewer Run；后续接入的真实 Reviewer AgentProfile 可以选择不同 provider/model。Builder 完成前平台只保存 pending Handoff，成功结束后才通过 Outbox/BullMQ 唤醒 Reviewer。

Reviewer 必须在结束前提交结构化 `Review`，结论为 `approved`、`changes_requested` 或 `blocked`，问题以 `Finding` 保存。创建任务时可选择审查通过后自动完成、等待用户最终确认，或仅在 Builder 存在成功命令证据时自动完成；还可以设置 1–10 轮 Review 预算（默认 3）。当 Reviewer 返回 `changes_requested` 时，平台会把 Review 和 Findings 注入新的 Builder 返工 Run，返工完成后再创建下一轮独立 Reviewer Run；预算耗尽则转交用户处理。

Worktree 默认保存在 `~/.relay-hub/worktrees/<runId>`，任务结束后不会自动删除，方便用户检查 diff 和测试证据。可通过 `RELAY_HUB_WORKTREE_ROOT` 改变存放位置。

Workspace 可以显式配置与 Agent 厂商无关的准备步骤；空 `steps` 表示无需准备。下面示例会在每个新 Run 的隔离 Worktree 中使用本机 pnpm store 安装锁定依赖，成功后才启动所选 Agent：

```bash
curl -X PATCH http://127.0.0.1:4100/api/workspaces/00000000-0000-4000-8000-000000000001 \
  -H 'content-type: application/json' \
  --data '{"bootstrapPolicy":{"steps":[{"name":"Install dependencies","command":"pnpm","args":["install","--offline","--frozen-lockfile"],"timeoutMs":120000}]}}'
```

不要在 Bootstrap 参数中放入密钥。项目语言或锁文件自动探测目前不会直接执行命令，持久化的显式 Workspace 策略才是运行事实来源。

Worker 领取 Run 时会获得只属于该次执行的临时 Token 和 30 秒 Lease。API 只保存 Token 的 SHA-256 哈希，Worker 仅在内存中持有明文，并每 10 秒通过受 Token 保护的 Heartbeat 续约；Token 不进入 Agent、Prompt、Timeline 或公有 Task/Run API。默认 Token 有效期为 2 小时，可通过 `RELAY_HUB_RUN_TOKEN_TTL_MS` 调整；Lease 与扫描周期可通过 `RELAY_HUB_RUN_LEASE_DURATION_MS`、`RELAY_HUB_RUN_LEASE_RECONCILE_INTERVAL_MS` 调整。Lease 到期后旧 Token 立即失去上报权限，Reconciler 将 Run 标记为 `lost` 并把 Task 转交用户处理，不会自动启动第二个 Agent 写同一个 Worktree。

如果本地已有 Phase 1A 的 `relay-hub/.data/state.json`，可执行一次无损导入：

```bash
pnpm db:import-json
```

命令采用幂等插入，不修改或删除原 JSON 文件。正式运行数据以 PostgreSQL 为准。

若 3000 端口已被其他项目占用，可单独在 3010 启动前端：

```bash
RELAY_HUB_WEB_ORIGIN=http://localhost:3010 pnpm --filter @relay-hub/api dev
NEXT_PUBLIC_RELAY_HUB_API_URL=http://127.0.0.1:4100 pnpm --filter @relay-hub/web exec next dev -p 3010
pnpm --filter @relay-hub/worker dev
```

验证全部类型、测试和构建：

```bash
pnpm check
```
