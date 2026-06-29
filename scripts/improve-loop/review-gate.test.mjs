// Run: node --test scripts/improve-loop/review-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickReviewer, buildReviewPrompt, parseReview, reviewVerdict,
  REVIEW_PASS_SCORE, REVIEWER_PREFERENCE,
} from './review-gate.mjs';

const GB = 1e9;
const installed = [
  { name: 'deepseek-r1:8b', sizeBytes: 5.2 * GB },
  { name: 'qwen3:8b', sizeBytes: 5.2 * GB },
  { name: 'qwen2.5:7b', sizeBytes: 4.7 * GB },
  { name: 'qwen2.5:3b', sizeBytes: 1.9 * GB },
];

test('pickReviewer: resident sane reviewer ⇒ use it, no swap (crash-safe)', () => {
  const r = pickReviewer({ installed, resident: 'qwen3:8b', headroomBytes: 1 * GB });
  assert.equal(r.model, 'qwen3:8b');
  assert.equal(r.swap, false);
});

test('pickReviewer: no resident ⇒ best-preferred that FITS headroom (quality-first within budget)', () => {
  // Only 5GB headroom ⇒ deepseek/qwen3 (5.2GB) do NOT fit; qwen2.5:7b (4.7GB) does.
  const r = pickReviewer({ installed, resident: null, headroomBytes: 5 * GB });
  assert.equal(r.model, 'qwen2.5:7b');
  assert.equal(r.swap, true);
});

test('pickReviewer: big headroom + no resident ⇒ most-preferred (fast direct-answering) model', () => {
  const r = pickReviewer({ installed, resident: null, headroomBytes: 8 * GB });
  assert.equal(r.model, 'qwen3:8b'); // top of preference (direct answerer), fits
});

test('pickReviewer: tiny headroom, irrelevant resident ⇒ fall back to resident, no forced load', () => {
  const r = pickReviewer({ installed, resident: 'some-other-model', headroomBytes: 0.5 * GB });
  assert.equal(r.model, 'some-other-model'); // nothing preferred fits → don't force a cold load
  assert.equal(r.swap, false);
});

test('pickReviewer: nothing installed ⇒ null (caller skips the gate)', () => {
  assert.equal(pickReviewer({ installed: [], resident: null, headroomBytes: 8 * GB }).model, null);
});

test('buildReviewPrompt: includes the diff, the three axes, and the strict format', () => {
  const p = buildReviewPrompt({ klass: 'routing/x', hypothesis: 'narrow the guard', find: 'if(A)', replace: 'if(A&&B)', why: 'too broad', sourceExcerpt: 'line' });
  assert.match(p, /routing\/x/);
  assert.match(p, /preserves intent/);
  assert.match(p, /MINIMAL/);
  assert.match(p, /SCORE: <0\.0-1\.0>/);
  assert.match(p, /if\(A&&B\)/);
});

test('parseReview: extracts score + axes from a clean verdict', () => {
  const v = parseReview('SCORE: 0.8\nINTENT: yes\nMINIMAL: yes\nHARM: none\nCONCERN: none');
  assert.equal(v.parsed, true);
  assert.equal(v.score, 0.8);
  assert.equal(v.intent, 'yes');
  assert.equal(v.harm, 'none');
});

test('parseReview: tolerant of surrounding prose; out-of-scale score is unparseable; flags unparseable', () => {
  // SCORE: 1.4 is OUT of the [0,1] scale — it must NOT clamp to a perfect 1.0 pass (CodeRabbit #25);
  // an out-of-scale reviewer answer is treated as unparseable so the gate can't be tricked into PASS.
  const v = parseReview('Sure! Here is my review.\n\nSCORE: 1.4\nINTENT: no\nHARM: possible\nCONCERN: loosens the price guard.\nHope this helps');
  assert.equal(v.score, null);
  assert.equal(v.parsed, false);
  assert.equal(v.outOfScale, true);
  assert.equal(v.intent, 'no'); // the other fields still parse
  assert.match(v.concern, /price guard/);
  assert.equal(parseReview('no structured output at all').parsed, false);

  // An in-scale score still parses normally.
  const ok = parseReview('SCORE: 0.8\nINTENT: yes\nHARM: none');
  assert.equal(ok.score, 0.8);
  assert.equal(ok.parsed, true);
});

test('reviewVerdict: PASS on high score, intent ok, no harm', () => {
  const v = reviewVerdict(parseReview('SCORE: 0.85\nINTENT: yes\nMINIMAL: yes\nHARM: none\nCONCERN: none'));
  assert.equal(v.pass, true);
});

test('reviewVerdict: HARD FAIL on intent:no or harm:possible regardless of score', () => {
  assert.equal(reviewVerdict(parseReview('SCORE: 0.95\nINTENT: no\nHARM: none')).pass, false);
  assert.equal(reviewVerdict(parseReview('SCORE: 0.95\nINTENT: yes\nHARM: possible')).pass, false);
});

test('reviewVerdict: FAIL on low score', () => {
  assert.equal(reviewVerdict(parseReview(`SCORE: ${REVIEW_PASS_SCORE - 0.1}\nINTENT: yes\nHARM: none`)).pass, false);
});

test('reviewVerdict: INDETERMINATE (unparseable) defers to mechanical gate (pass, flagged)', () => {
  const v = reviewVerdict(parseReview('the model rambled with no score'));
  assert.equal(v.pass, true);
  assert.equal(v.indeterminate, true);
});

test('REVIEWER_PREFERENCE: fast direct-answerer first, slow <think> model last', () => {
  assert.equal(REVIEWER_PREFERENCE[0], 'qwen3:8b');          // answers the verdict format directly
  assert.equal(REVIEWER_PREFERENCE.at(-1), 'deepseek-r1:8b'); // reasoning model times out — last resort
});
