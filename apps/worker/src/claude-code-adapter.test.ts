import { tmpdir } from 'node:os';
import type { ClaimedRun } from '@relay-hub/contracts';
import { describe, expect, it } from 'vitest';
import { claudeCodeArgumentsForRun, claudeCodeToolsForRun, runClaudeCodeAgent } from './claude-code-adapter.js';

const claimed: ClaimedRun = {
  workspace: {
    id: '00000000-0000-4000-8000-000000000001', name: 'Test', rootPath: tmpdir(),
    bootstrapPolicy: { steps: [] }, defaultCompletionPolicy: 'require_user_confirmation',
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  },
  agent: {
    id: '00000000-0000-4000-8000-000000000050', workspaceId: '00000000-0000-4000-8000-000000000001',
    name: 'Claude Builder', adapterType: 'claude_code', capabilities: ['implement'], config: {}, enabled: true,
  },
  task: {
    id: '00000000-0000-4000-8000-000000000010', workspaceId: '00000000-0000-4000-8000-000000000001',
    title: 'Test Claude Code adapter', description: 'Parse JSONL without invoking a model.',
    agentId: '00000000-0000-4000-8000-000000000050', acceptanceCriteria: ['Terminal event is emitted'],
    completionPolicy: 'require_user_confirmation', maxReviewRounds: 3, status: 'running',
    currentRunId: '00000000-0000-4000-8000-000000000011', version: 1,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  },
  run: {
    id: '00000000-0000-4000-8000-000000000011', taskId: '00000000-0000-4000-8000-000000000010',
    agentId: '00000000-0000-4000-8000-000000000050', status: 'claimed', attempt: 1,
    triggerType: 'user', workspaceRoot: tmpdir(), bootstrapPolicySnapshot: { steps: [] }, version: 1,
    createdAt: new Date(0).toISOString(),
  },
};

describe('runClaudeCodeAgent', () => {
  it('maps the frozen policy to explicit Claude Code tools and model arguments', () => {
    const configured = { ...claimed, agent: { ...claimed.agent, config: { model: 'sonnet' } } };
    const args = claudeCodeArgumentsForRun(configured);
    expect(claudeCodeToolsForRun(configured)).toEqual([
      'Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch', 'Task',
    ]);
    expect(args).toEqual(expect.arrayContaining([
      '--output-format', 'stream-json', '--permission-mode', 'dontAsk', '--model', 'sonnet',
    ]));
    expect(args.join(' ')).toContain('Bash(git push *)');
  });

  it('strictly removes shell, write, network, and sub-Agent tools from Reviewer Runs', () => {
    const reviewer: ClaimedRun = {
      ...claimed,
      agent: { ...claimed.agent, capabilities: ['review'] },
      run: { ...claimed.run, triggerType: 'review' },
    };
    expect(claudeCodeToolsForRun(reviewer)).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('maps Claude Code stream-json events to platform events and command evidence', async () => {
    const fixture = [
      { type: 'system', subtype: 'init', session_id: 'claude-session-1' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pnpm test' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'passed' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Implemented with Claude Code.' }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Implemented with Claude Code.' },
    ];
    const script = `for (const item of ${JSON.stringify(fixture)}) console.log(JSON.stringify(item));`;
    const events = [];
    for await (const event of runClaudeCodeAgent(claimed, tmpdir(), {
      processOverride: { command: process.execPath, args: ['-e', script] },
    })) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      'run.started', 'tool.called', 'tool.completed', 'output.delta', 'run.completed',
    ]);
    expect(events[0]).toMatchObject({ type: 'run.started', sessionRef: 'claude-session-1' });
    expect(events.at(-1)).toMatchObject({
      type: 'run.completed',
      outcome: {
        summary: 'Implemented with Claude Code.',
        commandEvidence: [{ command: 'pnpm test', status: 'succeeded', outputSummary: 'passed' }],
      },
    });
  });

  it('turns Claude Code authentication errors into a terminal failure', async () => {
    const fixture = [
      { type: 'system', subtype: 'init', session_id: 'claude-session-error' },
      { type: 'result', subtype: 'error', is_error: true, result: 'authentication_failed' },
    ];
    const script = `for (const item of ${JSON.stringify(fixture)}) console.log(JSON.stringify(item));`;
    const events = [];
    for await (const event of runClaudeCodeAgent(claimed, tmpdir(), {
      processOverride: { command: process.execPath, args: ['-e', script] },
    })) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'run.failed', message: 'authentication_failed' });
  });
});
