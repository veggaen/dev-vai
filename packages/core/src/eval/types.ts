/**
 * VeggaAI Eval Framework — Types
 *
 * Typed definitions for the evaluation system that measures model quality
 * over time. Uses the existing evalRuns/evalScores DB schema.
 *
 * Eval tracks:
 *   - comprehension: Can the model understand and answer about ingested content?
 *   - casual: Can the model be practically helpful in everyday developer conversations?
 *   - creative: Can the model produce useful developer-facing copy and structured creative output?
 *   - complex: Can the model reason through realistic multi-constraint engineering tasks?
 *   - navigation: Can the model follow multi-step instructions?
 *   - bugfix: Can the model identify and fix code bugs?
 *   - feature: Can the model implement new features from specs?
 *   - thorsen: How well does the model leverage Thorsen Curve templates?
 *   - gym: Re-run VaiGym drills as automated eval
 */

// ── Tracks ──

export type EvalTrack = 'comprehension' | 'casual' | 'creative' | 'complex' | 'navigation' | 'bugfix' | 'feature' | 'thorsen' | 'gym' | 'cognitive';

// ── Tasks ──

export interface EvalTask {
  /** Unique task ID within the track */
  id: string;
  /** Which track this task belongs to */
  track: EvalTrack;
  /** Human-readable description */
  description: string;
  /** The prompt to send to the model */
  prompt: string;
  /** System prompt override (optional) */
  systemPrompt?: string;
  /** Expected output patterns or exact matches for scoring */
  expected: EvalExpectation;
  /** Maximum tokens the model should use */
  maxTokens?: number;
  /** Tags for filtering/grouping */
  tags?: string[];
}

export interface EvalExpectation {
  /** Strategy for checking the response */
  strategy: 'contains' | 'regex' | 'exact' | 'semantic' | 'checklist' | 'custom';
  /** Pattern or text to check against */
  value?: string;
  /** For semantic: minimum similarity score (0-1) */
  threshold?: number;
  /** Required terms that each score independently */
  required?: string[];
  /** Each group passes if any term in that group is present */
  anyOf?: string[][];
  /** Section headings or labels that should appear */
  sections?: string[];
  /** Terms that should not appear */
  forbidden?: string[];
  /** Minimum approximate word count */
  minWords?: number;
  /** For custom: a function name in the custom scorer registry */
  scorer?: string;
}

// ── Results ──

export interface EvalTaskResult {
  taskId: string;
  passed: boolean;
  score: number; // 0.0 - 1.0
  attempts: number;
  tokensIn: number;
  tokensOut: number;
  wallTimeMs: number;
  modelResponse: string;
  detail?: string; // explanation of score
}

export interface EvalRunResult {
  runId: string;
  modelId: string;
  track: EvalTrack;
  startedAt: Date;
  endedAt: Date;
  tasks: EvalTaskResult[];
  summary: EvalRunSummary;
}

export interface EvalRunSummary {
  totalTasks: number;
  passed: number;
  failed: number;
  avgScore: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalWallTimeMs: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
}

// ── Config ──

export interface EvalRunConfig {
  /** Which model to evaluate */
  modelId: string;
  /** Which track to run */
  track: EvalTrack;
  /** Optional: specific task IDs to run (default: all in track) */
  taskIds?: string[];
  /** Number of retry attempts per task on failure */
  maxAttempts?: number;
  /** Temperature override for eval (default: 0 for determinism) */
  temperature?: number;
}

// ── Grade Boundaries ──

export function computeGrade(avgScore: number): EvalRunSummary['grade'] {
  if (avgScore >= 0.92) return 'A+';
  if (avgScore >= 0.85) return 'A';
  if (avgScore >= 0.75) return 'B';
  if (avgScore >= 0.60) return 'C';
  if (avgScore >= 0.40) return 'D';
  return 'F';
}
