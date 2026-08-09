import type { AgentEvent, ClaimedRun } from '@relay-hub/contracts';
import { buildReviewHandoff, nextActionAfterBuilder } from './handoff.js';

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function* runMockAgent(claimed: ClaimedRun): AsyncGenerator<AgentEvent> {
  yield { type: 'run.started', sessionRef: `mock-${claimed.run.id}` };

  const isReviewer = claimed.run.triggerType === 'review' || claimed.agent.capabilities.includes('review');

  const messages = isReviewer
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
    text: isReviewer ? 'Mock Reviewer 已完成独立检查。' : 'Mock Agent 已完成本次任务，执行记录已持久化。',
  };
  if (!isReviewer && claimed.task.reviewerAgentId) {
    yield {
      type: 'handoff.requested',
      handoff: buildReviewHandoff(
        claimed,
        claimed.run.workingDirectory ?? claimed.run.workspaceRoot,
        'Mock Builder completed the requested work and prepared it for independent review.',
        [],
      ),
    };
  }
  if (isReviewer) {
    yield {
      type: 'review.submitted',
      review: {
        verdict: 'approved',
        summary: 'Mock Reviewer verified the Handoff and acceptance criteria without actionable findings.',
        findings: [],
      },
    };
  }
  yield {
    type: 'run.completed',
    outcome: {
      summary: isReviewer ? 'Mock review execution completed successfully.' : 'Mock execution completed successfully.',
      commandEvidence: [],
      ...(!isReviewer ? { nextAction: nextActionAfterBuilder(claimed) } : {}),
    },
  };
}
