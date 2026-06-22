// Run: node --test scripts/improve-loop/apply-fix.test.mjs
// Safety-critical: this gate decides what auto-applies to council/auto-improve. Tests are
// exhaustive on the risk classifier and the apply harness's revert/commit/ambiguity paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRisk, isAutoApplicable, RISK_TIER, MAX_SAFE_NET_LINES } from './risk-tier.mjs';
import { applyVerifiedFix } from './apply-fix.mjs';

// ── risk-tier classifier ──────────────────────────────────────────────────

test('a small in-function find/replace on an ordinary file is SAFE', () => {
  const r = classifyRisk({ file: 'packages/core/src/chat/x.ts', find: 'if (a) return 1;', replace: 'if (a) return 2;' });
  assert.equal(r.tier, RISK_TIER.SAFE);
  assert.equal(r.reasons.length, 0);
});

test('risky PATHS (schema/auth/migrations/.env/payment) are REVIEW', () => {
  for (const file of [
    'packages/core/src/db/schema.ts', 'packages/runtime/src/auth/x.ts',
    'migrations/001.sql', '.env', 'packages/x/billing.ts', 'src/security/guard.ts',
  ]) {
    assert.equal(classifyRisk({ file, find: 'a', replace: 'b' }).tier, RISK_TIER.REVIEW, file);
  }
});

test('destructive / verification-weakening CONTENT is REVIEW', () => {
  const cases = [
    { find: 'keep()', replace: 'fs.rmSync(p, { recursive: true })' },           // dangerous api (child_process/exec/rm)
    { find: 'it(', replace: 'it.skip(' },                                        // disabling a test
    { find: 'const x = compute();', replace: '// @ts-ignore\nconst x = compute();' }, // silencing types
    { find: 'await db.run(sql)', replace: 'await db.run("DELETE FROM users WHERE 1=1")' }, // sql delete
  ];
  for (const c of cases) {
    assert.equal(classifyRisk({ file: 'src/x.ts', ...c }).tier, RISK_TIER.REVIEW, JSON.stringify(c));
  }
});

test('removing a guardrail token (present in find, gone from replace) is REVIEW', () => {
  const r = classifyRisk({ file: 'src/x.ts', find: 'return { factsQuarantined: true };', replace: 'return {};' });
  assert.equal(r.tier, RISK_TIER.REVIEW);
  assert.ok(r.reasons.some((x) => /guardrail/.test(x)));
});

test('a large change (> MAX_SAFE_NET_LINES net) is REVIEW (refactor, not a tweak)', () => {
  const replace = Array.from({ length: MAX_SAFE_NET_LINES + 3 }, (_, i) => `line${i}`).join('\n');
  assert.equal(classifyRisk({ file: 'src/x.ts', find: 'one()', replace }).tier, RISK_TIER.REVIEW);
});

test('incomplete proposals are REVIEW (never auto-apply a half-spec)', () => {
  assert.equal(classifyRisk({ file: '', find: 'a', replace: 'b' }).tier, RISK_TIER.REVIEW);
  assert.equal(classifyRisk({ file: 'x.ts', find: '', replace: 'b' }).tier, RISK_TIER.REVIEW);
});

// ── apply harness ─────────────────────────────────────────────────────────

function harness(initial, { verifyOk = true, verifyThrows = false } = {}) {
  const files = new Map(Object.entries(initial));
  const log = { writes: [], commits: [], verifies: 0 };
  const deps = {
    readFile: (f) => (files.has(f) ? files.get(f) : null),
    writeFile: (f, c) => { files.set(f, c); log.writes.push(f); },
    verify: async () => { log.verifies++; if (verifyThrows) throw new Error('tsc crashed'); return { ok: verifyOk, detail: verifyOk ? 'tsc+tests green' : 'tsc error TS2345' }; },
    commit: async (m) => { log.commits.push(m); },
  };
  return { deps, files, log };
}

test('SAFE + verify green → applies, commits to council/auto-improve with audit reasoning', async () => {
  const { deps, files, log } = harness({ 'src/x.ts': 'const a = old();\n' });
  const r = await applyVerifiedFix({ file: 'src/x.ts', find: 'const a = old();', replace: 'const a = neo();', why: 'use neo' }, deps);
  assert.equal(r.applied, true);
  assert.equal(r.committed, true);
  assert.equal(files.get('src/x.ts'), 'const a = neo();\n');
  assert.match(log.commits[0], /council\/auto-improve/);
  assert.match(log.commits[0], /use neo/);
});

test('SAFE + verify RED → reverts the file, does NOT commit (never ship red)', async () => {
  const original = 'const a = old();\n';
  const { deps, files, log } = harness({ 'src/x.ts': original }, { verifyOk: false });
  const r = await applyVerifiedFix({ file: 'src/x.ts', find: 'const a = old();', replace: 'const a = broken(' }, deps);
  assert.equal(r.applied, false);
  assert.equal(r.committed, false);
  assert.equal(files.get('src/x.ts'), original); // reverted
  assert.equal(log.commits.length, 0);
  assert.match(r.verifyDetail, /reverted/i);
});

test('verify THROWS → reverts and reports, never commits', async () => {
  const original = 'x();\n';
  const { deps, files, log } = harness({ 'src/x.ts': original }, { verifyThrows: true });
  const r = await applyVerifiedFix({ file: 'src/x.ts', find: 'x();', replace: 'y();' }, deps);
  assert.equal(r.applied, false);
  assert.equal(files.get('src/x.ts'), original);
  assert.equal(log.commits.length, 0);
});

test('REVIEW-tier fix is NEVER applied (no write, no verify, no commit)', async () => {
  const { deps, files, log } = harness({ 'packages/core/src/db/schema.ts': 'col();\n' });
  const r = await applyVerifiedFix({ file: 'packages/core/src/db/schema.ts', find: 'col();', replace: 'col2();' }, deps);
  assert.equal(r.applied, false);
  assert.equal(r.tier, 'review');
  assert.equal(log.writes.length, 0);
  assert.equal(log.verifies, 0);
  assert.equal(log.commits.length, 0);
});

test('ambiguous find (multiple matches) is refused — never guesses', async () => {
  const { deps, log } = harness({ 'src/x.ts': 'go();\ngo();\n' });
  const r = await applyVerifiedFix({ file: 'src/x.ts', find: 'go();', replace: 'stop();' }, deps);
  assert.equal(r.applied, false);
  assert.match(r.reasons[0], /ambiguous/);
  assert.equal(log.writes.length, 0);
});

test('find not present (stale/hallucinated) is refused safely', async () => {
  const { deps } = harness({ 'src/x.ts': 'real();\n' });
  const r = await applyVerifiedFix({ file: 'src/x.ts', find: 'imaginary();', replace: 'z();' }, deps);
  assert.equal(r.applied, false);
  assert.match(r.reasons[0], /not present/);
});

test('missing file is refused safely', async () => {
  const { deps } = harness({});
  const r = await applyVerifiedFix({ file: 'nope.ts', find: 'a', replace: 'b' }, deps);
  assert.equal(r.applied, false);
  assert.match(r.reasons[0], /not found/);
});

// ── rejected-rationale guard (correctness, not just safety) ──
// verified=1 means the LINE exists, not that the patch is right. A proposal whose own `why`
// flags it rejected/wrong/already-fixed must never apply. (Guard lives in apply-consensus.mjs;
// this pins the detector pattern so a future edit can't silently weaken it.)
test('rejected-rationale regex matches the language consensus-fix uses for bad patches', () => {
  const REJECTED_WHY = /\b(rejected|wrong patch|incorrect|do not apply|already fixed|re-?introduces?|reintroduce|regression)\b/i;
  const real = 'REJECTED by gate: 4/4 consensus on the right LINE but a WRONG patch (re-introduces the over-broad bug). Already fixed correctly by hand.';
  assert.equal(REJECTED_WHY.test(real), true);
  assert.equal(REJECTED_WHY.test('tighten the interrogative guard so advice questions are not builds'), false);
});

// ── auditor-found bypasses (2026-06-22): added-side risky constructs + regex widening ──
test('REVIEW: introducing a secret/env read, silent catch, new fetch, or eval', () => {
  const cases = [
    { find: 'const k = cfg.key', replace: 'const k = process.env.SECRET_KEY' },
    { find: 'doThing()', replace: 'try { doThing() } catch {}' },
    { find: 'return cached', replace: 'return await fetch(url)' },
    { find: 'compute(x)', replace: 'new Function("return " + x)()' },
  ];
  for (const c of cases) assert.equal(classifyRisk({ file: 'src/x.ts', ...c }).tier, RISK_TIER.REVIEW, JSON.stringify(c));
});

test('REVIEW: widening a regex (losing an anchor) — the over-broad-keyword bug class', () => {
  assert.equal(classifyRisk({ file: 'src/x.ts', find: 'const R = /^admin$/', replace: 'const R = /admin/' }).tier, RISK_TIER.REVIEW);
});

test('still SAFE: a clean small logic tweak that introduces none of the above', () => {
  assert.equal(classifyRisk({ file: 'src/x.ts', find: 'if (a) return 1;', replace: 'if (a) return 2;' }).tier, RISK_TIER.SAFE);
});
