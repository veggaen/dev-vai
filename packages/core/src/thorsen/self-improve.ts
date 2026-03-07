/**
 * Thorsen Self-Improvement Engine — Vai uses itself to level up.
 *
 * This module runs every template through the full 6-stage pipeline,
 * benchmarks results, identifies coverage gaps, and generates
 * actionable improvement suggestions.
 *
 * The loop:
 *   1. Enumerate all action×domain×logicType combinations
 *   2. Run each through the pipeline (with trace)
 *   3. Collect scores, timing, verification results
 *   4. Identify gaps: missing templates, low scores, slow synthesis
 *   5. Generate a structured improvement plan
 *   6. Optionally auto-generate templates for gaps
 *
 * @author V3gga Thorsen
 */

import type {
  ThorsenIntent,
  ThorsenAction,
  ThorsenDomain,
  ThorsenLogicType,
} from './types.js';
import type { ThorsenPipelineResponse } from './pipeline.js';
import { executePipeline, type PipelineOptions } from './pipeline.js';
import { listTemplates } from './synthesizer.js';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Types
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/** Result of running one template through the pipeline */
export interface BenchmarkResult {
  templateKey: string;
  intent: ThorsenIntent;
  success: boolean;
  thorsenScore: number;
  pipelineLatencyMs: number;
  syncState: string;
  verified: boolean;
  parseValid: boolean;
  constraintsPassed: boolean;
  strategy: string;
  codeLines: number;
  error?: string;
}

/** Coverage gap — a valid intent combination without a template */
export interface CoverageGap {
  key: string;
  action: ThorsenAction;
  domain: ThorsenDomain;
  logicType: ThorsenLogicType;
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

/** An actionable improvement suggestion */
export interface ImprovementSuggestion {
  category: 'coverage' | 'quality' | 'performance' | 'verification';
  severity: 'critical' | 'important' | 'nice-to-have';
  title: string;
  description: string;
  effort: 'small' | 'medium' | 'large';
}

/** Complete self-improvement report */
export interface SelfImprovementReport {
  /** ISO timestamp */
  timestamp: string;
  /** How long the benchmark took */
  benchmarkDurationMs: number;
  /** Total templates available */
  totalTemplates: number;
  /** Results per template */
  results: BenchmarkResult[];
  /** Aggregate stats */
  stats: {
    avgScore: number;
    avgLatencyMs: number;
    wormholeRate: number;  // % hitting <100ms
    parallelRate: number;  // % hitting 100-200ms
    linearRate: number;    // % hitting >200ms
    verifiedRate: number;  // % with verified=true
    successRate: number;   // % that completed without error
    totalCodeLines: number;
  };
  /** Missing template coverage */
  gaps: CoverageGap[];
  /** Actionable improvements */
  suggestions: ImprovementSuggestion[];
  /** Overall health grade: A-F */
  grade: string;
  /** Next steps — ordered by impact */
  nextSteps: string[];
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * The comprehensive intent space
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const ALL_ACTIONS: ThorsenAction[] = ['create', 'optimize', 'debug', 'explain', 'transpile', 'test'];
const ALL_DOMAINS: ThorsenDomain[] = ['calculator', 'component', 'api-route', 'utility', 'dataset', 'pipeline', 'vai-drill', 'test', 'custom'];
const ALL_LOGIC_TYPES: ThorsenLogicType[] = ['functional', 'stateful', 'reactive', 'declarative'];

/** High-value intent combinations that should have templates (prioritized) */
const HIGH_PRIORITY_COMBOS: string[] = [
  'create:component:functional',
  'create:component:stateful',
  'create:component:reactive',
  'create:component:declarative',
  'create:api-route:functional',
  'create:utility:functional',
  'create:pipeline:functional',
  'create:pipeline:reactive',
  'create:dataset:functional',
  'create:vai-drill:functional',
  'create:calculator:functional',
  'create:calculator:stateful',
  'create:test:functional',
  'test:component:reactive',
  'optimize:utility:functional',
  'debug:api-route:functional',
  'explain:utility:functional',
  'transpile:utility:functional',
  'create:custom:functional',
];

/** Medium-priority combos that would be nice to have */
const MEDIUM_PRIORITY_COMBOS: string[] = [
  'optimize:component:reactive',
  'optimize:pipeline:functional',
  'debug:component:reactive',
  'debug:utility:functional',
  'explain:component:reactive',
  'explain:api-route:functional',
  'explain:pipeline:functional',
  'test:utility:functional',
  'test:api-route:functional',
  'transpile:component:reactive',
  'create:dataset:stateful',
  'create:vai-drill:reactive',
];

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Benchmark Engine
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/** Run a single template through the pipeline and collect metrics */
async function benchmarkTemplate(
  templateKey: string,
  options?: PipelineOptions,
): Promise<BenchmarkResult> {
  const [action, domain, logicType] = templateKey.split(':') as [ThorsenAction, ThorsenDomain, ThorsenLogicType];

  // Domain-aware constraints — components/api-routes/tests naturally import frameworks
  const FRAMEWORK_DOMAINS = new Set(['component', 'api-route', 'test']);
  const constraints = FRAMEWORK_DOMAINS.has(domain)
    ? ['typed']  // framework imports are expected, only check types
    : ['no external deps', 'typed'];

  const intent: ThorsenIntent = {
    action,
    domain,
    logicType,
    targetEnv: 'node',
    language: 'typescript',
    spec: `Benchmark test for ${templateKey}`,
    constraints,
    timestampUs: Date.now() * 1000,
  };

  // Override language for transpile templates
  if (action === 'transpile') {
    intent.language = 'python';
  }

  try {
    const response = await executePipeline(intent, {
      traceMode: true,
      ...options,
    }) as ThorsenPipelineResponse;

    const trace = response.trace;
    const artifact = response.artifact;
    const codeLines = artifact.code.split('\n').filter(l => l.trim().length > 0).length;

    return {
      templateKey,
      intent,
      success: trace.success,
      thorsenScore: artifact.thorsenScore,
      pipelineLatencyMs: trace.totalMs,
      syncState: response.sync.state,
      verified: artifact.verified,
      parseValid: trace.intermediates.verified?.parseValid ?? false,
      constraintsPassed: trace.intermediates.verified?.constraintsPassed ?? false,
      strategy: trace.intermediates.routed?.strategy ?? 'unknown',
      codeLines,
    };
  } catch (err) {
    return {
      templateKey,
      intent,
      success: false,
      thorsenScore: 0,
      pipelineLatencyMs: 0,
      syncState: 'linear',
      verified: false,
      parseValid: false,
      constraintsPassed: false,
      strategy: 'error',
      codeLines: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Gap Analysis
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function findCoverageGaps(existingTemplates: string[]): CoverageGap[] {
  const existing = new Set(existingTemplates);
  const gaps: CoverageGap[] = [];

  // Check high-priority combos first
  for (const key of HIGH_PRIORITY_COMBOS) {
    if (!existing.has(key)) {
      const [action, domain, logicType] = key.split(':') as [ThorsenAction, ThorsenDomain, ThorsenLogicType];
      gaps.push({
        key,
        action,
        domain,
        logicType,
        priority: 'high',
        reason: `High-value combination ${key} has no deterministic template`,
      });
    }
  }

  // Check medium-priority combos
  for (const key of MEDIUM_PRIORITY_COMBOS) {
    if (!existing.has(key)) {
      const [action, domain, logicType] = key.split(':') as [ThorsenAction, ThorsenDomain, ThorsenLogicType];
      gaps.push({
        key,
        action,
        domain,
        logicType,
        priority: 'medium',
        reason: `Useful combination ${key} would expand coverage`,
      });
    }
  }

  // Check action coverage — each action should have at least 2 templates
  const actionCounts: Record<string, number> = {};
  for (const key of existingTemplates) {
    const action = key.split(':')[0]!;
    actionCounts[action] = (actionCounts[action] ?? 0) + 1;
  }

  for (const action of ALL_ACTIONS) {
    const count = actionCounts[action] ?? 0;
    if (count < 2) {
      // Find the most impactful domain to add for this action
      for (const domain of ALL_DOMAINS) {
        for (const logic of ALL_LOGIC_TYPES) {
          const key = `${action}:${domain}:${logic}`;
          if (!existing.has(key) && !gaps.some(g => g.key === key)) {
            gaps.push({
              key,
              action: action as ThorsenAction,
              domain: domain as ThorsenDomain,
              logicType: logic as ThorsenLogicType,
              priority: 'low',
              reason: `Action "${action}" only has ${count} template(s) — needs more coverage`,
            });
            break; // One suggestion per action is enough
          }
        }
        if (gaps.some(g => g.action === action && g.priority === 'low')) break;
      }
    }
  }

  return gaps;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Suggestion Generator
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function generateSuggestions(
  results: BenchmarkResult[],
  gaps: CoverageGap[],
): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];

  // Coverage suggestions
  const highGaps = gaps.filter(g => g.priority === 'high');
  const mediumGaps = gaps.filter(g => g.priority === 'medium');

  if (highGaps.length > 0) {
    suggestions.push({
      category: 'coverage',
      severity: 'critical',
      title: `${highGaps.length} high-priority template gaps`,
      description: `Missing templates: ${highGaps.map(g => g.key).join(', ')}. These are high-value combinations users are likely to request.`,
      effort: highGaps.length > 3 ? 'large' : 'medium',
    });
  }

  if (mediumGaps.length > 0) {
    suggestions.push({
      category: 'coverage',
      severity: 'nice-to-have',
      title: `${mediumGaps.length} medium-priority gaps`,
      description: `Additional templates would improve: ${mediumGaps.slice(0, 5).map(g => g.key).join(', ')}${mediumGaps.length > 5 ? ` (+${mediumGaps.length - 5} more)` : ''}`,
      effort: 'medium',
    });
  }

  // Quality suggestions
  const lowScoreResults = results.filter(r => r.thorsenScore < 0.9);
  if (lowScoreResults.length > 0) {
    suggestions.push({
      category: 'quality',
      severity: 'important',
      title: `${lowScoreResults.length} templates score below 0.90`,
      description: `Low-scoring templates: ${lowScoreResults.map(r => `${r.templateKey}=${r.thorsenScore.toFixed(2)}`).join(', ')}. Consider enriching their output or improving verification.`,
      effort: 'small',
    });
  }

  // Performance suggestions
  const slowResults = results.filter(r => r.pipelineLatencyMs > 100);
  if (slowResults.length > 0) {
    suggestions.push({
      category: 'performance',
      severity: 'important',
      title: `${slowResults.length} templates outside wormhole zone`,
      description: `Templates exceeding 100ms: ${slowResults.map(r => `${r.templateKey}=${r.pipelineLatencyMs.toFixed(1)}ms`).join(', ')}. Deterministic templates should resolve in <10ms.`,
      effort: 'medium',
    });
  }

  // Verification suggestions
  const unverifiedResults = results.filter(r => r.success && !r.verified);
  if (unverifiedResults.length > 0) {
    suggestions.push({
      category: 'verification',
      severity: 'important',
      title: `${unverifiedResults.length} templates lack verification`,
      description: `Unverified templates: ${unverifiedResults.map(r => r.templateKey).join(', ')}. Add console.log verification at the bottom of each template.`,
      effort: 'small',
    });
  }

  // Constraint satisfaction
  const constraintFails = results.filter(r => r.success && !r.constraintsPassed);
  if (constraintFails.length > 0) {
    suggestions.push({
      category: 'quality',
      severity: 'nice-to-have',
      title: `${constraintFails.length} templates fail constraint checks`,
      description: `Templates not passing all constraints: ${constraintFails.map(r => r.templateKey).join(', ')}`,
      effort: 'small',
    });
  }

  // Parse validity
  const parseFails = results.filter(r => r.success && !r.parseValid);
  if (parseFails.length > 0) {
    suggestions.push({
      category: 'quality',
      severity: 'critical',
      title: `${parseFails.length} templates generate un-parseable code`,
      description: `Code that doesn't parse: ${parseFails.map(r => r.templateKey).join(', ')}. This must be fixed — generated code should always be syntactically valid.`,
      effort: 'small',
    });
  }

  // Error suggestions
  const errors = results.filter(r => !r.success);
  if (errors.length > 0) {
    suggestions.push({
      category: 'quality',
      severity: 'critical',
      title: `${errors.length} templates throw errors`,
      description: `Failing templates: ${errors.map(r => `${r.templateKey}: ${r.error}`).join('; ')}`,
      effort: 'medium',
    });
  }

  // Sort by severity
  const severityOrder = { critical: 0, important: 1, 'nice-to-have': 2 };
  suggestions.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return suggestions;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Grade Calculator
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function calculateGrade(stats: SelfImprovementReport['stats'], gapCount: number): string {
  let score = 0;

  // Score breakdown (out of 100):
  // Average thorsen score: 0-30 pts
  score += stats.avgScore * 30;

  // Wormhole rate: 0-25 pts
  score += stats.wormholeRate * 25;

  // Verified rate: 0-20 pts
  score += stats.verifiedRate * 20;

  // Success rate: 0-15 pts
  score += stats.successRate * 15;

  // Coverage penalty: -2 pts per high gap, -1 per medium
  score -= gapCount * 1.5;

  // Clamp
  score = Math.max(0, Math.min(100, score));

  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Main: Run Full Self-Improvement Cycle
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export async function runSelfImprovement(
  options?: PipelineOptions,
): Promise<SelfImprovementReport> {
  const startMs = performance.now();

  // 1. Get all templates
  const templates = listTemplates();

  // 2. Benchmark each template
  const results: BenchmarkResult[] = [];
  for (const key of templates) {
    const result = await benchmarkTemplate(key, options);
    results.push(result);
  }

  // 3. Calculate stats
  const successful = results.filter(r => r.success);
  const stats: SelfImprovementReport['stats'] = {
    avgScore: successful.length
      ? successful.reduce((s, r) => s + r.thorsenScore, 0) / successful.length
      : 0,
    avgLatencyMs: successful.length
      ? successful.reduce((s, r) => s + r.pipelineLatencyMs, 0) / successful.length
      : 0,
    wormholeRate: successful.length
      ? successful.filter(r => r.syncState === 'wormhole').length / successful.length
      : 0,
    parallelRate: successful.length
      ? successful.filter(r => r.syncState === 'parallel').length / successful.length
      : 0,
    linearRate: successful.length
      ? successful.filter(r => r.syncState === 'linear').length / successful.length
      : 0,
    verifiedRate: successful.length
      ? successful.filter(r => r.verified).length / successful.length
      : 0,
    successRate: results.length
      ? successful.length / results.length
      : 0,
    totalCodeLines: results.reduce((s, r) => s + r.codeLines, 0),
  };

  // 4. Find gaps
  const gaps = findCoverageGaps(templates);

  // 5. Generate suggestions
  const suggestions = generateSuggestions(results, gaps);

  // 6. Calculate grade
  const grade = calculateGrade(stats, gaps.filter(g => g.priority === 'high').length);

  // 7. Generate next steps
  const nextSteps: string[] = [];

  if (suggestions.some(s => s.severity === 'critical')) {
    nextSteps.push('FIX CRITICAL: Resolve parse errors and template failures first');
  }

  if (stats.verifiedRate < 0.7) {
    nextSteps.push(`VERIFY: Add verification (console.log tests) to ${Math.round((1 - stats.verifiedRate) * templates.length)} unverified templates`);
  }

  const highGaps = gaps.filter(g => g.priority === 'high');
  if (highGaps.length > 0) {
    nextSteps.push(`COVERAGE: Add ${highGaps.length} high-priority templates: ${highGaps.slice(0, 3).map(g => g.key).join(', ')}${highGaps.length > 3 ? '...' : ''}`);
  }

  if (stats.avgScore < 0.95) {
    nextSteps.push(`QUALITY: Raise average score from ${stats.avgScore.toFixed(2)} to ≥0.95 by enriching template outputs`);
  }

  if (stats.wormholeRate < 1.0) {
    nextSteps.push(`PERFORMANCE: ${Math.round((1 - stats.wormholeRate) * templates.length)} templates outside wormhole zone — optimize pipeline overhead`);
  }

  nextSteps.push('SET API KEY: Configure ANTHROPIC_API_KEY to unlock LLM synthesis for uncovered intents');
  nextSteps.push('RUN AGAIN: Re-run self-improvement after each batch of fixes to track progress');

  const benchmarkDurationMs = Math.round((performance.now() - startMs) * 100) / 100;

  return {
    timestamp: new Date().toISOString(),
    benchmarkDurationMs,
    totalTemplates: templates.length,
    results,
    stats,
    gaps,
    suggestions,
    grade,
    nextSteps,
  };
}

/** Quick health check — runs benchmark but returns only summary */
export async function quickHealth(
  options?: PipelineOptions,
): Promise<{
  grade: string;
  templates: number;
  avgScore: number;
  wormholeRate: number;
  successRate: number;
  gaps: number;
  suggestions: number;
}> {
  const report = await runSelfImprovement(options);
  return {
    grade: report.grade,
    templates: report.totalTemplates,
    avgScore: Math.round(report.stats.avgScore * 100) / 100,
    wormholeRate: Math.round(report.stats.wormholeRate * 100),
    successRate: Math.round(report.stats.successRate * 100),
    gaps: report.gaps.length,
    suggestions: report.suggestions.length,
  };
}
