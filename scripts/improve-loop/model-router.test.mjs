import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRoster, routeThroughModels, withModelMounted, tallyConsensus, buildBestAnswerVote, parseBestVote, isCoderModel } from './model-router.mjs';

const GB = 1024 ** 3;
const INSTALLED = [
  { name: 'deepseek-r1:8b', sizeBytes: 5.2 * GB },
  { name: 'qwen3:8b', sizeBytes: 5.2 * GB },
  { name: 'qwen2.5:7b', sizeBytes: 4.7 * GB },
  { name: 'qwen2.5:3b', sizeBytes: 1.9 * GB },
  { name: 'huge:70b', sizeBytes: 40 * GB },
];

test('pickRoster: biggest-first, excludes over-budget + excluded models, capped', () => {
  const r = pickRoster(INSTALLED, { budgetBytes: 8.5 * GB, max: 3, exclude: ['qwen3:8b'] });
  assert.deepEqual(r, ['deepseek-r1:8b', 'qwen2.5:7b', 'qwen2.5:3b']); // huge:70b excluded by budget, qwen3 by name
});

test('pickRoster: every model over budget ⇒ empty (never mounts something that wont fit)', () => {
  assert.deepEqual(pickRoster(INSTALLED, { budgetBytes: 1 * GB }), []);
});

test('isCoderModel: recognises code-specialized models', () => {
  assert.equal(isCoderModel('qwen2.5-coder:7b'), true);
  assert.equal(isCoderModel('deepseek-coder:6.7b'), true);
  assert.equal(isCoderModel('qwen3:8b'), false);
});

test('pickRoster: a CODER model is ranked first even if a general model is bigger', () => {
  const withCoder = [
    { name: 'qwen2.5-coder:7b', sizeBytes: 4.7 * GB },
    ...INSTALLED,
  ];
  const r = pickRoster(withCoder, { budgetBytes: 8.5 * GB, max: 3 });
  assert.equal(r[0], 'qwen2.5-coder:7b', 'the coder model leads the roundtable');
});

test('routeThroughModels: SERIAL — waits for headroom before EACH model, one at a time', async () => {
  const order = [];
  const res = await routeThroughModels('fix it', {
    roster: ['a', 'b', 'c'],
    waitForHeadroom: async () => order.push('wait'),
    budgetBytes: 8.5 * GB,
    generate: async (m) => { order.push(`gen:${m}`); return `ans-${m}`; },
  });
  // headroom check immediately precedes each model's generate, in order
  assert.deepEqual(order, ['wait', 'gen:a', 'wait', 'gen:b', 'wait', 'gen:c']);
  assert.equal(res.length, 3);
  assert.ok(res.every((r) => r.ok));
});

test('routeThroughModels: one broken model is captured, never sinks the round', async () => {
  const res = await routeThroughModels('p', {
    roster: ['good', 'broken', 'good2'],
    generate: async (m) => { if (m === 'broken') throw new Error('timeout'); return `ok-${m}`; },
  });
  assert.equal(res.find((r) => r.model === 'broken').ok, false);
  assert.equal(res.filter((r) => r.ok).length, 2, 'the other two still produced');
});

test('withModelMounted: ensures headroom THEN runs fn with the model', async () => {
  const seen = [];
  const out = await withModelMounted('m1', { waitForHeadroom: async () => seen.push('headroom'), budgetBytes: 1 },
    async (m) => { seen.push(`run:${m}`); return 42; });
  assert.equal(out, 42);
  assert.deepEqual(seen, ['headroom', 'run:m1']);
});

test('tallyConsensus: the answer the MOST DISTINCT models agree on wins', () => {
  const results = [
    { model: 'a', ok: true, answer: { fix: 'X' } },
    { model: 'b', ok: true, answer: { fix: 'X' } },
    { model: 'c', ok: true, answer: { fix: 'Y' } },
    { model: 'd', ok: false, answer: null },
  ];
  const t = tallyConsensus(results, (a) => a.fix);
  assert.equal(t.winner.key, 'X');
  assert.deepEqual(t.winner.models.sort(), ['a', 'b']);
  assert.equal(t.distinctModels, 3);
});

test('tallyConsensus: a tie is broken toward the bigger/earlier model (rosterRank)', () => {
  const results = [
    { model: 'big', ok: true, answer: { fix: 'A' } },
    { model: 'small', ok: true, answer: { fix: 'B' } },
  ];
  const rank = (m) => (m === 'big' ? 0 : 9); // big is earlier/bigger
  const t = tallyConsensus(results, (a) => a.fix, { rosterRank: rank });
  assert.equal(t.winner.key, 'A', 'tie broken to the bigger model');
});

test('best-answer meta-vote prompt + parse round-trips', () => {
  const p = buildBestAnswerVote('regex too narrow', [
    { model: 'a', summary: 'add time-sensitive' },
    { model: 'b', summary: 'truncated regex' },
  ]);
  assert.match(p, /CANDIDATES/);
  assert.match(p, /from a/);
  assert.deepEqual(parseBestVote('{"best": 1, "why": "complete"}', 2), { best: 1, why: 'complete' });
  assert.equal(parseBestVote('{"best": 9}', 2), null, 'out-of-range rejected');
  assert.equal(parseBestVote('no json here', 2), null);
});
