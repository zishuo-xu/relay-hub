import { randomUUID } from 'node:crypto';
import {
  type AgentEvent,
  type AgentAdapterType,
  type AgentProfile,
  type BootstrapPolicy,
  canTransitionRun,
  canTransitionTask,
  type ClaimedRun,
  type CreateTaskInput,
  DEFAULT_WORKSPACE_ID,
  type Run,
  type RunEvent,
  type RunStatus,
  type Task,
  type TaskDetail,
  type TaskStatus,
  type Workspace,
} from '@relay-hub/contracts';
import {
  agentProfiles,
  idempotencyKeys,
  outboxEvents,
  runEvents,
  runs,
  tasks,
  workspaces,
  type RelayDatabase,
} from '@relay-hub/db';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { planAfterSuccessfulRun } from './workflow-orchestrator.js';

interface MutationResult<T> {
  value: T;
  emitted: RunEvent[];
}

type TaskRow = typeof tasks.$inferSelect;
type RunRow = typeof runs.$inferSelect;
type RunEventRow = typeof runEvents.$inferSelect;
type WorkspaceRow = typeof workspaces.$inferSelect;
type AgentProfileRow = typeof agentProfiles.$inferSelect;

function toIso(value: Date): string {
  return value.toISOString();
}

function mapTask(row: TaskRow, agentId: string): Task {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    description: row.description,
    agentId,
    acceptanceCriteria: row.acceptanceCriteria,
    completionPolicy: row.completionPolicy,
    status: row.status,
    currentRunId: row.currentRunId ?? '',
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function mapRun(row: RunRow): Run {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    status: row.status,
    attempt: row.attempt,
    triggerType: row.triggerType,
    workspaceRoot: row.workspaceRoot,
    bootstrapPolicySnapshot: row.bootstrapPolicySnapshot,
    version: row.version,
    createdAt: toIso(row.createdAt),
    ...(row.parentRunId ? { parentRunId: row.parentRunId } : {}),
    ...(row.retryOfRunId ? { retryOfRunId: row.retryOfRunId } : {}),
    ...(row.worktreePath ? { worktreePath: row.worktreePath } : {}),
    ...(row.workingDirectory ? { workingDirectory: row.workingDirectory } : {}),
    ...(row.branchName ? { branchName: row.branchName } : {}),
    ...(row.workerId ? { workerId: row.workerId } : {}),
    ...(row.sessionRef ? { sessionRef: row.sessionRef } : {}),
    ...(row.failureCode ? { failureCode: row.failureCode } : {}),
    ...(row.failureDetail ? { failureDetail: row.failureDetail } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.startedAt ? { startedAt: toIso(row.startedAt) } : {}),
    ...(row.finishedAt ? { finishedAt: toIso(row.finishedAt) } : {}),
  };
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.rootPath,
    bootstrapPolicy: row.bootstrapPolicy,
    defaultCompletionPolicy: row.defaultCompletionPolicy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function mapAgentProfile(row: AgentProfileRow): AgentProfile {
  if (row.adapterType !== 'mock' && row.adapterType !== 'codex_cli') {
    throw new Error(`Unsupported adapter type: ${row.adapterType}`);
  }
  const adapterType: AgentAdapterType = row.adapterType;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    adapterType,
    capabilities: row.capabilities,
    enabled: row.enabled,
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.modelLabel ? { modelLabel: row.modelLabel } : {}),
    ...(row.modelFamily ? { modelFamily: row.modelFamily } : {}),
  };
}

function mapEvent(row: RunEventRow): RunEvent {
  return {
    id: row.id,
    taskId: row.taskId,
    runId: row.runId,
    type: row.eventType,
    payload: row.payload,
    source: row.source,
    occurredAt: toIso(row.occurredAt),
    dedupeKey: row.dedupeKey,
  };
}

export class PostgresStore {
  constructor(private readonly db: RelayDatabase) {}

  async listTasks(): Promise<Task[]> {
    const rows = await this.db
      .select({ task: tasks, agentId: runs.agentId })
      .from(tasks)
      .leftJoin(runs, eq(tasks.currentRunId, runs.id))
      .orderBy(desc(tasks.createdAt));
    return rows.map(({ task, agentId }) => mapTask(task, agentId ?? ''));
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const rows = await this.db.select().from(workspaces).orderBy(asc(workspaces.createdAt));
    return rows.map(mapWorkspace);
  }

  async updateWorkspace(
    workspaceId: string,
    patch: { rootPath?: string; bootstrapPolicy?: BootstrapPolicy },
  ): Promise<Workspace | null> {
    const [row] = await this.db
      .update(workspaces)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    return row ? mapWorkspace(row) : null;
  }

  async listAgentProfiles(workspaceId: string): Promise<AgentProfile[]> {
    const rows = await this.db
      .select()
      .from(agentProfiles)
      .where(eq(agentProfiles.workspaceId, workspaceId))
      .orderBy(asc(agentProfiles.createdAt));
    return rows.map(mapAgentProfile);
  }

  async getTaskDetail(taskId: string): Promise<TaskDetail | null> {
    const [taskRow] = await this.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!taskRow) return null;
    const runRows = await this.db.select().from(runs).where(eq(runs.taskId, taskId)).orderBy(asc(runs.createdAt));
    const eventRows = await this.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.taskId, taskId))
      .orderBy(asc(runEvents.id));
    const currentRun = runRows.find((run) => run.id === taskRow.currentRunId) ?? runRows[0];
    return {
      task: mapTask(taskRow, currentRun?.agentId ?? ''),
      runs: runRows.map(mapRun),
      events: eventRows.map(mapEvent),
    };
  }

  async getTaskEvents(taskId: string, afterEventId: number): Promise<RunEvent[]> {
    const rows = await this.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.taskId, taskId), gt(runEvents.id, afterEventId)))
      .orderBy(asc(runEvents.id));
    return rows.map(mapEvent);
  }

  async createTask(
    input: CreateTaskInput,
    idempotencyKey?: string,
  ): Promise<MutationResult<{ detail: TaskDetail; created: boolean }>> {
    const taskId = randomUUID();
    const runId = randomUUID();
    const result = await this.db.transaction(async (tx) => {
      if (idempotencyKey) {
        const reserved = await tx
          .insert(idempotencyKeys)
          .values({ scope: 'task.create', key: idempotencyKey, resourceType: 'task', resourceId: taskId })
          .onConflictDoNothing()
          .returning({ resourceId: idempotencyKeys.resourceId });
        if (reserved.length === 0) {
          const [existing] = await tx
            .select({ resourceId: idempotencyKeys.resourceId })
            .from(idempotencyKeys)
            .where(and(eq(idempotencyKeys.scope, 'task.create'), eq(idempotencyKeys.key, idempotencyKey)))
            .limit(1);
          if (!existing) throw new Error('Idempotency reservation disappeared');
          return { taskId: existing.resourceId, created: false, emitted: [] as RunEvent[] };
        }
      }

      const [agent] = await tx
        .select({ id: agentProfiles.id, enabled: agentProfiles.enabled })
        .from(agentProfiles)
        .where(and(eq(agentProfiles.id, input.agentId), eq(agentProfiles.workspaceId, DEFAULT_WORKSPACE_ID)))
        .limit(1);
      if (!agent?.enabled) throw new Error(`Agent is missing or disabled: ${input.agentId}`);
      const [workspace] = await tx
        .select({ rootPath: workspaces.rootPath, bootstrapPolicy: workspaces.bootstrapPolicy })
        .from(workspaces)
        .where(eq(workspaces.id, DEFAULT_WORKSPACE_ID))
        .limit(1);
      if (!workspace?.rootPath) throw new Error('Default workspace root is not configured');

      const now = new Date();
      await tx.insert(tasks).values({
        id: taskId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        title: input.title,
        description: input.description,
        acceptanceCriteria: input.acceptanceCriteria,
        completionPolicy: input.completionPolicy,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(runs).values({
        id: runId,
        taskId,
        agentId: input.agentId,
        status: 'queued',
        triggerType: 'user',
        workspaceRoot: workspace.rootPath,
        bootstrapPolicySnapshot: workspace.bootstrapPolicy,
        createdAt: now,
      });
      await tx.update(tasks).set({ currentRunId: runId }).where(eq(tasks.id, taskId));
      const [eventRow] = await tx
        .insert(runEvents)
        .values({
          taskId,
          runId,
          eventType: 'task.created',
          payload: { title: input.title, agentId: input.agentId },
          source: 'user',
          occurredAt: now,
          dedupeKey: `task-created:${taskId}`,
        })
        .returning();
      await tx.insert(outboxEvents).values({
        aggregateType: 'run',
        aggregateId: runId,
        eventType: 'run.queued',
        payload: { runId },
      });
      if (!eventRow) throw new Error('Task event insert did not return a row');
      return { taskId, created: true, emitted: [mapEvent(eventRow)] };
    });

    const detail = await this.getTaskDetail(result.taskId);
    if (!detail) throw new Error(`Created task not found: ${result.taskId}`);
    return { value: { detail, created: result.created }, emitted: result.emitted };
  }

  async claimRun(runId: string, workerId: string): Promise<MutationResult<ClaimedRun | null>> {
    const result = await this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(runs)
        .set({
          status: 'claimed',
          workerId,
          version: sql`${runs.version} + 1`,
        })
        .where(and(eq(runs.id, runId), eq(runs.status, 'queued')))
        .returning();
      if (!claimed) return { claimed: null, emitted: [] as RunEvent[] };
      const [taskRow] = await tx.select().from(tasks).where(eq(tasks.id, claimed.taskId)).limit(1);
      if (!taskRow) throw new Error(`Task not found for run: ${runId}`);
      const [workspaceRow] = await tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, taskRow.workspaceId))
        .limit(1);
      if (!workspaceRow) throw new Error(`Workspace not found for run: ${runId}`);
      const [agentRow] = await tx
        .select()
        .from(agentProfiles)
        .where(eq(agentProfiles.id, claimed.agentId))
        .limit(1);
      if (!agentRow) throw new Error(`Agent profile not found for run: ${runId}`);
      const [eventRow] = await tx
        .insert(runEvents)
        .values({
          taskId: claimed.taskId,
          runId: claimed.id,
          eventType: 'run.claimed',
          payload: { workerId },
          source: 'worker',
          dedupeKey: `run-claimed:${claimed.id}`,
        })
        .returning();
      if (!eventRow) throw new Error('Claim event insert did not return a row');
      return {
        claimed: {
          task: mapTask(taskRow, claimed.agentId),
          run: mapRun(claimed),
          workspace: mapWorkspace(workspaceRow),
          agent: mapAgentProfile(agentRow),
        },
        emitted: [mapEvent(eventRow)],
      };
    });
    return { value: result.claimed, emitted: result.emitted };
  }

  async getRunStatus(runId: string): Promise<RunStatus | null> {
    const [row] = await this.db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId)).limit(1);
    return row?.status ?? null;
  }

  async requestRunCancellation(runId: string): Promise<MutationResult<TaskDetail>> {
    const result = await this.db.transaction(async (tx) => {
      const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).limit(1);
      if (!run) throw new Error(`Run not found: ${runId}`);
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, run.taskId)).limit(1);
      if (!task) throw new Error(`Task not found: ${run.taskId}`);

      if (run.status === 'cancelling') return { taskId: task.id, emitted: [] as RunEvent[] };
      if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'lost') {
        throw new Error(`Cannot cancel terminal run: ${run.status}`);
      }

      const now = new Date();
      const nextRunStatus: RunStatus = run.status === 'queued' ? 'cancelled' : 'cancelling';
      this.assertRunTransition(run.status, nextRunStatus);
      await tx
        .update(runs)
        .set({
          status: nextRunStatus,
          version: run.version + 1,
          ...(nextRunStatus === 'cancelled' ? { finishedAt: now } : {}),
        })
        .where(and(eq(runs.id, run.id), eq(runs.version, run.version)));

      if (nextRunStatus === 'cancelled') {
        this.assertTaskTransition(task.status, 'cancelled');
        await tx
          .update(tasks)
          .set({ status: 'cancelled', version: task.version + 1, updatedAt: now })
          .where(and(eq(tasks.id, task.id), eq(tasks.version, task.version)));
      }

      const [eventRow] = await tx
        .insert(runEvents)
        .values({
          taskId: task.id,
          runId: run.id,
          eventType: 'run.cancellation_requested',
          payload: { previousStatus: run.status, nextStatus: nextRunStatus },
          source: 'user',
          occurredAt: now,
          dedupeKey: `run-cancellation-requested:${run.id}`,
        })
        .returning();
      if (!eventRow) throw new Error('Cancellation event insert did not return a row');
      return { taskId: task.id, emitted: [mapEvent(eventRow)] };
    });

    const detail = await this.getTaskDetail(result.taskId);
    if (!detail) throw new Error(`Task not found after cancellation: ${result.taskId}`);
    return { value: detail, emitted: result.emitted };
  }

  async recordAgentEvent(
    runId: string,
    dedupeKey: string,
    agentEvent: AgentEvent,
  ): Promise<MutationResult<TaskDetail>> {
    const result = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: runEvents.id, taskId: runEvents.taskId })
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), eq(runEvents.dedupeKey, dedupeKey)))
        .limit(1);
      if (existing) return { taskId: existing.taskId, emitted: [] as RunEvent[] };

      const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).limit(1);
      if (!run) throw new Error(`Run not found: ${runId}`);
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, run.taskId)).limit(1);
      if (!task) throw new Error(`Task not found: ${run.taskId}`);

      const now = new Date();
      let nextRunStatus: RunStatus | undefined;
      let nextTaskStatus: TaskStatus | undefined;
      let workflowEvent: { eventType: string; payload: Record<string, unknown>; dedupeKey: string } | undefined;
      const runPatch: Partial<typeof runs.$inferInsert> = {};
      const taskPatch: Partial<typeof tasks.$inferInsert> = {};

      switch (agentEvent.type) {
        case 'run.prepared':
          nextRunStatus = 'starting';
          runPatch.worktreePath = agentEvent.worktreePath;
          runPatch.workingDirectory = agentEvent.workingDirectory;
          runPatch.branchName = agentEvent.branchName;
          break;
        case 'run.started':
          nextRunStatus = 'running';
          if (task.status === 'queued') nextTaskStatus = 'running';
          runPatch.startedAt = now;
          if (agentEvent.sessionRef) runPatch.sessionRef = agentEvent.sessionRef;
          break;
        case 'run.bootstrap_started':
        case 'run.bootstrap_step_completed':
        case 'run.bootstrap_completed':
        case 'run.bootstrap_failed':
          if (run.status !== 'starting') {
            throw new Error(`Cannot append ${agentEvent.type} while run is ${run.status}`);
          }
          break;
        case 'run.completed':
          nextRunStatus = 'succeeded';
          {
            const plan = planAfterSuccessfulRun(false);
            nextTaskStatus = plan.nextTaskStatus;
            workflowEvent = {
              eventType: plan.eventType,
              payload: {
                reason: plan.reason,
                runId: run.id,
                completionPolicy: task.completionPolicy,
              },
              dedupeKey: `workflow-after-run:${run.id}`,
            };
          }
          runPatch.finishedAt = now;
          runPatch.outcome = agentEvent.outcome;
          break;
        case 'run.cancelled':
          nextRunStatus = 'cancelled';
          nextTaskStatus = 'cancelled';
          runPatch.finishedAt = now;
          break;
        case 'run.failed':
          nextRunStatus = 'failed';
          if (task.status === 'queued' || task.status === 'running') nextTaskStatus = 'failed';
          runPatch.failureCode = agentEvent.code;
          runPatch.failureDetail = agentEvent.message;
          runPatch.finishedAt = now;
          break;
        default:
          if (run.status !== 'running') {
            throw new Error(`Cannot append ${agentEvent.type} while run is ${run.status}`);
          }
      }

      if (nextRunStatus) {
        this.assertRunTransition(run.status, nextRunStatus);
        runPatch.status = nextRunStatus;
        runPatch.version = run.version + 1;
        await tx.update(runs).set(runPatch).where(and(eq(runs.id, run.id), eq(runs.version, run.version)));
      }
      if (nextTaskStatus) {
        this.assertTaskTransition(task.status, nextTaskStatus);
        taskPatch.status = nextTaskStatus;
        taskPatch.version = task.version + 1;
        taskPatch.updatedAt = now;
        await tx.update(tasks).set(taskPatch).where(and(eq(tasks.id, task.id), eq(tasks.version, task.version)));
      }

      const { type: eventType, ...payload } = agentEvent;
      const [eventRow] = await tx
        .insert(runEvents)
        .values({
          taskId: run.taskId,
          runId,
          eventType,
          payload,
          source: 'agent',
          occurredAt: now,
          dedupeKey,
        })
        .returning();
      if (!eventRow) throw new Error('Agent event insert did not return a row');
      const emitted = [mapEvent(eventRow)];
      if (workflowEvent) {
        const [workflowEventRow] = await tx
          .insert(runEvents)
          .values({
            taskId: run.taskId,
            runId,
            eventType: workflowEvent.eventType,
            payload: workflowEvent.payload,
            source: 'api',
            occurredAt: now,
            dedupeKey: workflowEvent.dedupeKey,
          })
          .returning();
        if (!workflowEventRow) throw new Error('Workflow event insert did not return a row');
        emitted.push(mapEvent(workflowEventRow));
      }
      return { taskId: run.taskId, emitted };
    });

    const detail = await this.getTaskDetail(result.taskId);
    if (!detail) throw new Error(`Task not found after event: ${result.taskId}`);
    return { value: detail, emitted: result.emitted };
  }

  private assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
    if (!canTransitionTask(from, to)) throw new Error(`Illegal task transition: ${from} -> ${to}`);
  }

  private assertRunTransition(from: RunStatus, to: RunStatus): void {
    if (!canTransitionRun(from, to)) throw new Error(`Illegal run transition: ${from} -> ${to}`);
  }
}
