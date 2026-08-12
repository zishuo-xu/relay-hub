import {
  CONVERSATION_CONTEXT_POLICY_V1,
  type ConversationContextMessage,
  type ConversationContextView,
} from '@relay-hub/contracts';
import { type RelayDatabase, runs, tasks, threadMessages, threads } from '@relay-hub/db';
import { and, count, desc, eq, inArray, lt } from 'drizzle-orm';
import { selectConversationContextV1 } from '../conversation-context.js';

type QueryExecutor = Pick<RelayDatabase, 'select'>;
type ContextTaskRow = Pick<
  typeof tasks.$inferSelect,
  'id' | 'workspaceId' | 'threadId' | 'conversationContextBeforeSequence' | 'conversationContextPolicyVersion'
>;

export async function buildConversationContextForTask(
  executor: QueryExecutor,
  task: ContextTaskRow,
): Promise<ConversationContextView | undefined> {
  if (!task.threadId && task.conversationContextBeforeSequence === null && task.conversationContextPolicyVersion === null) {
    return undefined;
  }
  if (!task.threadId || task.conversationContextBeforeSequence === null || task.conversationContextPolicyVersion === null) {
    throw new Error(`Task has incomplete conversation context metadata: ${task.id}`);
  }
  if (task.conversationContextPolicyVersion !== CONVERSATION_CONTEXT_POLICY_V1.version) {
    throw new Error(`Unsupported conversation context policy: ${task.conversationContextPolicyVersion}`);
  }
  const [thread] = await executor
    .select({ id: threads.id, highWater: threads.messageSequenceHighWater })
    .from(threads)
    .where(and(eq(threads.id, task.threadId), eq(threads.workspaceId, task.workspaceId)))
    .limit(1);
  if (!thread || task.conversationContextBeforeSequence > thread.highWater) {
    throw new Error(`Conversation context boundary is outside its Thread: ${task.id}`);
  }

  const visibility = and(
    eq(threadMessages.threadId, task.threadId),
    lt(threadMessages.sequence, task.conversationContextBeforeSequence),
    inArray(threadMessages.senderType, ['user', 'agent']),
  );
  const [aggregate] = await executor.select({ value: count() }).from(threadMessages).where(visibility);
  const rows = await executor
    .select()
    .from(threadMessages)
    .where(visibility)
    .orderBy(desc(threadMessages.sequence))
    .limit(CONVERSATION_CONTEXT_POLICY_V1.maxMessages);
  const messages: ConversationContextMessage[] = rows.map((row) => ({
    id: row.id,
    sequence: row.sequence,
    senderType: row.senderType as 'user' | 'agent',
    senderName: row.senderName,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    ...(row.senderAgentId ? { senderAgentId: row.senderAgentId } : {}),
    ...(row.recipientAgentId ? { recipientAgentId: row.recipientAgentId } : {}),
  }));
  return selectConversationContextV1({
    threadId: task.threadId,
    beforeSequence: task.conversationContextBeforeSequence,
    messages,
    totalEligibleMessageCount: aggregate?.value ?? 0,
  });
}

export async function getRunConversationContext(
  db: RelayDatabase,
  runId: string,
): Promise<{ found: boolean; context?: ConversationContextView }> {
  const [row] = await db
    .select({ task: tasks })
    .from(runs)
    .innerJoin(tasks, eq(runs.taskId, tasks.id))
    .where(eq(runs.id, runId))
    .limit(1);
  if (!row) return { found: false };
  const context = await buildConversationContextForTask(db, row.task);
  return { found: true, ...(context ? { context } : {}) };
}
