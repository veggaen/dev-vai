import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, startRun, recordResult, upsertPrompt, lastScoredByPrompt } from './db.mjs';

const seed = (db, prompt, klass, scoredAt) => {
  const pid = upsertPrompt(db, { prompt, klass, expectedIntent: 'x', origin: 'seed' });
  const runId = startRun(db, 't');
  recordResult(db, { runId, promptId: pid, klass, passed: true, gradeReason: 'ok' });
  // overwrite created_at to a controlled time so ordering is deterministic
  db.prepare('UPDATE results SET created_at = ? WHERE prompt_id = ?').run(scoredAt, pid);
  return pid;
};

test('lastScoredByPrompt returns the latest score time per prompt text', () => {
  const db = openDb(':memory:');
  seed(db, 'A', 'k', '2026-06-25T01:00:00Z');
  seed(db, 'B', 'k', '2026-06-25T03:00:00Z');
  const m = lastScoredByPrompt(db);
  assert.equal(m.get('A'), '2026-06-25T01:00:00Z');
  assert.equal(m.get('B'), '2026-06-25T03:00:00Z');
  assert.equal(m.get('never-seen'), undefined);
});

test('least-recently-scored-first ordering advances through the corpus', () => {
  const db = openDb(':memory:');
  seed(db, 'A', 'k', '2026-06-25T05:00:00Z'); // scored most recently
  seed(db, 'B', 'k', '2026-06-25T01:00:00Z'); // scored long ago
  // C is never scored
  const work = [{ prompt: 'A' }, { prompt: 'B' }, { prompt: 'C' }];
  const lastScored = lastScoredByPrompt(db);
  const ordered = work
    .map((item, i) => ({ item, i, last: lastScored.get(item.prompt) ?? '' }))
    .sort((a, b) => (a.last < b.last ? -1 : a.last > b.last ? 1 : a.i - b.i))
    .map((x) => x.item.prompt);
  // never-scored (C) first, then oldest (B), then most-recent (A) — a bounded cycle now picks up
  // the work that has gone longest without attention, instead of always re-doing the front.
  assert.deepEqual(ordered, ['C', 'B', 'A']);
});

test('ordering is stable for equal scores (keeps authored order)', () => {
  const db = openDb(':memory:');
  // both never scored → tie → original order preserved
  const work = [{ prompt: 'X' }, { prompt: 'Y' }, { prompt: 'Z' }];
  const lastScored = lastScoredByPrompt(db);
  const ordered = work
    .map((item, i) => ({ item, i, last: lastScored.get(item.prompt) ?? '' }))
    .sort((a, b) => (a.last < b.last ? -1 : a.last > b.last ? 1 : a.i - b.i))
    .map((x) => x.item.prompt);
  assert.deepEqual(ordered, ['X', 'Y', 'Z']);
});

test('wall-clock budget logic: stop starting turns once elapsed >= budget', () => {
  // Pure check of the guard condition used in run.mjs.
  const MAX_RUN_MS = 5_000;
  const started = 1_000_000;
  const overBudget = (now) => MAX_RUN_MS > 0 && now - started >= MAX_RUN_MS;
  assert.equal(overBudget(started + 4_999), false); // still within budget
  assert.equal(overBudget(started + 5_000), true);  // budget reached → stop
  // disabled (0) never stops
  const noBudget = (now) => 0 > 0 && now - started >= 0;
  assert.equal(noBudget(started + 10_000_000), false);
});
