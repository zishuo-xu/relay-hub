import type { AgentProfile, ProviderConnection, ProviderConnectionInput } from '@relay-hub/contracts';

export interface ProviderConnectionUpdateViolation {
  statusCode: 400 | 409;
  error: string;
  message: string;
}

export function validateProviderConnectionUpdate(
  existing: ProviderConnection,
  input: ProviderConnectionInput,
  agents: AgentProfile[],
): ProviderConnectionUpdateViolation | null {
  if (input.kind !== existing.kind || input.adapterType !== existing.adapterType) {
    return {
      statusCode: 400,
      error: 'immutable_connection_identity',
      message: 'Connection kind and Agent CLI cannot be changed after creation.',
    };
  }

  const activeConsumers = agents.filter(
    (agent) => agent.enabled && agent.providerConnectionId === existing.id,
  );
  if (!input.enabled && activeConsumers.length > 0) {
    return {
      statusCode: 409,
      error: 'provider_connection_in_use',
      message: `Disable or move ${activeConsumers.length} active Agent(s) before disabling this connection.`,
    };
  }

  if (input.kind === 'custom_api') {
    const configuredModels = new Set(input.models);
    const removedModels = [...new Set(activeConsumers
      .map((agent) => agent.config.model)
      .filter((model): model is string => typeof model === 'string' && !configuredModels.has(model)))];
    if (removedModels.length > 0) {
      return {
        statusCode: 409,
        error: 'provider_models_in_use',
        message: `Active Agents still use model(s): ${removedModels.join(', ')}.`,
      };
    }
  }

  return null;
}
