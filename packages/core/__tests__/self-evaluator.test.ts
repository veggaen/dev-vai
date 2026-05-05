/**
 * Unit tests for the self-evaluation umbrella + constraint-checking predicates.
 *
 * These tests exercise the SelfEvaluator and predicates in isolation (no engine).
 * MD-driven coverage of the full pipeline lives in eval/corpus-md/edge-cases/self-evaluation/.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SelfEvaluator,
  CONSTRAINT_CHECKING_PREDICATES,
  formatLineCount,
  wordCountExact,
  charBan,
  topicPresence,
  type ResponsePredicate,
} from '../src/self-eval/index.js';

// ───────────────────────── helpers ─────────────────────────

const noHistory: ReadonlyArray<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

function makeEvaluator(
  predicates: readonly ResponsePredicate[],
  generateRevision = vi.fn(async (_input: string, _history: any, _hint: string) => ''),
) {
  return new SelfEvaluator({ predicates, generateRevision });
}

// ───────────────────────── format-line-count ─────────────────────────

describe('formatLineCount predicate', () => {
  it('passes when line count matches', () => {
    const c = formatLineCount.derive('Write three lines about the moon.', noHistory);
    expect(c).not.toBeNull();
    expect(c!.check('one\ntwo\nthree', 'Write three lines about the moon.', noHistory)).toEqual({ ok: true });
  });

  it('fails with hint when line count is wrong', () => {
    const c = formatLineCount.derive('Write three lines about the moon.', noHistory);
    const result = c!.check('one\ntwo', 'Write three lines about the moon.', noHistory);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.hint).toMatch(/exactly 3 lines.*got 2/);
  });

  it('counts numeric bullets', () => {
    const c = formatLineCount.derive('Explain TCP in three bullet points.', noHistory);
    expect(c).not.toBeNull();
    const candidate = '- Reliable transport\n- Ordered delivery\n- Acknowledgments';
    expect(c!.check(candidate, '', noHistory)).toEqual({ ok: true });
  });

  it('returns null when no line/bullet phrasing in input', () => {
    expect(formatLineCount.derive('Tell me about the moon.', noHistory)).toBeNull();
  });
});

// ───────────────────────── word-count-exact ─────────────────────────

describe('wordCountExact predicate', () => {
  it('passes on exact match', () => {
    const c = wordCountExact.derive('Reply with exactly 7 words about the ocean.', noHistory);
    expect(c).not.toBeNull();
    expect(c!.check('The deep blue ocean rolls in waves', '', noHistory)).toEqual({ ok: true });
  });

  it('fails on miscount with hint', () => {
    const c = wordCountExact.derive('Reply with exactly 7 words about the ocean.', noHistory);
    const r = c!.check('Just five words here today', '', noHistory);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint).toMatch(/exactly 7 words/);
  });

  it('does NOT fire on soft constraint phrasing', () => {
    expect(wordCountExact.derive('about 7 words', noHistory)).toBeNull();
    expect(wordCountExact.derive('roughly 30 words', noHistory)).toBeNull();
  });

  it('does NOT fire when no word-count phrasing', () => {
    expect(wordCountExact.derive('Tell me a story.', noHistory)).toBeNull();
  });
});

// ───────────────────────── char-ban ─────────────────────────

describe('charBan predicate', () => {
  it('catches banned letter', () => {
    const c = charBan.derive('Write a haiku with no letter E.', noHistory);
    expect(c).not.toBeNull();
    const r = c!.check('Sun rises bright today', '', noHistory);
    expect(r.ok).toBe(false);
  });

  it('passes when banned letter absent', () => {
    const c = charBan.derive('Write a haiku with no letter E.', noHistory);
    expect(c!.check('Cloud drifts by, sky bright', '', noHistory)).toEqual({ ok: true });
  });

  it('catches banned word from list', () => {
    const c = charBan.derive('Explain recursion. Do not use the words function and stack.', noHistory);
    expect(c).not.toBeNull();
    const r = c!.check('A function calls itself.', '', noHistory);
    expect(r.ok).toBe(false);
  });

  it('returns null when no ban phrasing', () => {
    expect(charBan.derive('Tell me a story.', noHistory)).toBeNull();
  });
});

// ───────────────────────── topic-presence (gated firing — option b) ─────────────────────────

describe('topicPresence predicate', () => {
  it('fires only when an explicit topic-anchor phrase is present', () => {
    expect(topicPresence.derive('Tell me about hammers.', noHistory)).toBeNull();
    expect(topicPresence.derive('Stay on topic. Tell me about hammers.', noHistory)).not.toBeNull();
    expect(topicPresence.derive('Focus only on hammers please.', noHistory)).not.toBeNull();
  });

  it('passes when candidate mentions topic head', () => {
    const c = topicPresence.derive('Stay on topic: hammers. What are they good for?', noHistory);
    expect(c).not.toBeNull();
    expect(c!.check('Hammers drive nails and shape metal.', '', noHistory)).toEqual({ ok: true });
  });

  it('fails when candidate hijacks off-topic', () => {
    const c = topicPresence.derive('Stay on topic about hammers.', noHistory);
    const r = c!.check('Kubernetes is a container orchestration platform.', '', noHistory);
    expect(r.ok).toBe(false);
  });
});

// ───────────────────────── SelfEvaluator aggregation + revision cap ─────────────────────────

describe('SelfEvaluator', () => {
  it('returns trivial pass when no predicates fire', async () => {
    const ev = makeEvaluator([formatLineCount, wordCountExact, charBan, topicPresence]);
    const v = await ev.evaluate('Tell me a story.', noHistory, 'Once upon a time.');
    expect(v.kind).toBe('pass');
    expect(v.revisionApplied).toBe(false);
    expect(v.trace).toHaveLength(1);
    expect(v.trace[0].failedPredicates).toEqual([]);
  });

  it('passes draft-1 when applicable predicate is satisfied', async () => {
    const ev = makeEvaluator([wordCountExact]);
    const v = await ev.evaluate('Reply with exactly 3 words about cats.', noHistory, 'Cats nap often');
    expect(v.kind).toBe('pass');
    expect(v.revisionApplied).toBe(false);
  });

  it('revises once on draft-1 failure and emits draft-2 on success', async () => {
    const gen = vi.fn(async () => 'Cats nap often'); // 3 words
    const ev = makeEvaluator([wordCountExact], gen);
    const v = await ev.evaluate('Reply with exactly 3 words about cats.', noHistory, 'Cats are wonderful little creatures');
    expect(gen).toHaveBeenCalledTimes(1);
    expect(v.kind).toBe('revise-applied');
    expect(v.emit).toBe('Cats nap often');
    expect(v.revisionApplied).toBe(true);
    expect(v.capFired).toBe(false);
    expect(v.trace).toHaveLength(2);
  });

  it('respects single-revision cap; emits draft-2 with flag-uncertain on persistent failure', async () => {
    const gen = vi.fn(async () => 'Still wrong word count here today');
    const ev = makeEvaluator([wordCountExact], gen);
    const v = await ev.evaluate('Reply with exactly 3 words.', noHistory, 'This first draft is also wrong');
    expect(gen).toHaveBeenCalledTimes(1); // CAP — never called twice
    expect(v.kind).toBe('flag-uncertain');
    expect(v.capFired).toBe(true);
    expect(v.emit).toBe('Still wrong word count here today');
    expect(v.revisionApplied).toBe(true);
  });

  it('aggregates fail across multiple predicates (any-fail wins)', async () => {
    const gen = vi.fn(async () => 'fixed');
    const ev = makeEvaluator([wordCountExact, charBan], gen);
    const v = await ev.evaluate(
      'Reply with exactly 2 words. Do not use the words cat and dog.',
      noHistory,
      'cat dog',
    );
    expect(v.kind).toBe('flag-uncertain');
    // both predicates should appear in failed list of draft-1
    expect(v.trace[0].failedPredicates.length).toBeGreaterThanOrEqual(1);
  });

  it('captures cap-suppressed diagnostic third draft when generated externally', async () => {
    const gen = vi
      .fn()
      .mockResolvedValueOnce('still wrong many words') // draft-2
      .mockResolvedValueOnce('Two words'); // draft-3 (diagnostic only)
    const ev = makeEvaluator([wordCountExact], gen);
    const v = await ev.evaluate('Reply with exactly 2 words.', noHistory, 'first draft is wrong');
    expect(v.capFired).toBe(true);
    const diag = await ev.generateCapSuppressedDiagnostic('Reply with exactly 2 words.', noHistory, v);
    expect(diag).not.toBeNull();
    expect(diag!.stage).toBe('draft-3-cap-suppressed');
    expect(diag!.capSuppressed).toBe(true);
    expect(diag!.candidate).toBe('Two words');
    expect(diag!.verdict).toBe('pass');
  });

  it('survives revision-callback throwing — emits draft-1 with flag-uncertain', async () => {
    const gen = vi.fn(async () => {
      throw new Error('boom');
    });
    const ev = makeEvaluator([wordCountExact], gen);
    const v = await ev.evaluate('Reply with exactly 2 words.', noHistory, 'definitely wrong candidate string');
    expect(v.kind).toBe('flag-uncertain');
    expect(v.emit).toBe('definitely wrong candidate string');
    expect(v.revisionApplied).toBe(false);
  });

  it('exposes registered predicate ids for diagnostics', () => {
    const ev = new SelfEvaluator({
      predicates: CONSTRAINT_CHECKING_PREDICATES,
      generateRevision: async () => '',
    });
    expect(ev.registeredPredicateIds).toEqual(['format-line-count', 'word-count-exact', 'char-ban', 'topic-presence', 'quote-wrap', 'case-style', 'char-pattern']);
  });
});

// ───────────────────────── new strict-format predicates ─────────────────────────

import { quoteWrap, caseStyle, charPattern } from '../src/self-eval/index.js';

describe('quoteWrap predicate', () => {
  it('returns null when input does not request quotes', () => {
    expect(quoteWrap.derive('Tell me a name.', noHistory)).toBeNull();
  });
  it('passes when response is wrapped in double quotes', () => {
    const c = quoteWrap.derive('Reply with the name within quotes.', noHistory)!;
    expect(c.check('"Harald V"', '', noHistory)).toEqual({ ok: true });
  });
  it('fails when response is bare', () => {
    const c = quoteWrap.derive('Reply with the name within quotes.', noHistory)!;
    const r = c.check('Harald V', '', noHistory);
    expect(r.ok).toBe(false);
  });
});

describe('caseStyle predicate', () => {
  it('passes uppercase when "all caps" requested', () => {
    const c = caseStyle.derive('Reply YES in all caps.', noHistory)!;
    expect(c.check('YES', '', noHistory)).toEqual({ ok: true });
  });
  it('fails mixed case when uppercase required', () => {
    const c = caseStyle.derive('Reply in all caps.', noHistory)!;
    const r = c.check('Yes', '', noHistory);
    expect(r.ok).toBe(false);
  });
});

describe('charPattern predicate', () => {
  it('passes a 5-char "LL:LL" time string', () => {
    const c = charPattern.derive('respond with 4 letters + colon : in between', noHistory)!;
    expect(c.check('14:37', '', noHistory)).toEqual({ ok: true });
  });
  it('fails wrong length or wrong separator', () => {
    const c = charPattern.derive('respond with 4 letters + colon : in between', noHistory)!;
    expect(c.check('14:3', '', noHistory).ok).toBe(false);
    expect(c.check('14;37', '', noHistory).ok).toBe(false);
  });
});
