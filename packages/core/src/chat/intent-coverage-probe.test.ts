import { describe, it, expect } from 'vitest';
import { classifyQuestionIntent, classifyQuestionIntentSmart } from './question-intent.js';
import type { QuestionIntent } from './question-intent.js';

/**
 * Before/after coverage probe for the intent-classification widening (Slice 2).
 *
 * The value claim is precise and measurable: adding the lexical-feature scorer
 * SHRINKS the `'other'` bucket (turns with a real intent the regex cascade
 * didn't shape-match) WITHOUT changing any turn the regex path already decided,
 * and without misclassifying turns that are genuinely intent-less.
 *
 * Every RECOVERABLE fixture below was verified to return `'other'` under the
 * regex path alone (see the first test — it fails loudly if a fixture drifts
 * into being regex-handled, which would make the coverage number meaningless).
 */

// Turns with a REAL intent that the high-precision regex cascade returns `'other'`
// for (unusual phrasing / missing a crisp anchor). Confirmed regex-missed via the
// empirical verdict dump. These are exactly the wrong-lane risk turns the scorer
// is meant to recover.
const RECOVERABLE: ReadonlyArray<{ prompt: string; intent: QuestionIntent }> = [
  { prompt: 'recommend a solid approach for offline sync', intent: 'recommendation' },
  { prompt: 'suggest a lightweight charting library', intent: 'recommendation' },
  { prompt: 'i want the best way to cache api responses', intent: 'recommendation' },
  { prompt: 'any advice on structuring a monorepo', intent: 'recommendation' },
  { prompt: 'thinking about the best database for this', intent: 'recommendation' },
  { prompt: 'is redux or zustand the smarter pick here', intent: 'recommendation' },
  { prompt: 'spin up a websocket server', intent: 'build' },
  { prompt: 'i need a script that renames files', intent: 'build' },
  { prompt: 'talk me through what a monad actually is', intent: 'definition' },
  { prompt: 'break down what a closure is', intent: 'definition' },
  { prompt: 'roughly how tall is mount everest', intent: 'factual-lookup' },
];

// Control set: genuinely intent-less small talk / statements. The scorer must
// NOT invent an intent for these — they must stay `'other'`.
const GENUINELY_OTHER: readonly string[] = [
  'the coffee here is fine i guess',
  'hmm ok cool',
  'that was a long day honestly',
  'nice weather we are having',
];

describe('intent coverage probe — scorer shrinks `other` without harming precision', () => {
  it('every recoverable turn is `other` under the regex path alone (probe stays meaningful)', () => {
    for (const { prompt } of RECOVERABLE) {
      expect(classifyQuestionIntent(prompt), `regex should drop "${prompt}" to other`).toBe('other');
    }
  });

  it('the smart classifier recovers a strong majority of the recoverable turns', () => {
    let recovered = 0;
    const misses: string[] = [];
    for (const { prompt, intent } of RECOVERABLE) {
      const smart = classifyQuestionIntentSmart(prompt);
      if (smart.intent === intent && smart.source === 'scorer') recovered += 1;
      else misses.push(`${prompt} → ${smart.intent} (${smart.source})`);
    }
    // Pin the measured win: ≥80% of the known-recoverable turns are now classified
    // correctly by the scorer (was 0% — all `other` — before Slice 2). `misses`
    // is surfaced in the failure message so a regression names the drifted prompt.
    const rate = recovered / RECOVERABLE.length;
    expect(rate, `recovered ${recovered}/${RECOVERABLE.length}; misses: ${misses.join(' | ')}`)
      .toBeGreaterThanOrEqual(0.8);
  });

  it('does NOT invent an intent for genuinely intent-less turns (precision guard)', () => {
    for (const prompt of GENUINELY_OTHER) {
      expect(classifyQuestionIntentSmart(prompt).intent, `"${prompt}" must stay other`).toBe('other');
    }
  });
});
