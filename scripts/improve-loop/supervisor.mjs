#!/usr/bin/env node
/**
 * supervisor — the LIVING loop. Runs improvement cycles forever, crash-safely.
 *
 * Each cycle:
 *   1. OBSERVE (safe, unattended): generate fresh prompts per class → run each
 *      through live Vai → grade interpretation → checkpoint to the corpus.
 *   2. PROPOSE (safe, read-only on source): for each failing class, ask qwen to
 *      localize the bug in the REAL source and propose a minimal patch. Queued
 *      with status='proposed'. qwen NEVER edits code.
 *
 * The APPLY step is deliberately NOT here. Applying a fix means refining qwen's
 * localization into a sound patch, running tests, and committing — judgement an
 * 8B model cannot be trusted with unattended (it proposed editing a misspelled
 * log string on its first try). So apply stays a human/architect gate: this loop
 * surfaces and queues; a reviewer approves. That is what keeps "infinite" from
 * meaning "slowly corrupts the codebase".
 *
 * SCALABLE / FUTURE-PROOF:
 *   - corpus + campaign trend grow across cycles (SQLite, survives crashes)
 *   - new failure classes are added to seeds.mjs and picked up automatically
 *   - strictly serial + VRAM-guarded + cooldown: never crashes the PC
 *   - watch live at http://localhost:4123 (node scripts/improve-loop/watch.mjs)
 *
 * Usage:
 *   node scripts/improve-loop/supervisor.mjs                 # forever
 *   node scripts/improve-loop/supervisor.mjs --max-cycles 3  # bounded
 *   node scripts/improve-loop/supervisor.mjs --per-class 4 --rest 60
 */
import { spawn } from 'node:child_process';
import { openDb } from './db.mjs';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const MAX_CYCLES = Number(opt('--max-cycles', '0')) || Infinity; // 0 = forever
const PER_CLASS = opt('--per-class', '4');
const REST_S = Number(opt('--rest', '45'));        // breather between cycles (GPU rest)
const DB_PATH = opt('--db', 'scripts/improve-loop/.corpus.sqlite');
// AUTO-APPLY toggle: when --apply is passed, each cycle also CONVERGES proposals (consensus-fix)
// and SAFELY applies the verified-safe ones to council/auto-improve (apply-consensus: risk-gate
// + rejected-guard + tsc/vitest verify + commit-or-revert + branch-guard). Off by default →
// the loop stays OBSERVE+PROPOSE-only (read-only on source), exactly as before.
const AUTO_APPLY = args.includes('--apply');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write(`[supervisor ${new Date().toLocaleTimeString()}] ${m}\n`);

/** Run a child script to completion, inheriting stdio. Resolves on exit. */
function runChild(script, extra = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-sqlite', script, ...extra, '--db', DB_PATH], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

let stop = false;
process.on('SIGINT', () => { stop = true; log('SIGINT — finishing current cycle then stopping (resumable).'); });

async function main() {
  log(`living loop starting · per-class=${PER_CLASS} · rest=${REST_S}s · ${MAX_CYCLES === Infinity ? 'FOREVER' : MAX_CYCLES + ' cycles'}`);
  if (AUTO_APPLY) {
    // Safety: auto-apply ONLY ever commits to council/auto-improve. Guard at startup so the
    // user gets a clear message instead of per-cycle refusals (apply-consensus also refuses).
    const { currentBranch, AUTO_IMPROVE_BRANCH } = await import('./apply-runners.mjs');
    const head = currentBranch();
    if (head !== AUTO_IMPROVE_BRANCH) {
      log(`✋ --apply requires HEAD on '${AUTO_IMPROVE_BRANCH}', but you're on '${head}'.`);
      log(`   Run:  git checkout -B ${AUTO_IMPROVE_BRANCH}   then start again. (Verified fixes land there; you review + Claude merges later.)`);
      process.exit(1);
    }
    log(`🤖 AUTO-APPLY ON → verified-safe fixes commit to ${AUTO_IMPROVE_BRANCH} (risk-tier'd; review-tier flagged, never auto-applied). Reversible; merge later with Claude.`);
  } else {
    log('OBSERVE+PROPOSE only (read-only on Vai source; fixes QUEUED, never applied). Add --apply to auto-apply to council/auto-improve.');
  }
  log('watch live → http://localhost:4123');

  for (let cycle = 1; cycle <= MAX_CYCLES && !stop; cycle++) {
    log(`━━━ cycle ${cycle} : OBSERVE ━━━`);
    await runChild('scripts/improve-loop/run.mjs', ['--per-class', PER_CLASS]);
    if (stop) break;

    // PROPOSE for each class that has queued failures this run.
    const db = openDb(DB_PATH);
    const run = db.prepare('SELECT id FROM runs ORDER BY id DESC LIMIT 1').get();
    const classes = db.prepare('SELECT DISTINCT class FROM fixes WHERE run_id=?').all(run.id).map((r) => r.class);
    db.close();
    for (const klass of classes) {
      if (stop) break;
      log(`━━━ cycle ${cycle} : PROPOSE [${klass}] ━━━`);
      await runChild('scripts/improve-loop/propose-fix.mjs', ['--class', klass]);
      if (AUTO_APPLY && !stop) {
        // CONVERGE: many expert personas propose; keep only grep-verified consensus.
        log(`━━━ cycle ${cycle} : CONVERGE [${klass}] ━━━`);
        await runChild('scripts/improve-loop/consensus-fix.mjs', ['--class', klass]);
      }
    }
    if (AUTO_APPLY && !stop) {
      // APPLY: the SAFE gated path — risk-gate + rejected-guard + tsc/vitest verify + commit
      // to council/auto-improve if green / revert if red. Refuses off-branch internally.
      log(`━━━ cycle ${cycle} : APPLY (verified-safe → council/auto-improve) ━━━`);
      await runChild('scripts/improve-loop/apply-consensus.mjs', []);
    }

    // Campaign snapshot.
    const db2 = openDb(DB_PATH);
    const trend = db2.prepare(
      `SELECT r.id, COUNT(res.id) t, COALESCE(SUM(res.passed),0) p FROM runs r
       LEFT JOIN results res ON res.run_id=r.id GROUP BY r.id ORDER BY r.id DESC LIMIT 5`,
    ).all().reverse();
    const proposals = db2.prepare('SELECT COUNT(*) c FROM proposals').get().c;
    db2.close();
    log('campaign: ' + trend.map((x) => `#${x.id}:${x.t ? Math.round((x.p / x.t) * 100) : 0}%`).join(' ') + ` · ${proposals} proposals queued for review`);

    if (stop) break;
    log(`cycle ${cycle} done · resting ${REST_S}s (GPU breather)…`);
    await sleep(REST_S * 1000);
  }
  log('living loop stopped. Corpus + proposals persisted; re-run to continue where it left off.');
}

main().catch((e) => { log('fatal: ' + String(e)); process.exit(1); });
