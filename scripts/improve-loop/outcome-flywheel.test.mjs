// Outcome flywheel — pure/injected, runs on node:sqlite (no models, no GPU).
// node --test --experimental-sqlite scripts/improve-loop/outcome-flywheel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureQueueTable } from './self-improve-queue.mjs';
import {
  harvestLessons,
  lessonDirective,
  normalizeReason,
  retryGeneration,
  retryCandidates,
  runOutcomeFlywheel,
} from './outcome-flywheel.mjs';

const mkDb = () => { const db = new DatabaseSync(':memory:'); ensureQueueTable(db); return db; };
const seed = (db, over = {}) => {
  const row = {
    fingerprint: 'fp-a', instruction: 'Add a live price feed capability', why: 'gap',
    location: null, member_id: 'm1', klass: 'capability', status: 'held',
    created_at: '2026-06-28T00:00:00Z', updated_at: '2026-06-28T00:00:00Z', ...over,
  };
  db.prepare('INSERT INTO self_improve_queue (fingerprint,instruction,why,location,member_id,klass,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(row.fingerprint, row.instruction, row.why, row.location, row.member_id, row.klass, row.status, row.created_at, row.updated_at);
  return row;
};
const NOW = new Date('2026-07-03T12:00:00Z');

test('normalizeReason buckets equivalent phrasings', () => {
  assert.equal(normalizeReason('Missed 3 edge cases!'), normalizeReason('missed 12 edge cases'));
});

test('harvestLessons keeps only recurring rejection reasons', () => {
  const entries = [
    { kind: 'shelved', title: 'A', peers: { rejects: ['no tests added for the new module'] } },
    { kind: 'held', title: 'B', peers: { dissent: ['No tests added for the new module.'] } },
    { kind: 'shelved', title: 'C', peers: { rejects: ['one-off style nit'] } },
    { kind: 'integrated', title: 'D', peers: { rejects: ['should never count'] } },
  ];
  const lessons = harvestLessons(entries);
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].count, 2);
  assert.deepEqual(lessons[0].sources.sort(), ['A', 'B']);
});

test('lessonDirective renders a builder-ready block (empty when no lessons)', () => {
  assert.equal(lessonDirective([]), '');
  const d = lessonDirective([{ lesson: 'no tests added', count: 3 }]);
  assert.match(d, /do NOT repeat/);
  assert.match(d, /no tests added \(seen 3×\)/);
});

test('retryGeneration parses fingerprint suffixes', () => {
  assert.equal(retryGeneration('abc'), 0);
  assert.equal(retryGeneration('abc:r2'), 2);
});

test('retryCandidates: only aged held jobs, generation-capped, bounded', () => {
  const db = mkDb();
  seed(db); // aged held → candidate
  seed(db, { fingerprint: 'fp-fresh', updated_at: '2026-07-03T09:00:00Z' }); // too fresh
  seed(db, { fingerprint: 'fp-old:r2' }); // generation cap reached
  seed(db, { fingerprint: 'fp-q', status: 'queued' }); // not held
  const c = retryCandidates(db, { now: NOW, heldAgeDays: 2, maxRetries: 5, maxGenerations: 2 });
  assert.deepEqual(c.map((r) => r.fingerprint), ['fp-a']);
});

test('runOutcomeFlywheel retries an aged held job with lessons appended', () => {
  const db = mkDb();
  seed(db);
  const entries = [
    { kind: 'shelved', title: 'X', peers: { rejects: ['scaffold instead of a real feature'] } },
    { kind: 'held', title: 'Y', peers: { rejects: ['Scaffold instead of a real feature'] } },
  ];
  const out = runOutcomeFlywheel(db, { entries, now: NOW });
  assert.equal(out.retried, 1);
  const retry = db.prepare("SELECT * FROM self_improve_queue WHERE status='queued'").get();
  assert.equal(retry.fingerprint, 'fp-a:r1');
  assert.match(retry.instruction, /Add a live price feed capability/);
  assert.match(retry.instruction, /do NOT repeat/);
  const original = db.prepare("SELECT * FROM self_improve_queue WHERE fingerprint='fp-a'").get();
  assert.match(original.outcome, /retried as gen 1/);
});

test('runOutcomeFlywheel is idempotent: a held job is promoted exactly once', () => {
  const db = mkDb();
  seed(db);
  runOutcomeFlywheel(db, { now: NOW });
  // Second turn: the original row is marked 'retried as gen 1' → no longer a candidate.
  const out2 = runOutcomeFlywheel(db, { now: NOW });
  assert.equal(out2.retried, 0);
  const open = db.prepare("SELECT COUNT(*) AS n FROM self_improve_queue WHERE status='queued'").get();
  assert.equal(open.n, 1);
});

test('disabled flywheel does nothing', () => {
  const db = mkDb();
  seed(db);
  const out = runOutcomeFlywheel(db, { now: NOW, config: { enabled: false } });
  assert.equal(out.disabled, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM self_improve_queue WHERE status='queued'").get().n, 0);
});
