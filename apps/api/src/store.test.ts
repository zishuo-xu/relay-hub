import {
  DEFAULT_CODEX_AGENT_ID,
  DEFAULT_MOCK_AGENT_ID,
  DEFAULT_MOCK_REVIEWER_AGENT_ID,
} from '@relay-hub/contracts';
import { createDatabase, runs } from '@relay-hub/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresStore } from './store.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;
let database: ReturnType<typeof createDatabase> | undefined;
let store: PostgresStore;

suite('PostgresStore integration', () => {
  beforeAll(() => {
    database = createDatabase(testDatabaseUrl);
    store = new PostgresStore(database.db);
  });

  afterAll(async () => {
    await database?.close();
  });

  it('creates and updates a user-configured OpenCode AgentProfile', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const created = await store.createAgentProfile('00000000-0000-4000-8000-000000000001', {
      name: `OpenCode Builder ${suffix}`,
      adapterType: 'opencode_cli',
      capabilities: ['implement'],
      model: 'opencode/north-mini-code-free',
      variant: 'high',
      credentialEnv: 'OPENCODE_API_KEY',
      enabled: true,
    });
    expect(created).toMatchObject({
      adapterType: 'opencode_cli',
      provider: 'opencode',
      modelLabel: 'opencode/north-mini-code-free',
      capabilities: ['implement'],
      config: {
        model: 'opencode/north-mini-code-free',
        variant: 'high',
        credentialEnv: 'OPENCODE_API_KEY',
      },
    });
    if (!created) throw new Error('OpenCode AgentProfile was not created');
    const updated = await store.updateAgentProfile(created.id, {
      name: created.name,
      adapterType: 'opencode_cli',
      capabilities: ['implement', 'review'],
      model: 'opencode/longcat-2.0-free',
      enabled: false,
    });
    expect(updated).toMatchObject({
      id: created.id,
      enabled: false,
      capabilities: ['implement', 'review'],
      config: { model: 'opencode/longcat-2.0-free' },
    });
  });

  it('atomically creates, claims, deduplicates, and records a successful run outcome', async () => {
    const idempotencyKey = `test-${crypto.randomUUID()}`;
    const input = {
      title: 'Verify durable task path',
      description: 'Exercise the PostgreSQL repository without deleting any persistent rows.',
      agentId: DEFAULT_MOCK_AGENT_ID,
      acceptanceCriteria: ['Run reaches succeeded'],
      completionPolicy: 'auto_on_approval' as const,
      maxReviewRounds: 3,
    };
    const created = await store.createTask(input, idempotencyKey);
    const duplicate = await store.createTask(input, idempotencyKey);
    expect(duplicate.value.created).toBe(false);
    expect(duplicate.value.detail.task.id).toBe(created.value.detail.task.id);

    const runId = created.value.detail.task.currentRunId;
    const claimed = await store.claimRun(runId, 'integration-worker');
    expect(claimed.value?.claimed.run.status).toBe('claimed');
    expect(claimed.value?.claimed.workspace.bootstrapPolicy).toEqual({ steps: [] });
    expect(claimed.value?.claimed.run.bootstrapPolicySnapshot).toEqual({ steps: [] });
    expect(claimed.value?.executionToken).toMatch(/^rht_/);
    expect(await store.authorizeRunToken(runId, claimed.value?.executionToken ?? '')).toBe(true);
    expect(await store.authorizeRunToken(runId, 'rht_wrong')).toBe(false);
    const [tokenRow] = await database?.db
      .select({ executionTokenHash: runs.executionTokenHash, tokenExpiresAt: runs.tokenExpiresAt })
      .from(runs)
      .where(eq(runs.id, runId));
    expect(tokenRow?.executionTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenRow?.executionTokenHash).not.toBe(claimed.value?.executionToken);
    expect(
      await store.authorizeRunToken(
        runId,
        claimed.value?.executionToken ?? '',
        new Date((tokenRow?.tokenExpiresAt?.getTime() ?? 0) + 1),
      ),
    ).toBe(false);
    expect((await store.claimRun(runId, 'duplicate-worker')).value).toBeNull();

    await store.recordAgentEvent(runId, 'event-1', { type: 'run.started' });
    await store.recordAgentEvent(runId, 'event-2', {
      type: 'run.completed',
      outcome: {
        summary: 'Done',
        commandEvidence: [{ command: 'pnpm test', status: 'succeeded', exitCode: 0 }],
      },
    });
    const detail = await store.getTaskDetail(created.value.detail.task.id);
    expect(detail?.task.status).toBe('waiting_for_user');
    expect(detail?.runs[0]?.status).toBe('succeeded');
    expect(detail?.runs[0]?.outcome).toEqual({
      summary: 'Done',
      commandEvidence: [{ command: 'pnpm test', status: 'succeeded', exitCode: 0 }],
    });
    expect(detail?.events.at(-1)?.type).toBe('task.waiting_for_review');
    expect(detail?.events.at(-1)?.payload).toMatchObject({
      reason: 'review_workflow_not_available',
      completionPolicy: 'auto_on_approval',
    });
    expect(await store.authorizeRunToken(runId, claimed.value?.executionToken ?? '')).toBe(false);
  });

  it('cancels an active run through cancelling before the terminal event', async () => {
    const created = await store.createTask({
      title: 'Cancel active run',
      description: 'Verify process cancellation state converges without deleting execution evidence.',
      agentId: DEFAULT_MOCK_AGENT_ID,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const runId = created.value.detail.task.currentRunId;
    const claimed = await store.claimRun(runId, 'cancellation-worker');
    await store.recordAgentEvent(runId, 'prepared', {
      type: 'run.prepared',
      worktreePath: '/tmp/preserved-worktree',
      workingDirectory: '/tmp/preserved-worktree',
      branchName: 'relayhub/cancel-test',
    });

    const requested = await store.requestRunCancellation(runId);
    expect(requested.value.runs[0]?.status).toBe('cancelling');
    await store.recordAgentEvent(runId, 'cancelled', { type: 'run.cancelled', reason: 'test' });
    const detail = await store.getTaskDetail(created.value.detail.task.id);
    expect(detail?.task.status).toBe('cancelled');
    expect(detail?.runs[0]?.status).toBe('cancelled');
    expect(await store.authorizeRunToken(runId, claimed.value?.executionToken ?? '')).toBe(false);
  });

  it('runs Builder, Reviewer, repair Builder, and second Reviewer as a durable causal chain', async () => {
    const created = await store.createTask({
      title: 'Dispatch independent Reviewer',
      description: 'Persist Builder facts before waking a separate Reviewer Run.',
      agentId: DEFAULT_MOCK_AGENT_ID,
      reviewerAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
      acceptanceCriteria: ['Reviewer receives the structured Handoff'],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const builderRunId = created.value.detail.task.currentRunId;
    await store.claimRun(builderRunId, 'handoff-builder');
    await store.recordAgentEvent(builderRunId, 'handoff-prepared', {
      type: 'run.prepared',
      worktreePath: '/tmp/relay-hub-review-fixture',
      workingDirectory: '/tmp/relay-hub-review-fixture',
      branchName: 'relayhub/review-fixture',
    });
    await store.recordAgentEvent(builderRunId, 'handoff-started', { type: 'run.started' });
    await expect(
      store.recordAgentEvent(builderRunId, 'handoff-wrong-target', {
        type: 'handoff.requested',
        handoff: {
          targetAgentId: DEFAULT_CODEX_AGENT_ID,
          objective: 'Bypass the configured Reviewer',
          summary: 'This target must be rejected.',
          artifactRefs: [],
          acceptanceCriteria: [],
        },
      }),
    ).rejects.toThrow('Handoff target must match the Task reviewerAgentId');
    await store.recordAgentEvent(builderRunId, 'handoff-requested', {
      type: 'handoff.requested',
      handoff: {
        targetAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
        objective: 'Review the completed Builder result',
        summary: 'Builder changed the implementation and ran the relevant tests.',
        artifactRefs: [{ kind: 'worktree', value: '/tmp/relay-hub-review-fixture' }],
        acceptanceCriteria: ['Reviewer receives the structured Handoff'],
      },
    });

    const pending = await store.getTaskDetail(created.value.detail.task.id);
    expect(pending?.task.status).toBe('running');
    expect(pending?.runs).toHaveLength(1);
    expect(pending?.handoffs).toMatchObject([
      {
        sourceRunId: builderRunId,
        targetAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
        status: 'pending',
        contextSummary: 'Builder changed the implementation and ran the relevant tests.',
      },
    ]);

    await store.recordAgentEvent(builderRunId, 'handoff-builder-completed', {
      type: 'run.completed',
      outcome: { summary: 'Builder completed successfully.', commandEvidence: [] },
    });
    const reviewing = await store.getTaskDetail(created.value.detail.task.id);
    const reviewerRun = reviewing?.runs.find((run) => run.parentRunId === builderRunId);
    expect(reviewing?.task.status).toBe('reviewing');
    expect(reviewing?.runs).toHaveLength(2);
    expect(reviewerRun).toMatchObject({
      agentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
      status: 'queued',
      triggerType: 'review',
    });
    expect(reviewing?.task.currentRunId).toBe(reviewerRun?.id);
    expect(reviewing?.handoffs[0]).toMatchObject({ status: 'dispatched', targetRunId: reviewerRun?.id });
    expect(reviewing?.events.at(-1)).toMatchObject({
      type: 'task.review_requested',
      payload: { targetAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID, targetRunId: reviewerRun?.id },
    });

    if (!reviewerRun) throw new Error('Reviewer Run was not created');
    const reviewerClaim = await store.claimRun(reviewerRun.id, 'handoff-reviewer');
    expect(reviewerClaim.value?.claimed.handoff).toMatchObject({
      sourceRunId: builderRunId,
      targetRunId: reviewerRun.id,
      status: 'dispatched',
    });
    await store.recordAgentEvent(reviewerRun.id, 'reviewer-started', { type: 'run.started' });
    await expect(
      store.recordAgentEvent(reviewerRun.id, 'reviewer-completed-without-verdict', {
        type: 'run.completed',
        outcome: { summary: 'Reviewer omitted the verdict.', commandEvidence: [] },
      }),
    ).rejects.toThrow('must submit a structured Review');
    await store.recordAgentEvent(reviewerRun.id, 'review-submitted', {
      type: 'review.submitted',
      review: {
        verdict: 'changes_requested',
        summary: 'The Builder result needs one repair.',
        findings: [
          {
            severity: 'should_fix',
            filePath: 'src/fixture.ts',
            lineStart: 7,
            title: 'Handle the missing branch',
            detail: 'The current branch does not satisfy the acceptance criterion.',
            suggestion: 'Add the missing branch and rerun verification.',
          },
        ],
      },
    });
    await store.recordAgentEvent(reviewerRun.id, 'reviewer-completed', {
      type: 'run.completed',
      outcome: { summary: 'Reviewer execution completed.', commandEvidence: [] },
    });
    const repairQueued = await store.getTaskDetail(created.value.detail.task.id);
    const repairRun = repairQueued?.runs.find((run) => run.triggerType === 'retry');
    expect(repairQueued?.task.status).toBe('queued');
    expect(repairQueued?.runs).toHaveLength(3);
    expect(repairRun).toMatchObject({
      agentId: DEFAULT_MOCK_AGENT_ID,
      parentRunId: reviewerRun.id,
      retryOfRunId: builderRunId,
      status: 'queued',
      attempt: 2,
      worktreePath: '/tmp/relay-hub-review-fixture',
    });
    expect(repairQueued?.reviews).toMatchObject([
      {
        runId: reviewerRun.id,
        round: 1,
        verdict: 'changes_requested',
        findings: [{ severity: 'should_fix', title: 'Handle the missing branch' }],
      },
    ]);
    expect(repairQueued?.events.slice(-2)).toMatchObject([
      { type: 'task.changes_requested' },
      {
        type: 'task.repair_requested',
        payload: { repairRunId: repairRun?.id, reviewRound: 1, nextReviewRound: 2 },
      },
    ]);

    if (!repairRun) throw new Error('Repair Run was not created');
    const repairClaim = await store.claimRun(repairRun.id, 'repair-builder');
    expect(repairClaim.value?.claimed.review).toMatchObject({
      round: 1,
      verdict: 'changes_requested',
      findings: [{ severity: 'should_fix', title: 'Handle the missing branch' }],
    });
    await store.recordAgentEvent(repairRun.id, 'repair-started', { type: 'run.started' });
    await store.recordAgentEvent(repairRun.id, 'repair-handoff', {
      type: 'handoff.requested',
      handoff: {
        targetAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
        objective: 'Review the repaired Builder result',
        summary: 'Builder addressed all actionable Findings.',
        artifactRefs: [{ kind: 'worktree', value: '/tmp/relay-hub-review-fixture' }],
        acceptanceCriteria: ['Reviewer receives the structured Handoff'],
      },
    });
    await store.recordAgentEvent(repairRun.id, 'repair-completed', {
      type: 'run.completed',
      outcome: { summary: 'Repair completed.', commandEvidence: [] },
    });
    const secondReviewing = await store.getTaskDetail(created.value.detail.task.id);
    const secondReviewerRun = secondReviewing?.runs.find(
      (run) => run.triggerType === 'review' && run.parentRunId === repairRun.id,
    );
    expect(secondReviewing?.task.status).toBe('reviewing');
    expect(secondReviewing?.runs).toHaveLength(4);
    if (!secondReviewerRun) throw new Error('Second Reviewer Run was not created');
    await store.claimRun(secondReviewerRun.id, 'second-reviewer');
    await store.recordAgentEvent(secondReviewerRun.id, 'second-reviewer-started', { type: 'run.started' });
    await store.recordAgentEvent(secondReviewerRun.id, 'second-review-submitted', {
      type: 'review.submitted',
      review: {
        verdict: 'approved',
        summary: 'The repaired result now satisfies the acceptance criteria.',
        findings: [],
      },
    });
    await store.recordAgentEvent(secondReviewerRun.id, 'second-reviewer-completed', {
      type: 'run.completed',
      outcome: { summary: 'Second review completed.', commandEvidence: [] },
    });
    const reviewed = await store.getTaskDetail(created.value.detail.task.id);
    expect(reviewed?.task.status).toBe('waiting_for_user');
    expect(reviewed?.reviews.map((review) => review.verdict)).toEqual(['changes_requested', 'approved']);
    expect(reviewed?.events.at(-1)).toMatchObject({
      type: 'task.review_approved',
      payload: { round: 2, reason: 'user_confirmation_required', verdict: 'approved' },
    });
    const confirmed = await store.confirmTaskCompletion(created.value.detail.task.id);
    expect(confirmed.value.task.status).toBe('completed');
    expect(confirmed.value.events.at(-1)?.type).toBe('task.user_confirmed');
  });

  it('returns control to the user when the Review round budget is exhausted', async () => {
    const created = await store.createTask({
      title: 'Bound the repair loop',
      description: 'Do not create another Builder Run after the configured Review budget.',
      agentId: DEFAULT_MOCK_AGENT_ID,
      reviewerAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
      acceptanceCriteria: ['At most one Review is allowed'],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 1,
    });
    const builderRunId = created.value.detail.task.currentRunId;
    await store.claimRun(builderRunId, 'bounded-builder');
    await store.recordAgentEvent(builderRunId, 'bounded-builder-started', { type: 'run.started' });
    await store.recordAgentEvent(builderRunId, 'bounded-handoff', {
      type: 'handoff.requested',
      handoff: {
        targetAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
        objective: 'Review within a single-round budget',
        summary: 'Builder requests the only permitted Review.',
        artifactRefs: [],
        acceptanceCriteria: ['At most one Review is allowed'],
      },
    });
    await store.recordAgentEvent(builderRunId, 'bounded-builder-completed', {
      type: 'run.completed',
      outcome: { summary: 'Builder completed.', commandEvidence: [] },
    });
    const reviewing = await store.getTaskDetail(created.value.detail.task.id);
    const reviewerRun = reviewing?.runs.find((run) => run.triggerType === 'review');
    if (!reviewerRun) throw new Error('Bounded Reviewer Run was not created');
    await store.claimRun(reviewerRun.id, 'bounded-reviewer');
    await store.recordAgentEvent(reviewerRun.id, 'bounded-reviewer-started', { type: 'run.started' });
    await store.recordAgentEvent(reviewerRun.id, 'bounded-review-submitted', {
      type: 'review.submitted',
      review: {
        verdict: 'changes_requested',
        summary: 'The configured Review budget is now exhausted.',
        findings: [{
          severity: 'should_fix',
          title: 'Keep this finding for the user',
          detail: 'The platform must preserve the issue without starting an unbounded loop.',
        }],
      },
    });
    await store.recordAgentEvent(reviewerRun.id, 'bounded-reviewer-completed', {
      type: 'run.completed',
      outcome: { summary: 'Reviewer completed.', commandEvidence: [] },
    });

    const exhausted = await store.getTaskDetail(created.value.detail.task.id);
    expect(exhausted?.task.status).toBe('waiting_for_user');
    expect(exhausted?.runs).toHaveLength(2);
    expect(exhausted?.runs.some((run) => run.triggerType === 'retry')).toBe(false);
    expect(exhausted?.events.at(-1)).toMatchObject({
      type: 'task.repair_limit_reached',
      payload: { round: 1, reason: 'max_review_rounds_reached', verdict: 'changes_requested' },
    });
  });
});
