// Run: node --test --experimental-sqlite scripts/improve-loop/self-improve-queue.test.mjs
// Uses a real temp sqlite (node:sqlite) via openDb → the --experimental-sqlite flag is required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from './db.mjs';
import { tokenizeRejectedIdea } from './feature-review.mjs';
import {
  ensureQueueTable,
  instructionFromNote,
  enqueueFromMissingCapability,
  enqueueFromCouncil,
  openJobs,
  closeJob,
  drainSelfImproveQueue,
  DEFAULT_DRAIN_BUDGET,
} from './self-improve-queue.mjs';

async function withDb(fn) {
  const dbPath = join(tmpdir(), `vai-siq-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = openDb(dbPath);
  try { ensureQueueTable(db); return await fn(db); }
  finally { db.close(); rmSync(dbPath, { force: true }); }
}

const NOTE = {
  memberId: 'root-cause-surgeon',
  memberName: 'Root cause',
  missingCapability: 'a route that answers business-idea prompts with concrete opportunities',
  realIntent: 'wants software business ideas for Norway',
  methodLesson: 'detect business-idea intent and route to the opportunity handler, not country facts',
};

// ── instruction synthesis ────────────────────────────────────────────────────────
test('instructionFromNote: builds a grounded instruction from the note fields', () => {
  const ins = instructionFromNote(NOTE);
  assert.match(ins, /business-idea prompts with concrete opportunities/);
  assert.match(ins, /software business ideas for Norway/);
  assert.match(ins, /opportunity handler/);
});

test('instructionFromNote: returns null for an empty/again-vague missingCapability', () => {
  assert.equal(instructionFromNote({ missingCapability: '' }), null);
  assert.equal(instructionFromNote({ missingCapability: 'none' }), null);
  assert.equal(instructionFromNote({ missingCapability: 'n/a' }), null);
  assert.equal(instructionFromNote({}), null);
});

// ── enqueue + dedup ────────────────────────────────────────────────────────────────
test('enqueueFromMissingCapability: queues a real gap', async () => {
  await withDb((db) => {
    const r = enqueueFromMissingCapability(db, NOTE, { klass: 'routing' });
    assert.equal(r.enqueued, true);
    assert.ok(r.id > 0);
    assert.equal(openJobs(db).length, 1);
    assert.equal(openJobs(db)[0].member_id, 'root-cause-surgeon');
  });
});

test('enqueueFromMissingCapability: a note with no capability does not enqueue', async () => {
  await withDb((db) => {
    const r = enqueueFromMissingCapability(db, { missingCapability: 'none', memberId: 'x' });
    assert.equal(r.enqueued, false);
    assert.match(r.reason, /no actionable/);
    assert.equal(openJobs(db).length, 0);
  });
});

test('enqueueFromMissingCapability: an identical gap is NOT queued twice (dedup)', async () => {
  await withDb((db) => {
    const a = enqueueFromMissingCapability(db, NOTE, {});
    const b = enqueueFromMissingCapability(db, NOTE, {});
    assert.equal(a.enqueued, true);
    assert.equal(b.enqueued, false);
    assert.match(b.reason, /already queued/);
    assert.equal(openJobs(db).length, 1);
  });
});

test('enqueueFromMissingCapability: a gap matching a still-dead SHELVED idea is skipped', async () => {
  await withDb((db) => {
    // Build the shelf key the SAME way the module does (checkShelvedIdeas tokenizes the instruction).
    const ins = instructionFromNote(NOTE);
    const shelfKey = tokenizeRejectedIdea({ instruction: ins }).key;
    // HIGH confidence (confirmed rejection) → still-dead, not revivable.
    const effects = {
      topKnowledge: () => [{ claim: shelfKey, confirmations: 5, contradictions: 0 }],
      knowledgeConfidence: (r) => (r.confirmations + 1) / (r.confirmations + r.contradictions + 2),
    };
    const r = enqueueFromMissingCapability(db, NOTE, { effects });
    assert.equal(r.enqueued, false);
    assert.match(r.reason, /shelved idea we already rejected/);
    assert.equal(openJobs(db).length, 0);
  });
});

test('enqueueFromMissingCapability: a REVIVABLE shelved idea does NOT block enqueue', async () => {
  await withDb((db) => {
    const ins = instructionFromNote(NOTE);
    const shelfKey = tokenizeRejectedIdea({ instruction: ins }).key;
    // Low confidence (contradicted a lot) → revivable → must NOT block.
    const effects = {
      topKnowledge: () => [{ claim: shelfKey, confirmations: 0, contradictions: 5 }],
      knowledgeConfidence: (r) => (r.confirmations + 1) / (r.confirmations + r.contradictions + 2),
    };
    const r = enqueueFromMissingCapability(db, NOTE, { effects });
    assert.equal(r.enqueued, true, 'a revivable idea is allowed back into the queue');
  });
});

// ── whole-council enqueue ────────────────────────────────────────────────────────
test('enqueueFromCouncil: two members naming the SAME gap → one job', async () => {
  await withDb((db) => {
    const notes = [
      NOTE,
      { ...NOTE, memberId: 'intent-semanticist' }, // same missingCapability text
      { memberId: 'perf', missingCapability: 'a faster short-circuit for greetings so we skip the model' },
    ];
    const results = enqueueFromCouncil(db, notes, {});
    const enqueued = results.filter((r) => r.enqueued).length;
    assert.equal(enqueued, 2, 'the duplicate gap collapses; the distinct one is added');
    assert.equal(openJobs(db).length, 2);
  });
});

// ── drain ────────────────────────────────────────────────────────────────────────
test('drainSelfImproveQueue: runs queued jobs through the injected runJob and closes them', async () => {
  await withDb(async (db) => {
    enqueueFromMissingCapability(db, NOTE, {});
    enqueueFromMissingCapability(db, { ...NOTE, missingCapability: 'a second distinct capability to add' }, {});
    const seen = [];
    const summary = await drainSelfImproveQueue(db, {
      runJob: async (job) => { seen.push(job.id); return { outcome: 'integrated', detail: 'done' }; },
    });
    assert.equal(summary.ran, 2);
    assert.equal(seen.length, 2);
    assert.equal(openJobs(db).length, 0, 'both jobs closed → no longer open');
  });
});

const DISTINCT_CAPS = [
  'a streaming voice barge-in interrupt handler for spoken turns',
  'a markdown table renderer for tabular answers in chat',
  'a currency conversion helper grounded in live exchange rates',
  'a syntax-highlighted diff viewer for proposed code changes',
  'a timezone-aware relative date formatter for message timestamps',
];

test('drainSelfImproveQueue: honours the budget (does not run more than N jobs)', async () => {
  await withDb(async (db) => {
    for (const cap of DISTINCT_CAPS) {
      enqueueFromMissingCapability(db, { ...NOTE, missingCapability: cap }, {});
    }
    assert.equal(openJobs(db).length, 5, 'all 5 distinct gaps queued');
    const summary = await drainSelfImproveQueue(db, { budget: 2, runJob: async () => ({ outcome: 'held', detail: '' }) });
    assert.equal(summary.ran, 2);
    assert.equal(openJobs(db).length, 3, '3 jobs remain queued for a later cycle');
  });
});

test('drainSelfImproveQueue: a runJob throw is caught and the job closed as failed', async () => {
  await withDb(async (db) => {
    enqueueFromMissingCapability(db, NOTE, {});
    const summary = await drainSelfImproveQueue(db, { runJob: async () => { throw new Error('boom'); } });
    assert.equal(summary.ran, 1);
    assert.equal(summary.results[0].outcome, 'failed');
    assert.equal(openJobs(db).length, 0, 'a failed job is closed, not left to retry forever');
  });
});

test('drainSelfImproveQueue: default budget is DEFAULT_DRAIN_BUDGET', async () => {
  await withDb(async (db) => {
    for (const cap of DISTINCT_CAPS) { // 5 distinct > DEFAULT_DRAIN_BUDGET (3)
      enqueueFromMissingCapability(db, { ...NOTE, missingCapability: cap }, {});
    }
    const summary = await drainSelfImproveQueue(db, { runJob: async () => ({ outcome: 'shelved', detail: '' }) });
    assert.equal(summary.ran, DEFAULT_DRAIN_BUDGET);
  });
});

test('closeJob: marks a terminal status + outcome', async () => {
  await withDb((db) => {
    const { id } = enqueueFromMissingCapability(db, NOTE, {});
    closeJob(db, id, 'integrated', 'landed a fix');
    assert.equal(openJobs(db).length, 0);
    const row = db.prepare('SELECT status, outcome FROM self_improve_queue WHERE id=?').get(id);
    assert.equal(row.status, 'integrated');
    assert.equal(row.outcome, 'landed a fix');
  });
});
