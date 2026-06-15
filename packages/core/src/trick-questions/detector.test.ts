/**
 * Tests for the expanded trick-question detector + web-pattern-learner.
 *
 * Coverage:
 *   - All 8 detector classes (5 original + 3 new)
 *   - Edge cases for the 3 new classes
 *   - The "car wash" viral question in multiple phrasings
 *   - Web pattern learner content classification
 *   - Web pattern learner pattern extraction
 *   - Pattern library management
 */
import { describe, test, expect } from 'vitest';
import {
  detectTrickQuestion,
  detectLetterCount,
  detectEqualWeight,
  detectSisterBrother,
  detectMaryDaughters,
  detectCrossingBridge,
  detectImplicitConstraint,
  detectFalsePremise,
  detectAnchoringTrap,
} from './detector.js';
import {
  classifyContent,
  extractTrickPatterns,
  matchLearnedPattern,
  createPatternLibrary,
  addPatterns,
} from './web-pattern-learner.js';

// ── Original detectors (regression tests) ─────────────────────────────

describe('letter-count detector', () => {
  test('strawberry', () => {
    const r = detectLetterCount('how many r\'s in strawberry');
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('letter-count');
    expect(r!.answer).toContain('3');
  });

  test('banana', () => {
    const r = detectLetterCount('how many a letters in banana');
    expect(r).not.toBeNull();
    expect(r!.answer).toContain('3');
  });

  test('non-match', () => {
    expect(detectLetterCount('what is the price of btc')).toBeNull();
  });
});

describe('equal-weight detector', () => {
  test('feathers vs steel', () => {
    const r = detectEqualWeight('what weighs more a pound of feathers or a pound of steel');
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('equal-weight');
    expect(r!.answer).toContain('same');
  });
});

describe('sister-brother detector', () => {
  test('mary has 5 brothers and 3 sisters', () => {
    const r = detectSisterBrother('Mary has 5 brothers and 3 sisters. How many sisters does her brother have?');
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('sister-brother');
  });
});

// ── NEW: implicit-constraint (structural detector) ────────────────────

describe('implicit-constraint detector (structural, scalable)', () => {
  // ── CAR scenarios (transport verb = drive) ──
  test('viral car wash question — exact phrasing', () => {
    const r = detectImplicitConstraint(
      'Should I walk or drive to car wash 100 m away to get my car cleaned?',
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('implicit-constraint');
    expect(r!.answer).toMatch(/drive/i);
    expect(r!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test('car wash — casual two-sentence phrasing', () => {
    const r = detectImplicitConstraint(
      'I want to wash my car. The car wash is 100 meters away. Should I walk or drive?',
    );
    expect(r).not.toBeNull();
    expect(r!.answer).toMatch(/drive/i);
  });

  test('mechanic variation', () => {
    const r = detectImplicitConstraint(
      'Should I walk or drive to the mechanic to fix my car?',
    );
    expect(r).not.toBeNull();
  });

  test('auto shop — disconnected phrasing', () => {
    const r = detectImplicitConstraint(
      'My car needs repair. The auto shop is nearby. Walk or drive?',
    );
    expect(r).not.toBeNull();
  });

  test('novel phrasing: truck service', () => {
    const r = detectImplicitConstraint(
      'My truck needs an oil change at the dealership. Should I walk there or drive?',
    );
    expect(r).not.toBeNull();
    expect(r!.answer).toMatch(/drive/i);
  });

  // ── BIKE scenarios (transport verb = ride) ──
  test('bike shop — ride vs walk', () => {
    const r = detectImplicitConstraint(
      'My bike has a flat tire. The bike shop is down the road. Should I walk or ride?',
    );
    expect(r).not.toBeNull();
    expect(r!.answer).toMatch(/ride/i);
  });

  test('motorcycle repair', () => {
    const r = detectImplicitConstraint(
      'I need to get my motorcycle inspected. Walk or ride there?',
    );
    expect(r).not.toBeNull();
    expect(r!.answer).toMatch(/ride/i);
  });

  // ── BOAT scenarios (transport verb = sail) ──
  test('boat repair at marina', () => {
    const r = detectImplicitConstraint(
      'My boat needs repair at the marina. Should I walk or sail there?',
    );
    expect(r).not.toBeNull();
    expect(r!.answer).toMatch(/sail/i);
  });

  // ── FALSE POSITIVES — should NOT match ──
  test('no self-transport item — grocery store', () => {
    expect(detectImplicitConstraint(
      'Should I walk or drive to the grocery store?',
    )).toBeNull();
  });

  test('no service involved — just driving somewhere', () => {
    expect(detectImplicitConstraint(
      'My car is parked outside. Should I walk to the park?',
    )).toBeNull();
  });

  test('no transport question — just a statement', () => {
    expect(detectImplicitConstraint(
      'The car wash near me is great. I go every week.',
    )).toBeNull();
  });

  test('drive vs uber — not a trick (both transport the car owner)', () => {
    // "Drive or take an uber?" — both leave the car behind, no trick
    // But our detector only fires when there's a NON-ITEM transport (walk/bus)
    // Since "uber" IS a non-item transport, this WILL fire... and it should,
    // because you still need to bring the car!
    const r = detectImplicitConstraint(
      'My car needs cleaning at the car wash. Should I take an uber or drive?',
    );
    expect(r).not.toBeNull(); // Correct — you must drive to bring the car
  });

  test('dispatches through detectTrickQuestion', () => {
    const r = detectTrickQuestion(
      'Should I walk or drive to car wash 100 m away to get my car cleaned?',
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('implicit-constraint');
  });
});

// ── NEW: false-premise ─────────────────────────────────────────────────

describe('false-premise detector', () => {
  test('flat earth premise', () => {
    const r = detectFalsePremise(
      'Since the earth is flat, how far can you see to the horizon?',
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('false-premise');
    expect(r!.answer).toMatch(/not flat/i);
  });

  test('Einstein failing math', () => {
    const r = detectFalsePremise('Why did Einstein fail math?');
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('false-premise');
    expect(r!.answer).toMatch(/did NOT fail/i);
  });

  test('10% brain myth', () => {
    const r = detectFalsePremise(
      'Since humans only use 10% of their brain, what happens in the other 90%?',
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('false-premise');
    expect(r!.answer).toMatch(/myth/i);
  });

  test('Great Wall from space', () => {
    const r = detectFalsePremise(
      'Given the great wall of china can be seen from space, how wide is it?',
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('false-premise');
  });

  test('legitimate question — no false premise', () => {
    expect(detectFalsePremise('What is the speed of light?')).toBeNull();
    expect(detectFalsePremise('Why did Einstein discover relativity?')).toBeNull();
  });

  test('dispatches through detectTrickQuestion', () => {
    const r = detectTrickQuestion('Why did Einstein fail math?');
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('false-premise');
  });
});

// ── NEW: anchoring-trap ────────────────────────────────────────────────

describe('anchoring-trap detector', () => {
  test('bat and ball — classic', () => {
    const r = detectAnchoringTrap(
      'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?',
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('anchoring-trap');
    expect(r!.answer).toContain('$0.05');
    expect(r!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test('bat and ball — no dollar sign', () => {
    const r = detectAnchoringTrap(
      'A bat and a ball cost 1.10 in total. The bat costs 1.00 more than the ball. How much does the ball cost?',
    );
    expect(r).not.toBeNull();
    expect(r!.answer).toContain('$0.05');
  });

  test('lily pad problem — 48 days', () => {
    const r = detectAnchoringTrap(
      'There is a patch of lily pads on a lake. Every day, the patch doubles in size. If it takes 48 days for the patch to cover the entire lake, on what day is it half covered?',
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('anchoring-trap');
    expect(r!.answer).toContain('47');
  });

  test('lily pad — 30 days variant', () => {
    const r = detectAnchoringTrap(
      'Algae in a pond doubles every day. It covers the whole pond in 30 days. When is it half covered?',
    );
    expect(r).not.toBeNull();
    expect(r!.answer).toContain('29');
  });

  test('unrelated question — no anchoring', () => {
    expect(detectAnchoringTrap('How much does a baseball bat cost?')).toBeNull();
  });

  test('dispatches through detectTrickQuestion', () => {
    const r = detectTrickQuestion(
      'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?',
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('anchoring-trap');
  });
});

// ── Comprehensive dispatch test ────────────────────────────────────────

describe('detectTrickQuestion (full dispatch)', () => {
  test('returns null for normal questions', () => {
    expect(detectTrickQuestion('What is the capital of France?')).toBeNull();
    expect(detectTrickQuestion('How do I install Docker?')).toBeNull();
    expect(detectTrickQuestion('price of btc')).toBeNull();
    expect(detectTrickQuestion('hello')).toBeNull();
  });

  test('returns null for empty/invalid input', () => {
    expect(detectTrickQuestion('')).toBeNull();
    expect(detectTrickQuestion('   ')).toBeNull();
  });

  test('picks highest confidence when multiple match', () => {
    // This shouldn't happen in practice, but verify the dispatcher
    // picks the highest confidence result
    const r = detectTrickQuestion('how many r\'s in strawberry');
    expect(r).not.toBeNull();
    expect(r!.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

// ── Web Pattern Learner ────────────────────────────────────────────────

describe('content classification', () => {
  test('identifies trick-question discussion', () => {
    const cls = classifyContent(
      'This viral trick question about walking or driving to the car wash has been exposing AI model failures. Most LLMs got it wrong because they fail at common sense reasoning.',
      'AI models fail the trick question test',
    );
    expect(cls).toBe('trick-question-discussion');
  });

  test('identifies ai-failure analysis', () => {
    const cls = classifyContent(
      'We tested how AI models handle cognitive biases in prompt engineering.',
      'AI benchmark results',
    );
    expect(cls).toBe('ai-failure-analysis');
  });

  test('classifies short content as irrelevant', () => {
    expect(classifyContent('hello world', 'test')).toBe('irrelevant');
  });

  test('classifies general content', () => {
    const cls = classifyContent(
      'This is a long article about TypeScript programming and how to use generics effectively in your codebase for type safety.',
      'TypeScript guide',
    );
    expect(cls).toBe('general');
  });
});

describe('pattern library management', () => {
  test('creates empty library', () => {
    const lib = createPatternLibrary();
    expect(lib.patterns).toHaveLength(0);
    expect(lib.version).toBe(1);
  });

  test('adds patterns with dedup', () => {
    const lib = createPatternLibrary();
    const pattern = {
      id: 'test_1',
      name: 'test-pattern',
      mechanism: 'test',
      triggerKeywords: ['walk', 'drive', 'car', 'wash'],
      correctReasoning: 'You must drive',
      examples: ['Should I walk or drive?'],
      sourceUrl: 'https://example.com',
      learnedAtMs: Date.now(),
      confidence: 0.8,
    };

    const lib2 = addPatterns(lib, [pattern]);
    expect(lib2.patterns).toHaveLength(1);
    expect(lib2.version).toBe(2);

    // Adding the same pattern again should deduplicate
    const lib3 = addPatterns(lib2, [pattern]);
    expect(lib3.patterns).toHaveLength(1);
    expect(lib3.version).toBe(2); // no change
  });
});

describe('pattern matching', () => {
  test('matches a learned pattern by keywords', () => {
    const lib = addPatterns(createPatternLibrary(), [{
      id: 'car_wash_1',
      name: 'car-wash-trick',
      mechanism: 'The car must be at the car wash',
      triggerKeywords: ['walk', 'drive', 'car', 'wash'],
      correctReasoning: 'Drive, because the car must be there',
      examples: ['Should I walk or drive to the car wash?'],
      sourceUrl: 'https://reddit.com/test',
      learnedAtMs: Date.now(),
      confidence: 0.85,
    }]);

    const match = matchLearnedPattern(
      'Should I walk or drive to wash my car?',
      lib,
    );
    expect(match).not.toBeNull();
    expect(match!.name).toBe('car-wash-trick');
  });

  test('returns null for unrelated input', () => {
    const lib = addPatterns(createPatternLibrary(), [{
      id: 'test_1',
      name: 'test',
      mechanism: 'test',
      triggerKeywords: ['quantum', 'physics', 'entanglement'],
      correctReasoning: 'test',
      examples: ['test'],
      sourceUrl: 'https://example.com',
      learnedAtMs: Date.now(),
      confidence: 0.8,
    }]);

    expect(matchLearnedPattern('What is the price of btc?', lib)).toBeNull();
  });
});

describe('pattern extraction from web content', () => {
  test('extracts trick patterns from descriptive content', () => {
    const content = [
      'The viral car wash question has been stumping AI models.',
      '',
      '"Should I walk or drive to the car wash to get my car cleaned?"',
      '',
      'The trick is that you need the car to be at the car wash, so driving is the only logical option.',
      '',
      'Most AI models recommend walking, treating it as a simple distance optimization.',
    ].join('\n');

    const patterns = extractTrickPatterns(content, 'https://reddit.com/test');
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    if (patterns.length > 0) {
      expect(patterns[0].triggerKeywords.length).toBeGreaterThan(0);
      expect(patterns[0].sourceUrl).toBe('https://reddit.com/test');
    }
  });

  test('returns empty for non-trick content', () => {
    const patterns = extractTrickPatterns(
      'This is a boring article about TypeScript. No tricks here.\nJust regular programming content.',
      'https://example.com',
    );
    expect(patterns).toHaveLength(0);
  });
});
