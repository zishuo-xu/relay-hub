export type RunHeartbeatResult = 'renewed' | 'lease_lost';

export async function sendRunHeartbeat(input: {
  apiUrl: string;
  runId: string;
  executionToken: string;
  fetchImpl?: typeof fetch;
}): Promise<RunHeartbeatResult> {
  const response = await (input.fetchImpl ?? fetch)(
    `${input.apiUrl}/internal/runs/${input.runId}/heartbeat`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${input.executionToken}` },
    },
  );
  if (response.status === 401 || response.status === 409) return 'lease_lost';
  if (!response.ok) throw new Error(`Heartbeat failed: ${response.status} ${await response.text()}`);
  return 'renewed';
}

export function startRunHeartbeat(input: {
  apiUrl: string;
  runId: string;
  executionToken: string;
  intervalMs: number;
  onLeaseLost: () => void;
  onError?: (error: unknown) => void;
}): () => void {
  let stopped = false;
  let inFlight = false;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    void sendRunHeartbeat(input)
      .then((result) => {
        if (!stopped && result === 'lease_lost') {
          stopped = true;
          clearInterval(timer);
          input.onLeaseLost();
        }
      })
      .catch((error) => {
        if (!stopped) input.onError?.(error);
      })
      .finally(() => {
        inFlight = false;
      });
  }, input.intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
