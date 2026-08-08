import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type AgentHealth,
  type AgentProfile,
  OpenCodeRuntimeConfigSchema,
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

async function run(command: string, args: string[]): Promise<string> {
  const result = await execFileAsync(command, args, {
    env: diagnosticEnvironment(),
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout.trim();
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
