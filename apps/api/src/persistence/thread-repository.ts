import { randomUUID } from 'node:crypto';
import {
  type CreateThreadInput,
  type CreateThreadMessageInput,
  DEFAULT_WORKSPACE_ID,
  type RunEvent,
  type ThreadDetail,
  type ThreadSummary,
} from '@relay-hub/contracts';
import {
  agentProfiles,
  idempotencyKeys,
  messageDispatches,
  outboxEvents,
  type RelayDatabase,
  runEvents,
  runs,
  tasks,
  threadMessages,
  threads,
  workspaces,
} from '@relay-hub/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { mapAgentProfile, mapEvent, mapMessageDispatch, mapTask, mapThreadMessage, mapThreadSummary } from './mappers.js';
import type { MutationResult } from './types.js';
import { allocateThreadMessageSequence } from './thread-message-repository.js';

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
  const messageRows = await db
    .select()
    .from(threadMessages)
    .orderBy(asc(threadMessages.threadId), asc(threadMessages.sequence));
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
    .orderBy(asc(threadMessages.sequence));
  const taskRows = await db
    .select({ task: tasks, agentId: runs.agentId })
    .from(tasks)
    .leftJoin(runs, eq(tasks.currentRunId, runs.id))
    .where(eq(tasks.threadId, threadId))
    .orderBy(asc(tasks.createdAt));
  const dispatchRows = messageRows.length > 0
    ? await db
        .select()
        .from(messageDispatches)
        .where(inArray(messageDispatches.messageId, messageRows.map((message) => message.id)))
        .orderBy(asc(messageDispatches.createdAt), asc(messageDispatches.id))
    : [];
  return {
    thread: summarizeThread(thread, messageRows, taskRows),
    messages: messageRows.map(mapThreadMessage),
    dispatches: dispatchRows.map(mapMessageDispatch),
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
  const messageId = randomUUID();
  const emitted = await db.transaction(async (tx) => {
    if (idempotencyKey) {
      const reserved = await tx
        .insert(idempotencyKeys)
        .values({ scope: `thread.message.create:${threadId}`, key: idempotencyKey, resourceType: 'thread_message', resourceId: messageId })
        .onConflictDoNothing()
        .returning({ resourceId: idempotencyKeys.resourceId });
      if (reserved.length === 0) return [];
    }

    const [thread] = await tx
      .select()
      .from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.workspaceId, DEFAULT_WORKSPACE_ID)))
      .limit(1);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const [workspace] = await tx
      .select({ rootPath: workspaces.rootPath, bootstrapPolicy: workspaces.bootstrapPolicy })
      .from(workspaces)
      .where(eq(workspaces.id, DEFAULT_WORKSPACE_ID))
      .limit(1);
    if (!workspace?.rootPath) throw new Error('Default workspace root is not configured');
    const targetAgents = await tx
      .select()
      .from(agentProfiles)
      .where(and(
        eq(agentProfiles.workspaceId, DEFAULT_WORKSPACE_ID),
        inArray(agentProfiles.id, input.agentIds),
      ));
    const agentById = new Map(targetAgents.map((agent) => [agent.id, agent]));
    for (const agentId of input.agentIds) {
      const agent = agentById.get(agentId);
      if (!agent?.enabled || !agent.capabilities.includes('implement')) {
        throw new Error(`Builder is missing, disabled, or lacks implement capability: ${agentId}`);
      }
    }
    if (input.reviewerAgentId) {
      const [reviewer] = await tx
        .select({ enabled: agentProfiles.enabled, capabilities: agentProfiles.capabilities })
        .from(agentProfiles)
        .where(and(
          eq(agentProfiles.id, input.reviewerAgentId),
          eq(agentProfiles.workspaceId, DEFAULT_WORKSPACE_ID),
        ))
        .limit(1);
      if (!reviewer?.enabled || !reviewer.capabilities.includes('review')) {
        throw new Error(`Reviewer is missing, disabled, or lacks review capability: ${input.reviewerAgentId}`);
      }
      if (input.agentIds.includes(input.reviewerAgentId)) {
        throw new Error('A dispatch target cannot also be its own Reviewer');
      }
    }

    const now = new Date();
    const boundary = await allocateThreadMessageSequence(tx, threadId, DEFAULT_WORKSPACE_ID, now);
    await tx.insert(threadMessages).values({
      id: messageId,
      threadId,
      sequence: boundary,
      senderType: 'user',
      senderName: '你',
      content: input.content,
      createdAt: now,
    });
    const events: RunEvent[] = [];
    for (const agentId of input.agentIds) {
      const taskId = randomUUID();
      const runId = randomUUID();
      const agent = agentById.get(agentId)!;
      await tx.insert(tasks).values({
        id: taskId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        threadId,
        conversationContextBeforeSequence: boundary,
        conversationContextPolicyVersion: 1,
        title,
        description: input.content,
        acceptanceCriteria: [],
        completionPolicy: input.completionPolicy,
        maxReviewRounds: input.maxReviewRounds,
        builderAgentId: agentId,
        reviewerAgentId: input.reviewerAgentId,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(runs).values({
        id: runId,
        taskId,
        agentId,
        status: 'queued',
        triggerType: 'user',
        workspaceRoot: workspace.rootPath,
        bootstrapPolicySnapshot: workspace.bootstrapPolicy,
        agentProfileSnapshot: mapAgentProfile(agent),
        createdAt: now,
      });
      await tx.update(tasks).set({ currentRunId: runId }).where(eq(tasks.id, taskId));
      await tx.insert(messageDispatches).values({ messageId, taskId, agentId, createdAt: now });
      const [eventRow] = await tx.insert(runEvents).values({
        taskId,
        runId,
        eventType: 'task.created',
        payload: {
          title,
          agentId,
          messageId,
          dispatchTargetCount: input.agentIds.length,
          maxReviewRounds: input.maxReviewRounds,
          ...(input.reviewerAgentId ? { reviewerAgentId: input.reviewerAgentId } : {}),
        },
        source: 'user',
        occurredAt: now,
        dedupeKey: `task-created:${taskId}`,
      }).returning();
      if (!eventRow) throw new Error('Task event insert did not return a row');
      events.push(mapEvent(eventRow));
      await tx.insert(outboxEvents).values({
        aggregateType: 'run',
        aggregateId: runId,
        eventType: 'run.queued',
        payload: { runId },
      });
    }
    if (thread.title === '新协作线程') await tx.update(threads).set({ title }).where(eq(threads.id, threadId));
    return events;
  });
  const detail = await getThreadDetail(db, threadId);
  if (!detail) throw new Error(`Thread not found after message creation: ${threadId}`);
  return { value: detail, emitted };
}
