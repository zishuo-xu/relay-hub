import { execFile } from 'node:child_process';
import { access, mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Run } from '@relay-hub/contracts';

const execFileAsync = promisify(execFile);

export interface PreparedWorktree {
  repositoryRoot: string;
  worktreePath: string;
  workingDirectory: string;
  branchName: string;
}

export function shouldReusePreparedWorktree(
  run: Pick<Run, 'triggerType' | 'worktreePath' | 'workingDirectory' | 'branchName'>,
): boolean {
  const inheritsWorktree = ['review', 'retry', 'consult', 'continuation'].includes(run.triggerType);
  return inheritsWorktree && Boolean(run.worktreePath && run.workingDirectory && run.branchName);
}

export class WorktreeManager {
  constructor(
    private readonly worktreeRoot =
      process.env.RELAY_HUB_WORKTREE_ROOT ?? resolve(homedir(), '.relay-hub', 'worktrees'),
  ) {}

  async prepare(workspaceRoot: string, runId: string): Promise<PreparedWorktree> {
    const canonicalWorkspace = await realpath(workspaceRoot);
    const { stdout } = await execFileAsync('git', ['-C', canonicalWorkspace, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
    });
    const repositoryRoot = await realpath(stdout.trim());
    const relativeWorkspace = relative(repositoryRoot, canonicalWorkspace);
    if (relativeWorkspace.startsWith('..') || isAbsolute(relativeWorkspace)) {
      throw new Error(`Workspace is outside Git root: ${canonicalWorkspace}`);
    }

    const canonicalWorktreeRoot = resolve(this.worktreeRoot);
    if (
      canonicalWorktreeRoot === repositoryRoot ||
      canonicalWorktreeRoot.startsWith(`${repositoryRoot}/`)
    ) {
      throw new Error('Worktree storage must be outside the source Git repository');
    }
    await mkdir(canonicalWorktreeRoot, { recursive: true });

    const worktreePath = join(canonicalWorktreeRoot, runId);
    try {
      await access(worktreePath);
      throw new Error(`Worktree path already exists and was preserved: ${worktreePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const branchName = `relayhub/run-${runId}`;
    await execFileAsync('git', ['-C', repositoryRoot, 'worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });

    return {
      repositoryRoot,
      worktreePath,
      workingDirectory: relativeWorkspace ? join(worktreePath, relativeWorkspace) : worktreePath,
      branchName,
    };
  }
}
