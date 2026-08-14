import type {
  AgentProfile,
  AgentProfileInput,
  BootstrapPolicy,
  ProviderConnection,
  ProviderConnectionInput,
  ProviderConnectionSnapshot,
  Workspace,
} from '@relay-hub/contracts';
import { defaultExecutionPolicy } from '@relay-hub/contracts';
import { agentProfiles, providerConnections, type RelayDatabase, workspaces } from '@relay-hub/db';
import { and, asc, eq } from 'drizzle-orm';
import { mapAgentProfile, mapProviderConnection, mapWorkspace } from './mappers.js';

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

export async function listProviderConnections(db: RelayDatabase, workspaceId: string): Promise<ProviderConnection[]> {
  const rows = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.workspaceId, workspaceId))
    .orderBy(asc(providerConnections.createdAt));
  return rows.map(mapProviderConnection);
}

export async function getProviderConnection(db: RelayDatabase, connectionId: string): Promise<ProviderConnection | null> {
  const [row] = await db.select().from(providerConnections).where(eq(providerConnections.id, connectionId)).limit(1);
  return row ? mapProviderConnection(row) : null;
}

export async function createProviderConnection(
  db: RelayDatabase,
  workspaceId: string,
  input: ProviderConnectionInput,
): Promise<ProviderConnection | null> {
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return null;
  const [row] = await db.insert(providerConnections).values({ workspaceId, ...input }).returning();
  return row ? mapProviderConnection(row) : null;
}

export async function updateProviderConnection(
  db: RelayDatabase,
  connectionId: string,
  input: ProviderConnectionInput,
): Promise<ProviderConnection | null> {
  const [row] = await db
    .update(providerConnections)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(providerConnections.id, connectionId))
    .returning();
  return row ? mapProviderConnection(row) : null;
}

export async function getProviderCredential(db: RelayDatabase, connectionId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ credentialSecret: providerConnections.credentialSecret })
    .from(providerConnections)
    .where(eq(providerConnections.id, connectionId))
    .limit(1);
  return row?.credentialSecret ?? undefined;
}

function connectionSnapshot(connection: ProviderConnection): ProviderConnectionSnapshot {
  return {
    id: connection.id,
    name: connection.name,
    kind: connection.kind,
    adapterType: connection.adapterType,
    protocol: connection.protocol,
    models: connection.models,
    ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
    ...(connection.credentialEnv ? { credentialEnv: connection.credentialEnv } : {}),
  };
}

async function resolveConnection(
  db: RelayDatabase,
  workspaceId: string,
  input: AgentProfileInput,
): Promise<ProviderConnection | undefined> {
  if (!input.providerConnectionId) return undefined;
  const [row] = await db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.id, input.providerConnectionId), eq(providerConnections.workspaceId, workspaceId)))
    .limit(1);
  const connection = row ? mapProviderConnection(row) : undefined;
  if (!connection?.enabled) throw new Error('Provider connection is missing or disabled');
  if (connection.adapterType !== input.adapterType) throw new Error('Provider connection does not support this Agent CLI');
  if (input.adapterType === 'opencode_cli' && input.model) {
    if (connection.kind === 'custom_api' && !connection.models.includes(input.model)) {
      throw new Error('Selected model is not configured on this provider connection');
    }
    if (connection.kind === 'official_cli' && !input.model.includes('/')) {
      throw new Error('Official OpenCode models must use provider/model format');
    }
  }
  return connection;
}

function profileValues(input: AgentProfileInput, connection?: ProviderConnection) {
  const provider = connection?.kind === 'custom_api'
    ? `relayhub-${connection.id.replaceAll('-', '')}`
    : input.adapterType === 'opencode_cli' ? input.model?.split('/')[0] : undefined;
  const defaultModelLabel = input.adapterType === 'codex_cli'
    ? 'Codex CLI default'
    : input.adapterType === 'claude_code'
      ? 'Claude Code default'
      : 'deterministic-mock';
  const defaultModelFamily = input.adapterType === 'codex_cli'
    ? 'codex'
    : input.adapterType === 'claude_code'
      ? 'claude'
      : 'mock';
  return {
    name: input.name,
    adapterType: input.adapterType,
    providerConnectionId: connection?.id ?? null,
    provider: provider ?? (input.adapterType === 'codex_cli' ? 'openai' : input.adapterType === 'claude_code' ? 'anthropic' : 'local'),
    modelLabel: input.model ?? defaultModelLabel,
    modelFamily: provider ?? defaultModelFamily,
    capabilities: input.capabilities,
    specialties: input.specialties ?? [],
    config: {
      ...(input.model ? { model: input.model } : {}),
      ...(input.variant ? { variant: input.variant } : {}),
      ...(input.agentName ? { agentName: input.agentName } : {}),
      instructions: input.instructions ?? '',
      executionPolicy: input.executionPolicy ?? defaultExecutionPolicy(input.adapterType, input.capabilities),
      ...(connection ? { providerConnection: connectionSnapshot(connection) } : {}),
    },
    enabled: input.enabled ?? true,
  };
}

export async function createAgentProfile(
  db: RelayDatabase,
  workspaceId: string,
  input: AgentProfileInput,
): Promise<AgentProfile | null> {
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return null;
  const connection = await resolveConnection(db, workspaceId, input);
  const [row] = await db
    .insert(agentProfiles)
    .values({ workspaceId, ...profileValues(input, connection) })
    .returning();
  return row ? mapAgentProfile(row) : null;
}

export async function updateAgentProfile(
  db: RelayDatabase,
  agentId: string,
  input: AgentProfileInput,
): Promise<AgentProfile | null> {
  const [existing] = await db.select({ workspaceId: agentProfiles.workspaceId }).from(agentProfiles).where(eq(agentProfiles.id, agentId)).limit(1);
  if (!existing) return null;
  const connection = await resolveConnection(db, existing.workspaceId, input);
  const [row] = await db
    .update(agentProfiles)
    .set({ ...profileValues(input, connection), updatedAt: new Date() })
    .where(eq(agentProfiles.id, agentId))
    .returning();
  return row ? mapAgentProfile(row) : null;
}

export async function getAgentProfile(db: RelayDatabase, agentId: string): Promise<AgentProfile | null> {
  const [row] = await db.select().from(agentProfiles).where(eq(agentProfiles.id, agentId)).limit(1);
  return row ? mapAgentProfile(row) : null;
}
