import { describe, expect, it } from 'vitest';
import { workerConcurrency } from './worker-config.js';

describe('workerConcurrency', () => {
  it('defaults to four parallel Runs and accepts the bounded range', () => {
    expect(workerConcurrency(undefined)).toBe(4);
    expect(workerConcurrency('1')).toBe(1);
    expect(workerConcurrency('8')).toBe(8);
  });

  it('rejects unsafe or ambiguous values', () => {
    for (const value of ['0', '9', '1.5', 'many']) {
      expect(() => workerConcurrency(value)).toThrow('between 1 and 8');
    }
  });
});
