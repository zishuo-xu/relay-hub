import type { AgentEvent, BootstrapPolicy } from '@relay-hub/contracts';
import { truncateText } from './bounded-text.js';
import { superviseProcess } from './process-supervisor.js';

const MAX_OUTPUT_SUMMARY = 2_000;

function truncate(value: unknown, limit = MAX_OUTPUT_SUMMARY): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return truncateText(text, limit);
}

function commandLabel(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

export async function* runWorkspaceBootstrap(
  policy: BootstrapPolicy,
  workingDirectory: string,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<AgentEvent> {
  if (policy.steps.length === 0) return;

  const bootstrapStartedAt = Date.now();
  yield { type: 'run.bootstrap_started', stepCount: policy.steps.length };

  for (const [stepIndex, step] of policy.steps.entries()) {
    const stepStartedAt = Date.now();
    let stdout = '';
    try {
      for await (const processEvent of superviseProcess({
        command: step.command,
        args: step.args,
        cwd: workingDirectory,
        stdin: '',
        timeoutMs: step.timeoutMs,
        ...(options.signal ? { signal: options.signal } : {}),
      })) {
        if (processEvent.type === 'stdout.line') {
          stdout = truncate(`${stdout}${stdout ? '\n' : ''}${processEvent.line}`);
          continue;
        }

        const durationMs = Date.now() - stepStartedAt;
        if (processEvent.cancelled) {
          yield { type: 'run.cancelled', reason: `Bootstrap cancelled during ${step.name}` };
          return;
        }

        if (processEvent.timedOut || processEvent.exitCode !== 0) {
          const code = processEvent.timedOut ? 'timeout' : 'non_zero_exit';
          const message = processEvent.timedOut
            ? `Bootstrap step exceeded ${step.timeoutMs}ms`
            : truncate(processEvent.stderr || stdout || `Process exited with code ${processEvent.exitCode}`);
          yield { type: 'run.bootstrap_failed', stepIndex, name: step.name, code, message, durationMs };
          yield { type: 'run.failed', code: 'bootstrap_failed', message: `${step.name}: ${message}` };
          return;
        }

        yield {
          type: 'run.bootstrap_step_completed',
          stepIndex,
          name: step.name,
          command: commandLabel(step.command, step.args),
          durationMs,
          ...(stdout ? { outputSummary: stdout } : {}),
        };
      }
    } catch (error) {
      const durationMs = Date.now() - stepStartedAt;
      const message = truncate(error instanceof Error ? error.message : error);
      yield { type: 'run.bootstrap_failed', stepIndex, name: step.name, code: 'spawn_failed', message, durationMs };
      yield { type: 'run.failed', code: 'bootstrap_failed', message: `${step.name}: ${message}` };
      return;
    }
  }

  yield {
    type: 'run.bootstrap_completed',
    stepCount: policy.steps.length,
    durationMs: Date.now() - bootstrapStartedAt,
  };
}
