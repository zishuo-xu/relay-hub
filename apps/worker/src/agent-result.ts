import {
  AGENT_RESULT_ENVELOPE_END,
  AGENT_RESULT_ENVELOPE_START,
  type AgentEvent,
  AgentResultSchema,
  type AgentResult,
  type ClaimedRun,
  type CommandEvidence,
  type HandoffDraft,
} from '@relay-hub/contracts';
import { truncateText } from './bounded-text.js';
import { buildReviewHandoff, nextActionAfterBuilder } from './handoff.js';

const MAX_OUTCOME_SUMMARY = 4_000;
const MAX_PUBLIC_MESSAGE = 10_000;

/**
 * Extracts the optional RelayHub structured result from a non-Review Agent's
 * final message. Returns undefined when the Agent produced plain text only;
 * throws when an explicit envelope is malformed or violates the schema.
 */
export function parseAgentResult(message: string): AgentResult | undefined {
  const start = message.lastIndexOf(AGENT_RESULT_ENVELOPE_START);
  if (start < 0) return undefined;
  const end = message.indexOf(AGENT_RESULT_ENVELOPE_END, start + AGENT_RESULT_ENVELOPE_START.length);
  if (end < 0) throw new Error('Agent result envelope is missing its closing marker');
  const json = message.slice(start + AGENT_RESULT_ENVELOPE_START.length, end).trim();
  try {
    return AgentResultSchema.parse(JSON.parse(json));
  } catch (error) {
    throw new Error(
      `Agent returned an invalid structured result: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function publicTextOutsideResultEnvelope(message: string): string | undefined {
  const start = message.lastIndexOf(AGENT_RESULT_ENVELOPE_START);
  if (start < 0) return undefined;
  const end = message.indexOf(AGENT_RESULT_ENVELOPE_END, start + AGENT_RESULT_ENVELOPE_START.length);
  if (end < 0) return undefined;
  const visible = `${message.slice(0, start)}\n${message.slice(end + AGENT_RESULT_ENVELOPE_END.length)}`.trim();
  return visible ? truncateText(visible, MAX_PUBLIC_MESSAGE) : undefined;
}

function handoffFromAgentResult(claimed: ClaimedRun, result: AgentResult): HandoffDraft | undefined {
  if (!result.handoff) return undefined;
  if (result.nextAction.type !== 'handoff' && result.nextAction.type !== 'request_review') return undefined;
  return {
    bundleVersion: 2,
    targetAgentId: result.nextAction.targetAgentId,
    objective: result.handoff.objective,
    summary: result.handoff.summary,
    artifactRefs: result.handoff.artifactRefs,
    evidenceRefs: result.handoff.evidenceRefs,
    acceptanceCriteria: claimed.task.acceptanceCriteria,
    decisions: result.handoff.decisions,
    openQuestions: result.handoff.openQuestions,
    risks: result.handoff.risks,
    nextAction: result.nextAction,
  };
}

/**
 * Builds the terminal events for a non-Review Run from its final message.
 * A valid structured result drives routing; without an envelope the Run falls
 * back to the legacy fixed Reviewer / wait_for_user behavior. A malformed
 * envelope throws so the Adapter can fail the Run as a protocol error.
 */
export function agentCompletionEvents(input: {
  claimed: ClaimedRun;
  workingDirectory: string;
  finalMessage: string;
  commandEvidence: CommandEvidence[];
  fallbackSummary: string;
}): AgentEvent[] {
  const { claimed, workingDirectory, finalMessage, commandEvidence, fallbackSummary } = input;
  const result = parseAgentResult(finalMessage);
  if (result) {
    if (result.nextAction.type === 'request_review') {
      const reviewerAgentId = claimed.task.reviewerAgentId;
      if (!reviewerAgentId) {
        throw new Error('Agent requested review but the Task has no configured Reviewer');
      }
      if (result.nextAction.targetAgentId !== reviewerAgentId) {
        throw new Error('Agent requested review from an Agent other than the configured Task Reviewer');
      }
    }
    const events: AgentEvent[] = [];
    const structuredHandoff = handoffFromAgentResult(claimed, result);
    if (structuredHandoff) {
      events.push({ type: 'handoff.requested', handoff: structuredHandoff });
    } else if (result.nextAction.type === 'request_review' && claimed.task.reviewerAgentId) {
      events.push({
        type: 'handoff.requested',
        handoff: buildReviewHandoff(claimed, workingDirectory, result.summary, commandEvidence),
      });
    }
    events.push({
      type: 'run.completed',
      outcome: {
        summary: result.summary,
        publicMessage: result.publicMessage ?? publicTextOutsideResultEnvelope(finalMessage) ?? result.summary,
        commandEvidence,
        nextAction: result.nextAction,
      },
    });
    return events;
  }

  const summary = truncateText(finalMessage || fallbackSummary, MAX_OUTCOME_SUMMARY);
  const events: AgentEvent[] = [];
  if (claimed.task.reviewerAgentId) {
    events.push({
      type: 'handoff.requested',
      handoff: buildReviewHandoff(claimed, workingDirectory, summary, commandEvidence),
    });
  }
  events.push({
    type: 'run.completed',
    outcome: {
      summary,
      publicMessage: summary,
      commandEvidence,
      nextAction: nextActionAfterBuilder(claimed),
    },
  });
  return events;
}
