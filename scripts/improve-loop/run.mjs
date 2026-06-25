#!/usr/bin/env node
/**
 * vai-improve-loop — crash-safe self-improvement loop.
 *
 * Generates test prompts (qwen3:8b) within known failure classes, runs each
 * through the live Vai runtime, grades whether Vai READ the question correctly,
 * mines failures into queued fix candidates, and grows a SQLite regression
 * corpus — all strictly serial with a VRAM guard so it never crashes the PC.
 *
 * Usage:
 *   node scripts/improve-loop/run.mjs                 # default: ~6 generated / class
 *   node scripts/improve-loop/run.mjs --per-class 12 --vram-gb 7 --cooldown 2500
 *   node scripts/improve-loop/run.mjs --seeds-only --limit 1  # one controlled probe
 *   node scripts/improve-loop/run.mjs --base-url http://localhost:3006
 *   node scripts/improve-loop/run.mjs --seeds-only    # no generation, just the known rows
 *
 * Resumable: re-running continues the corpus and skips already-scored prompts.
 * Read-only on Vai source. Fix candidates are QUEUED, never applied.
 */
import {
  openDb, startRun, endRun, upsertPrompt, alreadyScored,
  recordResult, queueFix, classStats, liveHeartbeat, recordAnswerLesson,
} from './db.mjs';
import { judgeAnswerExcellence } from './answer-rubric.mjs';
import { waitForVramHeadroom, loadedVram, runThroughVai, sleep, ensureRuntimeReady, isInfraError, isOverVramBudget } from './driver.mjs';
import { generatePrompts, gradeInterpretation, mineFailures } from './brain.mjs';
import { SEED_CLASSES } from './seeds.mjs';
import { claudeWorkItems } from './claude-prompts.mjs';

const args = process.argv.slice(2);
const opt = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };
const has = (flag) => args.includes(flag);

const BASE_URL = opt('--base-url', process.env.VAI_API ?? 'http://localhost:3006');
const PER_CLASS = Number(opt('--per-class', '6'));
const VRAM_BUDGET = Number(opt('--vram-gb', '7')) * 1024 ** 3;
const COOLDOWN_MS = Number(opt('--cooldown', '2000'));
const SEEDS_ONLY = has('--seeds-only');
const DB_PATH = opt('--db', 'scripts/improve-loop/.corpus.sqlite');
const LIMIT = Math.max(0, Number(opt('--limit', '0')) || 0);
// Claude authors the bulk of prompts; qwen contributes only this fraction as a
// minority top-up per class (0 = none, 1 = full PER_CLASS). Default small.
const QWEN_FRAC = Math.max(0, Math.min(1, Number(opt('--qwen-frac', '0.3'))));

// ── TUI state ───────────────────────────────────────────────────────────────
const GB = 1024 ** 3;
const bar = (frac, w = 12) => {
  const n = Math.max(0, Math.min(w, Math.round(frac * w)));
  return '█'.repeat(n) + '░'.repeat(w - n);
};
const ui = {
  runId: 0, startedAt: Date.now(), total: 0, done: 0,
  now: '', readAs: '', expected: '', lastPass: null,
  vram: 0, failures: 0, fixes: 0, crashes: 0, db: null,
};
function render() {
  const elapsed = Math.round((Date.now() - ui.startedAt) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const lines = [];
  lines.push(`VAI IMPROVE LOOP  ·  run #${ui.runId}  ·  elapsed ${mm}:${ss}  ·  ${ui.done}/${ui.total}`);
  lines.push('─'.repeat(64));
  const stats = ui.db ? classStats(ui.db, ui.runId) : [];
  for (const s of stats) {
    const frac = s.total ? s.passed / s.total : 0;
    lines.push(`${(s.class + ' '.repeat(34)).slice(0, 34)} ${bar(frac)} ${String(Math.round(frac * 100)).padStart(3)}%  (${s.passed}/${s.total})`);
  }
  lines.push('─'.repeat(64));
  lines.push(`now: "${ui.now.slice(0, 56)}"`);
  if (ui.readAs) {
    const mark = ui.lastPass == null ? '·' : ui.lastPass ? '✓' : '✗';
    lines.push(`  → read: ${ui.readAs.slice(0, 44)}  ${mark}`);
  }
  lines.push(`VRAM ${(ui.vram / GB).toFixed(1)}/${(VRAM_BUDGET / GB).toFixed(1)} GB  ${bar(ui.vram / VRAM_BUDGET, 8)}  cooldown ${(COOLDOWN_MS / 1000).toFixed(1)}s`);
  lines.push(`found ${ui.failures} failures · ${ui.fixes} fix candidates queued · ${ui.crashes} crashes`);
  lines.push(`resumable ✓  (db: ${DB_PATH})`);
  // Repaint in place.
  process.stdout.write('\x1b[2J\x1b[H' + lines.join('\n') + '\n');
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const db = openDb(DB_PATH);
  ui.db = db;
  const runId = startRun(db, `per-class=${PER_CLASS} seeds-only=${SEEDS_ONLY}`);
  ui.runId = runId;

  // Readiness gate (Verification-First): confirm the runtime is serving and pre-warm the
  // model BEFORE any turn, so the first prompts don't AggregateError on a cold model and
  // get mis-scored as Vai failures. Bakes in the manual curl-warm we used to do by hand.
  ui.now = 'readying runtime (health + model warm)…';
  const ready = await ensureRuntimeReady(BASE_URL).catch((e) => ({ ready: false, detail: String(e) }));
  ui.now = ready.detail ?? (ready.ready ? 'runtime ready' : 'runtime not ready');
  if (!ready.ready) {
    process.stderr.write(`\n[improve-loop] ${ready.detail}\n`);
    endRun(db, runId, 'aborted-runtime-down');
    return; // don't run a whole cycle of false failures against a dead runtime
  }

  let interrupted = false;
  const onSig = () => { interrupted = true; };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);

  // Build the work list: seeds (always) + generated (unless --seeds-only).
  const work = [];
  // PRIMARY: Claude-authored probe prompts (the bulk — hand-written to find hard,
  // diverse failures across the codebase, not easy seed-variations).
  const seen = new Set();
  for (const item of claudeWorkItems()) {
    if (seen.has(item.prompt)) continue;
    seen.add(item.prompt);
    work.push(item);
  }
  // ANCHOR: the original seed rows (known regressions) per class.
  for (const c of SEED_CLASSES) {
    for (const s of c.seeds) {
      if (seen.has(s)) continue;
      seen.add(s);
      work.push({ prompt: s, klass: c.klass, expectedIntent: c.expectedIntent, origin: 'seed' });
    }
  }
  // MINORITY: qwen tops up a small fraction per class (variety, tireless volume).
  if (!SEEDS_ONLY && QWEN_FRAC > 0) {
    const qwenN = Math.max(1, Math.round(PER_CLASS * QWEN_FRAC));
    for (const c of SEED_CLASSES) {
      ui.now = `qwen tops up ${qwenN} prompts for ${c.klass}…`;
      render();
      ui.vram = await waitForVramHeadroom(VRAM_BUDGET);
      if (isOverVramBudget(ui.vram, VRAM_BUDGET)) {
        ui.crashes++;
        ui.now = `infra skip qwen top-up (VRAM ${(ui.vram / GB).toFixed(1)}GB > budget ${(VRAM_BUDGET / GB).toFixed(1)}GB)`;
        render();
        continue;
      }
      const gen = await generatePrompts(c.klass, c.expectedIntent, c.seeds, qwenN);
      for (const g of gen) {
        if (seen.has(g)) continue;
        seen.add(g);
        work.push({ prompt: g, klass: c.klass, expectedIntent: c.expectedIntent, origin: 'generated' });
      }
      await sleep(COOLDOWN_MS);
    }
  }
  const selectedWork = LIMIT > 0 ? work.slice(0, LIMIT) : work;
  ui.total = selectedWork.length;

  const failures = [];
  for (const item of selectedWork) {
    if (interrupted) break;
    const promptId = upsertPrompt(db, {
      prompt: item.prompt, klass: item.klass, expectedIntent: item.expectedIntent, origin: item.origin,
    });
    if (alreadyScored(db, runId, promptId)) { ui.done++; continue; } // resume: skip done work

    ui.now = item.prompt; ui.expected = item.expectedIntent; ui.readAs = ''; ui.lastPass = null;
    render();

    // CRASH GUARD: wait for VRAM headroom, then ONE serial turn.
    ui.vram = await waitForVramHeadroom(VRAM_BUDGET);
    render();
    if (isOverVramBudget(ui.vram, VRAM_BUDGET)) {
      ui.crashes++;
      ui.now = `infra skip (VRAM ${(ui.vram / GB).toFixed(1)}GB > budget ${(VRAM_BUDGET / GB).toFixed(1)}GB)`;
      ui.done++;
      render();
      await sleep(COOLDOWN_MS);
      continue;
    }

    let vai;
    try {
      vai = await runThroughVai(BASE_URL, item.prompt, {
        timeoutMs: 220_000,
        // Live heartbeat → dashboard shows partial output + phase mid-turn.
        onProgress: ({ partial, phase, elapsedMs }) => {
          liveHeartbeat(db, { runId, prompt: item.prompt, klass: item.klass, phase, partial, elapsedMs });
        },
      });
    } catch (err) {
      // Verification-First (constitution #3): an INFRA failure (cold model AggregateError,
      // runtime down, socket reset) is NOT a Vai logic failure. Grading it pollutes the
      // corpus with false negatives. So we SKIP it — not scored, not counted as a failure —
      // and re-ready the runtime before the next turn. Only genuine answer-level errors
      // (a real timeout while connected) fall through to be recorded.
      if (isInfraError(err)) {
        ui.crashes++; // tracked for the operator, but NOT written as a graded result
        ui.now = `infra skip (${String(err).slice(0, 40)}) — re-readying…`;
        await ensureRuntimeReady(BASE_URL).catch(() => {});
        ui.done++;
        await sleep(COOLDOWN_MS);
        continue;
      }
      ui.crashes++;
      recordResult(db, {
        runId, promptId, klass: item.klass, passed: false,
        gradeReason: `run error: ${String(err).slice(0, 80)}`,
      });
      failures.push({ klass: item.klass, reason: 'run error/timeout' });
      ui.failures++; ui.done++;
      await sleep(COOLDOWN_MS);
      continue;
    }

    ui.readAs = vai.council?.realIntent ?? '(no council)';
    const grade = await gradeInterpretation(item.klass, item.expectedIntent, item.prompt, vai);
    // Verification-First: a grader-MODEL failure (not Vai's fault) must be SKIPPED, never
    // recorded as a logic failure — the same rule the runThroughVai catch enforces above.
    if (grade.infra) {
      ui.crashes++;
      ui.now = 'grader infra skip (model judge unavailable) — not scored';
      ui.done++;
      render();
      await sleep(COOLDOWN_MS);
      continue;
    }
    ui.lastPass = grade.passed;

    // Text-lane twin of the visual taste pass: grade HOW excellent the answer is
    // (craft gradient), not just whether the read was right. Pure compute, no GPU.
    const excellence = judgeAnswerExcellence(vai.text);

    recordResult(db, {
      runId, promptId, klass: item.klass,
      readAs: vai.council?.realIntent, outcome: vai.council?.outcome,
      agreement: vai.council?.agreement, answerExcerpt: vai.text,
      passed: grade.passed, gradeReason: grade.reason, durationMs: vai.durationMs,
      answerExcellence: excellence.overall,
      answerExcellenceJson: JSON.stringify(excellence),
    });
    recordAnswerLesson(db, { lesson: excellence.lesson, runId, overall: excellence.overall });
    if (!grade.passed) {
      failures.push({ klass: item.klass, reason: grade.reason });
      ui.failures++;
    }
    ui.done++;
    render();
    await sleep(COOLDOWN_MS); // keep GPU+disk off sustained peak
  }

  // Mine failures → queue fix candidates (human approves later; never auto-applied).
  for (const cand of mineFailures(failures)) {
    queueFix(db, { runId, klass: cand.klass, failureCount: cand.failureCount, location: cand.location, summary: cand.summary });
    ui.fixes++;
  }
  endRun(db, runId, interrupted ? 'interrupted' : 'done');
  ui.vram = await loadedVram();
  render();
  process.stdout.write(`\n${interrupted ? '■ interrupted (resumable)' : '✓ run complete'} — ${ui.fixes} fix candidates in ${DB_PATH}\n`);
  process.stdout.write(`  inspect: node scripts/improve-loop/report.mjs\n`);
}

main().catch((e) => { process.stdout.write(`\nfatal: ${String(e)}\n`); process.exit(1); });
