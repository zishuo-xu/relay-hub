# 04. 数据模型与 API 草案

## 设计状态

当前内容是目标领域模型的第一版草案，不是不可修改的最终数据库定义。PostgreSQL schema 必须从整体领域设计推导，并通过 migration 演进。

状态：**Accepted；Phase 1B schema baseline 已通过 Drizzle migration 实现。**

## 哪些定义应当长期稳定

以下内容会被 API、Worker、Web、Handoff 和审计共同引用，因此应尽早稳定：

- 核心实体：Workspace、AgentProfile、Task、Run、RunEvent、Handoff、Review。
- 全局身份：每个实体的 ID 以及 Workspace ownership。
- 因果关系：Task → Run、parentRun → childRun、Handoff → targetRun。
- Task 与 Run 的状态语义和终态规则。
- 事件的顺序、来源、发生时间、去重键和 schema version。
- “数据库是事实来源，Queue 不是事实来源”的所有权边界。
- Agent 只能通过显式 Handoff 传递工作，不能共享隐藏推理。

这些定义可以增加新能力，但不应在实现中随意改名或改变含义。

## 哪些字段允许演进

以下字段预计会随着真实 Agent、可观测性和多 Agent 工作流继续变化：

- Adapter/provider 的特定配置。
- Agent capabilities 和工具策略。
- 失败诊断、Token、成本与性能指标。
- Handoff artifact 的具体类型。
- Review finding 的扩展信息。
- UI 展示字段和非关键 metadata。
- 为真实查询增加的索引、物化视图或缓存字段。

字段变化通过 migration 完成。优先采用向后兼容的“先增加、迁移数据、切换读写、再移除”流程，避免一次变更同时破坏 API、Worker 和历史事件。

## Schema 演进规则

1. 核心 ID、ownership 和因果引用使用明确列与外键，不藏在 JSON 中。
2. 业务状态由 check constraint 和应用状态机共同约束。
3. `run_events` 作为历史事实默认只追加，不原地改写旧事件。
4. Event payload 带 `schema_version`，消费者必须显式处理支持的版本。
5. 高频筛选和一致性字段使用普通列；供应商特定、低稳定性信息才进入 JSONB。
6. Migration 必须有升级验证；涉及删除或不可逆转换时，需要单独 ADR。
7. SQL schema 服务于领域模型，不允许为了 ORM 方便改变业务语义。

## 核心实体关系

```mermaid
erDiagram
    WORKSPACE ||--o{ AGENT_PROFILE : contains
    WORKSPACE ||--o{ TASK : contains
    TASK ||--o{ RUN : has
    RUN ||--o{ RUN_EVENT : emits
    RUN ||--o{ HANDOFF : requests
    HANDOFF ||--|| RUN : creates_target
    RUN ||--o| REVIEW : produces
    REVIEW ||--o{ REVIEW_FINDING : contains

    WORKSPACE {
      uuid id PK
      text name
      text root_path
      timestamp created_at
    }
    AGENT_PROFILE {
      uuid id PK
      uuid workspace_id FK
      text name
      text adapter_type
      jsonb capabilities
      boolean enabled
    }
    TASK {
      uuid id PK
      uuid workspace_id FK
      text title
      text description
      text status
      int version
    }
    RUN {
      uuid id PK
      uuid task_id FK
      uuid agent_id FK
      uuid parent_run_id FK
      text status
      int attempt
      text failure_code
      int version
    }
    RUN_EVENT {
      bigint id PK
      uuid run_id FK
      text event_type
      int schema_version
      jsonb payload
      timestamp occurred_at
    }
```

## 表设计要点

### `workspaces`

| 字段 | 说明 |
|---|---|
| `id` | UUID |
| `name` | 展示名称 |
| `root_path` | 规范化后的允许工作目录 |
| `bootstrap_policy` | provider-neutral 项目环境准备步骤；空步骤表示 `none` |
| `created_at`, `updated_at` | 审计时间 |

### `agent_profiles`

| 字段 | 说明 |
|---|---|
| `adapter_type` | `mock`、`codex_cli` 或 `opencode_cli` |
| `provider_connection_id` | 可复用的 Workspace ProviderConnection；新的非 Mock Agent 必填，旧 Profile 可空 |
| `model_label` | 仅作展示与诊断，不参与安全判断 |
| `capabilities` | 例如 `implement`、`review`、`research` |
| `config` | Agent 非敏感运行参数和创建 Run 时固化的连接快照 |
| `enabled` | 停用后不能创建新 Run |

约束：同一 Workspace 内 Agent 名称唯一。

当前 OpenCode `config` 只允许以下非敏感字段：

- `model`：必填；官方连接使用精确 `provider/model`，自定义连接使用该连接声明的模型 ID。
- `variant`：可选，传给 OpenCode 的模型 variant。
- `agentName`：可选，选择 OpenCode 已定义的 agent。
- `providerConnection`：使用连接时固化的非敏感快照，供未来 Run 保持可重复执行。

旧 Profile 或历史 Run 快照中的 `credentialEnv` 仍可由 Worker 读取以保持兼容，但新的 Agent 创建和编辑接口不再接受该字段。凭证环境变量名称只属于 ProviderConnection。

AgentProfile 属于 Workspace，可被多个新 Task 复用；修改配置不会改写已经创建的 Run 或历史事件。CLI 专属配置继续复用通用 JSONB `config`；ProviderConnection 本身由 migration `0010_wealthy_pet_avengers.sql` 新增。

AgentProfile 表达用户定义的 Agent 身份，不表达一次执行。名称和能力是通用字段，`adapter_type` 才选择 Mock、Codex CLI 或 OpenCode CLI；CLI 专属配置只进入经过白名单校验的 `config`。

Codex AgentProfile 可在 `config.model` 中固定模型；Worker 启动时传给 `codex exec --model`。留空则继续使用 Codex CLI 默认模型。Web 对所有 AgentProfile 使用同一编辑入口，允许修改名称、能力、运行 CLI、ProviderConnection、模型和启停状态；OpenCode 的可用模型优先从所选连接目录中选择。更新只影响之后创建的 Run。

### `provider_connections`

| 字段 | 含义 |
|---|---|
| `workspace_id` | 连接所属 Workspace |
| `kind` | `official_cli` 或 `custom_api` |
| `adapter_type` | 当前支持 `codex_cli`、`opencode_cli` |
| `protocol` | `cli_managed`、`openai_chat_completions`、`openai_responses` |
| `base_url` | 自定义 API 的 Base URI；官方连接为空 |
| `credential_env` | Worker 允许透传的环境变量名称；不保存密钥值 |
| `models` | 该连接可供 Agent 选择的模型 ID 列表 |

Workspace API 提供连接的列表、创建、完整更新和无计费健康检测。AgentProfile 创建/更新时校验连接属于同一 Workspace、处于启用状态、支持所选 CLI，且自定义模型存在于连接目录中。

### `tasks`

除基本字段外保存：

- `thread_id`: 可选所属协作线程；旧任务保持为空
- `acceptance_criteria jsonb`
- `requested_by`
- `current_run_id`
- `builder_agent_id`: Task 的稳定 Builder 身份；当前 Run 可能属于 Reviewer，不能用它反推返工目标
- `reviewer_agent_id`: 用户为该 Task 选择的独立 Reviewer AgentProfile；可空以兼容单 Builder 流程
- `max_review_rounds`: 最多允许的 Review 轮数，默认 3，创建 API 限制为 1–10
- `version`
- `completed_at`

状态由数据库 check constraint 限制在枚举集合内。

### `threads` 与 `thread_messages`

`threads` 是持续协作上下文，不拥有 Task 状态机。一个 Thread 可以没有 Task，也可以包含多次独立 Task：

- `workspace_id`：线程所属 Workspace。
- `title`：首条消息可替换默认标题。
- `created_at`, `updated_at`：用于线程列表排序。

`thread_messages` 保存用户、Agent 或平台可见消息：

- `thread_id`：消息所属上下文。
- `task_id`, `run_id`：可选执行来源；普通消息不需要伪造 Run。
- `sender_type`, `sender_name`, `sender_agent_id`：消息身份与创建时名称。
- `recipient_agent_id`：用户消息的路由目标。
- `content`：公开协作内容，不保存隐藏推理。

用户向 Agent 发送消息时，API 在同一事务写入 User Message、Task、首个 Run、Task Event 与 Outbox；重复 `Idempotency-Key` 不产生第二条消息或第二个 Run。Agent `run.completed` 时优先把结构化 `RunOutcome.publicMessage` 作为 Agent Message 写回同一 Thread；`summary` 只承担执行审计摘要，并作为旧结果的兼容回退。RunEvent 继续只承担技术审计，不作为消息正文或当前状态真相。

#### Implemented：版本化公开 ConversationContext

[ADR-020](decisions/ADR-020-versioned-conversation-context.md) 已增加稳定的线程内消息顺序和 Task 上下文边界：

- `threads.message_sequence_high_water`：同一 Thread 已分配的最大消息 sequence；通过事务行锁递增。
- `thread_messages.sequence`：Thread 内严格递增顺序，并由 `(thread_id, sequence)` 唯一约束。
- `tasks.conversation_context_before_sequence`：创建该 Task 的 User Message sequence；历史上下文只能选择更早的公开消息。
- `tasks.conversation_context_policy_version`：固定选择、截断和预算算法的版本。

ConversationContext 不单独建可编辑表，也不复制到每个 Run。API 从不可变 Message、Task 边界和版本化纯选择器推导相同结果；同一 Task 的 Builder、Handoff、Reviewer 和 repair Run 使用同一 digest。当前 User Message 仍由 `Task.description` 表达，避免在历史区重复。

按需只读接口 `GET /api/runs/:runId/conversation-context` 用于审计“本次 Run 实际注入了哪些公开消息、哪些被截断或省略”。客户端不能提交 context cursor，也不能通过该接口读取其他 Thread 或 Workspace。

### `runs`

关键字段：

- `task_id`, `agent_id`, `parent_run_id`
- `trigger_type`: `user`、`handoff`、`review`、`retry`
- `status`, `attempt`, `version`
- `worker_id`, `lease_expires_at`
- `execution_token_hash`, `token_issued_at`, `token_expires_at`, `token_revoked_at`: 单次 Run 执行凭证的哈希和生命周期；不保存明文
- `session_ref`: Adapter 的可恢复会话标识
- `failure_code`, `failure_detail`
- `outcome jsonb`: 成功 Run 的结构化执行结果，包含摘要与实际命令证据；不等同于 Task 验收通过
- `started_at`, `finished_at`
- `workspace_root`: 创建 Run 时固化的执行 Workspace 快照
- `bootstrap_policy_snapshot`: 创建 Run 时固化的准备策略，避免排队期间配置漂移
- `agent_profile_snapshot`: 创建 Run 时固化的完整非敏感 AgentProfile；Worker 只执行该快照，不读取可变 Profile 当前值。公有 Task detail 仅返回名称、Adapter、模型标签和能力摘要，不返回运行配置 JSON
- `worktree_path`, `working_directory`, `branch_name`: 隔离执行与人工检查入口

重试创建新行，而不是把失败行改回 queued。

### `run_events`

这是执行时间线的持久事实：

- `id bigint generated always as identity`
- `run_id`
- `event_type`
- `schema_version`
- `payload jsonb`
- `source`: `api`、`worker`、`agent`、`user`
- `occurred_at`
- `dedupe_key`

唯一约束 `(run_id, dedupe_key)` 防止 Worker 重发导致重复事件。

### `handoffs`

- `source_run_id`
- `target_agent_id`
- `objective`
- `context_summary`
- `artifact_refs jsonb`
- `acceptance_criteria jsonb`
- `target_run_id`
- `status`

`source_run_id` 唯一，当前一个 Builder Run 最多产生一个 Handoff。`pending` 表示交接事实已保存但 Builder 尚未完成；`dispatched` 表示 Reviewer 子 Run 与 Outbox 已在同一事务中创建，不表示 Review 已通过。

### `outbox_events`

- 与 Task、Run 和首个 Event 在同一 PostgreSQL 事务写入。
- `event_type = run.queued`，payload 只保存通过 Zod 校验的 `runId`。
- Publisher 成功写入 BullMQ 后标记 `published`；失败保留 `last_error`、`attempts` 与下次可用时间。
- BullMQ `jobId` 使用 Outbox ID，使“已投递但尚未标记 published”后的重试仍可去重。

### `reviews` 与 `review_findings`

Review 保存总体结论和摘要；Finding 保存：

- `severity`: `blocking`、`should_fix`、`suggestion`
- `file_path`, `line_start`, `line_end`
- `title`, `detail`, `suggestion`

## HTTP API

### 协作线程

```http
GET    /api/threads
POST   /api/threads
GET    /api/threads/:threadId
POST   /api/threads/:threadId/messages
```

第一切片的 `POST /messages` 显式携带 `agentId`，等价于 UI 中选择 `@Agent`。自然语言 mention 解析、Agent 主动 mention 和 multi-mention 留给后续切片；平台不会直接用未经校验的文本修改 Task 状态。

### Workspace 与 Agent

```http
POST   /api/workspaces
GET    /api/workspaces/:workspaceId
POST   /api/workspaces/:workspaceId/agents
GET    /api/workspaces/:workspaceId/agents
POST   /api/agents/:agentId/health-check
PUT    /api/provider-connections/:connectionId
POST   /api/provider-connections/:connectionId/health-check
PUT    /api/agents/:agentId
GET    /api/agent-runtimes
GET    /api/agent-runtimes/opencode
```

创建和更新 AgentProfile 使用同一份完整配置 schema。`GET /api/agent-runtimes` 统一返回 Mock、Codex CLI 和 OpenCode CLI 的可用性、版本与可选模型目录；OpenCode 专属 endpoint 保留兼容。`POST /api/agents/:agentId/health-check` 只做无计费的 CLI/目录检测，不启动 Run。

ProviderConnection 更新使用完整配置 schema，且 `kind` / `adapterType` 不可变。服务端拒绝停用仍被启用 Agent 引用的连接，也拒绝从自定义目录移除启用 Agent 正在使用的模型。连接健康检测默认 `mode=configuration`，检查 CLI、Worker 凭证环境变量和模型目录；只有 `mode=live` 才发送固定测试文本并可能产生 provider 用量，当前只对自定义 OpenCode 连接开放。

### Task 与 Run

```http
POST   /api/workspaces/:workspaceId/tasks
GET    /api/tasks/:taskId
GET    /api/tasks/:taskId/events?after=:eventId
POST   /api/tasks/:taskId/cancel
POST   /api/tasks/:taskId/confirm
POST   /api/runs/:runId/retry
POST   /api/runs/:runId/cancel
GET    /api/workspaces
PATCH  /api/workspaces/:workspaceId
GET    /api/workspaces/:workspaceId/agents
```

创建、取消和重试命令要求 `Idempotency-Key` 请求头。

### Worker 内部接口

```http
POST   /internal/runs/:runId/claim
POST   /internal/runs/:runId/heartbeat
POST   /internal/runs/:runId/events
POST   /internal/runs/:runId/outcome
POST   /internal/runs/:runId/handoffs
POST   /internal/runs/:runId/reviews
```

内部接口使用单次 Run token，服务端根据 token 解析 run、agent 和 workspace，不接受客户端自行声明这些身份。

Phase 2.7 当前实现的最小闭环为：

```http
POST /internal/runs/:runId/claim
  -> { claimed: ClaimedRun, executionToken: string, lease: { expiresAt, heartbeatIntervalMs } }

POST /internal/runs/:runId/heartbeat
GET  /internal/runs/:runId/control
POST /internal/runs/:runId/events
Authorization: Bearer rht_<opaque-random-token>
```

claim 只在 `queued -> claimed` 的原子更新成功时返回一次明文 Token，并写入默认 30 秒 Lease。Worker 按 claim 响应中的周期调用 Heartbeat；Heartbeat 只延长尚未过期且 Token 匹配的当前执行。heartbeat/control/event 根据 URL 中的 Run ID 查询该 Run 的哈希，再校验 Token、Token TTL、撤销时间、Lease 和非终态状态；不接受请求体自报 agentId、taskId 或 workspaceId。缺失、错误、过期、跨 Run、Lease 丢失或已撤销凭证统一返回 `401 invalid_run_token`。claim 自身的 Worker 身份认证尚未实现，当前仍位于单机内部信任边界。

Phase 3.1 中 `handoff.requested` 继续通过受 Run Token 保护的 event 接口提交，不新增旁路 Handoff API。服务端要求目标 ID 与 Task 的 `reviewer_agent_id` 一致、目标 AgentProfile 启用且具有 `review` capability，并拒绝 Builder 把工作交给自己。Reviewer Run 通过既有 claim 接口获得持久化 Handoff；Queue job 仍只携带 `runId`。

Phase 3.2 中 `review.submitted` 继续复用同一个受 Token 保护的 event 接口。只有 `trigger_type=review` 且 AgentProfile 与 Task `reviewer_agent_id` 一致的 Run 可以提交；每个 Reviewer Run 只能保存一个 Review，同一 Task 的 round 唯一。`approved` 不能包含 blocking/should_fix Finding，`changes_requested` 至少包含一条 actionable Finding，`blocked` 至少包含一条 blocking Finding。Reviewer 必须先提交 Review，再提交 `run.completed`。

Phase 3.3 中 Reviewer `run.completed` 读取 `changes_requested` Review 后，在同一事务中创建新的 `trigger_type=retry` Builder Run、Outbox 和审计事件。返工 Run 通过 `parent_run_id=来源 Reviewer Run`、`retry_of_run_id=上一轮 Builder Run` 保存双重因果关系，并继承上一轮 Worktree。Worker claim 会把来源 Review 与 Findings 作为结构化上下文返回，Queue job 仍只包含 `runId`。达到 `max_review_rounds` 时不再创建 Run，Task 转入 `waiting_for_user`。

## 统一 Agent 事件

```ts
type AgentEvent =
  | { type: 'run.prepared'; worktreePath: string; workingDirectory: string; branchName: string }
  | { type: 'run.bootstrap_started'; stepCount: number }
  | { type: 'run.bootstrap_step_completed'; stepIndex: number; name: string; command: string }
  | { type: 'run.bootstrap_completed'; stepCount: number; durationMs: number }
  | { type: 'run.bootstrap_failed'; stepIndex: number; code: BootstrapFailureCode; message: string }
  | { type: 'run.started'; sessionRef?: string }
  | { type: 'output.delta'; text: string }
  | { type: 'tool.called'; callId: string; name: string; inputSummary: unknown }
  | { type: 'tool.completed'; callId: string; outputSummary?: unknown }
  | { type: 'handoff.requested'; handoff: HandoffDraft }
  | { type: 'review.submitted'; review: ReviewDraft }
  | { type: 'run.completed'; outcome: RunOutcome }
  | { type: 'run.cancelled'; reason?: string }
  | { type: 'run.failed'; code: FailureCode; message: string };
```

Adapter 事件先经过 Zod 校验，再进入平台。无法识别的供应商事件可记录为诊断数据，但不能直接推进业务状态。

Workspace Bootstrap 在 `run.prepared` 与 `run.started` 之间产生 `run.bootstrap_started`、`run.bootstrap_step_completed`、`run.bootstrap_completed` 或 `run.bootstrap_failed`。失败后紧接 `run.failed(code=bootstrap_failed)`；因此“环境准备失败”和“Agent 执行或测试失败”具有不同机器语义。

`RunOutcome` 当前包含执行摘要和命令证据（命令、退出码、状态和受限输出摘要）。它属于 Run 的执行事实；即使命令失败后 Agent 协议正常结束，Run 仍可以是 `succeeded`，但 Task 不能因此自动变成 `completed`。验收结论必须由后续 Reviewer verdict、CompletionPolicy 或人工裁决产生。

Builder 的 `handoff.requested` 必须发生在 `run.completed` 之前。前者只创建 pending Handoff，不改变 Task owner 或创建子 Run；后者成功时才由 Orchestrator 在同一事务中创建 Reviewer Run、写 Outbox、把 Handoff 标记为 dispatched，并将 Task 切换为 reviewing。Reviewer 完成不会递归创建另一个 Reviewer。

Reviewer 的 `review.submitted` 同样先保存事实而不立即结束 Run。Reviewer `run.completed` 事务读取已保存 Review，并根据 verdict、CompletionPolicy 和 Review 轮次预算原子推进 Task。`changes_requested` 在预算内自动创建返工 Builder Run；返工 Builder 必须再次提交 Handoff，平台才创建下一轮 Reviewer Run。`POST /api/tasks/:taskId/confirm` 只接受处于 `waiting_for_user` 且最新 Review 为 `approved` 的 Task；重复确认已完成 Task 是幂等读取。

## WebSocket 事件

服务端事件统一使用 envelope：

```ts
interface RealtimeEnvelope<T> {
  eventId: number;
  workspaceId: string;
  taskId: string;
  runId?: string;
  type: string;
  occurredAt: string;
  data: T;
}
```

首版需要：

- `task.updated`
- `run.updated`
- `run.output.delta`
- `run.tool.called`
- `handoff.created`
- `review.submitted`
- `system.warning`

## 状态迁移接口约束

应用层只暴露语义方法，不允许调用方直接赋值状态：

```ts
claimRun(runId, workerId)
markRunStarted(runId, sessionRef)
requestCancellation(runId, actor)
completeRun(runId, outcome)
failRun(runId, failure)
createHandoff(sourceRunId, draft)
submitReview(runId, review)
```

每个方法完成四件事：校验当前状态、执行业务写入、追加审计事件、写 Outbox。
