import { randomUUID } from 'node:crypto';
import type { RunEvent, TaskDetail } from '@relay-hub/contracts';
import {
  agentProfiles,
  delegationPlans,
  delegations,
  outboxEvents,
  type RelayDatabase,
  runEvents,
  runs,
  tasks,
  threadMessages,
  threads,
  workspaces,
} from '@relay-hub/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { mapAgentProfile, mapEvent } from './mappers.js';
import { getTaskDetail } from './task-repository.js';
import { allocateThreadMessageSequence } from './thread-message-repository.js';
import type { MutationResult } from './types.js';

async function queueLeadContinuation(
  tx: Parameters<Parameters<RelayDatabase['transaction']>[0]>[0],
  plan: typeof delegationPlans.$inferSelect,
  now: Date,
): Promise<string> {
  const [sourceRun] = await tx.select().from(runs).where(eq(runs.id, plan.sourceRunId)).limit(1);
  if (!sourceRun) throw new Error(`Delegation source Run not found: ${plan.sourceRunId}`);
  const continuationRunId = randomUUID();
  await tx.insert(runs).values({
    id: continuationRunId,
    taskId: plan.parentTaskId,
    agentId: plan.sourceAgentId,
    parentRunId: sourceRun.id,
    triggerType: 'continuation',
    status: 'queued',
    attempt: sourceRun.attempt,
    workspaceRoot: sourceRun.workspaceRoot,
    bootstrapPolicySnapshot: { steps: [] },
    agentProfileSnapshot: sourceRun.agentProfileSnapshot,
    worktreePath: sourceRun.worktreePath,
    workingDirectory: sourceRun.workingDirectory,
    branchName: sourceRun.branchName,
    createdAt: now,
  });
  await tx.insert(outboxEvents).values({
    aggregateType: 'run',
    aggregateId: continuationRunId,
    eventType: 'run.queued',
    payload: { runId: continuationRunId },
  });
  await tx.update(tasks).set({
    status: 'queued',
    currentRunId: continuationRunId,
    version: sql`${tasks.version} + 1`,
    updatedAt: now,
  }).where(and(eq(tasks.id, plan.parentTaskId), eq(tasks.status, 'waiting_for_user')));
  return continuationRunId;
}

export async function approveDelegationPlan(
  db: RelayDatabase,
  planId: string,
): Promise<MutationResult<TaskDetail>> {
  const result = await db.transaction(async (tx) => {
    const [plan] = await tx.select().from(delegationPlans).where(eq(delegationPlans.id, planId)).limit(1);
    if (!plan) throw new Error(`Delegation plan not found: ${planId}`);
    if (plan.status !== 'pending') throw new Error(`Delegation plan cannot be approved while ${plan.status}`);
    const [parentTask] = await tx.select().from(tasks).where(eq(tasks.id, plan.parentTaskId)).limit(1);
    if (!parentTask || parentTask.status !== 'waiting_for_user') {
      throw new Error('Delegation parent Task is not waiting for approval');
    }
    const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.id, parentTask.workspaceId)).limit(1);
    if (!workspace?.rootPath) throw new Error('Delegation workspace root is not configured');
    const assignmentRows = await tx.select().from(delegations).where(eq(delegations.planId, plan.id)).orderBy(asc(delegations.createdAt));
    if (assignmentRows.length === 0 || assignmentRows.length > 4) throw new Error('Delegation plan must contain 1 to 4 assignments');
    const agents = await tx.select().from(agentProfiles).where(and(
      eq(agentProfiles.workspaceId, parentTask.workspaceId),
      eq(agentProfiles.enabled, true),
    ));
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const sourceAgent = agentById.get(plan.sourceAgentId);
    if (!sourceAgent) throw new Error('Delegation source Agent is unavailable');
    const reviewers = agents.filter((agent) => agent.capabilities.includes('review'));
    const now = new Date();
    const emitted: RunEvent[] = [];

    for (const assignment of assignmentRows) {
      const target = agentById.get(assignment.targetAgentId);
      if (!target?.capabilities.includes('implement')) throw new Error(`Delegation target is unavailable: ${assignment.targetAgentId}`);
      const reviewer = assignment.kind === 'implementation'
        ? [...reviewers]
            .filter((candidate) => candidate.id !== target.id)
            .sort((left, right) => Number(right.modelFamily !== target.modelFamily) - Number(left.modelFamily !== target.modelFamily))[0]
        : undefined;
      if (assignment.kind === 'implementation' && !reviewer) {
        throw new Error(`Implementation assignment requires an independent Reviewer: ${assignment.title}`);
      }
      const childThreadId = randomUUID();
      const childTaskId = randomUUID();
      const childRunId = randomUUID();
      await tx.insert(threads).values({
        id: childThreadId,
        workspaceId: parentTask.workspaceId,
        title: `↳ ${assignment.title}`,
        createdAt: now,
        updatedAt: now,
      });
      const sequence = await allocateThreadMessageSequence(tx, childThreadId, parentTask.workspaceId, now);
      await tx.insert(tasks).values({
        id: childTaskId,
        workspaceId: parentTask.workspaceId,
        threadId: childThreadId,
        parentTaskId: parentTask.id,
        conversationContextBeforeSequence: sequence,
        conversationContextPolicyVersion: 1,
        title: assignment.title,
        description: `${assignment.objective}\n\n范围：${assignment.scope}\n\n交付物：\n- ${assignment.deliverables.join('\n- ')}`,
        acceptanceCriteria: assignment.acceptanceCriteria,
        completionPolicy: 'auto_on_approval',
        maxReviewRounds: parentTask.maxReviewRounds,
        builderAgentId: target.id,
        reviewerAgentId: reviewer?.id,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(threadMessages).values({
        threadId: childThreadId,
        sequence,
        taskId: childTaskId,
        senderType: 'agent',
        senderName: sourceAgent.name,
        senderAgentId: sourceAgent.id,
        recipientAgentId: target.id,
        content: `${assignment.objective}\n\n范围：${assignment.scope}`,
        createdAt: now,
      });
      await tx.insert(runs).values({
        id: childRunId,
        taskId: childTaskId,
        agentId: target.id,
        parentRunId: plan.sourceRunId,
        triggerType: 'delegation',
        status: 'queued',
        workspaceRoot: workspace.rootPath,
        bootstrapPolicySnapshot: workspace.bootstrapPolicy,
        agentProfileSnapshot: mapAgentProfile(target),
        createdAt: now,
      });
      await tx.update(tasks).set({ currentRunId: childRunId }).where(eq(tasks.id, childTaskId));
      await tx.update(delegations).set({
        reviewerAgentId: reviewer?.id,
        childThreadId,
        childTaskId,
        status: 'queued',
        updatedAt: now,
      }).where(eq(delegations.id, assignment.id));
      const [childEvent] = await tx.insert(runEvents).values({
        taskId: childTaskId,
        runId: childRunId,
        eventType: 'task.delegated',
        payload: { planId, delegationId: assignment.id, parentTaskId: parentTask.id, sourceAgentId: plan.sourceAgentId },
        source: 'api',
        occurredAt: now,
        dedupeKey: `task-delegated:${assignment.id}`,
      }).returning();
      if (childEvent) emitted.push(mapEvent(childEvent));
      await tx.insert(outboxEvents).values({
        aggregateType: 'run',
        aggregateId: childRunId,
        eventType: 'run.queued',
        payload: { runId: childRunId },
      });
    }
    await tx.update(delegationPlans).set({ status: 'running', updatedAt: now }).where(eq(delegationPlans.id, plan.id));
    await tx.update(tasks).set({
      status: 'waiting_on_children',
      version: parentTask.version + 1,
      updatedAt: now,
    }).where(and(eq(tasks.id, parentTask.id), eq(tasks.version, parentTask.version)));
    const [parentEvent] = await tx.insert(runEvents).values({
      taskId: parentTask.id,
      runId: plan.sourceRunId,
      eventType: 'task.delegation_approved',
      payload: { planId, assignmentCount: assignmentRows.length },
      source: 'user',
      occurredAt: now,
      dedupeKey: `delegation-approved:${planId}`,
    }).returning();
    if (parentEvent) emitted.push(mapEvent(parentEvent));
    return { taskId: parentTask.id, emitted };
  });
  const detail = await getTaskDetail(db, result.taskId);
  if (!detail) throw new Error(`Delegation parent Task not found: ${result.taskId}`);
  return { value: detail, emitted: result.emitted };
}

export async function rejectDelegationPlan(
  db: RelayDatabase,
  planId: string,
): Promise<MutationResult<TaskDetail>> {
  const result = await db.transaction(async (tx) => {
    const [plan] = await tx.select().from(delegationPlans).where(eq(delegationPlans.id, planId)).limit(1);
    if (!plan) throw new Error(`Delegation plan not found: ${planId}`);
    if (plan.status !== 'pending') throw new Error(`Delegation plan cannot be rejected while ${plan.status}`);
    const now = new Date();
    const continuationRunId = await queueLeadContinuation(tx, plan, now);
    await tx.update(delegationPlans).set({ status: 'rejected', continuationRunId, updatedAt: now }).where(eq(delegationPlans.id, plan.id));
    await tx.update(delegations).set({ status: 'cancelled', updatedAt: now }).where(and(eq(delegations.planId, plan.id), eq(delegations.status, 'proposed')));
    const [event] = await tx.insert(runEvents).values({
      taskId: plan.parentTaskId,
      runId: plan.sourceRunId,
      eventType: 'task.delegation_rejected',
      payload: { planId, continuationRunId },
      source: 'user',
      occurredAt: now,
      dedupeKey: `delegation-rejected:${planId}`,
    }).returning();
    return { taskId: plan.parentTaskId, emitted: event ? [mapEvent(event)] : [] };
  });
  const detail = await getTaskDetail(db, result.taskId);
  if (!detail) throw new Error(`Delegation parent Task not found: ${result.taskId}`);
  return { value: detail, emitted: result.emitted };
}
