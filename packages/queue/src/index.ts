import { RUN_QUEUE_NAME, type RunQueueJob } from '@relay-hub/contracts';
import { Queue, type Processor, Worker } from 'bullmq';

export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:56379';

export function redisConnectionFromUrl(redisUrl = process.env.REDIS_URL ?? DEFAULT_REDIS_URL) {
  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(`Unsupported Redis protocol: ${url.protocol}`);
  }
  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: database,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

export function createRunQueue(redisUrl?: string, queueName = RUN_QUEUE_NAME): Queue<RunQueueJob> {
  return new Queue<RunQueueJob>(queueName, {
    connection: redisConnectionFromUrl(redisUrl),
  });
}

export function createRunWorker(
  processor: Processor<RunQueueJob>,
  options: { redisUrl?: string; queueName?: string; concurrency?: number } = {},
): Worker<RunQueueJob> {
  return new Worker<RunQueueJob>(options.queueName ?? RUN_QUEUE_NAME, processor, {
    connection: redisConnectionFromUrl(options.redisUrl),
    concurrency: options.concurrency ?? 1,
  });
}
