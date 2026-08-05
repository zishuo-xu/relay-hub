import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export const DEFAULT_DATABASE_URL = 'postgres://relayhub:relayhub_dev@127.0.0.1:55432/relayhub';

export function createDatabase(url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL) {
  const client = postgres(url, { max: 10 });
  const db = drizzle(client, { schema });
  return {
    db,
    client,
    close: () => client.end(),
  };
}

export type RelayDatabase = ReturnType<typeof createDatabase>['db'];
export * from './schema.js';
