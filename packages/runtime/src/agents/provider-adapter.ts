import type { AgentLaunchRequest, AgentProcessEvent, ToolCapability } from '@vai/contracts/adoption';

export interface AgentProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly executable: string;
  /** Complete host capabilities this opaque subprocess may exercise. */
  readonly requiredCapabilities: readonly ToolCapability[];
  buildArguments(request: AgentLaunchRequest): readonly string[];
  parseStdout(line: string, context: AgentAdapterContext): readonly AgentProcessEvent[];
}

export interface AgentAdapterContext {
  readonly request: AgentLaunchRequest;
  readonly nextSequence: () => number;
  readonly now: () => number;
}

type AgentProcessEventPayload = AgentProcessEvent extends infer Event
  ? Event extends AgentProcessEvent
    ? Omit<Event, 'schemaVersion' | 'sessionId' | 'providerId' | 'sequence' | 'timestamp'>
    : never
  : never;

export function adapterEvent(
  context: AgentAdapterContext,
  event: AgentProcessEventPayload,
): AgentProcessEvent {
  return {
    schemaVersion: 1,
    sessionId: context.request.sessionId,
    providerId: context.request.providerId,
    sequence: context.nextSequence(),
    timestamp: context.now(),
    ...event,
  } as AgentProcessEvent;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function textFromEvent(parsed: Record<string, unknown>): string | null {
  for (const key of ['text', 'content', 'message', 'delta', 'result']) {
    if (typeof parsed[key] === 'string' && parsed[key]) return parsed[key] as string;
  }
  const nested = record(parsed.item) ?? record(parsed.message);
  if (nested) return textFromEvent(nested);
  return null;
}

abstract class JsonLineAdapter implements AgentProviderAdapter {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly executable: string;
  readonly requiredCapabilities = ['read', 'write', 'shell', 'network', 'git', 'process'] as const;
  abstract buildArguments(request: AgentLaunchRequest): readonly string[];

  parseStdout(line: string, context: AgentAdapterContext): readonly AgentProcessEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let parsed: Record<string, unknown> | null = null;
    try { parsed = record(JSON.parse(trimmed)); } catch { /* diagnostic below */ }
    if (!parsed) {
      return [adapterEvent(context, { type: 'diagnostic', stream: 'stdout', text: trimmed })];
    }
    const type = String(parsed.type ?? parsed.event ?? '');
    const tool = record(parsed.tool) ?? record(parsed.tool_call);
    if (tool || /tool/i.test(type)) {
      return [adapterEvent(context, {
        type: 'tool',
        name: String(tool?.name ?? parsed.name ?? (type || 'tool')),
        payload: tool?.payload ?? parsed.payload ?? parsed,
      })];
    }
    const text = textFromEvent(parsed);
    if (text) return [adapterEvent(context, { type: 'text-delta', text })];
    return [adapterEvent(context, { type: 'diagnostic', stream: 'stdout', text: trimmed })];
  }
}

export class CodexCliAdapter extends JsonLineAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex CLI';
  readonly executable = process.env.VAI_CODEX_CLI?.trim() || 'codex';
  buildArguments(request: AgentLaunchRequest): readonly string[] {
    return ['exec', '--json', '--skip-git-repo-check', ...(request.modelId ? ['--model', request.modelId] : []), request.prompt];
  }
}

export class ClaudeCliAdapter extends JsonLineAdapter {
  readonly id = 'claude';
  readonly displayName = 'Claude Code';
  readonly executable = process.env.VAI_CLAUDE_CLI?.trim() || 'claude';
  buildArguments(request: AgentLaunchRequest): readonly string[] {
    return ['--print', '--output-format', 'stream-json', ...(request.modelId ? ['--model', request.modelId] : []), request.prompt];
  }
}

export class GrokCliAdapter extends JsonLineAdapter {
  readonly id = 'grok';
  readonly displayName = 'Grok CLI';
  readonly executable = process.env.VAI_GROK_CLI?.trim() || 'grok';
  buildArguments(request: AgentLaunchRequest): readonly string[] {
    return ['--json', ...(request.modelId ? ['--model', request.modelId] : []), request.prompt];
  }
}

export class AgentProviderRegistry {
  private readonly adapters = new Map<string, AgentProviderAdapter>();
  register(adapter: AgentProviderAdapter): void { this.adapters.set(adapter.id, adapter); }
  get(id: string): AgentProviderAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Unknown agent provider adapter: ${id}`);
    return adapter;
  }
  list(): AgentProviderAdapter[] { return [...this.adapters.values()]; }
}

export function createDefaultAgentProviderRegistry(): AgentProviderRegistry {
  const registry = new AgentProviderRegistry();
  registry.register(new CodexCliAdapter());
  registry.register(new ClaudeCliAdapter());
  registry.register(new GrokCliAdapter());
  return registry;
}
