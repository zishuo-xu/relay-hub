import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { superviseProcess } from './process-supervisor.js';

describe('ProcessSupervisor stdin lifecycle', () => {
  it('converges normally when a child closes stdin before the prompt finishes writing', async () => {
    const script = [
      "process.stdin.destroy();",
      "console.log('child-ready');",
      'setTimeout(() => process.exit(0), 20);',
    ].join('');
    const events = [];
    for await (const event of superviseProcess({
      command: process.execPath,
      args: ['-e', script],
      cwd: tmpdir(),
      stdin: 'x'.repeat(2_000_000),
      timeoutMs: 2_000,
    })) events.push(event);

    expect(events).toEqual([
      { type: 'stdout.line', line: 'child-ready' },
      {
        type: 'process.exit',
        exitCode: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
        stderr: '',
      },
    ]);
  });
});
