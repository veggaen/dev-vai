// Run: node --test --experimental-sqlite scripts/improve-loop/feature-review-job.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { openDb } from './db.mjs';
import { ensureQueueTable, enqueueFromMissingCapability, openJobs, drainSelfImproveQueue } from './self-improve-queue.mjs';
import { runSelfImproveJob } from './feature-review-job.mjs';

// A throwaway target file the codegen grounds on.
function targetFile() {
  const p = join(tmpdir(), `vai-job-target-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(p, [
    'export function score(x: number): number {',
    '  const base = x * 2;',
    '  return base;',
    '}',
  ].join('\n'));
  return p;
}

// A scripted generate: build returns a valid artifact; self-match/peers accept.
function acceptingGenerate(file) {
  return async (prompt) => {
    if (/Respond with ONLY a JSON object/.test(prompt)) {
      // build prompt → a verified find/replace on a real line
      return JSON.stringify({ file, findLine: 2, find: 'const base = x * 2;', replace: '  const base = x * 3;', why: 'stronger score' });
    }
    if (/MATCH:/.test(prompt)) return 'MATCH: yes\nSCORE: 0.9\nGAP: none'; // self-match
    if (/VERDICT: <accept\|reject>/.test(prompt) || /VERDICT:/.test(prompt)) {
      return 'VERDICT: accept\nSCORE: 0.85\nMODERN: 0.8\nSCALE: 0.8\nREASON: clean\nTIP: none';
    }
    return '';
  };
}

test('runSelfImproveJob: a job that clears review returns integrated (preview → held/integrated path)', async () => {
  const file = targetFile();
  const dbPath = join(tmpdir(), `vai-job-${Date.now()}.sqlite`);
  const db = openDb(dbPath);
  try {
    const job = { instruction: 'make score stronger by tripling the base', location: `${file}:2`, klass: 'feature', member_id: 'perf' };
    const res = await runSelfImproveJob(job, { db, generate: acceptingGenerate(file), integrate: false, changelogPath: join(tmpdir(), `vai-job-cl-${Math.random().toString(36).slice(2)}.md`) });
    // Peers accept + self-match yes → protocol reaches integrate; preview integrate returns ok:false
    // → outcome is 'held' (cleared review but not actually integrated in preview). Either integrated
    // or held is a valid "review passed" terminal; assert it's not aborted/shelved.
    assert.ok(['integrated', 'held'].includes(res.outcome), `expected integrated|held, got ${res.outcome}`);
  } finally {
    db.close(); rmSync(dbPath, { force: true }); rmSync(file, { force: true });
  }
});

test('runSelfImproveJob: aborts cleanly when the build produces nothing', async () => {
  const dbPath = join(tmpdir(), `vai-job-${Date.now()}-2.sqlite`);
  const db = openDb(dbPath);
  try {
    const job = { instruction: 'do something', location: `${join(tmpdir(), 'does-not-exist.ts')}:1`, klass: 'feature' };
    const res = await runSelfImproveJob(job, { db, generate: async () => 'no json here', integrate: false, changelogPath: join(tmpdir(), `vai-job-cl-${Math.random().toString(36).slice(2)}.md`) });
    assert.equal(res.outcome, 'aborted');
  } finally {
    db.close(); rmSync(dbPath, { force: true });
  }
});

test('runSelfImproveJob: aborts when the job has no location to ground on', async () => {
  const dbPath = join(tmpdir(), `vai-job-${Date.now()}-3.sqlite`);
  const db = openDb(dbPath);
  try {
    const res = await runSelfImproveJob({ instruction: 'x', location: '' }, { db, generate: async () => '', integrate: false, changelogPath: join(tmpdir(), `vai-job-cl-${Math.random().toString(36).slice(2)}.md`) });
    assert.equal(res.outcome, 'aborted');
    assert.match(res.detail, /no location/);
  } finally {
    db.close(); rmSync(dbPath, { force: true });
  }
});

test('drainSelfImproveQueue + runSelfImproveJob: an enqueued job is drained and closed', async () => {
  const file = targetFile();
  const dbPath = join(tmpdir(), `vai-job-${Date.now()}-4.sqlite`);
  const db = openDb(dbPath);
  try {
    ensureQueueTable(db);
    enqueueFromMissingCapability(db, {
      memberId: 'perf',
      missingCapability: 'a stronger scoring multiplier for the score function',
      realIntent: 'wants a higher score',
      methodLesson: 'triple the base',
    }, { location: `${file}:2`, klass: 'feature' });
    assert.equal(openJobs(db).length, 1);

    const summary = await drainSelfImproveQueue(db, {
      budget: 3,
      runJob: (job) => runSelfImproveJob(job, { db, generate: acceptingGenerate(file), integrate: false, changelogPath: join(tmpdir(), `vai-job-cl-${Math.random().toString(36).slice(2)}.md`) }),
    });
    assert.equal(summary.ran, 1);
    assert.equal(openJobs(db).length, 0, 'the drained job is closed, not left open');
  } finally {
    db.close(); rmSync(dbPath, { force: true }); rmSync(file, { force: true });
  }
});
