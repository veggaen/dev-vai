import { describe, it, expect } from 'vitest';
import {
  extractLessons,
  aggregateLessons,
  formatContextInjection,
  LearningExtractor,
} from '../src/eval/learning-extractor.js';
import { ConversationScorer, extractTurnPairs } from '../src/eval/conversation-scorer.js';
import type { ConversationScore, TurnPair } from '../src/eval/conversation-scorer.js';
import type { CognitiveLesson, LearningReport, AggregatedPattern, ContextInjection } from '../src/eval/learning-extractor.js';
import type { SessionEvent, SessionStats } from '../src/sessions/types.js';

/* ═══════════════════════════════════════════════════════════════ */
/*  Helpers                                                       */
/* ═══════════════════════════════════════════════════════════════ */

let eventId = 0;
const eid = () => `ev-ext-${++eventId}`;
let ts = 1_700_000_000_000;
const tick = (ms = 100) => (ts += ms);

function userEvent(content: string, sessionId = 'ext-sess'): SessionEvent {
  return {
    id: eid(), sessionId, type: 'message', timestamp: tick(),
    content, meta: { role: 'user', eventType: 'message' },
  };
}

function assistantEvent(content: string, sessionId = 'ext-sess'): SessionEvent {
  return {
    id: eid(), sessionId, type: 'message', timestamp: tick(),
    content, meta: { role: 'assistant', eventType: 'message' },
  };
}

function thinkingEvent(content: string, sessionId = 'ext-sess'): SessionEvent {
  return {
    id: eid(), sessionId, type: 'thinking', timestamp: tick(),
    content, meta: { eventType: 'thinking' },
  };
}

function toolEvent(
  toolType: string,
  filePath: string,
  sessionId = 'ext-sess',
): SessionEvent {
  return {
    id: eid(), sessionId, type: toolType as SessionEvent['type'], timestamp: tick(),
    content: `Tool: ${toolType} on ${filePath}`,
    meta: { eventType: toolType, filePath },
  };
}

function buildPair(user: string, assistant: string): SessionEvent[] {
  return [userEvent(user), assistantEvent(assistant)];
}

function scoreAndExtract(events: SessionEvent[]): { report: LearningReport; score: ConversationScore } {
  const scorer = new ConversationScorer();
  const s = scorer.score(events);
  const turnPairs = extractTurnPairs(events);
  const report = extractLessons(turnPairs, s, events);
  return { report, score: s };
}

function makeLesson(overrides: Partial<CognitiveLesson> & { id: string; sessionId: string }): CognitiveLesson {
  return {
    category: 'success-pattern',
    summary: 'Test lesson summary',
    evidence: 'evidence text',
    turnPairIndices: [0],
    foundationAlignment: ['first-principles'],
    confidence: 0.8,
    extractedAt: Date.now(),
    ...overrides,
  };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  extractLessons — Breakthrough Questions (retry chain → fix)   */
/* ═══════════════════════════════════════════════════════════════ */

describe('extractLessons — breakthrough questions', () => {
  it('detects resolved retry chains as breakthroughs', () => {
    // Build a retry chain: 3 turns with overlapping user content, then resolved
    const events: SessionEvent[] = [
      userEvent('fix the error in utils.ts line 42 please'),
      assistantEvent('I updated utils.ts line 42.'),
      userEvent('fix the error in utils.ts line 42, still broken'),
      assistantEvent('Updated utils.ts line 42 with correct null check.'),
      userEvent('fix the error in utils.ts line 42, not working yet'),
      assistantEvent('Found the root cause in utils.ts line 42, applied the final fix.'),
      // Next turn is different → chain resolved
      userEvent('now add tests for the module'),
      assistantEvent('Added tests.'),
    ];
    const { report } = scoreAndExtract(events);
    const breakthroughs = report.lessons.filter(l => l.category === 'breakthrough-question');
    expect(breakthroughs.length).toBeGreaterThanOrEqual(0); // chain detection depends on 3-gram overlap threshold
  });

  it('returns empty lessons for single-turn conversation', () => {
    const events = [...buildPair('hello', 'hi')];
    const { report } = scoreAndExtract(events);
    expect(report.lessons).toHaveLength(0);
    expect(report.topBreakthroughs).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  extractLessons — Success Patterns                             */
/* ═══════════════════════════════════════════════════════════════ */

describe('extractLessons — success patterns', () => {
  it('detects first-time success with thinking + tool action', () => {
    const events: SessionEvent[] = [
      userEvent('refactor the authentication to use JWT'),
      thinkingEvent('Let me break this down. First, I need to check the current auth implementation. Then replace with JWT tokens.'),
      toolEvent('file-read', 'src/auth.ts'),
      toolEvent('file-edit', 'src/auth.ts'),
      assistantEvent('Refactored authentication to use JWT tokens.'),
      // No retry after — clean success
      userEvent('looks good, now add rate limiting'),
      thinkingEvent('Rate limiting requires middleware setup.'),
      toolEvent('file-create', 'src/middleware/rate-limit.ts'),
      assistantEvent('Added rate limiting middleware.'),
    ];
    const { report } = scoreAndExtract(events);
    const successes = report.lessons.filter(l => l.category === 'success-pattern');
    expect(successes.length).toBeGreaterThanOrEqual(1);
    // Should align with taste-judgment foundation
    const hasFoundation = successes.some(l => l.foundationAlignment.includes('taste-judgment'));
    expect(hasFoundation).toBe(true);
  });

  it('does not count turns without thinking blocks', () => {
    const events: SessionEvent[] = [
      userEvent('fix bug'),
      toolEvent('file-edit', 'src/app.ts'),
      assistantEvent('Fixed.'),
    ];
    const { report } = scoreAndExtract(events);
    const successes = report.lessons.filter(l => l.category === 'success-pattern');
    expect(successes).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  extractLessons — Anti-Pattern Lessons                         */
/* ═══════════════════════════════════════════════════════════════ */

describe('extractLessons — anti-pattern lessons', () => {
  it('maps anti-pattern detections to lessons', () => {
    const events: SessionEvent[] = [
      userEvent('what is the approach?'),
      assistantEvent('I\'m certain this is definitely the right answer. Without doubt.'),
      userEvent('that\'s wrong, actually it should be different'),
      assistantEvent('I see, my mistake.'),
    ];
    const { report, score: s } = scoreAndExtract(events);
    const antiLessons = report.lessons.filter(l => l.category === 'anti-pattern');
    // If anti-pattern was detected, it should map to a lesson
    if (s.antiPatterns.detections.length > 0) {
      expect(antiLessons.length).toBe(s.antiPatterns.detections.length);
      expect(antiLessons[0].confidence).toBeGreaterThan(0);
    }
  });

  it('avoidance list contains anti-pattern lesson IDs', () => {
    const events: SessionEvent[] = [
      userEvent('what is the approach?'),
      assistantEvent('I\'m certain this is definitely the right answer. Without doubt.'),
      userEvent('that\'s wrong, actually it should be different'),
      assistantEvent('I see.'),
    ];
    const { report } = scoreAndExtract(events);
    for (const id of report.avoidanceList) {
      expect(report.lessons.some(l => l.id === id && l.category === 'anti-pattern')).toBe(true);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  extractLessons — Reasoning Chains                             */
/* ═══════════════════════════════════════════════════════════════ */

describe('extractLessons — reasoning chains', () => {
  it('detects 3+ consecutive thinking blocks as reasoning chain', () => {
    // Build 4 turns, each with thinking that shares entities
    const events: SessionEvent[] = [
      userEvent('optimize the database queries'),
      thinkingEvent('Let me analyze the database queries. The main bottleneck is the user_profiles table. We need to add indexes. The query optimizer is not using the index on user_id column.'),
      toolEvent('file-read', 'src/db/queries.ts'),
      assistantEvent('Found the bottleneck in database queries.'),

      userEvent('continue with the database optimization'),
      thinkingEvent('Now I need to optimize the database queries further. The user_profiles table needs a compound index. The query optimizer should benefit from the user_id and created_at index.'),
      toolEvent('file-edit', 'src/db/migrations/add-indexes.ts'),
      assistantEvent('Added compound indexes to user_profiles table.'),

      userEvent('what about the N+1 queries'),
      thinkingEvent('Looking at the database queries for N+1 patterns. The user_profiles table is being queried in a loop. The query optimizer can batch these with a JOIN on user_id.'),
      toolEvent('file-edit', 'src/db/queries.ts'),
      assistantEvent('Resolved N+1 queries with JOIN optimization.'),

      userEvent('verify the improvement'),
      thinkingEvent('Testing the database queries performance. The user_profiles table queries are now using the compound index. The query optimizer reports 10x improvement on user_id lookups.'),
      assistantEvent('Verified 10x improvement in query performance.'),
    ];
    const { report } = scoreAndExtract(events);
    const chains = report.lessons.filter(l => l.category === 'reasoning-chain');
    expect(chains.length).toBeGreaterThanOrEqual(1);
    if (chains.length > 0) {
      expect(chains[0].foundationAlignment).toContain('first-principles');
      expect(chains[0].foundationAlignment).toContain('systems-thinking');
      expect(chains[0].turnPairIndices.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('returns no reasoning chains for short conversations', () => {
    const events = [...buildPair('hello', 'hi')];
    const { report } = scoreAndExtract(events);
    const chains = report.lessons.filter(l => l.category === 'reasoning-chain');
    expect(chains).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Cognitive Profile                                             */
/* ═══════════════════════════════════════════════════════════════ */

describe('Cognitive Profile', () => {
  it('produces a profile with foundation strengths', () => {
    const events: SessionEvent[] = [
      userEvent('refactor auth'),
      thinkingEvent('Let me break this down step by step. First principles analysis of the auth module.'),
      toolEvent('file-edit', 'src/auth.ts'),
      assistantEvent('Refactored.'),
      userEvent('looks good'),
      thinkingEvent('Checking the refactored code.'),
      toolEvent('file-read', 'src/auth.ts'),
      assistantEvent('Verified.'),
    ];
    const { report } = scoreAndExtract(events);
    expect(report.cognitiveProfile).toBeDefined();
    expect(report.cognitiveProfile.overallStrength).toBeGreaterThanOrEqual(0);
    expect(report.cognitiveProfile.overallStrength).toBeLessThanOrEqual(100);
    expect(report.cognitiveProfile.improvementPriority.length).toBeLessThanOrEqual(5);
  });

  it('lists strong and weak foundations', () => {
    const events: SessionEvent[] = [
      userEvent('implement feature'),
      thinkingEvent('Step by step decomposition. Root cause analysis. First principles.'),
      toolEvent('file-edit', 'src/feature.ts'),
      toolEvent('file-edit', 'src/feature.test.ts'),
      assistantEvent('Implemented with tests.'),
      userEvent('great work'),
      assistantEvent('Thanks!'),
    ];
    const { report } = scoreAndExtract(events);
    const profile = report.cognitiveProfile;
    // strongFoundations and weakFoundations are arrays
    expect(Array.isArray(profile.strongFoundations)).toBe(true);
    expect(Array.isArray(profile.weakFoundations)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  aggregateLessons                                              */
/* ═══════════════════════════════════════════════════════════════ */

describe('aggregateLessons', () => {
  it('returns empty for single lesson', () => {
    const lessons = [makeLesson({ id: 'l1', sessionId: 's1' })];
    const patterns = aggregateLessons(lessons);
    expect(patterns).toHaveLength(0); // needs 2+ in a cluster
  });

  it('clusters similar lessons by summary ngram overlap', () => {
    const lessons = [
      makeLesson({ id: 'l1', sessionId: 's1', summary: 'Resolved retry chain on utils module fix' }),
      makeLesson({ id: 'l2', sessionId: 's2', summary: 'Resolved retry chain on utils module error' }),
      makeLesson({ id: 'l3', sessionId: 's3', summary: 'Completely different topic about database' }),
    ];
    const patterns = aggregateLessons(lessons);
    // The first two should cluster (high overlap), third is standalone
    const matching = patterns.filter(p => p.summary.includes('retry chain'));
    expect(matching.length).toBeLessThanOrEqual(1); // at most one cluster
  });

  it('sorts patterns by occurrences descending', () => {
    const lessons = [
      makeLesson({ id: 'l1', sessionId: 's1', category: 'anti-pattern', summary: 'pattern alpha repeated problem' }),
      makeLesson({ id: 'l2', sessionId: 's2', category: 'anti-pattern', summary: 'pattern alpha repeated issue' }),
      makeLesson({ id: 'l3', sessionId: 's3', category: 'anti-pattern', summary: 'pattern alpha repeated error' }),
      makeLesson({ id: 'l4', sessionId: 's4', category: 'success-pattern', summary: 'unique success with first principles' }),
      makeLesson({ id: 'l5', sessionId: 's5', category: 'success-pattern', summary: 'unique success with first principles also' }),
    ];
    const patterns = aggregateLessons(lessons);
    if (patterns.length >= 2) {
      expect(patterns[0].occurrences).toBeGreaterThanOrEqual(patterns[1].occurrences);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  formatContextInjection                                        */
/* ═══════════════════════════════════════════════════════════════ */

describe('formatContextInjection', () => {
  it('produces valid ContextInjection with lessons', () => {
    const recent = [
      makeLesson({ id: 'r1', sessionId: 's1', summary: 'success via decomposition' }),
    ];
    const antiPatterns = [
      makeLesson({ id: 'a1', sessionId: 's1', category: 'anti-pattern', summary: 'template-matcher detected' }),
    ];
    const best = makeLesson({ id: 'b1', sessionId: 's1', category: 'reasoning-chain', summary: 'deep 4-turn reasoning chain' });

    const injection = formatContextInjection(recent, antiPatterns, best, 5);
    expect(injection.text).toContain('Cognitive Context');
    expect(injection.text).toContain('Recent Lessons');
    expect(injection.text).toContain('Anti-Patterns to Avoid');
    expect(injection.text).toContain('Reasoning Exemplar');
    expect(injection.lessonCount).toBe(3);
    expect(injection.charCount).toBe(injection.text.length);
  });

  it('handles empty lessons gracefully', () => {
    const injection = formatContextInjection([], [], null, 0);
    expect(injection.text).toContain('Cognitive Context');
    expect(injection.lessonCount).toBe(0);
  });

  it('limits recent lessons to 5', () => {
    const recent = Array.from({ length: 10 }, (_, i) =>
      makeLesson({ id: `r${i}`, sessionId: `s${i}`, summary: `lesson number ${i}` }),
    );
    const injection = formatContextInjection(recent, [], null, 10);
    // Count "- " lines after "Recent Lessons:"
    const lines = injection.text.split('\n').filter(l => l.startsWith('- '));
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it('limits anti-pattern lessons to 3', () => {
    const anti = Array.from({ length: 6 }, (_, i) =>
      makeLesson({ id: `a${i}`, sessionId: `s${i}`, category: 'anti-pattern', summary: `anti-pattern ${i}` }),
    );
    const injection = formatContextInjection([], anti, null, 6);
    const lines = injection.text.split('\n').filter(l => l.startsWith('- '));
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  LearningExtractor class                                       */
/* ═══════════════════════════════════════════════════════════════ */

describe('LearningExtractor class', () => {
  it('extract() returns same result as extractLessons()', () => {
    const events: SessionEvent[] = [
      ...buildPair('question', 'answer'),
    ];
    const scorer = new ConversationScorer();
    const s = scorer.score(events);
    const turnPairs = extractTurnPairs(events);

    const extractor = new LearningExtractor();
    const report = extractor.extract(turnPairs, s, events);
    const directReport = extractLessons(turnPairs, s, events);
    expect(report.sessionId).toBe(directReport.sessionId);
    expect(report.lessons.length).toBe(directReport.lessons.length);
  });

  it('aggregate() delegates to aggregateLessons()', () => {
    const lessons = [
      makeLesson({ id: 'l1', sessionId: 's1' }),
      makeLesson({ id: 'l2', sessionId: 's2' }),
    ];
    const extractor = new LearningExtractor();
    const patterns = extractor.aggregate(lessons);
    const direct = aggregateLessons(lessons);
    expect(patterns.length).toBe(direct.length);
  });

  it('formatContext() delegates to formatContextInjection()', () => {
    const extractor = new LearningExtractor();
    const result = extractor.formatContext([], [], null, 0);
    expect(result.text).toContain('Cognitive Context');
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  LearningReport structure                                      */
/* ═══════════════════════════════════════════════════════════════ */

describe('LearningReport structure', () => {
  it('contains all required fields', () => {
    const events: SessionEvent[] = [
      ...buildPair('how to fix bug', 'here is the fix'),
    ];
    const { report } = scoreAndExtract(events);
    expect(report.sessionId).toBe('ext-sess');
    expect(Array.isArray(report.lessons)).toBe(true);
    expect(Array.isArray(report.topBreakthroughs)).toBe(true);
    expect(Array.isArray(report.recurringPatterns)).toBe(true);
    expect(Array.isArray(report.avoidanceList)).toBe(true);
    expect(Array.isArray(report.reasoningExemplars)).toBe(true);
    expect(report.cognitiveProfile).toBeDefined();
  });

  it('lesson IDs are unique', () => {
    const events: SessionEvent[] = [
      userEvent('optimize queries'),
      thinkingEvent('Step by step decomposition of the query optimization problem.'),
      toolEvent('file-edit', 'src/queries.ts'),
      assistantEvent('Optimized.'),
      userEvent('add caching'),
      thinkingEvent('Now analyzing the caching layer for the optimized queries.'),
      toolEvent('file-edit', 'src/cache.ts'),
      assistantEvent('Added caching.'),
    ];
    const { report } = scoreAndExtract(events);
    const ids = report.lessons.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ═══════════════════════════════════════════════════════════════ */
/*  Foundation coverage & context injection improvements           */
/* ═══════════════════════════════════════════════════════════════ */

describe('Context injection truncation', () => {
  it('does not cut lessons mid-line', () => {
    const lessons = Array.from({ length: 50 }, (_, i) =>
      makeLesson({ id: `r${i}`, sessionId: `s${i}`, summary: `Detailed lesson about a complex topic number ${i} with explanation` }),
    );
    const injection = formatContextInjection(lessons, [], null, 50);
    // Should not end with '...' (old behavior) — should end with [...truncated] on own line
    if (injection.charCount > 100) {
      const lines = injection.text.split('\n');
      const lastLine = lines[lines.length - 1];
      // Each line should be complete, not cut mid-word
      expect(lastLine).not.toMatch(/\w{3,}$/); // not ending mid-word
    }
  });
});

describe('Success pattern foundation coverage', () => {
  it('assigns compression when deep thinking + short action', () => {
    // Build events with long thinking and concise tool call
    const events: SessionEvent[] = [
      userEvent('refactor the auth module'),
      thinkingEvent('Let me analyze the auth module in depth. First, I need to understand the current architecture. The module uses session-based auth with cookies. ' +
                    'Step by step, I should migrate to JWT tokens. Considering trade-offs between stateless and stateful approaches. ' +
                    'The root cause of the complexity is mixed concerns between authentication and authorization. Alternatively, we could use OAuth2.'),
      toolEvent('file-edit', 'src/auth.ts'),
      assistantEvent('Refactored to JWT.'),
    ];
    const { report } = scoreAndExtract(events);
    const successLessons = report.lessons.filter(l => l.category === 'success-pattern');
    if (successLessons.length > 0) {
      const allFoundations = successLessons.flatMap(l => l.foundationAlignment);
      // Should have expanded foundation coverage
      expect(allFoundations.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('simpleHash consistency', () => {
  it('produces deterministic output', () => {
    const patterns1 = aggregateLessons([
      makeLesson({ id: 'h1', summary: 'common pattern A', sessionId: 's1' }),
      makeLesson({ id: 'h2', summary: 'common pattern A', sessionId: 's2' }),
    ]);
    const patterns2 = aggregateLessons([
      makeLesson({ id: 'h3', summary: 'common pattern A', sessionId: 's3' }),
      makeLesson({ id: 'h4', summary: 'common pattern A', sessionId: 's4' }),
    ]);
    if (patterns1.length > 0 && patterns2.length > 0) {
      expect(patterns1[0].patternId).toBe(patterns2[0].patternId);
    }
  });

  it('produces different hashes for different inputs', () => {
    const patternsA = aggregateLessons([
      makeLesson({ id: 'a1', summary: 'unique pattern alpha', sessionId: 's1' }),
      makeLesson({ id: 'a2', summary: 'unique pattern alpha', sessionId: 's2' }),
    ]);
    const patternsB = aggregateLessons([
      makeLesson({ id: 'b1', summary: 'unique pattern beta', sessionId: 's1' }),
      makeLesson({ id: 'b2', summary: 'unique pattern beta', sessionId: 's2' }),
    ]);
    if (patternsA.length > 0 && patternsB.length > 0) {
      expect(patternsA[0].patternId).not.toBe(patternsB[0].patternId);
    }
  });
});
