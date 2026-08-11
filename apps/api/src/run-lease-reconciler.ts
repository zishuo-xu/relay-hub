import type { RunEvent } from '@relay-hub/contracts';
import type { PostgresStore } from './store.js';

export class RunLeaseReconciler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly store: PostgresStore,
    private readonly onEvents: (events: RunEvent[]) => void,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    this.launch();
  }

  async close(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }

  private launch(): void {
    this.inFlight = this.tick().finally(() => {
      this.inFlight = undefined;
    });
  }

  private async tick(): Promise<void> {
    try {
      const result = await this.store.reconcileExpiredRunLeases();
      if (result.emitted.length > 0) this.onEvents(result.emitted);
    } catch (error) {
      console.error('Run lease reconciliation cycle failed', error);
    } finally {
      if (!this.stopping) this.timer = setTimeout(() => this.launch(), this.intervalMs);
    }
  }
}
