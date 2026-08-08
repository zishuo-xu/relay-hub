import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  AgentProfile,
  BootstrapPolicy,
  CompletionPolicy,
  HandoffArtifactRef,
  RunOutcome,
  RunStatus,
  TaskStatus,
} from '@relay-hub/contracts';

const TASK_STATUS_VALUES = [
  'draft',
  'queued',
  'running',
  'reviewing',
  'changes_requested',
  'waiting_for_user',
  'completed',
  'failed',
  'cancelled',
] as const;
const RUN_STATUS_VALUES = [
  'queued',
  'claimed',
  'starting',
  'running',
  'succeeded',
  'failed',
  'cancelling',
  'cancelled',
  'lost',
] as const;
const COMPLETION_POLICY_VALUES = [
  'auto_on_approval',
  'require_user_confirmation',
  'risk_based',
] as const;

export const taskStatusEnum = pgEnum('task_status', TASK_STATUS_VALUES);
export const runStatusEnum = pgEnum('run_status', RUN_STATUS_VALUES);
export const completionPolicyEnum = pgEnum('completion_policy', COMPLETION_POLICY_VALUES);
export const runTriggerEnum = pgEnum('run_trigger', ['user', 'handoff', 'review', 'retry']);
export const eventSourceEnum = pgEnum('event_source', ['api', 'worker', 'agent', 'user']);
export const handoffStatusEnum = pgEnum('handoff_status', [
  'pending',
  'accepted',
  'dispatched',
  'rejected',
  'cancelled',
  'expired',
]);
export const reviewVerdictEnum = pgEnum('review_verdict', ['approved', 'changes_requested', 'blocked']);
export const findingSeverityEnum = pgEnum('finding_severity', ['blocking', 'should_fix', 'suggestion']);
export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'published']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull(),
  bootstrapPolicy: jsonb('bootstrap_policy').$type<BootstrapPolicy>().default({ steps: [] }).notNull(),
  defaultCompletionPolicy: completionPolicyEnum('default_completion_policy')
    .$type<CompletionPolicy>()
    .default('require_user_confirmation')
    .notNull(),
  ...timestamps,
});

export const agentProfiles = pgTable(
  'agent_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    adapterType: text('adapter_type').notNull(),
    provider: text('provider'),
    modelLabel: text('model_label'),
    modelFamily: text('model_family'),
    capabilities: jsonb('capabilities').$type<string[]>().default([]).notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().default({}).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('agent_profiles_workspace_name_uidx').on(table.workspaceId, table.name)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    title: text('title').notNull(),
    description: text('description').notNull(),
    acceptanceCriteria: jsonb('acceptance_criteria').$type<string[]>().default([]).notNull(),
    status: taskStatusEnum('status').$type<TaskStatus>().default('draft').notNull(),
    completionPolicy: completionPolicyEnum('completion_policy')
      .$type<CompletionPolicy>()
      .default('require_user_confirmation')
      .notNull(),
    currentRunId: uuid('current_run_id').references((): AnyPgColumn => runs.id),
    builderAgentId: uuid('builder_agent_id').references(() => agentProfiles.id),
    reviewerAgentId: uuid('reviewer_agent_id').references(() => agentProfiles.id),
    maxReviewRounds: integer('max_review_rounds').default(3).notNull(),
    requestedBy: text('requested_by').default('local-operator').notNull(),
    version: integer('version').default(1).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('tasks_workspace_created_idx').on(table.workspaceId, table.createdAt)],
);

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agentProfiles.id),
    parentRunId: uuid('parent_run_id').references((): AnyPgColumn => runs.id),
    retryOfRunId: uuid('retry_of_run_id').references((): AnyPgColumn => runs.id),
    triggerType: runTriggerEnum('trigger_type').default('user').notNull(),
    status: runStatusEnum('status').$type<RunStatus>().default('queued').notNull(),
    attempt: integer('attempt').default(1).notNull(),
    workspaceRoot: text('workspace_root').default('').notNull(),
    bootstrapPolicySnapshot: jsonb('bootstrap_policy_snapshot')
      .$type<BootstrapPolicy>()
      .default({ steps: [] })
      .notNull(),
    agentProfileSnapshot: jsonb('agent_profile_snapshot').$type<AgentProfile>().notNull(),
    worktreePath: text('worktree_path'),
    workingDirectory: text('working_directory'),
    branchName: text('branch_name'),
    workerId: text('worker_id'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    executionTokenHash: text('execution_token_hash'),
    tokenIssuedAt: timestamp('token_issued_at', { withTimezone: true }),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    tokenRevokedAt: timestamp('token_revoked_at', { withTimezone: true }),
    sessionRef: text('session_ref'),
    failureCode: text('failure_code'),
    failureDetail: text('failure_detail'),
    outcome: jsonb('outcome').$type<RunOutcome>(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('runs_task_created_idx').on(table.taskId, table.createdAt),
    index('runs_status_created_idx').on(table.status, table.createdAt),
  ],
);

export const runEvents = pgTable(
  'run_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    eventType: text('event_type').notNull(),
    schemaVersion: integer('schema_version').default(1).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}).notNull(),
    source: eventSourceEnum('source').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    dedupeKey: text('dedupe_key').notNull(),
  },
  (table) => [
    uniqueIndex('run_events_run_dedupe_uidx').on(table.runId, table.dedupeKey),
    index('run_events_task_id_idx').on(table.taskId, table.id),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('idempotency_keys_scope_key_uidx').on(table.scope, table.key)],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: outboxStatusEnum('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('outbox_pending_idx').on(table.status, table.availableAt, table.createdAt)],
);

export const handoffs = pgTable(
  'handoffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRunId: uuid('source_run_id')
      .notNull()
      .references(() => runs.id),
    targetAgentId: uuid('target_agent_id')
      .notNull()
      .references(() => agentProfiles.id),
    targetRunId: uuid('target_run_id').references(() => runs.id),
    objective: text('objective').notNull(),
    contextSummary: text('context_summary').notNull(),
    artifactRefs: jsonb('artifact_refs').$type<HandoffArtifactRef[]>().default([]).notNull(),
    acceptanceCriteria: jsonb('acceptance_criteria').$type<string[]>().default([]).notNull(),
    status: handoffStatusEnum('status').default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('handoffs_source_run_uidx').on(table.sourceRunId)],
);

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    round: integer('round').default(1).notNull(),
    verdict: reviewVerdictEnum('verdict').notNull(),
    summary: text('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('reviews_run_uidx').on(table.runId),
    uniqueIndex('reviews_task_round_uidx').on(table.taskId, table.round),
  ],
);

export const reviewFindings = pgTable('review_findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id),
  severity: findingSeverityEnum('severity').notNull(),
  filePath: text('file_path'),
  lineStart: integer('line_start'),
  lineEnd: integer('line_end'),
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  suggestion: text('suggestion'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
