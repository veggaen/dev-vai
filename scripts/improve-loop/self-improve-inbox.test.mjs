import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { appendToInbox, readInbox, clearInbox, ingestInbox } from './self-improve-inbox.mjs';

function tmpInbox() {
  return join(tmpdir(), `vai-inbox-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}

test('appendToInbox + readInbox: round-trips jobs, one per line', () => {
  const path = tmpInbox();
  try {
    appendToInbox({ missingCapability: 'a diff viewer', memberId: 'fe' }, { path });
    appendToInbox({ missingCapability: 'a currency converter', memberId: 'be' }, { path });
    const jobs = readInbox({ path });
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].missingCapability, 'a diff viewer');
    assert.equal(jobs[1].memberId, 'be');
  } finally { rmSync(path, { force: true }); }
});

test('readInbox: skips malformed lines and jobs with no capability', () => {
  const path = tmpInbox();
  try {
    appendToInbox({ missingCapability: 'real one' }, { path });
    // Manually append junk + a capability-less object.
    appendFileSync(path, 'not json\n');
    appendFileSync(path, JSON.stringify({ memberId: 'x' }) + '\n');
    assert.equal(readInbox({ path }).length, 1);
  } finally { rmSync(path, { force: true }); }
});

test('readInbox: empty when the file does not exist', () => {
  assert.deepEqual(readInbox({ path: tmpInbox() }), []);
});

test('appendToInbox: caps long fields so a huge note cannot bloat the inbox', () => {
  const path = tmpInbox();
  try {
    appendToInbox({ missingCapability: 'x'.repeat(5000) }, { path });
    const jobs = readInbox({ path });
    assert.ok(jobs[0].missingCapability.length <= 400);
  } finally { rmSync(path, { force: true }); }
});

test('clearInbox: empties the file', () => {
  const path = tmpInbox();
  try {
    appendToInbox({ missingCapability: 'a' }, { path });
    clearInbox({ path });
    assert.equal(readInbox({ path }).length, 0);
    assert.ok(existsSync(path), 'file still exists, just emptied');
    assert.equal(readFileSync(path, 'utf8'), '');
  } finally { rmSync(path, { force: true }); }
});

test('ingestInbox: enqueues each job via the injected enqueue and clears the inbox', () => {
  const path = tmpInbox();
  try {
    appendToInbox({ missingCapability: 'a diff viewer', location: 'x.ts:1', klass: 'ui' }, { path });
    appendToInbox({ missingCapability: 'a converter', location: 'y.ts:2' }, { path });
    const calls = [];
    const enqueue = (_db, note, opts) => { calls.push({ note, opts }); return { enqueued: true }; };
    const summary = ingestInbox({}, { enqueue, resolveLocation: () => 'fallback.ts:1', path });
    assert.equal(summary.ingested, 2);
    assert.equal(summary.enqueued, 2);
    assert.equal(calls[0].opts.location, 'x.ts:1', 'uses the job location hint');
    assert.equal(calls[0].opts.klass, 'ui');
    assert.equal(calls[0].note.missingCapability, 'a diff viewer');
    assert.equal(readInbox({ path }).length, 0, 'inbox cleared after ingest');
  } finally { rmSync(path, { force: true }); }
});

test('ingestInbox: falls back to resolveLocation when a job has no location', () => {
  const path = tmpInbox();
  try {
    appendToInbox({ missingCapability: 'a thing with no location hint' }, { path });
    let resolvedFor = null;
    const enqueue = (_db, _note, opts) => { resolvedFor = opts.location; return { enqueued: true }; };
    ingestInbox({}, { enqueue, resolveLocation: (job) => `resolved-for-${job.missingCapability.length}.ts:1`, path });
    assert.match(resolvedFor, /resolved-for-\d+\.ts:1/);
  } finally { rmSync(path, { force: true }); }
});

test('ingestInbox: counts skipped when enqueue rejects (dedup/shelf)', () => {
  const path = tmpInbox();
  try {
    appendToInbox({ missingCapability: 'dup one', location: 'a.ts:1' }, { path });
    const enqueue = () => ({ enqueued: false, reason: 'already queued' });
    const summary = ingestInbox({}, { enqueue, path });
    assert.equal(summary.enqueued, 0);
    assert.equal(summary.skipped, 1);
  } finally { rmSync(path, { force: true }); }
});

test('ingestInbox: no inbox → zero, no throw', () => {
  const summary = ingestInbox({}, { enqueue: () => ({ enqueued: true }), path: tmpInbox() });
  assert.deepEqual(summary, { ingested: 0, enqueued: 0, skipped: 0 });
});
