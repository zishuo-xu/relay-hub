import { randomUUID } from 'node:crypto';
import {
  type AgentEvent,
  canTransitionRun,
  canTransitionTask,
  type RunEvent,
  type RunStatus,
  type TaskDetail,
  type TaskStatus,
} from '@relay-hub/contracts';
import { agentProfiles, handoffs, outboxEvents, type RelayDatabase, runEvents, runs, tasks } from '@relay-hub/db';
import { and, eq } from 'drizzle-orm';
import { planAfterSuccessfulRun } from '../workflow-orchestrator.js';
import { mapEvent } from './mappers.js';
import { getTaskDetail } from './task-repository.js';
import type { MutationResult } from './types.js';

function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) throw new Error(`Illegal task transition: ${from} -> ${to}`);
}

function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) throw new Error(`Illegal run transition: ${from} -> ${to}`);
}

export async function recordAgentEvent(
  db: RelayDatabase,
  runId: string,
  dedupeKey: string,
  agentEvent: AgentEvent,
): Promise<MutationResult<TaskDetail>> {
  const result = await db.transaction(async (tx) => {
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
        if (run.status !== 'starting') throw new Error(`Cannot append ${agentEvent.type} while run is ${run.status}`);
        break;
      case 'handoff.requested': {
        if (run.status !== 'running') throw new Error(`Cannot request handoff while run is ${run.status}`);
        if (run.triggerType === 'review') throw new Error('Reviewer Runs cannot dispatch another Reviewer');
        if (!task.reviewerAgentId || task.reviewerAgentId !== agentEvent.handoff.targetAgentId) {
          throw new Error('Handoff target must match the Task reviewerAgentId');
        }
        if (agentEvent.handoff.targetAgentId === run.agentId) {
          throw new Error('Builder and Reviewer AgentProfile must be different');
        }
        const [targetAgent] = await tx
          .select({
            enabled: agentProfiles.enabled,
            workspaceId: agentProfiles.workspaceId,
            capabilities: agentProfiles.capabilities,
          })
          .from(agentProfiles)
          .where(eq(agentProfiles.id, agentEvent.handoff.targetAgentId))
          .limit(1);
        if (
          !targetAgent?.enabled ||
          targetAgent.workspaceId !== task.workspaceId ||
          !targetAgent.capabilities.includes('review')
        ) {
          throw new Error(`Invalid Reviewer AgentProfile: ${agentEvent.handoff.targetAgentId}`);
        }
        const [existingHandoff] = await tx
          .select({ id: handoffs.id })
          .from(handoffs)
          .where(eq(handoffs.sourceRunId, run.id))
          .limit(1);
        if (existingHandoff) throw new Error(`Run already has a Handoff: ${run.id}`);
        await tx.insert(handoffs).values({
          sourceRunId: run.id,
          targetAgentId: agentEvent.handoff.targetAgentId,
          objective: agentEvent.handoff.objective,
          contextSummary: agentEvent.handoff.summary,
          artifactRefs: agentEvent.handoff.artifactRefs,
          acceptanceCriteria: agentEvent.handoff.acceptanceCriteria,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        });
        break;
      }
      case 'run.completed':
        nextRunStatus = 'succeeded';
        {
          const [pendingHandoff] = await tx
            .select()
            .from(handoffs)
            .where(and(eq(handoffs.sourceRunId, run.id), eq(handoffs.status, 'pending')))
            .limit(1);
          const plan = planAfterSuccessfulRun({
            reviewDispatchAvailable: Boolean(pendingHandoff),
            isReviewRun: run.triggerType === 'review',
          });
          nextTaskStatus = plan.nextTaskStatus;
          let targetRunId: string | undefined;
          if (pendingHandoff) {
            targetRunId = randomUUID();
            const [targetAgent] = await tx
              .select({ enabled: agentProfiles.enabled, capabilities: agentProfiles.capabilities })
              .from(agentProfiles)
              .where(eq(agentProfiles.id, pendingHandoff.targetAgentId))
              .limit(1);
            if (!targetAgent?.enabled || !targetAgent.capabilities.includes('review')) {
              throw new Error(`Reviewer became unavailable: ${pendingHandoff.targetAgentId}`);
            }
            await tx.insert(runs).values({
              id: targetRunId,
              taskId: task.id,
              agentId: pendingHandoff.targetAgentId,
              parentRunId: run.id,
              triggerType: 'review',
              status: 'queued',
              workspaceRoot: run.workspaceRoot,
              bootstrapPolicySnapshot: { steps: [] },
              worktreePath: run.worktreePath,
              workingDirectory: run.workingDirectory,
              branchName: run.branchName,
              createdAt: now,
            });
            await tx
              .update(handoffs)
              .set({ status: 'dispatched', targetRunId, updatedAt: now })
              .where(and(eq(handoffs.id, pendingHandoff.id), eq(handoffs.status, 'pending')));
            await tx.insert(outboxEvents).values({
              aggregateType: 'run',
              aggregateId: targetRunId,
              eventType: 'run.queued',
              payload: { runId: targetRunId },
            });
            taskPatch.currentRunId = targetRunId;
          }
          workflowEvent = {
            eventType: plan.eventType,
            payload: { reason: plan.reason, runId: run.id, completionPolicy: task.completionPolicy },
            dedupeKey: `workflow-after-run:${run.id}`,
          };
          if (pendingHandoff && targetRunId) {
            workflowEvent.payload.handoffId = pendingHandoff.id;
            workflowEvent.payload.targetAgentId = pendingHandoff.targetAgentId;
            workflowEvent.payload.targetRunId = targetRunId;
          }
        }
        runPatch.finishedAt = now;
        runPatch.outcome = agentEvent.outcome;
        runPatch.tokenRevokedAt = now;
        break;
      case 'run.cancelled':
        nextRunStatus = 'cancelled';
        nextTaskStatus = 'cancelled';
        runPatch.finishedAt = now;
        runPatch.tokenRevokedAt = now;
        break;
      case 'run.failed':
        nextRunStatus = 'failed';
        if (task.status === 'queued' || task.status === 'running') nextTaskStatus = 'failed';
        runPatch.failureCode = agentEvent.code;
        runPatch.failureDetail = agentEvent.message;
        runPatch.finishedAt = now;
        runPatch.tokenRevokedAt = now;
        break;
      default:
        if (run.status !== 'running') throw new Error(`Cannot append ${agentEvent.type} while run is ${run.status}`);
    }

    if (nextRunStatus) {
      assertRunTransition(run.status, nextRunStatus);
      runPatch.status = nextRunStatus;
      runPatch.version = run.version + 1;
      await tx.update(runs).set(runPatch).where(and(eq(runs.id, run.id), eq(runs.version, run.version)));
    }
    if (nextTaskStatus) {
      assertTaskTransition(task.status, nextTaskStatus);
      taskPatch.status = nextTaskStatus;
      taskPatch.version = task.version + 1;
      taskPatch.updatedAt = now;
      await tx.update(tasks).set(taskPatch).where(and(eq(tasks.id, task.id), eq(tasks.version, task.version)));
    }

    const { type: eventType, ...payload } = agentEvent;
    const [eventRow] = await tx
      .insert(runEvents)
      .values({ taskId: run.taskId, runId, eventType, payload, source: 'agent', occurredAt: now, dedupeKey })
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

  const detail = await getTaskDetail(db, result.taskId);
  if (!detail) throw new Error(`Task not found after event: ${result.taskId}`);
  return { value: detail, emitted: result.emitted };
}
