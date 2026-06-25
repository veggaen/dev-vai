import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, priorRejection } from './db.mjs';

const mkDb = () => {
  const db = openDb(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fix_id INTEGER, class TEXT NOT NULL,
    file TEXT, find TEXT, "replace" TEXT, why TEXT, raw TEXT,
    status TEXT NOT NULL DEFAULT 'proposed', created_at TEXT NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS consensus (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT,
    file TEXT, find TEXT, "replace" TEXT, agree_count INTEGER, personas TEXT, verified INTEGER,
    why TEXT, applied TEXT, created_at TEXT);`);
  return db;
};
const ins = (db, file, find, replace, status) =>
  db.prepare("INSERT INTO proposals (class,file,find,\"replace\",status,created_at) VALUES ('c',?,?,?,?,?)")
    .run(file, find, replace, status, new Date().toISOString());

test('priorRejection: null when no prior record', () => {
  const db = mkDb();
  assert.equal(priorRejection(db, { file: 'a.ts', find: 'x', replace: 'y' }), null);
});

test('priorRejection: matches an explicit rejected proposal of the same patch', () => {
  const db = mkDb();
  ins(db, 'a.ts', 'if (foo) return false;', 'if (foo && bar) return false;', 'rejected: redundant clause');
  const r = priorRejection(db, { file: 'a.ts', find: 'if (foo) return false;', replace: 'if (foo && bar) return false;' });
  assert.ok(r && /rejected/.test(r), `expected a rejection reason, got ${r}`);
});

test('priorRejection: matches an auto-rejected proposal', () => {
  const db = mkDb();
  ins(db, 'a.ts', 'L', 'R', 'auto-rejected: hallucinated-find — ...');
  assert.ok(priorRejection(db, { file: 'a.ts', find: 'L', replace: 'R' }));
});

test('priorRejection: matches a reverted-red consensus row', () => {
  const db = mkDb();
  db.prepare("INSERT INTO consensus (class,file,find,\"replace\",verified,applied,created_at) VALUES ('c',?,?,?,1,'reverted-red',?)")
    .run('a.ts', 'L', 'R', new Date().toISOString());
  const r = priorRejection(db, { file: 'a.ts', find: 'L', replace: 'R' });
  assert.ok(r && /revert/i.test(r), `expected revert reason, got ${r}`);
});

test('priorRejection: a DIFFERENT replace is not considered rejected', () => {
  const db = mkDb();
  ins(db, 'a.ts', 'L', 'R1', 'rejected: bad');
  assert.equal(priorRejection(db, { file: 'a.ts', find: 'L', replace: 'R2' }), null);
});

test('priorRejection: a still-proposed (not rejected) row does NOT block', () => {
  const db = mkDb();
  ins(db, 'a.ts', 'L', 'R', 'proposed');
  assert.equal(priorRejection(db, { file: 'a.ts', find: 'L', replace: 'R' }), null);
});

test('priorRejection: tolerant of null replace', () => {
  const db = mkDb();
  assert.equal(priorRejection(db, { file: 'a.ts', find: 'L' }), null);
  assert.equal(priorRejection(db, {}), null);
});
