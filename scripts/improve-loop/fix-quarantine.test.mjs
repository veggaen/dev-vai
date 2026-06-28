import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, fixSignature, strikeFix, isFixBanned, STRIKE_LIMIT } from './db.mjs';

const tmpDb = () => openDb(':memory:');
const FIX = { file: 'a/b.tsx', find: 'text-zinc-500', replace: 'text-zinc-400' };

test('fixSignature is stable and discriminating', () => {
  assert.equal(fixSignature(FIX), fixSignature({ ...FIX }), 'same fix → same sig');
  assert.notEqual(fixSignature(FIX), fixSignature({ ...FIX, replace: 'text-zinc-300' }), 'diff replace → diff sig');
  assert.notEqual(fixSignature(FIX), fixSignature({ ...FIX, file: 'other.tsx' }), 'diff file → diff sig');
});

test('a fresh fix is not banned', () => {
  const db = tmpDb();
  assert.equal(isFixBanned(db, FIX), false);
});

test('STRIKE_LIMIT failures ban the fix; banned fixes are detected', () => {
  const db = tmpDb();
  let res;
  for (let i = 1; i <= STRIKE_LIMIT; i++) {
    res = strikeFix(db, FIX, `tsc failed attempt ${i}`);
    assert.equal(res.strikes, i, `strike count tracks (${i})`);
  }
  assert.equal(res.banned, true, 'reaching STRIKE_LIMIT bans it');
  assert.equal(isFixBanned(db, FIX), true, 'subsequently reported as banned');
});

test('one strike short of the limit is NOT yet banned (no premature quarantine)', () => {
  const db = tmpDb();
  for (let i = 1; i < STRIKE_LIMIT; i++) strikeFix(db, FIX, 'fail');
  assert.equal(isFixBanned(db, FIX), false, `${STRIKE_LIMIT - 1} strikes must not ban`);
});

test('quarantine is per-signature: banning one fix does not ban a different one', () => {
  const db = tmpDb();
  for (let i = 0; i < STRIKE_LIMIT; i++) strikeFix(db, FIX, 'fail');
  assert.equal(isFixBanned(db, FIX), true);
  assert.equal(isFixBanned(db, { ...FIX, replace: 'text-zinc-300' }), false, 'a different replacement is still allowed');
});

test('the doom-loop scenario: an empty-file fix gets banned after 2 reverts', () => {
  // Models the real BSOD bug: same un-appliable patch reverted every cycle. After 2 it stops.
  const db = tmpDb();
  const deadFix = { file: 'BuildStatusBadge.tsx', find: 'text-zinc-500', replace: 'text-zinc-400' };
  strikeFix(db, deadFix, 'reverted — verify failed: tsc failed');
  assert.equal(isFixBanned(db, deadFix), false, 'still trying after 1 fail');
  strikeFix(db, deadFix, 'reverted — verify failed: tsc failed');
  assert.equal(isFixBanned(db, deadFix), true, 'banned after 2 — loop will skip it from now on');
});

test('a LEGACY ban whose stored sig predates the current fixSignature formula is still honoured', () => {
  // The real corpus bug: old quarantine rows stored a sig from an older fixSignature() formula, so
  // matching by sig alone returned false and the banned fix (BuildStatusBadge text-zinc-500) was
  // re-attempted 885×. isFixBanned must also match by (file, find, replace) fields so a ban survives
  // any signature-format drift. Simulate by inserting a banned row with a deliberately WRONG sig.
  const db = tmpDb();
  const fix = { file: 'apps/desktop/src/components/BuildStatusBadge.tsx', find: 'text-zinc-500', replace: 'text-zinc-400' };
  db.prepare(
    `INSERT INTO fix_quarantine (sig, file, find, "replace", strikes, banned, last_detail, updated_at)
     VALUES ('legacy_wrong_sig', ?, ?, ?, 2, 1, 'BSOD doom-loop', '2026-01-01')`,
  ).run(fix.file, fix.find, fix.replace);
  // Sanity: the current formula would NOT match this stored sig.
  assert.notEqual(fixSignature(fix), 'legacy_wrong_sig');
  // …yet the ban is still honoured via the field-match fallback.
  assert.equal(isFixBanned(db, fix), true, 'legacy ban honoured by field match despite sig drift');
  // A different fix on the same file is still allowed.
  assert.equal(isFixBanned(db, { ...fix, replace: 'text-zinc-300' }), false);
});

test('FIND-LEVEL ban: same line re-edited with 3 different replaces is banned (doom-loop guard)', () => {
  // The same-line/different-replace thrash: each replace makes a fresh signature so the per-signature
  // strike never bans → infinite retries on one dead line. Banned once ≥3 distinct variants hit it.
  const db = tmpDb();
  const base = { file: 'x.ts', find: 'if (cond) return a;' };
  strikeFix(db, { ...base, replace: 'if (cond) return b;' }, 'tsc red');
  strikeFix(db, { ...base, replace: 'if (cond) return c;' }, 'tsc red');
  // 2 distinct variants, 1 strike each → still allowed (room for a real 3rd attempt)
  assert.equal(isFixBanned(db, { ...base, replace: 'if (cond) return d;' }), false, '2 variants: not yet banned');
  strikeFix(db, { ...base, replace: 'if (cond) return d;' }, 'tsc red');
  // 3 distinct variants on the SAME find → the line is thrash → ban any further replace on it
  assert.equal(isFixBanned(db, { ...base, replace: 'if (cond) return e;' }), true, '3 variants: find-level banned');
  // A DIFFERENT find on the same file is unaffected.
  assert.equal(isFixBanned(db, { file: 'x.ts', find: 'const z = 1;', replace: 'const z = 2;' }), false);
});
