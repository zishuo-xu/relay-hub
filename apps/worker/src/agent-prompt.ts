import {
  type ClaimedRun,
  type ReviewDraft,
  ReviewDraftSchema,
} from '@relay-hub/contracts';

const REVIEW_START = '<relayhub_review>';
const REVIEW_END = '</relayhub_review>';

export function parseReviewDraft(message: string): ReviewDraft {
  const start = message.lastIndexOf(REVIEW_START);
  const end = message.indexOf(REVIEW_END, start + REVIEW_START.length);
  if (start < 0 || end < 0) throw new Error('Reviewer response is missing the RelayHub review envelope');
  const json = message.slice(start + REVIEW_START.length, end).trim();
  try {
    return ReviewDraftSchema.parse(JSON.parse(json));
  } catch (error) {
    throw new Error(`Reviewer returned an invalid structured Review: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function buildAgentPrompt(claimed: ClaimedRun): string {
  const isReviewer = claimed.run.triggerType === 'review';
  const criteria = claimed.task.acceptanceCriteria.length
    ? claimed.task.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')
    : 'No additional acceptance criteria were supplied.';
  if (isReviewer) {
    const handoff = claimed.handoff;
    if (!handoff) throw new Error('Reviewer Run is missing its persisted Handoff');
    const artifacts = handoff.artifactRefs.length
      ? handoff.artifactRefs.map((artifact) => `- ${artifact.kind}: ${artifact.value}`).join('\n')
      : '- Current inherited Builder worktree';
    return [
      'You are the independent Reviewer Agent for a RelayHub task.',
      'Inspect the current Builder worktree in read-only mode. Do not modify files, commit, or push.',
      'You may run local verification commands and start temporary services bound only to 127.0.0.1 or localhost. Do not bind to other interfaces or access unrelated local services.',
      'Check the implementation and available verification evidence against the acceptance criteria.',
      '',
      `Task: ${claimed.task.title}`,
      claimed.task.description,
      '',
      `Review objective: ${handoff.objective}`,
      `Builder handoff: ${handoff.contextSummary}`,
      'Artifacts:',
      artifacts,
      '',
      'Acceptance criteria:',
      criteria,
      '',
      'Return the final decision as exactly one structured envelope with no Markdown fence:',
      REVIEW_START,
      '{"verdict":"approved","summary":"Concise evidence-based decision","findings":[]}',
      REVIEW_END,
      'Allowed verdicts: approved, changes_requested, blocked.',
      'Each finding must include severity (blocking, should_fix, or suggestion), title, and detail.',
      'approved cannot contain blocking or should_fix findings; changes_requested requires one; blocked requires blocking.',
    ].join('\n');
  }

  if (claimed.run.triggerType === 'retry') {
    const review = claimed.review;
    if (!review) throw new Error('Repair Run is missing its source Review');
    const findings = review.findings
      .map((finding, index) => {
        const location = finding.filePath
          ? ` (${finding.filePath}${finding.lineStart ? `:${finding.lineStart}` : ''})`
          : '';
        return `${index + 1}. [${finding.severity}] ${finding.title}${location}\n   ${finding.detail}${finding.suggestion ? `\n   Suggestion: ${finding.suggestion}` : ''}`;
      })
      .join('\n');
    return [
      'You are the Builder Agent repairing a RelayHub task after independent review.',
      'Work only inside the inherited Git worktree. Do not commit, push, or modify other worktrees.',
      'Address every blocking and should_fix Finding, run proportionate verification, and leave the worktree ready for another review.',
      '',
      `Task: ${claimed.task.title}`,
      claimed.task.description,
      '',
      `Review round ${review.round}: ${review.summary}`,
      'Findings:',
      findings || 'No structured findings were supplied.',
      '',
      'Acceptance criteria:',
      criteria,
      '',
      'In the final response, summarize fixes, verification performed, and any remaining risk.',
    ].join('\n');
  }

  return [
    'You are the Builder Agent for a RelayHub task.',
    'Work only inside the current Git worktree. Do not commit, push, or modify other worktrees.',
    'Implement the requested change, run proportionate verification, and leave the worktree ready for Reviewer inspection.',
    '',
    `Task: ${claimed.task.title}`,
    claimed.task.description,
    '',
    'Acceptance criteria:',
    criteria,
    '',
    'In the final response, summarize changed files, verification performed, and any remaining risk.',
  ].join('\n');
}
