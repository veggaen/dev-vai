import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, resolve } from 'node:path';
import { PERSISTED_NAMES, TIMEOUTS_MS } from '@vai/constants';

const execFileAsync = promisify(execFile);

export interface GitRunner {
  (args: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string }>;
}

export interface WorktreeReceipt {
  readonly root: string;
  readonly branch: string;
  readonly baseRef: string;
  readonly diagnosticCommand: string;
}

export interface IntegrationConflictPolicy {
  readonly safeToIntegrate: boolean;
  readonly overlappingUnsavedPaths: readonly string[];
  readonly overlappingWorkingTreePaths: readonly string[];
  readonly action: 'integrate' | 'hold-for-review';
  readonly reason: string;
}

function normalized(paths: readonly string[]): Set<string> {
  return new Set(paths.map((path) => path.replace(/\\/g, '/').toLowerCase()));
}

/** Unsaved buffers and existing user edits win. Vai never auto-stashes or overwrites them. */
export function decideIntegrationConflict(input: {
  readonly agentPaths: readonly string[];
  readonly unsavedEditorPaths: readonly string[];
  readonly workingTreePaths: readonly string[];
}): IntegrationConflictPolicy {
  const agent = normalized(input.agentPaths);
  const unsaved = [...normalized(input.unsavedEditorPaths)].filter((path) => agent.has(path));
  const dirty = [...normalized(input.workingTreePaths)].filter((path) => agent.has(path));
  const safeToIntegrate = unsaved.length === 0 && dirty.length === 0;
  return {
    safeToIntegrate,
    overlappingUnsavedPaths: unsaved,
    overlappingWorkingTreePaths: dirty,
    action: safeToIntegrate ? 'integrate' : 'hold-for-review',
    reason: safeToIntegrate
      ? 'Agent paths do not overlap unsaved buffers or existing working-tree edits.'
      : 'User buffers and existing edits take precedence; review the agent patch before any git operation.',
  };
}

function safeSessionSlug(sessionId: string): string {
  const slug = sessionId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 48);
  if (!slug) throw new Error('Session id cannot produce a safe worktree slug');
  return slug;
}

export class WorktreeManager {
  constructor(private readonly runGit: GitRunner = async (args, cwd) => {
    const result = await execFileAsync('git', [...args], {
      cwd, windowsHide: true, timeout: TIMEOUTS_MS.apiRequest, maxBuffer: 2_000_000,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  }) {}

  async resolveDefaultRemoteBranch(workspaceRoot: string): Promise<string> {
    try {
      const { stdout } = await this.runGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], workspaceRoot);
      const ref = stdout.trim();
      if (ref.startsWith('origin/')) return ref;
    } catch { /* probe local refs below */ }
    for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
      try {
        await this.runGit(['rev-parse', '--verify', candidate], workspaceRoot);
        return candidate;
      } catch { /* keep probing */ }
    }
    throw new Error('No default branch found. Diagnostic: git symbolic-ref --quiet --short refs/remotes/origin/HEAD');
  }

  async create(workspaceRoot: string, sessionId: string): Promise<WorktreeReceipt> {
    const slug = safeSessionSlug(sessionId);
    const baseRef = await this.resolveDefaultRemoteBranch(workspaceRoot);
    const repoName = basename(resolve(workspaceRoot));
    const root = resolve(dirname(resolve(workspaceRoot)), PERSISTED_NAMES.worktreeFolder, `${repoName}-${slug}`);
    const branch = `vai/agent/${slug}`;
    const diagnosticCommand = `git worktree add -b ${branch} "${root}" ${baseRef}`;
    try {
      await this.runGit(['worktree', 'add', '-b', branch, root, baseRef], workspaceRoot);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Worktree creation failed: ${detail}. Diagnostic: ${diagnosticCommand}`, {
        cause: error,
      });
    }
    return { root, branch, baseRef, diagnosticCommand };
  }
}
