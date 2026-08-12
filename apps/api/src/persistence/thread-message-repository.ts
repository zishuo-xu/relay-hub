import { DEFAULT_WORKSPACE_ID } from '@relay-hub/contracts';
import { type RelayDatabase, threads } from '@relay-hub/db';
import { and, eq, sql } from 'drizzle-orm';

type ThreadSequenceExecutor = Pick<RelayDatabase, 'update'>;

export async function allocateThreadMessageSequence(
  executor: ThreadSequenceExecutor,
  threadId: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
  now = new Date(),
): Promise<number> {
  const [updated] = await executor
    .update(threads)
    .set({
      messageSequenceHighWater: sql`${threads.messageSequenceHighWater} + 1`,
      updatedAt: now,
    })
    .where(and(eq(threads.id, threadId), eq(threads.workspaceId, workspaceId)))
    .returning({ sequence: threads.messageSequenceHighWater });
  if (!updated) throw new Error(`Thread not found: ${threadId}`);
  return updated.sequence;
}
