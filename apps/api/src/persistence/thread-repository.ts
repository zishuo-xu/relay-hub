import { randomUUID } from 'node:crypto';
import {
  type CreateThreadInput,
  type CreateThreadMessageInput,
  DEFAULT_WORKSPACE_ID,
  type ThreadDetail,
  type ThreadSummary,
} from '@relay-hub/contracts';
import {
  type RelayDatabase,
  runs,
  tasks,
  threadMessages,
  threads,
} from '@relay-hub/db';
import { asc, desc, eq } from 'drizzle-orm';
import { mapTask, mapThreadMessage, mapThreadSummary } from './mappers.js';
import { createTask } from './task-repository.js';
import type { MutationResult } from './types.js';

const terminalTaskStatuses = new Set(['completed', 'failed', 'cancelled']);

function summarizeThread(
  thread: typeof threads.$inferSelect,
  messages: (typeof threadMessages.$inferSelect)[],
  taskRows: { task: typeof tasks.$inferSelect; agentId: string | null }[],
): ThreadSummary {
  const ownMessages = messages.filter((message) => message.threadId === thread.id);
  const ownTasks = taskRows.filter(({ task }) => task.threadId === thread.id);
  const lastMessage = ownMessages.at(-1)?.content;
  return mapThreadSummary(thread, {
    messageCount: ownMessages.length,
    activeTaskCount: ownTasks.filter(({ task }) => !terminalTaskStatuses.has(task.status)).length,
    ...(lastMessage ? { lastMessage } : {}),
  });
}

export async function listThreads(db: RelayDatabase): Promise<ThreadSummary[]> {
  const threadRows = await db
    .select()
    .from(threads)
    .where(eq(threads.workspaceId, DEFAULT_WORKSPACE_ID))
    .orderBy(desc(threads.updatedAt));
  const messageRows = await db.select().from(threadMessages).orderBy(asc(threadMessages.createdAt));
  const taskRows = await db
    .select({ task: tasks, agentId: runs.agentId })
    .from(tasks)
    .leftJoin(runs, eq(tasks.currentRunId, runs.id));
  return threadRows.map((thread) => summarizeThread(thread, messageRows, taskRows));
}

export async function getThreadDetail(db: RelayDatabase, threadId: string): Promise<ThreadDetail | null> {
  const [thread] = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1);
  if (!thread) return null;
  const messageRows = await db
    .select()
    .from(threadMessages)
    .where(eq(threadMessages.threadId, threadId))
    .orderBy(asc(threadMessages.createdAt));
  const taskRows = await db
    .select({ task: tasks, agentId: runs.agentId })
    .from(tasks)
    .leftJoin(runs, eq(tasks.currentRunId, runs.id))
    .where(eq(tasks.threadId, threadId))
    .orderBy(asc(tasks.createdAt));
  return {
    thread: summarizeThread(thread, messageRows, taskRows),
    messages: messageRows.map(mapThreadMessage),
    tasks: taskRows.map(({ task, agentId }) => mapTask(task, agentId ?? '')),
  };
}

export async function createThread(
  db: RelayDatabase,
  input: CreateThreadInput,
): Promise<ThreadDetail> {
  const now = new Date();
  const threadId = randomUUID();
  await db.insert(threads).values({
    id: threadId,
    workspaceId: DEFAULT_WORKSPACE_ID,
    title: input.title,
    createdAt: now,
    updatedAt: now,
  });
  const detail = await getThreadDetail(db, threadId);
  if (!detail) throw new Error(`Created Thread not found: ${threadId}`);
  return detail;
}

export async function createThreadMessage(
  db: RelayDatabase,
  threadId: string,
  input: CreateThreadMessageInput,
  idempotencyKey?: string,
): Promise<MutationResult<ThreadDetail>> {
  const normalized = input.content.replace(/\s+/g, ' ').trim();
  const title = normalized.slice(0, 72);
  const taskResult = await createTask(
    db,
    {
      title,
      description: input.content,
      agentId: input.agentId,
      ...(input.reviewerAgentId ? { reviewerAgentId: input.reviewerAgentId } : {}),
      acceptanceCriteria: [],
      completionPolicy: input.completionPolicy,
      maxReviewRounds: input.maxReviewRounds,
    },
    idempotencyKey,
    { threadId, messageId: randomUUID(), content: input.content },
  );
  const detail = await getThreadDetail(db, threadId);
  if (!detail) throw new Error(`Thread not found after message creation: ${threadId}`);
  return { value: detail, emitted: taskResult.emitted };
}
