import { describe, expect, it } from 'vitest';
import { planAfterSuccessfulRun } from './workflow-orchestrator.js';

describe('planAfterSuccessfulRun', () => {
  it('waits for the operator while reviewer dispatch is unavailable', () => {
    expect(planAfterSuccessfulRun(false)).toEqual({
      nextTaskStatus: 'waiting_for_user',
      eventType: 'task.waiting_for_review',
      reason: 'review_workflow_not_available',
    });
  });

  it('routes to review when deterministic dispatch is available', () => {
    expect(planAfterSuccessfulRun(true)).toEqual({
      nextTaskStatus: 'reviewing',
      eventType: 'task.review_requested',
      reason: 'review_dispatch_available',
    });
  });
});
