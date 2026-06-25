import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, recordKnowledge, ungroundableClasses } from './db.mjs';
import { buildLoopContext } from './loop-processes.mjs';

const db0 = () => openDb(':memory:');

// Seed N results for a class with a given pass count, so it shows up in campaignClassStats.
// campaignClassStats only reads results(class, passed), so seed results directly (no prompts).
let _pid = 0;
function seedClass(db, klass, total, passed) {
  const runId = db.prepare("INSERT INTO runs (started_at) VALUES (?)").run(new Date().toISOString()).lastInsertRowid;
  const now = new Date().toISOString();
  for (let i = 0; i < total; i++) {
    db.prepare("INSERT INTO results (run_id, prompt_id, class, passed, outcome, created_at) VALUES (?,?,?,?,?,?)")
      .run(runId, ++_pid, klass, i < passed ? 1 : 0, 'x', now);
  }
}

test('ungroundableClasses reads propose:no-file facts into a Set', () => {
  const db = db0();
  assert.equal(ungroundableClasses(db).size, 0, 'empty when no facts');
  recordKnowledge(db, { scope: 'propose:no-file', claim: 'class "routing/comparison" has no resolvable source file', kind: 'guard', confirm: true });
  const set = ungroundableClasses(db);
  assert.ok(set.has('routing/comparison'), 'flagged class is in the set');
});

test('PROACTIVE: a class whose fix location is a placeholder is ungroundable from the start', () => {
  const db = db0();
  const now = new Date().toISOString();
  // placeholder location → ungroundable; real path → groundable. No no-file fact needed.
  db.prepare("INSERT INTO fixes (run_id,class,failure_count,location,summary,created_at) VALUES (?,?,?,?,?,?)")
    .run(1, 'answer/curated-trap', 9, '(unknown — investigate)', 's', now);
  db.prepare("INSERT INTO fixes (run_id,class,failure_count,location,summary,created_at) VALUES (?,?,?,?,?,?)")
    .run(1, 'routing/fresh-data-trigger', 9, 'packages/core/src/chat/build-execution-intent.ts:88', 's', now);
  const set = ungroundableClasses(db);
  assert.ok(set.has('answer/curated-trap'), 'placeholder location ⇒ ungroundable');
  assert.equal(set.has('routing/fresh-data-trigger'), false, 'real .ts path ⇒ groundable');
});

test('a class that recovered (contradicted > confirmed) is NOT ungroundable', () => {
  const db = db0();
  const claim = 'class "x/y" has no resolvable source file';
  recordKnowledge(db, { scope: 'propose:no-file', claim, confirm: true });   // 1 confirm
  recordKnowledge(db, { scope: 'propose:no-file', claim, confirm: false });  // 1 contra
  recordKnowledge(db, { scope: 'propose:no-file', claim, confirm: false });  // 2 contra → recovered
  assert.equal(ungroundableClasses(db).has('x/y'), false, 'contradicted-more ⇒ groundable again');
});

test('buildLoopContext does NOT pick an ungroundable class as worstClass', () => {
  const db = db0();
  // weakest by pass-rate is the ungroundable one; the next-weakest is fixable.
  seedClass(db, 'routing/comparison', 10, 1);   // 10% — weakest, but ungroundable
  seedClass(db, 'routing/fresh-data', 10, 5);    // 50% — fixable
  recordKnowledge(db, { scope: 'propose:no-file', claim: 'class "routing/comparison" has no resolvable source file', confirm: true });
  const ctx = buildLoopContext(db, { motion: { state: 'flat' }, cycle: 1 });
  assert.notEqual(ctx.worstClass, 'routing/comparison', 'must skip the ungroundable class');
  assert.equal(ctx.worstClass, 'routing/fresh-data', 'falls through to the next fixable class');
});

test('with no fixable class left, worstClass is null (engine yields, does not spin)', () => {
  const db = db0();
  seedClass(db, 'routing/comparison', 10, 1);
  recordKnowledge(db, { scope: 'propose:no-file', claim: 'class "routing/comparison" has no resolvable source file', confirm: true });
  const ctx = buildLoopContext(db, { motion: { state: 'flat' }, cycle: 1 });
  assert.equal(ctx.worstClass, null, 'no groundable failing class ⇒ null, not the dead one');
});
