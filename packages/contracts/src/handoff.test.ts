import { describe, expect, it } from 'vitest';
import { AgentEventSchema, DEFAULT_MOCK_REVIEWER_AGENT_ID, ReviewDraftSchema } from './index.js';

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
