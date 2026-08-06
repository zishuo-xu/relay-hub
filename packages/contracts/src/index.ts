import { z } from 'zod';

export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_MOCK_AGENT_ID = '00000000-0000-4000-8000-000000000002';
export const DEFAULT_CODEX_AGENT_ID = '00000000-0000-4000-8000-000000000003';
export const RUN_QUEUE_NAME = 'relay-hub-runs';

export const AGENT_ADAPTER_TYPES = ['mock', 'codex_cli'] as const;
export type AgentAdapterType = (typeof AGENT_ADAPTER_TYPES)[number];

export const TASK_STATUSES = [
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
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RUN_STATUSES = [
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
export type RunStatus = (typeof RUN_STATUSES)[number];

export const COMPLETION_POLICIES = [
  'auto_on_approval',
  'require_user_confirmation',
  'risk_based',
] as const;
export type CompletionPolicy = (typeof COMPLETION_POLICIES)[number];

const taskTransitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  draft: ['queued', 'cancelled'],
  queued: ['running', 'cancelled', 'failed'],
  running: ['reviewing', 'waiting_for_user', 'completed', 'failed', 'cancelled'],
  reviewing: ['changes_requested', 'waiting_for_user', 'completed', 'failed', 'cancelled'],
  changes_requested: ['queued', 'cancelled'],
  waiting_for_user: ['queued', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const runTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['claimed', 'cancelled'],
  claimed: ['starting', 'running', 'failed', 'cancelling', 'cancelled', 'lost'],
  starting: ['running', 'failed', 'cancelling', 'lost'],
  running: ['succeeded', 'failed', 'cancelling', 'lost'],
  succeeded: [],
  failed: [],
  cancelling: ['cancelled', 'failed', 'lost'],
  cancelled: [],
  lost: [],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return taskTransitions[from].includes(to);
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return runTransitions[from].includes(to);
}

export const CreateTaskInputSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(1).max(10_000),
  agentId: z.string().uuid().default(DEFAULT_MOCK_AGENT_ID),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  completionPolicy: z.enum(COMPLETION_POLICIES).default('require_user_confirmation'),
});

export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const CommandEvidenceSchema = z.object({
  command: z.string().min(1).max(4_000),
  status: z.enum(['succeeded', 'failed', 'unknown']),
  exitCode: z.number().int().optional(),
  outputSummary: z.string().max(2_000).optional(),
});

export type CommandEvidence = z.infer<typeof CommandEvidenceSchema>;

export const RunOutcomeSchema = z.object({
  summary: z.string().min(1).max(10_000),
  commandEvidence: z.array(CommandEvidenceSchema).max(100).default([]),
});

export type RunOutcome = z.infer<typeof RunOutcomeSchema>;

const HandoffDraftSchema = z.object({
  targetAgentId: z.string().min(1),
  summary: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).default([]),
});

const ReviewDraftSchema = z.object({
  verdict: z.enum(['approved', 'changes_requested', 'blocked']),
  summary: z.string().min(1),
});

export const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('run.prepared'),
    worktreePath: z.string().min(1),
    workingDirectory: z.string().min(1),
    branchName: z.string().min(1),
  }),
  z.object({ type: z.literal('run.started'), sessionRef: z.string().optional() }),
  z.object({ type: z.literal('output.delta'), text: z.string() }),
  z.object({
    type: z.literal('tool.called'),
    callId: z.string().min(1),
    name: z.string().min(1),
    inputSummary: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('tool.completed'),
    callId: z.string().min(1),
    outputSummary: z.unknown().optional(),
  }),
  z.object({ type: z.literal('handoff.requested'), handoff: HandoffDraftSchema }),
  z.object({ type: z.literal('review.submitted'), review: ReviewDraftSchema }),
  z.object({ type: z.literal('run.completed'), outcome: RunOutcomeSchema }),
  z.object({ type: z.literal('run.cancelled'), reason: z.string().optional() }),
  z.object({
    type: z.literal('run.failed'),
    code: z.enum(['spawn_failed', 'protocol_error', 'timeout', 'process_exit', 'unknown']),
    message: z.string().min(1),
  }),
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;

export interface Task {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  agentId: string;
  acceptanceCriteria: string[];
  completionPolicy: CompletionPolicy;
  status: TaskStatus;
  currentRunId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  defaultCompletionPolicy: CompletionPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfile {
  id: string;
  workspaceId: string;
  name: string;
  adapterType: AgentAdapterType;
  provider?: string;
  modelLabel?: string;
  modelFamily?: string;
  capabilities: string[];
  enabled: boolean;
}

export interface Run {
  id: string;
  taskId: string;
  agentId: string;
  status: RunStatus;
  attempt: number;
  triggerType: 'user' | 'handoff' | 'review' | 'retry';
  parentRunId?: string;
  retryOfRunId?: string;
  workspaceRoot: string;
  worktreePath?: string;
  workingDirectory?: string;
  branchName?: string;
  workerId?: string;
  sessionRef?: string;
  failureCode?: string;
  failureDetail?: string;
  outcome?: RunOutcome;
  version: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface RunEvent {
  id: number;
  taskId: string;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  source: 'api' | 'worker' | 'agent' | 'user';
  occurredAt: string;
  dedupeKey: string;
}

export interface TaskDetail {
  task: Task;
  runs: Run[];
  events: RunEvent[];
}

export interface ClaimedRun {
  task: Task;
  run: Run;
  workspace: Workspace;
  agent: AgentProfile;
}

export interface RealtimeEnvelope {
  eventId: number;
  taskId: string;
  runId: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export const RunQueueJobSchema = z.object({
  runId: z.string().uuid(),
});
export type RunQueueJob = z.infer<typeof RunQueueJobSchema>;
