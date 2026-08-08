import type { AgentProfile, AgentProfileInput, BootstrapPolicy, Workspace } from '@relay-hub/contracts';
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

function profileValues(input: AgentProfileInput) {
  const provider = input.adapterType === 'opencode_cli' ? input.model?.split('/')[0] : undefined;
  return {
    name: input.name,
    adapterType: input.adapterType,
    provider: provider ?? (input.adapterType === 'codex_cli' ? 'openai' : 'local'),
    modelLabel: input.model ?? (input.adapterType === 'codex_cli' ? 'Codex CLI default' : 'deterministic-mock'),
    modelFamily: provider ?? (input.adapterType === 'codex_cli' ? 'codex' : 'mock'),
    capabilities: input.capabilities,
    config: {
      ...(input.model ? { model: input.model } : {}),
      ...(input.variant ? { variant: input.variant } : {}),
      ...(input.agentName ? { agentName: input.agentName } : {}),
      ...(input.credentialEnv ? { credentialEnv: input.credentialEnv } : {}),
    },
    enabled: input.enabled,
  };
}

export async function createAgentProfile(
  db: RelayDatabase,
  workspaceId: string,
  input: AgentProfileInput,
): Promise<AgentProfile | null> {
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return null;
  const [row] = await db
    .insert(agentProfiles)
    .values({ workspaceId, ...profileValues(input) })
    .returning();
  return row ? mapAgentProfile(row) : null;
}

export async function updateAgentProfile(
  db: RelayDatabase,
  agentId: string,
  input: AgentProfileInput,
): Promise<AgentProfile | null> {
  const [row] = await db
    .update(agentProfiles)
    .set({ ...profileValues(input), updatedAt: new Date() })
    .where(eq(agentProfiles.id, agentId))
    .returning();
  return row ? mapAgentProfile(row) : null;
}

export async function getAgentProfile(db: RelayDatabase, agentId: string): Promise<AgentProfile | null> {
  const [row] = await db.select().from(agentProfiles).where(eq(agentProfiles.id, agentId)).limit(1);
  return row ? mapAgentProfile(row) : null;
}
