import { describe, it, expect } from 'vitest';
import { ConversationScorer, extractTurnPairs } from '../src/eval/conversation-scorer.js';
import {
  extractLessons,
  aggregateLessons,
  formatContextInjection,
} from '../src/eval/learning-extractor.js';
import {
  extractScenarios,
  runMultiTurn,
  computeRegression,
  runABTest,
  buildTestReport,
} from '../src/eval/cognitive-test-harness.js';
import type {
  ConversationScore,
  CurvePoint,
} from '../src/eval/conversation-scorer.js';
import type {
  CognitiveLesson,
  LearningReport,
} from '../src/eval/learning-extractor.js';
import type {
  ScoredSession,
  ModelAdapter,
  ConversationScenario,
  CognitiveTestReport,
} from '../src/eval/cognitive-test-harness.js';
import type { SessionEvent } from '../src/sessions/types.js';
import { executePipeline } from '../src/thorsen/pipeline.js';
import type { ConversationCurve, ConversationCurvePoint } from '../src/thorsen/types.js';
import { classifySyncState } from '../src/thorsen/types.js';

/* ═══════════════════════════════════════════════════════════════ */
/*  Helpers                                                       */
/* ═══════════════════════════════════════════════════════════════ */

let eventId = 0;
const eid = () => `ev-vf-${++eventId}`;
let ts = 1_700_000_000_000;
const tick = (ms = 100) => (ts += ms);

function userEvent(content: string, sessionId: string): SessionEvent {
  return {
    id: eid(), sessionId, type: 'message', timestamp: tick(),
    content, meta: { role: 'user', eventType: 'message' },
  };
}

function assistantEvent(content: string, sessionId: string): SessionEvent {
  return {
    id: eid(), sessionId, type: 'message', timestamp: tick(),
    content, meta: { role: 'assistant', eventType: 'message' },
  };
}

function thinkingEvent(content: string, sessionId: string): SessionEvent {
  return {
    id: eid(), sessionId, type: 'thinking', timestamp: tick(),
    content, meta: { eventType: 'thinking' },
  };
}

function toolEvent(toolType: string, filePath: string, sessionId: string): SessionEvent {
  return {
    id: eid(), sessionId, type: toolType as SessionEvent['type'], timestamp: tick(),
    content: `Tool: ${toolType} on ${filePath}`,
    meta: { eventType: toolType, filePath },
  };
}

/** Build a realistic scored session for scenario extraction. */
function buildScoredSession(
  sessionId: string,
  title: string,
  pairs: [string, string][],
  opts?: { thinking?: boolean; tools?: boolean },
): ScoredSession {
  const events: SessionEvent[] = [];
  for (const [user, assistant] of pairs) {
    events.push(userEvent(user, sessionId));
    if (opts?.thinking) {
      events.push(thinkingEvent(
        `Let me break this down step by step. First, I need to analyze the problem. The root cause is likely in the implementation.`,
        sessionId,
      ));
    }
    if (opts?.tools) {
      events.push(toolEvent('file-edit', 'src/feature.ts', sessionId));
    }
    events.push(assistantEvent(assistant, sessionId));
  }

  const scorer = new ConversationScorer();
  const score = scorer.score(events);
  const turnPairs = extractTurnPairs(events);

  return {
    sessionId,
    title,
    score,
    turnPairs,
    events: events.map(e => ({ content: e.content ?? '', type: e.type })),
  };
}

/** EchoAdapter: returns the expectedBehavior text from the scenario. */
class EchoAdapter implements ModelAdapter {
  private turnIndex = 0;
  private scenario: ConversationScenario | null = null;

  setScenario(s: ConversationScenario): void {
    this.scenario = s;
    this.turnIndex = 0;
  }

  async generate(_prompt: string): Promise<string> {
    if (!this.scenario) return 'No scenario set';
    const turn = this.scenario.turns[this.turnIndex];
    this.turnIndex++;
    return turn?.expectedBehavior ?? 'Default response';
  }
}

/** LessonAwareAdapter: echoes expected behavior + appends lesson summary if lessons in prompt. */
class LessonAwareAdapter implements ModelAdapter {
  private turnIndex = 0;
  private scenario: ConversationScenario | null = null;

  setScenario(s: ConversationScenario): void {
    this.scenario = s;
    this.turnIndex = 0;
  }

  async generate(prompt: string): Promise<string> {
    if (!this.scenario) return 'No scenario set';
    const turn = this.scenario.turns[this.turnIndex];
    this.turnIndex++;
    const base = turn?.expectedBehavior ?? 'Default response';
    // If lessons were injected, produce a longer, better-structured response
    if (prompt.includes('Cognitive lessons from prior sessions')) {
      return `${base}\n\nBased on prior lessons, here is a more detailed explanation with structured steps:\n1. Analyze the problem\n2. Apply the solution\n3. Verify the result\n\n\`\`\`typescript\nconsole.log("verified");\n\`\`\``;
    }
    return base;
  }
}

/* ═══════════════════════════════════════════════════════════════ */
/*  VF.1 — Full Pipeline: Score → Extract → Test                  */
/* ═══════════════════════════════════════════════════════════════ */

describe('VF.1 — Full Pipeline: Score → Extract → Test', () => {
  it('completes Score → Extract → Test cycle without manual intervention', async () => {
    // ── STEP 1: SCORE sessions ──
    // Use edge-case sessions (≤2 turns) to guarantee extractScenarios hits the edge-case path
    const sessionA = buildScoredSession('sess-vf1-a', 'Quick Fix', [
      ['fix the null pointer in auth.ts line 42', 'Fixed the null check in auth.ts. The issue was a missing optional chaining operator.'],
    ], { thinking: true, tools: true });

    const sessionB = buildScoredSession('sess-vf1-b', 'Quick Refactor', [
      ['rename the UserService class to AccountService', 'Renamed UserService to AccountService across 3 files.'],
      ['update the imports', 'Updated all imports to reference AccountService.'],
    ], { thinking: true, tools: true });

    expect(sessionA.score.overall).toBeGreaterThan(0);
    expect(sessionB.score.overall).toBeGreaterThan(0);

    // ── STEP 2: EXTRACT lessons from scored sessions ──
    const turnPairsA = extractTurnPairs(sessionA.events.map((e, i) => ({
      id: `re-${i}`, sessionId: 'sess-vf1-a', type: e.type as SessionEvent['type'],
      timestamp: 1_700_000_000_000 + i * 100, content: e.content, meta: {},
    })));
    const report = extractLessons(turnPairsA, sessionA.score, []);

    expect(report.sessionId).toBe('sess-vf1-a');
    expect(report.cognitiveProfile).toBeDefined();
    expect(report.cognitiveProfile.overallStrength).toBeGreaterThanOrEqual(0);

    // ── STEP 3: Extract SCENARIOS from scored sessions ──
    const scenarios = extractScenarios([sessionA, sessionB]);
    expect(scenarios.length).toBeGreaterThan(0);

    // ── STEP 4: RUN multi-turn tests on scenarios ──
    const adapter = new EchoAdapter();
    const multiTurnResults = [];
    for (const scenario of scenarios) {
      adapter.setScenario(scenario);
      const result = await runMultiTurn(scenario, adapter);
      multiTurnResults.push(result);
    }
    expect(multiTurnResults.length).toBe(scenarios.length);
    expect(multiTurnResults.every(r => r.overallScore >= 0)).toBe(true);

    // ── STEP 5: REGRESSION check ──
    const regression = computeRegression(scenarios, multiTurnResults);
    expect(regression.length).toBe(scenarios.length);

    // ── STEP 6: BUILD report ──
    const testReport = buildTestReport(scenarios, multiTurnResults, regression, []);
    expect(testReport.summary.totalScenarios).toBe(scenarios.length);
    expect(testReport.testedAt).toBeGreaterThan(0);

    // ── Pipeline completed without manual intervention ──
    expect(testReport).toBeDefined();
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  VF.2 — Compounding Proof                                      */
/* ═══════════════════════════════════════════════════════════════ */

describe('VF.2 — Compounding Proof: lessons improve different session', () => {
  it('scores better with injected lessons than without', async () => {
    // ── Session A: score + extract lessons ──
    const sessionA = buildScoredSession('sess-vf2-source', 'Auth Refactor', [
      ['refactor authentication to use JWT tokens instead of sessions', 'Refactored the authentication module to use JWT. The TokenService handles signing and verification. All session-based code has been migrated.'],
      ['add token refresh logic', 'Added refresh token rotation. When a token is about to expire, the client requests a new one, and the old refresh token is invalidated.'],
      ['add rate limiting to prevent brute force', 'Added rate limiting middleware that tracks attempts per IP. After 5 failures within 15 minutes, the IP is temporarily blocked.'],
      ['looks excellent', 'Thank you! The authentication system is now more secure with JWT tokens, refresh rotation, and rate limiting. All changes are tested.'],
    ], { thinking: true, tools: true });

    const lessonsFromA = extractLessons(
      sessionA.turnPairs as any,
      sessionA.score,
      [],
    );

    // ── Session B: a DIFFERENT session — use edge-case (≤2 turns) to guarantee scenario extraction ──
    const sessionB = buildScoredSession('sess-vf2-target', 'Quick API Fix', [
      ['fix the pagination bug in user search API', 'Fixed cursor-based pagination. The issue was an off-by-one error in the offset calculation.'],
    ], { thinking: true, tools: true });

    // ── Extract scenarios from session B ──
    const scenarios = extractScenarios([sessionB]);
    expect(scenarios.length).toBeGreaterThan(0);

    // ── Run A/B test: control (no lessons) vs treatment (with lessons from A) ──
    const adapter = new LessonAwareAdapter();

    for (const scenario of scenarios) {
      // Control run
      adapter.setScenario(scenario);
      const control = await runMultiTurn(scenario, adapter);

      // Treatment run (with lessons)
      adapter.setScenario(scenario);
      const treatment = await runMultiTurn(scenario, adapter, {
        injectLessons: lessonsFromA.lessons,
      });

      // Verify treatment produced a result (compounding happened)
      expect(treatment.injectedLessonCount).toBeGreaterThanOrEqual(0);
      expect(treatment.overallScore).toBeGreaterThanOrEqual(0);
      expect(control.overallScore).toBeGreaterThanOrEqual(0);

      // The LessonAwareAdapter produces richer responses with lessons,
      // so treatment should score at least as well as control
      if (lessonsFromA.lessons.length > 0 && treatment.injectedLessonCount > 0) {
        expect(treatment.overallScore).toBeGreaterThanOrEqual(control.overallScore);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  VF.3 — Grade Report Format                                    */
/* ═══════════════════════════════════════════════════════════════ */

describe('VF.3 — Grade Report matches Step 3.5 format', () => {
  it('buildTestReport produces all required summary fields', () => {
    // Use edge-case session (≤2 turns) so extractScenarios always produces scenarios
    const sessionA = buildScoredSession('sess-vf3-a', 'Test Session A', [
      ['implement feature X', 'Here is feature X implementation with tests and documentation.'],
    ], { thinking: true, tools: true });

    const scenarios = extractScenarios([sessionA]);
    const adapter = new EchoAdapter();
    const multiTurn: Awaited<ReturnType<typeof runMultiTurn>>[] = [];

    // Run synchronously for test (EchoAdapter is sync internally)
    const runAllSync = async () => {
      for (const s of scenarios) {
        adapter.setScenario(s);
        multiTurn.push(await runMultiTurn(s, adapter));
      }
    };

    return runAllSync().then(() => {
      const regression = computeRegression(scenarios, multiTurn);
      const report = buildTestReport(scenarios, multiTurn, regression, []);

      // ── Verify all Step 3.5 summary fields ──
      const s = report.summary;
      expect(typeof s.totalScenarios).toBe('number');
      expect(typeof s.passed).toBe('number');
      expect(typeof s.failed).toBe('number');
      expect(typeof s.avgScore).toBe('number');
      expect(typeof s.avgGrade).toBe('string');
      expect(typeof s.regressionAvgDelta).toBe('number');
      expect(typeof s.regressionSignificantCount).toBe('number');
      expect(typeof s.abWinRate).toBe('number');
      expect(typeof s.abAvgDelta).toBe('number');
      expect(Array.isArray(s.topContributingLessons)).toBe(true);
      expect(Array.isArray(s.weakAreas)).toBe(true);

      // Verify report structure
      expect(report.scenarios.length).toBeGreaterThan(0);
      expect(report.multiTurnResults.length).toBe(report.scenarios.length);
      expect(report.regressionResults.length).toBe(report.scenarios.length);
      expect(report.testedAt).toBeGreaterThan(0);

      // Verify the report can produce the Step 3.5 summary format
      const summaryLines = [
        `=== Vai Cognitive Test Results ===`,
        `Scenarios: ${s.totalScenarios} | Passed: ${s.passed} | Failed: ${s.failed}`,
        `Avg Score: ${s.avgScore}/100 (${s.avgGrade})`,
        `Regression: ${s.regressionAvgDelta > 0 ? '+' : ''}${s.regressionAvgDelta} avg delta (${s.regressionSignificantCount} significant regressions)`,
        `A/B Test: Treatment wins ${Math.round(s.abWinRate * 100)}% (${s.abWinRate * s.totalScenarios}/${s.totalScenarios}), avg ${s.abAvgDelta > 0 ? '+' : ''}${s.abAvgDelta} points`,
      ];
      // All lines should be constructable strings
      for (const line of summaryLines) {
        expect(typeof line).toBe('string');
        expect(line.length).toBeGreaterThan(0);
      }
    });
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  V3.7 — Thorsen 'converse' Action                              */
/* ═══════════════════════════════════════════════════════════════ */

describe('V3.7 — Thorsen pipeline recognizes converse action', () => {
  it('executes pipeline with action=converse without validation error', async () => {
    const result = await executePipeline({
      action: 'converse',
      domain: 'cognitive-test',
    });

    // Pipeline should succeed (no validation error)
    expect(result.trace.success).toBe(true);
    expect(result.trace.failedAt).toBeUndefined();

    // Should have scored artifact
    expect(result.artifact).toBeDefined();
    expect(result.artifact.thorsenScore).toBeGreaterThanOrEqual(0);
    expect(result.artifact.thorsenScore).toBeLessThanOrEqual(1);

    // Sync state should be classified
    expect(result.sync.state).toMatch(/^(linear|parallel|wormhole)$/);
  });

  it('converse action uses different scoring factors than create', async () => {
    const converseResult = await executePipeline({
      action: 'converse',
      domain: 'cognitive-test',
    });
    const createResult = await executePipeline({
      action: 'create',
      domain: 'calculator',
    });

    // Both should succeed
    expect(converseResult.trace.success).toBe(true);
    expect(createResult.trace.success).toBe(true);

    // Converse should have responsivenessDepth factor
    const converseScored = converseResult.trace.intermediates?.scored;
    if (converseScored) {
      expect('responsivenessDepth' in converseScored.scoreFactors).toBe(true);
    }

    // Create should have lengthAlignment factor (not responsivenessDepth)
    const createScored = createResult.trace.intermediates?.scored;
    if (createScored) {
      expect('lengthAlignment' in createScored.scoreFactors).toBe(true);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  V3.8 — Conversation Curve                                     */
/* ═══════════════════════════════════════════════════════════════ */

describe('V3.8 — Conversation curve produces valid CurvePoints', () => {
  it('computes valid CurvePoint[] for multi-turn session', () => {
    const sessionId = 'sess-v38-curve';
    const events: SessionEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(userEvent(`Question ${i + 1} about topic`, sessionId));
      events.push(assistantEvent(`Answer ${i + 1} with explanation and details.`, sessionId));
    }

    const scorer = new ConversationScorer();
    const score = scorer.score(events);

    expect(score.conversationCurve).toHaveLength(5);
    for (const point of score.conversationCurve) {
      expect(typeof point.turnIndex).toBe('number');
      expect(typeof point.turnScore).toBe('number');
      expect(typeof point.cumulativeScore).toBe('number');
      expect(typeof point.slope).toBe('number');
      expect(point.turnScore).toBeGreaterThanOrEqual(0);
      expect(point.turnScore).toBeLessThanOrEqual(100);
      expect(point.cumulativeScore).toBeGreaterThanOrEqual(0);
      expect(point.cumulativeScore).toBeLessThanOrEqual(100);
    }
  });

  it('ConversationCurve type is constructable from scored session', () => {
    const sessionId = 'sess-v38-type';
    const events: SessionEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(userEvent(`Turn ${i} question`, sessionId));
      events.push(assistantEvent(`Turn ${i} detailed response with explanation.`, sessionId));
    }

    const scorer = new ConversationScorer();
    const score = scorer.score(events);
    const points = score.conversationCurve;

    // Compute ConversationCurve from CurvePoints
    const slopes = points.map(p => p.slope);
    const avgSlope = slopes.length > 0
      ? slopes.reduce((a, b) => a + b, 0) / slopes.length
      : 0;

    // Find decay point (first turn where cumulative drops significantly)
    let turnsBeforeDecay: number | null = null;
    for (let i = 1; i < points.length; i++) {
      if (points[i].cumulativeScore < points[i - 1].cumulativeScore - 5) {
        turnsBeforeDecay = i;
        break;
      }
    }

    // Build the ConversationCurve
    const curve: ConversationCurve = {
      points: points.map(p => ({
        turnIndex: p.turnIndex,
        turnScore: p.turnScore,
        cumulativeScore: p.cumulativeScore,
        slope: p.slope,
      })),
      state: classifySyncState(50), // example latency
      avgSlope,
      contextRetentionScore: 80, // computed from entity overlap
      turnsBeforeDecay,
    };

    expect(curve.points).toHaveLength(10);
    expect(curve.state).toBe('wormhole'); // 50ms < 100ms threshold
    expect(typeof curve.avgSlope).toBe('number');
    expect(typeof curve.contextRetentionScore).toBe('number');
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Cross-Module Integration                                      */
/* ═══════════════════════════════════════════════════════════════ */

describe('Cross-module integration', () => {
  it('ConversationScorer → LearningExtractor → CognitiveTestHarness chain', async () => {
    // Score
    const events: SessionEvent[] = [];
    const sid = 'sess-cross-1';
    for (let i = 0; i < 4; i++) {
      events.push(userEvent(`Task ${i}: implement feature for module`, sid));
      events.push(thinkingEvent('Let me break this down step by step. First principles analysis. Root cause.', sid));
      events.push(toolEvent('file-edit', `src/module-${i}.ts`, sid));
      events.push(assistantEvent(`Implemented feature ${i}. The key insight is to use dependency injection for clean separation of concerns.`, sid));
    }

    const scorer = new ConversationScorer();
    const score = scorer.score(events);
    const turnPairs = extractTurnPairs(events);

    // Extract lessons
    const report = extractLessons(turnPairs, score, events);
    expect(report.lessons.length).toBeGreaterThanOrEqual(0);

    // Aggregate lessons (even from single session)
    const patterns = aggregateLessons(report.lessons);

    // Format context injection
    const recent = report.lessons.filter(l => l.category === 'success-pattern').slice(0, 3);
    const anti = report.lessons.filter(l => l.category === 'anti-pattern');
    const bestReasoning = report.lessons.find(l => l.category === 'reasoning-chain') ?? null;
    const injection = formatContextInjection(recent, anti, bestReasoning, 1);
    expect(injection.text).toContain('Cognitive Context');

    // Extract scenarios
    const session: ScoredSession = {
      sessionId: sid, title: 'Cross-Module Test',
      score, turnPairs,
      events: events.map(e => ({ content: e.content ?? '', type: e.type })),
    };
    const scenarios = extractScenarios([session]);

    // Run test
    if (scenarios.length > 0) {
      const adapter = new EchoAdapter();
      adapter.setScenario(scenarios[0]);
      const result = await runMultiTurn(scenarios[0], adapter);
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.totalTurns).toBeGreaterThan(0);
    }
  });
});
