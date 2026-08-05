import type { AgentEvent, ClaimedRun } from '@relay-hub/contracts';
import { z } from 'zod';
import { superviseProcess } from './process-supervisor.js';

const CodexEnvelopeSchema = z.object({ type: z.string() }).passthrough();
const MAX_EVENT_TEXT = 4_000;

function truncate(value: unknown, limit = MAX_EVENT_TEXT): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function itemOf(event: Record<string, unknown>): Record<string, unknown> | null {
  const item = event.item;
  return item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
}

function buildPrompt(claimed: ClaimedRun): string {
  const criteria = claimed.task.acceptanceCriteria.length
    ? claimed.task.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')
    : 'No additional acceptance criteria were supplied.';
  return [
    'You are the Builder Agent for a RelayHub task.',
    'Work only inside the current Git worktree. Do not commit, push, or modify other worktrees.',
    'Implement the requested change, run proportionate verification, and leave the worktree ready for human review.',
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
  const args = options.processOverride?.args ?? [
    'exec',
    '--json',
    '--sandbox',
    'workspace-write',
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
          yield {
            type: 'tool.called',
            callId: item.id,
            name: 'shell',
            inputSummary: { command: truncate(item.command) },
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
        yield { type: 'run.completed', summary: truncate(finalMessage || 'Codex completed the task.') };
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
