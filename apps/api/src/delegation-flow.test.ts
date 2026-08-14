import { DEFAULT_WORKSPACE_ID, type AgentProfile } from '@relay-hub/contracts';
import { createDatabase } from '@relay-hub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresStore } from './store.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;
let database: ReturnType<typeof createDatabase> | undefined;
let store: PostgresStore;

async function createAgent(name: string, capabilities: ('implement' | 'review')[], specialties: ('research' | 'backend' | 'qa')[] = []): Promise<AgentProfile> {
  const agent = await store.createAgentProfile(DEFAULT_WORKSPACE_ID, {
    name: `${name} ${crypto.randomUUID().slice(0, 8)}`,
    adapterType: 'mock',
    capabilities,
    specialties,
    enabled: true,
  });
  if (!agent) throw new Error(`Agent was not created: ${name}`);
  return agent;
}

suite('Agent-led task delegation', () => {
  beforeAll(() => {
    database = createDatabase(testDatabaseUrl);
    store = new PostgresStore(database.db);
  });

  afterAll(async () => database?.close());

  it('requires approval, creates isolated child Tasks, enforces implementation Review, and resumes the Lead once', async () => {
    const lead = await createAgent('Delegation Lead', ['implement']);
    const analyst = await createAgent('Research specialist', ['implement'], ['research']);
    const builder = await createAgent('Backend specialist', ['implement'], ['backend']);
    await createAgent('Independent QA', ['review'], ['qa']);
    const created = await store.createTask({
      title: 'Deliver a delegated feature',
      description: 'The Lead should split research and implementation into independently owned work.',
      agentId: lead.id,
      acceptanceCriteria: ['The Lead synthesizes verified child reports'],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const parentTaskId = created.value.detail.task.id;
    const sourceRunId = created.value.detail.task.currentRunId;
    await store.claimRun(sourceRunId, 'delegation-lead');
    await store.recordAgentEvent(sourceRunId, 'lead-started', { type: 'run.started' });
    await store.recordAgentEvent(sourceRunId, 'delegation-requested', {
      type: 'delegation.requested',
      delegationPlan: {
        reportingMode: 'final_only',
        assignments: [
          {
            targetAgentId: analyst.id,
            kind: 'analysis',
            title: 'Clarify requirements',
            objective: 'Produce a bounded requirement analysis.',
            scope: 'Analyze only; do not modify code.',
            deliverables: ['Requirement analysis'],
            acceptanceCriteria: ['Risks and boundaries are explicit'],
            requiredSpecialties: ['research'],
          },
          {
            targetAgentId: builder.id,
            kind: 'implementation',
            title: 'Implement the feature slice',
            objective: 'Implement a verifiable feature slice.',
            scope: 'Change only the files required by the accepted design.',
            deliverables: ['Working implementation'],
            acceptanceCriteria: ['Independent Review approves the result'],
            requiredSpecialties: ['backend'],
          },
        ],
      },
    });
    await store.recordAgentEvent(sourceRunId, 'lead-completed', {
      type: 'run.completed',
      outcome: {
        summary: 'Prepared a two-part division of work.',
        commandEvidence: [],
        nextAction: { type: 'delegate', reason: 'The assignments are independent deliverables.' },
      },
    });

    const proposed = await store.getTaskDetail(parentTaskId);
    expect(proposed?.task.status).toBe('waiting_for_user');
    expect(proposed?.delegationPlans[0]).toMatchObject({ status: 'pending', sourceAgentId: lead.id });
    expect(proposed?.delegations).toHaveLength(2);
    await store.approveDelegationPlan(proposed!.delegationPlans[0]!.id);

    const approved = await store.getTaskDetail(parentTaskId);
    expect(approved?.task.status).toBe('waiting_on_children');
    expect(approved?.coordination.route.action).toBe('delegate');
    expect(approved?.delegations.every((assignment) => assignment.childTaskId && assignment.childThreadId)).toBe(true);
    const analysisAssignment = approved!.delegations.find((assignment) => assignment.kind === 'analysis')!;
    const implementationAssignment = approved!.delegations.find((assignment) => assignment.kind === 'implementation')!;
    expect(analysisAssignment.reviewerAgentId).toBeUndefined();
    expect(implementationAssignment.reviewerAgentId).toBeTruthy();
    expect(implementationAssignment.reviewerAgentId).not.toBe(builder.id);
    const reviewerId = implementationAssignment.reviewerAgentId!;

    const analysisTask = await store.getTaskDetail(analysisAssignment.childTaskId!);
    const analysisRunId = analysisTask!.task.currentRunId;
    const analysisClaim = await store.claimRun(analysisRunId, 'delegation-analysis');
    expect(analysisClaim.value?.claimed.delegation).toMatchObject({ id: analysisAssignment.id, kind: 'analysis' });
    await store.recordAgentEvent(analysisRunId, 'analysis-started', { type: 'run.started' });
    await store.recordAgentEvent(analysisRunId, 'analysis-completed', {
      type: 'run.completed',
      outcome: { summary: 'Requirements are bounded and risks are explicit.', commandEvidence: [], nextAction: { type: 'complete', reason: 'Analysis is complete.' } },
    });
    expect((await store.getTaskDetail(analysisAssignment.childTaskId!))?.task.status).toBe('completed');
    expect((await store.getTaskDetail(parentTaskId))?.task.status).toBe('waiting_on_children');

    const implementationTask = await store.getTaskDetail(implementationAssignment.childTaskId!);
    const builderRunId = implementationTask!.task.currentRunId;
    await store.claimRun(builderRunId, 'delegation-builder');
    await store.recordAgentEvent(builderRunId, 'builder-started', { type: 'run.started' });
    await store.recordAgentEvent(builderRunId, 'review-requested', {
      type: 'handoff.requested',
      handoff: {
        targetAgentId: reviewerId,
        objective: 'Review the delegated implementation.',
        summary: 'The implementation slice is ready for independent verification.',
        nextAction: { type: 'request_review', targetAgentId: reviewerId, reason: 'Implementation work requires independent Review.' },
      },
    });
    await store.recordAgentEvent(builderRunId, 'builder-completed', {
      type: 'run.completed',
      outcome: { summary: 'Implementation completed and verified locally.', commandEvidence: [], nextAction: { type: 'request_review', targetAgentId: reviewerId, reason: 'Ready for Review.' } },
    });
    const reviewing = await store.getTaskDetail(implementationAssignment.childTaskId!);
    const reviewRun = reviewing!.runs.find((run) => run.triggerType === 'review')!;
    await store.claimRun(reviewRun.id, 'delegation-reviewer');
    await store.recordAgentEvent(reviewRun.id, 'review-started', { type: 'run.started' });
    await store.recordAgentEvent(reviewRun.id, 'review-submitted', { type: 'review.submitted', review: { verdict: 'approved', summary: 'Implementation satisfies the delegated acceptance criteria.', findings: [] } });
    await store.recordAgentEvent(reviewRun.id, 'review-completed', { type: 'run.completed', outcome: { summary: 'Independent Review approved the implementation.', commandEvidence: [] } });

    const resumed = await store.getTaskDetail(parentTaskId);
    expect(resumed?.delegationPlans[0]).toMatchObject({ status: 'resumed' });
    expect(resumed?.delegations.map((assignment) => assignment.status)).toEqual(['completed', 'completed']);
    expect(resumed?.delegations.every((assignment) => assignment.report?.summary)).toBe(true);
    expect(resumed?.task.status).toBe('queued');
    const continuationRun = resumed!.runs.find((run) => run.triggerType === 'continuation')!;
    expect(resumed?.task.currentRunId).toBe(continuationRun.id);
    const continuationClaim = await store.claimRun(continuationRun.id, 'delegation-lead-resumed');
    expect(continuationClaim.value?.claimed.delegationPlan).toMatchObject({ status: 'resumed' });
    expect(continuationClaim.value?.claimed.delegations).toHaveLength(2);
  });
});
