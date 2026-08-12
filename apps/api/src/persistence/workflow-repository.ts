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
import {
  agentProfiles,
  handoffs,
  outboxEvents,
  type RelayDatabase,
  reviewFindings,
  reviews,
  runEvents,
  runs,
  tasks,
  threadMessages,
  threads,
} from '@relay-hub/db';
import { and, eq, sql } from 'drizzle-orm';
import {
  planAfterReview,
  planAfterSuccessfulBuilderRun,
  planSequentialHandoffDispatch,
} from '../workflow-orchestrator.js';
import { handoffContentDigest } from '../handoff-integrity.js';
import { mapAgentProfile, mapEvent } from './mappers.js';
import { getTaskDetail } from './task-repository.js';
import type { MutationResult } from './types.js';
import { allocateThreadMessageSequence } from './thread-message-repository.js';

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
    let secondaryWorkflowEvent: { eventType: string; payload: Record<string, unknown>; dedupeKey: string } | undefined;
    let repairRunId: string | undefined;
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
        if (run.triggerType === 'review') throw new Error('Review Runs cannot request a Handoff');
        if (task.currentRunId !== run.id) {
          throw new Error('Only the current Task Run can request a Handoff');
        }
        if (agentEvent.handoff.targetAgentId === run.agentId) {
          throw new Error('Handoff target must be a different AgentProfile than the source Run');
        }
        if (agentEvent.handoff.nextAction.type === 'request_review') {
          if (!task.reviewerAgentId || task.reviewerAgentId !== agentEvent.handoff.targetAgentId) {
            throw new Error('Handoff target must match the Task reviewerAgentId');
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
        } else if (agentEvent.handoff.nextAction.type === 'handoff') {
          const [targetAgent] = await tx
            .select({
              enabled: agentProfiles.enabled,
              workspaceId: agentProfiles.workspaceId,
            })
            .from(agentProfiles)
            .where(eq(agentProfiles.id, agentEvent.handoff.targetAgentId))
            .limit(1);
          if (!targetAgent?.enabled || targetAgent.workspaceId !== task.workspaceId) {
            throw new Error(`Invalid Handoff target AgentProfile: ${agentEvent.handoff.targetAgentId}`);
          }
        } else {
          throw new Error('A Handoff nextAction must be handoff or request_review');
        }
        const [existingHandoff] = await tx
          .select({ id: handoffs.id })
          .from(handoffs)
          .where(eq(handoffs.sourceRunId, run.id))
          .limit(1);
        if (existingHandoff) throw new Error(`Run already has a Handoff: ${run.id}`);
        const handoffId = randomUUID();
        const bundle = {
          bundleVersion: agentEvent.handoff.bundleVersion ?? 2,
          sourceRunId: run.id,
          targetAgentId: agentEvent.handoff.targetAgentId,
          objective: agentEvent.handoff.objective,
          contextSummary: agentEvent.handoff.summary,
          artifactRefs: agentEvent.handoff.artifactRefs ?? [],
          evidenceRefs: agentEvent.handoff.evidenceRefs ?? [],
          acceptanceCriteria: task.acceptanceCriteria,
          decisions: agentEvent.handoff.decisions ?? [],
          openQuestions: agentEvent.handoff.openQuestions ?? [],
          risks: agentEvent.handoff.risks ?? [],
          nextAction: agentEvent.handoff.nextAction,
        };
        await tx.insert(handoffs).values({
          id: handoffId,
          bundleVersion: bundle.bundleVersion,
          sourceRunId: run.id,
          targetAgentId: agentEvent.handoff.targetAgentId,
          objective: bundle.objective,
          contextSummary: bundle.contextSummary,
          artifactRefs: bundle.artifactRefs,
          evidenceRefs: bundle.evidenceRefs,
          acceptanceCriteria: bundle.acceptanceCriteria,
          decisions: bundle.decisions,
          openQuestions: bundle.openQuestions,
          risks: bundle.risks,
          nextAction: bundle.nextAction,
          contentDigest: handoffContentDigest(bundle),
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        });
        break;
      }
      case 'handoff.consumed': {
        if (run.status !== 'claimed' && run.status !== 'starting') {
          throw new Error(`Cannot consume Handoff while run is ${run.status}`);
        }
        const [handoff] = await tx
          .select()
          .from(handoffs)
          .where(eq(handoffs.targetRunId, run.id))
          .limit(1);
        if (!handoff || handoff.id !== agentEvent.handoffId) {
          throw new Error(`Handoff does not belong to target Run: ${agentEvent.handoffId}`);
        }
        if (handoff.status !== 'dispatched') {
          throw new Error(`Cannot consume Handoff while it is ${handoff.status}`);
        }
        if (
          handoff.bundleVersion !== agentEvent.bundleVersion ||
          !handoff.contentDigest ||
          handoff.contentDigest !== agentEvent.contentDigest
        ) {
          throw new Error('Handoff integrity metadata does not match the persisted bundle');
        }
        await tx
          .update(handoffs)
          .set({ status: 'accepted', updatedAt: now })
          .where(and(eq(handoffs.id, handoff.id), eq(handoffs.status, 'dispatched')));
        break;
      }
      case 'review.submitted': {
        if (run.status !== 'running') throw new Error(`Cannot submit review while run is ${run.status}`);
        if (run.triggerType !== 'review') throw new Error('Only Reviewer Runs can submit a Review');
        if (task.status !== 'reviewing') throw new Error(`Cannot submit review while task is ${task.status}`);
        if (!task.reviewerAgentId || run.agentId !== task.reviewerAgentId) {
          throw new Error('Review Run AgentProfile must match the Task reviewerAgentId');
        }
        const existingReviews = await tx.select({ round: reviews.round }).from(reviews).where(eq(reviews.taskId, task.id));
        const [existingForRun] = await tx
          .select({ id: reviews.id })
          .from(reviews)
          .where(eq(reviews.runId, run.id))
          .limit(1);
        if (existingForRun) throw new Error(`Reviewer Run already submitted a Review: ${run.id}`);
        const round = existingReviews.reduce((maximum, review) => Math.max(maximum, review.round), 0) + 1;
        const [reviewRow] = await tx
          .insert(reviews)
          .values({
            taskId: task.id,
            runId: run.id,
            round,
            verdict: agentEvent.review.verdict,
            summary: agentEvent.review.summary,
            createdAt: now,
          })
          .returning({ id: reviews.id });
        if (!reviewRow) throw new Error('Review insert did not return a row');
        if (agentEvent.review.findings.length > 0) {
          await tx.insert(reviewFindings).values(
            agentEvent.review.findings.map((finding) => ({
              reviewId: reviewRow.id,
              severity: finding.severity,
              filePath: finding.filePath,
              lineStart: finding.lineStart,
              lineEnd: finding.lineEnd,
              title: finding.title,
              detail: finding.detail,
              suggestion: finding.suggestion,
              createdAt: now,
            })),
          );
        }
        break;
      }
      case 'run.completed':
        nextRunStatus = 'succeeded';
        {
          if (run.triggerType === 'review') {
            const [review] = await tx.select().from(reviews).where(eq(reviews.runId, run.id)).limit(1);
            if (!review) throw new Error('Reviewer Run must submit a structured Review before completion');
            const findingRows = await tx
              .select({ severity: reviewFindings.severity })
              .from(reviewFindings)
              .where(eq(reviewFindings.reviewId, review.id));
            const [builderRun] = run.parentRunId
              ? await tx
                  .select({ agentId: runs.agentId, attempt: runs.attempt, outcome: runs.outcome })
                  .from(runs)
                  .where(eq(runs.id, run.parentRunId))
                  .limit(1)
              : [];
            const evidence = builderRun?.outcome?.commandEvidence ?? [];
            const riskEvidenceSatisfied =
              evidence.length > 0 && evidence.every((command) => command.status === 'succeeded');
            const plan = planAfterReview({
              verdict: review.verdict,
              completionPolicy: task.completionPolicy,
              riskEvidenceSatisfied,
              repairDispatchAvailable:
                review.verdict === 'changes_requested' && review.round < task.maxReviewRounds,
            });
            nextTaskStatus = plan.nextTaskStatus;
            workflowEvent = {
              eventType: plan.eventType,
              payload: {
                reason: plan.reason,
                runId: run.id,
                reviewId: review.id,
                round: review.round,
                verdict: review.verdict,
                findingCount: findingRows.length,
                completionPolicy: task.completionPolicy,
              },
              dedupeKey: `workflow-after-review:${run.id}`,
            };
            if (plan.queueRepair) {
              const builderAgentId = task.builderAgentId ?? builderRun?.agentId;
              if (!builderAgentId) throw new Error('Task has no Builder AgentProfile for repair');
              const [builderAgent] = await tx
                .select()
                .from(agentProfiles)
                .where(eq(agentProfiles.id, builderAgentId))
                .limit(1);
              if (!builderAgent?.enabled || !builderAgent.capabilities.includes('implement')) {
                throw new Error(`Builder became unavailable for repair: ${builderAgentId}`);
              }
              repairRunId = randomUUID();
              await tx.insert(runs).values({
                id: repairRunId,
                taskId: task.id,
                agentId: builderAgentId,
                parentRunId: run.id,
                retryOfRunId: run.parentRunId,
                triggerType: 'retry',
                status: 'queued',
                attempt: (builderRun?.attempt ?? review.round) + 1,
                workspaceRoot: run.workspaceRoot,
                bootstrapPolicySnapshot: { steps: [] },
                agentProfileSnapshot: mapAgentProfile(builderAgent),
                worktreePath: run.worktreePath,
                workingDirectory: run.workingDirectory,
                branchName: run.branchName,
                createdAt: now,
              });
              await tx.insert(outboxEvents).values({
                aggregateType: 'run',
                aggregateId: repairRunId,
                eventType: 'run.queued',
                payload: { runId: repairRunId },
              });
              secondaryWorkflowEvent = {
                eventType: 'task.repair_requested',
                payload: {
                  reviewId: review.id,
                  reviewRound: review.round,
                  previousBuilderRunId: run.parentRunId,
                  repairRunId,
                  nextReviewRound: review.round + 1,
                },
                dedupeKey: `workflow-repair-requested:${run.id}`,
              };
            }
          } else {
            const [pendingHandoff] = await tx
              .select()
              .from(handoffs)
              .where(and(eq(handoffs.sourceRunId, run.id), eq(handoffs.status, 'pending')))
              .limit(1);
            if (pendingHandoff?.nextAction?.type === 'handoff') {
              const genericHandoffs = await tx
                .select({ id: handoffs.id })
                .from(handoffs)
                .innerJoin(runs, eq(handoffs.sourceRunId, runs.id))
                .where(and(eq(runs.taskId, task.id), sql`${handoffs.nextAction} ->> 'type' = 'handoff'`));
              const [targetAgent] = await tx
                .select()
                .from(agentProfiles)
                .where(eq(agentProfiles.id, pendingHandoff.targetAgentId))
                .limit(1);
              const plan = planSequentialHandoffDispatch({
                genericHandoffOrdinal: genericHandoffs.length,
                targetDispatchAvailable:
                  Boolean(targetAgent?.enabled) && targetAgent?.workspaceId === task.workspaceId,
              });
              let handoffTargetRunId: string | undefined;
              if (plan.dispatch && targetAgent) {
                handoffTargetRunId = randomUUID();
                await tx.insert(runs).values({
                  id: handoffTargetRunId,
                  taskId: task.id,
                  agentId: pendingHandoff.targetAgentId,
                  parentRunId: run.id,
                  triggerType: 'handoff',
                  status: 'queued',
                  workspaceRoot: run.workspaceRoot,
                  bootstrapPolicySnapshot: { steps: [] },
                  agentProfileSnapshot: mapAgentProfile(targetAgent),
                  worktreePath: run.worktreePath,
                  workingDirectory: run.workingDirectory,
                  branchName: run.branchName,
                  createdAt: now,
                });
                await tx
                  .update(handoffs)
                  .set({ status: 'dispatched', targetRunId: handoffTargetRunId, updatedAt: now })
                  .where(and(eq(handoffs.id, pendingHandoff.id), eq(handoffs.status, 'pending')));
                await tx.insert(outboxEvents).values({
                  aggregateType: 'run',
                  aggregateId: handoffTargetRunId,
                  eventType: 'run.queued',
                  payload: { runId: handoffTargetRunId },
                });
                taskPatch.currentRunId = handoffTargetRunId;
              } else {
                await tx
                  .update(handoffs)
                  .set({ status: 'rejected', updatedAt: now })
                  .where(and(eq(handoffs.id, pendingHandoff.id), eq(handoffs.status, 'pending')));
              }
              if (plan.nextTaskStatus !== 'running') nextTaskStatus = plan.nextTaskStatus;
              workflowEvent = {
                eventType: plan.eventType,
                payload: {
                  reason: plan.reason,
                  runId: run.id,
                  handoffId: pendingHandoff.id,
                  targetAgentId: pendingHandoff.targetAgentId,
                  completionPolicy: task.completionPolicy,
                  ...(handoffTargetRunId ? { targetRunId: handoffTargetRunId } : {}),
                },
                dedupeKey: `workflow-after-run:${run.id}`,
              };
            } else {
              const plan = planAfterSuccessfulBuilderRun({ reviewDispatchAvailable: Boolean(pendingHandoff) });
              nextTaskStatus = plan.nextTaskStatus;
              let targetRunId: string | undefined;
              if (pendingHandoff) {
                targetRunId = randomUUID();
                const [targetAgent] = await tx
                  .select()
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
                  agentProfileSnapshot: mapAgentProfile(targetAgent),
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
          }
        }
        runPatch.finishedAt = now;
        runPatch.outcome = agentEvent.outcome;
        runPatch.tokenRevokedAt = now;
        runPatch.leaseExpiresAt = null;
        break;
      case 'run.cancelled':
        nextRunStatus = 'cancelled';
        nextTaskStatus = 'cancelled';
        runPatch.finishedAt = now;
        runPatch.tokenRevokedAt = now;
        runPatch.leaseExpiresAt = null;
        break;
      case 'run.failed':
        nextRunStatus = 'failed';
        if (run.triggerType === 'review' && task.status === 'reviewing') {
          nextTaskStatus = 'waiting_for_user';
          workflowEvent = {
            eventType: 'task.review_failed',
            payload: { runId: run.id, reason: agentEvent.code, message: agentEvent.message },
            dedupeKey: `workflow-review-failed:${run.id}`,
          };
        } else if (task.status === 'queued' || task.status === 'running') {
          nextTaskStatus = 'failed';
        }
        runPatch.failureCode = agentEvent.code;
        runPatch.failureDetail = agentEvent.message;
        runPatch.finishedAt = now;
        runPatch.tokenRevokedAt = now;
        runPatch.leaseExpiresAt = null;
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
    if (nextTaskStatus || taskPatch.currentRunId) {
      if (nextTaskStatus) {
        assertTaskTransition(task.status, nextTaskStatus);
        taskPatch.status = nextTaskStatus;
      }
      taskPatch.version = task.version + 1;
      taskPatch.updatedAt = now;
      await tx.update(tasks).set(taskPatch).where(and(eq(tasks.id, task.id), eq(tasks.version, task.version)));
    }
    if (repairRunId) {
      assertTaskTransition('changes_requested', 'queued');
      await tx
        .update(tasks)
        .set({
          status: 'queued',
          currentRunId: repairRunId,
          version: task.version + 2,
          updatedAt: now,
        })
        .where(and(eq(tasks.id, task.id), eq(tasks.version, task.version + 1), eq(tasks.status, 'changes_requested')));
    }

    if (agentEvent.type === 'run.completed' && task.threadId) {
      const sequence = await allocateThreadMessageSequence(tx, task.threadId, task.workspaceId, now);
      await tx
        .insert(threadMessages)
        .values({
          threadId: task.threadId,
          sequence,
          taskId: task.id,
          runId: run.id,
          senderType: 'agent',
          senderName: run.agentProfileSnapshot.name,
          senderAgentId: run.agentId,
          content: agentEvent.outcome.publicMessage ?? agentEvent.outcome.summary,
          createdAt: now,
        })
        .onConflictDoNothing();
    }

    const { type: eventType, ...payload } = agentEvent;
    const [eventRow] = await tx
      .insert(runEvents)
      .values({
        taskId: run.taskId,
        runId,
        eventType,
        payload,
        source: agentEvent.type === 'handoff.consumed' ? 'worker' : 'agent',
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
    if (secondaryWorkflowEvent) {
      const [workflowEventRow] = await tx
        .insert(runEvents)
        .values({
          taskId: run.taskId,
          runId,
          eventType: secondaryWorkflowEvent.eventType,
          payload: secondaryWorkflowEvent.payload,
          source: 'api',
          occurredAt: now,
          dedupeKey: secondaryWorkflowEvent.dedupeKey,
        })
        .returning();
      if (!workflowEventRow) throw new Error('Secondary workflow event insert did not return a row');
      emitted.push(mapEvent(workflowEventRow));
    }
    return { taskId: run.taskId, emitted };
  });

  const detail = await getTaskDetail(db, result.taskId);
  if (!detail) throw new Error(`Task not found after event: ${result.taskId}`);
  return { value: detail, emitted: result.emitted };
}
