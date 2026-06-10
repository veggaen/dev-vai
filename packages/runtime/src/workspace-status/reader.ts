import { execFile } from 'node:child_process';

export interface WorkspaceStatusEvidence {
  source: 'git-status-readonly';
  capturedAt: string;
  durationMs: number;
  workspaceRoot: string;
  entries: string[];
}

export interface WorkspaceStatusRunnerOptions {
  cwd: string;
  timeoutMs: number;
}

export type WorkspaceStatusRunner = (
  command: string,
  args: string[],
  options: WorkspaceStatusRunnerOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface WorkspaceStatusReaderOptions {
  cwd?: string;
  timeoutMs?: number;
  runner?: WorkspaceStatusRunner;
}

const DEFAULT_TIMEOUT_MS = 5_000;

function runGitStatus(
  command: string,
  args: string[],
  options: WorkspaceStatusRunnerOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        encoding: 'utf8',
        maxBuffer: 512 * 1024,
        timeout: options.timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

export class WorkspaceStatusReader {
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly runner: WorkspaceStatusRunner;

  constructor(options: WorkspaceStatusReaderOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.runner = options.runner ?? runGitStatus;
  }

  async read(): Promise<WorkspaceStatusEvidence> {
    const startedAt = Date.now();
    const { stdout: workspaceRootStdout } = await this.runner(
      'git',
      ['rev-parse', '--show-toplevel'],
      {
        cwd: this.cwd,
        timeoutMs: this.timeoutMs,
      },
    );
    const workspaceRoot = workspaceRootStdout.trim();
    if (!workspaceRoot) {
      throw new Error('git rev-parse returned an empty workspace root');
    }

    const { stdout } = await this.runner(
      'git',
      ['status', '--short'],
      {
        cwd: workspaceRoot,
        timeoutMs: this.timeoutMs,
      },
    );

    return {
      source: 'git-status-readonly',
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      workspaceRoot,
      entries: stdout
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean),
    };
  }
}
