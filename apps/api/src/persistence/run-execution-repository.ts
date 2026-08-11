import {
  type AgentCapability,
  canTransitionRun,
  canTransitionTask,
  type ClaimedExecution,
  type ClaimedRun,
  type HandoffTargetView,
  type RunEvent,
  type RunStatus,
  type TaskDetail,
  type TaskStatus,
} from '@relay-hub/contracts';
import {
  agentProfiles,
  handoffs,
  type RelayDatabase,
  reviewFindings,
  reviews,
  runEvents,
  runs,
  tasks,
  workspaces,
} from '@relay-hub/db';
import { and, eq, sql } from 'drizzle-orm';
import { issueRunToken, verifyRunToken } from '../run-token.js';
import { handoffContentDigest } from '../handoff-integrity.js';
import {
  mapEvent,
  mapHandoff,
  mapReview,
  mapReviewFinding,
  mapRun,
  mapTask,
  mapWorkspace,
} from './mappers.js';
import { getTaskDetail } from './task-repository.js';
import type { MutationResult } from './types.js';

function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) throw new Error(`Illegal task transition: ${from} -> ${to}`);
}

function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) throw new Error(`Illegal run transition: ${from} -> ${to}`);
}

export async function claimRun(
  db: RelayDatabase,
  runId: string,
  workerId: string,
  runTokenTtlMs: number,
): Promise<MutationResult<ClaimedExecution | null>> {
  const token = issueRunToken(new Date(), runTokenTtlMs);
  const result = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(runs)
      .set({
        status: 'claimed',
        workerId,
        executionTokenHash: token.hash,
        tokenIssuedAt: token.issuedAt,
        tokenExpiresAt: token.expiresAt,
        tokenRevokedAt: null,
        version: sql`${runs.version} + 1`,
      })
      .where(and(eq(runs.id, runId), eq(runs.status, 'queued')))
      .returning();
    if (!claimed) return { claimed: null, emitted: [] as RunEvent[] };
    const [taskRow] = await tx.select().from(tasks).where(eq(tasks.id, claimed.taskId)).limit(1);
    if (!taskRow) throw new Error(`Task not found for run: ${runId}`);
    const [workspaceRow] = await tx.select().from(workspaces).where(eq(workspaces.id, taskRow.workspaceId)).limit(1);
    if (!workspaceRow) throw new Error(`Workspace not found for run: ${runId}`);
    const candidateRows = await tx
      .select({ id: agentProfiles.id, name: agentProfiles.name, capabilities: agentProfiles.capabilities })
      .from(agentProfiles)
      .where(and(eq(agentProfiles.workspaceId, taskRow.workspaceId), eq(agentProfiles.enabled, true)));
    const handoffTargets: HandoffTargetView[] = candidateRows
      .filter((row) => row.id !== claimed.agentId)
      .map((row) => ({ id: row.id, name: row.name, capabilities: row.capabilities as AgentCapability[] }));
    const [handoffRow] = await tx.select().from(handoffs).where(eq(handoffs.targetRunId, claimed.id)).limit(1);
    if (handoffRow?.bundleVersion && handoffRow.bundleVersion >= 2) {
      if (!handoffRow.contentDigest || !handoffRow.nextAction) {
        throw new Error(`Persisted Handoff V2 is missing integrity metadata: ${handoffRow.id}`);
      }
      const actualDigest = handoffContentDigest({
        bundleVersion: handoffRow.bundleVersion,
        sourceRunId: handoffRow.sourceRunId,
        targetAgentId: handoffRow.targetAgentId,
        objective: handoffRow.objective,
        contextSummary: handoffRow.contextSummary,
        artifactRefs: handoffRow.artifactRefs,
        evidenceRefs: handoffRow.evidenceRefs,
        acceptanceCriteria: handoffRow.acceptanceCriteria,
        decisions: handoffRow.decisions,
        openQuestions: handoffRow.openQuestions,
        risks: handoffRow.risks,
        nextAction: handoffRow.nextAction,
      });
      if (actualDigest !== handoffRow.contentDigest) {
        throw new Error(`Persisted Handoff integrity check failed: ${handoffRow.id}`);
      }
    }
    const [reviewRow] = claimed.triggerType === 'retry' && claimed.parentRunId
      ? await tx.select().from(reviews).where(eq(reviews.runId, claimed.parentRunId)).limit(1)
      : [];
    const findingRows = reviewRow
      ? await tx.select().from(reviewFindings).where(eq(reviewFindings.reviewId, reviewRow.id))
      : [];
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
        claimed: {
          task: mapTask(taskRow, claimed.agentId),
          run: mapRun(claimed),
          workspace: mapWorkspace(workspaceRow),
          agent: claimed.agentProfileSnapshot,
          handoffTargets,
          ...(handoffRow ? { handoff: mapHandoff(handoffRow) } : {}),
          ...(reviewRow ? { review: mapReview(reviewRow, findingRows.map(mapReviewFinding)) } : {}),
        } satisfies ClaimedRun,
        executionToken: token.plaintext,
      },
      emitted: [mapEvent(eventRow)],
    };
  });
  return { value: result.claimed, emitted: result.emitted };
}

export async function authorizeRunToken(
  db: RelayDatabase,
  runId: string,
  plaintext: string,
  now = new Date(),
): Promise<boolean> {
  const [run] = await db
    .select({
      status: runs.status,
      executionTokenHash: runs.executionTokenHash,
      tokenExpiresAt: runs.tokenExpiresAt,
      tokenRevokedAt: runs.tokenRevokedAt,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!run?.executionTokenHash || !run.tokenExpiresAt || run.tokenRevokedAt) return false;
  if (run.tokenExpiresAt.getTime() <= now.getTime()) return false;
  if (
    run.status === 'queued' ||
    run.status === 'succeeded' ||
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    run.status === 'lost'
  ) {
    return false;
  }
  return verifyRunToken(plaintext, run.executionTokenHash);
}

export async function getRunStatus(db: RelayDatabase, runId: string): Promise<RunStatus | null> {
  const [row] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId)).limit(1);
  return row?.status ?? null;
}

export async function requestRunCancellation(
  db: RelayDatabase,
  runId: string,
): Promise<MutationResult<TaskDetail>> {
  const result = await db.transaction(async (tx) => {
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
    assertRunTransition(run.status, nextRunStatus);
    await tx
      .update(runs)
      .set({
        status: nextRunStatus,
        version: run.version + 1,
        ...(nextRunStatus === 'cancelled' ? { finishedAt: now, tokenRevokedAt: now } : {}),
      })
      .where(and(eq(runs.id, run.id), eq(runs.version, run.version)));

    if (nextRunStatus === 'cancelled') {
      assertTaskTransition(task.status, 'cancelled');
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

  const detail = await getTaskDetail(db, result.taskId);
  if (!detail) throw new Error(`Task not found after cancellation: ${result.taskId}`);
  return { value: detail, emitted: result.emitted };
}
