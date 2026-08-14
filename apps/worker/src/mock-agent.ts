import {
  AGENT_RESULT_ENVELOPE_END,
  AGENT_RESULT_ENVELOPE_START,
  type AgentEvent,
  type ClaimedRun,
} from '@relay-hub/contracts';
import { agentCompletionEvents } from './agent-result.js';

const HANDOFF_CHAIN_PATTERN = /^relayhub:handoff-chain=([0-9a-fA-F-]+(?:,[0-9a-fA-F-]+)*)\s*$/m;
const CONSULT_PATTERN = /^relayhub:consult=([0-9a-fA-F-]+)\s*$/m;
const DELEGATE_PATTERN = /^relayhub:delegate=([0-9a-fA-F-]+(?:,[0-9a-fA-F-]+)*)\s*$/m;
const REPORT_CONTEXT_PATTERN = /^relayhub:report-context\s*$/m;

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
  const isConsultationRun = claimed.run.triggerType === 'consult';

  const messages = isReviewRun
    ? [
        `收到 Reviewer 任务：${claimed.handoff?.objective ?? claimed.task.title}`,
        '正在独立检查 Builder 交接内容与验收标准……',
        `已读取 ${claimed.handoff?.artifactRefs.length ?? 0} 个交接产物引用。`,
      ]
    : isConsultationRun
      ? [
          `收到咨询问题：${claimed.consultation?.question ?? claimed.task.title}`,
          '正在只读分析必要上下文……',
          '已形成给负责 Agent 的咨询建议。',
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
        publicMessage: 'Mock Reviewer verified the Handoff and acceptance criteria without actionable findings.',
        commandEvidence: [],
      },
    };
    return;
  }

  if (isConsultationRun) {
    const finalMessage = [
      'Mock 咨询 Agent 建议保持当前边界，并由原 Agent 负责综合结论。',
      AGENT_RESULT_ENVELOPE_START,
      JSON.stringify({
        summary: 'Mock consultation answered the bounded question.',
        publicMessage: 'Mock 咨询 Agent 建议保持当前边界，并由原 Agent 负责综合结论。',
        nextAction: { type: 'complete', reason: 'The bounded mock consultation has been answered.' },
      }),
      AGENT_RESULT_ENVELOPE_END,
    ].join('\n');
    for (const event of agentCompletionEvents({
      claimed,
      workingDirectory: claimed.run.workingDirectory ?? claimed.run.workspaceRoot,
      finalMessage,
      commandEvidence: [],
      fallbackSummary: 'Mock consultation completed successfully.',
    })) {
      yield event;
    }
    return;
  }

  const chainNext = claimed.run.triggerType === 'user' || claimed.run.triggerType === 'handoff'
    ? mockHandoffChainNext(claimed.task.description, claimed.agent.id)
    : undefined;
  const contextReport = REPORT_CONTEXT_PATTERN.test(claimed.task.description)
    ? `Mock Agent 已读取 ${claimed.conversationContext?.messages.length ?? 0} 条公开线程上下文。最近发言：${claimed.conversationContext?.messages.at(-1)?.senderName ?? '无'}。`
    : undefined;
  const consultTarget = claimed.run.triggerType === 'user'
    ? CONSULT_PATTERN.exec(claimed.task.description)?.[1]
    : undefined;
  const delegateTargets = claimed.run.triggerType === 'user'
    ? DELEGATE_PATTERN.exec(claimed.task.description)?.[1]?.split(',')
    : undefined;
  const finalMessage = claimed.delegation
    ? [
        `Mock Agent 已完成委派子任务：${claimed.delegation.title}`,
        AGENT_RESULT_ENVELOPE_START,
        JSON.stringify({
          summary: `Completed delegated ${claimed.delegation.kind} work: ${claimed.delegation.title}`,
          publicMessage: `Mock Agent 已完成委派子任务：${claimed.delegation.title}`,
          nextAction: { type: 'complete', reason: 'The bounded delegated child Task is complete.' },
        }),
        AGENT_RESULT_ENVELOPE_END,
      ].join('\n')
    : delegateTargets?.length
      ? [
          'Mock Lead 已准备好分工计划，等待用户确认后启动独立子任务。',
          AGENT_RESULT_ENVELOPE_START,
          JSON.stringify({
            summary: 'Mock Lead proposed independent delegated work packages.',
            publicMessage: 'Mock Lead 已准备好分工计划，等待用户确认后启动独立子任务。',
            nextAction: { type: 'delegate', reason: 'The mock scenario exercises Agent-led task delegation.' },
            delegationPlan: {
              reportingMode: 'final_only',
              assignments: delegateTargets.map((targetAgentId, index) => ({
                targetAgentId,
                kind: index === 0 ? 'analysis' : 'implementation',
                title: index === 0 ? '独立需求分析' : `独立实现任务 ${index + 1}`,
                objective: index === 0 ? '形成一份边界清晰的需求分析' : '完成一个可验收的实现切片',
                scope: '只处理分配的子目标，不扩展父任务范围。',
                deliverables: [index === 0 ? '需求分析结论' : '可验证的实现结果'],
                acceptanceCriteria: ['产出与子目标一致，并明确验证结果。'],
                requiredSpecialties: [],
              })),
            },
          }),
          AGENT_RESULT_ENVELOPE_END,
        ].join('\n')
      : consultTarget
    ? [
        'Mock Agent 需要一条独立建议，咨询后会继续负责本任务。',
        AGENT_RESULT_ENVELOPE_START,
        JSON.stringify({
          summary: 'Mock Agent prepared a bounded consultation request.',
          publicMessage: 'Mock Agent 正在咨询一个独立 Agent，之后会继续完成任务。',
          nextAction: {
            type: 'consult',
            targetAgentId: consultTarget,
            reason: 'The mock scenario exercises controlled Agent consultation.',
          },
          consultation: {
            question: '在不转移任务责任的前提下，应该如何保持这个实现边界？',
            contextSummary: `当前任务是“${claimed.task.title}”，原 Agent 会在收到建议后继续负责。`,
          },
        }),
        AGENT_RESULT_ENVELOPE_END,
      ].join('\n')
    : chainNext
    ? [
        'Mock Agent 已完成本次任务，执行记录已持久化。',
        AGENT_RESULT_ENVELOPE_START,
        JSON.stringify({
          summary: `Mock Agent completed its deterministic step for: ${claimed.task.title}`,
          publicMessage: 'Mock Agent 已完成本次任务，执行记录已持久化。',
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
    : contextReport ?? 'Mock Agent 已完成本次任务，执行记录已持久化。';

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
