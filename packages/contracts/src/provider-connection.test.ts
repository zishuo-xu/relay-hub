import { describe, expect, it } from 'vitest';
import {
  AgentProfileInputSchema,
  openCodeProviderConfig,
  openCodeProviderKey,
  ProviderConnectionHealthCheckInputSchema,
  ProviderConnectionInputSchema,
} from './index.js';

describe('ProviderConnection contract', () => {
  it('builds an OpenCode provider overlay without storing a secret value', () => {
    const id = '00000000-0000-4000-8000-000000000099';
    const connection = {
      id,
      name: 'Team DeepSeek',
      kind: 'custom_api' as const,
      adapterType: 'opencode_cli' as const,
      protocol: 'openai_chat_completions' as const,
      baseUrl: 'https://api.example.com/v1',
      credentialEnv: 'TEAM_API_KEY',
      models: ['deepseek-chat'],
    };
    expect(openCodeProviderKey(id)).toBe('relayhub-00000000000040008000000000000099');
    expect(openCodeProviderConfig(connection)).toEqual({
      provider: {
        'relayhub-00000000000040008000000000000099': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Team DeepSeek',
          options: { baseURL: 'https://api.example.com/v1', apiKey: '{env:TEAM_API_KEY}' },
          models: { 'deepseek-chat': { name: 'deepseek-chat' } },
        },
      },
    });
  });

  it('rejects custom connections without a URI or model catalog', () => {
    const result = ProviderConnectionInputSchema.safeParse({
      name: 'Broken custom provider',
      kind: 'custom_api',
      adapterType: 'opencode_cli',
      protocol: 'openai_chat_completions',
      models: [],
      enabled: true,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a write-only custom credential and rejects one for an official CLI', () => {
    expect(ProviderConnectionInputSchema.parse({
      name: 'Web configured provider',
      kind: 'custom_api',
      adapterType: 'opencode_cli',
      protocol: 'openai_chat_completions',
      baseUrl: 'https://api.example.com/v1',
      credentialSecret: 'test-secret-value',
      models: ['model-a'],
    })).toMatchObject({ credentialSecret: 'test-secret-value' });

    expect(ProviderConnectionInputSchema.safeParse({
      name: 'Codex official',
      kind: 'official_cli',
      adapterType: 'codex_cli',
      protocol: 'cli_managed',
      credentialSecret: 'not-allowed',
    }).success).toBe(false);
  });

  it('allows a Codex Agent to pin an optional official model', () => {
    expect(AgentProfileInputSchema.parse({
      name: 'Codex Reviewer',
      adapterType: 'codex_cli',
      providerConnectionId: '00000000-0000-4000-8000-000000000005',
      capabilities: ['review'],
      model: 'gpt-5.6-codex',
      enabled: true,
    })).toMatchObject({ adapterType: 'codex_cli', model: 'gpt-5.6-codex' });
  });

  it('accepts an official Claude Code connection and optional model alias', () => {
    expect(ProviderConnectionInputSchema.parse({
      name: 'Claude Code official',
      kind: 'official_cli',
      adapterType: 'claude_code',
      protocol: 'cli_managed',
    })).toMatchObject({ adapterType: 'claude_code', kind: 'official_cli' });
    expect(AgentProfileInputSchema.parse({
      name: 'Claude Architect',
      adapterType: 'claude_code',
      providerConnectionId: '00000000-0000-4000-8000-000000000007',
      capabilities: ['implement'],
      model: 'sonnet',
    })).toMatchObject({ adapterType: 'claude_code', model: 'sonnet' });
  });

  it('defaults to a no-cost configuration check and accepts an explicit live check model', () => {
    expect(ProviderConnectionHealthCheckInputSchema.parse({})).toEqual({ mode: 'configuration' });
    expect(ProviderConnectionHealthCheckInputSchema.parse({ mode: 'live', model: 'coding-model' })).toEqual({
      mode: 'live',
      model: 'coding-model',
    });
  });
});
