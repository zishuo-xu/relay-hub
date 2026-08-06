import { DEFAULT_MOCK_AGENT_ID } from '@relay-hub/contracts';
import { createDatabase } from '@relay-hub/db';
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

  it('atomically creates, claims, deduplicates, and records a successful run outcome', async () => {
    const idempotencyKey = `test-${crypto.randomUUID()}`;
    const input = {
      title: 'Verify durable task path',
      description: 'Exercise the PostgreSQL repository without deleting any persistent rows.',
      agentId: DEFAULT_MOCK_AGENT_ID,
      acceptanceCriteria: ['Run reaches succeeded'],
      completionPolicy: 'auto_on_approval' as const,
    };
    const created = await store.createTask(input, idempotencyKey);
    const duplicate = await store.createTask(input, idempotencyKey);
    expect(duplicate.value.created).toBe(false);
    expect(duplicate.value.detail.task.id).toBe(created.value.detail.task.id);

    const runId = created.value.detail.task.currentRunId;
    const claimed = await store.claimRun(runId, 'integration-worker');
    expect(claimed.value?.run.status).toBe('claimed');
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
  });

  it('cancels an active run through cancelling before the terminal event', async () => {
    const created = await store.createTask({
      title: 'Cancel active run',
      description: 'Verify process cancellation state converges without deleting execution evidence.',
      agentId: DEFAULT_MOCK_AGENT_ID,
      acceptanceCriteria: [],
      completionPolicy: 'require_user_confirmation',
    });
    const runId = created.value.detail.task.currentRunId;
    await store.claimRun(runId, 'cancellation-worker');
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
  });
});
