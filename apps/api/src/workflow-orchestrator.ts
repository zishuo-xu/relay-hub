import type { TaskStatus } from '@relay-hub/contracts';

export interface SuccessfulRunPlan {
  nextTaskStatus: Extract<TaskStatus, 'reviewing' | 'waiting_for_user'>;
  eventType: 'task.review_requested' | 'task.waiting_for_review' | 'task.review_run_completed';
  reason: 'review_dispatch_available' | 'review_workflow_not_available' | 'review_verdict_not_available';
}

/**
 * A successful Agent protocol run is evidence for the workflow, not proof that
 * the Task is complete. The plan distinguishes Builder dispatch from Reviewer
 * execution so a Reviewer can never recursively dispatch itself.
 */
export function planAfterSuccessfulRun(input: {
  reviewDispatchAvailable: boolean;
  isReviewRun: boolean;
}): SuccessfulRunPlan {
  if (input.isReviewRun) {
    return {
      nextTaskStatus: 'waiting_for_user',
      eventType: 'task.review_run_completed',
      reason: 'review_verdict_not_available',
    };
  }

  if (input.reviewDispatchAvailable) {
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
