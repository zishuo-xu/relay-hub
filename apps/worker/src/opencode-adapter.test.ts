import { tmpdir } from 'node:os';
import type { ClaimedRun } from '@relay-hub/contracts';
import { describe, expect, it } from 'vitest';
import { openCodeRuntimePermissions, runOpenCodeAgent } from './opencode-adapter.js';

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
    id: '00000000-0000-4000-8000-000000000030',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    name: 'OpenCode Builder',
    adapterType: 'opencode_cli',
    provider: 'opencode',
    modelLabel: 'opencode/test-model',
    capabilities: ['implement'],
    config: { model: 'opencode/test-model' },
    enabled: true,
  },
  task: {
    id: '00000000-0000-4000-8000-000000000010',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    title: 'Test OpenCode adapter',
    description: 'Parse JSONL without invoking a model.',
    agentId: '00000000-0000-4000-8000-000000000030',
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
    agentId: '00000000-0000-4000-8000-000000000030',
    status: 'claimed',
    attempt: 1,
    triggerType: 'user',
    workspaceRoot: tmpdir(),
    bootstrapPolicySnapshot: { steps: [] },
    version: 1,
    createdAt: new Date(0).toISOString(),
  },
};

describe('runOpenCodeAgent', () => {
  it('maps the Run policy to OpenCode permissions without elevating read-only Runs', () => {
    const reviewer: ClaimedRun = {
      ...claimed,
      agent: { ...claimed.agent, capabilities: ['review'] },
      run: { ...claimed.run, triggerType: 'review' },
    };
    expect(openCodeRuntimePermissions(reviewer)).toMatchObject({
      share: 'disabled',
      permission: {
        edit: 'deny',
        bash: 'deny',
        webfetch: 'deny',
        external_directory: 'deny',
        task: 'deny',
      },
    });
    expect(openCodeRuntimePermissions(claimed)).toMatchObject({
      permission: {
        external_directory: 'deny',
        bash: {
          'git commit*': 'deny',
          'git push*': 'deny',
        },
      },
    });
    expect((openCodeRuntimePermissions(claimed).permission as Record<string, unknown>).task).toBeUndefined();
  });

  it('maps OpenCode JSON events to RelayHub events and Builder completion', async () => {
    const fixture = [
      { type: 'step_start', sessionID: 'ses_test' },
      {
        type: 'tool_use',
        sessionID: 'ses_test',
        part: {
          id: 'tool-1',
          tool: 'bash',
          state: { status: 'completed', input: { command: 'pnpm test' }, output: 'passed' },
        },
      },
      { type: 'text', sessionID: 'ses_test', part: { text: 'Implemented with OpenCode.' } },
      { type: 'step_finish', sessionID: 'ses_test' },
    ];
    const script = `for (const item of ${JSON.stringify(fixture)}) console.log(JSON.stringify(item));`;
    const events = [];
    for await (const event of runOpenCodeAgent(claimed, tmpdir(), {
      processOverride: { command: process.execPath, args: ['-e', script] },
    })) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'tool.called',
      'tool.completed',
      'output.delta',
      'run.completed',
    ]);
    expect(events[0]).toMatchObject({ type: 'run.started', sessionRef: 'ses_test' });
    expect(events.at(-1)).toMatchObject({
      type: 'run.completed',
      outcome: {
        summary: 'Implemented with OpenCode.',
        commandEvidence: [{ command: 'pnpm test', status: 'succeeded', outputSummary: 'passed' }],
      },
    });
  });

  it('submits a structured Review before Reviewer completion', async () => {
    const reviewer: ClaimedRun = {
      ...claimed,
      agent: { ...claimed.agent, capabilities: ['review'] },
      task: { ...claimed.task, reviewerAgentId: claimed.agent.id, status: 'reviewing' },
      run: { ...claimed.run, triggerType: 'review' },
      handoff: {
        id: '00000000-0000-4000-8000-000000000040',
        bundleVersion: 2,
        sourceRunId: '00000000-0000-4000-8000-000000000041',
        targetAgentId: claimed.agent.id,
        targetRunId: claimed.run.id,
        objective: 'Review the result',
        contextSummary: 'Builder completed the change.',
        artifactRefs: [],
        evidenceRefs: [],
        acceptanceCriteria: claimed.task.acceptanceCriteria,
        decisions: [],
        openQuestions: [],
        risks: [],
        nextAction: {
          type: 'request_review',
          targetAgentId: claimed.agent.id,
          reason: 'Independent review is required.',
        },
        status: 'dispatched',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    };
    const review = '<relayhub_review>{"verdict":"approved","summary":"Looks good.","findings":[]}</relayhub_review>';
    const script = `console.log(JSON.stringify({type:'text',sessionID:'ses_review',part:{text:${JSON.stringify(review)}}}));`;
    const events = [];
    for await (const event of runOpenCodeAgent(reviewer, tmpdir(), {
      processOverride: { command: process.execPath, args: ['-e', script] },
    })) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'output.delta',
      'review.submitted',
      'run.completed',
    ]);
  });

  it('routes a structured generic Handoff result from the final text', async () => {
    const uxAgentId = '00000000-0000-4000-8000-000000000031';
    const text = [
      'Design finished.',
      '<relayhub_result>',
      JSON.stringify({
        summary: 'Design notes are ready.',
        nextAction: { type: 'handoff', targetAgentId: uxAgentId, reason: 'UX Agent owns the next step.' },
        handoff: { objective: 'Draft the UX flow', summary: 'Compared two layouts.' },
      }),
      '</relayhub_result>',
    ].join('\n');
    const fixture = [
      { type: 'step_start', sessionID: 'ses_handoff' },
      { type: 'text', sessionID: 'ses_handoff', part: { text } },
      { type: 'step_finish', sessionID: 'ses_handoff' },
    ];
    const script = `for (const item of ${JSON.stringify(fixture)}) console.log(JSON.stringify(item));`;
    const events = [];
    for await (const event of runOpenCodeAgent(claimed, tmpdir(), {
      processOverride: { command: process.execPath, args: ['-e', script] },
    })) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'output.delta',
      'handoff.requested',
      'run.completed',
    ]);
    expect(events[2]).toMatchObject({
      type: 'handoff.requested',
      handoff: {
        targetAgentId: uxAgentId,
        nextAction: { type: 'handoff', targetAgentId: uxAgentId },
        acceptanceCriteria: ['Terminal event is emitted'],
      },
    });
    expect(events[3]).toMatchObject({
      type: 'run.completed',
      outcome: { nextAction: { type: 'handoff', targetAgentId: uxAgentId } },
    });
  });

  it('fails the Run as a protocol error when the result envelope is malformed', async () => {
    const fixture = [
      { type: 'step_start', sessionID: 'ses_bad' },
      { type: 'text', sessionID: 'ses_bad', part: { text: 'Broken <relayhub_result>{"summary":' } },
      { type: 'step_finish', sessionID: 'ses_bad' },
    ];
    const script = `for (const item of ${JSON.stringify(fixture)}) console.log(JSON.stringify(item));`;
    const events = [];
    for await (const event of runOpenCodeAgent(claimed, tmpdir(), {
      processOverride: { command: process.execPath, args: ['-e', script] },
    })) events.push(event);

    expect(events.some((event) => event.type === 'run.completed')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'run.failed', code: 'protocol_error' });
  });

  it('turns an OpenCode error envelope into a terminal failure', async () => {
    const script = "console.log(JSON.stringify({type:'error',sessionID:'ses_error',error:{message:'provider failed'}}));";
    const events = [];
    for await (const event of runOpenCodeAgent(claimed, tmpdir(), {
      processOverride: { command: process.execPath, args: ['-e', script] },
    })) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'run.failed', code: 'unknown' });
  });
});
