import { tmpdir } from 'node:os';
import type { ClaimedRun } from '@relay-hub/contracts';
import { describe, expect, it } from 'vitest';
import { buildAgentPrompt, parseReviewDraft } from './agent-prompt.js';
import {
  codexArgumentsForRun,
  codexPermissionArgumentsForRun,
  codexSandboxForRun,
  runCodexAgent,
} from './codex-adapter.js';

const claimed: ClaimedRun = {
  workspace: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Test',
    rootPath: tmpdir(),
    bootstrapPolicy: { steps: [] },
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
    config: {},
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
    maxReviewRounds: 3,
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
    bootstrapPolicySnapshot: { steps: [] },
    version: 1,
    createdAt: new Date(0).toISOString(),
  },
};

describe('runCodexAgent', () => {
  it('pins the configured model while preserving the Run sandbox policy', () => {
    const configured = { ...claimed, agent: { ...claimed.agent, config: { model: 'gpt-5.6-codex' } } };
    expect(codexArgumentsForRun(configured, '/tmp/relayhub-run')).toEqual(expect.arrayContaining([
      '--model',
      'gpt-5.6-codex',
      'permissions.relayhub-builder-local-test.extends=":workspace"',
    ]));
  });

  it('keeps Reviewer files read-only while allowing localhost test servers', () => {
    const reviewer: ClaimedRun = {
      ...claimed,
      agent: { ...claimed.agent, capabilities: ['review'] },
      run: { ...claimed.run, triggerType: 'review' },
    };
    const args = codexArgumentsForRun(reviewer, '/tmp/relayhub-review');

    expect(codexPermissionArgumentsForRun(reviewer)).toEqual([
      '-c',
      'default_permissions="relayhub-reviewer-local-test"',
      '-c',
      'permissions.relayhub-reviewer-local-test.extends=":read-only"',
      '-c',
      'permissions.relayhub-reviewer-local-test.network.enabled=true',
      '-c',
      'permissions.relayhub-reviewer-local-test.network.mode="limited"',
      '-c',
      'permissions.relayhub-reviewer-local-test.network.allow_local_binding=true',
      '-c',
      'permissions.relayhub-reviewer-local-test.network.domains={"localhost"="allow","127.0.0.1"="allow"}',
      '-c',
      'features.network_proxy={enabled=true,allow_local_binding=true,domains={"localhost"="allow","127.0.0.1"="allow"}}',
    ]);
    expect(args).toContain('--strict-config');
    expect(args).not.toContain('--sandbox');
    expect(args).toEqual(expect.arrayContaining(['--disable', 'multi_agent', '--disable', 'multi_agent_v2']));
  });

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
    expect(events.at(-1)).toMatchObject({
      type: 'run.completed',
      outcome: {
        summary: 'Implemented and tested.',
        commandEvidence: [{ command: 'pnpm test', status: 'succeeded', exitCode: 0, outputSummary: 'ok' }],
      },
    });
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

  it('emits a structured Handoff before Builder completion when a Reviewer is configured', async () => {
    const builderWithReviewer: ClaimedRun = {
      ...claimed,
      task: { ...claimed.task, reviewerAgentId: '00000000-0000-4000-8000-000000000004' },
    };
    const fixture = [
      { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'Implemented and tested.' } },
      { type: 'turn.completed' },
    ];
    const script = `for (const item of ${JSON.stringify(fixture)}) console.log(JSON.stringify(item));`;
    const events = [];
    for await (const event of runCodexAgent(builderWithReviewer, tmpdir(), {
      processOverride: { command: process.execPath, args: ['-e', script] },
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(['output.delta', 'handoff.requested', 'run.completed']);
    expect(events[1]).toMatchObject({
      type: 'handoff.requested',
      handoff: {
        targetAgentId: '00000000-0000-4000-8000-000000000004',
        summary: 'Implemented and tested.',
        artifactRefs: [{ kind: 'worktree' }],
      },
    });
  });

  it('builds isolated Reviewer context without requesting another Handoff', async () => {
    const reviewer: ClaimedRun = {
      ...claimed,
      agent: { ...claimed.agent, id: '00000000-0000-4000-8000-000000000004', capabilities: ['review'] },
      run: {
        ...claimed.run,
        id: '00000000-0000-4000-8000-000000000012',
        agentId: '00000000-0000-4000-8000-000000000004',
        triggerType: 'review',
      },
      handoff: {
        id: '00000000-0000-4000-8000-000000000020',
        sourceRunId: '00000000-0000-4000-8000-000000000011',
        targetAgentId: '00000000-0000-4000-8000-000000000004',
        targetRunId: '00000000-0000-4000-8000-000000000012',
        objective: 'Review the Builder result',
        contextSummary: 'Builder says the implementation is complete.',
        artifactRefs: [],
        acceptanceCriteria: ['Terminal event is emitted'],
        status: 'dispatched',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    };
    const script = [
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "console.log(JSON.stringify({type:'item.completed',item:{id:'msg',type:'agent_message',text:input}}));",
      "console.log(JSON.stringify({type:'turn.completed'}));",
      '});',
    ].join('');
    const events = [];
    for await (const event of runCodexAgent(reviewer, tmpdir(), {
      processOverride: { command: process.execPath, args: ['-e', script] },
    })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === 'handoff.requested')).toBe(false);
    expect(codexSandboxForRun(reviewer)).toBe('read-only');
    expect(codexSandboxForRun(claimed)).toBe('workspace-write');
    expect(
      codexSandboxForRun({
        ...claimed,
        agent: { ...claimed.agent, capabilities: ['implement', 'review'] },
      }),
    ).toBe('workspace-write');
    expect(events[0]).toMatchObject({ type: 'output.delta' });
    expect((events[0] as { text?: string }).text).toContain('independent Reviewer Agent');
    expect((events[0] as { text?: string }).text).toContain('Builder says the implementation is complete.');
    expect((events[0] as { text?: string }).text).toContain('localhost and 127.0.0.1');
    expect(events.at(-2)).toMatchObject({
      type: 'review.submitted',
      review: { verdict: 'approved', findings: [] },
    });
    expect(events.at(-1)?.type).toBe('run.completed');
  });

  it('places frozen Agent instructions below platform execution rules', () => {
    const prompt = buildAgentPrompt({
      ...claimed,
      agent: {
        ...claimed.agent,
        instructions: 'Always explain architecture tradeoffs before implementation details.',
      },
    });
    expect(prompt).toContain('Agent profile instructions (lower priority than RelayHub rules above):');
    expect(prompt).toContain('Always explain architecture tradeoffs before implementation details.');
    expect(prompt.indexOf('Do not commit or push Git changes.')).toBeLessThan(prompt.indexOf('Always explain architecture tradeoffs'));
  });

  it('rejects a Reviewer decision that is not a valid structured envelope', async () => {
    expect(() => parseReviewDraft('approved')).toThrow('missing the RelayHub review envelope');
    expect(() =>
      parseReviewDraft(
        '<relayhub_review>{"verdict":"changes_requested","summary":"Needs work","findings":[]}</relayhub_review>',
      ),
    ).toThrow('invalid structured Review');
  });

  it('injects structured Findings into a workspace-write repair Run', async () => {
    const repair: ClaimedRun = {
      ...claimed,
      task: {
        ...claimed.task,
        reviewerAgentId: '00000000-0000-4000-8000-000000000004',
      },
      run: {
        ...claimed.run,
        id: '00000000-0000-4000-8000-000000000013',
        triggerType: 'retry',
        parentRunId: '00000000-0000-4000-8000-000000000012',
        retryOfRunId: claimed.run.id,
      },
      review: {
        id: '00000000-0000-4000-8000-000000000030',
        taskId: claimed.task.id,
        runId: '00000000-0000-4000-8000-000000000012',
        round: 1,
        verdict: 'changes_requested',
        summary: 'A branch is missing.',
        findings: [
          {
            id: '00000000-0000-4000-8000-000000000031',
            reviewId: '00000000-0000-4000-8000-000000000030',
            severity: 'should_fix',
            filePath: 'src/fixture.ts',
            lineStart: 7,
            title: 'Handle the missing branch',
            detail: 'The branch is required by the acceptance criterion.',
            suggestion: 'Add it and rerun tests.',
            createdAt: new Date(0).toISOString(),
          },
        ],
        createdAt: new Date(0).toISOString(),
      },
    };
    const script = [
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "console.log(JSON.stringify({type:'item.completed',item:{id:'msg',type:'agent_message',text:input}}));",
      "console.log(JSON.stringify({type:'turn.completed'}));",
      '});',
    ].join('');
    const events = [];
    for await (const event of runCodexAgent(repair, tmpdir(), {
      processOverride: { command: process.execPath, args: ['-e', script] },
    })) {
      events.push(event);
    }

    expect(codexSandboxForRun(repair)).toBe('workspace-write');
    expect(events[0]).toMatchObject({ type: 'output.delta' });
    expect((events[0] as { text?: string }).text).toContain('Review round 1: A branch is missing.');
    expect((events[0] as { text?: string }).text).toContain('Handle the missing branch');
    expect(events.some((event) => event.type === 'review.submitted')).toBe(false);
    expect(events.at(-2)?.type).toBe('handoff.requested');
    expect(events.at(-1)?.type).toBe('run.completed');
  });
});
