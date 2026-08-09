import { describe, expect, it } from 'vitest';
import {
  AgentEventSchema,
  AgentProfileInputSchema,
  CreateTaskInputSchema,
  DEFAULT_MOCK_AGENT_ID,
  DEFAULT_MOCK_REVIEWER_AGENT_ID,
  DEFAULT_OPENCODE_CONNECTION_ID,
  ReviewDraftSchema,
} from './index.js';

describe('AgentProfile configuration contract', () => {
  it('accepts an OpenCode profile with an explicit provider/model', () => {
    expect(AgentProfileInputSchema.parse({
      name: 'OpenCode Reviewer',
      adapterType: 'opencode_cli',
      providerConnectionId: DEFAULT_OPENCODE_CONNECTION_ID,
      capabilities: ['review'],
      model: 'opencode/north-mini-code-free',
    })).toMatchObject({ adapterType: 'opencode_cli', enabled: true });
  });

  it('requires every executable Agent to reference a provider connection', () => {
    expect(() => AgentProfileInputSchema.parse({
      name: 'Broken OpenCode',
      adapterType: 'opencode_cli',
      capabilities: ['implement'],
      model: 'north-mini-code-free',
    })).toThrow('provider connection');
  });

  it('allows a Codex model but keeps OpenCode-only fields out of Codex profiles', () => {
    expect(AgentProfileInputSchema.parse({
      name: 'Codex Builder',
      adapterType: 'codex_cli',
      providerConnectionId: '00000000-0000-4000-8000-000000000005',
      capabilities: ['implement'],
    })).toMatchObject({ adapterType: 'codex_cli' });
    expect(() => AgentProfileInputSchema.parse({
      name: 'Misconfigured Codex',
      adapterType: 'codex_cli',
      providerConnectionId: '00000000-0000-4000-8000-000000000005',
      capabilities: ['implement'],
      model: 'gpt-5.6-codex',
      variant: 'max',
    })).toThrow('only supported by OpenCode');
  });

  it('rejects credentials on Agent profiles because connections own authentication', () => {
    expect(() => AgentProfileInputSchema.parse({
      name: 'Leaky OpenCode Agent',
      adapterType: 'opencode_cli',
      providerConnectionId: DEFAULT_OPENCODE_CONNECTION_ID,
      capabilities: ['implement'],
      model: 'opencode/big-pickle',
      credentialEnv: 'OPENAI_API_KEY',
    })).toThrow('Unrecognized key');
  });
});

describe('Task review policy contract', () => {
  const baseInput = {
    title: 'Review policy',
    description: 'Verify review-round defaults and bounds.',
    agentId: DEFAULT_MOCK_AGENT_ID,
  };

  it('defaults to three review rounds and accepts an explicit bounded budget', () => {
    expect(CreateTaskInputSchema.parse(baseInput).maxReviewRounds).toBe(3);
    expect(CreateTaskInputSchema.parse({ ...baseInput, maxReviewRounds: 10 }).maxReviewRounds).toBe(10);
  });

  it('rejects a review budget outside 1 through 10', () => {
    expect(() => CreateTaskInputSchema.parse({ ...baseInput, maxReviewRounds: 0 })).toThrow();
    expect(() => CreateTaskInputSchema.parse({ ...baseInput, maxReviewRounds: 11 })).toThrow();
  });
});

describe('Handoff contract', () => {
  it('accepts bounded structured context and applies list defaults', () => {
    expect(
      AgentEventSchema.parse({
        type: 'handoff.requested',
        handoff: {
          targetAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
          objective: 'Review the Builder result',
          summary: 'Builder completed the requested implementation.',
        },
      }),
    ).toEqual({
      type: 'handoff.requested',
      handoff: {
        targetAgentId: DEFAULT_MOCK_REVIEWER_AGENT_ID,
        objective: 'Review the Builder result',
        summary: 'Builder completed the requested implementation.',
        artifactRefs: [],
        acceptanceCriteria: [],
      },
    });
  });

  it('rejects an unstructured target identity', () => {
    expect(() =>
      AgentEventSchema.parse({
        type: 'handoff.requested',
        handoff: { targetAgentId: 'reviewer', objective: 'Review', summary: 'Done' },
      }),
    ).toThrow();
  });
});

describe('Review contract', () => {
  it('accepts an approved decision with suggestion-only findings', () => {
    expect(
      ReviewDraftSchema.parse({
        verdict: 'approved',
        summary: 'The implementation satisfies the acceptance criteria.',
        findings: [{ severity: 'suggestion', title: 'Optional cleanup', detail: 'This does not block approval.' }],
      }),
    ).toMatchObject({ verdict: 'approved' });
  });

  it('requires actionable evidence for changes_requested and blocking evidence for blocked', () => {
    expect(() =>
      ReviewDraftSchema.parse({ verdict: 'changes_requested', summary: 'Needs work', findings: [] }),
    ).toThrow();
    expect(() =>
      ReviewDraftSchema.parse({
        verdict: 'blocked',
        summary: 'Cannot continue',
        findings: [{ severity: 'should_fix', title: 'Missing dependency', detail: 'Dependency is unavailable.' }],
      }),
    ).toThrow();
  });
});
