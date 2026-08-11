import {
  DEFAULT_MOCK_REVIEWER_AGENT_ID,
  DEFAULT_WORKSPACE_ID,
  MAX_SEQUENTIAL_HANDOFFS,
  type AgentEvent,
  type AgentProfile,
} from '@relay-hub/contracts';
import {
  agentProfiles as agentProfilesTable,
  createDatabase,
  outboxEvents,
  tasks,
  workspaces,
} from '@relay-hub/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresStore } from './store.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;
let database: ReturnType<typeof createDatabase> | undefined;
let store: PostgresStore;

function uniqueName(prefix: string): string {
  return `${prefix} ${crypto.randomUUID().slice(0, 8)}`;
}

async function createMockAgent(name: string, capabilities: ('implement' | 'review')[] = ['implement']): Promise<AgentProfile> {
  const agent = await store.createAgentProfile(DEFAULT_WORKSPACE_ID, {
    name,
    adapterType: 'mock',
    capabilities,
    enabled: true,
  });
  if (!agent) throw new Error(`Agent was not created: ${name}`);
  return agent;
}

function genericHandoff(targetAgentId: string, objective = 'Continue the Task'): AgentEvent {
  return {
    type: 'handoff.requested',
    handoff: {
      targetAgentId,
      objective,
      summary: 'Source Agent finished its step and passes the full context.',
      artifactRefs: [{ kind: 'worktree', value: '/tmp/relay-hub-sequential' }],
      evidenceRefs: [{ kind: 'command', value: 'pnpm test', label: 'succeeded' }],
      decisions: ['Source Agent recorded a deterministic decision.'],
      openQuestions: [],
      risks: [],
      nextAction: { type: 'handoff', targetAgentId, reason: 'The target Agent owns the next step.' },
    },
  };
}

async function startCurrentRun(taskId: string, tag: string): Promise<string> {
  const detail = await store.getTaskDetail(taskId);
  const runId = detail?.task.currentRunId;
  if (!runId) throw new Error(`Task has no current Run: ${taskId}`);
  await store.claimRun(runId, `worker-${tag}`);
  await store.recordAgentEvent(runId, `started-${tag}`, { type: 'run.started' });
  return runId;
}

async function outboxRowsFor(runId: string) {
  return database!.db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, runId));
}

suite('sequential handoff integration', () => {
  beforeAll(() => {
    database = createDatabase(testDatabaseUrl);
    store = new PostgresStore(database.db);
  });

  afterAll(async () => {
    await database?.close();
  });

  it('routes A -> B with an isolated target Run, snapshot, token, and consumed Handoff V2', async () => {
    const agentA = await createMockAgent(uniqueName('Sequential A'));
    const agentB = await createMockAgent(uniqueName('Sequential B'));
    const created = await store.createTask({
      title: 'A hands the Task to B',
      description: 'The first Agent finishes and hands over with a structured result.',
      agentId: agentA.id,
      acceptanceCriteria: ['B receives the canonical criteria from the platform'],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const taskId = created.value.detail.task.id;
    const runA = created.value.detail.task.currentRunId;
    await store.claimRun(runA, 'seq-a');
    await store.recordAgentEvent(runA, 'seq-a-started', { type: 'run.started' });

    await store.recordAgentEvent(runA, 'seq-a-handoff', genericHandoff(agentB.id, 'B continues the work'));
    const pending = await store.getTaskDetail(taskId);
    expect(pending?.task.status).toBe('running');
    expect(pending?.runs).toHaveLength(1);
    expect(pending?.handoffs).toMatchObject([
      { sourceRunId: runA, targetAgentId: agentB.id, status: 'pending' },
    ]);
    expect(pending?.coordination).toMatchObject({
      owner: { kind: 'agent', agentId: agentA.id, reason: 'handoff_pending' },
      route: { action: 'handoff', targetAgentId: agentB.id },
    });

    await store.recordAgentEvent(runA, 'seq-a-completed', {
      type: 'run.completed',
      outcome: {
        summary: 'A finished.',
        commandEvidence: [],
        nextAction: { type: 'handoff', targetAgentId: agentB.id, reason: 'B owns the next step.' },
      },
    });
    const dispatched = await store.getTaskDetail(taskId);
    const runB = dispatched?.runs.find((run) => run.parentRunId === runA);
    expect(dispatched?.task.status).toBe('running');
    expect(dispatched?.runs).toHaveLength(2);
    expect(runB).toMatchObject({
      agentId: agentB.id,
      agentProfileSnapshot: { id: agentB.id, name: agentB.name },
      status: 'queued',
      triggerType: 'handoff',
    });
    expect(dispatched?.task.currentRunId).toBe(runB?.id);
    expect(dispatched?.handoffs[0]).toMatchObject({ status: 'dispatched', targetRunId: runB?.id });
    expect(dispatched?.events.at(-1)).toMatchObject({
      type: 'task.handoff_dispatched',
      payload: {
        reason: 'handoff_dispatch_available',
        handoffId: dispatched?.handoffs[0]?.id,
        targetAgentId: agentB.id,
        targetRunId: runB?.id,
      },
    });
    expect(dispatched?.coordination).toMatchObject({
      owner: { kind: 'platform', reason: 'handoff_waiting_for_dispatch' },
      route: { action: 'handoff', targetAgentId: agentB.id },
    });
    expect(await outboxRowsFor(runB!.id)).toHaveLength(1);

    const claimB = await store.claimRun(runB!.id, 'seq-b');
    expect(claimB.value?.claimed.agent.id).toBe(agentB.id);
    expect(claimB.value?.executionToken).toMatch(/^rht_/);
    const claimedHandoff = claimB.value?.claimed.handoff;
    expect(claimedHandoff).toMatchObject({
      bundleVersion: 2,
      sourceRunId: runA,
      targetRunId: runB!.id,
      status: 'dispatched',
      objective: 'B continues the work',
      acceptanceCriteria: ['B receives the canonical criteria from the platform'],
      nextAction: { type: 'handoff', targetAgentId: agentB.id },
    });
    if (!claimedHandoff?.contentDigest) throw new Error('Claim is missing the Handoff digest');
    await store.recordAgentEvent(runB!.id, 'seq-b-consumed', {
      type: 'handoff.consumed',
      handoffId: claimedHandoff.id,
      bundleVersion: claimedHandoff.bundleVersion,
      contentDigest: claimedHandoff.contentDigest,
    });
    const accepted = await store.getTaskDetail(taskId);
    expect(accepted?.handoffs[0]?.status).toBe('accepted');
    await store.recordAgentEvent(runB!.id, 'seq-b-started', { type: 'run.started' });
    const owned = await store.getTaskDetail(taskId);
    expect(owned?.coordination).toMatchObject({
      owner: { kind: 'agent', agentId: agentB.id, label: agentB.name },
    });

    await store.recordAgentEvent(runB!.id, 'seq-b-completed', {
      type: 'run.completed',
      outcome: {
        summary: 'B finished.',
        commandEvidence: [],
        nextAction: { type: 'wait_for_user', reason: 'No further Agent step.' },
      },
    });
    const finished = await store.getTaskDetail(taskId);
    expect(finished?.task.status).toBe('waiting_for_user');
    expect(finished?.runs).toHaveLength(2);
    expect(finished?.events.at(-1)?.type).toBe('task.waiting_for_review');
  });

  it('chains A -> B -> C while each Handoff carries its own digest', async () => {
    const agentA = await createMockAgent(uniqueName('Chain A'));
    const agentB = await createMockAgent(uniqueName('Chain B'));
    const agentC = await createMockAgent(uniqueName('Chain C'));
    const created = await store.createTask({
      title: 'A hands to B who hands to C',
      description: 'Two consecutive sequential Handoffs in one Task.',
      agentId: agentA.id,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const taskId = created.value.detail.task.id;

    const runA = await startCurrentRun(taskId, 'chain-a');
    await store.recordAgentEvent(runA, 'chain-a-handoff', genericHandoff(agentB.id));
    await store.recordAgentEvent(runA, 'chain-a-completed', {
      type: 'run.completed',
      outcome: { summary: 'A done.', commandEvidence: [] },
    });

    const runB = await startCurrentRun(taskId, 'chain-b');
    const detailB = await store.getTaskDetail(taskId);
    expect(detailB?.runs.find((run) => run.id === runB)).toMatchObject({
      agentId: agentB.id,
      triggerType: 'handoff',
      parentRunId: runA,
    });
    await store.recordAgentEvent(runB, 'chain-b-handoff', genericHandoff(agentC.id));
    await store.recordAgentEvent(runB, 'chain-b-completed', {
      type: 'run.completed',
      outcome: { summary: 'B done.', commandEvidence: [] },
    });

    const detailC = await store.getTaskDetail(taskId);
    const runC = detailC?.runs.find((run) => run.parentRunId === runB);
    expect(detailC?.task.status).toBe('running');
    expect(detailC?.runs).toHaveLength(3);
    expect(runC).toMatchObject({ agentId: agentC.id, triggerType: 'handoff' });
    expect(detailC?.task.currentRunId).toBe(runC?.id);
    expect(detailC?.handoffs).toHaveLength(2);
    expect(detailC?.handoffs[1]).toMatchObject({
      sourceRunId: runB,
      targetAgentId: agentC.id,
      status: 'dispatched',
      targetRunId: runC?.id,
    });
  });

  it('lets a handoff target request the fixed Reviewer but never submit a Review itself', async () => {
    const agentA = await createMockAgent(uniqueName('Route A'));
    const agentB = await createMockAgent(uniqueName('Route B'), ['implement', 'review']);
    const created = await store.createTask({
      title: 'B finishes and requests the formal Reviewer',
      description: 'A generic Handoff target keeps working until it requests review.',
      agentId: agentA.id,
      reviewerAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const taskId = created.value.detail.task.id;
    const runA = await startCurrentRun(taskId, 'route-a');
    await store.recordAgentEvent(runA, 'route-a-handoff', genericHandoff(agentB.id));
    await store.recordAgentEvent(runA, 'route-a-completed', {
      type: 'run.completed',
      outcome: { summary: 'A done.', commandEvidence: [] },
    });

    const runB = await startCurrentRun(taskId, 'route-b');
    await expect(
      store.recordAgentEvent(runB, 'route-b-review', {
        type: 'review.submitted',
        review: { verdict: 'approved', summary: 'B has no Review authority.', findings: [] },
      }),
    ).rejects.toThrow('Only Reviewer Runs can submit a Review');

    await store.recordAgentEvent(runB, 'route-b-handoff', {
      type: 'handoff.requested',
      handoff: {
        targetAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
        objective: 'Review the finished chain',
        summary: 'B finished the work and requests the configured Reviewer.',
        nextAction: {
          type: 'request_review',
          targetAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
          reason: 'Independent verdict required.',
        },
      },
    });
    await store.recordAgentEvent(runB, 'route-b-completed', {
      type: 'run.completed',
      outcome: {
        summary: 'B done.',
        commandEvidence: [],
        nextAction: {
          type: 'request_review',
          targetAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
          reason: 'Independent verdict required.',
        },
      },
    });
    const reviewing = await store.getTaskDetail(taskId);
    const reviewRun = reviewing?.runs.find((run) => run.triggerType === 'review');
    expect(reviewing?.task.status).toBe('reviewing');
    expect(reviewRun).toMatchObject({
      agentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
      parentRunId: runB,
      status: 'queued',
    });
    expect(reviewing?.events.at(-1)?.type).toBe('task.review_requested');
  });

  it('rejects unknown, disabled, cross-workspace, and self targets without creating Runs', async () => {
    const agentA = await createMockAgent(uniqueName('Guard A'));
    const disabled = await createMockAgent(uniqueName('Guard Disabled'));
    const disabledUpdated = await store.updateAgentProfile(disabled.id, {
      name: disabled.name,
      adapterType: 'mock',
      capabilities: ['implement'],
      enabled: false,
    });
    expect(disabledUpdated?.enabled).toBe(false);
    const otherWorkspaceId = crypto.randomUUID();
    await database!.db.insert(workspaces).values({
      id: otherWorkspaceId,
      name: uniqueName('Other Workspace'),
      rootPath: '/tmp/relay-hub-other-workspace',
    });
    const outsider = await createMockAgent(uniqueName('Guard Outsider'));
    await database!.db
      .update(agentProfilesTable)
      .set({ workspaceId: otherWorkspaceId })
      .where(eq(agentProfilesTable.id, outsider.id));

    const created = await store.createTask({
      title: 'Invalid targets are rejected deterministically',
      description: 'Unknown, disabled, cross-workspace, and self targets never dispatch.',
      agentId: agentA.id,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const taskId = created.value.detail.task.id;
    const runA = await startCurrentRun(taskId, 'guard-a');
    const outboxBefore = (await database!.db.select({ id: outboxEvents.id }).from(outboxEvents)).length;

    await expect(
      store.recordAgentEvent(runA, 'guard-unknown', genericHandoff(crypto.randomUUID())),
    ).rejects.toThrow('Invalid Handoff target AgentProfile');
    await expect(
      store.recordAgentEvent(runA, 'guard-disabled', genericHandoff(disabled.id)),
    ).rejects.toThrow('Invalid Handoff target AgentProfile');
    await expect(
      store.recordAgentEvent(runA, 'guard-outsider', genericHandoff(outsider.id)),
    ).rejects.toThrow('Invalid Handoff target AgentProfile');
    await expect(
      store.recordAgentEvent(runA, 'guard-self', genericHandoff(agentA.id)),
    ).rejects.toThrow('different AgentProfile');

    const detail = await store.getTaskDetail(taskId);
    expect(detail?.handoffs).toHaveLength(0);
    expect(detail?.runs).toHaveLength(1);
    expect(detail?.task.status).toBe('running');
    const outboxAfter = (await database!.db.select({ id: outboxEvents.id }).from(outboxEvents)).length;
    expect(outboxAfter).toBe(outboxBefore);
  });

  it('rejects Handoffs from historical or non-current Runs', async () => {
    const agentA = await createMockAgent(uniqueName('History A'));
    const agentB = await createMockAgent(uniqueName('History B'));
    const created = await store.createTask({
      title: 'Only the current Run can route',
      description: 'Historical and non-current Runs cannot create Handoffs.',
      agentId: agentA.id,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const taskId = created.value.detail.task.id;
    const runA = await startCurrentRun(taskId, 'history-a');
    await store.recordAgentEvent(runA, 'history-a-completed', {
      type: 'run.completed',
      outcome: { summary: 'A done.', commandEvidence: [] },
    });
    await expect(
      store.recordAgentEvent(runA, 'history-a-late-handoff', genericHandoff(agentB.id)),
    ).rejects.toThrow('Cannot request handoff while run is succeeded');

    const second = await store.createTask({
      title: 'A stale current pointer is rejected',
      description: 'A running but non-current Run cannot route the Task.',
      agentId: agentA.id,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const secondTaskId = second.value.detail.task.id;
    const runB = await startCurrentRun(secondTaskId, 'history-b');
    await database!.db
      .update(tasks)
      .set({ currentRunId: null })
      .where(eq(tasks.id, secondTaskId));
    await expect(
      store.recordAgentEvent(runB, 'history-b-handoff', genericHandoff(agentB.id)),
    ).rejects.toThrow('Only the current Task Run can request a Handoff');
  });

  it('rejects the Handoff and returns the Task to the user when the target is disabled mid-flight', async () => {
    const agentA = await createMockAgent(uniqueName('Flight A'));
    const agentB = await createMockAgent(uniqueName('Flight B'));
    const created = await store.createTask({
      title: 'The target disappears before dispatch',
      description: 'Disabling the target between request and completion rejects the Handoff.',
      agentId: agentA.id,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const taskId = created.value.detail.task.id;
    const runA = await startCurrentRun(taskId, 'flight-a');
    await store.recordAgentEvent(runA, 'flight-a-handoff', genericHandoff(agentB.id));
    const outboxBefore = (await database!.db.select({ id: outboxEvents.id }).from(outboxEvents)).length;
    await store.updateAgentProfile(agentB.id, {
      name: agentB.name,
      adapterType: 'mock',
      capabilities: ['implement'],
      enabled: false,
    });
    await store.recordAgentEvent(runA, 'flight-a-completed', {
      type: 'run.completed',
      outcome: { summary: 'A done.', commandEvidence: [] },
    });

    const detail = await store.getTaskDetail(taskId);
    expect(detail?.task.status).toBe('waiting_for_user');
    expect(detail?.runs).toHaveLength(1);
    expect(detail?.handoffs).toMatchObject([{ status: 'rejected' }]);
    expect(detail?.events.at(-1)).toMatchObject({
      type: 'task.handoff_rejected',
      payload: { reason: 'handoff_target_unavailable', targetAgentId: agentB.id },
    });
    expect(detail?.coordination).toMatchObject({ owner: { kind: 'user' } });
    const outboxAfter = (await database!.db.select({ id: outboxEvents.id }).from(outboxEvents)).length;
    expect(outboxAfter).toBe(outboxBefore);
  });

  it('deduplicates handoff.requested and run.completed so only one target Run exists', async () => {
    const agentA = await createMockAgent(uniqueName('Idem A'));
    const agentB = await createMockAgent(uniqueName('Idem B'));
    const created = await store.createTask({
      title: 'Duplicate events stay idempotent',
      description: 'Repeated events never create a second target Run.',
      agentId: agentA.id,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const taskId = created.value.detail.task.id;
    const runA = await startCurrentRun(taskId, 'idem-a');

    await store.recordAgentEvent(runA, 'idem-handoff', genericHandoff(agentB.id));
    const duplicateHandoff = await store.recordAgentEvent(runA, 'idem-handoff', genericHandoff(agentB.id));
    expect(duplicateHandoff.emitted).toHaveLength(0);
    const completed = await store.recordAgentEvent(runA, 'idem-completed', {
      type: 'run.completed',
      outcome: { summary: 'A done.', commandEvidence: [] },
    });
    const duplicateCompleted = await store.recordAgentEvent(runA, 'idem-completed', {
      type: 'run.completed',
      outcome: { summary: 'A done.', commandEvidence: [] },
    });
    expect(duplicateCompleted.emitted).toHaveLength(0);

    const detail = await store.getTaskDetail(taskId);
    expect(detail?.handoffs).toHaveLength(1);
    expect(detail?.runs).toHaveLength(2);
    expect(completed.emitted.map((event) => event.type)).toContain('task.handoff_dispatched');
  });

  it('rejects a tampered Handoff digest on the generic chain', async () => {
    const agentA = await createMockAgent(uniqueName('Digest A'));
    const agentB = await createMockAgent(uniqueName('Digest B'));
    const created = await store.createTask({
      title: 'Tampered digests are rejected',
      description: 'The target Worker must prove the persisted digest.',
      agentId: agentA.id,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const taskId = created.value.detail.task.id;
    const runA = await startCurrentRun(taskId, 'digest-a');
    await store.recordAgentEvent(runA, 'digest-a-handoff', genericHandoff(agentB.id));
    await store.recordAgentEvent(runA, 'digest-a-completed', {
      type: 'run.completed',
      outcome: { summary: 'A done.', commandEvidence: [] },
    });
    const detail = await store.getTaskDetail(taskId);
    const runB = detail?.task.currentRunId;
    if (!runB || runB === runA) throw new Error('Target Run was not dispatched');
    const claimB = await store.claimRun(runB, 'digest-b');
    const claimedHandoff = claimB.value?.claimed.handoff;
    if (!claimedHandoff?.contentDigest) throw new Error('Claim is missing the Handoff digest');
    await expect(
      store.recordAgentEvent(runB, 'digest-tampered', {
        type: 'handoff.consumed',
        handoffId: claimedHandoff.id,
        bundleVersion: claimedHandoff.bundleVersion,
        contentDigest: 'f'.repeat(64),
      }),
    ).rejects.toThrow('integrity metadata');
    const unchanged = await store.getTaskDetail(taskId);
    expect(unchanged?.handoffs[0]?.status).toBe('dispatched');
  });

  it('allows six sequential Handoffs and rejects the seventh with a stable audit reason', async () => {
    const agentA = await createMockAgent(uniqueName('Budget A'));
    const agentB = await createMockAgent(uniqueName('Budget B'));
    const created = await store.createTask({
      title: 'The sequential Handoff budget is enforced',
      description: 'Six Handoffs may dispatch; the seventh returns the Task to the user.',
      agentId: agentA.id,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const taskId = created.value.detail.task.id;
    let target = agentB;
    let other = agentA;
    for (let round = 1; round <= MAX_SEQUENTIAL_HANDOFFS + 1; round += 1) {
      const runId = await startCurrentRun(taskId, `budget-${round}`);
      await store.recordAgentEvent(runId, `budget-handoff-${round}`, genericHandoff(target.id));
      await store.recordAgentEvent(runId, `budget-completed-${round}`, {
        type: 'run.completed',
        outcome: { summary: `Round ${round} done.`, commandEvidence: [] },
      });
      [target, other] = [other, target];
    }

    const detail = await store.getTaskDetail(taskId);
    expect(detail?.task.status).toBe('waiting_for_user');
    expect(detail?.runs).toHaveLength(MAX_SEQUENTIAL_HANDOFFS + 1);
    expect(detail?.handoffs).toHaveLength(MAX_SEQUENTIAL_HANDOFFS + 1);
    expect(detail?.handoffs.at(-1)).toMatchObject({ status: 'rejected' });
    expect(detail?.handoffs.slice(0, -1).every((handoff) => handoff.status === 'dispatched')).toBe(true);
    expect(detail?.events.at(-1)).toMatchObject({
      type: 'task.handoff_rejected',
      payload: { reason: 'handoff_budget_exhausted' },
    });
    const dispatchEvents = detail?.events.filter((event) => event.type === 'task.handoff_dispatched') ?? [];
    expect(dispatchEvents).toHaveLength(MAX_SEQUENTIAL_HANDOFFS);
  });

  it('returns only the minimal enabled-Agent directory on claim', async () => {
    const agentA = await createMockAgent(uniqueName('Directory A'));
    const agentB = await createMockAgent(uniqueName('Directory B'));
    const disabled = await createMockAgent(uniqueName('Directory Off'));
    await store.updateAgentProfile(disabled.id, {
      name: disabled.name,
      adapterType: 'mock',
      capabilities: ['implement'],
      enabled: false,
    });
    const created = await store.createTask({
      title: 'Claim exposes the minimal routing directory',
      description: 'Only id, name, and capabilities of other enabled Agents are visible.',
      agentId: agentA.id,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const claim = await store.claimRun(created.value.detail.task.currentRunId, 'directory-worker');
    const targets = claim.value?.claimed.handoffTargets ?? [];
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some((target) => target.id === agentB.id)).toBe(true);
    expect(targets.some((target) => target.id === agentA.id)).toBe(false);
    expect(targets.some((target) => target.id === disabled.id)).toBe(false);
    for (const target of targets) {
      expect(Object.keys(target).sort()).toEqual(['capabilities', 'id', 'name']);
    }
  });

  it('keeps one outbound Handoff per source Run', async () => {
    const agentA = await createMockAgent(uniqueName('Single A'));
    const agentB = await createMockAgent(uniqueName('Single B'));
    const created = await store.createTask({
      title: 'A Run hands off at most once',
      description: 'The second outbound Handoff from the same Run is rejected.',
      agentId: agentA.id,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const taskId = created.value.detail.task.id;
    const runA = await startCurrentRun(taskId, 'single-a');
    await store.recordAgentEvent(runA, 'single-handoff', genericHandoff(agentB.id));
    await expect(
      store.recordAgentEvent(runA, 'single-handoff-again', genericHandoff(agentB.id)),
    ).rejects.toThrow('already has a Handoff');
  });
});
