// Run: node --test --experimental-sqlite scripts/improve-loop/experiment-generator.test.mjs
// node:test (improve-loop tooling lives outside vitest). Importing pulls in db.mjs
// (node:sqlite) so --experimental-sqlite is required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  hashVariant,
  mineWeakestGap,
  buildGenPrompt,
  parseGenerated,
  generateNovelExperiment,
  VALID_TYPES,
} from './experiment-generator.mjs';
import { openDb, startRun, recordResult, upsertPrompt } from './db.mjs';

function tmpDb() {
  const f = join(tmpdir(), `vai-gen-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  return { f, db: openDb(f) };
}
function seedClass(db, klass, passed, total) {
  const runId = startRun(db, 'r');
  for (let k = 0; k < total; k++) {
    const pid = upsertPrompt(db, { prompt: `${klass}-${runId}-${k}`, klass, expectedIntent: 'x', origin: 'seed' });
    recordResult(db, { runId, promptId: pid, klass, readAs: 'demo', passed: k < passed, gradeReason: k < passed ? 'ok' : 'misread the intent' });
  }
}

test('hashVariant: stable + unique per text', () => {
  assert.equal(hashVariant('abc'), hashVariant('abc'));
  assert.notEqual(hashVariant('abc'), hashVariant('abd'));
  assert.match(hashVariant('anything'), /^gen-[0-9a-z]+$/);
});

test('mineWeakestGap: picks the lowest-pass-rate class with enough samples', () => {
  const { f, db } = tmpDb();
  try {
    seedClass(db, 'strong/class', 9, 10); // 90%
    seedClass(db, 'weak/class', 2, 10);   // 20% ⇐ weakest
    seedClass(db, 'tiny/class', 0, 2);    // 0% but below minTotal ⇒ ignored
    const gap = mineWeakestGap(db, { minTotal: 4 });
    assert.equal(gap.klass, 'weak/class');
    assert.equal(gap.total, 10);
    assert.ok(gap.reasons.length >= 1); // dominant failure reasons mined
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('mineWeakestGap: null when no class has enough samples', () => {
  const { f, db } = tmpDb();
  try {
    seedClass(db, 'tiny', 0, 2);
    assert.equal(mineWeakestGap(db, { minTotal: 4 }), null);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('buildGenPrompt: includes the gap, the four valid types, and the avoid-list', () => {
  const p = buildGenPrompt({ klass: 'weak/x', passRate: 0.2, passed: 2, total: 10, reasons: ['misread'] }, ['gen-abc']);
  assert.match(p, /weak\/x/);
  assert.match(p, /20%/);
  assert.match(p, /model \| prompt \| grading \| seed_class/);
  assert.match(p, /gen-abc/); // told not to repeat
  assert.match(p, /STRICT JSON/);
});

test('parseGenerated: extracts JSON from prose-wrapped output', () => {
  const gap = { klass: 'weak/x' };
  const out = parseGenerated('Sure! Here is my idea:\n```json\n{"type":"prompt","hypothesis":"Add explicit intent examples to the propose prompt for this class."}\n```\nHope that helps.', gap);
  assert.ok(out);
  assert.equal(out.type, 'prompt');
  assert.ok(VALID_TYPES.has(out.type));
  assert.equal(out.config.generated, true);
  assert.equal(out.config.klass, 'weak/x');
  assert.match(out.config.variant, /^gen-/);
});

test('parseGenerated: rejects invalid type, too-short hypothesis, and non-JSON', () => {
  assert.equal(parseGenerated('{"type":"wizardry","hypothesis":"this is a long enough hypothesis string here"}', {}), null);
  assert.equal(parseGenerated('{"type":"prompt","hypothesis":"too short"}', {}), null);
  assert.equal(parseGenerated('no json here at all', {}), null);
  assert.equal(parseGenerated('', {}), null);
});

test('generateNovelExperiment: grounded candidate from injected model', async () => {
  const { f, db } = tmpDb();
  try {
    seedClass(db, 'weak/class', 2, 10);
    const fake = async (prompt) => {
      assert.match(prompt, /weak\/class/); // prompt is grounded in the mined gap
      return '{"type":"grading","hypothesis":"Tighten the rubric so near-miss intent reads are scored as fails for this class."}';
    };
    const cand = await generateNovelExperiment(db, { generate: fake });
    assert.ok(cand);
    assert.equal(cand.type, 'grading');
    assert.equal(cand.config.klass, 'weak/class');
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('generateNovelExperiment: null on no signal and on model failure (honest, never throws)', async () => {
  const { f, db } = tmpDb();
  try {
    // No signal yet ⇒ null without even calling the model.
    assert.equal(await generateNovelExperiment(db, { generate: async () => { throw new Error('should not be called'); } }), null);
    seedClass(db, 'weak/class', 2, 10);
    // Model throws ⇒ caught ⇒ null (loop falls back to deterministic pool).
    assert.equal(await generateNovelExperiment(db, { generate: async () => { throw new Error('model down'); } }), null);
    // Model returns garbage ⇒ null.
    assert.equal(await generateNovelExperiment(db, { generate: async () => 'lol no' }), null);
  } finally { db.close(); rmSync(f, { force: true }); }
});
