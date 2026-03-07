/**
 * VeggaAI Eval Runner
 *
 * Executes eval tasks against a model adapter and persists results.
 * The runner is model-agnostic — it works with any ModelAdapter.
 *
 * Usage:
 *   const runner = new EvalRunner(db, models);
 *   const result = await runner.run({ modelId: 'anthropic:claude-sonnet-4-20250514', track: 'comprehension' });
 */

import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import type { VaiDatabase } from '../db/client.js';
import { evalRuns, evalScores } from '../db/schema.js';
import type { ModelRegistry } from '../models/adapter.js';
import type {
  EvalTask,
  EvalTaskResult,
  EvalRunResult,
  EvalRunConfig,
  EvalRunSummary,
  EvalTrack,
} from './types.js';
import { computeGrade } from './types.js';

// ── Task Registry ──

/** In-memory registry of eval tasks, grouped by track */
const taskRegistry = new Map<EvalTrack, EvalTask[]>();

/** Register eval tasks for a track */
export function registerEvalTasks(track: EvalTrack, tasks: EvalTask[]): void {
  const existing = taskRegistry.get(track) ?? [];
  taskRegistry.set(track, [...existing, ...tasks]);
}

/** Get all tasks for a track */
export function getEvalTasks(track: EvalTrack): EvalTask[] {
  return taskRegistry.get(track) ?? [];
}

/** Get all registered tracks */
export function getEvalTracks(): EvalTrack[] {
  return Array.from(taskRegistry.keys());
}

// ── Scorer ──

function scoreResponse(response: string, task: EvalTask): { passed: boolean; score: number; detail: string } {
  const { strategy, value, threshold } = task.expected;
  const normalized = response.toLowerCase().trim();

  switch (strategy) {
    case 'contains': {
      const terms = value.toLowerCase().split('|').map((t) => t.trim());
      const matched = terms.filter((t) => normalized.includes(t));
      const score = matched.length / terms.length;
      return {
        passed: score >= (threshold ?? 0.5),
        score,
        detail: `Matched ${matched.length}/${terms.length} terms`,
      };
    }

    case 'regex': {
      const regex = new RegExp(value, 'i');
      const match = regex.test(response);
      return {
        passed: match,
        score: match ? 1.0 : 0.0,
        detail: match ? 'Regex matched' : 'Regex did not match',
      };
    }

    case 'exact': {
      const match = normalized === value.toLowerCase().trim();
      return {
        passed: match,
        score: match ? 1.0 : 0.0,
        detail: match ? 'Exact match' : 'Did not match exactly',
      };
    }

    case 'semantic': {
      // Placeholder — will use embeddings once available
      // For now, fall back to fuzzy contains
      const terms = value.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
      const matched = terms.filter((t) => normalized.includes(t));
      const score = terms.length > 0 ? matched.length / terms.length : 0;
      return {
        passed: score >= (threshold ?? 0.6),
        score,
        detail: `Semantic fallback: ${matched.length}/${terms.length} key terms found`,
      };
    }

    case 'custom': {
      // Custom scorers will be registered separately
      return {
        passed: false,
        score: 0,
        detail: `Custom scorer '${task.expected.scorer}' not yet implemented`,
      };
    }

    default:
      return { passed: false, score: 0, detail: `Unknown strategy: ${strategy}` };
  }
}

// ── Runner ──

export class EvalRunner {
  constructor(
    private db: VaiDatabase,
    private models: ModelRegistry,
  ) {}

  /**
   * Run an eval track and persist results.
   */
  async run(config: EvalRunConfig): Promise<EvalRunResult> {
    const adapter = this.models.get(config.modelId);
    const allTasks = getEvalTasks(config.track);

    // Filter to specific tasks if requested
    const tasks = config.taskIds
      ? allTasks.filter((t) => config.taskIds!.includes(t.id))
      : allTasks;

    if (tasks.length === 0) {
      throw new Error(`No eval tasks registered for track: ${config.track}`);
    }

    const runId = ulid();
    const startedAt = new Date();
    const maxAttempts = config.maxAttempts ?? 1;
    const temperature = config.temperature ?? 0;

    // Persist run start
    this.db.insert(evalRuns).values({
      id: runId,
      modelId: config.modelId,
      track: config.track,
      startedAt,
      config: JSON.stringify({ maxAttempts, temperature, taskCount: tasks.length }),
    }).run();

    // Execute tasks
    const results: EvalTaskResult[] = [];

    for (const task of tasks) {
      let bestResult: EvalTaskResult | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const taskStart = performance.now();

        try {
          const messages = [
            ...(task.systemPrompt ? [{ role: 'system' as const, content: task.systemPrompt }] : []),
            { role: 'user' as const, content: task.prompt },
          ];

          const response = await adapter.chat({
            messages,
            temperature,
            maxTokens: task.maxTokens ?? 2048,
          });

          const { passed, score, detail } = scoreResponse(response.message.content, task);
          const wallTimeMs = Math.round(performance.now() - taskStart);

          const result: EvalTaskResult = {
            taskId: task.id,
            passed,
            score,
            attempts: attempt,
            tokensIn: response.usage.promptTokens,
            tokensOut: response.usage.completionTokens,
            wallTimeMs,
            modelResponse: response.message.content,
            detail,
          };

          // Keep the best attempt
          if (!bestResult || result.score > bestResult.score) {
            bestResult = result;
          }

          // If passed, no need to retry
          if (passed) break;
        } catch (err) {
          bestResult = {
            taskId: task.id,
            passed: false,
            score: 0,
            attempts: attempt,
            tokensIn: 0,
            tokensOut: 0,
            wallTimeMs: Math.round(performance.now() - taskStart),
            modelResponse: '',
            detail: `Error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      if (bestResult) {
        results.push(bestResult);

        // Persist score
        this.db.insert(evalScores).values({
          id: ulid(),
          runId,
          taskId: bestResult.taskId,
          passed: bestResult.passed,
          score: bestResult.score,
          attempts: bestResult.attempts,
          tokensIn: bestResult.tokensIn,
          tokensOut: bestResult.tokensOut,
          wallTime: bestResult.wallTimeMs,
          detail: bestResult.detail,
        }).run();
      }
    }

    const endedAt = new Date();

    // Persist run end
    this.db.update(evalRuns)
      .set({ endedAt })
      .where(eq(evalRuns.id, runId))
      .run();

    // Build summary
    const summary = this.buildSummary(results);

    return {
      runId,
      modelId: config.modelId,
      track: config.track,
      startedAt,
      endedAt,
      tasks: results,
      summary,
    };
  }

  private buildSummary(results: EvalTaskResult[]): EvalRunSummary {
    const passed = results.filter((r) => r.passed).length;
    const totalScore = results.reduce((sum, r) => sum + r.score, 0);
    const avgScore = results.length > 0 ? totalScore / results.length : 0;

    return {
      totalTasks: results.length,
      passed,
      failed: results.length - passed,
      avgScore: Math.round(avgScore * 100) / 100,
      totalTokensIn: results.reduce((sum, r) => sum + r.tokensIn, 0),
      totalTokensOut: results.reduce((sum, r) => sum + r.tokensOut, 0),
      totalWallTimeMs: results.reduce((sum, r) => sum + r.wallTimeMs, 0),
      grade: computeGrade(avgScore),
    };
  }
}
