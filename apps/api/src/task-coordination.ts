import type {
  Consultation,
  Handoff,
  NextAction,
  Review,
  Run,
  Task,
  TaskCoordinationView,
} from '@relay-hub/contracts';

export interface TaskCoordinationSource {
  task: Task;
  runs: Run[];
  handoffs: Handoff[];
  consultations?: Consultation[];
  reviews: Review[];
}

const terminalTaskStatuses = new Set<Task['status']>(['completed', 'failed', 'cancelled']);
const agentOwnedRunStatuses = new Set<Run['status']>(['claimed', 'starting', 'running']);

function agentOwner(run: Run, reason: TaskCoordinationView['owner']['reason']): TaskCoordinationView['owner'] {
  return {
    kind: 'agent',
    reason,
    agentId: run.agentId,
    runId: run.id,
    ...(run.agentProfileSnapshot?.name ? { label: run.agentProfileSnapshot.name } : {}),
  };
}

function allowedActionsForRun(run: Run, task: Task): NextAction['type'][] {
  if (run.triggerType === 'review') return ['continue', 'wait_for_user'];
  if (run.triggerType === 'consult') return ['complete'];
  return task.reviewerAgentId
    ? ['continue', 'handoff', 'request_review', 'consult', 'wait_for_user']
    : ['continue', 'handoff', 'consult', 'wait_for_user'];
}

function projectVerdict(source: TaskCoordinationSource, currentRun?: Run): TaskCoordinationView['verdict'] {
  const currentReview = currentRun
    ? source.reviews.find((review) => review.runId === currentRun.id)
    : undefined;
  if (source.task.status === 'reviewing' && currentRun?.triggerType === 'review' && !currentReview) {
    return { status: 'pending', findingCount: 0 };
  }
  const latestReview = source.reviews.at(-1);
  if (latestReview) {
    return {
      status: latestReview.verdict,
      findingCount: latestReview.findings.length,
      reviewId: latestReview.id,
      round: latestReview.round,
      summary: latestReview.summary,
    };
  }
  return {
    status: source.task.reviewerAgentId || source.handoffs.length > 0 ? 'pending' : 'not_requested',
    findingCount: 0,
  };
}

function projectEvidence(source: TaskCoordinationSource): TaskCoordinationView['evidence'] {
  const latestHandoff = source.handoffs.at(-1);
  const builderRuns = source.runs.filter((run) => run.triggerType === 'user' || run.triggerType === 'retry');
  const evidenceRun = builderRuns.findLast((run) => Boolean(run.outcome)) ?? builderRuns.at(-1);
  const commands = evidenceRun?.outcome?.commandEvidence ?? [];
  return {
    commandCount: commands.length,
    succeededCommandCount: commands.filter((command) => command.status === 'succeeded').length,
    failedCommandCount: commands.filter((command) => command.status === 'failed').length,
    artifactCount: latestHandoff?.artifactRefs.length ?? 0,
    evidenceRefCount: latestHandoff?.evidenceRefs.length ?? 0,
    ...(latestHandoff
      ? {
          handoffId: latestHandoff.id,
          handoffStatus: latestHandoff.status,
          handoffVersion: latestHandoff.bundleVersion,
        }
      : {}),
  };
}

export function projectTaskCoordination(source: TaskCoordinationSource): TaskCoordinationView {
  const currentRun = source.runs.find((run) => run.id === source.task.currentRunId);
  const latestHandoff = source.handoffs.at(-1);
  const verdict = projectVerdict(source, currentRun);
  const evidence = projectEvidence(source);
  const state: TaskCoordinationView['state'] = {
    taskStatus: source.task.status,
    ...(currentRun ? { runId: currentRun.id, runStatus: currentRun.status } : {}),
  };

  if (terminalTaskStatuses.has(source.task.status)) {
    return {
      state,
      owner: { kind: 'none', reason: 'task_terminal' },
      evidence,
      verdict,
      route: { action: 'terminal', reason: 'task_terminal', allowedActions: [] },
    };
  }

  if (source.task.status === 'draft') {
    return {
      state,
      owner: { kind: 'user', reason: 'task_draft' },
      evidence,
      verdict,
      route: { action: 'continue', reason: 'task_draft', allowedActions: ['continue'] },
    };
  }

  if (source.task.status === 'waiting_for_user') {
    const approved = verdict.status === 'approved';
    return {
      state,
      owner: { kind: 'user', reason: approved ? 'user_confirmation_required' : 'user_attention_required' },
      evidence,
      verdict,
      route: approved
        ? { action: 'complete', reason: 'user_confirmation_required', allowedActions: ['complete'] }
        : { action: 'wait_for_user', reason: 'user_attention_required', allowedActions: [] },
    };
  }

  if (!currentRun) {
    return {
      state,
      owner: { kind: 'platform', reason: 'current_run_missing' },
      evidence,
      verdict,
      route: { action: 'wait_for_user', reason: 'current_run_missing', allowedActions: [] },
    };
  }

  if (currentRun.status === 'cancelling') {
    return {
      state,
      owner: { kind: 'platform', reason: 'cancellation_in_progress', runId: currentRun.id },
      evidence,
      verdict,
      route: { action: 'continue', reason: 'cancellation_in_progress', allowedActions: ['continue'] },
    };
  }

  if (currentRun.status === 'queued') {
    const waitingForReview = currentRun.triggerType === 'review';
    const waitingForHandoff = currentRun.triggerType === 'handoff';
    const waitingForConsultation = currentRun.triggerType === 'consult';
    return {
      state,
      owner: {
        kind: 'platform',
        reason: waitingForReview
          ? 'review_waiting_for_dispatch'
          : waitingForHandoff
            ? 'handoff_waiting_for_dispatch'
            : waitingForConsultation
              ? 'consultation_waiting_for_dispatch'
              : 'run_waiting_for_dispatch',
        runId: currentRun.id,
      },
      evidence,
      verdict,
      route: waitingForReview
        ? {
            action: 'request_review',
            reason: 'review_waiting_for_dispatch',
            allowedActions: ['request_review'],
            targetAgentId: currentRun.agentId,
          }
        : waitingForHandoff
          ? {
              action: 'handoff',
              reason: 'handoff_waiting_for_dispatch',
              allowedActions: ['handoff'],
              targetAgentId: currentRun.agentId,
            }
          : waitingForConsultation
            ? {
                action: 'consult',
                reason: 'consultation_waiting_for_dispatch',
                allowedActions: ['consult'],
                targetAgentId: currentRun.agentId,
              }
            : { action: 'continue', reason: 'run_waiting_for_dispatch', allowedActions: ['continue'] },
    };
  }

  if (agentOwnedRunStatuses.has(currentRun.status)) {
    const reviewInProgress = currentRun.triggerType === 'review';
    const repairInProgress = currentRun.triggerType === 'retry';
    const consultationInProgress = currentRun.triggerType === 'consult';
    const continuationInProgress = currentRun.triggerType === 'continuation';
    const handoffPending = !reviewInProgress && latestHandoff?.sourceRunId === currentRun.id;
    const reason = reviewInProgress
      ? 'review_in_progress'
      : repairInProgress
        ? 'repair_in_progress'
        : consultationInProgress
          ? 'consultation_in_progress'
          : continuationInProgress
            ? 'continuation_in_progress'
            : handoffPending
              ? 'handoff_pending'
              : 'run_owned_by_agent';
    let owner = agentOwner(currentRun, reason);
    if (consultationInProgress) {
      const consultation = source.consultations?.find((item) => item.targetRunId === currentRun.id);
      const sourceRun = consultation
        ? source.runs.find((candidate) => candidate.id === consultation.sourceRunId)
        : undefined;
      if (consultation) {
        owner = {
          kind: 'agent',
          reason,
          agentId: consultation.sourceAgentId,
          runId: currentRun.id,
          ...(sourceRun?.agentProfileSnapshot?.name ? { label: sourceRun.agentProfileSnapshot.name } : {}),
        };
      }
    }
    return {
      state,
      owner,
      evidence,
      verdict,
      route: handoffPending
        ? {
            action: latestHandoff?.nextAction?.type === 'handoff' ? 'handoff' : 'request_review',
            reason: 'handoff_pending',
            allowedActions: allowedActionsForRun(currentRun, source.task),
            targetAgentId: latestHandoff?.targetAgentId,
          }
        : {
            action: 'continue',
            reason,
            allowedActions: allowedActionsForRun(currentRun, source.task),
          },
    };
  }

  return {
    state,
    owner: { kind: 'platform', reason: 'workflow_resolution_pending', runId: currentRun.id },
    evidence,
    verdict,
    route: { action: 'continue', reason: 'workflow_resolution_pending', allowedActions: ['continue'] },
  };
}
