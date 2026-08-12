import { DEFAULT_WORKSPACE_ID, type AgentProfile } from '@relay-hub/contracts';
import { createDatabase } from '@relay-hub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresStore } from './store.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;
let database: ReturnType<typeof createDatabase> | undefined;
let store: PostgresStore;

async function createMockAgent(prefix: string): Promise<AgentProfile> {
  const agent = await store.createAgentProfile(DEFAULT_WORKSPACE_ID, {
    name: `${prefix} ${crypto.randomUUID().slice(0, 8)}`,
    adapterType: 'mock',
    capabilities: ['implement'],
    enabled: true,
  });
  if (!agent) throw new Error(`Agent was not created: ${prefix}`);
  return agent;
}

suite('controlled Agent consultation', () => {
  beforeAll(() => {
    database = createDatabase(testDatabaseUrl);
    store = new PostgresStore(database.db);
  });

  afterAll(async () => {
    await database?.close();
  });

  it('runs source -> read-only consultation -> original Agent continuation without transferring responsibility', async () => {
    const sourceAgent = await createMockAgent('Consult source');
    const consultingAgent = await createMockAgent('Consult specialist');
    const created = await store.createTask({
      title: 'Ask a specialist and continue',
      description: 'The responsible Agent needs one bounded architectural opinion.',
      agentId: sourceAgent.id,
      acceptanceCriteria: ['The original Agent synthesizes the final result'],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const taskId = created.value.detail.task.id;
    const sourceRunId = created.value.detail.task.currentRunId;

    await store.claimRun(sourceRunId, 'consult-source-worker');
    await store.recordAgentEvent(sourceRunId, 'source-prepared', {
      type: 'run.prepared',
      worktreePath: '/tmp/relay-hub-consultation',
      workingDirectory: '/tmp/relay-hub-consultation/project',
      branchName: 'relay/task-consultation',
    });
    await store.recordAgentEvent(sourceRunId, 'source-started', { type: 'run.started' });
    await store.recordAgentEvent(sourceRunId, 'consult-requested', {
      type: 'consultation.requested',
      consultation: {
        targetAgentId: consultingAgent.id,
        question: 'Should the platform keep Consultation distinct from Handoff?',
        contextSummary: 'The source Agent remains accountable for the Task and only needs bounded advice.',
      },
    });

    const pending = await store.getTaskDetail(taskId);
    expect(pending?.consultations).toMatchObject([
      {
        sourceRunId,
        sourceAgentId: sourceAgent.id,
        targetAgentId: consultingAgent.id,
        status: 'pending',
      },
    ]);
    expect(pending?.task.currentRunId).toBe(sourceRunId);

    await store.recordAgentEvent(sourceRunId, 'source-completed', {
      type: 'run.completed',
      outcome: {
        summary: 'Prepared the bounded consultation.',
        publicMessage: 'I am consulting a specialist and will continue after it answers.',
        commandEvidence: [],
        nextAction: {
          type: 'consult',
          targetAgentId: consultingAgent.id,
          reason: 'A separate architectural perspective is useful.',
        },
      },
    });

    const dispatched = await store.getTaskDetail(taskId);
    const consultationRun = dispatched?.runs.find((run) => run.triggerType === 'consult');
    expect(consultationRun).toMatchObject({
      agentId: consultingAgent.id,
      parentRunId: sourceRunId,
      status: 'queued',
      worktreePath: '/tmp/relay-hub-consultation',
      workingDirectory: '/tmp/relay-hub-consultation/project',
    });
    expect(dispatched?.task.status).toBe('running');
    expect(dispatched?.task.currentRunId).toBe(consultationRun?.id);
    expect(dispatched?.coordination).toMatchObject({
      owner: { kind: 'platform', reason: 'consultation_waiting_for_dispatch' },
      route: { action: 'consult', targetAgentId: consultingAgent.id },
    });

    const consultationClaim = await store.claimRun(consultationRun!.id, 'consult-specialist-worker');
    expect(consultationClaim.value?.claimed.consultation).toMatchObject({
      sourceRunId,
      targetRunId: consultationRun!.id,
      question: 'Should the platform keep Consultation distinct from Handoff?',
      status: 'dispatched',
    });
    await store.recordAgentEvent(consultationRun!.id, 'consult-started', { type: 'run.started' });
    const consulting = await store.getTaskDetail(taskId);
    expect(consulting?.coordination).toMatchObject({
      owner: { kind: 'agent', agentId: sourceAgent.id, label: sourceAgent.name, reason: 'consultation_in_progress' },
      route: { action: 'continue', reason: 'consultation_in_progress' },
    });
    await expect(
      store.recordAgentEvent(consultationRun!.id, 'nested-consult-rejected', {
        type: 'consultation.requested',
        consultation: {
          targetAgentId: sourceAgent.id,
          question: 'Can I delegate this consultation again?',
          contextSummary: 'Nested consultation must be rejected by the platform.',
        },
      }),
    ).rejects.toThrow('consult Runs cannot request a Consultation');
    await expect(
      store.recordAgentEvent(consultationRun!.id, 'consult-handoff-rejected', {
        type: 'handoff.requested',
        handoff: {
          targetAgentId: sourceAgent.id,
          objective: 'Illegally transfer the Task from a Consultation Run.',
          summary: 'A Consultation Run has no Handoff authority.',
          nextAction: { type: 'handoff', targetAgentId: sourceAgent.id, reason: 'This must be rejected.' },
        },
      }),
    ).rejects.toThrow('consult Runs cannot request a Handoff');

    await store.recordAgentEvent(consultationRun!.id, 'consult-completed', {
      type: 'run.completed',
      outcome: {
        summary: 'Keep Consultation distinct because Task ownership does not change.',
        publicMessage: 'Keep Consultation distinct from Handoff; the original Agent should synthesize the advice.',
        commandEvidence: [],
        nextAction: { type: 'complete', reason: 'The bounded question has been answered.' },
      },
    });

    const resumed = await store.getTaskDetail(taskId);
    const continuationRun = resumed?.runs.find((run) => run.triggerType === 'continuation');
    expect(continuationRun).toMatchObject({
      agentId: sourceAgent.id,
      parentRunId: consultationRun!.id,
      status: 'queued',
      agentProfileSnapshot: { id: sourceAgent.id, name: sourceAgent.name },
      worktreePath: '/tmp/relay-hub-consultation',
    });
    expect(resumed?.task.currentRunId).toBe(continuationRun?.id);
    expect(resumed?.consultations[0]).toMatchObject({
      status: 'resumed',
      continuationRunId: continuationRun?.id,
      response: 'Keep Consultation distinct from Handoff; the original Agent should synthesize the advice.',
    });

    const continuationClaim = await store.claimRun(continuationRun!.id, 'consult-continuation-worker');
    expect(continuationClaim.value?.claimed.agent.id).toBe(sourceAgent.id);
    expect(continuationClaim.value?.claimed.consultation).toMatchObject({
      sourceAgentId: sourceAgent.id,
      targetAgentId: consultingAgent.id,
      response: 'Keep Consultation distinct from Handoff; the original Agent should synthesize the advice.',
    });
    await store.recordAgentEvent(continuationRun!.id, 'continuation-started', { type: 'run.started' });
    await store.recordAgentEvent(continuationRun!.id, 'continuation-completed', {
      type: 'run.completed',
      outcome: {
        summary: 'The original Agent evaluated the advice and finalized the result.',
        commandEvidence: [],
        nextAction: { type: 'wait_for_user', reason: 'The user can now inspect the synthesized result.' },
      },
    });

    const finished = await store.getTaskDetail(taskId);
    expect(finished?.task.status).toBe('waiting_for_user');
    expect(finished?.runs.map((run) => run.triggerType)).toEqual(['user', 'consult', 'continuation']);
  });

  it('enforces the Task-level consultation budget across continuation Runs', async () => {
    const sourceAgent = await createMockAgent('Budget source');
    const consultingAgent = await createMockAgent('Budget specialist');
    const created = await store.createTask({
      title: 'Bound the consultation loop',
      description: 'Repeated consultation must stop at the platform budget.',
      agentId: sourceAgent.id,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
    const taskId = created.value.detail.task.id;
    let sourceRunId = created.value.detail.task.currentRunId;

    for (let round = 1; round <= 3; round += 1) {
      await store.claimRun(sourceRunId, `budget-source-${round}`);
      await store.recordAgentEvent(sourceRunId, `budget-source-started-${round}`, { type: 'run.started' });
      await store.recordAgentEvent(sourceRunId, `budget-consult-requested-${round}`, {
        type: 'consultation.requested',
        consultation: {
          targetAgentId: consultingAgent.id,
          question: `Bounded question ${round}`,
          contextSummary: 'The platform counts Consultation records for the whole Task.',
        },
      });
      await store.recordAgentEvent(sourceRunId, `budget-source-completed-${round}`, {
        type: 'run.completed',
        outcome: {
          summary: `Prepared consultation ${round}.`,
          commandEvidence: [],
          nextAction: { type: 'consult', targetAgentId: consultingAgent.id, reason: `Round ${round}` },
        },
      });

      const dispatched = await store.getTaskDetail(taskId);
      const consultationRunId = dispatched!.task.currentRunId;
      await store.claimRun(consultationRunId, `budget-consult-${round}`);
      await store.recordAgentEvent(consultationRunId, `budget-consult-started-${round}`, { type: 'run.started' });
      await store.recordAgentEvent(consultationRunId, `budget-consult-completed-${round}`, {
        type: 'run.completed',
        outcome: {
          summary: `Answered consultation ${round}.`,
          commandEvidence: [],
          nextAction: { type: 'complete', reason: `Answered round ${round}` },
        },
      });
      sourceRunId = (await store.getTaskDetail(taskId))!.task.currentRunId;
    }

    const afterThree = await store.getTaskDetail(taskId);
    expect(afterThree?.consultations).toHaveLength(3);
    await store.claimRun(sourceRunId, 'budget-source-four');
    await store.recordAgentEvent(sourceRunId, 'budget-source-started-four', { type: 'run.started' });
    await expect(
      store.recordAgentEvent(sourceRunId, 'budget-consult-requested-four', {
        type: 'consultation.requested',
        consultation: {
          targetAgentId: consultingAgent.id,
          question: 'A fourth question must not be dispatched.',
          contextSummary: 'The Task already used its three Consultation records.',
        },
      }),
    ).rejects.toThrow('Consultation limit of 3');
  });
});
