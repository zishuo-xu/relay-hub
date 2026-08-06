import type { RunEvent } from '@relay-hub/contracts';

export interface MutationResult<T> {
  value: T;
  emitted: RunEvent[];
}
