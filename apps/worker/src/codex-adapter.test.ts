import { tmpdir } from 'node:os';
import type { ClaimedRun } from '@relay-hub/contracts';
import { describe, expect, it } from 'vitest';
import { runCodexAgent } from './codex-adapter.js';

const claimed: ClaimedRun = {
  workspace: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Test',
    rootPath: tmpdir(),
    defaultCompletionPolicy: 'require_user_confirmation',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  agent: {
    id: '00000000-0000-4000-8000-000000000003',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    name: 'Codex Builder',
    adapterType: 'codex_cli',
    capabilities: ['implement'],
    enabled: true,
  },
  task: {
    id: '00000000-0000-4000-8000-000000000010',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    title: 'Test adapter',
    description: 'Parse JSONL without invoking the real model.',
    agentId: '00000000-0000-4000-8000-000000000003',
    acceptanceCriteria: ['Terminal event is emitted'],
    completionPolicy: 'require_user_confirmation',
    status: 'running',
    currentRunId: '00000000-0000-4000-8000-000000000011',
    version: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  run: {
    id: '00000000-0000-4000-8000-000000000011',
    taskId: '00000000-0000-4000-8000-000000000010',
    agentId: '00000000-0000-4000-8000-000000000003',
    status: 'claimed',
    attempt: 1,
    triggerType: 'user',
    workspaceRoot: tmpdir(),
    version: 1,
    createdAt: new Date(0).toISOString(),
  },
};

describe('runCodexAgent', () => {
  it('maps public Codex JSONL events and excludes reasoning text', async () => {
    const fixture = [
      { type: 'thread.started', thread_id: 'thread-123' },
      { type: 'item.completed', item: { id: 'reason-1', type: 'reasoning', text: 'hidden chain' } },
      { type: 'item.started', item: { id: 'cmd-1', type: 'command_execution', command: 'pnpm test' } },
      {
        type: 'item.completed',
        item: { id: 'cmd-1', type: 'command_execution', status: 'completed', exit_code: 0, aggregated_output: 'ok' },
      },
      { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'Implemented and tested.' } },
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
    ];
    const script = `for (const item of ${JSON.stringify(fixture)}) console.log(JSON.stringify(item));`;
    const events = [];
    for await (const event of runCodexAgent(claimed, tmpdir(), {
      processOverride: {
        command: process.execPath,
        args: ['-e', script],
      },
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'tool.called',
      'tool.completed',
      'output.delta',
      'run.completed',
    ]);
    expect(JSON.stringify(events)).not.toContain('hidden chain');
    expect(events[0]).toMatchObject({ type: 'run.started', sessionRef: 'thread-123' });
  });

  it('turns an abort signal into a cancelled terminal event', async () => {
    const cancellation = new AbortController();
    const script = [
      `console.log(JSON.stringify({type:'thread.started',thread_id:'thread-cancel'}));`,
      'setInterval(() => {}, 1000);',
    ].join('');
    setTimeout(() => cancellation.abort(), 50);
    const events = [];
    for await (const event of runCodexAgent(claimed, tmpdir(), {
      processOverride: { command: process.execPath, args: ['-e', script] },
      signal: cancellation.signal,
    })) {
      events.push(event);
    }
    expect(events.at(-1)?.type).toBe('run.cancelled');
    expect(events.some((event) => event.type === 'run.failed')).toBe(false);
  });
});
