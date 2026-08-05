import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function validateWorkspaceRoot(inputPath: string): Promise<string> {
  const canonicalPath = await realpath(inputPath);
  const { stdout } = await execFileAsync('git', ['-C', canonicalPath, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
  });
  const gitRoot = await realpath(stdout.trim());
  if (!canonicalPath.startsWith(`${gitRoot}/`) && canonicalPath !== gitRoot) {
    throw new Error(`Workspace must be inside its Git root: ${gitRoot}`);
  }
  return canonicalPath;
}
