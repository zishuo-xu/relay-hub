import { describe, expect, it } from 'vitest';
import { AgentEventSchema, DEFAULT_MOCK_REVIEWER_AGENT_ID } from './index.js';

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
