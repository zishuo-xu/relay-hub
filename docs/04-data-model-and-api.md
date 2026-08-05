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
| `created_at`, `updated_at` | 审计时间 |

### `agent_profiles`

| 字段 | 说明 |
|---|---|
| `adapter_type` | `mock`、`codex_cli` 或 `claude_cli` |
| `model_label` | 仅作展示与诊断，不参与安全判断 |
| `capabilities` | 例如 `implement`、`review`、`research` |
| `config` | 非敏感配置；密钥只保存环境变量引用名 |
| `enabled` | 停用后不能创建新 Run |

约束：同一 Workspace 内 Agent 名称唯一。

### `tasks`

除基本字段外保存：

- `acceptance_criteria jsonb`
- `requested_by`
- `current_run_id`
- `version`
- `completed_at`

状态由数据库 check constraint 限制在枚举集合内。

### `runs`

关键字段：

- `task_id`, `agent_id`, `parent_run_id`
- `trigger_type`: `user`、`handoff`、`review`、`retry`
- `status`, `attempt`, `version`
- `worker_id`, `lease_expires_at`
- `session_ref`: Adapter 的可恢复会话标识
- `failure_code`, `failure_detail`
- `started_at`, `finished_at`
- `workspace_root`: 创建 Run 时固化的执行 Workspace 快照
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
- `summary`
- `artifact_refs jsonb`
- `acceptance_criteria jsonb`
- `target_run_id`
- `status`

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

### Workspace 与 Agent

```http
POST   /api/workspaces
GET    /api/workspaces/:workspaceId
POST   /api/workspaces/:workspaceId/agents
GET    /api/workspaces/:workspaceId/agents
POST   /api/agents/:agentId/health-check
PATCH  /api/agents/:agentId
```

### Task 与 Run

```http
POST   /api/workspaces/:workspaceId/tasks
GET    /api/tasks/:taskId
GET    /api/tasks/:taskId/events?after=:eventId
POST   /api/tasks/:taskId/cancel
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

## 统一 Agent 事件

```ts
type AgentEvent =
  | { type: 'run.prepared'; worktreePath: string; workingDirectory: string; branchName: string }
  | { type: 'run.started'; sessionRef?: string }
  | { type: 'output.delta'; text: string }
  | { type: 'tool.called'; callId: string; name: string; inputSummary: unknown }
  | { type: 'tool.completed'; callId: string; outputSummary?: unknown }
  | { type: 'handoff.requested'; handoff: HandoffDraft }
  | { type: 'review.submitted'; review: ReviewDraft }
  | { type: 'run.completed'; summary?: string }
  | { type: 'run.cancelled'; reason?: string }
  | { type: 'run.failed'; code: FailureCode; message: string };
```

Adapter 事件先经过 Zod 校验，再进入平台。无法识别的供应商事件可记录为诊断数据，但不能直接推进业务状态。

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
