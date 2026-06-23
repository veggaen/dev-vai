// Run: node --experimental-sqlite --test scripts/improve-loop/visual-packet.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  openDb,
  startVisualRun,
  endVisualRun,
  recordVisualEvent,
  buildVisualCouncilPacket,
} from './db.mjs';

function freshDb() {
  const path = join(tmpdir(), `vai-visual-packet-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = openDb(path);
  return { db, path };
}

test('council packet summarizes a passing visual run without screenshots or pointer trace', () => {
  const { db, path } = freshDb();
  try {
    const runId = startVisualRun(db, { appUrl: 'http://localhost:5173/?devAuthBypass=1', outDir: 'out/x' });
    let seq = 0;
    const ev = (type, data) => recordVisualEvent(db, runId, { seq: ++seq, ts: new Date().toISOString(), type, data });
    ev('probe.start', { appUrl: 'http://localhost:5173/?devAuthBypass=1' });
    ev('vision.snapshot', { name: '01-loaded', path: 'out/x/01-loaded.png' });
    ev('check', { name: 'no horizontal overflow', passed: true });
    ev('check', { name: 'composer visible', passed: true });
    ev('vision.target', { targetReceivesPointer: true, topLabel: 'textarea.bg-transparent', targetLabel: 'textarea' });
    ev('check', { name: 'composer is top-layer click target', passed: true, detail: 'textarea.bg-transparent' });
    ev('request.blocked_external', { text: 'GET https://fonts.googleapis.com/... ERR_NETWORK_ACCESS_DENIED' });
    ev('vision.snapshot', { name: '03-cleared', path: 'out/x/03-cleared.png' });
    ev('probe.done', { passed: true, reportPath: 'out/x/report.json' });
    endVisualRun(db, runId, { status: 'done', passed: true, reportPath: 'out/x/report.json', summary: 'ok' });

    const packet = buildVisualCouncilPacket(db);
    assert.equal(packet.visualRunId, runId);
    assert.equal(packet.passed, true);
    assert.equal(packet.status, 'done');
    assert.equal(packet.checks.total, 3);
    assert.equal(packet.checks.passed, 3);
    assert.equal(packet.composerReachable, true);
    assert.equal(packet.topLayerTarget, 'textarea.bg-transparent');
    assert.equal(packet.screenshots, 2);
    assert.equal(packet.warnings.length, 0);
    assert.equal(packet.optionalBlockedResources, 1);
    assert.equal(packet.reportPath, 'out/x/report.json');
    // Compactness contract: no raw screenshot bytes, no pointer trace fields.
    assert.ok(!('pointerTrace' in packet));
    assert.match(packet.headline, /visual #\d+ done\/pass · 3\/3 checks · composer reachable/);
  } finally {
    db.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

test('council packet surfaces real warnings and a covered composer', () => {
  const { db, path } = freshDb();
  try {
    const runId = startVisualRun(db, { appUrl: 'http://x', outDir: 'out/y' });
    let seq = 0;
    const ev = (type, data) => recordVisualEvent(db, runId, { seq: ++seq, ts: new Date().toISOString(), type, data });
    ev('check', { name: 'composer visible', passed: true });
    ev('vision.target', { targetReceivesPointer: false, topLabel: 'div.overlay', targetLabel: 'textarea' });
    ev('console.error', { text: 'TypeError: cannot read x of undefined' });
    ev('page.error', { text: 'ReferenceError: boom' });
    ev('probe.done', { passed: false });
    endVisualRun(db, runId, { status: 'done', passed: false, summary: 'covered' });

    const packet = buildVisualCouncilPacket(db);
    assert.equal(packet.passed, false);
    assert.equal(packet.composerReachable, false);
    assert.equal(packet.topLayerTarget, 'div.overlay');
    assert.equal(packet.warnings.length, 2);
    assert.match(packet.headline, /composer covered · 2 warning\(s\)/);
  } finally {
    db.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

test('council packet is null when no visual run exists', () => {
  const { db, path } = freshDb();
  try {
    assert.equal(buildVisualCouncilPacket(db), null);
  } finally {
    db.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});
