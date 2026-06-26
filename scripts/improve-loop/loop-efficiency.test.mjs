import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, recordKnowledge, strikeFix, targetFailures, isTargetExhausted, ungroundableClasses, TARGET_FAIL_LIMIT } from './db.mjs';

const db0 = () => openDb(':memory:');
const seedClass = (db, klass, total, passed, location) => {
  const runId = db.prepare("INSERT INTO runs (started_at) VALUES (?)").run(new Date().toISOString()).lastInsertRowid;
  const now = new Date().toISOString();
  for (let i = 0; i < total; i++) {
    db.prepare("INSERT INTO results (run_id, prompt_id, class, passed, outcome, created_at) VALUES (?,?,?,?,?,?)")
      .run(runId, i + 1, klass, i < passed ? 1 : 0, 'x', now);
  }
  db.prepare("INSERT INTO fixes (run_id,class,failure_count,location,summary,created_at) VALUES (?,?,?,?,?,?)")
    .run(runId, klass, total - passed, location, 's', now);
};

test('targetFailures counts DISTINCT failed finds on a file (the near-miss signal)', () => {
  const db = db0();
  const f = 'packages/core/x.ts';
  strikeFix(db, { file: f, find: 'A', replace: 'A1' }, 'tsc');
  strikeFix(db, { file: f, find: 'B', replace: 'B1' }, 'tsc'); // different find → distinct
  strikeFix(db, { file: f, find: 'A', replace: 'A1' }, 'tsc'); // same as first → not distinct
  assert.equal(targetFailures(db, f), 2, '2 distinct finds failed');
});

test('isTargetExhausted trips at TARGET_FAIL_LIMIT distinct failures (catches signature-dodging)', () => {
  const db = db0();
  const f = 'a/b.ts';
  for (let i = 0; i < TARGET_FAIL_LIMIT; i++) strikeFix(db, { file: f, find: `find${i}`, replace: `r${i}` }, 'tsc');
  assert.equal(isTargetExhausted(db, f), true, 'distinct near-misses now ban the TARGET even though no single signature did');
});

test('a class whose file is exhausted is excluded from targeting (while other work remains)', () => {
  const db = db0();
  const file = 'packages/core/src/chat/build-execution-intent.ts';
  seedClass(db, 'routing/fresh-data-trigger', 22, 12, `${file}:88`);
  // A SECOND fixable class on a different, healthy file — so the loop isn't fully starved and the
  // anti-starvation escape valve does NOT fire (it only relaxes exhaustion when EVERY class is blocked).
  seedClass(db, 'routing/other', 20, 8, 'packages/core/src/chat/contextual-resolver.ts:27');
  for (let i = 0; i < TARGET_FAIL_LIMIT; i++) strikeFix(db, { file, find: `near${i}`, replace: `x${i}` }, 'tsc');
  const skip = ungroundableClasses(db);
  assert.ok(skip.has('routing/fresh-data-trigger'), 'exhausted-target class is skipped while other work remains');
  assert.equal(skip.has('routing/other'), false, 'the healthy class stays fixable');
});

test('ESCAPE VALVE: if EVERY class is exhausted, exhaustion is relaxed so the loop is never starved', () => {
  const db = db0();
  const file = 'packages/core/src/chat/build-execution-intent.ts';
  seedClass(db, 'routing/only', 22, 12, `${file}:88`);
  for (let i = 0; i < TARGET_FAIL_LIMIT; i++) strikeFix(db, { file, find: `near${i}`, replace: `x${i}` }, 'tsc');
  // The single class would be exhausted → loop fully starved → escape valve relaxes it.
  assert.equal(ungroundableClasses(db).has('routing/only'), false, 'sole exhausted class is relaxed (anti-starvation)');
});

test('EFFICIENCY: a recently-fixed class is skipped until re-observed (no re-target of a fixed class)', () => {
  const db = db0();
  seedClass(db, 'routing/fresh-data-trigger', 22, 12, 'packages/core/src/chat/build-execution-intent.ts:88');
  // before: it is a valid target (real file, failing). after a commit it must be skipped.
  assert.equal(ungroundableClasses(db).has('routing/fresh-data-trigger'), false);
  recordKnowledge(db, { scope: 'class:recently-fixed', claim: 'class "routing/fresh-data-trigger" just received a committed fix — re-observe before targeting again', confirm: true });
  assert.ok(ungroundableClasses(db).has('routing/fresh-data-trigger'), 'skipped after commit until re-observed');
});

test('a recently-fixed class re-observed as STILL failing (contradicted) becomes targetable again', () => {
  const db = db0();
  seedClass(db, 'x/y', 10, 2, 'packages/core/z.ts:10');
  const claim = 'class "x/y" just received a committed fix — re-observe before targeting again';
  recordKnowledge(db, { scope: 'class:recently-fixed', claim, confirm: true });
  assert.ok(ungroundableClasses(db).has('x/y'));
  recordKnowledge(db, { scope: 'class:recently-fixed', claim, confirm: false }); // re-observed: still failing
  recordKnowledge(db, { scope: 'class:recently-fixed', claim, confirm: false });
  assert.equal(ungroundableClasses(db).has('x/y'), false, 'targetable again once re-observation contradicts the fix');
});
