import { describe, expect, it } from 'vitest';
import { canTransitionRun, canTransitionTask, RUN_STATUSES, TASK_STATUSES } from './index.js';

describe('task state machine', () => {
  it('allows the happy path', () => {
    expect(canTransitionTask('draft', 'queued')).toBe(true);
    expect(canTransitionTask('queued', 'running')).toBe(true);
    expect(canTransitionTask('running', 'completed')).toBe(true);
  });

  it('supports the review and user-confirmation loop', () => {
    expect(canTransitionTask('running', 'reviewing')).toBe(true);
    expect(canTransitionTask('reviewing', 'changes_requested')).toBe(true);
    expect(canTransitionTask('changes_requested', 'queued')).toBe(true);
    expect(canTransitionTask('reviewing', 'waiting_for_user')).toBe(true);
    expect(canTransitionTask('waiting_for_user', 'completed')).toBe(true);
  });

  it('keeps terminal states terminal', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      for (const target of TASK_STATUSES) {
        expect(canTransitionTask(status, target)).toBe(false);
      }
    }
  });
});

describe('run state machine', () => {
  it('allows the worker execution path', () => {
    expect(canTransitionRun('queued', 'claimed')).toBe(true);
    expect(canTransitionRun('claimed', 'starting')).toBe(true);
    expect(canTransitionRun('starting', 'running')).toBe(true);
    expect(canTransitionRun('claimed', 'running')).toBe(true);
    expect(canTransitionRun('running', 'succeeded')).toBe(true);
  });

  it('rejects skipping the claim boundary', () => {
    expect(canTransitionRun('queued', 'running')).toBe(false);
  });

  it('keeps terminal states terminal', () => {
    for (const status of ['succeeded', 'failed', 'cancelled', 'lost'] as const) {
      for (const target of RUN_STATUSES) {
        expect(canTransitionRun(status, target)).toBe(false);
      }
    }
  });
});
