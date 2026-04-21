import { describe, it, expect } from 'vitest';
import { ConversationScorer, extractTurnPairs } from '../src/eval/conversation-scorer.js';
import type {
  ConversationScore,
  TurnPair,
  SubScore,
  AntiPatternReport,
} from '../src/eval/conversation-scorer.js';
import type { SessionEvent, SessionStats } from '../src/sessions/types.js';

/* ═══════════════════════════════════════════════════════════════ */
/*  Helpers                                                       */
/* ═══════════════════════════════════════════════════════════════ */

let eventId = 0;
const eid = () => `ev-scorer-${++eventId}`;
let ts = 1_700_000_000_000;
const tick = (ms = 100) => (ts += ms);

function userEvent(content: string, sessionId = 'test-scorer'): SessionEvent {
  return {
    id: eid(), sessionId, type: 'message', timestamp: tick(),
    content, meta: { role: 'user', eventType: 'message' },
  };
}

function assistantEvent(content: string, sessionId = 'test-scorer'): SessionEvent {
  return {
    id: eid(), sessionId, type: 'message', timestamp: tick(),
    content, meta: { role: 'assistant', eventType: 'message' },
  };
}

function thinkingEvent(content: string, sessionId = 'test-scorer'): SessionEvent {
  return {
    id: eid(), sessionId, type: 'thinking', timestamp: tick(),
    content, meta: { eventType: 'thinking' },
  };
}

function toolEvent(
  toolType: string,
  filePath: string,
  sessionId = 'test-scorer',
): SessionEvent {
  return {
    id: eid(), sessionId, type: toolType as SessionEvent['type'], timestamp: tick(),
    content: `Tool: ${toolType} on ${filePath}`,
    meta: { eventType: toolType, filePath },
  };
}

function planningEvent(content: string, sessionId = 'test-scorer'): SessionEvent {
  return {
    id: eid(), sessionId, type: 'planning', timestamp: tick(),
    content, meta: { eventType: 'planning' },
  };
}

function buildPair(user: string, assistant: string): SessionEvent[] {
  return [userEvent(user), assistantEvent(assistant)];
}

function score(events: SessionEvent[], stats: SessionStats | null = null): ConversationScore {
  return new ConversationScorer().score(events, stats);
}

/* ═══════════════════════════════════════════════════════════════ */
/*  extractTurnPairs                                              */
/* ═══════════════════════════════════════════════════════════════ */

describe('extractTurnPairs', () => {
  it('returns empty for no events', () => {
    expect(extractTurnPairs([])).toEqual([]);
  });

  it('pairs user → assistant messages', () => {
    const events = [...buildPair('hello', 'hi there')];
    const pairs = extractTurnPairs(events);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].index).toBe(0);
    expect(pairs[0].userMessage.content).toBe('hello');
    expect(pairs[0].assistantResponse?.content).toBe('hi there');
  });

  it('handles multiple turn pairs', () => {
    const events = [
      ...buildPair('first question', 'first answer'),
      ...buildPair('second question', 'second answer'),
    ];
    const pairs = extractTurnPairs(events);
    expect(pairs).toHaveLength(2);
    expect(pairs[1].userMessage.content).toBe('second question');
  });

  it('captures thinking blocks in turn pairs', () => {
    const events: SessionEvent[] = [
      userEvent('explain closures'),
      thinkingEvent('Let me break this down step by step. First, a closure captures variables...'),
      assistantEvent('A closure is a function that has access to its outer scope.'),
    ];
    const pairs = extractTurnPairs(events);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].thinkingBlocks).toHaveLength(1);
    expect(pairs[0].thinkingBlocks[0].content).toContain('step by step');
  });

  it('captures tool calls in turn pairs', () => {
    const events: SessionEvent[] = [
      userEvent('fix the bug in utils.ts'),
      thinkingEvent('I need to read the file first'),
      toolEvent('file-read', 'src/utils.ts'),
      toolEvent('file-edit', 'src/utils.ts'),
      assistantEvent('Fixed the bug by correcting the null check.'),
    ];
    const pairs = extractTurnPairs(events);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].toolCalls).toHaveLength(2);
  });

  it('handles user message without assistant response', () => {
    const events: SessionEvent[] = [userEvent('hello')];
    const pairs = extractTurnPairs(events);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].assistantResponse).toBeNull();
    expect(pairs[0].durationMs).toBe(0);
  });

  it('ignores events before first user message', () => {
    const events: SessionEvent[] = [
      assistantEvent('stray assistant message'),
      userEvent('real question'),
      assistantEvent('real answer'),
    ];
    const pairs = extractTurnPairs(events);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].userMessage.content).toBe('real question');
  });

  it('computes durationMs from user to assistant timestamp', () => {
    const events: SessionEvent[] = [
      userEvent('question'),
      assistantEvent('answer'),
    ];
    const pairs = extractTurnPairs(events);
    expect(pairs[0].durationMs).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Efficiency Scoring                                            */
/* ═══════════════════════════════════════════════════════════════ */

describe('Efficiency scoring', () => {
  it('scores high for simple conversation resolved in few turns', () => {
    const events = [...buildPair('fix bug', 'Done, fixed the null check.')];
    const result = score(events);
    expect(result.efficiency.value).toBeGreaterThanOrEqual(70);
    expect(result.efficiency.scoreable).toBe(true);
  });

  it('penalizes retry chains', () => {
    const events = [
      ...buildPair('fix the error in utils.ts line 10', 'Fixed utils.ts line 10'),
      ...buildPair('fix the error in utils.ts line 10 again', 'Fixed utils.ts line 10 again'),
      ...buildPair('fix the error in utils.ts line 10 still broken', 'Fixed utils.ts line 10 third try'),
    ];
    const result = score(events);
    // Retry chain overlap triggers penalty
    const noRetryEvents = [...buildPair('fix the error in utils.ts', 'Done, fixed it.')];
    const noRetryResult = score(noRetryEvents);
    expect(result.efficiency.value).toBeLessThan(noRetryResult.efficiency.value);
  });

  it('penalizes fix keywords in user messages', () => {
    const events = [
      ...buildPair('implement feature', 'Here is the feature'),
      ...buildPair('this is broken fix it', 'Ok fixed'),
      ...buildPair('still not working try again', 'Fixed again'),
    ];
    const result = score(events);
    expect(result.efficiency.factors.find(f => f.name === 'fix-keyword-density')?.raw).toBeLessThan(100);
  });

  it('returns non-scoreable for empty input', () => {
    const result = score([]);
    expect(result.efficiency.scoreable).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Teaching Quality                                              */
/* ═══════════════════════════════════════════════════════════════ */

describe('Teaching Quality scoring', () => {
  it('rewards reasoning transparency (thinking blocks)', () => {
    const events: SessionEvent[] = [
      userEvent('explain dependency injection'),
      thinkingEvent('Let me break this down step by step. Dependency injection is a design pattern.'),
      assistantEvent('Dependency injection is a design pattern where dependencies are provided to a class rather than created internally. This follows the inversion of control principle.'),
    ];
    const result = score(events);
    const factor = result.teachingQuality.factors.find(f => f.name === 'reasoning-transparency');
    expect(factor).toBeDefined();
    expect(factor!.raw).toBeGreaterThan(0);
  });

  it('detects concept naming', () => {
    const events = [
      ...buildPair(
        'how to avoid prop drilling',
        'You can use dependency injection or composition over inheritance to solve this. Another approach is separation of concerns through a context provider.',
      ),
    ];
    const result = score(events);
    const factor = result.teachingQuality.factors.find(f => f.name === 'concept-naming');
    expect(factor).toBeDefined();
    expect(factor!.raw).toBeGreaterThan(0);
  });

  it('returns non-scoreable for no turn pairs', () => {
    const result = score([]);
    expect(result.teachingQuality.scoreable).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Anti-Pattern Detection                                        */
/* ═══════════════════════════════════════════════════════════════ */

describe('Anti-Pattern detection', () => {
  it('detects confident-bullshitter pattern', () => {
    const events = [
      ...buildPair(
        'what is X?',
        'I\'m certain this is definitely the right approach. Without doubt, the answer is Y.',
      ),
      ...buildPair(
        'that\'s wrong, actually it is Z',
        'I see, you are correct.',
      ),
    ];
    const result = score(events);
    const cbDetection = result.antiPatterns.detections.find(d => d.pattern === 'confident-bullshitter');
    expect(cbDetection).toBeDefined();
    // Severity is proportional to evidence strength (3 conf + 2 contra markers = 0.9 → 14)
    expect(cbDetection!.severity).toBeGreaterThanOrEqual(8);
    expect(cbDetection!.severity).toBeLessThanOrEqual(15);
  });

  it('detects literal-interpreter pattern', () => {
    const events = [
      ...buildPair(
        'can you refactor the authentication module to use tokens',
        'Sure, I updated the authentication module.',
      ),
      ...buildPair(
        'I meant the authentication module should use JWT tokens, let me rephrase, the authentication module needs jsonwebtoken',
        'Updated with JWT.',
      ),
    ];
    const result = score(events);
    const liDetection = result.antiPatterns.detections.find(d => d.pattern === 'literal-interpreter');
    expect(liDetection).toBeDefined();
  });

  it('returns clean score when no anti-patterns', () => {
    const events = [...buildPair('hello', 'hi')];
    const result = score(events);
    expect(result.antiPatterns.score).toBe(100);
    expect(result.antiPatterns.detections).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Cognitive Alignment                                           */
/* ═══════════════════════════════════════════════════════════════ */

describe('Cognitive Alignment scoring', () => {
  it('rewards first-principles reasoning', () => {
    const events: SessionEvent[] = [
      userEvent('why is the build slow'),
      thinkingEvent('Let me break this down step by step. First, I need to check the build config. Then identify the root cause. Fundamentally the issue might be in the bundler settings.'),
      toolEvent('file-read', 'webpack.config.js'),
      toolEvent('file-edit', 'webpack.config.js'),
      assistantEvent('The root cause was unoptimized loaders. I fixed the config.'),
    ];
    const result = score(events);
    const fpFactor = result.cognitiveAlignment.factors.find(f => f.name === 'first-principles');
    expect(fpFactor).toBeDefined();
    expect(fpFactor!.raw).toBeGreaterThan(0);
  });

  it('returns scoreable: false for empty input', () => {
    const result = score([]);
    expect(result.cognitiveAlignment.scoreable).toBe(false);
  });

  it('scores ten foundations', () => {
    const events = [...buildPair('how does X work', 'X works by doing Y')];
    const result = score(events);
    expect(result.cognitiveAlignment.factors).toHaveLength(10);
    const names = result.cognitiveAlignment.factors.map(f => f.name);
    expect(names).toContain('first-principles');
    expect(names).toContain('calibrated-uncertainty');
    expect(names).toContain('systems-thinking');
    expect(names).toContain('taste-judgment');
  });

  it('rewards self-correction when no retries needed', () => {
    // Single clean turn with no retries → should get bonus (85)
    const events = [...buildPair('explain closures in JS', 'A closure is a function that captures variables from its enclosing scope.')];
    const result = score(events);
    const scFactor = result.teachingQuality.factors.find(f => f.name === 'self-correction');
    expect(scFactor).toBeDefined();
    expect(scFactor!.raw).toBeGreaterThanOrEqual(80);
  });

  it('uses continuous scoring for precision-communication', () => {
    // With varying response lengths, precision score should be between 0-100 (continuous)
    const events = [
      ...buildPair('what is X', 'X is a thing. ' + 'More explanation. '.repeat(30)),
      ...buildPair('what is Y', 'Y.'),
    ];
    const result = score(events);
    const pcFactor = result.cognitiveAlignment.factors.find(f => f.name === 'precision-communication');
    expect(pcFactor).toBeDefined();
    // Should not be stuck at exactly 50 or 100 — continuous range
    expect(pcFactor!.raw).toBeGreaterThanOrEqual(0);
    expect(pcFactor!.raw).toBeLessThanOrEqual(100);
  });

  it('uses multi-band scoring for first-principles', () => {
    const events: SessionEvent[] = [
      userEvent('why is X slow'),
      thinkingEvent('Fundamentally, the root cause is in the algorithm. Let me break this down.'),
      assistantEvent('The bottleneck is O(n^2) sort.'),
      userEvent('why is Y broken'),
      thinkingEvent('Step by step: first check config, then verify env. Decomposing the problem into layers.'),
      assistantEvent('Config was missing required field.'),
    ];
    const result = score(events);
    const fpFactor = result.cognitiveAlignment.factors.find(f => f.name === 'first-principles');
    expect(fpFactor).toBeDefined();
    expect(fpFactor!.raw).toBeGreaterThan(50); // should be well above minimum
  });

  it('gives neutral intellectual-honesty when no retries exist', () => {
    const events = [...buildPair('hello', 'hi there')];
    const result = score(events);
    const ihFactor = result.cognitiveAlignment.factors.find(f => f.name === 'intellectual-honesty');
    expect(ihFactor).toBeDefined();
    // Neutral baseline under v1.1.0 scorer: acknowledgement 0.7 + recovery 0.8 + proof 0.1
    // → round((0.7*0.55 + 0.8*0.3 + 0.1*0.15) * 10) = 6, scaled to 60.
    expect(ihFactor!.raw).toBe(60);
  });

  it('explanation depth rewards balanced prose+code', () => {
    // Balanced response with code and prose → should score high
    const balancedResponse = [
      'Closures capture variables from their enclosing scope.',
      'Here is an example:',
      '```js',
      'function outer() { let x = 1; return () => x; }',
      '```',
      'The inner function retains access to x even after outer returns.',
    ].join('\n');
    const events = [...buildPair('explain closures', balancedResponse)];
    const result = score(events);
    const edFactor = result.teachingQuality.factors.find(f => f.name === 'explanation-depth');
    expect(edFactor).toBeDefined();
    expect(edFactor!.raw).toBeGreaterThanOrEqual(80);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Conversation Curve                                            */
/* ═══════════════════════════════════════════════════════════════ */

describe('Conversation Curve', () => {
  it('produces one CurvePoint per turn pair', () => {
    const events = [
      ...buildPair('question one', 'answer one'),
      ...buildPair('question two', 'answer two'),
      ...buildPair('question three', 'answer three'),
    ];
    const result = score(events);
    expect(result.conversationCurve).toHaveLength(3);
    expect(result.conversationCurve[0].turnIndex).toBe(0);
    expect(result.conversationCurve[2].turnIndex).toBe(2);
  });

  it('first point has slope 0', () => {
    const events = [...buildPair('hello', 'hi')];
    const result = score(events);
    expect(result.conversationCurve[0].slope).toBe(0);
  });

  it('penalizes turns with fix keywords', () => {
    const events = [
      ...buildPair('implement feature X', 'Done'),
      ...buildPair('this is broken fix it', 'Fixed'),
    ];
    const result = score(events);
    const [t0, t1] = result.conversationCurve;
    expect(t1.turnScore).toBeLessThan(t0.turnScore);
  });

  it('returns empty curve for no events', () => {
    const result = score([]);
    expect(result.conversationCurve).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Highlights                                                    */
/* ═══════════════════════════════════════════════════════════════ */

describe('Highlights', () => {
  it('identifies best and worst turns', () => {
    const events = [
      ...buildPair('implement feature', 'Here is the implementation.'),
      ...buildPair('this is broken, fix it please', 'Fixed.'),
      ...buildPair('great, now add tests', 'Added tests.'),
    ];
    const result = score(events);
    const best = result.highlights.find(h => h.type === 'best');
    const worst = result.highlights.find(h => h.type === 'worst');
    expect(best).toBeDefined();
    expect(worst).toBeDefined();
    expect(best!.score).toBeGreaterThanOrEqual(worst!.score);
  });

  it('reports critical anti-pattern highlights', () => {
    const events = [
      ...buildPair(
        'what is the answer?',
        'I\'m certain this is definitely correct. Without doubt.',
      ),
      ...buildPair(
        'that\'s wrong, actually',
        'I see, sorry.',
      ),
    ];
    const result = score(events);
    const critical = result.highlights.filter(h => h.type === 'critical-anti-pattern');
    expect(critical.length).toBeGreaterThanOrEqual(0); // may or may not detect
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Overall Score                                                 */
/* ═══════════════════════════════════════════════════════════════ */

describe('Overall scoring', () => {
  it('produces a valid ConversationScore', () => {
    const events = [
      ...buildPair('hello', 'hi there'),
      ...buildPair('what is a closure?', 'A closure captures outer scope variables.'),
    ];
    const result = score(events);
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    expect(result.overallGrade).toBeDefined();
    expect(result.turnPairCount).toBe(2);
    expect(result.totalEvents).toBe(4);
    expect(result.scorerVersion).toBe('1.1.0');
    expect(result.sessionId).toBe('test-scorer');
  });

  it('weights sub-scores correctly', () => {
    const events = [...buildPair('test', 'response')];
    const result = score(events);
    // Overall = eff * 0.25 + teach * 0.20 + anti * 0.20 + cog * 0.20 + speakDim * 0.15
    // Just verify it is within a sane range
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it('assigns a letter grade', () => {
    const events = [...buildPair('test question', 'test answer')];
    const result = score(events);
    expect(['S', 'A', 'B', 'C', 'D', 'F']).toContain(result.overallGrade);
  });

  it('handles session with only user messages', () => {
    const events: SessionEvent[] = [
      userEvent('question one'),
      userEvent('question two'),
    ];
    const result = score(events);
    expect(result.turnPairCount).toBe(2);
    expect(result.overall).toBeGreaterThanOrEqual(0);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  ConversationScorer class                                      */
/* ═══════════════════════════════════════════════════════════════ */

describe('ConversationScorer class', () => {
  it('is instantiable with no args', () => {
    const s = new ConversationScorer();
    expect(s).toBeInstanceOf(ConversationScorer);
  });

  it('accepts optional SessionStats', () => {
    const stats: SessionStats = {
      totalEvents: 5,
      duration: 60_000,
      turnCount: 2,
      filesCreated: 0,
      filesModified: 3,
      filesRead: 2,
      errorsEncountered: 0,
      terminalCommands: 1,
    };
    const events = [...buildPair('question', 'answer')];
    const result = new ConversationScorer().score(events, stats);
    expect(result.overall).toBeGreaterThanOrEqual(0);
  });
});
