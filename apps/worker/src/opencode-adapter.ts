import {
  type AgentEvent,
  type ClaimedRun,
  type CommandEvidence,
  OpenCodeRuntimeConfigSchema,
  openCodeProviderConfig,
  openCodeProviderKey,
} from '@relay-hub/contracts';
import { z } from 'zod';
import { buildAgentPrompt, executionPolicyForRun, parseReviewDraft } from './agent-prompt.js';
import { truncateText } from './bounded-text.js';
import { safeChildEnvironment, superviseProcess } from './process-supervisor.js';

const OpenCodeEnvelopeSchema = z.object({
  type: z.string(),
  sessionID: z.string().optional(),
  part: z.record(z.unknown()).optional(),
  error: z.unknown().optional(),
}).passthrough();
const MAX_EVENT_TEXT = 4_000;

function truncate(value: unknown, limit = MAX_EVENT_TEXT): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return truncateText(text, limit);
}

export function openCodeRuntimePermissions(claimed: ClaimedRun): Record<string, unknown> {
  const policy = executionPolicyForRun(claimed);
  const strictReadOnly = policy.fileAccess === 'read_only';
  return {
    share: 'disabled',
    permission: {
      '*': 'allow',
      ...(strictReadOnly ? { edit: 'deny' } : {}),
      ...(strictReadOnly || policy.commandAccess === 'deny'
        ? { bash: 'deny' }
        : {
            bash: {
              '*': 'allow',
              'git commit*': 'deny',
              'git push*': 'deny',
              'git * commit*': 'deny',
              'git * push*': 'deny',
            },
          }),
      ...(policy.networkAccess !== 'outbound' ? { webfetch: 'deny' } : {}),
      external_directory: 'deny',
      question: 'deny',
      ...(policy.internalSubagents === 'deny' ? { task: 'deny' } : {}),
    },
  };
}

export async function* runOpenCodeAgent(
  claimed: ClaimedRun,
  workingDirectory: string,
  options: { processOverride?: { command: string; args: string[] }; signal?: AbortSignal } = {},
): AsyncGenerator<AgentEvent> {
  const config = OpenCodeRuntimeConfigSchema.parse(claimed.agent.config);
  const customConnection = config.providerConnection?.kind === 'custom_api' ? config.providerConnection : undefined;
  const runtimeModel = customConnection ? `${openCodeProviderKey(customConnection.id)}/${config.model}` : config.model;
  const credentialEnv = customConnection?.credentialEnv ?? config.credentialEnv;
  const binary = options.processOverride?.command ?? process.env.RELAY_HUB_OPENCODE_BIN ?? 'opencode';
  const timeoutMs = Number(process.env.RELAY_HUB_AGENT_TIMEOUT_MS ?? 15 * 60 * 1_000);
  const isReviewer = claimed.run.triggerType === 'review';
  const args = options.processOverride?.args ?? [
    'run',
    '--pure',
    '--format',
    'json',
    '--model',
    runtimeModel,
    '--dir',
    workingDirectory,
    ...(config.variant ? ['--variant', config.variant] : []),
    ...(config.agentName ? ['--agent', config.agentName] : []),
  ];
  const environment = {
    ...safeChildEnvironment(),
    ...(credentialEnv && process.env[credentialEnv]
      ? { [credentialEnv]: process.env[credentialEnv] }
      : {}),
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...openCodeRuntimePermissions(claimed),
      ...(customConnection ? openCodeProviderConfig(customConnection) : {}),
    }),
  };

  let finalMessage = '';
  let terminalEventSent = false;
  let started = false;
  let protocolError = '';
  const commandEvidence: CommandEvidence[] = [];

  for await (const processEvent of superviseProcess({
    command: binary,
    args,
    cwd: workingDirectory,
    stdin: buildAgentPrompt(claimed),
    timeoutMs,
    environment,
    ...(options.signal ? { signal: options.signal } : {}),
  })) {
    if (processEvent.type === 'process.exit') {
      if (terminalEventSent) continue;
      terminalEventSent = true;
      if (processEvent.cancelled) {
        yield { type: 'run.cancelled', reason: 'Cancellation requested by user' };
      } else if (processEvent.timedOut) {
        yield { type: 'run.failed', code: 'timeout', message: `OpenCode exceeded ${timeoutMs}ms` };
      } else if (processEvent.exitCode !== 0) {
        yield {
          type: 'run.failed',
          code: 'process_exit',
          message: truncate(processEvent.stderr || `OpenCode exited with code ${processEvent.exitCode}`),
        };
      } else if (protocolError) {
        yield { type: 'run.failed', code: 'protocol_error', message: protocolError };
      } else if (!started) {
        yield { type: 'run.failed', code: 'protocol_error', message: 'OpenCode produced no JSON events' };
      } else {
        if (isReviewer) {
          try {
            yield { type: 'review.submitted', review: parseReviewDraft(finalMessage) };
          } catch (error) {
            yield {
              type: 'run.failed',
              code: 'protocol_error',
              message: truncate(error instanceof Error ? error.message : String(error)),
            };
            continue;
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
            summary: truncate(finalMessage || 'OpenCode completed the task.'),
            commandEvidence,
          },
        };
      }
      continue;
    }

    let envelope: z.infer<typeof OpenCodeEnvelopeSchema>;
    try {
      envelope = OpenCodeEnvelopeSchema.parse(JSON.parse(processEvent.line));
    } catch {
      protocolError = truncate(`Invalid OpenCode JSONL: ${processEvent.line}`);
      continue;
    }
    if (!started) {
      started = true;
      yield envelope.sessionID
        ? { type: 'run.started', sessionRef: envelope.sessionID }
        : { type: 'run.started' };
    }

    if (envelope.type === 'text' && typeof envelope.part?.text === 'string') {
      finalMessage += envelope.part.text;
      yield { type: 'output.delta', text: truncate(envelope.part.text) };
      continue;
    }
    if (envelope.type === 'tool_use' && envelope.part) {
      const state = envelope.part.state && typeof envelope.part.state === 'object'
        ? envelope.part.state as Record<string, unknown>
        : {};
      const callId = typeof envelope.part.callID === 'string'
        ? envelope.part.callID
        : typeof envelope.part.id === 'string'
          ? envelope.part.id
          : `opencode-tool-${commandEvidence.length + 1}`;
      const tool = typeof envelope.part.tool === 'string' ? envelope.part.tool : 'tool';
      const input = state.input && typeof state.input === 'object' ? state.input as Record<string, unknown> : {};
      yield { type: 'tool.called', callId, name: tool, inputSummary: input };
      if (state.status === 'completed' || state.status === 'error') {
        const outputSummary = truncate(state.output, 2_000);
        if (tool === 'bash' && commandEvidence.length < 100) {
          const command = typeof input.command === 'string' ? input.command : `bash:${callId}`;
          commandEvidence.push({
            command,
            status: state.status === 'completed' ? 'succeeded' : 'failed',
            ...(outputSummary ? { outputSummary } : {}),
          });
        }
        yield { type: 'tool.completed', callId, outputSummary: { status: state.status, output: outputSummary } };
      }
      continue;
    }
    if (envelope.type === 'error') {
      terminalEventSent = true;
      yield { type: 'run.failed', code: 'unknown', message: truncate(envelope.error ?? envelope) };
    }
  }
}
