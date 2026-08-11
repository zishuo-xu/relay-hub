import type { CompletionPolicy, HandoffRejectionReason, ReviewVerdict, TaskStatus } from '@relay-hub/contracts';
import { MAX_SEQUENTIAL_HANDOFFS } from '@relay-hub/contracts';

export interface SuccessfulBuilderPlan {
  nextTaskStatus: Extract<TaskStatus, 'reviewing' | 'waiting_for_user'>;
  eventType: 'task.review_requested' | 'task.waiting_for_review';
  reason: 'review_dispatch_available' | 'review_workflow_not_available';
}

/**
 * A successful Builder protocol run is evidence for the workflow, not proof
 * that the Task is complete.
 */
export function planAfterSuccessfulBuilderRun(input: { reviewDispatchAvailable: boolean }): SuccessfulBuilderPlan {
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

export interface SequentialHandoffDispatchPlan {
  dispatch: boolean;
  nextTaskStatus: Extract<TaskStatus, 'running' | 'waiting_for_user'>;
  eventType: 'task.handoff_dispatched' | 'task.handoff_rejected';
  reason: 'handoff_dispatch_available' | HandoffRejectionReason;
}

/**
 * A generic sequential Handoff keeps the Task running and moves the single
 * current Run to the dispatched target. The fixed per-Task budget and the
 * re-validated target decide between dispatch and a deterministic rejection
 * that hands the Task back to the user without creating a Run.
 */
export function planSequentialHandoffDispatch(input: {
  genericHandoffOrdinal: number;
  targetDispatchAvailable: boolean;
}): SequentialHandoffDispatchPlan {
  if (input.genericHandoffOrdinal > MAX_SEQUENTIAL_HANDOFFS) {
    return {
      dispatch: false,
      nextTaskStatus: 'waiting_for_user',
      eventType: 'task.handoff_rejected',
      reason: 'handoff_budget_exhausted',
    };
  }
  if (!input.targetDispatchAvailable) {
    return {
      dispatch: false,
      nextTaskStatus: 'waiting_for_user',
      eventType: 'task.handoff_rejected',
      reason: 'handoff_target_unavailable',
    };
  }
  return {
    dispatch: true,
    nextTaskStatus: 'running',
    eventType: 'task.handoff_dispatched',
    reason: 'handoff_dispatch_available',
  };
}

export interface ReviewResolutionPlan {
  nextTaskStatus: Extract<TaskStatus, 'completed' | 'waiting_for_user' | 'changes_requested'>;
  eventType: 'task.review_approved' | 'task.changes_requested' | 'task.review_blocked' | 'task.repair_limit_reached';
  queueRepair: boolean;
  reason:
    | 'auto_on_approval'
    | 'user_confirmation_required'
    | 'risk_evidence_satisfied'
    | 'risk_evidence_requires_confirmation'
    | 'reviewer_requested_changes'
    | 'max_review_rounds_reached'
    | 'reviewer_blocked';
}

export function planAfterReview(input: {
  verdict: ReviewVerdict;
  completionPolicy: CompletionPolicy;
  riskEvidenceSatisfied: boolean;
  repairDispatchAvailable: boolean;
}): ReviewResolutionPlan {
  if (input.verdict === 'changes_requested') {
    if (!input.repairDispatchAvailable) {
      return {
        nextTaskStatus: 'waiting_for_user',
        eventType: 'task.repair_limit_reached',
        reason: 'max_review_rounds_reached',
        queueRepair: false,
      };
    }
    return {
      nextTaskStatus: 'changes_requested',
      eventType: 'task.changes_requested',
      reason: 'reviewer_requested_changes',
      queueRepair: true,
    };
  }
  if (input.verdict === 'blocked') {
    return {
      nextTaskStatus: 'waiting_for_user',
      eventType: 'task.review_blocked',
      reason: 'reviewer_blocked',
      queueRepair: false,
    };
  }
  if (input.completionPolicy === 'auto_on_approval') {
    return {
      nextTaskStatus: 'completed',
      eventType: 'task.review_approved',
      reason: 'auto_on_approval',
      queueRepair: false,
    };
  }
  if (input.completionPolicy === 'risk_based' && input.riskEvidenceSatisfied) {
    return {
      nextTaskStatus: 'completed',
      eventType: 'task.review_approved',
      reason: 'risk_evidence_satisfied',
      queueRepair: false,
    };
  }
  return {
    nextTaskStatus: 'waiting_for_user',
    eventType: 'task.review_approved',
    reason: input.completionPolicy === 'risk_based'
      ? 'risk_evidence_requires_confirmation'
      : 'user_confirmation_required',
    queueRepair: false,
  };
}
