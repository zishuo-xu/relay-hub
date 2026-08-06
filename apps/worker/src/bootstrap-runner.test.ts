import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { runWorkspaceBootstrap } from './bootstrap-runner.js';

async function collect(policy: Parameters<typeof runWorkspaceBootstrap>[0]) {
  const events = [];
  for await (const event of runWorkspaceBootstrap(policy, tmpdir())) events.push(event);
  return events;
}

describe('runWorkspaceBootstrap', () => {
  it('does nothing for an empty provider-neutral policy', async () => {
    expect(await collect({ steps: [] })).toEqual([]);
  });

  it('executes an explicit argv step and records durable evidence', async () => {
    const events = await collect({
      steps: [{ name: 'Prepare fixture', command: process.execPath, args: ['-e', "console.log('ready')"], timeoutMs: 5_000 }],
    });
    expect(events.map((event) => event.type)).toEqual([
      'run.bootstrap_started',
      'run.bootstrap_step_completed',
      'run.bootstrap_completed',
    ]);
    expect(events[1]).toMatchObject({
      type: 'run.bootstrap_step_completed',
      stepIndex: 0,
      name: 'Prepare fixture',
      outputSummary: 'ready',
    });
  });

  it('reports a non-zero exit without starting an Agent', async () => {
    const events = await collect({
      steps: [{ name: 'Fail fixture', command: process.execPath, args: ['-e', 'process.exit(7)'], timeoutMs: 5_000 }],
    });
    expect(events.map((event) => event.type)).toEqual([
      'run.bootstrap_started',
      'run.bootstrap_failed',
      'run.failed',
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'run.failed', code: 'bootstrap_failed' });
  });
});
