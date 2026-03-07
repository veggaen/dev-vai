/**
 * VeggaAI Tool Executor
 *
 * Handles the tool-call loop for agentic chat:
 *   1. Model returns tool_calls in its response
 *   2. Executor runs each tool via ToolRegistry
 *   3. Results are appended as tool-role messages
 *   4. Model is called again with updated history
 *   5. Repeat until model returns text (finishReason: 'stop') or max iterations
 *
 * Design principles:
 * - Stateless: takes messages in, returns messages + results out
 * - Safe: max iterations prevent infinite loops, timeout per tool
 * - Observable: every step emits a ChatChunk so the UI can stream progress
 * - Composable: works with any ModelAdapter that supportsToolUse
 */

import type { Message, ToolCall, ToolDefinition, ChatChunk, ChatRequest, ModelAdapter, TokenUsage } from '../models/adapter.js';
import type { ToolRegistry } from './registry.js';
import type { ToolContext } from './interface.js';
import { ThorsenAdaptiveController, type ThorsenSyncState } from '../thorsen/types.js';

// ── Types ──

export interface ToolExecutorConfig {
  /** Maximum tool-call iterations before forcing a text response */
  maxIterations: number;
  /** Timeout per individual tool execution (ms) */
  toolTimeout: number;
  /** Working directory for file-based tools */
  workingDir: string;
}

export interface ToolExecutionResult {
  /** The tool call that was executed */
  toolCall: ToolCall;
  /** Whether the tool succeeded */
  success: boolean;
  /** The tool's output text */
  output: string;
  /** How long the tool took (ms) */
  durationMs: number;
}

export interface AgentLoopResult {
  /** Final assistant message (text) */
  finalMessage: Message;
  /** All tool executions that happened during the loop */
  toolExecutions: ToolExecutionResult[];
  /** Total iterations the loop ran */
  iterations: number;
  /** Aggregated token usage across all iterations */
  totalUsage: TokenUsage;
  /** Total wall time for the entire loop */
  totalDurationMs: number;
  /** Adaptive controller snapshot at end of loop */
  adaptiveSnapshot?: {
    state: ThorsenSyncState;
    concurrency: number;
    medianLatency: number;
    p95Latency: number;
    observations: number;
  };
}

// ── Default Config ──

const DEFAULT_CONFIG: ToolExecutorConfig = {
  maxIterations: 10,
  toolTimeout: 30_000, // 30 seconds per tool
  workingDir: process.cwd(),
};

// ── Tool Executor ──

export class ToolExecutor {
  private config: ToolExecutorConfig;
  private controller: ThorsenAdaptiveController;

  constructor(
    private tools: ToolRegistry,
    config?: Partial<ToolExecutorConfig>,
    controller?: ThorsenAdaptiveController,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.controller = controller ?? new ThorsenAdaptiveController();
  }

  /** Expose controller for shared observability. */
  get adaptive(): ThorsenAdaptiveController {
    return this.controller;
  }

  /**
   * Convert registered tools to ToolDefinition[] for the model's `tools` parameter.
   */
  getToolDefinitions(): ToolDefinition[] {
    return this.tools.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * Execute a single tool call and return the result.
   */
  async executeTool(toolCall: ToolCall): Promise<ToolExecutionResult> {
    const start = performance.now();
    try {
      if (!this.tools.has(toolCall.name)) {
        return {
          toolCall,
          success: false,
          output: `Tool not found: ${toolCall.name}`,
          durationMs: Math.round(performance.now() - start),
        };
      }

      const tool = this.tools.get(toolCall.name);
      const args = JSON.parse(toolCall.arguments);

      const ctx: ToolContext = {
        workingDir: this.config.workingDir,
        timeout: this.config.toolTimeout,
      };

      const result = await tool.execute(args, ctx);
      return {
        toolCall,
        success: result.success,
        output: result.output,
        durationMs: Math.round(performance.now() - start),
      };
    } catch (err) {
      return {
        toolCall,
        success: false,
        output: `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Math.round(performance.now() - start),
      };
    }
  }

  /**
   * Run the full agent loop: model → tools → model → tools → ... → final text.
   *
   * This is an async generator so the caller can stream progress to the UI
   * (tool status, intermediate reasoning, final text deltas).
   */
  async *runAgentLoop(
    adapter: ModelAdapter,
    request: ChatRequest,
  ): AsyncGenerator<ChatChunk & { _toolExecution?: ToolExecutionResult }> {
    const messages = [...request.messages];
    const toolDefs = request.tools ?? this.getToolDefinitions();
    const allToolExecutions: ToolExecutionResult[] = [];
    let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
    const loopStart = performance.now();

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      // Stream from the model
      let fullText = '';
      let finishReason = 'stop';
      const toolCalls: ToolCall[] = [];
      const toolCallBuffers = new Map<string, { name: string; args: string }>();

      for await (const chunk of adapter.chatStream({
        ...request,
        messages,
        tools: adapter.supportsToolUse ? toolDefs : undefined,
      })) {
        // Aggregate tool call deltas
        if (chunk.type === 'tool_call_delta' && chunk.toolCallDelta) {
          const { id, name, argumentsDelta } = chunk.toolCallDelta;
          if (!toolCallBuffers.has(id)) {
            toolCallBuffers.set(id, { name, args: '' });
          }
          const buf = toolCallBuffers.get(id)!;
          if (name) buf.name = name;
          buf.args += argumentsDelta;
        }

        // Pass through text and reasoning deltas
        if (chunk.type === 'text_delta' || chunk.type === 'reasoning_delta') {
          if (chunk.type === 'text_delta' && chunk.textDelta) fullText += chunk.textDelta;
          yield chunk;
        }

        // Capture usage from done chunk
        if (chunk.type === 'done') {
          if (chunk.usage) {
            totalUsage.promptTokens += chunk.usage.promptTokens;
            totalUsage.completionTokens += chunk.usage.completionTokens;
            totalUsage.cachedTokens = (totalUsage.cachedTokens ?? 0) + (chunk.usage.cachedTokens ?? 0);
          }
        }
      }

      // Finalize tool calls from buffers
      for (const [id, buf] of toolCallBuffers) {
        toolCalls.push({ id, name: buf.name, arguments: buf.args });
      }

      // If no tool calls, we're done — the model produced a final text response
      if (toolCalls.length === 0) {
        yield {
          type: 'done',
          usage: totalUsage,
          durationMs: Math.round(performance.now() - loopStart),
        };
        return;
      }

      // Model wants to call tools — execute them
      const assistantMsg: Message = {
        role: 'assistant',
        content: fullText,
        toolCalls,
      };
      messages.push(assistantMsg);

      // Execute tool calls in adaptive batches based on Thorsen Curve
      const batchSize = Math.max(1, this.controller.concurrency);
      for (let i = 0; i < toolCalls.length; i += batchSize) {
        const batch = toolCalls.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(tc => this.executeTool(tc)));

        let maxLatency = 0;
        for (const result of results) {
          allToolExecutions.push(result);
          maxLatency = Math.max(maxLatency, result.durationMs);

          // Emit a tool execution event so the UI can show progress
          yield {
            type: 'text_delta',
            textDelta: '', // empty delta — the _toolExecution carries the info
            _toolExecution: result,
          } as ChatChunk & { _toolExecution: ToolExecutionResult };

          // Append tool result as a message for the next model call
          messages.push({
            role: 'tool',
            content: result.output,
            toolCallId: result.toolCall.id,
          });
        }

        // Feed observed latency back to the controller
        this.controller.observe(maxLatency);
      }

      // Loop continues — model will be called again with tool results
    }

    // Hit max iterations — force a done
    yield {
      type: 'text_delta',
      textDelta: '\n\n[Reached maximum tool iterations. Stopping agent loop.]',
    };
    yield {
      type: 'done',
      usage: totalUsage,
      durationMs: Math.round(performance.now() - loopStart),
    };
  }
}
