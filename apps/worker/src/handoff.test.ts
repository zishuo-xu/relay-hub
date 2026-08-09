import { tmpdir } from 'node:os';
import type { ClaimedRun } from '@relay-hub/contracts';
import { describe, expect, it } from 'vitest';
import { buildReviewHandoff, handoffConsumedEvent, nextActionAfterBuilder } from './handoff.js';

const reviewerId = '00000000-0000-4000-8000-000000000004';

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
    name: 'Builder',
    adapterType: 'mock',
    capabilities: ['implement'],
    config: {},
    enabled: true,
  },
  task: {
    id: '00000000-0000-4000-8000-000000000010',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    title: 'Preserve handoff context',
    description: 'Create a versioned bundle.',
    agentId: '00000000-0000-4000-8000-000000000003',
    reviewerAgentId: reviewerId,
    acceptanceCriteria: ['Evidence survives routing'],
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
    status: 'running',
    attempt: 1,
    triggerType: 'user',
    workspaceRoot: tmpdir(),
    bootstrapPolicySnapshot: { steps: [] },
    version: 1,
    createdAt: new Date(0).toISOString(),
  },
};

describe('Handoff V2 worker helpers', () => {
  it('builds a closed review action and preserves command evidence', () => {
    const handoff = buildReviewHandoff(claimed, '/tmp/relayhub-worktree', 'Implemented.', [
      { command: 'pnpm test', status: 'succeeded', exitCode: 0, outputSummary: '24 tests passed' },
    ]);
    expect(handoff).toMatchObject({
      bundleVersion: 2,
      targetAgentId: reviewerId,
      evidenceRefs: [{ kind: 'command', value: 'pnpm test\nOutput: 24 tests passed', label: 'succeeded · exit 0' }],
      nextAction: { type: 'request_review', targetAgentId: reviewerId },
    });
    expect(nextActionAfterBuilder(claimed)).toMatchObject({ type: 'request_review', targetAgentId: reviewerId });
  });

  it('echoes persisted integrity metadata when the target Worker loads a Handoff', () => {
    const contentDigest = 'a'.repeat(64);
    expect(handoffConsumedEvent({
      ...claimed,
      handoff: {
        id: '00000000-0000-4000-8000-000000000020',
        bundleVersion: 2,
        sourceRunId: claimed.run.id,
        targetAgentId: reviewerId,
        objective: 'Review',
        contextSummary: 'Implemented.',
        artifactRefs: [],
        evidenceRefs: [],
        acceptanceCriteria: claimed.task.acceptanceCriteria,
        decisions: [],
        openQuestions: [],
        risks: [],
        nextAction: { type: 'request_review', targetAgentId: reviewerId, reason: 'Review.' },
        contentDigest,
        status: 'dispatched',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    })).toEqual({
      type: 'handoff.consumed',
      handoffId: '00000000-0000-4000-8000-000000000020',
      bundleVersion: 2,
      contentDigest,
    });
  });
});
