import { describe, expect, it } from 'vitest';
import {
  planAfterReview,
  planAfterSuccessfulBuilderRun,
  planSequentialHandoffDispatch,
} from './workflow-orchestrator.js';

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
      planAfterReview({
        verdict: 'approved',
        completionPolicy: 'auto_on_approval',
        riskEvidenceSatisfied: false,
        repairDispatchAvailable: false,
      }),
    ).toMatchObject({ nextTaskStatus: 'completed', reason: 'auto_on_approval' });
    expect(
      planAfterReview({
        verdict: 'approved',
        completionPolicy: 'require_user_confirmation',
        riskEvidenceSatisfied: true,
        repairDispatchAvailable: false,
      }),
    ).toMatchObject({ nextTaskStatus: 'waiting_for_user', reason: 'user_confirmation_required' });
  });

  it('keeps risk-based completion deterministic and evidence-driven', () => {
    expect(
      planAfterReview({
        verdict: 'approved',
        completionPolicy: 'risk_based',
        riskEvidenceSatisfied: true,
        repairDispatchAvailable: false,
      }),
    ).toMatchObject({ nextTaskStatus: 'completed', reason: 'risk_evidence_satisfied' });
    expect(
      planAfterReview({
        verdict: 'approved',
        completionPolicy: 'risk_based',
        riskEvidenceSatisfied: false,
        repairDispatchAvailable: false,
      }),
    ).toMatchObject({ nextTaskStatus: 'waiting_for_user', reason: 'risk_evidence_requires_confirmation' });
  });

  it('routes changes and blockers without consulting CompletionPolicy', () => {
    expect(
      planAfterReview({
        verdict: 'changes_requested',
        completionPolicy: 'auto_on_approval',
        riskEvidenceSatisfied: true,
        repairDispatchAvailable: true,
      }),
    ).toMatchObject({ nextTaskStatus: 'changes_requested', eventType: 'task.changes_requested', queueRepair: true });
    expect(
      planAfterReview({
        verdict: 'blocked',
        completionPolicy: 'auto_on_approval',
        riskEvidenceSatisfied: true,
        repairDispatchAvailable: false,
      }),
    ).toMatchObject({ nextTaskStatus: 'waiting_for_user', eventType: 'task.review_blocked' });
    expect(
      planAfterReview({
        verdict: 'changes_requested',
        completionPolicy: 'auto_on_approval',
        riskEvidenceSatisfied: true,
        repairDispatchAvailable: false,
      }),
    ).toMatchObject({ nextTaskStatus: 'waiting_for_user', eventType: 'task.repair_limit_reached' });
  });
});

describe('sequential handoff dispatch planner', () => {
  it('dispatches an available target while the Task keeps running', () => {
    expect(planSequentialHandoffDispatch({ genericHandoffOrdinal: 1, targetDispatchAvailable: true })).toEqual({
      dispatch: true,
      nextTaskStatus: 'running',
      eventType: 'task.handoff_dispatched',
      reason: 'handoff_dispatch_available',
    });
  });

  it('still dispatches the sixth sequential Handoff', () => {
    expect(
      planSequentialHandoffDispatch({ genericHandoffOrdinal: 6, targetDispatchAvailable: true }).dispatch,
    ).toBe(true);
  });

  it('rejects the seventh sequential Handoff and returns the Task to the user', () => {
    expect(planSequentialHandoffDispatch({ genericHandoffOrdinal: 7, targetDispatchAvailable: true })).toEqual({
      dispatch: false,
      nextTaskStatus: 'waiting_for_user',
      eventType: 'task.handoff_rejected',
      reason: 'handoff_budget_exhausted',
    });
  });

  it('rejects the Handoff when the target became unavailable', () => {
    expect(planSequentialHandoffDispatch({ genericHandoffOrdinal: 2, targetDispatchAvailable: false })).toEqual({
      dispatch: false,
      nextTaskStatus: 'waiting_for_user',
      eventType: 'task.handoff_rejected',
      reason: 'handoff_target_unavailable',
    });
  });

  it('checks the budget before target availability', () => {
    expect(
      planSequentialHandoffDispatch({ genericHandoffOrdinal: 8, targetDispatchAvailable: false }).reason,
    ).toBe('handoff_budget_exhausted');
  });
});
