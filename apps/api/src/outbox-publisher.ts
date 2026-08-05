import { RunQueueJobSchema } from '@relay-hub/contracts';
import { outboxEvents, type RelayDatabase } from '@relay-hub/db';
import { createRunQueue } from '@relay-hub/queue';
import { and, asc, eq, lte } from 'drizzle-orm';

export class OutboxPublisher {
  private readonly queue;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopping = false;

  constructor(
    private readonly db: RelayDatabase,
    redisUrl?: string,
    private readonly intervalMs = 250,
  ) {
    this.queue = createRunQueue(redisUrl);
  }

  start(): void {
    void this.tick();
  }

  async close(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.queue.close();
  }

  private async tick(): Promise<void> {
    try {
      await this.publishBatch();
    } catch (error) {
      console.error('Outbox publisher cycle failed', error);
    } finally {
      if (!this.stopping) this.timer = setTimeout(() => void this.tick(), this.intervalMs);
    }
  }

  private async publishBatch(): Promise<void> {
    const pending = await this.db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.status, 'pending'), lte(outboxEvents.availableAt, new Date())))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(50);

    for (const event of pending) {
      try {
        if (event.eventType !== 'run.queued') throw new Error(`Unsupported outbox event: ${event.eventType}`);
        const job = RunQueueJobSchema.parse(event.payload);
        await this.queue.add('run.execute', job, {
          jobId: event.id,
          attempts: 5,
          backoff: { type: 'exponential', delay: 500 },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        });
        await this.db
          .update(outboxEvents)
          .set({ status: 'published', publishedAt: new Date(), attempts: event.attempts + 1, lastError: null })
          .where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, 'pending')));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const delayMs = Math.min(30_000, 500 * 2 ** Math.min(event.attempts, 6));
        await this.db
          .update(outboxEvents)
          .set({
            attempts: event.attempts + 1,
            lastError: message,
            availableAt: new Date(Date.now() + delayMs),
          })
          .where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, 'pending')));
      }
    }
  }
}
