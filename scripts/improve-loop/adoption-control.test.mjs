// Run: node --test --experimental-sqlite scripts/improve-loop/adoption-control.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  adoptionEvents,
  adoptionFingerprint,
  buildAdoptionBoard,
  deriveGenerationPolicy,
  ensureAdoptionTables,
  recordAdoptionDecision,
  validateAdoptionBoard,
} from './adoption-control.mjs';

function dbFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE fixes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, class TEXT NOT NULL,
      failure_count INTEGER NOT NULL, location TEXT, summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL
    );
    CREATE TABLE proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fix_id INTEGER, class TEXT, file TEXT,
      find TEXT, "replace" TEXT, why TEXT, raw TEXT, status TEXT, created_at TEXT
    );
    CREATE TABLE compute_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, model_calls INTEGER, wall_ms INTEGER,
      proposals INTEGER, qualified INTEGER, adopted INTEGER NOT NULL DEFAULT 0,
      council_overall REAL, cross_refs INTEGER, created_at TEXT NOT NULL
    );
  `);
  return db;
}

function seedFix(db, overrides = {}) {
  const row = {
    runId: 1,
    klass: 'answer/freshness',
    failures: 3,
    location: 'packages/core/src/chat/service.ts:42',
    summary: 'Fresh answer did not retrieve current data',
    status: 'queued',
    createdAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
  const info = db.prepare(`
    INSERT INTO fixes (run_id,class,failure_count,location,summary,status,created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(row.runId, row.klass, row.failures, row.location, row.summary, row.status, row.createdAt);
  return Number(info.lastInsertRowid);
}

function seedCompute(db, { calls = 20, qualified = 4, adopted = 0 } = {}) {
  const info = db.prepare(`
    INSERT INTO compute_log (model_calls,wall_ms,proposals,qualified,adopted,created_at)
    VALUES (?,?,?,?,?,?)
  `).run(calls, 1000, qualified, qualified, adopted, '2026-07-20T00:00:00.000Z');
  return Number(info.lastInsertRowid);
}

function approve(db, fp, now = new Date('2026-07-24T12:00:00.000Z')) {
  return recordAdoptionDecision(db, fp, {
    status: 'approved',
    reason: 'The repeated failures justify a measured repair.',
    assignee: 'owner',
    risk: 'medium',
    expiresAt: '2026-08-24T12:00:00.000Z',
    rollback: 'Revert the named shipment commit after a failed gate.',
  }, { now });
}

test('deduplicates repeated historical fixes into one stable, bounded item', () => {
  const db = dbFixture();
  const first = seedFix(db);
  const second = seedFix(db, { runId: 2, failures: 5, createdAt: '2026-07-21T00:00:00.000Z' });
  db.prepare('INSERT INTO proposals (fix_id,status,created_at) VALUES (?,?,?)')
    .run(first, 'proposed', '2026-07-20T01:00:00.000Z');
  db.prepare('INSERT INTO proposals (fix_id,status,created_at) VALUES (?,?,?)')
    .run(second, 'auto-rejected: stale', '2026-07-21T01:00:00.000Z');

  const board = validateAdoptionBoard(buildAdoptionBoard(db, { limit: 1, now: new Date('2026-07-24T00:00:00.000Z') }));
  assert.equal(board.stats.rawQueuedFixes, 2);
  assert.equal(board.stats.deduplicatedItems, 1);
  assert.equal(board.stats.duplicatesCollapsed, 1);
  assert.equal(board.items.length, 1);
  assert.equal(board.items[0].observationCount, 2);
  assert.equal(board.items[0].failureCount, 8);
  assert.deepEqual(board.items[0].sourceFixIds, [first, second]);
  assert.deepEqual(board.items[0].proposals, { open: 1, rejected: 1, accepted: 0 });
  assert.equal(board.items[0].fingerprint, adoptionFingerprint({
    class: 'answer/freshness', location: 'packages/core/src/chat/service.ts:42',
  }));
  db.close();
});

test('ordering is deterministic and respects the configured hard limit', () => {
  const db = dbFixture();
  seedFix(db, { klass: 'a', failures: 1, location: 'a.ts:1', summary: 'A' });
  seedFix(db, { klass: 'b', failures: 20, location: 'b.ts:1', summary: 'B' });
  seedFix(db, { klass: 'c', failures: 5, location: 'c.ts:1', summary: 'C' });
  const one = buildAdoptionBoard(db, { limit: 2, now: new Date('2026-07-24T00:00:00.000Z') });
  const two = buildAdoptionBoard(db, { limit: 2, now: new Date('2026-07-24T00:00:00.000Z') });
  assert.equal(one.items.length, 2);
  assert.deepEqual(one.items.map((item) => item.fingerprint), two.items.map((item) => item.fingerprint));
  assert.ok(one.items[0].score >= one.items[1].score);
  db.close();
});

test('owner decisions can address a known item outside the bounded board view', () => {
  const db = dbFixture();
  let fingerprint = '';
  for (let index = 0; index < 51; index += 1) {
    const fix = {
      class: `class-${index}`,
      location: `packages/core/src/item-${index}.ts:1`,
      summary: `Improve item ${index}`,
    };
    seedFix(db, {
      klass: fix.class,
      location: fix.location,
      summary: fix.summary,
      failures: index + 1,
    });
    if (index === 0) fingerprint = adoptionFingerprint(fix);
  }
  assert.equal(buildAdoptionBoard(db).items.some((item) => item.fingerprint === fingerprint), false);
  assert.equal(recordAdoptionDecision(db, fingerprint, { status: 'in-review' }).status, 'in-review');
  assert.equal(adoptionEvents(db, fingerprint).length, 1);
  db.close();
});

test('wasteful qualified work pauses generation until three measured shipments are credited', () => {
  const db = dbFixture();
  seedFix(db);
  seedCompute(db); seedCompute(db); seedCompute(db);
  assert.equal(deriveGenerationPolicy(db).state, 'paused');
  ensureAdoptionTables(db);
  for (let index = 0; index < 2; index += 1) {
    db.prepare(`
      INSERT INTO improvement_adoptions (fingerprint,status,created_at,updated_at)
      VALUES (?,?,?,?)
    `).run(`00000000000000000000000${index}`, 'shipped', '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z');
  }
  db.prepare('UPDATE compute_log SET adopted=2 WHERE id=1').run();
  assert.equal(deriveGenerationPolicy(db).state, 'paused');
  db.prepare(`
    INSERT INTO improvement_adoptions (fingerprint,status,created_at,updated_at)
    VALUES (?,?,?,?)
  `).run('000000000000000000000002', 'shipped', '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z');
  db.prepare('UPDATE compute_log SET adopted=3 WHERE id=1').run();
  const policy = deriveGenerationPolicy(db);
  assert.equal(policy.state, 'active');
  assert.equal(policy.shipped, 3);
  assert.equal(policy.roi.realized, 3);
  db.close();
});

test('decision gates reject incomplete approvals and unexplained rejection without mutation', () => {
  const db = dbFixture();
  seedFix(db);
  const fp = buildAdoptionBoard(db).items[0].fingerprint;
  assert.throws(() => recordAdoptionDecision(db, fp, { status: 'rejected', reason: 'no' }), /rejection reason/);
  assert.throws(() => recordAdoptionDecision(db, fp, {
    status: 'approved', reason: 'Worth doing now',
  }), /assignee/);
  assert.equal(adoptionEvents(db, fp).length, 0);
  assert.equal(buildAdoptionBoard(db).items[0].status, 'backlog');
  db.close();
});

test('approval and shipment are transactional, append-only, measured, and credited once', () => {
  const db = dbFixture();
  seedFix(db);
  const computeRoundId = seedCompute(db);
  seedCompute(db); seedCompute(db);
  const fp = buildAdoptionBoard(db).items[0].fingerprint;
  approve(db, fp);

  assert.throws(() => recordAdoptionDecision(db, fp, {
    status: 'shipped',
    commitSha: 'abc1234',
    evidence: 'All focused tests and rendered checks passed.',
    computeRoundId,
    qualityBefore: 7.2,
    qualityAfter: 7.2,
  }), /positive measured quality delta/);
  assert.equal(db.prepare('SELECT adopted FROM compute_log WHERE id=?').get(computeRoundId).adopted, 0);

  const shipped = recordAdoptionDecision(db, fp, {
    status: 'shipped',
    commitSha: 'abc1234',
    evidence: 'All focused tests and rendered checks passed.',
    computeRoundId,
    qualityBefore: 7.2,
    qualityAfter: 8.1,
  });
  assert.equal(shipped.status, 'shipped');
  assert.equal(db.prepare('SELECT adopted FROM compute_log WHERE id=?').get(computeRoundId).adopted, 1);
  assert.deepEqual(adoptionEvents(db, fp).map((event) => [event.fromStatus, event.toStatus]), [
    ['backlog', 'approved'],
    ['approved', 'shipped'],
  ]);
  assert.throws(() => recordAdoptionDecision(db, fp, { status: 'shipped' }), /invalid adoption transition/);
  assert.equal(db.prepare('SELECT adopted FROM compute_log WHERE id=?').get(computeRoundId).adopted, 1);
  db.close();
});
