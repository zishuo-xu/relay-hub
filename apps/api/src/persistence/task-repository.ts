import { randomUUID } from 'node:crypto';
import {
  type CreateTaskInput,
  DEFAULT_WORKSPACE_ID,
  type RunEvent,
  type Task,
  type TaskDetail,
} from '@relay-hub/contracts';
import {
  agentProfiles,
  handoffs,
  idempotencyKeys,
  outboxEvents,
  type RelayDatabase,
  reviewFindings,
  reviews,
  runEvents,
  runs,
  tasks,
  workspaces,
} from '@relay-hub/db';
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import { mapEvent, mapHandoff, mapReview, mapReviewFinding, mapRun, mapTask } from './mappers.js';
import type { MutationResult } from './types.js';

export async function listTasks(db: RelayDatabase): Promise<Task[]> {
  const rows = await db
    .select({ task: tasks, agentId: runs.agentId })
    .from(tasks)
    .leftJoin(runs, eq(tasks.currentRunId, runs.id))
    .orderBy(desc(tasks.createdAt));
  return rows.map(({ task, agentId }) => mapTask(task, agentId ?? ''));
}

export async function getTaskDetail(db: RelayDatabase, taskId: string): Promise<TaskDetail | null> {
  const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!taskRow) return null;
  const runRows = await db.select().from(runs).where(eq(runs.taskId, taskId)).orderBy(asc(runs.createdAt));
  const eventRows = await db
    .select()
    .from(runEvents)
    .where(eq(runEvents.taskId, taskId))
    .orderBy(asc(runEvents.id));
  const handoffRows = await db
    .select({ handoff: handoffs })
    .from(handoffs)
    .innerJoin(runs, eq(handoffs.sourceRunId, runs.id))
    .where(eq(runs.taskId, taskId))
    .orderBy(asc(handoffs.createdAt));
  const reviewRows = await db.select().from(reviews).where(eq(reviews.taskId, taskId)).orderBy(asc(reviews.round));
  const findingRows = reviewRows.length > 0
    ? await db
        .select()
        .from(reviewFindings)
        .where(inArray(reviewFindings.reviewId, reviewRows.map((review) => review.id)))
        .orderBy(asc(reviewFindings.createdAt))
    : [];
  const mappedFindings = findingRows.map(mapReviewFinding);
  const currentRun = runRows.find((run) => run.id === taskRow.currentRunId) ?? runRows[0];
  return {
    task: mapTask(taskRow, currentRun?.agentId ?? ''),
    runs: runRows.map(mapRun),
    events: eventRows.map(mapEvent),
    handoffs: handoffRows.map(({ handoff }) => mapHandoff(handoff)),
    reviews: reviewRows.map((review) => mapReview(
      review,
      mappedFindings.filter((finding) => finding.reviewId === review.id),
    )),
  };
}

export async function getTaskEvents(
  db: RelayDatabase,
  taskId: string,
  afterEventId: number,
): Promise<RunEvent[]> {
  const rows = await db
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.taskId, taskId), gt(runEvents.id, afterEventId)))
    .orderBy(asc(runEvents.id));
  return rows.map(mapEvent);
}

export async function createTask(
  db: RelayDatabase,
  input: CreateTaskInput,
  idempotencyKey?: string,
): Promise<MutationResult<{ detail: TaskDetail; created: boolean }>> {
  const taskId = randomUUID();
  const runId = randomUUID();
  const result = await db.transaction(async (tx) => {
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
      .select({ id: agentProfiles.id, enabled: agentProfiles.enabled, capabilities: agentProfiles.capabilities })
      .from(agentProfiles)
      .where(and(eq(agentProfiles.id, input.agentId), eq(agentProfiles.workspaceId, DEFAULT_WORKSPACE_ID)))
      .limit(1);
    if (!agent?.enabled || !agent.capabilities.includes('implement')) {
      throw new Error(`Builder is missing, disabled, or lacks implement capability: ${input.agentId}`);
    }
    if (input.reviewerAgentId) {
      if (input.reviewerAgentId === input.agentId) throw new Error('Builder and Reviewer AgentProfile must be different');
      const [reviewer] = await tx
        .select({ enabled: agentProfiles.enabled, capabilities: agentProfiles.capabilities })
        .from(agentProfiles)
        .where(
          and(
            eq(agentProfiles.id, input.reviewerAgentId),
            eq(agentProfiles.workspaceId, DEFAULT_WORKSPACE_ID),
          ),
        )
        .limit(1);
      if (!reviewer?.enabled || !reviewer.capabilities.includes('review')) {
        throw new Error(`Reviewer is missing, disabled, or lacks review capability: ${input.reviewerAgentId}`);
      }
    }
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
      maxReviewRounds: input.maxReviewRounds,
      builderAgentId: input.agentId,
      reviewerAgentId: input.reviewerAgentId,
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
        payload: {
          title: input.title,
          agentId: input.agentId,
          maxReviewRounds: input.maxReviewRounds,
          ...(input.reviewerAgentId ? { reviewerAgentId: input.reviewerAgentId } : {}),
        },
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

  const detail = await getTaskDetail(db, result.taskId);
  if (!detail) throw new Error(`Created task not found: ${result.taskId}`);
  return { value: { detail, created: result.created }, emitted: result.emitted };
}

export async function confirmTaskCompletion(
  db: RelayDatabase,
  taskId: string,
): Promise<MutationResult<TaskDetail>> {
  const result = await db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status === 'completed') return { taskId, emitted: [] as RunEvent[] };
    if (task.status !== 'waiting_for_user') {
      throw new Error(`Task cannot be confirmed while ${task.status}`);
    }
    const [latestReview] = await tx
      .select({ id: reviews.id, runId: reviews.runId, verdict: reviews.verdict, round: reviews.round })
      .from(reviews)
      .where(eq(reviews.taskId, taskId))
      .orderBy(desc(reviews.round))
      .limit(1);
    if (!latestReview || latestReview.verdict !== 'approved') {
      throw new Error('Only a Task with an approved Review can be confirmed complete');
    }
    const [reviewRun] = await tx.select({ status: runs.status }).from(runs).where(eq(runs.id, latestReview.runId)).limit(1);
    if (reviewRun?.status !== 'succeeded') {
      throw new Error('The approved Review Run must succeed before user confirmation');
    }
    if (!task.currentRunId) throw new Error('Task has no current Run');
    const now = new Date();
    await tx
      .update(tasks)
      .set({ status: 'completed', version: task.version + 1, updatedAt: now })
      .where(and(eq(tasks.id, task.id), eq(tasks.version, task.version)));
    const [eventRow] = await tx
      .insert(runEvents)
      .values({
        taskId,
        runId: task.currentRunId,
        eventType: 'task.user_confirmed',
        payload: { reviewId: latestReview.id, round: latestReview.round },
        source: 'user',
        occurredAt: now,
        dedupeKey: `task-user-confirmed:${taskId}:${latestReview.id}`,
      })
      .returning();
    if (!eventRow) throw new Error('Task confirmation event insert did not return a row');
    return { taskId, emitted: [mapEvent(eventRow)] };
  });

  const detail = await getTaskDetail(db, result.taskId);
  if (!detail) throw new Error(`Task not found after confirmation: ${result.taskId}`);
  return { value: detail, emitted: result.emitted };
}
