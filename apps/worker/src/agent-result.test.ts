import { tmpdir } from 'node:os';
import {
  AGENT_RESULT_ENVELOPE_END,
  AGENT_RESULT_ENVELOPE_START,
  type ClaimedRun,
} from '@relay-hub/contracts';
import { describe, expect, it } from 'vitest';
import { agentCompletionEvents, parseAgentResult } from './agent-result.js';

const builderId = '00000000-0000-4000-8000-000000000003';
const reviewerId = '00000000-0000-4000-8000-000000000004';
const uxAgentId = '00000000-0000-4000-8000-000000000031';

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
    id: builderId,
    workspaceId: '00000000-0000-4000-8000-000000000001',
    name: 'Builder',
    adapterType: 'mock',
    capabilities: ['implement'],
    config: {},
    enabled: true,
  },
  task: {
    id: '00000000-0000-4000-8000-000000000010',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    title: 'Route through a structured result',
    description: 'The Agent proposes the next owner.',
    agentId: builderId,
    acceptanceCriteria: ['Canonical criteria stay platform-owned'],
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
    agentId: builderId,
    status: 'running',
    attempt: 1,
    triggerType: 'user',
    workspaceRoot: tmpdir(),
    bootstrapPolicySnapshot: { steps: [] },
    version: 1,
    createdAt: new Date(0).toISOString(),
  },
};

function envelope(result: unknown): string {
  return `Natural language summary first.\n${AGENT_RESULT_ENVELOPE_START}\n${JSON.stringify(result)}\n${AGENT_RESULT_ENVELOPE_END}`;
}

describe('parseAgentResult', () => {
  it('extracts a valid structured result from surrounding natural language', () => {
    const parsed = parseAgentResult(envelope({
      summary: 'Design comparison finished.',
      nextAction: { type: 'handoff', targetAgentId: uxAgentId, reason: 'UX Agent owns the next step.' },
      handoff: { objective: 'Draft the UX flow', summary: 'Two options were compared.' },
    }));
    expect(parsed).toMatchObject({
      summary: 'Design comparison finished.',
      nextAction: { type: 'handoff', targetAgentId: uxAgentId },
      handoff: { objective: 'Draft the UX flow', artifactRefs: [], decisions: [] },
    });
  });

  it('returns undefined when the message has no result envelope', () => {
    expect(parseAgentResult('Plain builder output without routing intent.')).toBeUndefined();
  });

  it('rejects an envelope without its closing marker', () => {
    expect(() => parseAgentResult(`${AGENT_RESULT_ENVELOPE_START}{"summary":"x"`)).toThrow('closing marker');
  });

  it('rejects invalid JSON and schema violations inside the envelope', () => {
    expect(() => parseAgentResult(envelope('{not json'))).toThrow('invalid structured result');
    expect(() => parseAgentResult(envelope({ summary: 'missing nextAction' }))).toThrow('invalid structured result');
  });
});

describe('agentCompletionEvents', () => {
  it('turns a structured handoff result into handoff.requested and run.completed', () => {
    const events = agentCompletionEvents({
      claimed,
      workingDirectory: '/tmp/relayhub-worktree',
      finalMessage: envelope({
        summary: 'Design is ready for implementation.',
        publicMessage: 'Use the single-column layout because it keeps the workflow legible.',
        nextAction: { type: 'handoff', targetAgentId: uxAgentId, reason: 'UX Agent owns the flow.' },
        handoff: {
          objective: 'Produce the UX flow',
          summary: 'Compared two layouts and kept the simpler one.',
          decisions: ['Use the single-column layout.'],
          risks: ['Copy is still rough.'],
        },
      }),
      commandEvidence: [],
      fallbackSummary: 'unused',
    });

    expect(events.map((event) => event.type)).toEqual(['handoff.requested', 'run.completed']);
    expect(events[0]).toMatchObject({
      type: 'handoff.requested',
      handoff: {
        bundleVersion: 2,
        targetAgentId: uxAgentId,
        objective: 'Produce the UX flow',
        acceptanceCriteria: ['Canonical criteria stay platform-owned'],
        decisions: ['Use the single-column layout.'],
        risks: ['Copy is still rough.'],
        nextAction: { type: 'handoff', targetAgentId: uxAgentId },
      },
    });
    expect(events[1]).toMatchObject({
      type: 'run.completed',
      outcome: {
        summary: 'Design is ready for implementation.',
        publicMessage: 'Use the single-column layout because it keeps the workflow legible.',
        nextAction: { type: 'handoff', targetAgentId: uxAgentId },
      },
    });
  });

  it('preserves visible text outside the envelope as the public Thread message', () => {
    const events = agentCompletionEvents({
      claimed,
      workingDirectory: '/tmp/relayhub-worktree',
      finalMessage: envelope({
        summary: 'Architecture analysis completed.',
        nextAction: { type: 'wait_for_user', reason: 'The conclusion is ready.' },
      }),
      commandEvidence: [],
      fallbackSummary: 'unused',
    });
    expect(events[0]).toMatchObject({
      type: 'run.completed',
      outcome: {
        summary: 'Architecture analysis completed.',
        publicMessage: 'Natural language summary first.',
      },
    });
  });

  it('keeps the fixed Reviewer path when request_review arrives without Handoff content', () => {
    const withReviewer: ClaimedRun = { ...claimed, task: { ...claimed.task, reviewerAgentId: reviewerId } };
    const events = agentCompletionEvents({
      claimed: withReviewer,
      workingDirectory: '/tmp/relayhub-worktree',
      finalMessage: envelope({
        summary: 'Implementation finished and verified.',
        nextAction: { type: 'request_review', targetAgentId: reviewerId, reason: 'Independent verdict required.' },
      }),
      commandEvidence: [{ command: 'pnpm test', status: 'succeeded', exitCode: 0 }],
      fallbackSummary: 'unused',
    });

    expect(events.map((event) => event.type)).toEqual(['handoff.requested', 'run.completed']);
    expect(events[0]).toMatchObject({
      type: 'handoff.requested',
      handoff: {
        targetAgentId: reviewerId,
        nextAction: { type: 'request_review', targetAgentId: reviewerId },
        evidenceRefs: [{ kind: 'command', value: 'pnpm test', label: 'succeeded · exit 0' }],
      },
    });
  });

  it('rejects request_review when the Task has no configured Reviewer', () => {
    expect(() => agentCompletionEvents({
      claimed,
      workingDirectory: '/tmp/relayhub-worktree',
      finalMessage: envelope({
        summary: 'Implementation finished.',
        nextAction: { type: 'request_review', targetAgentId: reviewerId, reason: 'Review requested.' },
      }),
      commandEvidence: [],
      fallbackSummary: 'unused',
    })).toThrow('Task has no configured Reviewer');
  });

  it('rejects request_review when the model targets a different Agent than the configured Reviewer', () => {
    const withReviewer: ClaimedRun = { ...claimed, task: { ...claimed.task, reviewerAgentId: reviewerId } };
    expect(() => agentCompletionEvents({
      claimed: withReviewer,
      workingDirectory: '/tmp/relayhub-worktree',
      finalMessage: envelope({
        summary: 'Implementation finished.',
        nextAction: { type: 'request_review', targetAgentId: uxAgentId, reason: 'Wrong reviewer selected.' },
      }),
      commandEvidence: [],
      fallbackSummary: 'unused',
    })).toThrow('configured Task Reviewer');
  });

  it('emits only run.completed for a non-routing structured result', () => {
    const events = agentCompletionEvents({
      claimed,
      workingDirectory: '/tmp/relayhub-worktree',
      finalMessage: envelope({
        summary: 'Everything is done; waiting for the user.',
        nextAction: { type: 'wait_for_user', reason: 'No further Agent step is useful.' },
      }),
      commandEvidence: [],
      fallbackSummary: 'unused',
    });
    expect(events.map((event) => event.type)).toEqual(['run.completed']);
    expect(events[0]).toMatchObject({
      type: 'run.completed',
      outcome: { nextAction: { type: 'wait_for_user' } },
    });
  });

  it('falls back to the fixed Reviewer Handoff when no envelope is returned', () => {
    const withReviewer: ClaimedRun = { ...claimed, task: { ...claimed.task, reviewerAgentId: reviewerId } };
    const events = agentCompletionEvents({
      claimed: withReviewer,
      workingDirectory: '/tmp/relayhub-worktree',
      finalMessage: 'Legacy builder output without an envelope.',
      commandEvidence: [],
      fallbackSummary: 'fallback',
    });
    expect(events.map((event) => event.type)).toEqual(['handoff.requested', 'run.completed']);
    expect(events[0]).toMatchObject({
      type: 'handoff.requested',
      handoff: { targetAgentId: reviewerId, nextAction: { type: 'request_review', targetAgentId: reviewerId } },
    });
    expect(events[1]).toMatchObject({
      type: 'run.completed',
      outcome: {
        summary: 'Legacy builder output without an envelope.',
        publicMessage: 'Legacy builder output without an envelope.',
        nextAction: { type: 'request_review' },
      },
    });
  });

  it('falls back to wait_for_user when no envelope and no Reviewer exist', () => {
    const events = agentCompletionEvents({
      claimed,
      workingDirectory: '/tmp/relayhub-worktree',
      finalMessage: 'Standalone builder output.',
      commandEvidence: [],
      fallbackSummary: 'fallback',
    });
    expect(events.map((event) => event.type)).toEqual(['run.completed']);
    expect(events[0]).toMatchObject({
      type: 'run.completed',
      outcome: { summary: 'Standalone builder output.', nextAction: { type: 'wait_for_user' } },
    });
  });

  it('truncates oversized legacy summaries inside the outcome', () => {
    const events = agentCompletionEvents({
      claimed,
      workingDirectory: '/tmp/relayhub-worktree',
      finalMessage: `prefix-${'x'.repeat(10_000)}`,
      commandEvidence: [],
      fallbackSummary: 'fallback',
    });
    const completed = events.find((event) => event.type === 'run.completed');
    if (completed?.type !== 'run.completed') throw new Error('run.completed missing');
    expect(completed.outcome.summary.length).toBeLessThanOrEqual(4_000);
  });
});
