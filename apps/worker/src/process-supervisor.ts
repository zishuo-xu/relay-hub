import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface SupervisedProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export type SupervisedProcessEvent =
  | { type: 'stdout.line'; line: string }
  | {
      type: 'process.exit';
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
      cancelled: boolean;
      stderr: string;
    };

const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TERM',
  'CODEX_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
] as const;

export function safeChildEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = source[key];
    if (value) environment[key] = value;
  }
  return environment;
}

export async function* superviseProcess(
  options: SupervisedProcessOptions,
): AsyncGenerator<SupervisedProcessEvent> {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.environment ?? safeChildEnvironment(),
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let timedOut = false;
  let cancelled = false;
  let stderr = '';
  let stdinFailure: Error | undefined;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-16_000);
  });

  const exitPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });

  const terminateChild = (): void => {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 5_000).unref();
  };
  const onAbort = (): void => {
    if (timedOut) return;
    cancelled = true;
    terminateChild();
  };
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    terminateChild();
  }, options.timeoutMs);
  timeout.unref();

  child.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') return;
    stdinFailure = error;
  });
  child.stdin.end(options.stdin);
  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });

  try {
    for await (const line of lines) yield { type: 'stdout.line', line };
    const outcome = await exitPromise;
    if (stdinFailure) throw stdinFailure;
    yield { type: 'process.exit', ...outcome, timedOut, cancelled, stderr };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
    lines.close();
  }
}
