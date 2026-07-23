import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  agentProcessEventSchema,
  agentSessionSnapshotSchema,
  type AgentLaunchRequest,
  type AgentProcessEvent,
  type AgentSessionSnapshot,
} from '@vai/contracts/adoption';
import { LIMITS } from '@vai/constants';
import { adapterEvent, type AgentProviderRegistry } from './provider-adapter.js';
import { capabilityDenialMessage, decideToolCapabilities } from '@vai/core';

export interface AgentProcessSpawner {
  (command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; windowsHide: boolean; shell: false }): ChildProcessWithoutNullStreams;
}

interface ManagedAgentSession {
  snapshot: AgentSessionSnapshot;
  events: AgentProcessEvent[];
  child?: ChildProcessWithoutNullStreams;
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA'];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
}

export class AgentProcessManager {
  private readonly sessions = new Map<string, ManagedAgentSession>();

  constructor(
    private readonly providers: AgentProviderRegistry,
    private readonly spawner: AgentProcessSpawner = (command, args, options) => spawn(command, [...args], options),
  ) {}

  launch(request: AgentLaunchRequest, worktreeRoot?: string): AgentSessionSnapshot {
    if (this.sessions.has(request.sessionId)) throw new Error(`Agent session already exists: ${request.sessionId}`);
    const adapter = this.providers.get(request.providerId);
    const capabilityDecision = decideToolCapabilities({
      required: adapter.requiredCapabilities,
      workspaceScope: request.workspaceScope,
      sessionScope: request.sessionScope,
    });
    if (!capabilityDecision.allowed) throw new Error(capabilityDenialMessage(`agent:${adapter.id}`, capabilityDecision));
    let sequence = 0;
    const now = () => Date.now();
    const context = { request, nextSequence: () => sequence++, now };
    const snapshot: AgentSessionSnapshot = agentSessionSnapshotSchema.parse({
      sessionId: request.sessionId, providerId: request.providerId, state: 'starting',
      workspaceRoot: request.workspaceRoot, ...(worktreeRoot ? { worktreeRoot } : {}),
      startedAt: now(), lastSequence: 0,
    });
    const managed: ManagedAgentSession = { snapshot, events: [] };
    this.sessions.set(request.sessionId, managed);

    try {
      const child = this.spawner(adapter.executable, adapter.buildArguments(request), {
        cwd: worktreeRoot ?? request.workspaceRoot,
        env: safeEnvironment(), windowsHide: true, shell: false,
      });
      managed.child = child;
      this.push(managed, adapterEvent(context, { type: 'started', pid: child.pid }));
      managed.snapshot = { ...managed.snapshot, state: 'running', pid: child.pid, lastSequence: sequence };

      createInterface({ input: child.stdout }).on('line', (line) => {
        for (const event of adapter.parseStdout(line, context)) this.push(managed, event);
      });
      createInterface({ input: child.stderr }).on('line', (line) => {
        this.push(managed, adapterEvent(context, { type: 'diagnostic', stream: 'stderr', text: line }));
      });
      child.once('error', (error) => {
        this.push(managed, adapterEvent(context, { type: 'failed', code: 'spawn', message: error.message, diagnostic: `${adapter.executable} ${adapter.buildArguments(request).join(' ')}` }));
        managed.snapshot = { ...managed.snapshot, state: 'failed', failure: error.message, completedAt: now(), lastSequence: sequence };
      });
      child.once('close', (exitCode, signal) => {
        if (managed.snapshot.state === 'failed' || managed.snapshot.state === 'cancelled') return;
        const code = exitCode ?? -1;
        if (code === 0) {
          this.push(managed, adapterEvent(context, { type: 'completed', exitCode: code }));
          managed.snapshot = { ...managed.snapshot, state: 'completed', completedAt: now(), lastSequence: sequence };
        } else {
          const message = `Provider exited with code ${code}${signal ? ` (${signal})` : ''}`;
          this.push(managed, adapterEvent(context, { type: 'failed', code: 'exit', message, exitCode: code }));
          managed.snapshot = { ...managed.snapshot, state: 'failed', failure: message, completedAt: now(), lastSequence: sequence };
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.push(managed, adapterEvent(context, { type: 'failed', code: 'spawn', message }));
      managed.snapshot = { ...managed.snapshot, state: 'failed', failure: message, completedAt: now(), lastSequence: sequence };
    }
    return managed.snapshot;
  }

  cancel(sessionId: string): AgentSessionSnapshot {
    const managed = this.require(sessionId);
    managed.child?.kill();
    managed.snapshot = { ...managed.snapshot, state: 'cancelled', completedAt: Date.now() };
    return managed.snapshot;
  }

  read(sessionId: string, afterSequence = -1): { session: AgentSessionSnapshot; events: AgentProcessEvent[]; nextSequence: number } {
    const managed = this.require(sessionId);
    const events = managed.events.filter((event) => event.sequence > afterSequence);
    return { session: managed.snapshot, events, nextSequence: managed.snapshot.lastSequence + 1 };
  }

  private push(managed: ManagedAgentSession, event: AgentProcessEvent): void {
    const validated = agentProcessEventSchema.parse(event);
    managed.events.push(validated);
    if (managed.events.length > LIMITS.sessionMaxEvents) managed.events.splice(0, managed.events.length - LIMITS.sessionMaxEvents);
    managed.snapshot = { ...managed.snapshot, lastSequence: validated.sequence };
  }

  private require(sessionId: string): ManagedAgentSession {
    const managed = this.sessions.get(sessionId);
    if (!managed) throw new Error(`Agent session not found: ${sessionId}`);
    return managed;
  }
}
