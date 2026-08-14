import { DEFAULT_CODEX_AGENT_ID, DEFAULT_MOCK_AGENT_ID } from '@relay-hub/contracts';
import { createDatabase } from '@relay-hub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresStore } from './store.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;
let database: ReturnType<typeof createDatabase> | undefined;
let store: PostgresStore;

suite('conversation thread integration', () => {
  beforeAll(() => {
    database = createDatabase(testDatabaseUrl);
    store = new PostgresStore(database.db);
  });

  afterAll(async () => {
    await database?.close();
  });

  it('persists a user message with its Task and returns the Agent result to the same Thread', async () => {
    const thread = await store.createThread({ title: '新协作线程' });
    const idempotencyKey = crypto.randomUUID();
    const first = await store.createThreadMessage(thread.thread.id, {
      content: '请用一句话说明这个协作线程的价值。',
      agentIds: [DEFAULT_MOCK_AGENT_ID],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    }, idempotencyKey);
    const duplicate = await store.createThreadMessage(thread.thread.id, {
      content: '请用一句话说明这个协作线程的价值。',
      agentIds: [DEFAULT_MOCK_AGENT_ID],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    }, idempotencyKey);

    expect(first.value.thread.title).toBe('请用一句话说明这个协作线程的价值。');
    expect(duplicate.value.messages).toHaveLength(1);
    expect(duplicate.value.tasks).toHaveLength(1);
    expect(duplicate.value.dispatches).toHaveLength(1);
    const task = duplicate.value.tasks[0];
    expect(task).toMatchObject({ threadId: thread.thread.id, agentId: DEFAULT_MOCK_AGENT_ID, status: 'queued' });
    expect(duplicate.value.dispatches[0]).toMatchObject({
      messageId: duplicate.value.messages[0]?.id,
      taskId: task?.id,
      agentId: DEFAULT_MOCK_AGENT_ID,
    });
    if (!task) throw new Error('Thread message did not create a Task');

    const claimed = await store.claimRun(task.currentRunId, 'thread-test-worker');
    expect(claimed.value?.claimed.task.threadId).toBe(thread.thread.id);
    expect(claimed.value?.claimed.conversationContext).toMatchObject({
      beforeSequence: 1,
      messages: [],
      omittedMessageCount: 0,
    });
    await store.recordAgentEvent(task.currentRunId, 'thread-started', { type: 'run.started' });
    await store.recordAgentEvent(task.currentRunId, 'thread-completed', {
      type: 'run.completed',
      outcome: {
        summary: '已完成线程价值说明。',
        publicMessage: '线程把多 Agent 协作内容保存在一个连续上下文中。',
        commandEvidence: [],
        nextAction: { type: 'wait_for_user', reason: '已回答用户问题。' },
      },
    });

    const completed = await store.getThreadDetail(thread.thread.id);
    expect(completed?.messages).toHaveLength(2);
    expect(completed?.messages.map((message) => message.sequence)).toEqual([1, 2]);
    expect(completed?.messages[1]).toMatchObject({
      senderType: 'agent',
      senderAgentId: DEFAULT_MOCK_AGENT_ID,
      taskId: task.id,
      runId: task.currentRunId,
      content: '线程把多 Agent 协作内容保存在一个连续上下文中。',
    });
    expect(completed?.tasks[0]?.status).toBe('waiting_for_user');
    expect((await store.listThreads())[0]).toMatchObject({
      id: thread.thread.id,
      messageCount: 2,
      activeTaskCount: 1,
    });
  });

  it('freezes prior public Thread messages for a later Agent without leaking newer messages', async () => {
    const thread = await store.createThread({ title: '上下文边界测试' });
    const first = await store.createThreadMessage(thread.thread.id, {
      content: '请先提出一个公开方案。',
      agentIds: [DEFAULT_MOCK_AGENT_ID],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    }, crypto.randomUUID());
    const firstTask = first.value.tasks[0];
    if (!firstTask) throw new Error('First Thread Task was not created');
    await store.claimRun(firstTask.currentRunId, 'context-first-worker');
    await store.recordAgentEvent(firstTask.currentRunId, 'context-first-started', { type: 'run.started' });
    await store.recordAgentEvent(firstTask.currentRunId, 'context-first-completed', {
      type: 'run.completed',
      outcome: {
        summary: 'Agent A 的公开结论：保持 Thread、Task 与 Run 分离。',
        commandEvidence: [],
        nextAction: { type: 'wait_for_user', reason: '等待下一位 Agent。' },
      },
    });

    const second = await store.createThreadMessage(thread.thread.id, {
      content: '请基于前面的公开结论继续分析。',
      agentIds: [DEFAULT_MOCK_AGENT_ID],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    }, crypto.randomUUID());
    const secondTask = second.value.tasks.at(-1);
    if (!secondTask) throw new Error('Second Thread Task was not created');
    await store.createThreadMessage(thread.thread.id, {
      content: '这是一条在第二个 Task 边界之后才到达的消息。',
      agentIds: [DEFAULT_MOCK_AGENT_ID],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    }, crypto.randomUUID());

    const claimed = await store.claimRun(secondTask.currentRunId, 'context-second-worker');
    expect(claimed.value?.claimed.task).toMatchObject({
      conversationContextBeforeSequence: 3,
      conversationContextPolicyVersion: 1,
    });
    expect(claimed.value?.claimed.conversationContext?.messages.map((message) => ({
      sequence: message.sequence,
      senderType: message.senderType,
      content: message.content,
    }))).toEqual([
      { sequence: 1, senderType: 'user', content: '请先提出一个公开方案。' },
      { sequence: 2, senderType: 'agent', content: 'Agent A 的公开结论：保持 Thread、Task 与 Run 分离。' },
    ]);
    expect(claimed.value?.claimed.conversationContext?.digest).toMatch(/^[0-9a-f]{64}$/);
    expect((await store.getRunConversationContext(secondTask.currentRunId)).context)
      .toEqual(claimed.value?.claimed.conversationContext);
  });

  it('fans one public message out to independent Tasks with one shared context boundary', async () => {
    const thread = await store.createThread({ title: '并行派发测试' });
    const result = await store.createThreadMessage(thread.thread.id, {
      content: '请分别给出架构与实现建议。',
      agentIds: [DEFAULT_MOCK_AGENT_ID, DEFAULT_CODEX_AGENT_ID],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    }, crypto.randomUUID());

    expect(result.value.messages).toHaveLength(1);
    expect(result.value.tasks).toHaveLength(2);
    expect(result.value.dispatches).toHaveLength(2);
    const boundaries = new Set(result.value.tasks.map((task) => task.conversationContextBeforeSequence));
    expect([...boundaries]).toEqual([1]);
    expect(new Set(result.value.dispatches.map((dispatch) => dispatch.messageId))).toEqual(
      new Set([result.value.messages[0]?.id]),
    );
    expect(new Set(result.value.dispatches.map((dispatch) => dispatch.agentId))).toEqual(
      new Set([DEFAULT_MOCK_AGENT_ID, DEFAULT_CODEX_AGENT_ID]),
    );
    expect(result.emitted).toHaveLength(2);
  });

  it('creates one Lead Task and preserves selected collaborators for coordinated mode', async () => {
    const thread = await store.createThread({ title: '主导协作测试' });
    const result = await store.createThreadMessage(thread.thread.id, {
      content: '请先分工，再综合架构与风险观点。',
      mode: 'coordinated',
      agentIds: [DEFAULT_MOCK_AGENT_ID, DEFAULT_CODEX_AGENT_ID],
      leadAgentId: DEFAULT_MOCK_AGENT_ID,
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    }, crypto.randomUUID());

    expect(result.value.messages).toHaveLength(1);
    expect(result.value.tasks).toHaveLength(1);
    expect(result.value.dispatches).toHaveLength(1);
    expect(result.emitted).toHaveLength(1);
    const task = result.value.tasks[0];
    expect(task).toMatchObject({
      agentId: DEFAULT_MOCK_AGENT_ID,
      collaborationMode: 'lead',
      collaboratorAgentIds: [DEFAULT_CODEX_AGENT_ID],
    });
    expect(result.value.dispatches[0]).toMatchObject({ agentId: DEFAULT_MOCK_AGENT_ID, taskId: task?.id });
    if (!task) throw new Error('Coordinated message did not create its Lead Task');
    const claim = await store.claimRun(task.currentRunId, 'lead-thread-worker');
    expect(claim.value?.claimed.handoffTargets?.map((agent) => agent.id)).toEqual([DEFAULT_CODEX_AGENT_ID]);
  });

  it('rejects the whole fan-out before writing when any target is unavailable', async () => {
    const thread = await store.createThread({ title: '原子派发测试' });
    await expect(store.createThreadMessage(thread.thread.id, {
      content: '这条消息不能被部分派发。',
      agentIds: [DEFAULT_MOCK_AGENT_ID, crypto.randomUUID()],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    }, crypto.randomUUID())).rejects.toThrow('Builder is missing');

    const unchanged = await store.getThreadDetail(thread.thread.id);
    expect(unchanged).toMatchObject({ messages: [], dispatches: [], tasks: [] });
  });
});
