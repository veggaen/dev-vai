// Run: node --test scripts/improve-loop/instance-lock.test.mjs
// Pure module (fs only, no node:sqlite) — the --experimental-sqlite flag is NOT required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { acquireLock, releaseLock } from './instance-lock.mjs';

const lockPath = () => join(tmpdir(), `vai-lock-test-${process.pid}-${Math.random().toString(36).slice(2)}.lock`);

test('acquire on a free path succeeds and writes a lock file with our PID', () => {
  const p = lockPath();
  try {
    const a = acquireLock(p);
    assert.equal(a.ok, true);
    assert.equal(a.reclaimed, false);
    assert.ok(existsSync(p), 'lock file should exist after acquire');
    const rec = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(rec.pid, process.pid);
    assert.ok(rec.startedAt, 'startedAt recorded');
    a.release();
  } finally { rmSync(p, { force: true }); }
});

test('a second acquire while the live holder owns it is refused', () => {
  const p = lockPath();
  try {
    const a = acquireLock(p);
    assert.equal(a.ok, true);
    const b = acquireLock(p); // same (live) PID still holds it
    assert.equal(b.ok, false);
    assert.equal(b.holderPid, process.pid);
    a.release();
  } finally { rmSync(p, { force: true }); }
});

test('release removes the lock so a later acquire succeeds', () => {
  const p = lockPath();
  try {
    const a = acquireLock(p);
    a.release();
    assert.equal(existsSync(p), false, 'release should delete the lock file');
    const c = acquireLock(p);
    assert.equal(c.ok, true);
    c.release();
  } finally { rmSync(p, { force: true }); }
});

test('a stale lock owned by a dead PID is reclaimed, not refused', () => {
  const p = lockPath();
  try {
    // PID 999999 is not a running process — simulate a crashed prior holder.
    writeFileSync(p, JSON.stringify({ pid: 999999, startedAt: '2026-01-01T00:00:00Z' }));
    const a = acquireLock(p);
    assert.equal(a.ok, true);
    assert.equal(a.reclaimed, true);
    const rec = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(rec.pid, process.pid, 'reclaimed lock should now record our PID');
    a.release();
  } finally { rmSync(p, { force: true }); }
});

test('a corrupt/unreadable lock is treated as stale and reclaimed', () => {
  const p = lockPath();
  try {
    writeFileSync(p, 'not json at all');
    const a = acquireLock(p);
    assert.equal(a.ok, true);
    assert.equal(a.reclaimed, true);
    a.release();
  } finally { rmSync(p, { force: true }); }
});

test('releaseLock is idempotent (no throw on a missing file)', () => {
  const p = lockPath();
  assert.doesNotThrow(() => releaseLock(p));
  assert.doesNotThrow(() => releaseLock(p));
});
