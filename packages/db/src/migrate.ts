import { DEFAULT_MOCK_AGENT_ID, DEFAULT_WORKSPACE_ID } from '@relay-hub/contracts';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './index.js';
import { agentProfiles, workspaces } from './schema.js';

const database = createDatabase();

try {
  await migrate(database.db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
  await database.db
    .insert(workspaces)
    .values({
      id: DEFAULT_WORKSPACE_ID,
      name: 'Local Workspace',
      rootPath: process.cwd(),
      defaultCompletionPolicy: 'require_user_confirmation',
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
