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
import { failingRowsForClass } from './db.mjs';

/** Fraction of targeted failures that must recover for an ACCEPTED verdict. */
export const ACCEPT_RATE = 0.8;

const round2 = (n) => Math.round(n * 100) / 100;

/** Pure verdict over per-prompt re-run outcomes. */
export function summarizeAcceptance(perPrompt = [], { klass = '', acceptRate = ACCEPT_RATE } = {}) {
  const rows = (perPrompt ?? []).filter((p) => p && typeof p.passed === 'boolean');
  const total = rows.length;
  const recovered = rows.filter((p) => p.passed).length;
  const stillFailing = total - recovered;
  const recoveryRate = total ? round2(recovered / total) : 0;
  // No targeted failures left to re-run is NOT a pass — there is nothing to prove a fix on.
  let verdict;
  if (total === 0) verdict = 'no-targets';
  else if (recovered === total) verdict = 'accepted';
  else if (recoveryRate >= acceptRate) verdict = 'accepted';
  else if (recovered > 0) verdict = 'partial';
  else verdict = 'rejected';
  const accepted = verdict === 'accepted';
  return {
    klass, verdict, accepted, total, recovered, stillFailing, recoveryRate,
    headline: total === 0
      ? `acceptance ${klass || '(class)'}: no targeted failures to verify`
      : `acceptance ${klass || '(class)'}: ${recovered}/${total} recovered (${Math.round(recoveryRate * 100)}%) → ${verdict.toUpperCase()}`,
    stillFailingPrompts: rows.filter((p) => !p.passed).map((p) => String(p.prompt ?? '').slice(0, 80)),
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
export async function verifyAcceptance({ rows = [], klass = '', runOne, grade, acceptRate = ACCEPT_RATE, onResult } = {}) {
  if (typeof runOne !== 'function' || typeof grade !== 'function') {
    throw new Error('verifyAcceptance requires runOne(prompt) and grade(klass,expected,prompt,vai)');
  }
  const perPrompt = [];
  for (const row of rows) {
    const prompt = row?.prompt ?? '';
    const expected = row?.expected_intent ?? row?.expectedIntent ?? '';
    let passed = false;
    let error = null;
    try {
      const vai = await runOne(prompt);
      const g = await grade(klass, expected, prompt, vai);
      passed = !!(g && g.passed);
    } catch (e) {
      error = String(e).slice(0, 120); // an infra error is NOT a recovery — counts as still-failing
    }
    const result = { prompt, passed, error };
    perPrompt.push(result);
    if (onResult) { try { onResult(result); } catch {} }
  }
  return { ...summarizeAcceptance(perPrompt, { klass, acceptRate }), perPrompt };
}

/**
 * Convenience: pull the class's currently-failing rows from the corpus, then verify them.
 * Heavy (runs the model) → caller must own the serial-GPU slot. Injectable for tests.
 */
export async function verifyClassAcceptance(db, klass, { runOne, grade, acceptRate = ACCEPT_RATE, onResult, selectRows = failingRowsForClass } = {}) {
  const rows = selectRows(db, klass) ?? [];
  return verifyAcceptance({ rows, klass, runOne, grade, acceptRate, onResult });
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
