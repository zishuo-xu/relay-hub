import { describe, expect, it } from 'vitest';
import {
  AgentResultSchema,
  DEFAULT_MOCK_AGENT_ID,
  DEFAULT_MOCK_REVIEWER_AGENT_ID,
  HandoffDraftSchema,
  HandoffTargetViewSchema,
  MAX_SEQUENTIAL_HANDOFFS,
  RunOutcomeSchema,
} from './index.js';

const targetId = DEFAULT_MOCK_REVIEWER_AGENT_ID;

describe('Agent result contract', () => {
  it('accepts a structured handoff result and applies list defaults', () => {
    expect(
      AgentResultSchema.parse({
        summary: 'Design notes are ready for implementation.',
        publicMessage: 'The approved design uses one focused workflow column.',
        nextAction: { type: 'handoff', targetAgentId: targetId, reason: 'Builder owns the next step.' },
        handoff: {
          objective: 'Implement the approved design',
          summary: 'The design Agent compared two options and picked the simpler one.',
          evidenceRefs: [{ kind: 'text', value: 'Option comparison', label: 'analysis' }],
        },
      }),
    ).toEqual({
      summary: 'Design notes are ready for implementation.',
      publicMessage: 'The approved design uses one focused workflow column.',
      nextAction: { type: 'handoff', targetAgentId: targetId, reason: 'Builder owns the next step.' },
      handoff: {
        objective: 'Implement the approved design',
        summary: 'The design Agent compared two options and picked the simpler one.',
        artifactRefs: [],
        evidenceRefs: [{ kind: 'text', value: 'Option comparison', label: 'analysis' }],
        decisions: [],
        openQuestions: [],
        risks: [],
      },
    });
  });

  it('accepts a request_review result without Handoff content', () => {
    expect(
      AgentResultSchema.parse({
        summary: 'Implementation finished.',
        nextAction: { type: 'request_review', targetAgentId: targetId, reason: 'Independent verdict required.' },
      }),
    ).toMatchObject({ nextAction: { type: 'request_review', targetAgentId: targetId } });
  });

  it('requires Handoff content for a handoff nextAction', () => {
    expect(() =>
      AgentResultSchema.parse({
        summary: 'Ready to hand over.',
        nextAction: { type: 'handoff', targetAgentId: targetId, reason: 'Missing the bundle.' },
      }),
    ).toThrow('requires structured Handoff content');
  });

  it('rejects Handoff content without a routing nextAction', () => {
    expect(() =>
      AgentResultSchema.parse({
        summary: 'Done.',
        nextAction: { type: 'wait_for_user', reason: 'No routing allowed.' },
        handoff: { objective: 'Sneak a bundle', summary: 'This must not pass.' },
      }),
    ).toThrow('handoff or request_review');
  });

  it('rejects malformed envelopes and unknown fields', () => {
    expect(() => AgentResultSchema.parse({ summary: 'Missing the action.' })).toThrow();
    expect(() =>
      AgentResultSchema.parse({
        summary: 'Done.',
        nextAction: { type: 'handoff', targetAgentId: 'not-a-uuid', reason: 'Bad identity.' },
        handoff: { objective: 'x', summary: 'y' },
      }),
    ).toThrow();
    expect(() =>
      AgentResultSchema.parse({
        summary: 'Done.',
        nextAction: { type: 'wait_for_user', reason: 'ok' },
        acceptanceCriteria: ['Agent must never rewrite canonical criteria'],
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      AgentResultSchema.parse({
        summary: 'Done.',
        nextAction: { type: 'handoff', targetAgentId: targetId, reason: 'Route.' },
        handoff: { objective: 'x', summary: 'y', targetAgentId: DEFAULT_MOCK_AGENT_ID },
      }),
    ).toThrow('Unrecognized key');
  });

  it('keeps the single target source: composed HandoffDraft enforces target consistency', () => {
    const result = AgentResultSchema.parse({
      summary: 'Ready.',
      nextAction: { type: 'handoff', targetAgentId: targetId, reason: 'Next owner.' },
      handoff: { objective: 'Continue the work', summary: 'Context without hidden reasoning.' },
    });
    if (result.nextAction.type !== 'handoff') throw new Error('expected a handoff action');
    const draft = HandoffDraftSchema.parse({
      targetAgentId: result.nextAction.targetAgentId,
      objective: result.handoff!.objective,
      summary: result.handoff!.summary,
      nextAction: result.nextAction,
    });
    expect(draft.nextAction.targetAgentId).toBe(draft.targetAgentId);
    expect(() =>
      HandoffDraftSchema.parse({
        targetAgentId: DEFAULT_MOCK_AGENT_ID,
        objective: 'Mismatch',
        summary: 'Mismatch',
        nextAction: result.nextAction,
      }),
    ).toThrow('nextAction targetAgentId');
  });

  it('keeps legacy RunOutcome without nextAction compatible', () => {
    expect(RunOutcomeSchema.parse({ summary: 'Legacy builder output.' })).toEqual({
      summary: 'Legacy builder output.',
      commandEvidence: [],
    });
  });

  it('keeps the public Thread message separate from the audit summary', () => {
    expect(RunOutcomeSchema.parse({
      summary: 'Architecture Run completed.',
      publicMessage: 'Use a versioned public context boundary for every new Task.',
    })).toEqual({
      summary: 'Architecture Run completed.',
      publicMessage: 'Use a versioned public context boundary for every new Task.',
      commandEvidence: [],
    });
  });

  it('exposes only minimal Handoff target directory fields', () => {
    expect(
      HandoffTargetViewSchema.parse({ id: targetId, name: 'UX Agent', capabilities: ['implement'] }),
    ).toEqual({ id: targetId, name: 'UX Agent', capabilities: ['implement'] });
    expect(() =>
      HandoffTargetViewSchema.parse({
        id: targetId,
        name: 'Leaky Agent',
        capabilities: ['implement'],
        instructions: 'hidden long-term prompt',
      }),
    ).toThrow('Unrecognized key');
    expect(() =>
      HandoffTargetViewSchema.parse({
        id: targetId,
        name: 'Leaky Agent',
        capabilities: ['implement'],
        config: { credentialEnv: 'SECRET_KEY' },
      }),
    ).toThrow('Unrecognized key');
  });

  it('fixes the sequential Handoff budget at six per Task', () => {
    expect(MAX_SEQUENTIAL_HANDOFFS).toBe(6);
  });
});
