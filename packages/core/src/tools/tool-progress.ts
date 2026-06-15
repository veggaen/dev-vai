/**
 * Progress-step helpers for agent tool batches — feeds ProcessTree with nested
 * tool name → input → output history.
 */

import type { ToolCall } from '../models/adapter.js';
import type { ToolExecutionResult } from './executor.js';

export type ToolRunStatus = 'running' | 'done' | 'failed';

export interface ToolRunProgress {
  readonly id: string;
  readonly name: string;
  readonly status: ToolRunStatus;
  readonly success?: boolean;
  readonly durationMs?: number;
  readonly input?: string;
  readonly output?: string;
}

export interface ToolBatchProgressStep {
  readonly stage: string;
  readonly label: string;
  readonly detail?: string;
  readonly status: 'running' | 'done';
  readonly toolRuns: readonly ToolRunProgress[];
}

const MAX_TOOL_BODY = 6_000;

function trimBody(text: string, max = MAX_TOOL_BODY): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/** Pretty-print tool arguments for the process tree. */
export function formatToolInput(argumentsJson: string): string {
  const raw = argumentsJson?.trim() || '{}';
  try {
    return trimBody(JSON.stringify(JSON.parse(raw), null, 2));
  } catch {
    return trimBody(raw);
  }
}

export function stageForToolBatch(iteration: number): string {
  return `tool-batch-${iteration}`;
}

export function labelForToolBatch(count: number, iteration: number): string {
  const round = iteration + 1;
  if (count === 0) return 'Vai requested tools';
  if (count === 1) return `Vai called 1 tool (round ${round})`;
  return `Vai called ${count} tools (round ${round})`;
}

export function toolRunsFromCalls(toolCalls: readonly ToolCall[]): ToolRunProgress[] {
  return toolCalls.map((call) => ({
    id: call.id,
    name: call.name || 'unknown_tool',
    status: 'running',
    input: formatToolInput(call.arguments),
  }));
}

export function applyToolExecution(
  runs: readonly ToolRunProgress[],
  result: ToolExecutionResult,
): ToolRunProgress[] {
  return runs.map((run) => (
    run.id === result.toolCall.id
      ? {
          ...run,
          name: result.toolCall.name || run.name,
          status: result.success ? 'done' : 'failed',
          success: result.success,
          durationMs: result.durationMs,
          input: run.input ?? formatToolInput(result.toolCall.arguments),
          output: trimBody(result.output),
        }
      : run
  ));
}

export function buildToolBatchProgress(
  iteration: number,
  toolRuns: readonly ToolRunProgress[],
  status: 'running' | 'done',
): ToolBatchProgressStep {
  const count = toolRuns.length;
  const failed = toolRuns.some((run) => run.status === 'failed');
  const detail = status === 'done'
    ? failed
      ? `${toolRuns.filter((run) => run.status === 'failed').length} failed`
      : `${count} completed`
    : undefined;
  return {
    stage: stageForToolBatch(iteration),
    label: labelForToolBatch(count, iteration),
    detail,
    status,
    toolRuns,
  };
}
