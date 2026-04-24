import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db/client.js';
import { ChatService } from '../src/chat/service.js';
import { ModelRegistry } from '../src/models/adapter.js';
import type { ModelAdapter, ChatRequest, ChatResponse, ChatChunk } from '../src/models/adapter.js';
import type { VaiDatabase } from '../src/db/client.js';

class MockAdapter implements ModelAdapter {
  readonly id = 'mock:test';
  readonly displayName = 'Mock Model';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;
  lastStreamRequest?: ChatRequest;

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: 'Mock response' },
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: 'stop',
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    this.lastStreamRequest = request;
    yield { type: 'text_delta', textDelta: 'Hello ' };
    yield { type: 'text_delta', textDelta: 'from ' };
    yield { type: 'text_delta', textDelta: 'VeggaAI!' };
    yield { type: 'done', usage: { promptTokens: 10, completionTokens: 3 } };
  }
}

class StubStreamAdapter implements ModelAdapter {
  readonly displayName: string;
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;
  lastStreamRequest?: ChatRequest;
  streamCalls = 0;

  constructor(
    readonly id: string,
    private readonly chunks: readonly ChatChunk[],
  ) {
    this.displayName = id;
  }

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: 'stub response' },
      usage: { promptTokens: 1, completionTokens: 1 },
      finishReason: 'stop',
      modelId: this.id,
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    this.streamCalls += 1;
    this.lastStreamRequest = request;
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

describe('ChatService', () => {
  let db: VaiDatabase;
  let chatService: ChatService;
  let adapter: MockAdapter;

  beforeEach(() => {
    db = createDb(':memory:');
    const registry = new ModelRegistry();
    adapter = new MockAdapter();
    registry.register(adapter);
    chatService = new ChatService(db, registry);
  });

  it('creates a conversation', () => {
    const id = chatService.createConversation('mock:test', 'Test Chat');
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    expect(chatService.getConversation(id)?.mode).toBe('chat');
  });

  it('persists the selected conversation mode', () => {
    const id = chatService.createConversation('mock:test', 'Plan Chat', 'plan');
    expect(chatService.getConversation(id)?.mode).toBe('plan');

    chatService.updateConversationMode(id, 'builder');
    expect(chatService.getConversation(id)?.mode).toBe('builder');
  });

  it('persists the linked sandbox project for a conversation', () => {
    const id = chatService.createConversation('mock:test', 'Sandbox Chat');

    chatService.updateConversationSandbox(id, 'sandbox-123');
    expect(chatService.getConversation(id)?.sandboxProjectId).toBe('sandbox-123');

    chatService.updateConversationSandbox(id, null);
    expect(chatService.getConversation(id)?.sandboxProjectId).toBeNull();
  });

  it('lists conversations', () => {
    chatService.createConversation('mock:test', 'Chat 1');
    chatService.createConversation('mock:test', 'Chat 2');

    const list = chatService.listConversations();
    expect(list).toHaveLength(2);
  });

  it('sends a message and streams response', async () => {
    const convId = chatService.createConversation('mock:test');

    const chunks: ChatChunk[] = [];
    for await (const chunk of chatService.sendMessage(convId, 'Hi')) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);

    const textChunks = chunks.filter((c) => c.type === 'text_delta');
    expect(textChunks.length).toBe(3);

    const fullText = textChunks.map((c) => c.textDelta).join('');
    expect(fullText).toBe('Hello from VeggaAI!');
  });

  it('auto-creates a conversation when sendMessage is called with an unknown id (race recovery)', async () => {
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      const chunks: ChatChunk[] = [];
      for await (const chunk of chatService.sendMessage(
        'missing-conversation-id',
        'Hi',
        undefined,
        undefined,
        undefined,
        undefined,
        { fallbackModelId: 'mock:test' },
      )) {
        chunks.push(chunk);
      }

      const resolved = chunks.find((c) => c.type === 'conversation_resolved');
      expect(resolved).toBeDefined();
      expect(resolved?.conversationId).toBeTruthy();
      expect(resolved?.conversationId).not.toBe('missing-conversation-id');
      expect(warnings.length).toBeGreaterThan(0);

      // The auto-created conversation must contain the user + assistant turn
      const newId = resolved!.conversationId!;
      const msgs = chatService.getMessages(newId);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe('Hi');
    } finally {
      console.warn = warn;
    }
  });

  it('falls back to vai:v0 when no fallbackModelId hint is provided', async () => {
    // Register a vai:v0 stub adapter so the auto-created conversation can stream.
    class VaiStub implements ModelAdapter {
      readonly id = 'vai:v0';
      readonly displayName = 'Vai stub';
      readonly supportsStreaming = true;
      readonly supportsToolUse = false;
      async chat(): Promise<ChatResponse> {
        return { message: { role: 'assistant', content: 'ok' }, finishReason: 'stop' };
      }
      async *chatStream(): AsyncIterable<ChatChunk> {
        yield { type: 'text_delta', textDelta: 'ok' };
        yield { type: 'done' };
      }
    }
    const registry = new ModelRegistry();
    registry.register(new VaiStub());
    const svc = new ChatService(createDb(':memory:'), registry);
    const warn = console.warn;
    console.warn = () => {};
    try {
      const chunks: ChatChunk[] = [];
      for await (const chunk of svc.sendMessage('does-not-exist', 'hello')) {
        chunks.push(chunk);
      }
      const resolved = chunks.find((c) => c.type === 'conversation_resolved');
      expect(resolved?.conversationId).toBeTruthy();
      expect(svc.getConversation(resolved!.conversationId!)?.modelId).toBe('vai:v0');
    } finally {
      console.warn = warn;
    }
  });

  it('falls back from low-confidence vai:v0 to the configured external adapter', async () => {
    const registry = new ModelRegistry();
    const vaiAdapter = new StubStreamAdapter('vai:v0', [
      { type: 'sources', sources: [], confidence: 0.2 },
      { type: 'text_delta', textDelta: 'I do not know this one.' },
      { type: 'done', usage: { promptTokens: 2, completionTokens: 6 }, modelId: 'vai:v0' },
    ]);
    const externalAdapter = new StubStreamAdapter('mock:test', [
      { type: 'text_delta', textDelta: 'External ' },
      { type: 'text_delta', textDelta: 'answer' },
      { type: 'done', usage: { promptTokens: 4, completionTokens: 2 }, modelId: 'mock:test' },
    ]);
    registry.register(vaiAdapter);
    registry.register(externalAdapter);
    const svc = new ChatService(createDb(':memory:'), registry, {
      vaiFallbackChain: ['vai:v0', 'mock:test'],
    });
    const convId = svc.createConversation('vai:v0');

    const chunks: ChatChunk[] = [];
    for await (const chunk of svc.sendMessage(convId, 'Help me')) {
      chunks.push(chunk);
    }

    const fallbackNoticeIndex = chunks.findIndex((chunk) => chunk.type === 'fallback_notice');
    const sourcesIndex = chunks.findIndex((chunk) => chunk.type === 'sources');
    expect(sourcesIndex).toBeGreaterThanOrEqual(0);
    expect(fallbackNoticeIndex).toBeGreaterThan(sourcesIndex);

    const fallbackNotice = chunks[fallbackNoticeIndex];
    expect(fallbackNotice.fallback).toEqual({
      fromModelId: 'vai:v0',
      toModelId: 'mock:test',
      reason: 'low-confidence',
    });

    const text = chunks
      .filter((chunk) => chunk.type === 'text_delta')
      .map((chunk) => chunk.textDelta)
      .join('');
    expect(text).toBe('External answer');
    expect(vaiAdapter.streamCalls).toBe(1);
    expect(externalAdapter.streamCalls).toBe(1);

    const persisted = svc.getMessages(convId);
    expect(persisted).toHaveLength(2);
    expect(persisted[1].content).toBe('External answer');
    expect(persisted[1].modelId).toBe('mock:test');
  });

  it('does not replace builder file artifacts with external fallback output', async () => {
    const registry = new ModelRegistry();
    const primaryText = [
      '```json title="package.json"',
      '{"name":"tailwind-canonical-classes-autofix"}',
      '```',
      '',
      '```ts title="src/extension.ts"',
      'export const fixOnSave = true;',
      '```',
    ].join('\n');
    const vaiAdapter = new StubStreamAdapter('vai:v0', [
      { type: 'sources', sources: [], confidence: 0.1 },
      { type: 'text_delta', textDelta: primaryText },
      { type: 'done', usage: { promptTokens: 2, completionTokens: 30 }, modelId: 'vai:v0' },
    ]);
    const externalAdapter = new StubStreamAdapter('mock:test', [
      { type: 'text_delta', textDelta: 'External prose should not replace files' },
      { type: 'done', usage: { promptTokens: 4, completionTokens: 2 }, modelId: 'mock:test' },
    ]);
    registry.register(vaiAdapter);
    registry.register(externalAdapter);
    const svc = new ChatService(createDb(':memory:'), registry, {
      vaiFallbackChain: ['mock:test'],
    });
    const convId = svc.createConversation('vai:v0', 'Builder', 'builder');

    const chunks: ChatChunk[] = [];
    for await (const chunk of svc.sendMessage(convId, 'Create a VS Code extension')) {
      chunks.push(chunk);
    }

    expect(chunks.some((chunk) => chunk.type === 'fallback_notice')).toBe(false);
    expect(externalAdapter.streamCalls).toBe(0);
    const text = chunks.filter((chunk) => chunk.type === 'text_delta').map((chunk) => chunk.textDelta).join('');
    expect(text).toContain('title="src/extension.ts"');
    expect(svc.getMessages(convId)[1].modelId).toBe('vai:v0');
  });

  it('passes through high-confidence vai:v0 responses without fallback', async () => {
    const registry = new ModelRegistry();
    const vaiAdapter = new StubStreamAdapter('vai:v0', [
      { type: 'sources', sources: [], confidence: 0.9 },
      { type: 'text_delta', textDelta: 'Known answer' },
      { type: 'done', usage: { promptTokens: 2, completionTokens: 2 }, modelId: 'vai:v0' },
    ]);
    const externalAdapter = new StubStreamAdapter('mock:test', [
      { type: 'text_delta', textDelta: 'Should not run' },
      { type: 'done', usage: { promptTokens: 1, completionTokens: 1 }, modelId: 'mock:test' },
    ]);
    registry.register(vaiAdapter);
    registry.register(externalAdapter);
    const svc = new ChatService(createDb(':memory:'), registry, {
      vaiFallbackChain: ['vai:v0', 'mock:test'],
    });
    const convId = svc.createConversation('vai:v0');

    const chunks: ChatChunk[] = [];
    for await (const chunk of svc.sendMessage(convId, 'Help me')) {
      chunks.push(chunk);
    }

    expect(chunks.some((chunk) => chunk.type === 'fallback_notice')).toBe(false);
    const text = chunks
      .filter((chunk) => chunk.type === 'text_delta')
      .map((chunk) => chunk.textDelta)
      .join('');
    expect(text).toBe('Known answer');
    expect(vaiAdapter.streamCalls).toBe(1);
    expect(externalAdapter.streamCalls).toBe(0);

    const persisted = svc.getMessages(convId);
    expect(persisted).toHaveLength(2);
    expect(persisted[1].content).toBe('Known answer');
    expect(persisted[1].modelId).toBe('vai:v0');
  });

  it('short-circuits chat-meta queries without invoking the model adapter', async () => {
    const convId = chatService.createConversation('mock:test');

    // Seed the conversation with a real first turn.
    for await (const _ of chatService.sendMessage(convId, 'tell me about redbull')) { /* drain */ }
    adapter.lastStreamRequest = undefined;

    const chunks: ChatChunk[] = [];
    for await (const chunk of chatService.sendMessage(convId, 'what was my first message?')) {
      chunks.push(chunk);
    }

    // Adapter must NOT have been touched for the meta turn.
    expect(adapter.lastStreamRequest).toBeUndefined();

    const text = chunks
      .filter((c) => c.type === 'text_delta')
      .map((c) => c.textDelta)
      .join('');
    expect(text).toContain('"tell me about redbull"');

    // Persisted assistant message tagged with the meta intent model id.
    const msgs = chatService.getMessages(convId);
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
    expect(lastAssistant?.modelId).toBe('chat-meta:first-user');
    expect(lastAssistant?.content).toContain('"tell me about redbull"');
  });

  it('counts messages via chat-meta short-circuit', async () => {
    const convId = chatService.createConversation('mock:test');
    for await (const _ of chatService.sendMessage(convId, 'first thing')) { /* drain */ }
    for await (const _ of chatService.sendMessage(convId, 'second thing')) { /* drain */ }
    adapter.lastStreamRequest = undefined;

    const chunks: ChatChunk[] = [];
    for await (const chunk of chatService.sendMessage(convId, 'how many messages have I sent?')) {
      chunks.push(chunk);
    }
    expect(adapter.lastStreamRequest).toBeUndefined();
    const text = chunks.filter((c) => c.type === 'text_delta').map((c) => c.textDelta).join('');
    // The asking turn itself is the third user message.
    expect(text).toMatch(/3 messages from you/);
  });

  it('persists user and assistant messages after streaming', async () => {
    const convId = chatService.createConversation('mock:test');

    // Drain the stream
    for await (const _chunk of chatService.sendMessage(convId, 'Hi')) {
      // consume
    }

    const msgs = chatService.getMessages(convId);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('Hi');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('Hello from VeggaAI!');
  });

  it('injects chat structure hint for multi-question chat in chat mode', async () => {
    const convId = chatService.createConversation('mock:test', 'Chat', 'chat');

    for await (const _chunk of chatService.sendMessage(
      convId,
      'What is Redis? When should I use it instead of Postgres for session storage?',
    )) {
      // consume
    }

    const systemText =
      adapter.lastStreamRequest?.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n') ?? '';

    expect(systemText).toMatch(/scannable answer/i);
    expect(systemText).toMatch(/numbered bullets/i);
  });

  it('injects a temporary plan-mode override for procedural debug prompts in chat mode', async () => {
    const convId = chatService.createConversation('mock:test', 'Chat', 'chat');

    for await (const _chunk of chatService.sendMessage(
      convId,
      'My Docker container keeps crashing, how do I debug it?',
    )) {
      // consume
    }

    const systemText =
      adapter.lastStreamRequest?.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n') ?? '';

    expect(systemText).toMatch(/Temporary mode override for this answer: Plan mode/i);
    expect(systemText).toMatch(/ordered plan or diagnosis/i);
    expect(systemText).toMatch(/likely cause, first checks, how to confirm/i);
  });

  it('injects corrective-turn quality guidance when the user refines a previous answer', async () => {
    const convId = chatService.createConversation('mock:test', 'Chat', 'chat');

    for await (const _chunk of chatService.sendMessage(convId, 'Should I use hosted auth or local auth?')) {
      // consume
    }

    for await (const _chunk of chatService.sendMessage(convId, 'No, I mean for a local-first app, which should I change first?')) {
      // consume
    }

    const systemText =
      adapter.lastStreamRequest?.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n') ?? '';

    expect(systemText).toMatch(/Turn quality contract for this answer/i);
    expect(systemText).toMatch(/correcting or refining the previous answer/i);
    expect(systemText).toMatch(/recommendation in the first sentence/i);
  });

  it('injects domain skill context for non-scaffold requests', async () => {
    const convId = chatService.createConversation('mock:test');

    for await (const _chunk of chatService.sendMessage(convId, 'Build me a photography portfolio with a fullscreen lightbox and masonry gallery.')) {
      // consume
    }

    const systemText = adapter.lastStreamRequest?.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n') ?? '';

    expect(systemText).toMatch(/Domain: Photography & Visual/i);
    expect(systemText).toMatch(/expert in photography and visual design/i);
  });

  it('injects app-builder domain context for Base44-style build workflow prompts', async () => {
    const convId = chatService.createConversation('mock:test');

    for await (const _chunk of chatService.sendMessage(convId, 'Improve Vai so chat feels like Base44 when users want to build apps with plan previews and sandbox handoff.')) {
      // consume
    }

    const systemText = adapter.lastStreamRequest?.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n') ?? '';

    expect(systemText).toMatch(/Domain: Chat App Builder/i);
    expect(systemText).toMatch(/expert chat-first app-builder architect/i);
  });

  it('does not inject domain skill context for explicit scaffold requests', async () => {
    const convId = chatService.createConversation('mock:test');

    for await (const _chunk of chatService.sendMessage(convId, 'Set up a Next.js app with auth and dashboard pages.')) {
      // consume
    }

    const systemText = adapter.lastStreamRequest?.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n') ?? '';

    expect(systemText).not.toMatch(/Domain:/i);
  });

  it('biases active sandbox conversations toward targeted edits', async () => {
    const convId = chatService.createConversation('mock:test', 'Builder Chat', 'builder');
    chatService.updateConversationSandbox(convId, 'sandbox-123');

    for await (const _chunk of chatService.sendMessage(convId, 'Polish the UI and spacing.')) {
      // consume
    }

    const systemText = adapter.lastStreamRequest?.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n') ?? '';

    expect(systemText).toMatch(/active sandbox project is already attached/i);
    expect(systemText).toMatch(/default to targeted edits/i);
    expect(systemText).toMatch(/smallest working diff/i);
  });

  it('does not inject domain skill context when an active sandbox is attached', async () => {
    const convId = chatService.createConversation('mock:test', 'Builder Chat', 'builder');
    chatService.updateConversationSandbox(convId, 'sandbox-123');

    for await (const _chunk of chatService.sendMessage(convId, 'Build me a photography portfolio with a fullscreen lightbox and masonry gallery.')) {
      // consume
    }

    const systemText = adapter.lastStreamRequest?.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n') ?? '';

    expect(systemText).not.toMatch(/Domain: Photography & Visual/i);
    expect(systemText).toMatch(/active sandbox project is already attached/i);
  });

  it('skips agent-mode scaffolding for explicit terminal harness requests', async () => {
    const convId = chatService.createConversation('mock:test', 'Terminal Harness', 'agent');

    for await (const _chunk of chatService.sendMessage(
      convId,
      'TERMINAL_HARNESS_V1\nstep=1/6\nphase=inspect\nworkspace=/app',
      undefined,
      'TERMINAL_HARNESS_V1 reply with one JSON action only',
    )) {
      // consume
    }

    const systemText = adapter.lastStreamRequest?.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n') ?? '';

    expect(systemText).toMatch(/TERMINAL_HARNESS_V1/);
    expect(systemText).not.toMatch(/You are VeggaAI \(Vai\), a local-first AI assistant built by v3gga\. You are in Agent mode\./i);
    expect(systemText).not.toMatch(/Domain:/i);
    expect(systemText).not.toMatch(/scannable answer|numbered bullets/i);
  });

  it('injects a hardening system message for ambiguous repo-native prompts', async () => {
    const convId = chatService.createConversation('mock:test');

    for await (const _chunk of chatService.sendMessage(convId, 'Design a repo-native prediction engine for a large monorepo that warms context before the next question. Explain signals, guardrails, fallback retrieval, and rollout.')) {
      // consume
    }

    const systemText = adapter.lastStreamRequest?.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n') ?? '';

    expect(systemText).toMatch(/repository-native engineering question/i);
    expect(systemText).toMatch(/not React Context or provider trees/i);
    expect(systemText).toMatch(/fallback retrieval\/search/i);
  });

  it('does not inject repo-native hardening for explicit React Context questions', async () => {
    const convId = chatService.createConversation('mock:test');

    for await (const _chunk of chatService.sendMessage(convId, 'When should I use React Context instead of Zustand for frontend state?')) {
      // consume
    }

    const systemText = adapter.lastStreamRequest?.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n') ?? '';

    expect(systemText).not.toMatch(/repository files, symbols, tests, docs/i);
    expect(systemText).not.toMatch(/Do not drift into React Context/i);
  });

  it('injects strict profile and deep design memo guidance when configured', async () => {
    const registry = new ModelRegistry();
    const strictAdapter = new MockAdapter();
    registry.register(strictAdapter);
    const strictChatService = new ChatService(db, registry, {
      promptRewrite: {
        profile: 'strict',
        responseDepth: 'deep-design-memo',
      },
    });
    const convId = strictChatService.createConversation('mock:test');

    for await (const _chunk of strictChatService.sendMessage(convId, 'Design predictive context prefetch for a repo-native code assistant. Use the headings Inputs, Signals, Prediction loop, Working set, Guardrails, Metrics, Rollout, and Failure modes.')) {
      // consume
    }

    const systemText = strictAdapter.lastStreamRequest?.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n') ?? '';

    expect(systemText).toMatch(/Hardening profile: strict/i);
    expect(systemText).toMatch(/Requested response depth: deep-design-memo/i);
    expect(systemText).toMatch(/Respond with a deeper design memo/i);
    expect(systemText).toMatch(/Use a rigid sectioned memo with explicit headings and no preamble/i);
    expect(systemText).toMatch(/Do not add an executive summary, Idea, Overview/i);
    expect(systemText).toMatch(/use exactly these section headings in this order: Inputs, Signals, Prediction loop, Working set, Guardrails, Metrics, Rollout, Failure modes/i);
  });

  it('allows request-level prompt-hardening overrides to supersede service defaults', async () => {
    const convId = chatService.createConversation('mock:test');

    for await (const _chunk of chatService.sendMessage(
      convId,
      'Design predictive context prefetch for a repo-native code assistant. Use the headings Inputs, Signals, Prediction loop, Working set, Guardrails, Metrics, Rollout, and Failure modes.',
      undefined,
      undefined,
      undefined,
      {
        profile: 'strict',
        responseDepth: 'deep-design-memo',
      },
    )) {
      // consume
    }

    const systemText = adapter.lastStreamRequest?.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n') ?? '';

    expect(systemText).toMatch(/Hardening profile: strict/i);
    expect(systemText).toMatch(/Requested response depth: deep-design-memo/i);
    expect(systemText).toMatch(/Respond with a deeper design memo/i);
    expect(systemText).toMatch(/Use a rigid sectioned memo with explicit headings and no preamble/i);
    expect(systemText).toMatch(/Do not add an executive summary, Idea, Overview/i);
    expect(systemText).toMatch(/use exactly these section headings in this order: Inputs, Signals, Prediction loop, Working set, Guardrails, Metrics, Rollout, Failure modes/i);
  });

  it('auto-creates and emits conversation_resolved instead of throwing for unknown ids', async () => {
    // Auto-create now provides race recovery; the only way it can still throw
    // is if the fallback model adapter itself isn't registered.
    const warn = console.warn;
    console.warn = () => {};
    try {
      const chunks: ChatChunk[] = [];
      for await (const chunk of chatService.sendMessage(
        'nonexistent',
        'Hi',
        undefined,
        undefined,
        undefined,
        undefined,
        { fallbackModelId: 'mock:test' },
      )) {
        chunks.push(chunk);
      }
      expect(chunks.find((c) => c.type === 'conversation_resolved')).toBeDefined();
    } finally {
      console.warn = warn;
    }
  });

  it('deletes a conversation and its messages', async () => {
    const convId = chatService.createConversation('mock:test');

    for await (const _chunk of chatService.sendMessage(convId, 'Hi')) {
      // consume
    }

    chatService.deleteConversation(convId);

    const list = chatService.listConversations();
    expect(list).toHaveLength(0);

    const msgs = chatService.getMessages(convId);
    expect(msgs).toHaveLength(0);
  });
});
