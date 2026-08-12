import { DEFAULT_MOCK_AGENT_ID } from '@relay-hub/contracts';
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
      agentId: DEFAULT_MOCK_AGENT_ID,
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    }, idempotencyKey);
    const duplicate = await store.createThreadMessage(thread.thread.id, {
      content: '请用一句话说明这个协作线程的价值。',
      agentId: DEFAULT_MOCK_AGENT_ID,
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    }, idempotencyKey);

    expect(first.value.thread.title).toBe('请用一句话说明这个协作线程的价值。');
    expect(duplicate.value.messages).toHaveLength(1);
    expect(duplicate.value.tasks).toHaveLength(1);
    const task = duplicate.value.tasks[0];
    expect(task).toMatchObject({ threadId: thread.thread.id, agentId: DEFAULT_MOCK_AGENT_ID, status: 'queued' });
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
      agentId: DEFAULT_MOCK_AGENT_ID,
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
      agentId: DEFAULT_MOCK_AGENT_ID,
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    }, crypto.randomUUID());
    const secondTask = second.value.tasks.at(-1);
    if (!secondTask) throw new Error('Second Thread Task was not created');
    await store.createThreadMessage(thread.thread.id, {
      content: '这是一条在第二个 Task 边界之后才到达的消息。',
      agentId: DEFAULT_MOCK_AGENT_ID,
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
});
