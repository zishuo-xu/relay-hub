import type { TaskStatus } from '@relay-hub/contracts';

export interface SuccessfulRunPlan {
  nextTaskStatus: Extract<TaskStatus, 'reviewing' | 'waiting_for_user'>;
  eventType: 'task.review_requested' | 'task.waiting_for_review';
  reason: 'review_dispatch_available' | 'review_workflow_not_available';
}

/**
 * A successful Agent protocol run is evidence for the workflow, not proof that
 * the Task is complete. Review dispatch will become available in Phase 3.
 */
export function planAfterSuccessfulRun(reviewDispatchAvailable: boolean): SuccessfulRunPlan {
  if (reviewDispatchAvailable) {
    return {
      nextTaskStatus: 'reviewing',
      eventType: 'task.review_requested',
      reason: 'review_dispatch_available',
    };
  }

  return {
    nextTaskStatus: 'waiting_for_user',
    eventType: 'task.waiting_for_review',
    reason: 'review_workflow_not_available',
  };
}
