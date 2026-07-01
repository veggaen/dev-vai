import { describe, it, expect } from 'vitest';
import { scoreQuestionIntent, debugScoreQuestionIntent } from './intent-scorer.js';
import { classifyQuestionIntent, classifyQuestionIntentSmart } from './question-intent.js';

// ── the scorer produces a normalized distribution ────────────────────────────

describe('scoreQuestionIntent — distribution shape', () => {
  it('returns a distribution that sums to ~1', () => {
    const r = scoreQuestionIntent('what is the capital of France?');
    const sum = r.distribution.reduce((a, d) => a + d.score, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('collapses all mass onto `other` with margin 0 when no feature fires', () => {
    const r = scoreQuestionIntent('hmm, the weather sure is grey lately');
    expect(r.top.intent).toBe('other');
    expect(r.margin).toBe(0);
    expect(r.top.features).toEqual([]);
  });

  it('is decisive (large margin) on a clean single-lane turn', () => {
    const r = scoreQuestionIntent('what is the capital of Norway?');
    expect(r.top.intent).toBe('factual-lookup');
    expect(r.margin).toBeGreaterThan(0.25);
  });

  it('exposes the features that fired for the winning intent (auditable)', () => {
    const r = scoreQuestionIntent('recommend a good coffee grinder');
    expect(r.top.intent).toBe('recommendation');
    expect(r.top.features).toContain('recommend-vocab');
  });
});

// ── the scorer's guesses on representative turns ─────────────────────────────

describe('scoreQuestionIntent — lane guesses', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['recommend a lightweight state library', 'recommendation'],
    ['which is the better choice here', 'recommendation'],
    ['explain the concept of tail-call optimization', 'definition'],
    ['make me a landing page component', 'build'],
    ['scaffold an api server with auth', 'build'],
    ['how many moons does Jupiter have', 'factual-lookup'],
  ];
  for (const [prompt, expected] of cases) {
    it(`scores "${prompt}" → ${expected}`, () => {
      expect(scoreQuestionIntent(prompt).top.intent).toBe(expected);
    });
  }
});

// ── the smart classifier is a strict superset of the regex classifier ────────

describe('classifyQuestionIntentSmart — never overrides a confident regex verdict', () => {
  const regexDecided: readonly string[] = [
    'what is the capital of Japan?',
    'who is Ada Lovelace?',
    'build me a dashboard app',
    'does Starbucks make cappuccino?',
    'explain closures in javascript',
    'what was my first message',
  ];
  for (const prompt of regexDecided) {
    it(`keeps the regex verdict for "${prompt}"`, () => {
      const regex = classifyQuestionIntent(prompt);
      const smart = classifyQuestionIntentSmart(prompt);
      // The regex path had a concrete opinion → smart returns it unchanged, source=regex.
      if (regex !== 'other') {
        expect(smart.intent).toBe(regex);
        expect(smart.source).toBe('regex');
      }
    });
  }
});

describe('debugScoreQuestionIntent — exposes the raw evidence', () => {
  it('lists the exact features that fired and the raw vote total', () => {
    const d = debugScoreQuestionIntent('recommend a good coffee grinder');
    expect(d.top.intent).toBe('recommendation');
    expect(d.fired.map((f) => f.id)).toContain('recommend-vocab');
    expect(d.rawTotal).toBeGreaterThan(0);
    // The distribution matches the non-debug function exactly (debug is a superset).
    expect(d.distribution).toEqual(scoreQuestionIntent('recommend a good coffee grinder').distribution);
  });

  it('reports no fired features and rawTotal 0 for intent-less text', () => {
    const d = debugScoreQuestionIntent('hmm ok cool');
    expect(d.fired).toEqual([]);
    expect(d.rawTotal).toBe(0);
    expect(d.top.intent).toBe('other');
  });
});

describe('classifyQuestionIntentSmart — shrinks the `other` bucket', () => {
  it('recovers a recommendation the regex path dropped to `other`', () => {
    // Phrased without the regex recommendation anchors, so the regex path yields `other`.
    const prompt = 'recommend a solid approach for offline sync';
    // Guard: this test is only meaningful if the regex really returns `other` here.
    expect(classifyQuestionIntent(prompt)).toBe('other');
    const smart = classifyQuestionIntentSmart(prompt);
    expect(smart.intent).toBe('recommendation');
    expect(smart.source).toBe('scorer');
  });

  it('stays with `other` when the scorer is not decisive enough (ambiguous turn)', () => {
    const prompt = 'the coffee here is fine i guess';
    expect(classifyQuestionIntent(prompt)).toBe('other');
    const smart = classifyQuestionIntentSmart(prompt);
    expect(smart.intent).toBe('other');
    expect(smart.source).toBe('regex');
  });
});
