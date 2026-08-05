import { hostname } from 'node:os';
import { AgentEventSchema, RunQueueJobSchema, type ClaimedRun } from '@relay-hub/contracts';
import { createRunWorker } from '@relay-hub/queue';
import { runMockAgent } from './mock-agent.js';

const apiUrl = process.env.RELAY_HUB_API_URL ?? 'http://127.0.0.1:4100';
const workerId = process.env.RELAY_HUB_WORKER_ID ?? `${hostname()}-${process.pid}`;

async function claimRun(runId: string): Promise<ClaimedRun | null> {
  const response = await fetch(`${apiUrl}/internal/runs/${runId}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workerId }),
  });
  if (response.status === 409) return null;
  if (!response.ok) throw new Error(`Claim failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as ClaimedRun;
}

async function reportEvent(runId: string, sequence: number, event: unknown): Promise<void> {
  const parsedEvent = AgentEventSchema.parse(event);
  const response = await fetch(`${apiUrl}/internal/runs/${runId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dedupeKey: `${runId}:${sequence}`, event: parsedEvent }),
  });
  if (!response.ok) throw new Error(`Event report failed: ${response.status} ${await response.text()}`);
}

async function execute(claimed: ClaimedRun): Promise<void> {
  let sequence = 0;
  try {
    for await (const event of runMockAgent(claimed)) {
      sequence += 1;
      await reportEvent(claimed.run.id, sequence, event);
    }
  } catch (error) {
    sequence += 1;
    const message = error instanceof Error ? error.message : String(error);
    try {
      await reportEvent(claimed.run.id, sequence, { type: 'run.failed', code: 'unknown', message });
    } catch (reportError) {
      console.error('Unable to report worker failure', reportError);
      throw error;
    }
  }
}

const worker = createRunWorker(async (job) => {
  const { runId } = RunQueueJobSchema.parse(job.data);
  const claimed = await claimRun(runId);
  if (!claimed) {
    console.log(`Ignoring duplicate delivery for non-queued run ${runId}`);
    return;
  }
  await execute(claimed);
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
