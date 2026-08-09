import type {
  AgentEvent,
  ClaimedRun,
  CommandEvidence,
  HandoffDraft,
  NextAction,
} from '@relay-hub/contracts';
import { truncateText } from './bounded-text.js';

export function nextActionAfterBuilder(claimed: ClaimedRun): NextAction {
  return claimed.task.reviewerAgentId
    ? {
        type: 'request_review',
        targetAgentId: claimed.task.reviewerAgentId,
        reason: 'Builder finished and independent review is configured for this Task.',
      }
    : {
        type: 'wait_for_user',
        reason: 'Builder finished and no independent Reviewer is configured for this Task.',
      };
}

export function buildReviewHandoff(
  claimed: ClaimedRun,
  workingDirectory: string,
  summary: string,
  commandEvidence: CommandEvidence[],
): HandoffDraft {
  const targetAgentId = claimed.task.reviewerAgentId;
  if (!targetAgentId) throw new Error('Cannot build a review Handoff without a configured Reviewer');
  return {
    bundleVersion: 2,
    targetAgentId,
    objective: `Review Builder result for: ${claimed.task.title}`,
    summary,
    artifactRefs: [{ kind: 'worktree', value: workingDirectory, label: 'Builder worktree' }],
    evidenceRefs: commandEvidence.map((evidence) => ({
      kind: 'command',
      value: truncateText(
        evidence.outputSummary ? `${evidence.command}\nOutput: ${evidence.outputSummary}` : evidence.command,
        4_096,
      ),
      label: `${evidence.status}${evidence.exitCode === undefined ? '' : ` · exit ${evidence.exitCode}`}`,
    })),
    acceptanceCriteria: claimed.task.acceptanceCriteria,
    decisions: ['Builder finished the requested work and requested independent review.'],
    openQuestions: [],
    risks: commandEvidence
      .filter((evidence) => evidence.status !== 'succeeded')
      .map((evidence) => truncateText(`Verification command did not succeed: ${evidence.command}`, 2_000)),
    nextAction: {
      type: 'request_review',
      targetAgentId,
      reason: 'Builder result requires an independent verdict before the Task can complete.',
    },
  };
}

export function handoffConsumedEvent(claimed: ClaimedRun): AgentEvent | undefined {
  const handoff = claimed.handoff;
  if (!handoff?.contentDigest) return undefined;
  return {
    type: 'handoff.consumed',
    handoffId: handoff.id,
    bundleVersion: handoff.bundleVersion,
    contentDigest: handoff.contentDigest,
  };
}
