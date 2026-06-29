/**
 * acceptance-verifier — HONEST measurement of a fix. Instead of trusting corpus-wide
 * drift (which moves for a dozen unrelated reasons), this re-runs the EXACT prompts that
 * were failing for a class and confirms THOSE specific rows moved fail→pass.
 *
 * Why this matters (the ROI meter exposed it): the loop generates qualified proposals but
 * `adopted/realized` stays 0 because nothing PROVES a change shipped value. A targeted
 * accept check is that proof — the only signal a maintainer actually trusts: "the thing
 * that was broken is now fixed, and I can see exactly which rows recovered."
 *
 * Pure core (summarize/format) is I/O-free and deterministic. verifyAcceptance takes an
 * INJECTED runner + grader so it unit-tests without a model or a DB, and runs the real
 * prompts SERIALLY (one heavy GPU task at a time — the BSOD rule) when given the live path.
 */
import { failingRowsForClass, passingRowsForClass } from './db.mjs';

/** Fraction of targeted failures that must recover for a FULLY-accepted verdict. */
export const ACCEPT_RATE = 0.8;
/** Minimum fraction of failures a fix must recover to count as NET IMPROVEMENT (kept, built on).
 *  The loop was reverting every fix that didn't reach 80% — so a fix recovering 2/5 real failures
 *  (genuine progress) was thrown away and nothing ever accumulated. A net-positive change that
 *  breaks NOTHING should be kept; perfection isn't required for progress. The regression guard
 *  (below) is what makes this safe — we keep improvements, never regressions. */
export const IMPROVE_RATE = 0.25;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Pure verdict over per-prompt re-run outcomes. Now KEEPS net improvements (not only 80%+ "complete"
 * fixes), guarded by REGRESSIONS: `regressed` counts previously-PASSING prompts the fix BROKE.
 *   - any regression  → REJECTED (a fix that breaks working behaviour is never kept, however much
 *                       it recovers — correctness first).
 *   - recovers ≥ acceptRate → accepted (a strong fix)
 *   - recovers ≥ improveRate, breaks nothing → IMPROVED (kept + built on — incremental progress)
 *   - recovers >0 but < improveRate → partial (too marginal to keep, but not a regression)
 *   - recovers 0 → rejected
 * @param perPrompt [{ passed:boolean, regression?:boolean }] — regression=true means a prompt that
 *   PASSED before the fix now FAILS (the caller marks these by re-running known-passing prompts).
 */
export function summarizeAcceptance(perPrompt = [], { klass = '', acceptRate = ACCEPT_RATE, improveRate = IMPROVE_RATE } = {}) {
  const rows = (perPrompt ?? []).filter((p) => p && typeof p.passed === 'boolean');
  const targets = rows.filter((p) => !p.regression);          // the class's failing prompts
  const regressionRows = rows.filter((p) => p.regression);    // known-passing prompts re-checked
  const total = targets.length;
  const recovered = targets.filter((p) => p.passed).length;
  const stillFailing = total - recovered;
  const recoveryRate = total ? round2(recovered / total) : 0;
  const regressed = regressionRows.filter((p) => !p.passed).length; // passing→failing = broke something

  let verdict;
  if (regressed > 0) verdict = 'rejected';                    // SAFETY: never keep a regression
  else if (total === 0) verdict = 'no-targets';
  else if (recoveryRate >= acceptRate) verdict = 'accepted';
  else if (recoveryRate >= improveRate) verdict = 'improved'; // NET PROGRESS — kept + built on
  else if (recovered > 0) verdict = 'partial';
  else verdict = 'rejected';
  // Both 'accepted' and 'improved' are KEPT (the loop builds on them); partial/rejected are not.
  const accepted = verdict === 'accepted' || verdict === 'improved';
  return {
    klass, verdict, accepted, total, recovered, stillFailing, recoveryRate, regressed,
    headline: total === 0
      ? `acceptance ${klass || '(class)'}: no targeted failures to verify`
      : `acceptance ${klass || '(class)'}: ${recovered}/${total} recovered (${Math.round(recoveryRate * 100)}%)${regressed ? `, ${regressed} REGRESSED` : ''} → ${verdict.toUpperCase()}`,
    stillFailingPrompts: targets.filter((p) => !p.passed).map((p) => String(p.prompt ?? '').slice(0, 80)),
  };
}

/**
 * Re-run a set of failing rows through an injected runner + grader and summarize.
 * @param {{ rows, klass?, runOne, grade, acceptRate?, onResult? }} args
 *   rows    : [{ prompt, expected_intent }]  (e.g. from failingRowsForClass)
 *   runOne  : async (prompt) => vai           (e.g. runThroughVai bound to baseUrl)
 *   grade   : async (klass, expectedIntent, prompt, vai) => ({ passed })
 *   onResult: optional (perPromptResult) => void  (live progress)
 */
export async function verifyAcceptance({ rows = [], klass = '', runOne, grade, acceptRate = ACCEPT_RATE, improveRate = IMPROVE_RATE, onResult } = {}) {
  if (typeof runOne !== 'function' || typeof grade !== 'function') {
    throw new Error('verifyAcceptance requires runOne(prompt) and grade(klass,expected,prompt,vai)');
  }
  const perPrompt = [];
  for (const row of rows) {
    const prompt = row?.prompt ?? '';
    const expected = row?.expected_intent ?? row?.expectedIntent ?? '';
    const regression = !!row?.regression; // a known-PASSING prompt re-run to catch breakage
    // A row may carry its OWN class (sibling cross-class regression rows do). Grade against that,
    // falling back to the run's class for normal same-class rows.
    const rowClass = row?.klass ?? klass;
    let passed = false;
    let error = null;
    try {
      const vai = await runOne(prompt);
      const g = await grade(rowClass, expected, prompt, vai);
      passed = !!(g && g.passed);
    } catch (e) {
      error = String(e).slice(0, 120); // an infra error is NOT a recovery — counts as still-failing
    }
    const result = { prompt, passed, error, regression };
    perPrompt.push(result);
    if (onResult) { try { onResult(result); } catch {} }
  }
  return { ...summarizeAcceptance(perPrompt, { klass, acceptRate, improveRate }), perPrompt };
}

/**
 * Convenience: pull the class's currently-failing rows from the corpus, then verify them.
 * Heavy (runs the model) → caller must own the serial-GPU slot. Injectable for tests.
 */
export async function verifyClassAcceptance(db, klass, { runOne, grade, acceptRate = ACCEPT_RATE, improveRate = IMPROVE_RATE, onResult, selectRows = failingRowsForClass, selectPassing = passingRowsForClass, regressionSample = 4, siblingClasses = [] } = {}) {
  const failing = selectRows(db, klass) ?? [];
  // Add a small REGRESSION sample of known-passing prompts (marked regression:true) so a fix that
  // recovers failures but BREAKS a pass is caught and rejected — the safety that makes "keep net
  // improvements" sound. Re-running a few passes is cheap relative to the gain.
  const passing = (selectPassing(db, klass, regressionSample) ?? []).map((r) => ({ ...r, regression: true }));
  // CROSS-CLASS REGRESSION GUARD: a shared source file (e.g. build-execution-intent.ts is edited by
  // 3 classes) means a fix for THIS class can break a SIBLING class's behaviour — which the single-
  // class guard above never re-runs. Pull a passing sample from each sibling class and mark it
  // regression:true, so breaking any of them rejects the fix. Deduped by prompt; bounded + cheap.
  const seen = new Set([...failing, ...passing].map((r) => r.prompt));
  const siblingPassing = [];
  for (const sib of siblingClasses) {
    if (!sib || sib === klass) continue;
    for (const r of selectPassing(db, sib, regressionSample) ?? []) {
      if (seen.has(r.prompt)) continue;
      seen.add(r.prompt);
      // Tag the row with ITS OWN class so the grader judges a sibling regression against the
      // sibling's expected behaviour, not the fixed class's (CodeRabbit: cross-class rows must be
      // graded with their own class — otherwise a sibling "regression" is judged by the wrong rubric).
      siblingPassing.push({ ...r, regression: true, klass: sib });
    }
  }
  const rows = [...failing, ...passing, ...siblingPassing];
  return verifyAcceptance({ rows, klass, runOne, grade, acceptRate, improveRate, onResult });
}

/** Multi-line operator render of an acceptance report. */
export function formatAcceptance(report) {
  if (!report) return 'Acceptance: n/a';
  const lines = [`Acceptance: ${report.headline}`];
  if (report.stillFailing > 0 && report.stillFailingPrompts?.length) {
    lines.push(`  still failing: ${report.stillFailingPrompts.slice(0, 3).map((p) => `"${p}"`).join(', ')}`);
  }
  return lines.join('\n');
}

// ── CLI one-shot: verify a class's failing rows against LIVE Vai (owns the serial GPU
//    slot via the VRAM guard). node --experimental-sqlite acceptance-verifier.mjs --class <klass>
const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const klass = opt('--class', '');
  const baseUrl = opt('--base-url', process.env.VAI_API ?? 'http://localhost:3006');
  const dbPath = opt('--db', 'scripts/improve-loop/.corpus.sqlite');
  if (!klass) { process.stderr.write('usage: --class <klass> [--base-url ..] [--db ..]\n'); process.exit(1); }
  const { openDb } = await import('./db.mjs');
  const { runThroughVai, waitForVramHeadroom } = await import('./driver.mjs');
  const { gradeInterpretation } = await import('./brain.mjs');
  const db = openDb(dbPath);
  // Serial + VRAM-guarded re-run of each targeted failing row (BSOD rule).
  const runOne = async (prompt) => { await waitForVramHeadroom(7 * 1024 ** 3); return runThroughVai(baseUrl, prompt, { timeoutMs: 220_000 }); };
  const grade = (k, expected, prompt, vai) => gradeInterpretation(k, expected, prompt, vai);
  const rep = await verifyClassAcceptance(db, klass, {
    runOne, grade,
    onResult: (r) => process.stdout.write(`  ${r.passed ? '✓ recovered' : '✗ still failing'}: "${String(r.prompt).slice(0, 70)}"${r.error ? ` (${r.error})` : ''}\n`),
  });
  db.close();
  process.stdout.write(`\n${formatAcceptance(rep)}\n`);
  process.exit(rep.accepted ? 0 : 1);
}
