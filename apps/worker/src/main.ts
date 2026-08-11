import { hostname } from 'node:os';
import {
  AgentEventSchema,
  RunQueueJobSchema,
  type AgentEvent,
  type ClaimedExecution,
  type ClaimedRun,
} from '@relay-hub/contracts';
import { createRunWorker } from '@relay-hub/queue';
import { runWorkspaceBootstrap } from './bootstrap-runner.js';
import { runCodexAgent } from './codex-adapter.js';
import { runMockAgent } from './mock-agent.js';
import { runOpenCodeAgent } from './opencode-adapter.js';
import { startRunHeartbeat } from './run-heartbeat.js';
import { handoffConsumedEvent } from './handoff.js';
import { WorktreeManager } from './worktree-manager.js';

const apiUrl = process.env.RELAY_HUB_API_URL ?? 'http://127.0.0.1:4100';
const workerId = process.env.RELAY_HUB_WORKER_ID ?? `${hostname()}-${process.pid}`;
const worktreeManager = new WorktreeManager();

async function claimRun(runId: string): Promise<ClaimedExecution | null> {
  const response = await fetch(`${apiUrl}/internal/runs/${runId}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workerId }),
  });
  if (response.status === 409) return null;
  if (!response.ok) throw new Error(`Claim failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as ClaimedExecution;
}

async function reportEvent(runId: string, executionToken: string, sequence: number, event: unknown): Promise<void> {
  const parsedEvent = AgentEventSchema.parse(event);
  const response = await fetch(`${apiUrl}/internal/runs/${runId}/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${executionToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ dedupeKey: `${runId}:${sequence}`, event: parsedEvent }),
  });
  if (!response.ok) throw new Error(`Event report failed: ${response.status} ${await response.text()}`);
}

async function getRunControl(runId: string, executionToken: string): Promise<{ status: string }> {
  const response = await fetch(`${apiUrl}/internal/runs/${runId}/control`, {
    headers: { authorization: `Bearer ${executionToken}` },
  });
  if (!response.ok) throw new Error(`Control check failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as { status: string };
}

async function execute(
  claimed: ClaimedRun,
  executionToken: string,
  executionCancellation: AbortController,
): Promise<void> {
  let sequence = 0;
  let cancellationPoll: ReturnType<typeof setInterval> | undefined;
  try {
    let events: AsyncGenerator<AgentEvent>;
    let workingDirectory = claimed.run.workspaceRoot;

    if (claimed.agent.adapterType !== 'mock') {
      const isReviewer = claimed.run.triggerType === 'review';
      const reusesPreparedWorktree = isReviewer || claimed.run.triggerType === 'retry';
      const prepared = reusesPreparedWorktree
        ? {
            worktreePath: claimed.run.worktreePath,
            workingDirectory: claimed.run.workingDirectory,
            branchName: claimed.run.branchName,
          }
        : await worktreeManager.prepare(claimed.run.workspaceRoot, claimed.run.id);
      if (!prepared.worktreePath || !prepared.workingDirectory || !prepared.branchName) {
        throw new Error('Inherited Run is missing the prepared Builder worktree');
      }
      workingDirectory = prepared.workingDirectory;
      sequence += 1;
      await reportEvent(claimed.run.id, executionToken, sequence, {
        type: 'run.prepared',
        worktreePath: prepared.worktreePath,
        workingDirectory: prepared.workingDirectory,
        branchName: prepared.branchName,
      });
      let checkingCancellation = false;
      cancellationPoll = setInterval(() => {
        if (checkingCancellation) return;
        checkingCancellation = true;
        void getRunControl(claimed.run.id, executionToken)
          .then((control) => {
            if (control.status === 'cancelling') executionCancellation.abort();
          })
          .catch((error) => console.error(`Cancellation check failed for ${claimed.run.id}`, error))
          .finally(() => {
            checkingCancellation = false;
          });
      }, 500);

      if (!reusesPreparedWorktree) {
        let bootstrapReachedTerminal = false;
        for await (const event of runWorkspaceBootstrap(claimed.run.bootstrapPolicySnapshot, workingDirectory, {
          signal: executionCancellation.signal,
        })) {
          sequence += 1;
          await reportEvent(claimed.run.id, executionToken, sequence, event);
          if (event.type === 'run.failed' || event.type === 'run.cancelled') bootstrapReachedTerminal = true;
        }
        if (bootstrapReachedTerminal) return;
      }
    }

    const consumedEvent = handoffConsumedEvent(claimed);
    if (consumedEvent) {
      sequence += 1;
      await reportEvent(claimed.run.id, executionToken, sequence, consumedEvent);
    }

    if (claimed.agent.adapterType === 'codex_cli') {
      events = runCodexAgent(claimed, workingDirectory, { signal: executionCancellation.signal });
    } else if (claimed.agent.adapterType === 'opencode_cli') {
      events = runOpenCodeAgent(claimed, workingDirectory, { signal: executionCancellation.signal });
    } else if (claimed.agent.adapterType === 'mock') {
      events = runMockAgent(claimed);
    } else {
      throw new Error(`Unsupported adapter: ${claimed.agent.adapterType}`);
    }

    for await (const event of events) {
      sequence += 1;
      await reportEvent(claimed.run.id, executionToken, sequence, event);
    }
  } catch (error) {
    sequence += 1;
    const message = error instanceof Error ? error.message : String(error);
    try {
      await reportEvent(claimed.run.id, executionToken, sequence, {
        type: 'run.failed',
        code: 'unknown',
        message,
      });
    } catch (reportError) {
      console.error('Unable to report worker failure', reportError);
      throw error;
    }
  } finally {
    if (cancellationPoll) clearInterval(cancellationPoll);
  }
}

const worker = createRunWorker(async (job) => {
  const { runId } = RunQueueJobSchema.parse(job.data);
  const claimed = await claimRun(runId);
  if (!claimed) {
    console.log(`Ignoring duplicate delivery for non-queued run ${runId}`);
    return;
  }
  const executionCancellation = new AbortController();
  const stopHeartbeat = startRunHeartbeat({
    apiUrl,
    runId,
    executionToken: claimed.executionToken,
    intervalMs: claimed.lease.heartbeatIntervalMs,
    onLeaseLost: () => {
      console.error(`Run lease lost for ${runId}; aborting local execution`);
      executionCancellation.abort();
    },
    onError: (error) => console.error(`Heartbeat failed for ${runId}`, error),
  });
  try {
    await execute(claimed.claimed, claimed.executionToken, executionCancellation);
  } finally {
    stopHeartbeat();
  }
});

worker.on('completed', (job) => console.log(`Run job ${job.id ?? job.data.runId} completed`));
worker.on('failed', (job, error) => console.error(`Run job ${job?.id ?? 'unknown'} failed`, error));
worker.on('error', (error) => console.error('BullMQ worker error', error));

console.log(`RelayHub worker ${workerId} consuming BullMQ and reporting to ${apiUrl}`);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await worker.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
