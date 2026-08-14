import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  type AgentHealth,
  type AgentProfile,
  type AgentRuntimeDescriptor,
  type ProviderConnectionHealthCheckInput,
  type ProviderConnectionSnapshot,
  OpenCodeRuntimeConfigSchema,
  openCodeProviderConfig,
  openCodeProviderKey,
} from '@relay-hub/contracts';

const execFileAsync = promisify(execFile);
const RUNTIME_CREDENTIAL_ENV = 'RELAY_HUB_PROVIDER_API_KEY';

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

async function run(
  command: string,
  args: string[],
  environment = diagnosticEnvironment(),
  timeout = 10_000,
  cwd?: string,
): Promise<string> {
  const result = await execFileAsync(command, args, {
    env: environment,
    timeout,
    ...(cwd ? { cwd } : {}),
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout.trim();
}

export async function checkProviderConnectionHealth(
  connection: ProviderConnectionSnapshot,
  input: ProviderConnectionHealthCheckInput = { mode: 'configuration' },
  credentialValue?: string,
): Promise<AgentHealth> {
  try {
    if (connection.adapterType === 'codex_cli') {
      const version = await run(process.env.RELAY_HUB_CODEX_BIN ?? 'codex', ['--version']);
      return {
        status: 'healthy',
        adapterType: 'codex_cli',
        version,
        checkMode: 'configuration',
        requestAttempted: false,
        message: 'Codex CLI is available; login is managed by Codex. No model request was sent.',
      };
    }
    if (connection.adapterType === 'claude_code') {
      const version = await run(process.env.RELAY_HUB_CLAUDE_BIN ?? 'claude', ['--version']);
      return {
        status: 'healthy',
        adapterType: 'claude_code',
        version,
        checkMode: 'configuration',
        requestAttempted: false,
        message: 'Claude Code is available; login is managed by Claude Code. No model request was sent.',
      };
    }
    if (connection.kind === 'official_cli') {
      const runtime = await listOpenCodeModels();
      return {
        status: 'healthy',
        adapterType: 'opencode_cli',
        version: runtime.version,
        checkMode: 'configuration',
        requestAttempted: false,
        message: `${runtime.models.length} OpenCode models are visible; credentials are managed by OpenCode. No model request was sent.`,
      };
    }
    const credentialEnv = credentialValue ? RUNTIME_CREDENTIAL_ENV : connection.credentialEnv;
    const credentialAvailable = Boolean(credentialValue) || !credentialEnv || Boolean(process.env[credentialEnv]);
    if (!credentialAvailable) {
      return {
        status: 'unhealthy',
        adapterType: 'opencode_cli',
        checkMode: input.mode,
        credentialAvailable: false,
        requestAttempted: false,
        message: `Worker environment is missing ${credentialEnv}.`,
      };
    }
    const runtimeConnection = credentialValue
      ? { ...connection, credentialEnv: RUNTIME_CREDENTIAL_ENV }
      : connection;
    const environment = {
      ...diagnosticEnvironment(),
      ...(credentialEnv && (credentialValue ?? process.env[credentialEnv])
        ? { [credentialEnv]: credentialValue ?? process.env[credentialEnv] }
        : {}),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeProviderConfig(runtimeConnection)),
    };
    const binary = process.env.RELAY_HUB_OPENCODE_BIN ?? 'opencode';
    const [version, catalog] = await Promise.all([
      run(binary, ['--version'], environment),
      run(binary, ['models'], environment),
    ]);
    const available = new Set(catalog.split(/\r?\n/).map((model) => model.trim()).filter(Boolean));
    const prefix = `${openCodeProviderKey(connection.id)}/`;
    const visibleModels = connection.models.filter((model) => available.has(`${prefix}${model}`));
    if (visibleModels.length !== connection.models.length) {
      return {
        status: 'unhealthy',
        adapterType: 'opencode_cli',
        version,
        checkMode: input.mode,
        credentialAvailable,
        requestAttempted: false,
        message: `Only ${visibleModels.length}/${connection.models.length} custom models are visible in OpenCode.`,
      };
    }
    if (input.mode === 'live') {
      const model = input.model ?? connection.models[0];
      if (!model) {
        return {
          status: 'unhealthy',
          adapterType: 'opencode_cli',
          version,
          checkMode: 'live',
          credentialAvailable,
          requestAttempted: false,
          message: 'No model is configured for a live request.',
        };
      }
      const liveDirectory = await mkdtemp(join(tmpdir(), 'relayhub-connection-check-'));
      let liveOutput: string;
      try {
        liveOutput = await run(binary, [
          'run',
          '--pure',
          '--format',
          'json',
          '--model',
          `${prefix}${model}`,
          '--dir',
          liveDirectory,
          'Reply exactly RELAYHUB_OK. Do not use tools.',
        ], {
          ...environment,
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            ...openCodeProviderConfig(runtimeConnection),
            share: 'disabled',
            permission: { '*': 'deny' },
          }),
        }, 60_000, liveDirectory);
      } finally {
        await rm(liveDirectory, { recursive: true, force: true });
      }
      if (!liveOutput.includes('RELAYHUB_OK')) {
        throw new Error(`Live request to ${model} did not return the expected verification text.`);
      }
      return {
        status: 'healthy',
        adapterType: 'opencode_cli',
        version,
        model,
        modelAvailable: true,
        checkMode: 'live',
        credentialAvailable,
        requestAttempted: true,
        message: `Live request to ${model} completed successfully. This check may have incurred provider usage.`,
      };
    }
    return {
      status: 'healthy',
      adapterType: 'opencode_cli',
      version,
      checkMode: 'configuration',
      credentialAvailable,
      requestAttempted: false,
      message: `${visibleModels.length} custom models are available to OpenCode; no paid model request was sent.`,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      adapterType: connection.adapterType,
      checkMode: input.mode,
      requestAttempted: input.mode === 'live',
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
  const [codexResult, openCodeResult, claudeCodeResult] = await Promise.allSettled([
    run(process.env.RELAY_HUB_CODEX_BIN ?? 'codex', ['--version']),
    listOpenCodeModels(),
    run(process.env.RELAY_HUB_CLAUDE_BIN ?? 'claude', ['--version']),
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
    claudeCodeResult.status === 'fulfilled'
      ? {
          adapterType: 'claude_code',
          label: 'Claude Code',
          available: true,
          version: claudeCodeResult.value,
          models: [],
          message: '使用本机 Claude Code 当前登录与默认模型配置。',
        }
      : {
          adapterType: 'claude_code',
          label: 'Claude Code',
          available: false,
          models: [],
          message: claudeCodeResult.reason instanceof Error ? claudeCodeResult.reason.message : String(claudeCodeResult.reason),
        },
  ];
}

export async function checkAgentHealth(agent: AgentProfile, credentialValue?: string): Promise<AgentHealth> {
  try {
    if (agent.adapterType === 'mock') {
      return { status: 'healthy', adapterType: 'mock', message: 'Deterministic Mock runtime is available.' };
    }
    if (agent.adapterType === 'codex_cli') {
      const version = await run(process.env.RELAY_HUB_CODEX_BIN ?? 'codex', ['--version']);
      const model = typeof agent.config.model === 'string' ? agent.config.model : undefined;
      return {
        status: 'healthy',
        adapterType: 'codex_cli',
        version,
        ...(model ? { model } : {}),
        message: model
          ? `Codex CLI is available; ${model} will be validated by the next real Run.`
          : 'Codex CLI is available and will use its default model.',
      };
    }
    if (agent.adapterType === 'claude_code') {
      const version = await run(process.env.RELAY_HUB_CLAUDE_BIN ?? 'claude', ['--version']);
      const model = typeof agent.config.model === 'string' ? agent.config.model : undefined;
      return {
        status: 'healthy',
        adapterType: 'claude_code',
        version,
        ...(model ? { model } : {}),
        message: model
          ? `Claude Code is available; ${model} will be validated by the next real Run.`
          : 'Claude Code is available and will use its default model.',
      };
    }

    const config = OpenCodeRuntimeConfigSchema.parse(agent.config);
    if (config.providerConnection?.kind === 'custom_api') {
      const health = await checkProviderConnectionHealth(config.providerConnection, undefined, credentialValue);
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
