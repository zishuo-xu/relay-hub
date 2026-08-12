export function workerConcurrency(value = process.env.RELAY_HUB_WORKER_CONCURRENCY): number {
  if (value === undefined || value.trim() === '') return 4;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new Error('RELAY_HUB_WORKER_CONCURRENCY must be an integer between 1 and 8');
  }
  return parsed;
}
