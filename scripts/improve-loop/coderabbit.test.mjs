import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCodeRabbitAvailable,
  parseCodeRabbitAgentOutput,
  formatFindingsForPeer,
  CodeRabbitBudget,
  reviewWithCodeRabbit,
  DEFAULT_MAX_PER_HOUR,
  HOUR_MS,
} from './coderabbit.mjs';

// In-memory fs fake for the budget file.
function memFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return { files, exists: (p) => files.has(p), read: (p) => files.get(p), write: (p, c) => files.set(p, c) };
}

// ── availability probe ──────────────────────────────────────────────────────────
test('isCodeRabbitAvailable: true when a candidate binary reports a version', () => {
  const run = (bin) => (bin.startsWith('cr') ? { ok: true, out: 'cr 1.2.3' } : { ok: false });
  const r = isCodeRabbitAvailable({ run });
  assert.equal(r.available, true);
  assert.match(r.detail, /1\.2\.3/);
});

test('isCodeRabbitAvailable: false (graceful) when nothing is on PATH', () => {
  const r = isCodeRabbitAvailable({ run: () => ({ ok: false }) });
  assert.equal(r.available, false);
  assert.equal(r.bin, null);
});

// ── defensive JSON parsing ────────────────────────────────────────────────────────
test('parseCodeRabbitAgentOutput: reads a findings[] shape', () => {
  const raw = JSON.stringify({ findings: [
    { file: 'a.ts', line: 12, severity: 'warning', message: 'possible null deref' },
    { path: 'b.ts', line_number: 3, level: 'error', body: 'SQL injection risk' },
  ] });
  const f = parseCodeRabbitAgentOutput(raw);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0], { file: 'a.ts', line: 12, severity: 'warning', message: 'possible null deref' });
  assert.equal(f[1].file, 'b.ts');
  assert.equal(f[1].line, 3);
  assert.equal(f[1].severity, 'error');
});

test('parseCodeRabbitAgentOutput: reads a comments[] shape and a top-level array', () => {
  assert.equal(parseCodeRabbitAgentOutput(JSON.stringify({ comments: [{ message: 'x' }] })).length, 1);
  assert.equal(parseCodeRabbitAgentOutput(JSON.stringify([{ message: 'top-level' }])).length, 1);
});

test('parseCodeRabbitAgentOutput: salvages JSON after a banner line', () => {
  const raw = 'CodeRabbit CLI v2\nReviewing...\n{"findings":[{"message":"leaked stream"}]}';
  const f = parseCodeRabbitAgentOutput(raw);
  assert.equal(f.length, 1);
  assert.equal(f[0].message, 'leaked stream');
});

test('parseCodeRabbitAgentOutput: unknown/garbage → [] (never throws)', () => {
  assert.deepEqual(parseCodeRabbitAgentOutput('not json at all'), []);
  assert.deepEqual(parseCodeRabbitAgentOutput('{}'), []);
  assert.deepEqual(parseCodeRabbitAgentOutput(JSON.stringify({ findings: [{ severity: 'info' }] })), [], 'a finding with no message is dropped');
});

test('parseCodeRabbitAgentOutput: reads nested review.comments', () => {
  const raw = JSON.stringify({ review: { comments: [{ filename: 'c.ts', startLine: 9, description: 'nit' }] } });
  const f = parseCodeRabbitAgentOutput(raw);
  assert.equal(f.length, 1);
  assert.equal(f[0].file, 'c.ts');
  assert.equal(f[0].line, 9);
});

// ── peer-facing formatting ────────────────────────────────────────────────────────
test('formatFindingsForPeer: renders a compact actionable block', () => {
  const block = formatFindingsForPeer([
    { file: 'a.ts', line: 1, severity: 'error', message: 'bad' },
    { file: null, line: null, severity: 'info', message: 'style' },
  ]);
  assert.match(block, /CodeRabbit flagged/);
  assert.match(block, /\[error\] a\.ts:1: bad/);
  assert.match(block, /\[info\]: style/);
});

test('formatFindingsForPeer: empty findings → empty string (no noise)', () => {
  assert.equal(formatFindingsForPeer([]), '');
});

// ── the rolling-hour cooldown ──────────────────────────────────────────────────────
test('CodeRabbitBudget: allows up to maxPerHour, then cools down', () => {
  let t = 1_000_000;
  const b = new CodeRabbitBudget({ path: 'x.json', maxPerHour: 3, fs: memFs(), now: () => t });
  assert.equal(b.check().ok, true);
  b.record(); b.record(); b.record();
  const gate = b.check();
  assert.equal(gate.ok, false, 'the 4th call is refused');
  assert.equal(gate.remaining, 0);
  assert.ok(gate.retryInMs > 0 && gate.retryInMs <= HOUR_MS);
});

test('CodeRabbitBudget: a slot frees up once the oldest call ages out of the window', () => {
  let t = 1_000_000;
  const b = new CodeRabbitBudget({ path: 'x.json', maxPerHour: 2, fs: memFs(), now: () => t });
  b.record();            // at t
  t += 10 * 60 * 1000;   // +10 min
  b.record();            // second call
  assert.equal(b.check().ok, false, 'both slots used');
  t += 51 * 60 * 1000;   // now 61 min after the FIRST call → it ages out
  const gate = b.check();
  assert.equal(gate.ok, true, 'first call aged out → a slot is free again');
  assert.equal(gate.remaining, 1);
});

test('CodeRabbitBudget: retryInMin reflects when the oldest call expires', () => {
  let t = 0;
  const b = new CodeRabbitBudget({ path: 'x.json', maxPerHour: 1, fs: memFs(), now: () => t });
  b.record();          // at t=0 → next slot at t=HOUR
  t = 30 * 60 * 1000;  // 30 min in
  const gate = b.check();
  assert.equal(gate.ok, false);
  assert.equal(gate.retryInMin, 30, 'about 30 minutes until the slot frees');
});

test('CodeRabbitBudget: persists across instances (survives a restart)', () => {
  const fs = memFs();
  let t = 5_000_000;
  const b1 = new CodeRabbitBudget({ path: 'p.json', maxPerHour: 1, fs, now: () => t });
  b1.record();
  // A fresh instance (simulating a process restart) reads the same persisted window.
  const b2 = new CodeRabbitBudget({ path: 'p.json', maxPerHour: 1, fs, now: () => t });
  assert.equal(b2.check().ok, false, 'the recorded call is remembered after restart');
});

// ── the top-level review entry point ────────────────────────────────────────────────
test('reviewWithCodeRabbit: runs, parses, and counts against the budget when a slot is free', () => {
  let t = 1_000_000;
  const budget = new CodeRabbitBudget({ path: 'x.json', maxPerHour: 3, fs: memFs(), now: () => t });
  const run = () => ({ ok: true, out: JSON.stringify({ findings: [{ message: 'unclosed stream', severity: 'warning' }] }) });
  const r = reviewWithCodeRabbit({ target: 'diff.patch', run, budget });
  assert.equal(r.ran, true);
  assert.equal(r.findings.length, 1);
  assert.match(r.block, /unclosed stream/);
  assert.equal(budget.check().remaining, 2, 'one slot consumed');
});

test('reviewWithCodeRabbit: NO-OPS (skips) when cooling down — never blocks the peer', () => {
  let t = 1_000_000;
  const budget = new CodeRabbitBudget({ path: 'x.json', maxPerHour: 1, fs: memFs(), now: () => t });
  budget.record(); // exhaust the single slot
  let ran = false;
  const run = () => { ran = true; return { ok: true, out: '{}' }; };
  const r = reviewWithCodeRabbit({ target: 'diff.patch', run, budget });
  assert.equal(r.ran, false);
  assert.equal(r.skipped, true);
  assert.match(r.reason, /cooling down/);
  assert.equal(ran, false, 'the CLI is NOT invoked while cooling down (protects the free-tier quota)');
});

test('reviewWithCodeRabbit: a failed CLI run skips gracefully and does not consume budget', () => {
  let t = 1_000_000;
  const budget = new CodeRabbitBudget({ path: 'x.json', maxPerHour: 3, fs: memFs(), now: () => t });
  const r = reviewWithCodeRabbit({ target: 'd', run: () => ({ ok: false, detail: 'not installed' }), budget });
  assert.equal(r.ran, false);
  assert.equal(r.skipped, true);
  assert.equal(budget.check().remaining, 3, 'a failed run does not spend a slot');
});
