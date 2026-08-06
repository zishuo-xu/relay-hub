import type { AgentProfile, BootstrapPolicy, Workspace } from '@relay-hub/contracts';
import { agentProfiles, type RelayDatabase, workspaces } from '@relay-hub/db';
import { asc, eq } from 'drizzle-orm';
import { mapAgentProfile, mapWorkspace } from './mappers.js';

export async function listWorkspaces(db: RelayDatabase): Promise<Workspace[]> {
  const rows = await db.select().from(workspaces).orderBy(asc(workspaces.createdAt));
  return rows.map(mapWorkspace);
}

export async function updateWorkspace(
  db: RelayDatabase,
  workspaceId: string,
  patch: { rootPath?: string; bootstrapPolicy?: BootstrapPolicy },
): Promise<Workspace | null> {
  const [row] = await db
    .update(workspaces)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return row ? mapWorkspace(row) : null;
}

export async function listAgentProfiles(db: RelayDatabase, workspaceId: string): Promise<AgentProfile[]> {
  const rows = await db
    .select()
    .from(agentProfiles)
    .where(eq(agentProfiles.workspaceId, workspaceId))
    .orderBy(asc(agentProfiles.createdAt));
  return rows.map(mapAgentProfile);
}
