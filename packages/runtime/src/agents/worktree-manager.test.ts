import { describe, expect, it, vi } from 'vitest';
import { decideIntegrationConflict, WorktreeManager } from './worktree-manager.js';

describe('worktree manager', () => {
  it('creates from the default remote ref using argv, not a shell string', async () => {
    const runner = vi.fn(async (args: readonly string[]) => ({
      stdout: args[0] === 'symbolic-ref' ? 'origin/trunk\n' : '', stderr: '',
    }));
    const manager = new WorktreeManager(runner);
    const receipt = await manager.create('C:\\repo\\vai', 'session:1');
    expect(receipt.baseRef).toBe('origin/trunk');
    expect(receipt.branch).toBe('vai/agent/session-1');
    expect(runner).toHaveBeenLastCalledWith(expect.arrayContaining(['worktree', 'add', '-b']), 'C:\\repo\\vai');
  });

  it('holds overlapping agent edits for review while allowing unrelated changes', () => {
    expect(decideIntegrationConflict({
      agentPaths: ['src/a.ts'], unsavedEditorPaths: ['src/a.ts'], workingTreePaths: [],
    }).action).toBe('hold-for-review');
    expect(decideIntegrationConflict({
      agentPaths: ['src/a.ts'], unsavedEditorPaths: ['src/b.ts'], workingTreePaths: ['src/c.ts'],
    }).action).toBe('integrate');
  });
});
