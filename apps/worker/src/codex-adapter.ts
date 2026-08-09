import {
  type AgentEvent,
  type ClaimedRun,
  type CommandEvidence,
} from '@relay-hub/contracts';
import { z } from 'zod';
import { buildAgentPrompt, executionPolicyForRun, parseReviewDraft } from './agent-prompt.js';
import { truncateText } from './bounded-text.js';
import { buildReviewHandoff, nextActionAfterBuilder } from './handoff.js';
import { superviseProcess } from './process-supervisor.js';

const CodexEnvelopeSchema = z.object({ type: z.string() }).passthrough();
const CodexRuntimeConfigSchema = z.object({ model: z.string().trim().min(1).max(240).optional() });
const MAX_EVENT_TEXT = 4_000;
const REVIEWER_PERMISSION_PROFILE = 'relayhub-reviewer-local-test';

export function codexSandboxForRun(claimed: ClaimedRun): 'read-only' | 'workspace-write' {
  return executionPolicyForRun(claimed).fileAccess === 'read_only' ? 'read-only' : 'workspace-write';
}

export function codexPermissionArgumentsForRun(claimed: ClaimedRun): string[] {
  const policy = executionPolicyForRun(claimed);
  if (policy.networkAccess !== 'loopback') {
    return ['--sandbox', policy.fileAccess === 'read_only' ? 'read-only' : 'workspace-write'];
  }

  const permissionProfile = policy.fileAccess === 'read_only'
    ? REVIEWER_PERMISSION_PROFILE
    : 'relayhub-builder-local-test';
  return [
    '-c',
    `default_permissions="${permissionProfile}"`,
    '-c',
    `permissions.${permissionProfile}.extends="${policy.fileAccess === 'read_only' ? ':read-only' : ':workspace'}"`,
    '-c',
    `permissions.${permissionProfile}.network.enabled=true`,
    '-c',
    `permissions.${permissionProfile}.network.mode="limited"`,
    '-c',
    `permissions.${permissionProfile}.network.allow_local_binding=true`,
    '-c',
    `permissions.${permissionProfile}.network.domains={"localhost"="allow","127.0.0.1"="allow"}`,
    '-c',
    'features.network_proxy={enabled=true,allow_local_binding=true,domains={"localhost"="allow","127.0.0.1"="allow"}}',
  ];
}

export function codexArgumentsForRun(claimed: ClaimedRun, workingDirectory: string): string[] {
  const config = CodexRuntimeConfigSchema.parse(claimed.agent.config);
  const policy = executionPolicyForRun(claimed);
  return [
    'exec',
    '--json',
    '--strict-config',
    ...codexPermissionArgumentsForRun(claimed),
    '--ignore-user-config',
    '--ignore-rules',
    '-c',
    'approval_policy="never"',
    ...(policy.internalSubagents === 'deny'
      ? ['--disable', 'multi_agent', '--disable', 'multi_agent_v2']
      : []),
    ...(config.model ? ['--model', config.model] : []),
    '-C',
    workingDirectory,
    '-',
  ];
}

function truncate(value: unknown, limit = MAX_EVENT_TEXT): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return truncateText(text, limit);
}

function itemOf(event: Record<string, unknown>): Record<string, unknown> | null {
  const item = event.item;
  return item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
}

export async function* runCodexAgent(
  claimed: ClaimedRun,
  workingDirectory: string,
  options: { processOverride?: { command: string; args: string[] }; signal?: AbortSignal } = {},
): AsyncGenerator<AgentEvent> {
  const codexBinary = options.processOverride?.command ?? process.env.RELAY_HUB_CODEX_BIN ?? 'codex';
  const timeoutMs = Number(process.env.RELAY_HUB_AGENT_TIMEOUT_MS ?? 15 * 60 * 1_000);
  const isReviewer = claimed.run.triggerType === 'review';
  const args = options.processOverride?.args ?? codexArgumentsForRun(claimed, workingDirectory);

  let finalMessage = '';
  let terminalEventSent = false;
  let protocolError = '';
  const commands = new Map<string, string>();
  const commandEvidence: CommandEvidence[] = [];

  for await (const processEvent of superviseProcess({
    command: codexBinary,
    args,
    cwd: workingDirectory,
    stdin: buildAgentPrompt(claimed),
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
            handoff: buildReviewHandoff(
              claimed,
              workingDirectory,
              truncate(finalMessage || 'Builder completed the task and requested independent review.'),
              commandEvidence,
            ),
          };
        }
        yield {
          type: 'run.completed',
          outcome: {
            summary: truncate(finalMessage || 'Codex completed the task.'),
            commandEvidence,
            ...(!isReviewer ? { nextAction: nextActionAfterBuilder(claimed) } : {}),
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
