import {
  type AgentEvent,
  type ClaimedRun,
  type CommandEvidence,
  ClaudeCodeRuntimeConfigSchema,
} from '@relay-hub/contracts';
import { z } from 'zod';
import { buildAgentPrompt, executionPolicyForRun, parseReviewDraft } from './agent-prompt.js';
import { agentCompletionEvents } from './agent-result.js';
import { truncateText } from './bounded-text.js';
import { superviseProcess } from './process-supervisor.js';

const ClaudeCodeEnvelopeSchema = z.object({ type: z.string() }).passthrough();
const MAX_EVENT_TEXT = 4_000;

function truncate(value: unknown, limit = MAX_EVENT_TEXT): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text ? truncateText(text, limit) : '';
}

function messageContent(envelope: Record<string, unknown>): Array<Record<string, unknown>> {
  const message = envelope.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return [];
  const content = (message as Record<string, unknown>).content;
  return Array.isArray(content)
    ? content.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

export function claudeCodeToolsForRun(claimed: ClaimedRun): string[] {
  const policy = executionPolicyForRun(claimed);
  if (policy.fileAccess === 'read_only') return ['Read', 'Glob', 'Grep'];
  const tools = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit'];
  if (policy.commandAccess === 'allow') tools.push('Bash');
  if (policy.networkAccess === 'outbound') tools.push('WebFetch', 'WebSearch');
  if (policy.internalSubagents === 'allow') tools.push('Task');
  return tools;
}

export function claudeCodeArgumentsForRun(claimed: ClaimedRun): string[] {
  const config = ClaudeCodeRuntimeConfigSchema.parse(claimed.agent.config);
  const tools = claudeCodeToolsForRun(claimed);
  return [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'dontAsk',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--no-chrome',
    '--tools',
    tools.join(','),
    '--allowedTools',
    tools.join(','),
    '--disallowedTools',
    'Bash(git commit *),Bash(git push *),Bash(git merge *),Bash(git rebase *)',
    ...(config.model ? ['--model', config.model] : []),
  ];
}

function appendCommandEvidence(
  commandEvidence: CommandEvidence[],
  command: string | undefined,
  failed: boolean,
  output: unknown,
): void {
  if (!command || commandEvidence.length >= 100) return;
  const outputSummary = truncate(output, 2_000);
  commandEvidence.push({
    command,
    status: failed ? 'failed' : 'succeeded',
    ...(outputSummary ? { outputSummary } : {}),
  });
}

export async function* runClaudeCodeAgent(
  claimed: ClaimedRun,
  workingDirectory: string,
  options: { processOverride?: { command: string; args: string[] }; signal?: AbortSignal } = {},
): AsyncGenerator<AgentEvent> {
  const binary = options.processOverride?.command ?? process.env.RELAY_HUB_CLAUDE_BIN ?? 'claude';
  const args = options.processOverride?.args ?? claudeCodeArgumentsForRun(claimed);
  const timeoutMs = Number(process.env.RELAY_HUB_AGENT_TIMEOUT_MS ?? 15 * 60 * 1_000);
  const isReviewer = claimed.run.triggerType === 'review';
  let finalMessage = '';
  let terminalEventSent = false;
  let started = false;
  let protocolError = '';
  let runtimeError = '';
  const toolNames = new Map<string, string>();
  const commands = new Map<string, string>();
  const commandEvidence: CommandEvidence[] = [];

  for await (const processEvent of superviseProcess({
    command: binary,
    args,
    cwd: workingDirectory,
    stdin: buildAgentPrompt(claimed),
    timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
  })) {
    if (processEvent.type === 'process.exit') {
      if (terminalEventSent) continue;
      terminalEventSent = true;
      if (processEvent.cancelled) {
        yield { type: 'run.cancelled', reason: 'Cancellation requested by user' };
      } else if (processEvent.timedOut) {
        yield { type: 'run.failed', code: 'timeout', message: `Claude Code exceeded ${timeoutMs}ms` };
      } else if (processEvent.exitCode !== 0) {
        yield {
          type: 'run.failed',
          code: 'process_exit',
          message: truncate(processEvent.stderr || runtimeError || `Claude Code exited with code ${processEvent.exitCode}`),
        };
      } else if (protocolError) {
        yield { type: 'run.failed', code: 'protocol_error', message: protocolError };
      } else if (!started) {
        yield { type: 'run.failed', code: 'protocol_error', message: 'Claude Code produced no JSON events' };
      } else {
        yield { type: 'run.failed', code: 'protocol_error', message: 'Claude Code exited without a result event' };
      }
      continue;
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = ClaudeCodeEnvelopeSchema.parse(JSON.parse(processEvent.line));
    } catch {
      protocolError = truncate(`Invalid Claude Code JSONL: ${processEvent.line}`);
      continue;
    }

    if (envelope.type === 'system') {
      const subtype = typeof envelope.subtype === 'string' ? envelope.subtype : '';
      if (subtype === 'init' && !started) {
        started = true;
        const sessionRef = typeof envelope.session_id === 'string' ? envelope.session_id : undefined;
        yield sessionRef ? { type: 'run.started', sessionRef } : { type: 'run.started' };
      } else if (typeof envelope.error === 'string') {
        runtimeError = envelope.error;
      }
      continue;
    }

    if (!started) {
      started = true;
      yield { type: 'run.started' };
    }

    if (envelope.type === 'assistant') {
      for (const part of messageContent(envelope)) {
        if (part.type === 'text' && typeof part.text === 'string') {
          finalMessage += part.text;
          yield { type: 'output.delta', text: truncate(part.text) };
          continue;
        }
        if (part.type !== 'tool_use') continue;
        const callId = typeof part.id === 'string' ? part.id : `claude-tool-${toolNames.size + 1}`;
        const name = typeof part.name === 'string' ? part.name : 'tool';
        const input = part.input && typeof part.input === 'object' && !Array.isArray(part.input)
          ? part.input as Record<string, unknown>
          : {};
        toolNames.set(callId, name);
        if (name === 'Bash' && typeof input.command === 'string') commands.set(callId, input.command);
        yield { type: 'tool.called', callId, name, inputSummary: input };
      }
      continue;
    }

    if (envelope.type === 'user') {
      for (const part of messageContent(envelope)) {
        if (part.type !== 'tool_result') continue;
        const callId = typeof part.tool_use_id === 'string' ? part.tool_use_id : `claude-result-${commandEvidence.length + 1}`;
        const failed = part.is_error === true;
        const output = part.content;
        if (toolNames.get(callId) === 'Bash') appendCommandEvidence(commandEvidence, commands.get(callId), failed, output);
        yield {
          type: 'tool.completed',
          callId,
          outputSummary: { status: failed ? 'failed' : 'succeeded', output: truncate(output) },
        };
      }
      continue;
    }

    if (envelope.type !== 'result') continue;
    terminalEventSent = true;
    const resultText = typeof envelope.result === 'string' ? envelope.result : '';
    if (!finalMessage && resultText) finalMessage = resultText;
    if (envelope.is_error === true || envelope.subtype === 'error') {
      yield { type: 'run.failed', code: 'unknown', message: truncate(resultText || runtimeError || envelope) };
      continue;
    }
    if (isReviewer) {
      let review: ReturnType<typeof parseReviewDraft>;
      try {
        review = parseReviewDraft(finalMessage);
        yield { type: 'review.submitted', review };
      } catch (error) {
        yield {
          type: 'run.failed',
          code: 'protocol_error',
          message: truncate(error instanceof Error ? error.message : String(error)),
        };
        continue;
      }
      yield {
        type: 'run.completed',
        outcome: {
          summary: truncate(finalMessage || 'Claude Code completed the task.'),
          publicMessage: review.summary,
          commandEvidence,
        },
      };
      continue;
    }
    try {
      for (const event of agentCompletionEvents({
        claimed,
        workingDirectory,
        finalMessage,
        commandEvidence,
        fallbackSummary: 'Claude Code completed the task.',
      })) yield event;
    } catch (error) {
      yield {
        type: 'run.failed',
        code: 'protocol_error',
        message: truncate(error instanceof Error ? error.message : String(error)),
      };
    }
  }
}
