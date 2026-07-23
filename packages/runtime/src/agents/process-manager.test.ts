import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { AgentProcessManager } from './process-manager.js';
import { AgentProviderRegistry, CodexCliAdapter } from './provider-adapter.js';

function fakeChild(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  Object.assign(child, {
    pid: 42,
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    kill: () => true,
  });
  return child;
}

describe('AgentProcessManager', () => {
  it('keeps validated sequenced events available for reconnect catch-up', async () => {
    const registry = new AgentProviderRegistry();
    registry.register(new CodexCliAdapter());
    const child = fakeChild();
    const manager = new AgentProcessManager(registry, () => child);
    manager.launch({
      sessionId: 's1', providerId: 'codex', prompt: 'inspect', workspaceRoot: 'C:\\repo',
      personaIds: [], workspaceScope: 'full',
    });
    (child.stdout as PassThrough).write(`${JSON.stringify({ type: 'message', text: 'hello' })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    const initial = manager.read('s1');
    expect(initial.events.map((event) => event.type)).toEqual(['started', 'text-delta']);
    expect(initial.events.map((event) => event.sequence)).toEqual([0, 1]);
    expect(manager.read('s1', 0).events).toHaveLength(1);
    child.emit('close', 0, null);
    expect(manager.read('s1', 1).events[0]?.type).toBe('completed');
  });

  it('refuses opaque provider processes unless the intersected scopes cover every capability', () => {
    const registry = new AgentProviderRegistry();
    registry.register(new CodexCliAdapter());
    const manager = new AgentProcessManager(registry, () => fakeChild());
    expect(() => manager.launch({
      sessionId: 'locked', providerId: 'codex', prompt: 'inspect', workspaceRoot: 'C:\\repo',
      personaIds: [], workspaceScope: 'full', sessionScope: 'no-network',
    })).toThrow(/network/);
  });
});
