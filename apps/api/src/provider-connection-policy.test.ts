import type { AgentProfile, ProviderConnection, ProviderConnectionInput } from '@relay-hub/contracts';
import { describe, expect, it } from 'vitest';
import { validateProviderConnectionUpdate } from './provider-connection-policy.js';

const connection: ProviderConnection = {
  id: '00000000-0000-4000-8000-000000000099',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  name: 'Team models',
  kind: 'custom_api',
  adapterType: 'opencode_cli',
  protocol: 'openai_chat_completions',
  baseUrl: 'https://api.example.com/v1',
  models: ['model-a', 'model-b'],
  enabled: true,
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
};

const agent: AgentProfile = {
  id: '00000000-0000-4000-8000-000000000098',
  workspaceId: connection.workspaceId,
  name: 'Builder',
  adapterType: 'opencode_cli',
  providerConnectionId: connection.id,
  capabilities: ['implement'],
  config: { model: 'model-a' },
  enabled: true,
};

const input: ProviderConnectionInput = {
  name: connection.name,
  kind: connection.kind,
  adapterType: connection.adapterType,
  protocol: connection.protocol,
  baseUrl: connection.baseUrl,
  models: connection.models,
  enabled: true,
};

describe('ProviderConnection update policy', () => {
  it('blocks disabling a connection used by an active Agent', () => {
    expect(validateProviderConnectionUpdate(connection, { ...input, enabled: false }, [agent])).toMatchObject({
      statusCode: 409,
      error: 'provider_connection_in_use',
    });
  });

  it('blocks removal of a model used by an active Agent', () => {
    expect(validateProviderConnectionUpdate(connection, { ...input, models: ['model-b'] }, [agent])).toMatchObject({
      statusCode: 409,
      error: 'provider_models_in_use',
    });
  });

  it('allows safe metadata and catalog updates', () => {
    expect(validateProviderConnectionUpdate(connection, { ...input, name: 'Renamed', models: ['model-a', 'model-c'] }, [agent])).toBeNull();
  });
});
