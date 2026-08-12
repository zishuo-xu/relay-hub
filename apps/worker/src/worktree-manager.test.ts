import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { shouldReusePreparedWorktree, WorktreeManager } from './worktree-manager.js';

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('WorktreeManager', () => {
  it('prepares a new worktree when an inherited Run has no environment to reuse', () => {
    expect(shouldReusePreparedWorktree({ triggerType: 'consult' })).toBe(false);
    expect(shouldReusePreparedWorktree({
      triggerType: 'consult',
      worktreePath: '/tmp/worktree',
      workingDirectory: '/tmp/worktree/project',
      branchName: 'relayhub/source',
    })).toBe(true);
    expect(shouldReusePreparedWorktree({
      triggerType: 'user',
      worktreePath: '/tmp/worktree',
      workingDirectory: '/tmp/worktree/project',
      branchName: 'relayhub/source',
    })).toBe(false);
  });
  it('creates an isolated branch outside the source repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'relayhub-worktree-test-'));
    temporaryRoots.push(root);
    const repository = join(root, 'source');
    const storage = join(root, 'storage');
    await mkdir(repository);
    await execFileAsync('git', ['-C', repository, 'init', '-q']);
    await execFileAsync('git', ['-C', repository, 'config', 'user.name', 'RelayHub Test']);
    await execFileAsync('git', ['-C', repository, 'config', 'user.email', 'relayhub@example.invalid']);
    await writeFile(join(repository, 'README.md'), '# Fixture\n', 'utf8');
    await execFileAsync('git', ['-C', repository, 'add', 'README.md']);
    await execFileAsync('git', ['-C', repository, 'commit', '-q', '-m', 'fixture']);

    const prepared = await new WorktreeManager(storage).prepare(
      repository,
      '00000000-0000-4000-8000-000000000099',
    );
    const { stdout: branch } = await execFileAsync('git', [
      '-C',
      prepared.worktreePath,
      'branch',
      '--show-current',
    ]);

    expect(branch.trim()).toBe('relayhub/run-00000000-0000-4000-8000-000000000099');
    expect(await readFile(join(prepared.workingDirectory, 'README.md'), 'utf8')).toBe('# Fixture\n');
    expect(prepared.worktreePath.startsWith(repository)).toBe(false);
  });
});
