import { describe, expect, it } from 'vitest';
import { mapProviderConnection } from './persistence/mappers.js';

describe('ProviderConnection public mapping', () => {
  it('exposes credential state without returning the stored credential', () => {
    const connection = mapProviderConnection({
      id: '00000000-0000-4000-8000-000000000099',
      workspaceId: '00000000-0000-4000-8000-000000000001',
      name: 'Web provider',
      kind: 'custom_api',
      adapterType: 'opencode_cli',
      protocol: 'openai_chat_completions',
      baseUrl: 'https://api.example.com/v1',
      credentialEnv: null,
      credentialSecret: 'stored-test-secret',
      models: ['model-a'],
      enabled: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    expect(connection.credentialConfigured).toBe(true);
    expect(connection).not.toHaveProperty('credentialSecret');
    expect(JSON.stringify(connection)).not.toContain('stored-test-secret');
  });
});
