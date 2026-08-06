import { describe, expect, it } from 'vitest';
import { planAfterReview, planAfterSuccessfulBuilderRun } from './workflow-orchestrator.js';

describe('workflow orchestrator', () => {
  it('waits for the operator while Reviewer dispatch is unavailable', () => {
    expect(planAfterSuccessfulBuilderRun({ reviewDispatchAvailable: false })).toEqual({
      nextTaskStatus: 'waiting_for_user',
      eventType: 'task.waiting_for_review',
      reason: 'review_workflow_not_available',
    });
  });

  it('routes a completed Builder to an isolated Reviewer', () => {
    expect(planAfterSuccessfulBuilderRun({ reviewDispatchAvailable: true })).toEqual({
      nextTaskStatus: 'reviewing',
      eventType: 'task.review_requested',
      reason: 'review_dispatch_available',
    });
  });

  it('applies auto and user-confirmation policies only after approval', () => {
    expect(
      planAfterReview({ verdict: 'approved', completionPolicy: 'auto_on_approval', riskEvidenceSatisfied: false }),
    ).toMatchObject({ nextTaskStatus: 'completed', reason: 'auto_on_approval' });
    expect(
      planAfterReview({
        verdict: 'approved',
        completionPolicy: 'require_user_confirmation',
        riskEvidenceSatisfied: true,
      }),
    ).toMatchObject({ nextTaskStatus: 'waiting_for_user', reason: 'user_confirmation_required' });
  });

  it('keeps risk-based completion deterministic and evidence-driven', () => {
    expect(
      planAfterReview({ verdict: 'approved', completionPolicy: 'risk_based', riskEvidenceSatisfied: true }),
    ).toMatchObject({ nextTaskStatus: 'completed', reason: 'risk_evidence_satisfied' });
    expect(
      planAfterReview({ verdict: 'approved', completionPolicy: 'risk_based', riskEvidenceSatisfied: false }),
    ).toMatchObject({ nextTaskStatus: 'waiting_for_user', reason: 'risk_evidence_requires_confirmation' });
  });

  it('routes changes and blockers without consulting CompletionPolicy', () => {
    expect(
      planAfterReview({
        verdict: 'changes_requested',
        completionPolicy: 'auto_on_approval',
        riskEvidenceSatisfied: true,
      }),
    ).toMatchObject({ nextTaskStatus: 'changes_requested', eventType: 'task.changes_requested' });
    expect(
      planAfterReview({ verdict: 'blocked', completionPolicy: 'auto_on_approval', riskEvidenceSatisfied: true }),
    ).toMatchObject({ nextTaskStatus: 'waiting_for_user', eventType: 'task.review_blocked' });
  });
});
