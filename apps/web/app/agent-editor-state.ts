import {
  defaultExecutionPolicy,
  identifyExecutionPolicyPreset,
  type AgentAdapterType,
  type AgentCapability,
  type AgentPermissionPreset,
  type AgentProfile,
  type AgentRuntimeDescriptor,
  type ExecutionPolicy,
  type ProviderConnection,
} from '@relay-hub/contracts';

export interface AgentEditorDraft {
  editingAgentId: string | null;
  name: string;
  capabilities: AgentCapability[];
  adapterType: AgentAdapterType;
  providerConnectionId: string;
  model: string;
  variant: string;
  agentName: string;
  instructions: string;
  executionPolicy: ExecutionPolicy;
  permissionPreset: AgentPermissionPreset | 'custom';
  enabled: boolean;
}

export function createAgentEditorDraft(
  agent: AgentProfile | undefined,
  connections: ProviderConnection[],
  runtimes: AgentRuntimeDescriptor[],
): AgentEditorDraft {
  if (agent) {
    const executionPolicy = agent.executionPolicy ?? defaultExecutionPolicy(agent.adapterType, agent.capabilities);
    return {
      editingAgentId: agent.id,
      name: agent.name,
      capabilities: agent.capabilities.filter(
        (capability): capability is AgentCapability => capability === 'implement' || capability === 'review',
      ),
      adapterType: agent.adapterType,
      providerConnectionId: agent.providerConnectionId ?? '',
      model: typeof agent.config.model === 'string' ? agent.config.model : '',
      variant: typeof agent.config.variant === 'string' ? agent.config.variant : '',
      agentName: typeof agent.config.agentName === 'string' ? agent.config.agentName : '',
      instructions: agent.instructions ?? '',
      executionPolicy,
      permissionPreset: identifyExecutionPolicyPreset(agent.adapterType, executionPolicy),
      enabled: agent.enabled,
    };
  }

  const adapterType: AgentAdapterType = 'opencode_cli';
  const capabilities: AgentCapability[] = ['implement'];
  const providerConnection = connections.find(
    (connection) => connection.adapterType === adapterType && connection.enabled,
  );
  const runtime = runtimes.find((candidate) => candidate.adapterType === adapterType);
  const executionPolicy = defaultExecutionPolicy(adapterType, capabilities);
  return {
    editingAgentId: null,
    name: '',
    capabilities,
    adapterType,
    providerConnectionId: providerConnection?.id ?? '',
    model: providerConnection?.kind === 'custom_api'
      ? providerConnection.models[0] ?? ''
      : runtime?.models[0] ?? '',
    variant: '',
    agentName: '',
    instructions: '',
    executionPolicy,
    permissionPreset: 'builder_standard',
    enabled: true,
  };
}

export function isLatestAgentEditorRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}
