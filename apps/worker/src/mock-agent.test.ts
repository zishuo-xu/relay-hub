import { tmpdir } from 'node:os';
import type { ClaimedRun } from '@relay-hub/contracts';
import { describe, expect, it } from 'vitest';
import { runMockAgent } from './mock-agent.js';

const builderId = '00000000-0000-4000-8000-000000000003';
const reviewerId = '00000000-0000-4000-8000-000000000004';
const uxAgentId = '00000000-0000-4000-8000-000000000031';
const planAgentId = '00000000-0000-4000-8000-000000000032';

function claimed(overrides: Partial<ClaimedRun> = {}): ClaimedRun {
  const base: ClaimedRun = {
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
      name: 'Mock Builder',
      adapterType: 'mock',
      capabilities: ['implement'],
      config: {},
      enabled: true,
    },
    task: {
      id: '00000000-0000-4000-8000-000000000010',
      workspaceId: '00000000-0000-4000-8000-000000000001',
      title: 'Sequential mock routing',
      description: 'Exercise deterministic mock routing.',
      agentId: builderId,
      acceptanceCriteria: ['Platform owns acceptance criteria'],
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
  return {
    ...base,
    ...overrides,
    agent: { ...base.agent, ...(overrides.agent ?? {}) },
    task: { ...base.task, ...(overrides.task ?? {}) },
    run: { ...base.run, ...(overrides.run ?? {}) },
  };
}

async function collect(input: ClaimedRun) {
  const events = [];
  for await (const event of runMockAgent(input)) events.push(event);
  return events;
}

describe('runMockAgent sequential handoff', () => {
  it('can deterministically report the public Thread context it received', async () => {
    const events = await collect(claimed({
      task: { ...claimed().task, description: 'Continue the discussion.\nrelayhub:report-context' },
      conversationContext: {
        threadId: '00000000-0000-4000-8000-000000000100',
        policyVersion: 1,
        beforeSequence: 3,
        messages: [{
          id: '00000000-0000-4000-8000-000000000101',
          sequence: 2,
          senderType: 'agent',
          senderName: 'Architecture Agent',
          senderAgentId: uxAgentId,
          content: 'Keep the domain model small.',
          createdAt: new Date(0).toISOString(),
        }],
        omittedMessageCount: 0,
        truncatedMessageIds: [],
        digest: 'a'.repeat(64),
      },
    }));

    expect(events.at(-1)).toMatchObject({
      type: 'run.completed',
      outcome: { summary: 'Mock Agent 已读取 1 条公开线程上下文。最近发言：Architecture Agent。' },
    });
  });

  it('follows a deterministic handoff chain directive with a structured generic Handoff', async () => {
    const events = await collect(claimed({
      task: {
        ...claimed().task,
        description: `Design the flow.\nrelayhub:handoff-chain=${builderId},${uxAgentId}`,
      },
    }));

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'output.delta',
      'output.delta',
      'output.delta',
      'tool.called',
      'tool.completed',
      'output.delta',
      'handoff.requested',
      'run.completed',
    ]);
    expect(events.at(-2)).toMatchObject({
      type: 'handoff.requested',
      handoff: {
        targetAgentId: uxAgentId,
        acceptanceCriteria: ['Platform owns acceptance criteria'],
        nextAction: { type: 'handoff', targetAgentId: uxAgentId },
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'run.completed',
      outcome: { nextAction: { type: 'handoff', targetAgentId: uxAgentId } },
    });
  });

  it('keeps the fixed Reviewer fallback when no directive exists', async () => {
    const events = await collect(claimed({
      task: { ...claimed().task, reviewerAgentId: reviewerId },
    }));
    expect(events.at(-2)).toMatchObject({
      type: 'handoff.requested',
      handoff: { targetAgentId: reviewerId, nextAction: { type: 'request_review', targetAgentId: reviewerId } },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'run.completed',
      outcome: { nextAction: { type: 'request_review', targetAgentId: reviewerId } },
    });
  });

  it('acknowledges the consumed Handoff and routes to the next chain Agent', async () => {
    const events = await collect(claimed({
      agent: { ...claimed().agent, id: uxAgentId, name: 'Mock UX Agent' },
      task: {
        ...claimed().task,
        description: `Continue the chain.\nrelayhub:handoff-chain=${builderId},${uxAgentId},${planAgentId}`,
      },
      run: { ...claimed().run, agentId: uxAgentId, triggerType: 'handoff' },
      handoff: {
        id: '00000000-0000-4000-8000-000000000040',
        bundleVersion: 2,
        sourceRunId: '00000000-0000-4000-8000-000000000041',
        targetAgentId: uxAgentId,
        targetRunId: '00000000-0000-4000-8000-000000000011',
        objective: 'Draft the UX flow',
        contextSummary: 'The design Agent compared two options.',
        artifactRefs: [],
        evidenceRefs: [],
        acceptanceCriteria: ['Platform owns acceptance criteria'],
        decisions: [],
        openQuestions: [],
        risks: [],
        nextAction: { type: 'handoff', targetAgentId: uxAgentId, reason: 'UX owns the next step.' },
        contentDigest: 'a'.repeat(64),
        status: 'dispatched',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    }));

    const texts = events.filter((event) => event.type === 'output.delta').map((event) => String(event.text));
    expect(texts.some((text) => text.includes('Draft the UX flow'))).toBe(true);
    expect(events.at(-2)).toMatchObject({
      type: 'handoff.requested',
      handoff: { targetAgentId: planAgentId, nextAction: { type: 'handoff', targetAgentId: planAgentId } },
    });
  });

  it('stops routing when the current Agent is the last chain member', async () => {
    const events = await collect(claimed({
      agent: { ...claimed().agent, id: uxAgentId, name: 'Mock UX Agent' },
      task: {
        ...claimed().task,
        description: `Final step.\nrelayhub:handoff-chain=${builderId},${uxAgentId}`,
      },
      run: { ...claimed().run, agentId: uxAgentId, triggerType: 'handoff' },
    }));
    expect(events.some((event) => event.type === 'handoff.requested')).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: 'run.completed',
      outcome: { nextAction: { type: 'wait_for_user' } },
    });
  });

  it('never submits a Review from a review-capable Agent on a plain handoff Run', async () => {
    const events = await collect(claimed({
      agent: { ...claimed().agent, capabilities: ['implement', 'review'] },
      run: { ...claimed().run, triggerType: 'handoff' },
    }));
    expect(events.some((event) => event.type === 'review.submitted')).toBe(false);
    expect(events.at(-1)?.type).toBe('run.completed');
  });
});
