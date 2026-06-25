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
