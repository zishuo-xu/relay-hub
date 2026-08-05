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

  it('atomically creates, claims, deduplicates, and completes a run', async () => {
    const idempotencyKey = `test-${crypto.randomUUID()}`;
    const input = {
      title: 'Verify durable task path',
      description: 'Exercise the PostgreSQL repository without deleting any persistent rows.',
      agentId: DEFAULT_MOCK_AGENT_ID,
      acceptanceCriteria: ['Run reaches succeeded'],
      completionPolicy: 'require_user_confirmation' as const,
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
    await store.recordAgentEvent(runId, 'event-2', { type: 'run.completed', summary: 'Done' });
    const detail = await store.getTaskDetail(created.value.detail.task.id);
    expect(detail?.task.status).toBe('completed');
    expect(detail?.runs[0]?.status).toBe('succeeded');
  });
});
