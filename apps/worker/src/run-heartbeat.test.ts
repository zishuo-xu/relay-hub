import { describe, expect, it, vi } from 'vitest';
import { sendRunHeartbeat } from './run-heartbeat.js';

describe('sendRunHeartbeat', () => {
  it('renews the current Run lease with its execution Token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(
      sendRunHeartbeat({
        apiUrl: 'http://127.0.0.1:4100',
        runId: '00000000-0000-4000-8000-000000000001',
        executionToken: 'rht_test',
        fetchImpl,
      }),
    ).resolves.toBe('renewed');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/internal/runs/00000000-0000-4000-8000-000000000001/heartbeat',
      {
        method: 'POST',
        headers: { authorization: 'Bearer rht_test' },
      },
    );
  });

  it('treats a revoked Token as a lost lease instead of retrying execution authority', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(
      sendRunHeartbeat({
        apiUrl: 'http://127.0.0.1:4100',
        runId: '00000000-0000-4000-8000-000000000001',
        executionToken: 'rht_revoked',
        fetchImpl,
      }),
    ).resolves.toBe('lease_lost');
  });
});
