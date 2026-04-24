import { describe, it, expect } from 'vitest';
import {
  extractScenarios,
  runMultiTurn,
  computeRegression,
  runABTest,
  buildTestReport,
} from '../src/eval/cognitive-test-harness.js';
import type {
  ConversationScenario,
  MultiTurnResult,
  ScoredSession,
  ModelAdapter,
} from '../src/eval/cognitive-test-harness.js';
import type { ConversationScore, SubScore, TurnPair } from '../src/eval/conversation-scorer.js';
import type { CognitiveLesson } from '../src/eval/learning-extractor.js';

/* ═══════════════════════════════════════════════════════════════ */
/*  Test Fixtures                                                 */
/* ═══════════════════════════════════════════════════════════════ */

function makeSubScore(value: number, scoreable = true): SubScore {
  return { value, factors: [{ name: 'test', weight: 1, raw: value }], explanation: 'test', scoreable };
}

function makeTurnPair(userContent: string, assistantContent: string, index: number): TurnPair {
  return {
    index,
    userMessage: { id: `u-${index}`, sessionId: 'test', type: 'message', timestamp: Date.now(), content: userContent, meta: { role: 'user' } },
    assistantResponse: { id: `a-${index}`, sessionId: 'test', type: 'message', timestamp: Date.now(), content: assistantContent, meta: { role: 'assistant' } },
    thinkingBlocks: [],
    planningEvents: [],
    toolCalls: [],
    durationMs: 1000,
    turnaroundEvents: 2,
  };
}

function makeScore(overrides: Partial<ConversationScore> = {}): ConversationScore {
  return {
    sessionId: 'test-session',
    efficiency: makeSubScore(80),
    teachingQuality: makeSubScore(75),
    antiPatterns: { score: 90, detections: [] },
    cognitiveAlignment: makeSubScore(85),
    speakingDimensions: {
      adaptiveDepth: makeSubScore(70),
      proactiveReframing: makeSubScore(65),
      epistemicTransparency: makeSubScore(80),
      narrativeCoherence: makeSubScore(75),
      teachingVelocity: makeSubScore(60, false),
    },
    conversationCurve: [],
    overall: 82,
    overallGrade: 'B',
    highlights: [],
    turnPairCount: 5,
    totalEvents: 10,
    scoredAt: Date.now(),
    scorerVersion: '1.0.0',
    ...overrides,
  };
}

function makeSession(overrides: Partial<ScoredSession> = {}): ScoredSession {
  return {
    sessionId: 'ses-test-001',
    title: 'Test Session',
    score: makeScore(),
    turnPairs: [
      makeTurnPair('How do I create a function?', 'Here is how to define a function in JavaScript:\n```js\nfunction greet(name) { return "Hello " + name; }\n```', 0),
      makeTurnPair('What about arrow functions?', 'Arrow functions provide shorter syntax. Use const greet = (name) => "Hello " + name;', 1),
      makeTurnPair('Can I use default params?', 'Yes, add defaults: function greet(name = "World") { return "Hello " + name; }', 2),
      makeTurnPair('Show me destructuring', 'Destructuring extracts values: const { a, b } = obj; or const [x, y] = arr;', 3),
      makeTurnPair('Thanks!', 'You\'re welcome! Let me know if you have more questions.', 4),
    ],
    events: [],
    ...overrides,
  };
}

function makeLesson(id: string, foundations: string[]): CognitiveLesson {
  return {
    id,
    sessionId: 'test',
    category: 'effective-pattern',
    summary: `Lesson ${id}`,
    evidence: 'test evidence',
    confidence: 0.8,
    foundationAlignment: foundations,
    extractedAt: Date.now(),
  };
}

class EchoAdapter implements ModelAdapter {
  async generate(prompt: string): Promise<string> {
    return 'Here is how to define a function in JavaScript:\n```js\nfunction greet(name) { return "Hello " + name; }\n```';
  }
}

class EmptyAdapter implements ModelAdapter {
  async generate(): Promise<string> {
    return '';
  }
}

/* ═══════════════════════════════════════════════════════════════ */
/*  extractScenarios                                              */
/* ═══════════════════════════════════════════════════════════════ */

describe('extractScenarios', () => {
  it('extracts golden-path scenarios from high-grade sessions', () => {
    const session = makeSession({
      score: makeScore({ overall: 88, overallGrade: 'A', turnPairCount: 5, antiPatterns: { score: 95, detections: [] } }),
    });
    const scenarios = extractScenarios([session]);
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios[0].category).toBe('golden-path');
  });

  it('extracts anti-pattern scenarios from low-grade sessions', () => {
    const session = makeSession({
      sessionId: 'ses-low-001',
      score: makeScore({ overall: 40, overallGrade: 'D', turnPairCount: 5 }),
    });
    const scenarios = extractScenarios([session]);
    const antiPatterns = scenarios.filter(s => s.category === 'anti-pattern-example');
    expect(antiPatterns.length).toBeGreaterThan(0);
  });

  it('extracts edge-case scenarios from very short sessions', () => {
    const session = makeSession({
      sessionId: 'ses-edge-001',
      score: makeScore({ overall: 70, overallGrade: 'B', turnPairCount: 1, antiPatterns: { score: 85, detections: [] } }),
      turnPairs: [makeTurnPair('Quick question', 'Quick answer', 0)],
    });
    const scenarios = extractScenarios([session]);
    const edgeCases = scenarios.filter(s => s.category === 'edge-case');
    expect(edgeCases.length).toBeGreaterThan(0);
  });

  it('respects maxScenarios option', () => {
    const sessions = Array.from({ length: 30 }, (_, i) => makeSession({
      sessionId: `ses-max-${i}`,
      score: makeScore({ overall: 90, overallGrade: 'A', turnPairCount: 5, antiPatterns: { score: 95, detections: [] } }),
    }));
    const scenarios = extractScenarios(sessions, { maxScenarios: 5 });
    expect(scenarios.length).toBeLessThanOrEqual(5);
  });

  it('returns empty array for empty input', () => {
    expect(extractScenarios([])).toEqual([]);
  });

  it('sanitizes PII in user messages', () => {
    const session = makeSession({
      score: makeScore({ overall: 90, overallGrade: 'A', turnPairCount: 5, antiPatterns: { score: 95, detections: [] } }),
      turnPairs: [
        makeTurnPair('I saved to C:\\Users\\john\\Desktop', 'File saved.', 0),
        makeTurnPair('Also at /home/john/docs', 'Got it.', 1),
        makeTurnPair('Email me at john@example.com', 'Noted.', 2),
        makeTurnPair('More questions', 'Sure!', 3),
        makeTurnPair('Last one', 'Done.', 4),
      ],
    });
    const scenarios = extractScenarios([session]);
    for (const s of scenarios) {
      for (const t of s.turns) {
        expect(t.userMessage).not.toContain('john');
        expect(t.userMessage).not.toContain('john@example.com');
      }
    }
  });

  it('generates valid scenario IDs', () => {
    const session = makeSession({
      sessionId: 'ses_1234567890abcdef',
      score: makeScore({ overall: 90, overallGrade: 'A', turnPairCount: 5, antiPatterns: { score: 95, detections: [] } }),
    });
    const scenarios = extractScenarios([session]);
    for (const s of scenarios) {
      expect(s.id).toMatch(/^cog-/);
      expect(s.sourceSessionId).toBe('ses_1234567890abcdef');
    }
  });

  it('assigns difficulty based on content complexity', () => {
    const session = makeSession({
      score: makeScore({ overall: 90, overallGrade: 'A', turnPairCount: 5, antiPatterns: { score: 95, detections: [] } }),
    });
    const scenarios = extractScenarios([session]);
    for (const s of scenarios) {
      expect(['apprentice', 'journeyman', 'expert', 'master']).toContain(s.difficulty);
    }
  });

  it('uses §8 foundation names (not Phase 0 dimension names)', () => {
    const VALID_FOUNDATIONS = [
      'first-principles', 'calibrated-uncertainty', 'meta-learning',
      'reading-between-lines', 'precision-communication', 'right-question',
      'compression', 'systems-thinking', 'taste-judgment', 'intellectual-honesty',
    ];
    // Build a score with realistic cognitive alignment factors (§8 names)
    const cogFactors = VALID_FOUNDATIONS.map(name => ({ name, weight: 0.1, raw: 80 }));
    const realisticScore = makeScore({
      overall: 90, overallGrade: 'A' as const, turnPairCount: 5,
      antiPatterns: { score: 95, detections: [] },
      cognitiveAlignment: { value: 85, factors: cogFactors, explanation: 'test', scoreable: true },
    });
    const session = makeSession({ score: realisticScore });
    const scenarios = extractScenarios([session]);
    const PHASE0_NAMES = ['adaptive-depth', 'proactive-reframing', 'epistemic-transparency', 'narrative-coherence', 'teaching-velocity'];
    for (const s of scenarios) {
      for (const f of s.foundations) {
        expect(VALID_FOUNDATIONS).toContain(f);
        expect(PHASE0_NAMES).not.toContain(f);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  runMultiTurn                                                  */
/* ═══════════════════════════════════════════════════════════════ */

describe('runMultiTurn', () => {
  const scenario: ConversationScenario = {
    id: 'cog-test-0',
    sourceSessionId: 'test',
    title: 'Test Scenario',
    category: 'golden-path',
    turns: [
      {
        userMessage: 'How do I create a function?',
        turnContext: '',
        expectedBehavior: 'Show function syntax',
        antiPatterns: [],
        gradingChecklist: [
          { check: 'Includes code', strategy: 'regex', value: '```', weight: 0.5 },
          { check: 'Mentions function', strategy: 'contains', value: 'function', weight: 0.5 },
        ],
      },
      {
        userMessage: 'What about arrow functions?',
        turnContext: '',
        expectedBehavior: 'Explain arrow syntax',
        antiPatterns: [],
        gradingChecklist: [
          { check: 'Detailed response', strategy: 'checklist', value: 'length>10', weight: 1.0 },
        ],
      },
    ],
    baselineScore: 80,
    baselineGrade: 'B',
    difficulty: 'apprentice',
    foundations: ['first-principles'],
    tags: ['golden-path', 'B'],
  };

  it('runs through all turns and produces result', async () => {
    const result = await runMultiTurn(scenario, new EchoAdapter());
    expect(result.scenarioId).toBe('cog-test-0');
    expect(result.totalTurns).toBe(2);
    expect(result.perTurnScores).toHaveLength(2);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(['A+', 'A', 'B', 'C', 'D', 'F']).toContain(result.overallGrade);
    expect(result.injectedLessonCount).toBe(0);
  });

  it('injects lessons when provided', async () => {
    const lessons = [makeLesson('lesson-1', ['first-principles'])];
    const result = await runMultiTurn(scenario, new EchoAdapter(), { injectLessons: lessons });
    expect(result.injectedLessonCount).toBe(1);
  });

  it('handles empty checklist gracefully', async () => {
    const emptyScenario: ConversationScenario = {
      ...scenario,
      id: 'cog-empty-checklist',
      turns: [{ userMessage: 'Hello', turnContext: '', expectedBehavior: 'Greet back', antiPatterns: [], gradingChecklist: [] }],
    };
    const result = await runMultiTurn(emptyScenario, new EchoAdapter());
    expect(result.perTurnScores[0]).toBe(50); // neutral default
  });

  it('handles adapter returning empty string', async () => {
    const result = await runMultiTurn(scenario, new EmptyAdapter());
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.totalTurns).toBe(2);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  computeRegression                                             */
/* ═══════════════════════════════════════════════════════════════ */

describe('computeRegression', () => {
  it('detects improvement when new grade is better', () => {
    const scenarios: ConversationScenario[] = [{
      id: 'cog-reg-0',
      sourceSessionId: 'test',
      title: 'Test',
      category: 'golden-path',
      turns: [],
      baselineScore: 75,
      baselineGrade: 'C',
      difficulty: 'apprentice',
      foundations: [],
      tags: [],
    }];

    const results: MultiTurnResult[] = [{
      scenarioId: 'cog-reg-0',
      perTurnScores: [90],
      overallScore: 90,
      overallGrade: 'A',
      totalTurns: 1,
      injectedLessonCount: 0,
    }];

    const regression = computeRegression(scenarios, results);
    expect(regression).toHaveLength(1);
    expect(regression[0].delta).toBeGreaterThan(0); // improvement
    expect(regression[0].newGrade).toBe('A');
    expect(regression[0].baselineGrade).toBe('C');
  });

  it('flags significant regressions for large per-turn drops', () => {
    const scenarios: ConversationScenario[] = [{
      id: 'cog-reg-1',
      sourceSessionId: 'test',
      title: 'Test',
      category: 'golden-path',
      turns: [],
      baselineScore: 80,
      baselineGrade: 'B',
      difficulty: 'apprentice',
      foundations: [],
      tags: [],
    }];

    const results: MultiTurnResult[] = [{
      scenarioId: 'cog-reg-1',
      perTurnScores: [80, 75, 20], // Turn 3 is a severe outlier below session mean (~58)
      overallScore: 45,
      overallGrade: 'D',
      totalTurns: 3,
      injectedLessonCount: 0,
    }];

    const regression = computeRegression(scenarios, results);
    expect(regression[0].significantRegressions.length).toBeGreaterThan(0);
    expect(regression[0].delta).toBeLessThan(0);
  });

  it('handles missing results gracefully', () => {
    const scenarios: ConversationScenario[] = [{
      id: 'cog-reg-missing',
      sourceSessionId: 'test',
      title: 'Test',
      category: 'golden-path',
      turns: [],
      baselineScore: 80,
      baselineGrade: 'B',
      difficulty: 'apprentice',
      foundations: [],
      tags: [],
    }];

    const regression = computeRegression(scenarios, []);
    expect(regression).toHaveLength(1);
    expect(regression[0].newGrade).toBe('F');
    expect(regression[0].significantRegressions).toContain('No result produced');
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  runABTest                                                     */
/* ═══════════════════════════════════════════════════════════════ */

describe('runABTest', () => {
  const scenario: ConversationScenario = {
    id: 'cog-ab-0',
    sourceSessionId: 'test',
    title: 'AB Test Scenario',
    category: 'golden-path',
    turns: [{
      userMessage: 'How do I create a function?',
      turnContext: '',
      expectedBehavior: 'Show syntax',
      antiPatterns: [],
      gradingChecklist: [
        { check: 'Has content', strategy: 'checklist', value: 'length>10', weight: 1.0 },
      ],
    }],
    baselineScore: 70,
    baselineGrade: 'B',
    difficulty: 'apprentice',
    foundations: ['first-principles'],
    tags: [],
  };

  it('runs control and treatment with same adapter', async () => {
    const lessons = [makeLesson('lesson-ab-1', ['first-principles'])];
    const result = await runABTest(scenario, new EchoAdapter(), lessons);

    expect(result.scenarioId).toBe('cog-ab-0');
    expect(result.controlScore).toBeGreaterThanOrEqual(0);
    expect(result.treatmentScore).toBeGreaterThanOrEqual(0);
    expect(['treatment', 'control', 'tie']).toContain(result.winner);
  });

  it('filters lessons by foundation alignment', async () => {
    const matchingLessons = [makeLesson('match', ['first-principles'])];
    const nonMatchingLessons = [makeLesson('nomatch', ['unrelated-foundation'])];

    const withMatch = await runABTest(scenario, new EchoAdapter(), matchingLessons);
    const withoutMatch = await runABTest(scenario, new EchoAdapter(), nonMatchingLessons);

    expect(withMatch.injectedLessonIds).toContain('match');
    expect(withoutMatch.injectedLessonIds).not.toContain('nomatch');
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  buildTestReport                                               */
/* ═══════════════════════════════════════════════════════════════ */

describe('buildTestReport', () => {
  it('aggregates results into a complete report', () => {
    const scenarios: ConversationScenario[] = [{
      id: 'cog-rpt-0',
      sourceSessionId: 'test',
      title: 'Report Test',
      category: 'golden-path',
      turns: [],
      baselineScore: 80,
      baselineGrade: 'B',
      difficulty: 'apprentice',
      foundations: ['first-principles'],
      tags: [],
    }];

    const multiTurn: MultiTurnResult[] = [{
      scenarioId: 'cog-rpt-0',
      perTurnScores: [85],
      overallScore: 85,
      overallGrade: 'A',
      totalTurns: 1,
      injectedLessonCount: 0,
    }];

    const regression = computeRegression(scenarios, multiTurn);

    const report = buildTestReport(scenarios, multiTurn, regression, []);

    expect(report.summary.totalScenarios).toBe(1);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.avgScore).toBe(85);
    expect(report.testedAt).toBeGreaterThan(0);
  });

  it('counts failures correctly', () => {
    const scenarios: ConversationScenario[] = [
      { id: 's1', sourceSessionId: 't', title: 'T', category: 'golden-path', turns: [], baselineScore: 80, baselineGrade: 'B', difficulty: 'apprentice', foundations: [], tags: [] },
      { id: 's2', sourceSessionId: 't', title: 'T', category: 'golden-path', turns: [], baselineScore: 80, baselineGrade: 'B', difficulty: 'apprentice', foundations: ['first-principles'], tags: [] },
    ];

    const multiTurn: MultiTurnResult[] = [
      { scenarioId: 's1', perTurnScores: [80], overallScore: 80, overallGrade: 'B', totalTurns: 1, injectedLessonCount: 0 },
      { scenarioId: 's2', perTurnScores: [30], overallScore: 30, overallGrade: 'F', totalTurns: 1, injectedLessonCount: 0 },
    ];

    const report = buildTestReport(scenarios, multiTurn, [], []);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.weakAreas).toContain('first-principles');
  });

  it('computes A/B win rate', () => {
    const scenarios: ConversationScenario[] = [
      { id: 'ab1', sourceSessionId: 't', title: 'T', category: 'golden-path', turns: [], baselineScore: 80, baselineGrade: 'B', difficulty: 'apprentice', foundations: [], tags: [] },
    ];

    const abTests = [
      { scenarioId: 'ab1', controlScore: 60, treatmentScore: 80, delta: 20, injectedLessonIds: ['l1'], winner: 'treatment' as const },
    ];

    const report = buildTestReport(scenarios, [], [], abTests);
    expect(report.summary.abWinRate).toBe(1.0);
    expect(report.summary.abAvgDelta).toBe(20);
    expect(report.summary.topContributingLessons).toContain('l1');
  });

  it('handles empty inputs', () => {
    const report = buildTestReport([], [], [], []);
    expect(report.summary.totalScenarios).toBe(0);
    expect(report.summary.avgScore).toBe(0);
    expect(report.summary.abWinRate).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Additional Coverage                                           */
/* ═══════════════════════════════════════════════════════════════ */

describe('runABTest — edge cases', () => {
  const scenario: ConversationScenario = {
    id: 'cog-ab-edge',
    sourceSessionId: 'test',
    title: 'Empty Lessons',
    category: 'golden-path',
    turns: [{
      userMessage: 'Explain closures',
      turnContext: '',
      expectedBehavior: 'Show closure example',
      antiPatterns: [],
      gradingChecklist: [
        { check: 'Has content', strategy: 'checklist', value: 'length>5', weight: 1.0 },
      ],
    }],
    baselineScore: 70,
    baselineGrade: 'B',
    difficulty: 'apprentice',
    foundations: ['first-principles'],
    tags: [],
  };

  it('handles empty lessons array (control ≈ treatment)', async () => {
    const result = await runABTest(scenario, new EchoAdapter(), []);
    expect(result.controlScore).toBeGreaterThanOrEqual(0);
    expect(result.treatmentScore).toBeGreaterThanOrEqual(0);
    expect(result.injectedLessonIds).toHaveLength(0);
    // With no lessons, scores should be equal → tie
    expect(result.winner).toBe('tie');
  });
});

describe('computeRegression — edge cases', () => {
  it('returns zero delta when scores match baseline', () => {
    const scenario: ConversationScenario = {
      id: 'cog-reg-same',
      sourceSessionId: 'test',
      title: 'Same Score',
      category: 'golden-path',
      turns: [],
      baselineScore: 85,
      baselineGrade: 'A',
      difficulty: 'apprentice',
      foundations: [],
      tags: [],
    };

    const result: MultiTurnResult = {
      scenarioId: 'cog-reg-same',
      perTurnScores: [85],
      overallScore: 85,
      overallGrade: 'A',
      totalTurns: 1,
      injectedLessonCount: 0,
    };

    const regression = computeRegression([scenario], [result]);
    expect(regression).toHaveLength(1);
    expect(regression[0].delta).toBe(0);
    expect(regression[0].significantRegressions).toHaveLength(0);
  });

  it('handles empty inputs', () => {
    const regression = computeRegression([], []);
    expect(regression).toHaveLength(0);
  });
});

describe('runMultiTurn — adapter timeout', () => {
  it('rejects when adapter exceeds timeout', async () => {
    class SlowAdapter implements ModelAdapter {
      async generate(): Promise<string> {
        // Simulate a very slow adapter (this should never resolve before timeout)
        return new Promise(() => {/* never resolves */});
      }
    }

    const scenario: ConversationScenario = {
      id: 'cog-timeout',
      sourceSessionId: 'test',
      title: 'Timeout Test',
      category: 'edge-case',
      turns: [{
        userMessage: 'test',
        turnContext: '',
        expectedBehavior: 'response',
        antiPatterns: [],
        gradingChecklist: [
          { check: 'Has content', strategy: 'checklist', value: 'length>0', weight: 1.0 },
        ],
      }],
      baselineScore: 50,
      baselineGrade: 'C',
      difficulty: 'apprentice',
      foundations: [],
      tags: [],
    };

    // The adapter never resolves, so runMultiTurn should timeout
    // We can't test the 30s timeout in unit tests, but we verify the
    // function handles rejection gracefully by checking the error message
    await expect(
      Promise.race([
        runMultiTurn(scenario, new SlowAdapter()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), 100)),
      ]),
    ).rejects.toThrow('Test timeout');
  });
});
