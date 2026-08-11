export const DEFAULT_RUN_LEASE_DURATION_MS = 30_000;
export const DEFAULT_RUN_LEASE_RECONCILE_INTERVAL_MS = 5_000;

export function runLeaseHeartbeatIntervalMs(leaseDurationMs: number): number {
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 3_000) {
    throw new Error('Run lease duration must be an integer of at least 3000ms');
  }
  return Math.max(1_000, Math.floor(leaseDurationMs / 3));
}

export function runLeaseExpiration(now: Date, leaseDurationMs: number): Date {
  runLeaseHeartbeatIntervalMs(leaseDurationMs);
  return new Date(now.getTime() + leaseDurationMs);
}
