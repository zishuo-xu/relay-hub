import {
  AGENT_RESULT_ENVELOPE_END,
  AGENT_RESULT_ENVELOPE_START,
  type AgentEvent,
  type ClaimedRun,
} from '@relay-hub/contracts';
import { agentCompletionEvents } from './agent-result.js';

const HANDOFF_CHAIN_PATTERN = /^relayhub:handoff-chain=([0-9a-fA-F-]+(?:,[0-9a-fA-F-]+)*)\s*$/m;

/**
 * Deterministic mock routing: a Task description line
 * `relayhub:handoff-chain=<agentId>,<agentId>,...` describes the platform
 * Agent sequence. The mock Run of a chain member hands off to the next one;
 * the last member (or any non-member) falls back to the default route.
 */
export function mockHandoffChainNext(description: string, currentAgentId: string): string | undefined {
  const chain = HANDOFF_CHAIN_PATTERN.exec(description)?.[1]?.split(',');
  if (!chain) return undefined;
  const index = chain.indexOf(currentAgentId);
  if (index < 0) return undefined;
  return chain[index + 1];
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function* runMockAgent(claimed: ClaimedRun): AsyncGenerator<AgentEvent> {
  yield { type: 'run.started', sessionRef: `mock-${claimed.run.id}` };

  const isReviewRun = claimed.run.triggerType === 'review';

  const messages = isReviewRun
    ? [
        `收到 Reviewer 任务：${claimed.handoff?.objective ?? claimed.task.title}`,
        '正在独立检查 Builder 交接内容与验收标准……',
        `已读取 ${claimed.handoff?.artifactRefs.length ?? 0} 个交接产物引用。`,
      ]
    : claimed.run.triggerType === 'retry'
      ? [
          `收到返工任务：Review round ${claimed.review?.round ?? 'unknown'}`,
          `正在处理 ${claimed.review?.findings.length ?? 0} 个结构化 Finding……`,
          '已完成修改并重新验证验收标准。',
        ]
      : claimed.run.triggerType === 'handoff'
        ? [
            `收到交接任务：${claimed.handoff?.objective ?? claimed.task.title}`,
            `已加载 Handoff v${claimed.handoff?.bundleVersion ?? 2} 的上下文摘要、${claimed.handoff?.evidenceRefs.length ?? 0} 个证据引用与 ${claimed.handoff?.decisions.length ?? 0} 条决策。`,
            '正在基于交接上下文继续执行……',
          ]
        : [
          `收到任务：${claimed.task.title}`,
          '正在分析需求与验收标准……',
          `已确认 ${claimed.task.acceptanceCriteria.length} 条验收标准。`,
        ];
  for (const text of messages) {
    await wait(450);
    yield { type: 'output.delta', text };
  }

  const callId = `mock-tool-${claimed.run.id}`;
  await wait(350);
  yield { type: 'tool.called', callId, name: 'workspace.inspect', inputSummary: { taskId: claimed.task.id } };
  await wait(500);
  yield { type: 'tool.completed', callId, outputSummary: { filesInspected: 3 } };
  await wait(450);
  yield {
    type: 'output.delta',
    text: isReviewRun ? 'Mock Reviewer 已完成独立检查。' : 'Mock Agent 已完成本次任务，执行记录已持久化。',
  };

  if (isReviewRun) {
    yield {
      type: 'review.submitted',
      review: {
        verdict: 'approved',
        summary: 'Mock Reviewer verified the Handoff and acceptance criteria without actionable findings.',
        findings: [],
      },
    };
    yield {
      type: 'run.completed',
      outcome: {
        summary: 'Mock review execution completed successfully.',
        commandEvidence: [],
      },
    };
    return;
  }

  const chainNext = claimed.run.triggerType === 'user' || claimed.run.triggerType === 'handoff'
    ? mockHandoffChainNext(claimed.task.description, claimed.agent.id)
    : undefined;
  const finalMessage = chainNext
    ? [
        'Mock Agent 已完成本次任务，执行记录已持久化。',
        AGENT_RESULT_ENVELOPE_START,
        JSON.stringify({
          summary: `Mock Agent completed its deterministic step for: ${claimed.task.title}`,
          nextAction: {
            type: 'handoff',
            targetAgentId: chainNext,
            reason: 'The mock handoff chain routes the Task to the next platform Agent.',
          },
          handoff: {
            objective: `Continue the Task: ${claimed.task.title}`,
            summary: 'Mock Agent finished its deterministic step; the full Handoff V2 bundle carries the context.',
            decisions: ['Mock Agent followed the deterministic handoff chain from the Task description.'],
          },
        }),
        AGENT_RESULT_ENVELOPE_END,
      ].join('\n')
    : 'Mock Agent 已完成本次任务，执行记录已持久化。';

  for (const event of agentCompletionEvents({
    claimed,
    workingDirectory: claimed.run.workingDirectory ?? claimed.run.workspaceRoot,
    finalMessage,
    commandEvidence: [],
    fallbackSummary: 'Mock execution completed successfully.',
  })) {
    yield event;
  }
}
