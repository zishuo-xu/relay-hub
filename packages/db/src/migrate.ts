import {
  DEFAULT_CLAUDE_CODE_CONNECTION_ID,
  DEFAULT_CODEX_AGENT_ID,
  DEFAULT_CODEX_CONNECTION_ID,
  DEFAULT_MOCK_AGENT_ID,
  DEFAULT_MOCK_REVIEWER_AGENT_ID,
  DEFAULT_OPENCODE_CONNECTION_ID,
  DEFAULT_WORKSPACE_ID,
} from '@relay-hub/contracts';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './index.js';
import { and, eq, isNull } from 'drizzle-orm';
import { agentProfiles, providerConnections, workspaces } from './schema.js';

const database = createDatabase();
const relayHubRoot = fileURLToPath(new URL('../../../', import.meta.url));

try {
  await migrate(database.db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
  await database.db
    .insert(workspaces)
    .values({
      id: DEFAULT_WORKSPACE_ID,
      name: 'Local Workspace',
      rootPath: relayHubRoot,
      defaultCompletionPolicy: 'require_user_confirmation',
    })
    .onConflictDoNothing();
  await database.db
    .insert(providerConnections)
    .values({
      id: DEFAULT_CODEX_CONNECTION_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: 'Codex 官方认证',
      kind: 'official_cli',
      adapterType: 'codex_cli',
      protocol: 'cli_managed',
      models: [],
    })
    .onConflictDoNothing();
  await database.db
    .insert(providerConnections)
    .values({
      id: DEFAULT_CLAUDE_CODE_CONNECTION_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: 'Claude Code 官方认证',
      kind: 'official_cli',
      adapterType: 'claude_code',
      protocol: 'cli_managed',
      models: [],
    })
    .onConflictDoNothing();
  await database.db
    .insert(providerConnections)
    .values({
      id: DEFAULT_OPENCODE_CONNECTION_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: 'OpenCode 本机认证',
      kind: 'official_cli',
      adapterType: 'opencode_cli',
      protocol: 'cli_managed',
      models: [],
    })
    .onConflictDoNothing();
  await database.db
    .insert(agentProfiles)
    .values({
      id: DEFAULT_CODEX_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      providerConnectionId: DEFAULT_CODEX_CONNECTION_ID,
      name: 'Codex Builder',
      adapterType: 'codex_cli',
      provider: 'openai',
      modelLabel: 'Codex CLI default',
      modelFamily: 'codex',
      capabilities: ['implement'],
      config: { sandbox: 'workspace-write' },
    })
    .onConflictDoNothing();
  await database.db
    .update(agentProfiles)
    .set({ providerConnectionId: DEFAULT_CODEX_CONNECTION_ID })
    .where(and(eq(agentProfiles.adapterType, 'codex_cli'), isNull(agentProfiles.providerConnectionId)));
  await database.db
    .update(agentProfiles)
    .set({ providerConnectionId: DEFAULT_OPENCODE_CONNECTION_ID })
    .where(and(eq(agentProfiles.adapterType, 'opencode_cli'), isNull(agentProfiles.providerConnectionId)));
  await database.db
    .insert(agentProfiles)
    .values({
      id: DEFAULT_MOCK_REVIEWER_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: 'Mock Reviewer',
      adapterType: 'mock',
      provider: 'local',
      modelLabel: 'deterministic-mock-reviewer',
      modelFamily: 'mock',
      capabilities: ['review'],
    })
    .onConflictDoNothing();
  await database.db
    .insert(agentProfiles)
    .values({
      id: DEFAULT_MOCK_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: 'Mock Builder',
      adapterType: 'mock',
      provider: 'local',
      modelLabel: 'deterministic-mock',
      modelFamily: 'mock',
      capabilities: ['implement'],
    })
    .onConflictDoNothing();
  console.log('RelayHub database migrations and baseline seed completed.');
} finally {
  await database.close();
}
