import type { Handoff, Review, Run, Task } from '@relay-hub/contracts';
import { describe, expect, it } from 'vitest';
import { projectTaskCoordination, type TaskCoordinationSource } from './task-coordination.js';

const taskId = '00000000-0000-4000-8000-000000000010';
const builderId = '00000000-0000-4000-8000-000000000003';
const reviewerId = '00000000-0000-4000-8000-000000000004';
const builderRunId = '00000000-0000-4000-8000-000000000011';
const reviewerRunId = '00000000-0000-4000-8000-000000000012';

function task(status: Task['status'], currentRunId = builderRunId): Task {
  return {
    id: taskId,
    workspaceId: '00000000-0000-4000-8000-000000000001',
    title: 'Project coordination state',
    description: 'Derive the current responsibility without duplicating workflow state.',
    agentId: builderId,
    reviewerAgentId: reviewerId,
    acceptanceCriteria: ['The owner and route are explicit'],
    completionPolicy: 'require_user_confirmation',
    maxReviewRounds: 3,
    status,
    currentRunId,
    version: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function run(
  id: string,
  status: Run['status'],
  triggerType: Run['triggerType'],
  agentId = builderId,
): Run {
  return {
    id,
    taskId,
    agentId,
    status,
    attempt: 1,
    triggerType,
    workspaceRoot: '/tmp/relayhub',
    bootstrapPolicySnapshot: { steps: [] },
    agentProfileSnapshot: {
      id: agentId,
      name: triggerType === 'review' ? 'Codex Reviewer' : 'OpenCode Builder',
      adapterType: triggerType === 'review' ? 'codex_cli' : 'opencode_cli',
      capabilities: [triggerType === 'review' ? 'review' : 'implement'],
    },
    version: 1,
    createdAt: new Date(0).toISOString(),
  };
}

function source(taskValue: Task, runs: Run[], handoffs: Handoff[] = [], reviews: Review[] = []): TaskCoordinationSource {
  return { task: taskValue, runs, handoffs, reviews };
}

describe('Task coordination projection', () => {
  it.each([
    {
      name: 'queued Builder is owned by the platform until dispatch',
      input: source(task('queued'), [run(builderRunId, 'queued', 'user')]),
      owner: { kind: 'platform', reason: 'run_waiting_for_dispatch' },
      route: { action: 'continue' },
    },
    {
      name: 'running Builder is owned by its frozen Agent identity',
      input: source(task('running'), [run(builderRunId, 'running', 'user')]),
      owner: { kind: 'agent', agentId: builderId, label: 'OpenCode Builder' },
      route: { action: 'continue' },
    },
    {
      name: 'queued Reviewer is waiting on platform dispatch',
      input: source(task('reviewing', reviewerRunId), [run(reviewerRunId, 'queued', 'review', reviewerId)]),
      owner: { kind: 'platform', reason: 'review_waiting_for_dispatch' },
      route: { action: 'request_review', targetAgentId: reviewerId },
    },
    {
      name: 'running Reviewer owns the current responsibility',
      input: source(task('reviewing', reviewerRunId), [run(reviewerRunId, 'running', 'review', reviewerId)]),
      owner: { kind: 'agent', agentId: reviewerId, label: 'Codex Reviewer' },
      route: { action: 'continue', reason: 'review_in_progress' },
    },
    {
      name: 'missing current Run becomes an explicit platform anomaly',
      input: source(task('running', reviewerRunId), [run(builderRunId, 'succeeded', 'user')]),
      owner: { kind: 'platform', reason: 'current_run_missing' },
      route: { action: 'wait_for_user' },
    },
    {
      name: 'completed Task has no dangling owner or route',
      input: source(task('completed'), [run(builderRunId, 'succeeded', 'user')]),
      owner: { kind: 'none', reason: 'task_terminal' },
      route: { action: 'terminal', allowedActions: [] },
    },
  ])('$name', ({ input, owner, route }) => {
    const projection = projectTaskCoordination(input);
    expect(projection.owner).toMatchObject(owner);
    expect(projection.route).toMatchObject(route);
  });

  it('summarizes durable Builder evidence while a new Reviewer verdict is pending', () => {
    const builder = {
      ...run(builderRunId, 'succeeded', 'user'),
      outcome: {
        summary: 'Builder completed.',
        commandEvidence: [
          { command: 'pnpm test', status: 'succeeded' as const },
          { command: 'pnpm lint', status: 'failed' as const, exitCode: 1 },
        ],
      },
    };
    const handoff: Handoff = {
      id: '00000000-0000-4000-8000-000000000020',
      bundleVersion: 2,
      sourceRunId: builderRunId,
      targetAgentId: reviewerId,
      targetRunId: reviewerRunId,
      objective: 'Review the Builder result',
      contextSummary: 'Builder completed the change.',
      artifactRefs: [{ kind: 'worktree', value: '/tmp/relayhub' }],
      evidenceRefs: [
        { kind: 'command', value: 'pnpm test' },
        { kind: 'command', value: 'pnpm lint' },
      ],
      acceptanceCriteria: ['The owner and route are explicit'],
      decisions: [],
      openQuestions: [],
      risks: ['Lint failed'],
      nextAction: { type: 'request_review', targetAgentId: reviewerId, reason: 'Review required.' },
      status: 'accepted',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const projection = projectTaskCoordination(source(
      task('reviewing', reviewerRunId),
      [builder, run(reviewerRunId, 'running', 'review', reviewerId)],
      [handoff],
    ));

    expect(projection.evidence).toMatchObject({
      commandCount: 2,
      succeededCommandCount: 1,
      failedCommandCount: 1,
      artifactCount: 1,
      evidenceRefCount: 2,
      handoffStatus: 'accepted',
      handoffVersion: 2,
    });
    expect(projection.verdict).toEqual({ status: 'pending', findingCount: 0 });
  });

  it('hands an approved Task to the user with completion as the only allowed action', () => {
    const review: Review = {
      id: '00000000-0000-4000-8000-000000000030',
      taskId,
      runId: reviewerRunId,
      round: 1,
      verdict: 'approved',
      summary: 'All acceptance criteria passed.',
      findings: [],
      createdAt: new Date(0).toISOString(),
    };
    const projection = projectTaskCoordination(source(
      task('waiting_for_user', reviewerRunId),
      [run(reviewerRunId, 'succeeded', 'review', reviewerId)],
      [],
      [review],
    ));

    expect(projection.owner).toMatchObject({ kind: 'user', reason: 'user_confirmation_required' });
    expect(projection.verdict).toMatchObject({ status: 'approved', round: 1, findingCount: 0 });
    expect(projection.route).toEqual({
      action: 'complete',
      reason: 'user_confirmation_required',
      allowedActions: ['complete'],
    });
  });
});
