import type { ProviderConnectionSnapshot } from '@relay-hub/contracts';
import { describe, expect, it } from 'vitest';
import { checkProviderConnectionHealth } from './agent-runtime-health.js';

describe('ProviderConnection health checks', () => {
  it('reports a missing Worker credential without sending a model request', async () => {
    const connection: ProviderConnectionSnapshot = {
      id: '00000000-0000-4000-8000-000000000097',
      name: 'Missing credential',
      kind: 'custom_api',
      adapterType: 'opencode_cli',
      protocol: 'openai_chat_completions',
      baseUrl: 'https://api.example.com/v1',
      credentialEnv: 'RELAY_HUB_TEST_MISSING_CREDENTIAL_97',
      models: ['model-a'],
    };

    await expect(checkProviderConnectionHealth(connection, { mode: 'live', model: 'model-a' })).resolves.toMatchObject({
      status: 'unhealthy',
      checkMode: 'live',
      credentialAvailable: false,
      requestAttempted: false,
    });
  });
});
