import { describe, expect, it } from 'vitest';
import { WorkspaceStatusReader } from '../src/workspace-status/reader.js';

describe('WorkspaceStatusReader', () => {
  it('runs a scoped read-only git status and returns attributed entries', async () => {
    const calls: Array<{ command: string; args: string[]; options: { cwd: string; timeoutMs: number } }> = [];
    const reader = new WorkspaceStatusReader({
      cwd: 'C:\\workspace\\packages\\runtime',
      runner: async (command, args, options) => {
        calls.push({ command, args, options });
        if (args[0] === 'rev-parse') {
          return {
            stdout: 'C:\\workspace\n',
            stderr: '',
          };
        }
        return {
          stdout: ' M packages/runtime/src/routes/chat.ts\n?? packages/runtime/src/workspace-status/reader.ts\n',
          stderr: '',
        };
      },
    });

    const result = await reader.read();

    expect(result).toMatchObject({
      source: 'git-status-readonly',
      workspaceRoot: 'C:\\workspace',
      entries: [
        ' M packages/runtime/src/routes/chat.ts',
        '?? packages/runtime/src/workspace-status/reader.ts',
      ],
    });
    expect(calls).toEqual([
      {
        command: 'git',
        args: ['rev-parse', '--show-toplevel'],
        options: {
          cwd: 'C:\\workspace\\packages\\runtime',
          timeoutMs: 5_000,
        },
      },
      {
        command: 'git',
        args: ['status', '--short'],
        options: {
          cwd: 'C:\\workspace',
          timeoutMs: 5_000,
        },
      },
    ]);
    expect(Date.parse(result.capturedAt)).not.toBeNaN();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a clean workspace as an empty entry list', async () => {
    const reader = new WorkspaceStatusReader({
      runner: async (_command, args) => ({
        stdout: args[0] === 'rev-parse' ? 'C:\\workspace\n' : '',
        stderr: '',
      }),
    });

    await expect(reader.read()).resolves.toMatchObject({
      source: 'git-status-readonly',
      workspaceRoot: 'C:\\workspace',
      entries: [],
    });
  });

  it('propagates a failed git status without manufacturing evidence', async () => {
    const reader = new WorkspaceStatusReader({
      runner: async () => {
        throw new Error('not a git repository');
      },
    });

    await expect(reader.read()).rejects.toThrow(/not a git repository/i);
  });
});
