import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type AgentHealth,
  type AgentProfile,
  type AgentRuntimeDescriptor,
  type ProviderConnectionSnapshot,
  OpenCodeRuntimeConfigSchema,
  openCodeProviderConfig,
  openCodeProviderKey,
} from '@relay-hub/contracts';

const execFileAsync = promisify(execFile);

function diagnosticEnvironment(): NodeJS.ProcessEnv {
  return {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
    ...(process.env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME } : {}),
    ...(process.env.XDG_DATA_HOME ? { XDG_DATA_HOME: process.env.XDG_DATA_HOME } : {}),
    ...(process.env.XDG_CACHE_HOME ? { XDG_CACHE_HOME: process.env.XDG_CACHE_HOME } : {}),
  };
}

async function run(command: string, args: string[], environment = diagnosticEnvironment()): Promise<string> {
  const result = await execFileAsync(command, args, {
    env: environment,
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout.trim();
}

export async function checkProviderConnectionHealth(connection: ProviderConnectionSnapshot): Promise<AgentHealth> {
  try {
    if (connection.adapterType === 'codex_cli') {
      const version = await run(process.env.RELAY_HUB_CODEX_BIN ?? 'codex', ['--version']);
      return { status: 'healthy', adapterType: 'codex_cli', version, message: 'Codex CLI is available; login is managed by Codex.' };
    }
    if (connection.kind === 'official_cli') {
      const runtime = await listOpenCodeModels();
      return {
        status: 'healthy',
        adapterType: 'opencode_cli',
        version: runtime.version,
        message: `${runtime.models.length} OpenCode models are visible; credentials are managed by OpenCode.`,
      };
    }
    const credentialEnv = connection.credentialEnv;
    const environment = {
      ...diagnosticEnvironment(),
      ...(credentialEnv && process.env[credentialEnv] ? { [credentialEnv]: process.env[credentialEnv] } : {}),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeProviderConfig(connection)),
    };
    const binary = process.env.RELAY_HUB_OPENCODE_BIN ?? 'opencode';
    const [version, catalog] = await Promise.all([
      run(binary, ['--version'], environment),
      run(binary, ['models'], environment),
    ]);
    const available = new Set(catalog.split(/\r?\n/).map((model) => model.trim()).filter(Boolean));
    const prefix = `${openCodeProviderKey(connection.id)}/`;
    const visibleModels = connection.models.filter((model) => available.has(`${prefix}${model}`));
    return {
      status: visibleModels.length === connection.models.length ? 'healthy' : 'unhealthy',
      adapterType: 'opencode_cli',
      version,
      message: visibleModels.length === connection.models.length
        ? `${visibleModels.length} custom models are available to OpenCode; no paid model request was sent.`
        : `Only ${visibleModels.length}/${connection.models.length} custom models are visible in OpenCode.`,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      adapterType: connection.adapterType,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listOpenCodeModels(): Promise<{ version: string; models: string[] }> {
  const binary = process.env.RELAY_HUB_OPENCODE_BIN ?? 'opencode';
  const [version, catalog] = await Promise.all([
    run(binary, ['--version']),
    run(binary, ['models']),
  ]);
  const models = catalog.split(/\r?\n/).map((model) => model.trim()).filter(Boolean);
  return { version, models };
}

export async function listAgentRuntimes(): Promise<AgentRuntimeDescriptor[]> {
  const [codexResult, openCodeResult] = await Promise.allSettled([
    run(process.env.RELAY_HUB_CODEX_BIN ?? 'codex', ['--version']),
    listOpenCodeModels(),
  ]);
  return [
    {
      adapterType: 'mock',
      label: 'Mock',
      available: true,
      version: 'built-in',
      models: [],
      message: 'RelayHub 内置的确定性演示运行时。',
    },
    codexResult.status === 'fulfilled'
      ? {
          adapterType: 'codex_cli',
          label: 'Codex CLI',
          available: true,
          version: codexResult.value,
          models: [],
          message: '使用本机 Codex CLI 当前登录和默认模型配置。',
        }
      : {
          adapterType: 'codex_cli',
          label: 'Codex CLI',
          available: false,
          models: [],
          message: codexResult.reason instanceof Error ? codexResult.reason.message : String(codexResult.reason),
        },
    openCodeResult.status === 'fulfilled'
      ? {
          adapterType: 'opencode_cli',
          label: 'OpenCode CLI',
          available: true,
          version: openCodeResult.value.version,
          models: openCodeResult.value.models,
          message: '模型目录可见；provider 凭证将在真实任务中验证。',
        }
      : {
          adapterType: 'opencode_cli',
          label: 'OpenCode CLI',
          available: false,
          models: [],
          message: openCodeResult.reason instanceof Error ? openCodeResult.reason.message : String(openCodeResult.reason),
        },
  ];
}

export async function checkAgentHealth(agent: AgentProfile): Promise<AgentHealth> {
  try {
    if (agent.adapterType === 'mock') {
      return { status: 'healthy', adapterType: 'mock', message: 'Deterministic Mock runtime is available.' };
    }
    if (agent.adapterType === 'codex_cli') {
      const version = await run(process.env.RELAY_HUB_CODEX_BIN ?? 'codex', ['--version']);
      return { status: 'healthy', adapterType: 'codex_cli', version, message: 'Codex CLI is available.' };
    }

    const config = OpenCodeRuntimeConfigSchema.parse(agent.config);
    if (config.providerConnection?.kind === 'custom_api') {
      const health = await checkProviderConnectionHealth(config.providerConnection);
      return { ...health, model: config.model, modelAvailable: health.status === 'healthy' };
    }
    const runtime = await listOpenCodeModels();
    const modelAvailable = runtime.models.includes(config.model);
    return {
      status: modelAvailable ? 'healthy' : 'unhealthy',
      adapterType: 'opencode_cli',
      version: runtime.version,
      model: config.model,
      modelAvailable,
      message: modelAvailable
        ? 'OpenCode CLI and configured model are visible; provider credentials were not exercised.'
        : `OpenCode model is not available in this project: ${config.model}`,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      adapterType: agent.adapterType,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
