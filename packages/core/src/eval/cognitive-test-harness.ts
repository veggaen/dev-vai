/**
 * Phase 3 — Cognitive Test Harness
 *
 * Extracts conversation scenarios from scored sessions,
 * runs multi-turn tests, regression checks, and A/B testing
 * (with vs without cognitive lessons).
 *
 * Pure functions — no DB access, no side-effects.
 */

import type {
  ConversationScore,
  SubScore,
  TurnPair,
  CurvePoint,
  AntiPatternDetection,
  SpeakingDimensionScores,
} from './conversation-scorer.js';
import type {
  CognitiveLesson,
  AggregatedPattern,
  ContextInjection,
} from './learning-extractor.js';
import type { EvalRunSummary, EvalExpectation } from './types.js';
import { computeGrade } from './types.js';

/* ═══════════════════════════════════════════════════════════════ */
/*  Types                                                         */
/* ═══════════════════════════════════════════════════════════════ */

export type ScenarioCategory = 'golden-path' | 'anti-pattern-example' | 'edge-case';
export type ScenarioDifficulty = 'apprentice' | 'journeyman' | 'expert' | 'master';

export interface GradingItem {
  readonly check: string;
  readonly strategy: 'contains' | 'regex' | 'checklist';
  readonly value: string;
  readonly weight: number;
}

export interface ScenarioTurn {
  readonly userMessage: string;
  readonly turnContext: string;           // max 500 chars
  readonly expectedBehavior: string;      // max 300 chars
  readonly antiPatterns: readonly string[];
  readonly gradingChecklist: readonly GradingItem[];
}

export interface ConversationScenario {
  readonly id: string;                    // cog-{sessionId.slice(0,8)}-{index}
  readonly sourceSessionId: string;
  readonly title: string;                 // max 100 chars
  readonly category: ScenarioCategory;
  readonly turns: readonly ScenarioTurn[];
  readonly baselineScore: number;         // 0-100 from real session
  readonly baselineGrade: EvalRunSummary['grade'];
  readonly difficulty: ScenarioDifficulty;
  readonly foundations: readonly string[];
  readonly tags: readonly string[];
}

export interface MultiTurnResult {
  readonly scenarioId: string;
  readonly perTurnScores: readonly number[];
  readonly overallScore: number;
  readonly overallGrade: EvalRunSummary['grade'];
  readonly totalTurns: number;
  readonly injectedLessonCount: number;
}

export interface RegressionResult {
  readonly scenarioId: string;
  readonly baselineGrade: string;
  readonly newGrade: string;
  readonly delta: number;
  readonly perTurnDeltas: readonly number[];
  readonly significantRegressions: readonly string[];
}

export interface ABTestResult {
  readonly scenarioId: string;
  readonly controlScore: number;
  readonly treatmentScore: number;
  readonly delta: number;
  readonly injectedLessonIds: readonly string[];
  readonly winner: 'treatment' | 'control' | 'tie';
}

export interface CognitiveTestReport {
  readonly scenarios: readonly ConversationScenario[];
  readonly multiTurnResults: readonly MultiTurnResult[];
  readonly regressionResults: readonly RegressionResult[];
  readonly abTestResults: readonly ABTestResult[];
  readonly summary: CognitiveTestSummary;
  readonly testedAt: number;
}

export interface CognitiveTestSummary {
  readonly totalScenarios: number;
  readonly passed: number;
  readonly failed: number;
  readonly avgScore: number;
  readonly avgGrade: EvalRunSummary['grade'];
  readonly regressionAvgDelta: number;
  readonly regressionSignificantCount: number;
  readonly abWinRate: number;
  readonly abAvgDelta: number;
  readonly topContributingLessons: readonly string[];
  readonly weakAreas: readonly string[];
}

/** Adapter interface for model inference (A/B testing requires a model) */
export interface ModelAdapter {
  generate(prompt: string): Promise<string>;
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Constants                                                     */
/* ═══════════════════════════════════════════════════════════════ */

const GRADE_TO_NUMBER: Record<string, number> = {
  'A+': 97, 'A': 92, 'B': 85, 'C': 75, 'D': 60, 'F': 40,
};

const MIN_GOLDEN_GRADE = 85;           // B or above
const MIN_GOLDEN_TURNS = 3;
const MIN_GOLDEN_ANTIPATTERN = 80;
const MAX_ANTI_PATTERN_GRADE = 60;     // D or below
const MAX_ANTI_PATTERN_SCORE = 50;
const EDGE_LONG_TURNS = 20;
const EDGE_SHORT_TURNS = 2;
const REGRESSION_TOLERANCE = -5;       // avg delta must be >= -5
const AB_WIN_THRESHOLD = 2;            // |delta| > 2 to declare winner
const AB_MIN_WIN_RATE = 0.60;          // 60% of scenarios must improve
const MAX_CONTEXT_CHARS = 8000;
const ADAPTER_TIMEOUT_MS = 30_000;     // 30s timeout for model adapter calls
const PII_PATTERNS = [
  /C:\\Users\\[^\\]+/gi,
  /\/home\/[^/]+/gi,
  /\/Users\/[^/]+/gi,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
];

/* ═══════════════════════════════════════════════════════════════ */
/*  Utility Functions                                             */
/* ═══════════════════════════════════════════════════════════════ */

function sanitizePII(text: string): string {
  let result = text;
  for (const pattern of PII_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function gradeToNumber(grade: string): number {
  return GRADE_TO_NUMBER[grade] ?? 50;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 3) + '...';
}

function classifyDifficulty(avgWordCount: number, technicalDensity: number): ScenarioDifficulty {
  const complexity = avgWordCount * 0.3 + technicalDensity * 100 * 0.7;
  if (complexity > 50) return 'master';
  if (complexity > 30) return 'expert';
  if (complexity > 15) return 'journeyman';
  return 'apprentice';
}

function extractTechnicalDensity(text: string): number {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return 0;
  const techPattern = /\b(?:function|const|let|var|class|import|export|async|await|return|throw|catch|try|interface|type|enum|Promise|Array|Object|Map|Set|Error|null|undefined|boolean|number|string|void)\b/gi;
  const matches = text.match(techPattern) ?? [];
  return matches.length / words.length;
}

function identifyFoundations(
  score: ConversationScore,
): string[] {
  const foundations: string[] = [];

  // Use §8 foundation names from cognitive alignment factors
  // This ensures scenario foundations match the ALL_FOUNDATIONS schema
  // used by learning-extractor for A/B test lesson filtering
  for (const factor of score.cognitiveAlignment.factors) {
    if (factor.raw >= 60) foundations.push(factor.name);
  }

  // Ensure at least some foundations from high-level scores
  if (foundations.length === 0) {
    if (score.efficiency.value >= 80) foundations.push('first-principles');
    if (score.teachingQuality.value >= 80) foundations.push('meta-learning');
    if (score.cognitiveAlignment.value >= 80) foundations.push('intellectual-honesty');
  }

  return foundations;
}

function buildGradingChecklist(
  turnPair: TurnPair,
  score: ConversationScore,
): GradingItem[] {
  const items: GradingItem[] = [];
  const assistantText = turnPair.assistantResponse?.content ?? '';
  if (assistantText.length === 0) return items;

  // Extract key concepts from assistant response as checklist items
  const codeBlocks = assistantText.match(/```[\s\S]*?```/g) ?? [];
  const hasCode = codeBlocks.length > 0;
  const hasExplanation = assistantText.length > 200;
  const hasSteps = /\b[1-9]\)|\b[1-9]\.|\bstep\s+\d/i.test(assistantText);

  if (hasCode) {
    items.push({
      check: 'Includes code example',
      strategy: 'regex',
      value: '```',
      weight: 0.3,
    });
  }
  if (hasExplanation) {
    items.push({
      check: 'Provides detailed explanation',
      strategy: 'checklist',
      value: 'length>200',
      weight: 0.3,
    });
  }
  if (hasSteps) {
    items.push({
      check: 'Uses structured steps',
      strategy: 'regex',
      value: '\\b[1-9][).:]|\\bstep\\s+\\d',
      weight: 0.2,
    });
  }

  // Extract key technical terms from assistant response
  const techTerms = assistantText.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) ?? [];
  const uniqueTerms = [...new Set(techTerms)].slice(0, 3);
  for (const term of uniqueTerms) {
    items.push({
      check: `Mentions ${term}`,
      strategy: 'contains',
      value: term,
      weight: 0.2 / Math.max(uniqueTerms.length, 1),
    });
  }

  // Normalize weights to sum to 1.0
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  if (totalWeight > 0 && Math.abs(totalWeight - 1.0) > 0.01) {
    return items.map(i => ({ ...i, weight: i.weight / totalWeight }));
  }
  return items;
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Scenario Extraction (Step 3.1)                                */
/* ═══════════════════════════════════════════════════════════════ */

export interface ScoredSession {
  readonly sessionId: string;
  readonly title: string;
  readonly score: ConversationScore;
  readonly turnPairs: readonly TurnPair[];
  readonly events: readonly { content: string; type: string }[];
}

/**
 * Extract conversation scenarios from scored sessions for testing.
 * Produces golden paths, anti-pattern examples, and edge cases.
 */
export function extractScenarios(
  sessions: readonly ScoredSession[],
  options?: { maxScenarios?: number },
): ConversationScenario[] {
  const max = options?.maxScenarios ?? 20;
  const scenarios: ConversationScenario[] = [];
  let idx = 0;

  // 1. Golden paths: grade >= B, turnPairCount >= 3, antiPatterns.score >= 80
  const golden = sessions.filter(s =>
    gradeToNumber(s.score.overallGrade) >= MIN_GOLDEN_GRADE &&
    s.score.turnPairCount >= MIN_GOLDEN_TURNS &&
    s.score.antiPatterns.score >= MIN_GOLDEN_ANTIPATTERN
  );
  for (const s of golden.slice(0, Math.ceil(max * 0.5))) {
    scenarios.push(buildScenario(s, 'golden-path', idx++));
  }

  // 2. Anti-pattern examples: grade <= D OR antiPatterns.score <= 50
  const antiPattern = sessions.filter(s =>
    gradeToNumber(s.score.overallGrade) <= MAX_ANTI_PATTERN_GRADE ||
    s.score.antiPatterns.score <= MAX_ANTI_PATTERN_SCORE
  );
  for (const s of antiPattern.slice(0, Math.ceil(max * 0.25))) {
    scenarios.push(buildScenario(s, 'anti-pattern-example', idx++));
  }

  // 3. Edge cases: very long (>20 turns) or very short (1-2 turns)
  const edgeCases = sessions.filter(s =>
    s.score.turnPairCount > EDGE_LONG_TURNS ||
    (s.score.turnPairCount <= EDGE_SHORT_TURNS && s.score.turnPairCount > 0)
  );
  for (const s of edgeCases.slice(0, Math.ceil(max * 0.25))) {
    scenarios.push(buildScenario(s, 'edge-case', idx++));
  }

  return scenarios.slice(0, max);
}

function buildScenario(
  session: ScoredSession,
  category: ScenarioCategory,
  index: number,
): ConversationScenario {
  const turns: ScenarioTurn[] = [];

  for (const tp of session.turnPairs.slice(0, 10)) {
    const userText = sanitizePII(tp.userMessage.content ?? '');
    const assistantText = sanitizePII(tp.assistantResponse?.content ?? '');

    const expectedBehavior = category === 'anti-pattern-example'
      ? `Avoid: ${session.score.antiPatterns.detections
          .filter(d => d.turnPairIndex === tp.index)
          .map(d => d.pattern)
          .join(', ') || 'detected anti-patterns'}`
      : truncate(assistantText, 300);

    const antiPatterns = session.score.antiPatterns.detections
      .filter(d => d.turnPairIndex === tp.index)
      .map(d => d.pattern);

    const turnContext = tp.toolCalls.length > 0
      ? truncate(`Tool calls: ${tp.toolCalls.map(t => t.type).join(', ')}`, 500)
      : '';

    turns.push({
      userMessage: truncate(userText, 2000),
      turnContext,
      expectedBehavior,
      antiPatterns,
      gradingChecklist: buildGradingChecklist(tp, session.score),
    });
  }

  const avgWords = turns.reduce((sum, t) =>
    sum + t.userMessage.split(/\s+/).length, 0) / Math.max(turns.length, 1);
  const avgTechDensity = turns.reduce((sum, t) =>
    sum + extractTechnicalDensity(t.userMessage), 0) / Math.max(turns.length, 1);

  return {
    id: `cog-${session.sessionId.slice(0, 8)}-${index}`,
    sourceSessionId: session.sessionId,
    title: truncate(session.title || `Session ${session.sessionId.slice(0, 8)}`, 100),
    category,
    turns,
    baselineScore: session.score.overall,
    baselineGrade: session.score.overallGrade,
    difficulty: classifyDifficulty(avgWords, avgTechDensity),
    foundations: identifyFoundations(session.score),
    tags: [category, session.score.overallGrade],
  };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Multi-Turn Test Runner (Step 3.2)                             */
/* ═══════════════════════════════════════════════════════════════ */

/**
 * Score a single response against a grading checklist.
 */
function scoreResponseAgainstChecklist(
  response: string,
  checklist: readonly GradingItem[],
): number {
  if (checklist.length === 0) return 50; // neutral

  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const item of checklist) {
    let passed = false;
    switch (item.strategy) {
      case 'contains':
        passed = response.toLowerCase().includes(item.value.toLowerCase());
        break;
      case 'regex':
        try {
          passed = new RegExp(item.value, 'i').test(response);
        } catch {
          passed = false;
        }
        break;
      case 'checklist':
        if (item.value.startsWith('length>')) {
          const minLen = parseInt(item.value.replace('length>', ''), 10);
          passed = response.length > minLen;
        }
        break;
    }
    totalWeightedScore += (passed ? 100 : 0) * item.weight;
    totalWeight += item.weight;
  }

  return totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 50;
}

/**
 * Run a multi-turn test on a scenario using a model adapter.
 */
export async function runMultiTurn(
  scenario: ConversationScenario,
  adapter: ModelAdapter,
  options?: { injectLessons?: readonly CognitiveLesson[] },
): Promise<MultiTurnResult> {
  const lessons = options?.injectLessons ?? [];
  let context = '';

  if (lessons.length > 0) {
    const lessonContext = lessons
      .map(l => `[${l.category}] ${l.summary}`)
      .join('\n');
    context = `Cognitive lessons from prior sessions:\n${lessonContext}\n\n`;
  }

  const perTurnScores: number[] = [];

  for (const turn of scenario.turns) {
    const prompt = context + `User: ${turn.userMessage}`;
    const response = await Promise.race([
      adapter.generate(prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Adapter timeout after ${ADAPTER_TIMEOUT_MS}ms`)), ADAPTER_TIMEOUT_MS),
      ),
    ]);
    const turnScore = scoreResponseAgainstChecklist(response, turn.gradingChecklist);
    perTurnScores.push(turnScore);

    // Accumulate ACTUAL response (not expected)
    context += `User: ${turn.userMessage}\nAssistant: ${response}\n`;

    // Evict oldest turns if context is too long
    if (context.length > MAX_CONTEXT_CHARS) {
      const lines = context.split('\n');
      const half = Math.floor(lines.length / 2);
      context = lines.slice(half).join('\n');
    }
  }

  const overallScore = perTurnScores.length > 0
    ? Math.round(perTurnScores.reduce((s, v) => s + v, 0) / perTurnScores.length)
    : 0;

  return {
    scenarioId: scenario.id,
    perTurnScores,
    overallScore,
    overallGrade: computeGrade(overallScore / 100),
    totalTurns: scenario.turns.length,
    injectedLessonCount: lessons.length,
  };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Regression Testing (Step 3.3)                                 */
/* ═══════════════════════════════════════════════════════════════ */

/**
 * Compare multi-turn test results against scenario baselines.
 */
export function computeRegression(
  scenarios: readonly ConversationScenario[],
  results: readonly MultiTurnResult[],
): RegressionResult[] {
  const resultMap = new Map(results.map(r => [r.scenarioId, r]));

  return scenarios.map(scenario => {
    const result = resultMap.get(scenario.id);
    if (!result) {
      return {
        scenarioId: scenario.id,
        baselineGrade: scenario.baselineGrade,
        newGrade: 'F',
        delta: -gradeToNumber(scenario.baselineGrade),
        perTurnDeltas: [],
        significantRegressions: ['No result produced'],
      };
    }

    const baselineNumeric = gradeToNumber(scenario.baselineGrade);
    const newNumeric = gradeToNumber(result.overallGrade);
    const delta = newNumeric - baselineNumeric;

    // Per-turn deltas: compare each turn against Session mean (not global baseline)
    // Since per-turn baselines don't exist in the schema, using session mean
    // identifies outlier turns rather than producing meaningless global diffs
    const sessionMean = result.perTurnScores.length > 0
      ? result.perTurnScores.reduce((a, b) => a + b, 0) / result.perTurnScores.length
      : 0;
    const perTurnDeltas = result.perTurnScores.map(s => Math.round(s - sessionMean));
    const significantRegressions = perTurnDeltas
      .map((d, i) => d < -15 ? `Turn ${i}: ${d} points below session mean` : null)
      .filter((s): s is string => s !== null);

    return {
      scenarioId: scenario.id,
      baselineGrade: scenario.baselineGrade,
      newGrade: result.overallGrade,
      delta,
      perTurnDeltas,
      significantRegressions,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════ */
/*  A/B Testing (Step 3.4)                                        */
/* ═══════════════════════════════════════════════════════════════ */

/**
 * Run A/B test: with vs without cognitive lessons.
 * Requires running each scenario TWICE with the same model.
 */
export async function runABTest(
  scenario: ConversationScenario,
  adapter: ModelAdapter,
  lessons: readonly CognitiveLesson[],
): Promise<ABTestResult> {
  // Filter lessons relevant to this scenario's foundations
  const relevant = lessons.filter(l =>
    l.foundationAlignment.some(f => scenario.foundations.includes(f))
  );

  // Control: no lessons
  const control = await runMultiTurn(scenario, adapter);
  // Treatment: with relevant lessons
  const treatment = await runMultiTurn(scenario, adapter, { injectLessons: relevant });

  const delta = treatment.overallScore - control.overallScore;
  let winner: ABTestResult['winner'] = 'tie';
  if (delta > AB_WIN_THRESHOLD) winner = 'treatment';
  else if (delta < -AB_WIN_THRESHOLD) winner = 'control';

  return {
    scenarioId: scenario.id,
    controlScore: control.overallScore,
    treatmentScore: treatment.overallScore,
    delta,
    injectedLessonIds: relevant.map(l => l.id),
    winner,
  };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Test Report Builder                                           */
/* ═══════════════════════════════════════════════════════════════ */

export function buildTestReport(
  scenarios: readonly ConversationScenario[],
  multiTurn: readonly MultiTurnResult[],
  regression: readonly RegressionResult[],
  abTests: readonly ABTestResult[],
): CognitiveTestReport {
  const totalScenarios = scenarios.length;
  const passed = multiTurn.filter(r => r.overallScore >= 60).length;
  const failed = totalScenarios - passed;
  const avgScore = multiTurn.length > 0
    ? Math.round(multiTurn.reduce((s, r) => s + r.overallScore, 0) / multiTurn.length)
    : 0;

  const regressionAvgDelta = regression.length > 0
    ? Math.round(regression.reduce((s, r) => s + r.delta, 0) / regression.length * 10) / 10
    : 0;
  const regressionSignificantCount = regression.filter(r =>
    r.significantRegressions.length > 0
  ).length;

  const wins = abTests.filter(r => r.winner === 'treatment').length;
  const abWinRate = abTests.length > 0 ? wins / abTests.length : 0;
  const abAvgDelta = abTests.length > 0
    ? Math.round(abTests.reduce((s, r) => s + r.delta, 0) / abTests.length * 10) / 10
    : 0;

  // Top contributing lessons: appear in winning A/B tests
  const lessonWins = new Map<string, number>();
  for (const ab of abTests.filter(r => r.winner === 'treatment')) {
    for (const id of ab.injectedLessonIds) {
      lessonWins.set(id, (lessonWins.get(id) ?? 0) + 1);
    }
  }
  const topContributingLessons = [...lessonWins.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  // Weak areas: foundations that appear in failed scenarios
  const weakFoundations = new Map<string, number>();
  for (const result of multiTurn.filter(r => r.overallScore < 60)) {
    const scenario = scenarios.find(s => s.id === result.scenarioId);
    if (scenario) {
      for (const f of scenario.foundations) {
        weakFoundations.set(f, (weakFoundations.get(f) ?? 0) + 1);
      }
    }
  }
  const weakAreas = [...weakFoundations.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([f]) => f);

  return {
    scenarios,
    multiTurnResults: multiTurn,
    regressionResults: regression,
    abTestResults: abTests,
    summary: {
      totalScenarios,
      passed,
      failed,
      avgScore,
      avgGrade: computeGrade(avgScore / 100),
      regressionAvgDelta,
      regressionSignificantCount,
      abWinRate: Math.round(abWinRate * 100) / 100,
      abAvgDelta,
      topContributingLessons,
      weakAreas,
    },
    testedAt: Date.now(),
  };
}
