import type { AgentEvent, ClaimedRun } from '@relay-hub/contracts';

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function* runMockAgent(claimed: ClaimedRun): AsyncGenerator<AgentEvent> {
  yield { type: 'run.started', sessionRef: `mock-${claimed.run.id}` };

  const messages = [
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
  yield { type: 'output.delta', text: 'Mock Agent 已完成本次任务，执行记录已持久化。' };
  yield { type: 'run.completed', summary: 'Mock execution completed successfully.' };
}

