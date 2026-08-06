import {
  type AgentEvent,
  type ClaimedRun,
  type CommandEvidence,
  type ReviewDraft,
  ReviewDraftSchema,
} from '@relay-hub/contracts';
import { z } from 'zod';
import { superviseProcess } from './process-supervisor.js';

const CodexEnvelopeSchema = z.object({ type: z.string() }).passthrough();
const MAX_EVENT_TEXT = 4_000;
const REVIEW_START = '<relayhub_review>';
const REVIEW_END = '</relayhub_review>';

export function codexSandboxForRun(claimed: ClaimedRun): 'read-only' | 'workspace-write' {
  return claimed.run.triggerType === 'review' ? 'read-only' : 'workspace-write';
}

function truncate(value: unknown, limit = MAX_EVENT_TEXT): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

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

function itemOf(event: Record<string, unknown>): Record<string, unknown> | null {
  const item = event.item;
  return item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
}

function buildPrompt(claimed: ClaimedRun): string {
  const isReviewer = codexSandboxForRun(claimed) === 'read-only';
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

export async function* runCodexAgent(
  claimed: ClaimedRun,
  workingDirectory: string,
  options: { processOverride?: { command: string; args: string[] }; signal?: AbortSignal } = {},
): AsyncGenerator<AgentEvent> {
  const codexBinary = options.processOverride?.command ?? process.env.RELAY_HUB_CODEX_BIN ?? 'codex';
  const timeoutMs = Number(process.env.RELAY_HUB_AGENT_TIMEOUT_MS ?? 15 * 60 * 1_000);
  const isReviewer = codexSandboxForRun(claimed) === 'read-only';
  const args = options.processOverride?.args ?? [
    'exec',
    '--json',
    '--sandbox',
    codexSandboxForRun(claimed),
    '--ignore-user-config',
    '--ignore-rules',
    '-c',
    'approval_policy="never"',
    '-C',
    workingDirectory,
    '-',
  ];

  let finalMessage = '';
  let terminalEventSent = false;
  let protocolError = '';
  const commands = new Map<string, string>();
  const commandEvidence: CommandEvidence[] = [];

  for await (const processEvent of superviseProcess({
    command: codexBinary,
    args,
    cwd: workingDirectory,
    stdin: buildPrompt(claimed),
    timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
  })) {
    if (processEvent.type === 'process.exit') {
      if (terminalEventSent) continue;
      if (processEvent.cancelled) {
        terminalEventSent = true;
        yield { type: 'run.cancelled', reason: 'Cancellation requested by user' };
      } else if (processEvent.timedOut) {
        terminalEventSent = true;
        yield { type: 'run.failed', code: 'timeout', message: `Codex exceeded ${timeoutMs}ms` };
      } else if (processEvent.exitCode !== 0) {
        terminalEventSent = true;
        yield {
          type: 'run.failed',
          code: 'process_exit',
          message: truncate(processEvent.stderr || `Codex exited with code ${processEvent.exitCode}`),
        };
      } else if (protocolError) {
        terminalEventSent = true;
        yield { type: 'run.failed', code: 'protocol_error', message: protocolError };
      } else {
        terminalEventSent = true;
        yield { type: 'run.failed', code: 'protocol_error', message: 'Codex exited without turn.completed' };
      }
      continue;
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = CodexEnvelopeSchema.parse(JSON.parse(processEvent.line));
    } catch {
      protocolError = truncate(`Invalid Codex JSONL: ${processEvent.line}`);
      continue;
    }

    switch (envelope.type) {
      case 'thread.started': {
        const threadId = typeof envelope.thread_id === 'string' ? envelope.thread_id : undefined;
        yield threadId ? { type: 'run.started', sessionRef: threadId } : { type: 'run.started' };
        break;
      }
      case 'item.started': {
        const item = itemOf(envelope);
        if (item?.type === 'command_execution' && typeof item.id === 'string') {
          const command = truncate(item.command);
          if (command) commands.set(item.id, command);
          yield {
            type: 'tool.called',
            callId: item.id,
            name: 'shell',
            inputSummary: { command },
          };
        }
        break;
      }
      case 'item.completed': {
        const item = itemOf(envelope);
        if (!item) break;
        if (item.type === 'agent_message' && typeof item.text === 'string') {
          finalMessage = item.text;
          yield { type: 'output.delta', text: truncate(item.text) };
        } else if (item.type === 'command_execution' && typeof item.id === 'string') {
          const exitCode = typeof item.exit_code === 'number' ? item.exit_code : undefined;
          const status = exitCode === 0
            ? 'succeeded'
            : exitCode !== undefined || item.status === 'failed'
              ? 'failed'
              : 'unknown';
          const outputSummary = truncate(item.aggregated_output ?? item.output, 2_000);
          const command = commands.get(item.id) ?? (truncate(item.command) || `command:${item.id}`);
          if (commandEvidence.length < 100) {
            commandEvidence.push({
              command,
              status,
              ...(exitCode !== undefined ? { exitCode } : {}),
              ...(outputSummary ? { outputSummary } : {}),
            });
          }
          yield {
            type: 'tool.completed',
            callId: item.id,
            outputSummary: {
              status: item.status,
              exitCode: item.exit_code,
              output: truncate(item.aggregated_output ?? item.output),
            },
          };
        } else if (item.type === 'file_change') {
          yield { type: 'output.delta', text: 'Codex 已更新工作区文件。' };
        }
        break;
      }
      case 'turn.completed':
        terminalEventSent = true;
        if (isReviewer) {
          try {
            yield { type: 'review.submitted', review: parseReviewDraft(finalMessage) };
          } catch (error) {
            yield {
              type: 'run.failed',
              code: 'protocol_error',
              message: truncate(error instanceof Error ? error.message : String(error)),
            };
            break;
          }
        } else if (claimed.task.reviewerAgentId) {
          yield {
            type: 'handoff.requested',
            handoff: {
              targetAgentId: claimed.task.reviewerAgentId,
              objective: `Review Builder result for: ${claimed.task.title}`,
              summary: truncate(finalMessage || 'Builder completed the task and requested independent review.'),
              artifactRefs: [{ kind: 'worktree', value: workingDirectory, label: 'Builder worktree' }],
              acceptanceCriteria: claimed.task.acceptanceCriteria,
            },
          };
        }
        yield {
          type: 'run.completed',
          outcome: {
            summary: truncate(finalMessage || 'Codex completed the task.'),
            commandEvidence,
          },
        };
        break;
      case 'turn.failed':
      case 'error':
        terminalEventSent = true;
        yield {
          type: 'run.failed',
          code: 'unknown',
          message: truncate(envelope.error ?? envelope.message ?? envelope),
        };
        break;
      default:
        break;
    }
  }
}
