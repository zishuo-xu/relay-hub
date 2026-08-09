# 07. 实现状态

## 2026-08-09：现有 Agent 编辑与模型切换

### 已实现

- Agent 配置列表中的现有 Profile 可点击编辑，不再只有新建入口。
- 编辑抽屉预填名称、能力、CLI、ProviderConnection、模型、OpenCode 专属参数和启停状态；保存复用既有完整更新 API。
- OpenCode Agent 可切换官方/自定义连接及其模型；Codex Agent 可指定 `--model`，留空时跟随 CLI 默认模型。
- 停用替代删除：Profile 不再用于新任务，但历史 Task、Run 和快照保持可读。
- AgentProfile 更新仍只影响未来 Run；已创建 Run 继续执行自己的不可变快照。

### 验证证据

- Contracts 18/18、Worker 14/14 测试通过；独立 PostgreSQL API 集成测试 15/15 通过，覆盖 Codex 模型创建、更新和停用。
- 真实 `http://localhost:3010/` 验收通过：5 个现有 Agent 均为可点击编辑项；OpenCode 正确预填连接和模型；Codex 可填写可选模型并切换启停状态；未提交验收修改，浏览器控制台无错误。

## 2026-08-09：Workspace 模型连接与 Agent 复用

### 已实现

- 新增 Workspace 级 `ProviderConnection` 表、合约和 API，支持 CLI 官方认证与 OpenAI Chat Completions / Responses 自定义 API。
- 自定义连接集中保存 Base URI、凭证环境变量名称和模型目录；不保存 API Key。
- AgentProfile 新增可空连接引用。新 Agent 从兼容连接中选择模型；旧 Agent 和历史 Run 保持兼容。
- Run 的不可变 AgentProfile snapshot 包含非敏感连接快照。Worker 使用该快照生成单次 `OPENCODE_CONFIG_CONTENT`，连接后续修改不会改变已创建 Run。
- Web 新增“模型与连接 / Agent 配置”Workspace 设置页和自定义连接抽屉。

### 验证证据

- TypeScript 类型检查和全仓单元测试通过。
- migration `0010_wealthy_pet_avengers.sql` 已在现有本地数据库无损执行；新增 `provider_connections` 和可空外键，原有 Task、Run、Event 保留。
- 独立 PostgreSQL 测试库 API 集成测试 14/14 通过，覆盖“连接复用 → Agent 引用 → Run 快照 → Worker claim”。
- 本机 OpenCode CLI `1.18.15` 已验证可读取 RelayHub 生成的临时 custom provider/model 目录，无需改写项目或用户级 OpenCode 配置。
- 真实 `http://localhost:3010/` 验收通过：设置页展示官方/自定义连接分区；自定义连接表单验证通过；OpenCode/Codex 切换时只展示兼容连接；浏览器控制台无错误。验收表单未提交到正式配置。

## 2026-08-09：任务概览与运行日志分层

### 已实现

- 任务侧栏新增“待处理 / 全部”筛选，默认只突出运行中、待确认、需修改或失败等需要用户关注的任务；历史任务仍可完整访问。
- 主工作区从单一事件时间线重组为“任务概览 / 运行日志”两个层级；每次切换 Task 默认回到概览。
- 任务概览在单屏内集中展示任务目标、验收标准、Builder → Reviewer → 完成策略进度、最近结果和四个关键节点。
- 完整 Agent 输出、工具调用和平台事件保留在运行日志，不改变事件持久化、审计能力或后端合约。
- 新建任务和 Agent 配置入口互斥打开，避免多个抽屉叠加；未引入新的页面、状态库或后端领域对象。

### 验证证据

- Web TypeScript 类型检查通过。
- `741 × 772` 真实页面中，文档尺寸与视口一致；任务概览面板内容完整收敛在可用高度内，默认只显示 1 个待处理任务，切换“全部”可访问 21 个历史任务。
- “任务概览 / 运行日志”切换成功，完整日志仍展示 22 个持久事件；Agent 配置抽屉打开数量为 1，关闭后恢复主工作区。

## 2026-08-08：通用 Agent 身份、CLI 选择与 Run 配置快照

### 已实现

- Web 从“配置 OpenCode”重构为“新建 Agent”：名称由用户定义，Builder/Reviewer 是可组合能力，运行 CLI 可选 Mock、Codex CLI 或 OpenCode CLI。
- CLI 专属字段按 Adapter 动态显示；切换到 Codex 或 Mock 时不会提交 OpenCode model、variant、内部 Agent 或凭证环境变量字段。
- 新增统一 `/api/agent-runtimes` 查询，返回三种 CLI 的本机可用性、版本、说明和可选模型目录；保存后仍按 Profile 执行健康检测。
- AgentProfile 继续作为可复用、可修改的当前配置；Run 新增不可变 `agent_profile_snapshot`，初始 Builder、Reviewer、repair Builder 和后续 Reviewer 均在创建事务中固化当时 Profile。
- Worker claim 只使用 Run 快照，不再读取 AgentProfile 当前值；历史 Timeline 也优先展示快照身份。
- 公有 Task detail 只返回快照的身份摘要，不返回完整 `config`；完整运行配置只在服务端 claim 路径交给 Worker。
- migration `0009_strange_leo.sql` 先新增可空 JSONB、从外键关联的 AgentProfile 无损回填、验证无空值后再设置 NOT NULL；不删除或覆盖任何 Task、Run、Event。
- 架构与数据所有权决策固化在 `ADR-012-agent-identity-runtime-and-run-snapshot.md`。

### 验证证据

- 专用 migration 数据库 52/52 个历史 Run 完成快照回填，snapshot ID 与 `agent_id` 0 个不一致；正式数据库 23/23 完成回填，0 个不一致。
- 隔离 PostgreSQL API 集成测试 13/13 通过；新增用例在 AgentProfile 从 `opencode/big-pickle` 修改为 `opencode/longcat-2.0-free` 后领取旧 Run，确认 Worker 仍得到旧模型快照。
- Contracts 15/15 通过，覆盖通用 Codex Profile 和 CLI 专属字段边界。
- 真实 API 检测到 Mock、Codex CLI `0.146.0-alpha.9.2`、OpenCode CLI `1.18.15`，历史 Task API 的所有 Run 均返回快照。
- 真实浏览器在 `741 × 772` 验证 OpenCode → Codex 动态切换、OpenCode 字段隐藏、Builder/Reviewer 组合选择；页面和表单均无滚动，未提交测试 Agent。

## 2026-08-08：可配置 OpenCode Builder / Reviewer

### 已实现

- AgentProfile 输入合约支持 `opencode_cli`，保存角色能力、精确 `provider/model`、可选 variant、OpenCode agent 名称和凭证环境变量名称；API Key 值不落库。
- 新增 AgentProfile 创建、完整更新、单 Profile 健康检测和 OpenCode CLI/模型目录查询 API；通用 JSONB `config` 已满足需求，本次无需数据库 migration。
- 新增 OpenCode Adapter，使用 `opencode run --pure --format json`，把 text、tool、session、error 和进程终态转换为平台统一事件，并复用 Codex 已有 Prompt、Worktree、Handoff、Review 与返工流程。
- Builder 只在当前 Worktree 内工作；Reviewer 每次 Run 强制禁用 edit、bash、外部目录、交互提问和子 Agent task。OpenCode error envelope 即使伴随退出码 0，也会收敛为失败 Run。
- 子进程只获得安全环境白名单、用户明确选择的单个凭证变量和 XDG 配置路径；也支持 `opencode providers login` 管理的本地凭证。
- Web 顶部新增“Agent 配置”入口，可选择 Builder/Reviewer、实际 CLI 模型目录、variant、OpenCode agent 和凭证环境变量名称。保存后自动检测并选中新 Profile。
- 健康检测只验证 CLI 与模型目录，不发送外部模型请求；真实 provider 凭证和额度由第一次任务执行验证。
- 架构与安全取舍固化在 `ADR-011-configurable-opencode-agent-runtime.md`。

### 验证证据

- 本机实际检测到 OpenCode CLI `1.18.15` 和 15 个当前项目可见模型，API health 同时确认 PostgreSQL 与 BullMQ 正常。
- Contracts 14/14、Worker 13/13、API 单元测试 7/7 通过；隔离 PostgreSQL 的 API Store/Orchestrator 12/12 通过。
- 仓库级 `pnpm check` 完整通过，覆盖全 workspace 类型检查、测试与 Next.js 生产构建。
- 真实浏览器在 `741 × 772` 视口验收：配置抽屉为 `420 × 748`，页面尺寸等于视口，表单 `clientHeight` 与 `scrollHeight` 均为 681；全部配置字段单屏可见，Builder/Reviewer 切换成功，浏览器控制台无错误。
- 浏览器验收没有提交 Profile，不向正式 PostgreSQL 写入虚构模型配置；页面保留在 `http://localhost:3010/` 供用户填写真实选择。

## 2026-08-07：Phase 3.3 Review 驱动的自动返工循环

### 已实现

- Task 固定保存 `builderAgentId` 和可配置 `maxReviewRounds`（默认 3，范围 1–10），Reviewer 成为当前 Run 时不会丢失返工目标身份。
- `changes_requested` Review 在预算内会由同一事务创建 `triggerType=retry` 的 Builder Run、Outbox 和 `task.repair_requested` 审计事件；Task 显式经过 `reviewing -> changes_requested -> queued`。
- repair Run 的 `parentRunId` 指向来源 Reviewer Run，`retryOfRunId` 指向上一轮 Builder Run，旧 Run、Review 和 Findings 保持不可变。
- repair Run 继承 Builder Worktree、working directory 和 branch，跳过新 Worktree 与 Bootstrap；领取时获得独立 Run Token 以及来源 Review/Findings。
- Codex Builder repair Prompt 明确列出 Review round、Finding 严重度、文件位置、详情和建议；Mock Adapter 保留确定性演示路径。
- repair Builder 完成后复用既有 Handoff 流程创建下一轮 Reviewer Run；新的 verdict 保存为新的 Review round。
- 达到轮次预算仍要求修改时不再创建 Run，Task 转入 `waiting_for_user` 并记录 `task.repair_limit_reached`。
- Web 创建任务可配置最大 Review 轮数；Timeline 识别返工 Run 创建和轮次上限事件。
- migration `0008_superb_yellowjacket.sql` 只增加 Task Builder 外键与 Review 轮次预算，并从历史首个 user Run 无损回填 Builder 身份。

### 验证证据

- Contracts 12/12 通过，覆盖 Review 预算默认值和 1–10 边界。
- Worker 10/10 通过，覆盖 repair Prompt、Findings 注入、workspace-write 边界和修复后 Handoff 顺序。
- 隔离 PostgreSQL 中 API Store + Orchestrator 11/11 通过；完整重建 Builder → Review #1 changes_requested → repair Builder → Review #2 approved → 用户确认的四 Run 因果链，并验证预算耗尽时不创建额外 repair Run。
- migration 已先在 `relayhub_migration_test` 独立数据库验证，再应用到正式 PostgreSQL；历史 Task 的空 Builder 身份计数为 0，未删除或覆盖业务数据。
- 仓库级 `pnpm check`（typecheck、tests、production build）通过；API health 同时确认 PostgreSQL 与 BullMQ 正常。
- 3010 Web 在真实浏览器复验：创建抽屉默认显示 3 轮、可编辑为 2，并在当前窄视口保持 CompletionPolicy、轮次预算和 Builder/Reviewer 选择完整可见。

## 2026-08-07：Phase 3.2 结构化 Review、Finding 与完成策略

### 已实现

- `ReviewDraft` 固化 `approved / changes_requested / blocked`、摘要和最多 100 条结构化 Finding；Finding 包含严重度、可选文件/行号、标题、详情和建议。
- 合约校验 verdict 与 Finding 一致性：approved 不允许 actionable Finding，changes_requested 至少需要 blocking/should_fix，blocked 至少需要 blocking。
- 只有当前 Task 配置的独立 Reviewer Run 能提交 Review；每个 Run 最多一条 Review，同一 Task round 唯一。Review/Finding 先持久化，缺少 Review 的 Reviewer Run 不能成功完成。
- Reviewer `run.completed` 事务依据 Review 和 CompletionPolicy 推进 Task：自动完成、等待用户最终确认、确定性风险路由、changes_requested 或 blocked。
- `risk_based` 当前只在 Builder 命令证据非空且全部 succeeded 时自动完成，不把审批决定交给模型。
- 新增用户确认接口；只允许最新 Review 为 approved 的 waiting_for_user Task 完成，重复确认 completed Task 保持幂等。
- Mock Reviewer 和 Codex Reviewer 都在 Run 完成前提交结构化 Review；Codex 使用显式 envelope，解析失败收敛为 protocol failure，并将 Task 交给用户处理。
- Web 可配置三种完成策略，展示最新 Review 摘要、Finding 数量、Verdict 时间线和“确认完成”操作。
- migration `0007_brave_lila_cheney.sql` 只为既有 Review 表增加 Run 唯一索引与 Task/round 唯一索引，不删除或改写业务数据。

### 验证证据

- Contracts 10/10、Worker 9/9 通过；覆盖 verdict/Finding 约束、Codex 结构化 envelope、Reviewer 事件顺序和无效裁决拒绝。
- 隔离 PostgreSQL 中 API Store + Orchestrator 10/10 通过；覆盖缺少 Review 不得完成、Review/Finding 查询重建、用户确认和三种 CompletionPolicy 决策。
- 独立 API `4110`、临时 Redis `56380`、隔离 PostgreSQL 和真实 BullMQ Worker 完成 23 事件双 Agent E2E：两个 Run 均 succeeded、Handoff dispatched、Review round 1 approved，Task 经 `auto_on_approval` 自动 completed。
- 正式 PostgreSQL 已应用纯新增 migration；仓库级 `pnpm check`（typecheck、tests、production build）通过。
- 正式 Web/API/Worker 又完成 require_user_confirmation 实跑：Review 摘要与确认按钮在 1280×720 首屏可见，点击后 Task=`completed` 且追加 `task.user_confirmed`；浏览器控制台无错误。
- `changes_requested` 自动创建 Builder 修复 Run 已在 Phase 3.3 实现。

## 2026-08-07：Phase 3.1 结构化 Handoff 与 Reviewer Run 派发

### 已实现

- Task 支持可选 Reviewer AgentProfile；创建时校验 Builder/Reviewer 不同、Reviewer 启用且具有 `review` capability。正式 seed 新增独立 `Mock Reviewer`。
- `HandoffDraft` 固化目标、objective、context summary、artifact refs 和 acceptance criteria，并限制每个来源 Run 最多一个 Handoff。
- Builder 的 `handoff.requested` 事务只保存 pending Handoff 和持久 Event；不会在 Builder 完成前启动 Reviewer。
- Builder `run.completed` 事务原子保存 Outcome、创建 `triggerType=review` 的父子 Run、关联 target Run、更新 Handoff=`dispatched`、Task=`reviewing` 并写 Outbox。
- Reviewer claim 从 PostgreSQL 获得 Handoff、自己的 AgentProfile 和独立 Run Token，不接收 Builder Session 或隐藏 reasoning。
- Reviewer 复用 Builder 已完成的 Worktree；真实 Codex Reviewer 使用 `read-only` sandbox 并跳过写入型 Bootstrap。Reviewer 不能再次请求 Reviewer，避免递归派发。
- Web 新建任务可分别选择 Builder/Reviewer，Timeline 识别 Handoff、Reviewer 派发和 Reviewer Run 完成。
- migration `0006_aberrant_mauler.sql` 只增加可空 `reviewer_agent_id` 外键和 Handoff 来源唯一索引；既有 Task 数据保持兼容。

### 验证证据

- Contracts 8/8、Worker 8/8 通过；Codex Adapter 覆盖 Builder Handoff 顺序、Reviewer 独立 Prompt、无递归 Handoff 和 read-only sandbox 选择。
- 隔离 PostgreSQL 中 API Store + Orchestrator 6/6 通过，验证 pending 阶段仍只有一个 Run、错误目标拒绝、完成后父子 Run/Outbox 原子创建，以及 Reviewer 完成后的确定收敛。
- 独立 API `4110`、临时 Redis `56380` 和真实 BullMQ Worker 完成双 Run 全链路：Builder 与 Reviewer 均 `succeeded`，Task=`waiting_for_user`，Handoff=`dispatched`。
- 全链路共 22 个有序事件；`handoff.requested` 先于 Builder `run.completed`，Reviewer 输出证明其收到交接上下文，公有详情没有 Run Token 泄漏。
- 正式 PostgreSQL 已应用纯新增 migration，并成功 seed Mock Reviewer；结构化 Review verdict/Finding 后续已在 Phase 3.2 实现。

## 2026-08-07：Phase 2.8 API 持久化职责整理

### 已实现

- `PostgresStore` 从 578 行收敛为 98 行稳定门面，Fastify 路由和现有调用方无需改变。
- 新增同包 `persistence/` 目录，分别承载 Workspace 配置、Task 查询/创建、Run claim/Token/取消以及 Agent Event 驱动的 Workflow transaction。
- 行映射与 mutation result 只提取一次供这些模块复用，没有为每张表生成 Repository/Service/DTO，也没有新增依赖或运行进程。
- PostgreSQL schema、事务内容、HTTP 合约、状态机和事件语义保持不变；本次不需要数据库 migration。

### 验证证据

- API 类型检查通过；隔离 PostgreSQL 下 Store、Run Token 和 Orchestrator 测试 6/6 通过。
- `pnpm check` 全部通过，覆盖全仓类型检查、Contracts 6/6、Queue 1/1、API 单元测试 4/4、Worker 6/6 和 Next.js 生产构建。
- 拆分后最大持久化模块 171 行，Workflow transaction 独立为 146 行；入口 `store.ts` 不再承担 SQL 和状态迁移实现。

## 2026-08-06：Phase 2.7 单次 Run execution token

### 已实现

- Worker 原子领取 Run 时生成 `rht_` 前缀的 256-bit 随机不透明 Token，领取响应把 `ClaimedRun` 与 `executionToken` 分离。
- PostgreSQL migration `0005_neat_menace.sql` 仅为 Run 增加 Token 哈希、签发、过期和撤销时间；数据库不保存明文。
- control/event 内部接口要求 Bearer Token，并校验 Run 绑定、SHA-256 哈希、有效期、撤销时间和非终态状态。
- Worker 仅在内存中持有 Token；AgentAdapter 仍只接收 `ClaimedRun`，因此 Token 不进入 Agent、Prompt、Event、日志 payload 或公有 Task/Run API。
- 默认有效期 2 小时，可由 `RELAY_HUB_RUN_TOKEN_TTL_MS` 配置；成功、失败或取消终态在同一事务中立即撤销。
- 当前保持轻量本地边界：没有引入 JWT、登录、RBAC 或认证服务；claim 接口的 Worker 身份认证与 lease/heartbeat 后续共同实现。

### 验证证据

- Run token 单元测试 2/2 通过，覆盖随机格式、哈希存储语义和恒定时间匹配路径。
- 独立 PostgreSQL 测试库 migration 成功，Repository 集成测试 2/2 通过，验证明文不落库、错误/过期 Token 拒绝和终态撤销。
- 独立 API `4110` 与临时 Redis `56380` 完成 HTTP 全链路：无 Token=401、错误 Token=401、正确 Token=200、started/completed=200、终态复用=401。
- 同一隔离环境启动真实 BullMQ Worker 并执行 Mock Run，验证 Worker 可领取 `{ claimed, executionToken }`、携带凭证连续上报 11 个事件并正常完成队列 Job。
- 全链路最终 Task=`waiting_for_user`、Run=`succeeded`，公有 Task detail 不包含 Token 或 `rht_` 明文。
- 正式 PostgreSQL 已应用纯新增列 migration；4 个 Token 生命周期字段存在，API health 与 Web `3010` 均返回 200。

## 2026-08-06：Phase 2.6 provider-neutral Workspace Bootstrap

### 已实现

- `BootstrapPolicy` 属于 Workspace 项目环境契约，不包含 Codex、Claude Code、OpenCode 或模型字段；空步骤表示 `none`。
- Workspace PATCH API 支持显式配置最多 8 个 `command + args + timeoutMs` 步骤。
- 创建 Run 时固化 `bootstrapPolicySnapshot`，避免排队后配置变化影响执行复现。
- Worker 在隔离 Worktree 创建后、真实 AgentAdapter 启动前执行 Bootstrap，复用 ProcessSupervisor 的 shell-free 参数数组、环境变量白名单、超时与取消能力。
- 持久化 `run.bootstrap_started`、step completed、completed 和 failed 事件；前端 Timeline 已提供对应中文语义和状态色。
- spawn、超时或非零退出统一收敛为 `bootstrap_failed`，并保证 Agent 不启动。
- PostgreSQL migration `0004_dusty_wong.sql` 为 Workspace 增加策略、为 Run 增加策略快照；均带空策略默认值，兼容既有数据。

### 验证证据

- BootstrapRunner 覆盖空策略、成功 argv 步骤和非零退出阻断，3/3 通过；Worker 当前合计 6/6 测试通过。
- 独立测试数据库 migration 与 API 4/4 测试通过，确认 Workspace 默认策略和 Run 快照均可持久化读取。
- 独立临时 Git 仓库、PostgreSQL 测试库和临时 Redis 全链路验证：失败策略被固化到 Run，事件顺序为 prepared → bootstrap started → bootstrap failed → run failed。
- 冒烟 Run 最终 `failureCode=bootstrap_failed`，事件中不存在 `run.started`，证明真实 Agent 未被启动。
- 正式 PostgreSQL 只执行了新增列 migration，没有删除或清理既有数据；测试 Workspace 配置已恢复为空策略。

## 2026-08-06：Phase 2.5 RunOutcome 与工作流边界

### 已实现

- 新增结构化 `RunOutcome`，持久化 Agent 最终摘要以及实际命令的状态、退出码和受限输出摘要。
- `run.completed` 现在只表示 Agent 协议成功结束，并把 Run 收敛为 `succeeded`；不再直接把 Task 改为 `completed`。
- 新增 API 内部纯函数 Orchestrator seam。Reviewer dispatch 尚未实现时，成功 Builder Run 将 Task 路由到 `waiting_for_user`。
- 同一事务追加 `task.waiting_for_review` 审计事件，记录来源 Run、路由原因和 Task 的 CompletionPolicy。
- `CompletionPolicy` 保留到合法 Reviewer verdict 之后执行，Builder 自报完成不能绕过审查或人工确认。
- Web Timeline 已识别“等待审查”和“进入审查”事件，并从结构化 Outcome 展示执行摘要。
- PostgreSQL migration `0003_daffy_master_chief.sql` 仅为 `runs` 增加可空 `outcome jsonb` 字段，既有数据未删除或改写。

### 验证证据

- Contracts、API、Worker 和 Web 类型检查通过。
- 独立测试数据库 migration 通过；API 4/4、Contracts 6/6、Worker 3/3 测试通过。
- 使用独立测试 PostgreSQL 和临时 Redis 完成 Mock 全链路：Run=`succeeded`、Task=`waiting_for_user`、Outcome 已持久化，最后事件为 `task.waiting_for_review`。
- 正式 RelayHub 数据库已应用非破坏性 migration，API 健康检查恢复为 PostgreSQL/BullMQ 正常。

## 2026-08-06：控制台 UX clean-room 重构

### 已实现

- 参考 Clowder AI 的控制台信息架构，重新组织为活动栏、任务侧栏和主工作区三层固定应用外壳。
- 使用 RelayHub 独立设计的暖色中性浅色界面；没有复制参考项目的组件源码、品牌文案或视觉资产。
- 当前 Task 的状态、运行信息和事件时间线成为主视觉焦点，任务列表作为稳定导航存在。
- 创建 Task 改为按需打开的右侧抽屉，不再长期占用工作区。
- 事件由大型时间线节点压缩为可扫描的紧凑行，并为状态与事件类型提供克制的语义色。
- 展示组件拆分到 `apps/web/app/dashboard.tsx`，`page.tsx` 保留请求、订阅和页面状态，降低后续加入 Reviewer/Handoff 时的耦合。

### 浏览器与构建验收

- `741 x 772` 与 `1280 x 720` 两种视口均不存在页面级横向或纵向滚动。
- 窄桌面下活动栏、任务侧栏和主工作区仍同屏；长任务列表与长时间线分别内部滚动。
- `741 x 772` 下创建抽屉完整位于视口内，打开后没有引入全局滚动。
- 干净页面会话没有运行时错误；仅有 React 开发工具提示。
- Web typecheck、测试命令和 Next.js production build 均通过。

## 2026-08-06：独立仓库运行切换

### 已实现与验证

- Web、API 和 Worker 已停止使用旧嵌套目录，并从 `/Users/xuzishuo/Documents/relay-hub` 重新启动。
- PostgreSQL 与 Redis 没有重启或清理；原任务和事件仍可查询。
- 默认 Workspace 已更新为独立仓库路径。
- Mock 冒烟 Task `48fbfb07-a7b6-46e3-b9dd-63b6df91b634` 完成，Run `d2c8404f-5318-42c2-8530-34bab5a04250` succeeded，产生 10 个持久事件。
- 真实 Codex 隔离 Task `6e23b6d2-a719-4f18-b25c-19d5ab66c523` 完成，Run `97d7b2c4-b501-496c-a8f9-f4947a8095f8` succeeded。
- Codex 在独立 `relayhub/run-*` 分支和 Worktree 中执行只读命令，正确报告 Worktree、分支、Node 版本和 README 内容。
- 独立源仓库和 Codex Worktree 最终都没有 tracked 修改。

### 当时验证发现的边界

- 新 Worktree 默认没有 `node_modules`；直接运行依赖型测试会因依赖不可解析而失败。
- Codex 沙箱内在线安装受本机 `registry.npmmirror.com` DNS 影响，且不能假定可以读取完整宿主 pnpm store。
- 当时 `run.completed` 会让 Run/Task 同时进入 succeeded/completed；该执行结果语义问题已由上方 Phase 2.5 RunOutcome 切片修复。
- 显式 Worktree bootstrap policy 已由上方 Phase 2.6 实现。

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

该节记录首次单屏化里程碑；当前界面已由上方的 clean-room 重构继续演进。

### 已实现

- 控制台固定为单视口布局，不再依赖整页纵向滚动。
- 常见桌面与窄桌面宽度下，任务队列和执行时间线保持同屏。
- 创建表单统一改为右侧抽屉，按需打开。
- 任务队列、执行时间线和创建表单的长内容在各自区域内滚动。
- 小于等于 720px 时，任务队列压缩为横向任务条，时间线保留剩余主要空间。

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

### 此阶段之后仍未实现

- Builder → Reviewer Handoff 已在 Phase 3.1 实现；Review/Finding 已在 Phase 3.2 实现，返工 Run 后续已在 Phase 3.3 实现。
- 单次 Run token 已在 Phase 2.7 实现；Worker lease、heartbeat 和崩溃 reconciliation 仍未实现。
- 用户批准后合并/提交 Worktree 的产品流程。
- Workspace Bootstrap 已在 Phase 2.6 实现；当前仍需由用户显式配置步骤，自动项目探测尚未实现。

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

### 当时尚未实现

- Worker lease、heartbeat 与崩溃 reconciliation。
- 真实 Agent CLI、Worktree 隔离与进程监管。
- Handoff 已在 Phase 3.1 实现；Review 裁决和 `require_user_confirmation` 交互已在 Phase 3.2 实现，返工 Run 后续已在 Phase 3.3 实现。

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

### 当时有意保留的原型边界

- 当前存储是 API 独占写入的 JSON 文件，不支持 API 多实例。
- Worker 使用短轮询领取任务，尚未接 Redis/BullMQ。
- 只有 Mock Adapter，尚未启动真实 Agent CLI 子进程。
- 当时尚未实现取消、lease、重启恢复、Handoff 和 Review；其中取消与 Handoff 已在后续阶段完成。

这些不是隐藏缺陷，而是 Phase 1A 的明确范围；后续按路线逐项替换，同时保持 API、Worker 和 Web 之间的协议稳定。

### 当时的下一步

Phase 1B：基于已经确认的整体基线，同时引入 PostgreSQL、Drizzle migration、Transactional Outbox 和 Redis/BullMQ，并保持现有 Web、API 与 Worker 业务协议稳定。
