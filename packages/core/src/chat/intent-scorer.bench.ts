import { bench, describe } from 'vitest';
import { scoreQuestionIntent } from './intent-scorer.js';
import { classifyQuestionIntent, classifyQuestionIntentSmart } from './question-intent.js';

/**
 * Latency guard for the intent-classification hot path (Slice 2).
 *
 * The scorer is a pure table walk over already-tokenized input, so the added
 * cost over the bare regex classifier must be negligible. Run with:
 *   node ../../node_modules/vitest/vitest.mjs bench src/chat/intent-scorer.bench.ts
 *
 * Compare `classifyQuestionIntentSmart` (regex + scorer fallback) against
 * `classifyQuestionIntent` (regex only): the smart path should stay in the same
 * order of magnitude. A regex-hit turn never touches the scorer; an `'other'`
 * turn does the one extra table walk.
 */

// A regex-hit turn (scorer never consulted) and an `'other'` turn (scorer runs).
const REGEX_HIT = 'what is the capital of Japan?';
const SCORER_PATH = 'recommend a solid approach for offline sync';

describe('intent classification latency', () => {
  bench('classifyQuestionIntent (regex only) — regex hit', () => {
    classifyQuestionIntent(REGEX_HIT);
  });

  bench('classifyQuestionIntentSmart — regex hit (scorer skipped)', () => {
    classifyQuestionIntentSmart(REGEX_HIT);
  });

  bench('classifyQuestionIntentSmart — other turn (scorer runs)', () => {
    classifyQuestionIntentSmart(SCORER_PATH);
  });

  bench('scoreQuestionIntent (scorer alone)', () => {
    scoreQuestionIntent(SCORER_PATH);
  });
});
