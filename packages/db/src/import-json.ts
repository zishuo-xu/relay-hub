import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type AgentProfile, DEFAULT_MOCK_AGENT_ID, DEFAULT_WORKSPACE_ID } from '@relay-hub/contracts';
import { eq } from 'drizzle-orm';
import { createDatabase } from './index.js';
import { agentProfiles, idempotencyKeys, runEvents, runs, tasks } from './schema.js';

function snapshotAgent(row: typeof agentProfiles.$inferSelect): AgentProfile {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    adapterType: row.adapterType === 'codex_cli' || row.adapterType === 'opencode_cli' ? row.adapterType : 'mock',
    capabilities: row.capabilities,
    config: row.config,
    enabled: row.enabled,
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.modelLabel ? { modelLabel: row.modelLabel } : {}),
    ...(row.modelFamily ? { modelFamily: row.modelFamily } : {}),
  };
}

interface LegacyState {
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    agentId: string;
    acceptanceCriteria: string[];
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    currentRunId: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  }>;
  runs: Array<{
    id: string;
    taskId: string;
    status: 'queued' | 'claimed' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    attempt: number;
    workerId?: string;
    sessionRef?: string;
    failureCode?: string;
    failureDetail?: string;
    version: number;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
  }>;
  events: Array<{
    taskId: string;
    runId: string;
    type: string;
    payload: Record<string, unknown>;
    source: 'api' | 'worker' | 'agent' | 'user';
    occurredAt: string;
    dedupeKey: string;
  }>;
  idempotencyKeys: Record<string, string>;
}

const defaultFile = fileURLToPath(new URL('../../../.data/state.json', import.meta.url));
const dataFile = process.env.RELAY_HUB_LEGACY_DATA_FILE ?? defaultFile;
const state = JSON.parse(await readFile(dataFile, 'utf8')) as LegacyState;
const database = createDatabase();

try {
  await database.db.transaction(async (tx) => {
    const [defaultAgent] = await tx
      .select()
      .from(agentProfiles)
      .where(eq(agentProfiles.id, DEFAULT_MOCK_AGENT_ID))
      .limit(1);
    if (!defaultAgent) throw new Error('Default Mock AgentProfile must exist before importing legacy runs');
    const defaultAgentSnapshot = snapshotAgent(defaultAgent);
    if (state.tasks.length > 0) {
      await tx
        .insert(tasks)
        .values(
          state.tasks.map((task) => ({
            id: task.id,
            workspaceId: DEFAULT_WORKSPACE_ID,
            title: task.title,
            description: task.description,
            acceptanceCriteria: task.acceptanceCriteria,
            status: task.status,
            completionPolicy: 'require_user_confirmation' as const,
            version: task.version,
            createdAt: new Date(task.createdAt),
            updatedAt: new Date(task.updatedAt),
            ...(task.status === 'completed' ? { completedAt: new Date(task.updatedAt) } : {}),
          })),
        )
        .onConflictDoNothing();
    }

    if (state.runs.length > 0) {
      await tx
        .insert(runs)
        .values(
          state.runs.map((run) => ({
            id: run.id,
            taskId: run.taskId,
            agentId: DEFAULT_MOCK_AGENT_ID,
            status: run.status,
            triggerType: 'user' as const,
            workspaceRoot: '',
            agentProfileSnapshot: defaultAgentSnapshot,
            attempt: run.attempt,
            version: run.version,
            createdAt: new Date(run.createdAt),
            ...(run.workerId ? { workerId: run.workerId } : {}),
            ...(run.sessionRef ? { sessionRef: run.sessionRef } : {}),
            ...(run.failureCode ? { failureCode: run.failureCode } : {}),
            ...(run.failureDetail ? { failureDetail: run.failureDetail } : {}),
            ...(run.startedAt ? { startedAt: new Date(run.startedAt) } : {}),
            ...(run.finishedAt ? { finishedAt: new Date(run.finishedAt) } : {}),
          })),
        )
        .onConflictDoNothing();
    }

    for (const task of state.tasks) {
      await tx.update(tasks).set({ currentRunId: task.currentRunId }).where(eq(tasks.id, task.id));
    }

    for (const event of state.events) {
      await tx
        .insert(runEvents)
        .values({
          taskId: event.taskId,
          runId: event.runId,
          eventType: event.type,
          payload: event.payload,
          source: event.source,
          occurredAt: new Date(event.occurredAt),
          dedupeKey: event.dedupeKey,
        })
        .onConflictDoNothing();
    }

    for (const [key, taskId] of Object.entries(state.idempotencyKeys)) {
      await tx
        .insert(idempotencyKeys)
        .values({ scope: 'task.create', key, resourceType: 'task', resourceId: taskId })
        .onConflictDoNothing();
    }
  });
  console.log(
    `Imported legacy JSON without modifying it: ${state.tasks.length} tasks, ${state.runs.length} runs, ${state.events.length} events.`,
  );
} finally {
  await database.close();
}
