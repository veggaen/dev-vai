import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolExecutor } from '../src/tools/executor.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ThorsenAdaptiveController } from '../src/thorsen/types.js';
import type { Tool } from '../src/tools/interface.js';
import type { ModelAdapter, ChatChunk, ChatRequest } from '../src/models/adapter.js';

// ── Helpers ──

function makeTool(name: string, handler: (args: Record<string, unknown>) => string | Promise<string>, opts?: { fail?: boolean }): Tool {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: { type: 'object', properties: {} },
    async execute(args) {
      const output = await handler(args);
      return { success: !opts?.fail, output };
    },
  };
}

function makeToolCall(name: string, args: Record<string, unknown> = {}, id?: string) {
  return { id: id ?? `call_${name}_${Date.now()}`, name, arguments: JSON.stringify(args) };
}

/** Create a mock ModelAdapter that yields a fixed sequence of responses. */
function mockAdapter(responses: Array<{ text?: string; toolCalls?: Array<{ id: string; name: string; args: string }> }>): ModelAdapter {
  let callIndex = 0;
  return {
    id: 'mock:test',
    displayName: 'Mock Adapter',
    supportsStreaming: true,
    supportsToolUse: true,
    async *chatStream(_req: ChatRequest): AsyncGenerator<ChatChunk> {
      const resp = responses[callIndex++];
      if (!resp) {
        yield { type: 'text_delta', textDelta: '[no more responses]' };
        yield { type: 'done', usage: { promptTokens: 0, completionTokens: 0 } };
        return;
      }

      if (resp.text) {
        yield { type: 'text_delta', textDelta: resp.text };
      }

      if (resp.toolCalls) {
        for (const tc of resp.toolCalls) {
          yield { type: 'tool_call_delta', toolCallDelta: { id: tc.id, name: tc.name, argumentsDelta: tc.args } };
        }
      }

      yield { type: 'done', usage: { promptTokens: 10, completionTokens: 5 } };
    },
    chat: undefined as never,
  } as ModelAdapter;
}

async function collectChunks(gen: AsyncGenerator<ChatChunk & { _toolExecution?: unknown }>) {
  const chunks: Array<ChatChunk & { _toolExecution?: unknown }> = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

// ── Tests ──

describe('ToolExecutor', () => {
  let registry: ToolRegistry;
  let executor: ToolExecutor;

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.register(makeTool('echo', (args) => `echo: ${args.msg ?? 'empty'}`));
    registry.register(makeTool('slow', async () => {
      await new Promise(r => setTimeout(r, 50));
      return 'done-slow';
    }));
    registry.register(makeTool('fail_tool', () => 'oops', { fail: true }));
    executor = new ToolExecutor(registry);
  });

  // ── Single Tool Execution ──

  describe('executeTool', () => {
    it('executes a registered tool successfully', async () => {
      const result = await executor.executeTool(makeToolCall('echo', { msg: 'hello' }));
      expect(result.success).toBe(true);
      expect(result.output).toBe('echo: hello');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns failure for unknown tool', async () => {
      const result = await executor.executeTool(makeToolCall('nonexistent'));
      expect(result.success).toBe(false);
      expect(result.output).toContain('Tool not found: nonexistent');
    });

    it('returns failure when tool reports failure', async () => {
      const result = await executor.executeTool(makeToolCall('fail_tool'));
      expect(result.success).toBe(false);
      expect(result.output).toBe('oops');
    });

    it('handles tool execution errors gracefully', async () => {
      registry.register({
        name: 'throw_tool',
        description: 'throws',
        parameters: {},
        execute: () => { throw new Error('boom'); },
      });
      const result = await executor.executeTool(makeToolCall('throw_tool'));
      expect(result.success).toBe(false);
      expect(result.output).toContain('boom');
    });

    it('tracks duration for slow tools', async () => {
      const result = await executor.executeTool(makeToolCall('slow'));
      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(40); // 50ms sleep with tolerance
    });
  });

  // ── Tool Definitions ──

  describe('getToolDefinitions', () => {
    it('returns definitions for all registered tools', () => {
      const defs = executor.getToolDefinitions();
      expect(defs).toHaveLength(3);
      expect(defs.map(d => d.name).sort()).toEqual(['echo', 'fail_tool', 'slow']);
    });
  });

  // ── Agent Loop ──

  describe('runAgentLoop', () => {
    it('returns text immediately when model produces no tool calls', async () => {
      const adapter = mockAdapter([{ text: 'Hello world' }]);
      const request: ChatRequest = { messages: [{ role: 'user', content: 'hi' }] };

      const chunks = await collectChunks(executor.runAgentLoop(adapter, request));
      const textChunks = chunks.filter(c => c.type === 'text_delta' && c.textDelta);
      const doneChunk = chunks.find(c => c.type === 'done');

      expect(textChunks.some(c => c.textDelta === 'Hello world')).toBe(true);
      expect(doneChunk).toBeDefined();
      expect(doneChunk!.usage!.promptTokens).toBe(10);
    });

    it('executes one tool call then returns final text', async () => {
      const adapter = mockAdapter([
        { toolCalls: [{ id: 'tc1', name: 'echo', args: '{"msg":"ping"}' }] },
        { text: 'Got: echo result' },
      ]);
      const request: ChatRequest = { messages: [{ role: 'user', content: 'test' }] };

      const chunks = await collectChunks(executor.runAgentLoop(adapter, request));
      const toolExecs = chunks.filter(c => (c as any)._toolExecution);
      const textChunks = chunks.filter(c => c.type === 'text_delta' && c.textDelta);

      expect(toolExecs).toHaveLength(1);
      expect((toolExecs[0] as any)._toolExecution.output).toBe('echo: ping');
      expect(textChunks.some(c => c.textDelta?.includes('Got: echo result'))).toBe(true);
    });

    it('respects maxIterations and stops', async () => {
      // Adapter always returns tool calls — should stop after maxIterations
      const infiniteToolCalls = Array.from({ length: 15 }, (_, i) => ({
        toolCalls: [{ id: `tc_${i}`, name: 'echo', args: '{"msg":"loop"}' }],
      }));
      const adapter = mockAdapter(infiniteToolCalls);
      const smallExecutor = new ToolExecutor(registry, { maxIterations: 3 });
      const request: ChatRequest = { messages: [{ role: 'user', content: 'test' }] };

      const chunks = await collectChunks(smallExecutor.runAgentLoop(adapter, request));
      const toolExecs = chunks.filter(c => (c as any)._toolExecution);
      const doneChunk = chunks.find(c => c.type === 'done');

      expect(toolExecs).toHaveLength(3); // 3 iterations × 1 tool each
      expect(doneChunk).toBeDefined();
      // Should contain the max-iterations warning
      expect(chunks.some(c => c.textDelta?.includes('maximum tool iterations'))).toBe(true);
    });

    it('accumulates token usage across iterations', async () => {
      const adapter = mockAdapter([
        { toolCalls: [{ id: 'tc1', name: 'echo', args: '{}' }] },
        { toolCalls: [{ id: 'tc2', name: 'echo', args: '{}' }] },
        { text: 'final' },
      ]);
      const request: ChatRequest = { messages: [{ role: 'user', content: 'test' }] };

      const chunks = await collectChunks(executor.runAgentLoop(adapter, request));
      const done = chunks.find(c => c.type === 'done');

      // 3 model calls × 10 prompt tokens each = 30
      expect(done!.usage!.promptTokens).toBe(30);
      expect(done!.usage!.completionTokens).toBe(15);
    });
  });

  // ── Adaptive Controller Integration ──

  describe('adaptive batching', () => {
    it('exposes controller via .adaptive getter', () => {
      const controller = new ThorsenAdaptiveController();
      const ex = new ToolExecutor(registry, undefined, controller);
      expect(ex.adaptive).toBe(controller);
    });

    it('creates a default controller if none provided', () => {
      expect(executor.adaptive).toBeInstanceOf(ThorsenAdaptiveController);
    });

    it('executes multiple tool calls in parallel batches', async () => {
      // Set controller to concurrency=2 (linear state with min=1, max=3)
      const controller = new ThorsenAdaptiveController({ initialConcurrency: 2 });
      const ex = new ToolExecutor(registry, undefined, controller);

      // Track execution order
      const executionLog: string[] = [];
      registry.register(makeTool('log_a', async () => {
        executionLog.push('a_start');
        await new Promise(r => setTimeout(r, 20));
        executionLog.push('a_end');
        return 'a';
      }));
      registry.register(makeTool('log_b', async () => {
        executionLog.push('b_start');
        await new Promise(r => setTimeout(r, 20));
        executionLog.push('b_end');
        return 'b';
      }));

      const adapter = mockAdapter([
        {
          toolCalls: [
            { id: 'tc1', name: 'log_a', args: '{}' },
            { id: 'tc2', name: 'log_b', args: '{}' },
          ],
        },
        { text: 'done' },
      ]);
      const request: ChatRequest = { messages: [{ role: 'user', content: 'test' }] };

      await collectChunks(ex.runAgentLoop(adapter, request));

      // With concurrency=2, both tools run in the same batch (parallel)
      // Both should start before either ends
      expect(executionLog[0]).toBe('a_start');
      expect(executionLog[1]).toBe('b_start');
    });

    it('feeds latency back to controller after each batch', async () => {
      const controller = new ThorsenAdaptiveController({ initialConcurrency: 5 });
      const observeSpy = vi.spyOn(controller, 'observe');
      const ex = new ToolExecutor(registry, undefined, controller);

      const adapter = mockAdapter([
        {
          toolCalls: [
            { id: 'tc1', name: 'echo', args: '{"msg":"a"}' },
            { id: 'tc2', name: 'echo', args: '{"msg":"b"}' },
          ],
        },
        { text: 'done' },
      ]);
      const request: ChatRequest = { messages: [{ role: 'user', content: 'test' }] };

      await collectChunks(ex.runAgentLoop(adapter, request));

      // With concurrency=5, both tools fit in one batch → one observe call
      expect(observeSpy).toHaveBeenCalledTimes(1);
      expect(observeSpy.mock.calls[0][0]).toBeGreaterThanOrEqual(0);
    });

    it('splits tools into multiple batches when concurrency is low', async () => {
      const controller = new ThorsenAdaptiveController({ initialConcurrency: 1 });
      const observeSpy = vi.spyOn(controller, 'observe');
      const ex = new ToolExecutor(registry, undefined, controller);

      const adapter = mockAdapter([
        {
          toolCalls: [
            { id: 'tc1', name: 'echo', args: '{"msg":"a"}' },
            { id: 'tc2', name: 'echo', args: '{"msg":"b"}' },
            { id: 'tc3', name: 'echo', args: '{"msg":"c"}' },
          ],
        },
        { text: 'done' },
      ]);
      const request: ChatRequest = { messages: [{ role: 'user', content: 'test' }] };

      await collectChunks(ex.runAgentLoop(adapter, request));

      // concurrency=1 → 3 tools → 3 batches → 3 observe calls
      expect(observeSpy).toHaveBeenCalledTimes(3);
    });

    it('controller state evolves based on observed latencies', async () => {
      const controller = new ThorsenAdaptiveController({ initialConcurrency: 5, windowSize: 5 });
      const ex = new ToolExecutor(registry, undefined, controller);

      // Register a very fast tool
      registry.register(makeTool('instant', () => 'fast'));

      const adapter = mockAdapter([
        { toolCalls: [{ id: 'tc1', name: 'instant', args: '{}' }] },
        { toolCalls: [{ id: 'tc2', name: 'instant', args: '{}' }] },
        { toolCalls: [{ id: 'tc3', name: 'instant', args: '{}' }] },
        { text: 'done' },
      ]);
      const request: ChatRequest = { messages: [{ role: 'user', content: 'test' }] };

      await collectChunks(ex.runAgentLoop(adapter, request));

      // Fast tools → wormhole state → concurrency should trend upward
      const snap = controller.snapshot();
      expect(snap.observations).toBe(3);
      expect(snap.state).toBe('wormhole'); // <100ms latency
      expect(snap.concurrency).toBeGreaterThanOrEqual(5);
    });
  });
});
