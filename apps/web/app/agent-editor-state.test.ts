import {
  defaultExecutionPolicy,
  type AgentProfile,
  type AgentRuntimeDescriptor,
  type ProviderConnection,
} from '@relay-hub/contracts';
import { describe, expect, it } from 'vitest';
import { createAgentEditorDraft, isLatestAgentEditorRequest } from './agent-editor-state';

const connection: ProviderConnection = {
  id: 'connection-1',
  workspaceId: 'workspace-1',
  name: 'OpenCode 本机认证',
  kind: 'official_cli',
  adapterType: 'opencode_cli',
  protocol: 'cli_managed',
  models: [],
  enabled: true,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
};

const runtime: AgentRuntimeDescriptor = {
  adapterType: 'opencode_cli',
  label: 'OpenCode CLI',
  available: true,
  models: ['opencode/test-model'],
  message: 'available',
};

const agent: AgentProfile = {
  id: 'agent-1',
  workspaceId: 'workspace-1',
  name: 'Selected Agent',
  adapterType: 'opencode_cli',
  capabilities: ['implement'],
  providerConnectionId: connection.id,
  config: { model: 'opencode/selected-model', variant: 'high', agentName: 'build' },
  instructions: 'Keep the architecture simple.',
  executionPolicy: defaultExecutionPolicy('opencode_cli', ['implement']),
  enabled: true,
};

describe('Agent editor state', () => {
  it('hydrates the selected Agent before runtime discovery completes', () => {
    expect(createAgentEditorDraft(agent, [connection], [])).toMatchObject({
      editingAgentId: agent.id,
      name: agent.name,
      model: 'opencode/selected-model',
      variant: 'high',
      agentName: 'build',
      providerConnectionId: connection.id,
    });
  });

  it('uses runtime discovery only for a new Agent default', () => {
    expect(createAgentEditorDraft(undefined, [connection], [runtime])).toMatchObject({
      editingAgentId: null,
      adapterType: 'opencode_cli',
      model: 'opencode/test-model',
      providerConnectionId: connection.id,
    });
  });

  it('rejects stale runtime responses', () => {
    expect(isLatestAgentEditorRequest(1, 2)).toBe(false);
    expect(isLatestAgentEditorRequest(2, 2)).toBe(true);
  });
});
