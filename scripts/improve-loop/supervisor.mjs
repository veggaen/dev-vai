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
 *   node scripts/improve-loop/supervisor.mjs                           # forever, observe+propose
 *   node scripts/improve-loop/supervisor.mjs --max-cycles 3            # bounded
 *   node scripts/improve-loop/supervisor.mjs --mode apply              # verified auto-apply switch
 *   node scripts/improve-loop/supervisor.mjs --per-class 4 --rest 60
 *   node scripts/improve-loop/supervisor.mjs --base-url http://host:3006 --db C:/tmp/vai-loop.sqlite
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { openDb, isFixBanned } from './db.mjs';
import { acquireLock } from './instance-lock.mjs';
import { evictAllModels } from './driver.mjs';
import { loadLoopConfig } from './loop-config.mjs';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const has = (f) => args.includes(f);
// Layered loop config (defaults ← VAI_LOOP_* env ← CLI flags). Existing flags like --rest and
// --budget keep working; sources records where each knob came from (echoed on watch /loop.json).
const { config: LOOP_CONFIG, sources: LOOP_CONFIG_SOURCES } = loadLoopConfig({ argv: args });
const MAX_CYCLES = Number(opt('--max-cycles', '0')) || Infinity; // 0 = forever
const PER_CLASS = opt('--per-class', '4');
const REST_S = LOOP_CONFIG.restSeconds;        // breather between cycles (GPU rest)
const DB_PATH = opt('--db', 'scripts/improve-loop/.corpus.sqlite');
const BASE_URL = opt('--base-url', process.env.VAI_API ?? 'http://localhost:3006');
const SEEDS_ONLY = has('--seeds-only');
const VRAM_GB = opt('--vram-gb', '');
const COOLDOWN_MS = opt('--cooldown', '');
const QWEN_FRAC = opt('--qwen-frac', '');
const LIMIT = opt('--limit', '');
// Per-cycle wall-clock budget for the observe step (forwarded to run.mjs). Bounds a cycle so the
// loop stays genuinely PERPETUAL instead of freezing 28–91 min on a slow observe (measured stall).
// Empty → run.mjs's own 8-min default applies. Set '0' to disable (legacy unbounded).
const MAX_RUN_MS = opt('--max-run-ms', '');
// Visual cadence: run a no-video eyes/hands probe every N cycles (0 = never). Off by
// default. Stays strictly serial (after PROPOSE/APPLY, before the GPU rest) so the
// one-heavy-task-at-a-time rule holds. Uses --no-video to avoid disk/ffmpeg load.
const VISUAL_EVERY = Number(opt('--visual-every', '0')) || 0;
// Capability cadence: run the GENERATIVE capability-innovation council every N cycles
// (0 = never). Unlike INNOVATE (which only fires on a stall and tweaks model/prompt),
// this proposes FEATURE-level upgrades (voice/vision/tooling/council/delegation) toward
// the north-star and appends them to the backlog. Heavy GPU → serial, propose-only.
const CAPABILITY_EVERY = Number(opt('--capability-every', '0')) || 0;
const CAPABILITY_FOCUS = opt('--capability-focus', '');
// AUTO-APPLY toggle: when --apply is passed, each cycle also CONVERGES proposals (consensus-fix)
// and SAFELY applies the verified-safe ones to council/auto-improve (apply-consensus: risk-gate
// + rejected-guard + tsc/vitest verify + commit-or-revert + branch-guard). Off by default →
// the loop stays OBSERVE+PROPOSE-only (read-only on source), exactly as before.
const MODE = opt('--mode', has('--apply') ? 'apply' : 'observe');
if (!['observe', 'apply'].includes(MODE)) {
  process.stderr.write(`[supervisor] invalid --mode '${MODE}'. Use observe or apply.\n`);
  process.exit(1);
}
const AUTO_APPLY = MODE === 'apply' || has('--apply');
// --engine opts into the GATED PROCESS ENGINE (choose the highest value-per-compute move each
// cycle) instead of the fixed sequence. Default OFF — the proven fixed path stays the default
// until the engine path is verified live. --budget caps compute units (≈ model calls) per cycle.
const USE_ENGINE = has('--engine');
const COMPUTE_BUDGET = LOOP_CONFIG.computeBudget;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write(`[supervisor ${new Date().toLocaleTimeString()}] ${m}\n`);
{
  // Make non-default knobs visible at startup — "which env var did I leave set?" is a real bug class.
  const overridden = Object.entries(LOOP_CONFIG_SOURCES).filter(([, s]) => s !== 'default');
  if (overridden.length) log(`config overrides: ${overridden.map(([k, s]) => `${k}=${JSON.stringify(LOOP_CONFIG[k])} (${s})`).join(', ')}`);
}
const LOCK_PATH = 'scripts/improve-loop/.supervisor.lock';
const STOP_REQUEST_PATH = 'scripts/improve-loop/.supervisor.stop';
let stop = false;

function removeStopRequest() {
  try { unlinkSync(STOP_REQUEST_PATH); } catch { /* already gone */ }
}

function consumeStopRequest() {
  if (!existsSync(STOP_REQUEST_PATH)) return false;
  let request = null;
  try { request = JSON.parse(readFileSync(STOP_REQUEST_PATH, 'utf8')); } catch { /* malformed stop file still means stop */ }
  const requestedPid = Number(request?.pid);
  if (Number.isInteger(requestedPid) && requestedPid > 0 && requestedPid !== process.pid) {
    removeStopRequest();
    log(`ignored stale stop request for PID ${requestedPid}; current supervisor PID is ${process.pid}.`);
    return false;
  }
  removeStopRequest();
  stop = true;
  log(`operator stop requested${request?.requestedAt ? ` at ${request.requestedAt}` : ''}; finishing current checkpoint and stopping.`);
  return true;
}

async function restWithStop(seconds) {
  const deadline = Date.now() + Math.max(0, seconds) * 1000;
  while (!stop && Date.now() < deadline) {
    if (consumeStopRequest()) break;
    await sleep(Math.min(1000, Math.max(0, deadline - Date.now())));
  }
}

/** Run a child, CAPTURE its stdout (for the council step so the watch page can show it). */
function runChildCapture(script, extra = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-sqlite', script, ...extra, '--db', DB_PATH], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    child.on('exit', () => resolve(out));
    child.on('error', () => resolve(out));
  });
}

/** Append a council finding to a small JSON the watch page reads (keep last 30). */
function recordCouncilFinding(fs, finding) {
  const path = 'Temporary_files/council-findings.json';
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(path, 'utf8')); } catch {}
  arr.unshift(finding);
  try { fs.writeFileSync(path, JSON.stringify(arr.slice(0, 30), null, 0)); } catch {}
}

/**
 * ACT ON CONSENSUS for a low-contrast flaw: find a too-dim tailwind text class in a real source
 * file and write a verifiable find/replace (one shade lighter), then run the guarded apply path
 * (tsc-gated, commit-or-revert, branch-guarded). Surgical + reversible. Returns when done.
 */
async function actOnContrastConsensus(cycle, taste) {
  // Pick the first contrast flaw whose selector carries an actionable text-zinc-N00 class
  // (some flaws have generic selectors like span.hidden.flex-1 we can't safely act on).
  const contrastFlaw = (taste.topFlaws || []).find((f) => /contrast|invisible/i.test(f.symptom) && /text-zinc-\d00/.test(f.selector || ''));
  if (!contrastFlaw) { log('ACT: no contrast flaw with a text-zinc class this cycle'); return null; }
  const m = String(contrastFlaw.selector).match(/text-zinc-(\d00)/);
  if (!m) return null;
  const dim = `text-zinc-${m[1]}`;
  const lighter = `text-zinc-${Math.max(300, Number(m[1]) - 100)}`;
  if (dim === lighter) return null;
  const { execSync } = await import('node:child_process');
  const fs = await import('node:fs');
  let files = [];
  try {
    files = execSync(`git grep -l -F ${dim} -- apps/desktop/src`, { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch (e) { log(`ACT grep failed: ${String(e).slice(0, 60)}`); return null; }
  // Pick a file where the class appears EXACTLY ONCE so the find/replace is unambiguous
  // (apply-fix refuses ambiguous multi-match finds — correctly). Skip files with 2+ matches.
  let file = '', content = '';
  for (const f of files) {
    let c = ''; try { c = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (c.split(dim).length - 1 === 1) { file = f; content = c; break; }
  }
  if (!file) { log(`ACT: ${dim} found but never uniquely (all files have 2+ matches) — skip`); return null; }
  const vdb = openDb(DB_PATH);
  // BACKOFF: don't re-propose a contrast swap that already failed verify ≥2× and was BANNED. Before
  // this guard the contrast path grepped, picked a file, inserted a consensus row, and spawned
  // apply-consensus EVERY visual cycle for an already-dead fix (BuildStatusBadge.tsx text-zinc-500
  // burned 885 reverted-red attempts). The quarantine only kicked in INSIDE apply-consensus; check
  // it HERE so a banned fix costs nothing instead of a full propose→apply round-trip.
  if (isFixBanned(vdb, { file, find: dim, replace: lighter })) {
    vdb.close();
    log(`ACT: ${dim}→${lighter} in ${file.replace('apps/desktop/src/', '')} is BANNED (failed verify ≥2×) — skipping, not re-proposing.`);
    return null;
  }
  try { vdb.exec(`CREATE TABLE IF NOT EXISTS consensus (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT, file TEXT, find TEXT, replace TEXT, agree_count INTEGER, personas TEXT, verified INTEGER, why TEXT, created_at TEXT)`); } catch {}
  // Build a FULL source-line find/replace (not a bare token) and run it through the same mechanical
  // verifier apply-consensus trusts — so verified=1 actually means "validated edit", not just "token
  // present" (CodeRabbit #25). The line containing `dim` becomes find; the same line with dim→lighter
  // is replace. We already know `dim` appears exactly once in this file (picked above).
  const findLine = content.split('\n').find((l) => l.includes(dim));
  if (!findLine) { vdb.close(); return null; }
  const replaceLine = findLine.replace(dim, lighter);
  const { verifyProposal } = await import('./proposal-verifier.mjs');
  const v = verifyProposal({ file, find: findLine.trim(), replace: replaceLine.trim() }, { readFile: (p) => fs.readFileSync(p, 'utf8') });
  if (!v.ok) { vdb.close(); log(`ACT: contrast edit failed verify (${v.code}) — not inserting`); return null; }
  const storedFind = v.correctedFind ?? findLine.trim();
  vdb.prepare('INSERT INTO consensus (class,file,find,replace,agree_count,personas,verified,why,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('ui/contrast', file, storedFind, replaceLine.trim(), 1, 'council-ui', 1, `raise text contrast ${dim}→${lighter}`, new Date().toISOString());
  vdb.close();
  log(`cycle ${cycle} : ACT → ${dim}→${lighter} in ${file}`);
  // Forward --base-url so apply-consensus runs behavioural acceptance against THIS runtime, not its
  // default (CodeRabbit #25). Parse the numeric summary instead of grepping for "red" — the summary
  // always prints "reverted-red=N", so a substring match made `committed` false even on success.
  const out = await runChildCapture('scripts/improve-loop/apply-consensus.mjs', ['--tsconfig', 'apps/desktop/tsconfig.json', '--base-url', BASE_URL]).catch(() => '');
  const committedMatch = out.match(/applied\+committed=(\d+)/);
  const committed = !!committedMatch && Number(committedMatch[1]) > 0;
  return { label: `${dim}→${lighter} in ${file.replace('apps/desktop/src/', '')}`, committed, detail: out.replace(/\x1b\[[0-9;]*m/g, '').slice(-900) };
}

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

/** Run one no-video visual eyes/hands probe through the operator, recorded to the corpus DB.
 *  Serial like every other step (one heavy task at a time). Failure is operator evidence,
 *  never a Vai-logic failure — so it never aborts the loop. */
function runVisualProbe() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--experimental-sqlite', 'scripts/improve-loop/operator.mjs', 'visual',
      '--no-video', '--db', DB_PATH, '--base-url', BASE_URL,
    ], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

/**
 * Clean shutdown: free the GPU and release the single-instance lock. Run exactly once on the way
 * out, no matter how we exit (graceful loop end, Ctrl-C, kill, fatal error). Evicting the model is
 * the difference between "took a break and the GPU is free to game" and "a 5GB model stays pinned".
 */
let shuttingDown = false;
async function cleanShutdown(release) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    const evicted = await evictAllModels();
    if (evicted.length) log(`shutdown: evicted ${evicted.join(', ')} from VRAM (GPU freed).`);
  } catch { /* never let cleanup throw */ }
  try { release(); } catch { /* idempotent */ }
}

/**
 * engineMain — the GATED-PROCESS-ENGINE loop (--engine). Each cycle CHOOSES the highest
 * value-per-compute moves within a compute budget instead of running a fixed sequence, logs
 * every decision to loop_events (proof-of-motion), and reports a perpetual-health verdict
 * (is quality actually rising AND attributable to the loop?). Crash-safe + resumable like main().
 */
async function engineMain() {
  const { createRegistry, runCycle } = await import('./process-engine.mjs');
  const { defineLoopProcesses, buildLoopContext, advanceCycleCounters } = await import('./loop-processes.mjs');
  const { analyzeMotion } = await import('./motion.mjs');
  const { campaignTrend, answerExcellenceTrend, logLoopEvent, loopEventStats, recordKnowledge } = await import('./db.mjs');
  const { MIN_MOTION_SAMPLE, planNextExperiment, anyOpenExperiment, hasOpenExperiment, recordCandidate } = await import('./innovation-engine.mjs');
  const { runNextExperiment, drainExperiments, experimentBlocksPrototype } = await import('./experiment-runner.mjs');
  const { generateNovelExperiment } = await import('./experiment-generator.mjs');
  const { collectSignals, makeSample, analyzeQuality, verifyPerpetualWork, formatHealth } = await import('./perpetual-health.mjs');
  const { runPrototype } = await import('./prototype.mjs');
  const { verifyProposal } = await import('./proposal-verifier.mjs');
  const { pickReviewer, buildReviewPrompt, parseReview, reviewVerdict } = await import('./review-gate.mjs');
  const { installedModels, loadedVram, residentModel, waitForVramHeadroom, ollamaGenerate } = await import('./driver.mjs');
  const { readFileSync } = await import('node:fs');

  // VRAM budget (bytes) the review gate must stay under — the BSOD guard. Same --vram-gb knob the
  // rest of the loop uses (default 8.5GB on this 12GB card: fits one ~5GB model + headroom, blocks
  // a second concurrent heavy model). Quality-first WITHIN this budget; never exceed it.
  const REVIEW_VRAM_BUDGET = (Number(VRAM_GB) || 8.5) * 1024 ** 3;

  // The model SECOND-OPINION gate (Thorsen "never ship raw model output"). Picks the best model
  // that safely fits current headroom (dynamic per system), one VRAM-guarded serial call, honest-
  // null on timeout (gate skipped, not failed). Default-on for every code prototype.
  const reviewGate = async ({ artifact, candidate }) => {
    if (!artifact) return { pass: false, detail: 'no artifact to review' };
    let source = '';
    try { source = readFileSync(artifact.file, 'utf8'); } catch {}
    const idx = source.indexOf(artifact.find);
    const excerpt = idx >= 0
      ? source.slice(Math.max(0, idx - 200), idx + (artifact.find?.length ?? 0) + 200)
      : '';
    const [installed, resident, vram] = await Promise.all([installedModels(), residentModel(), loadedVram()]);
    const headroom = Math.max(0, REVIEW_VRAM_BUDGET - vram);
    const pick = pickReviewer({ installed, resident, headroomBytes: headroom });
    if (!pick.model) return { pass: true, detail: 'no reviewer model available — deferring to mechanical gate' };
    // If the pick would need a swap, make sure there's room first (block until headroom or timeout).
    if (pick.swap) await waitForVramHeadroom(REVIEW_VRAM_BUDGET, { maxWaitMs: 60_000 }).catch(() => {});
    const prompt = buildReviewPrompt({
      klass: candidate?.config?.klass, hypothesis: candidate?.hypothesis,
      find: artifact.find, replace: artifact.replace, why: artifact.why, sourceExcerpt: excerpt,
    });
    let raw = '';
    try { raw = await ollamaGenerate(pick.model, prompt, { numPredict: 120, timeoutMs: 90_000 }); }
    catch { return { pass: true, detail: `reviewer ${pick.model} unavailable — deferring to mechanical gate` }; }
    const verdict = reviewVerdict(parseReview(raw));
    return { pass: verdict.pass, detail: `[${pick.model}] ${verdict.detail}` };
  };

  // Sample the codebase-quality composite (perpetual-health) on demand — the prototype's
  // before/after value signal. Cheap signals only (no tsc) so a prototype re-sample is fast.
  const sampleQuality = async () => {
    try { return makeSample(await collectSignals({ withTsc: false })).composite; } catch { return null; }
  };

  // Child runner mirrors the fixed path's spawn (serial, --db forwarded, exit code resolved).
  const runChild = (script, extra = []) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-sqlite', script, ...extra, '--db', DB_PATH], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });

  // The processes delegate to the SAME working code; we inject the runners so behaviour is
  // unchanged, only the WHEN/whether is now gated by value-per-compute.
  const registry = createRegistry(defineLoopProcesses({
    runChild,
    autoApply: AUTO_APPLY,
    // Prototype's "one change at a time" gate: hold only for a FRESH measurement (a code edit would
    // confound it), but don't let a lingering experiment camp the slot forever — that deadlock kept
    // fixes from ever landing. experimentBlocksPrototype releases past a short grace.
    anyOpen: (db) => experimentBlocksPrototype(db),
    closeExperiment: (db) => drainExperiments(db), // drain the whole closeable backlog, not one
    planExperiment: (db) => planNextExperiment(db, { record: true }),
    generateNovel: async (db, scorecard) => {
      const cand = await generateNovelExperiment(db);
      if (cand && !hasOpenExperiment(db, cand)) return recordCandidate(db, cand, scorecard);
      return null;
    },
    // PROTOTYPE: build the smallest verified artifact for the weakest class and value it. Build =
    // the existing propose-fix child (knowledge-injected, writes a verified proposal row). Gates,
    // cheap→expensive: verify (mechanical, reads the row) → typecheck/test (only in apply mode,
    // via apply-consensus). Valued by Δquality/compute; adopted only on a positive measured delta.
    runPrototypeFor: async (ctx) => {
      const klass = ctx.worstClass;
      if (!klass) return null;
      // Re-check at RUN time (not just plan time): innovate may have opened an experiment earlier
      // in THIS cycle. Hold only for a FRESH measurement (grace-aware) — a lingering experiment must
      // not block the fix, else nothing ever lands.
      if (experimentBlocksPrototype(ctx.db)) return null;
      const cycle = ctx.cycle ?? 0;
      return runPrototype(
        { type: 'code', hypothesis: `fix weakest class ${klass} (${Math.round((ctx.worstPassRate ?? 0) * 100)}%)`, config: { klass } },
        {
          cycle,
          build: async () => {
            const code = await runChild('scripts/improve-loop/propose-fix.mjs', ['--class', klass]);
            // Read the proposal propose-fix just wrote (latest row for this class).
            const row = ctx.db.prepare(
              "SELECT file, find, \"replace\", status FROM proposals WHERE class = ? ORDER BY id DESC LIMIT 1",
            ).get(klass);
            return code === 0 && row ? row : null;
          },
          gates: {
            // Mechanical verification — the artifact's `find` must exist, be executable, unique.
            verify: async (gctx) => {
              const { artifact } = gctx;
              if (!artifact) return { pass: false, detail: 'no proposal produced' };
              // propose-fix already auto-rejects bad finds into status; trust that, then re-verify.
              if (/^auto-rejected/.test(artifact.status || '')) return { pass: false, detail: artifact.status };
              const v = verifyProposal(
                { file: artifact.file, find: artifact.find, replace: artifact.replace },
                { readFile: (p) => readFileSync(p, 'utf8') },
              );
              // Observe mode has no apply step — a verified candidate is itself small positive value
              // (a real, applyable fix exists). In apply mode the test gate sets value from whether a
              // commit actually landed+accepted, so we don't credit mere verification here.
              if (v.ok && !AUTO_APPLY) gctx.metricDelta = 0.05;
              return { pass: v.ok, detail: v.detail };
            },
            // SECOND OPINION (default-on): a real model reviews soundness before commit. Runs
            // after the cheap mechanical gate (don't pay a model call on a hallucinated find) and
            // before the expensive tsc/test gate (don't compile a fix the reviewer rejects).
            review: reviewGate,
            // typecheck+test only when we actually apply (observe mode values on verification only).
            ...(AUTO_APPLY ? {
              test: async (gctx) => {
                // Count real committed fixes BEFORE this apply, so we can tell if THIS prototype
                // actually landed one. The engine's value function otherwise reads the global
                // perpetual-health composite, which a single-file routing fix never moves in one
                // cycle → every gate-passing fix was discarded as "no value" (0/331 ever adopted).
                // Drive value from the ACTUAL outcome instead: a fix that committed + behaviourally
                // recovered its class is real progress and must be adopted.
                // Tolerate a missing consensus table (fresh DB, before consensus-fix creates it):
                // default the count to 0 instead of throwing and killing the apply step (CodeRabbit #25).
                const countCommitted = () => {
                  try { return ctx.db.prepare("SELECT COUNT(*) n FROM consensus WHERE applied='committed'").get().n; }
                  catch { return 0; }
                };
                const committedBefore = countCommitted();
                await runChild('scripts/improve-loop/consensus-fix.mjs', ['--class', klass]);
                const code = await runChild('scripts/improve-loop/apply-consensus.mjs', ['--base-url', BASE_URL]);
                const committedAfter = countCommitted();
                const landed = committedAfter > committedBefore;
                // A landed+accepted commit is real value → drives valuePrototype to ADOPT (metricDelta
                // is the fallback signal when there's no codebase-quality delta). No commit → no value,
                // but the gate still "passes" iff apply-consensus didn't error/revert.
                if (landed) gctx.metricDelta = 0.1;
                return {
                  pass: code === 0,
                  detail: landed
                    ? `committed+accepted a fix for ${klass} (real source change landed)`
                    : (code === 0 ? 'apply-consensus ran; nothing newly committed (skipped/reverted)' : 'apply-consensus failed/reverted'),
                };
              },
            } : {}),
          },
          // Value is driven by the ACTUAL outcome via metricDelta (set in the verify/test gates),
          // NOT the global perpetual-health composite. A single-file fix never moves the codebase-
          // wide composite in one cycle, so reading it made qualityDelta≈0 and discarded every
          // gate-passing fix as "no value" (the 0/331-adopted defect). Returning null here makes
          // valuePrototype fall back to metricDelta: +0.05 for a verified candidate (observe) or
          // +0.1 for a committed+accepted fix (apply). The codebase composite still drives the
          // separate perpetual-health verdict; it just shouldn't gate per-fix adoption.
          sampleQuality: async () => null,
          computeOf: () => (AUTO_APPLY ? 3 : 1),
          experimentId: null,
          onEvent: (e) => logLoopEvent(ctx.db, { cycle, kind: 'prototype', process: 'prototype', detail: e }),
        },
      );
    },
    runArgs: () => {
      const a = ['--per-class', PER_CLASS, '--base-url', BASE_URL];
      if (SEEDS_ONLY) a.push('--seeds-only');
      if (VRAM_GB) a.push('--vram-gb', VRAM_GB);
      if (COOLDOWN_MS) a.push('--cooldown', COOLDOWN_MS);
      if (QWEN_FRAC) a.push('--qwen-frac', QWEN_FRAC);
      if (LIMIT) a.push('--limit', LIMIT);
      if (MAX_RUN_MS) a.push('--max-run-ms', MAX_RUN_MS);
      return a;
    },
  }));

  log(`🧭 ENGINE MODE · budget ${COMPUTE_BUDGET} compute units/cycle · mode=${AUTO_APPLY ? 'apply' : 'observe'}`);
  log(`processes: ${[...registry.keys()].join(', ')}`);
  log('watch live → http://localhost:4123');

  // Sample baseline quality once before the loop so the health trend has a t0 anchor.
  let qualitySamples = [];
  try { qualitySamples.push(makeSample(await collectSignals({ withTsc: false }))); } catch {}

  for (let cycle = 1; cycle <= MAX_CYCLES && !stop; cycle++) {
    if (consumeStopRequest()) break;
    const db = openDb(DB_PATH);
    let ran = [];
    try {
      // MOTION (filtered series — the same signal the innovation engine reads).
      const passSeries = campaignTrend(db).filter((r) => Number(r.total) >= MIN_MOTION_SAMPLE).map((r) => Number(r.passed) / Number(r.total));
      const exSeries = answerExcellenceTrend(db).filter((r) => Number(r.n) >= MIN_MOTION_SAMPLE && r.avg != null).map((r) => Number(r.avg));
      const motion = analyzeMotion({ passRate: passSeries, excellence: exSeries });
      const ctx = buildLoopContext(db, { motion, cycle });

      log(`━━━ cycle ${cycle} · ${motion.headline} ━━━`);
      logLoopEvent(db, { cycle, kind: 'cycle', detail: { motion: motion.state, passRate: ctx.passRate, worstClass: ctx.worstClass, failing: ctx.failingClassCount } });

      // MEANING: before spending the cycle, weigh ALL work sources (routing / answer-quality /
      // capability backlog / stuck weaknesses) and name the highest-LEVERAGE lane — so the loop is
      // working on what's MEANINGFUL, not just defaulting to routing micro-bugs. Logged + recorded
      // for the dashboard; pure read, never throws into the loop.
      try {
        const { gatherMeaningSignals, chooseMeaningfulWork } = await import('./meaning-selector.mjs');
        // Feed the WHOLE-APP code-health signal (composite + the biggest concrete gap) so the
        // codebase lane can compete — the loop now weighs "improve the app's structure/polish"
        // alongside answer routing/quality. Read from the latest perpetual-health sample.
        const lastSample = qualitySamples[qualitySamples.length - 1] ?? null;
        const codebaseHealth = lastSample?.composite ?? null;
        const bigFile = Number(lastSample?.signals?.maxFileLines ?? 0);
        const todoN = Number(lastSample?.signals?.todoCount ?? 0);
        const codebaseTopGap = bigFile > 8000 ? `a ${(bigFile / 1000).toFixed(0)}k-line file to decompose`
          : todoN > 80 ? `${todoN} TODO/FIXME to resolve` : null;
        const codebaseGaps = (bigFile > 8000 ? 1 : 0) + (todoN > 80 ? 1 : 0);
        const meaning = chooseMeaningfulWork(gatherMeaningSignals(db, { codebaseHealth, codebaseGaps, codebaseTopGap }));
        if (meaning.lane) {
          log(`  🎯 ${meaning.headline}`);
          logLoopEvent(db, { cycle, kind: 'meaning', detail: { lane: meaning.lane, leverage: meaning.leverage, reason: meaning.reason, ranking: meaning.ranking.map((l) => ({ lane: l.lane, leverage: Math.round(l.leverage * 100) / 100 })) } });
          recordKnowledge(db, { scope: 'loop:meaning', claim: `highest-leverage lane is ${meaning.lane}`, kind: 'observation', confirm: true, evidence: meaning.reason });
        }
      } catch (e) { log('  meaning skipped: ' + String(e).slice(0, 70)); }

      const result = await runCycle(registry, ctx, {
        budget: COMPUTE_BUDGET,
        onEvent: (e) => {
          // Persist EVERY engine decision so "is perpetual motion true?" is answerable from data.
          if (e.type === 'plan') {
            const elig = e.scorecard.filter((s) => s.eligible).map((s) => `${s.id}:${s.density.toFixed(2)}`);
            log(`  plan: [${e.chosen.join(', ') || 'nothing — all below floor or over budget'}] (spend ${e.spent}/${COMPUTE_BUDGET}) · eligible ${elig.join(' ')}`);
            logLoopEvent(db, { cycle, kind: 'plan', compute: e.spent, detail: { chosen: e.chosen, scorecard: e.scorecard } });
          } else if (e.type === 'run:start') {
            log(`  ▸ ${e.id}…`);
          } else if (e.type === 'run:done') {
            const prod = e.result?.produced ?? 0;
            log(`  ✓ ${e.id} (${e.ms}ms, produced ${prod})`);
            logLoopEvent(db, { cycle, kind: 'run:done', process: e.id, ok: true, ms: e.ms, detail: e.result ?? null });
          } else if (e.type === 'run:error') {
            log(`  ✗ ${e.id} ERROR: ${e.error}`);
            logLoopEvent(db, { cycle, kind: 'run:error', process: e.id, ok: false, ms: e.ms, detail: { error: e.error } });
          }
        },
      });
      ran = result.ran;
      advanceCycleCounters(db, ran);

      // RUNTIME-DOWN GUARD: if observe couldn't run because Vai is down, the loop is BLOCKED, not
      // failing. Say so honestly instead of crying "meta-slop" every cycle against a dead runtime
      // (the misleading output: fast empty cycles + flat 0.5135 quality). Skip the health verdict.
      const runtimeDown = (result.outcomes ?? []).some((o) => o.result?.runtimeDown);
      // PERPETUAL-HEALTH: is the loop actually improving the codebase, attributably? Sample cheap
      // signals; tsc only every 5th cycle (heavy). Attribution = experiments adopted + observe ran.
      const withTsc = cycle % 5 === 0;
      try {
        if (runtimeDown) {
          log(`  ⏸ WAITING: Vai runtime is DOWN at ${BASE_URL} — observe cannot run. Start it (pnpm --filter @vai/runtime dev). Not a loop failure; resumes automatically when it's back.`);
          logLoopEvent(db, { cycle, kind: 'health', detail: { working: null, state: 'blocked', reason: 'runtime down — observe cannot run' } });
        } else {
        qualitySamples.push(makeSample(await collectSignals({ withTsc })));
        if (qualitySamples.length > 20) qualitySamples = qualitySamples.slice(-20); // bounded series, not a corpus
        const quality = analyzeQuality(qualitySamples);
        const adopted = result.outcomes.filter((o) => o.result?.adopted).length;
        const landedObserve = ran.includes('propose') && AUTO_APPLY ? 1 : 0;
        const verify = verifyPerpetualWork(quality, { proposalsAdopted: adopted, commitsByLoop: landedObserve });
        log(`  ${formatHealth(quality, verify)}`);
        logLoopEvent(db, { cycle, kind: 'health', detail: { working: verify.working, state: quality.state, composite: quality.composite.current, reason: verify.reason } });
        // Capture the verdict as a counted fact (cheap, bounded) so the operator can trend it.
        if (verify.working === false) recordKnowledge(db, { scope: 'loop:health', claim: 'cycle did not improve codebase quality', evidence: verify.reason, confirm: true });
        }
      } catch (e) { log('  health check skipped: ' + String(e).slice(0, 70)); }

      // PROOF-OF-MOTION rollup every 10 cycles.
      if (cycle % 10 === 0) {
        const stats = loopEventStats(db, { sinceCycle: cycle - 10 });
        log(`  proof-of-motion (last 10 cycles): ${stats.perProcess.map((p) => `${p.process}×${p.done}${p.errors ? `(${p.errors}err)` : ''}`).join(' ') || 'nothing ran'}`);
      }
    } catch (e) {
      log(`cycle ${cycle} fatal-guard: ${String(e).slice(0, 120)}`); // a cycle error must not kill the loop
    } finally {
      db.close();
    }

    if (stop) break;
    log(`cycle ${cycle} done · resting ${REST_S}s (GPU breather)…`);
    await restWithStop(REST_S);
  }
  log('engine loop stopped. loop_events + corpus persisted; re-run to continue.');
}

async function main() {
  const forwarded = [
    `base-url=${BASE_URL}`,
    `db=${DB_PATH}`,
    SEEDS_ONLY ? 'seeds-only' : null,
    VRAM_GB ? `vram-gb=${VRAM_GB}` : null,
    COOLDOWN_MS ? `cooldown=${COOLDOWN_MS}` : null,
    QWEN_FRAC ? `qwen-frac=${QWEN_FRAC}` : null,
    LIMIT ? `limit=${LIMIT}` : null,
  ].filter(Boolean).join(' · ');
  log(`living loop switch · mode=${AUTO_APPLY ? 'apply' : 'observe'} · ${forwarded}`);
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
  if (VISUAL_EVERY > 0) {
    log(`👁  visual cadence ON → a no-video eyes/hands probe every ${VISUAL_EVERY} cycle(s), serial, recorded to the corpus.`);
  }
  if (CAPABILITY_EVERY > 0) {
    log(`🚀 capability cadence ON → a generative capability council every ${CAPABILITY_EVERY} cycle(s)${CAPABILITY_FOCUS ? ` (focus: ${CAPABILITY_FOCUS})` : ''}, serial, propose-only → backlog.`);
  }
  log('watch live → http://localhost:4123');

  const VISUAL_ONLY = has('--visual-only'); // skip text seeds; only inspect the live UI

  for (let cycle = 1; cycle <= MAX_CYCLES && !stop; cycle++) {
    if (consumeStopRequest()) break;
    if (VISUAL_ONLY) {
      log(`━━━ cycle ${cycle} : EYES (probe → screenshot/video/taste) ━━━`);
      await runVisualProbe();
      if (stop) break;
      // Put the COUNCIL to work on what the eyes just saw: read the taste verdict + top flaw and
      // propose the smallest fix to Vai's UI / eyes system. Council burns the compute; findings
      // land in the corpus log for review. This is the self-improvement, not seed-prompt noise.
      try {
        const { buildVisualCouncilPacket } = await import('./db.mjs');
        const vdb = openDb(DB_PATH);
        const t = buildVisualCouncilPacket(vdb)?.taste ?? null;
        vdb.close();
        log(`(eyes→council: taste ${t ? t.overall : 'none'})`);
        if (t) {
          // ONE merged finding per cycle: measured audit + council take + the ACTION taken.
          const flaw = t.topFlaws?.[0];
          // Keep this SHORT + code-shaped. A long design-y prompt (or words like image/render/
          // visual/draw) routes the turn to the image generator and the council never convenes.
          // Phrase as a plain design question with NO router-trigger keywords (repo/review/code/
          // git/status/image/render) so it reaches the council, not a deterministic handler.
          const q = `Our app interface scored ${t.overall} out of 10 for visual quality. `
            + (flaw ? `The main problem: ${flaw.symptom}${flaw.selector ? ` on the element ${flaw.selector}` : ''}. A possible direction is ${flaw.fixDirection}. ` : '')
            + `How would you improve this so it feels premium and polished? Name the smallest change you would make and how you would confirm it worked.`;
          log(`━━━ cycle ${cycle} : COUNCIL on eyes (taste ${t.overall}/10) ━━━`);
          const out = await runChildCapture('scripts/improve-loop/council-ui.mjs', [q, '--base-url', BASE_URL]).catch(() => '');
          const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
          // Only attach the council finding when members ACTUALLY responded (not 0/X). A hollow
          // "0/3 responded" / image-backend non-answer is noise — skip it; the measured audit stands.
          const respMatch = clean.match(/Council:.*?(\d+)\/(\d+) responded/s);
          const responded = respMatch ? Number(respMatch[1]) : 0;
          // Pull just the members' fix lines (not the whole transcript) for a tight summary.
          const councilFix = (clean.match(/• .*?(?:\n  .*)*/g) || []).join('\n').slice(0, 900);

          // ACT ON CONSENSUS (apply mode, branch-guarded): turn the flaw into a verified commit.
          let action = null;
          if (AUTO_APPLY && responded >= 1) action = await actOnContrastConsensus(cycle, t);

          // ONE merged finding: audit + council take + action result. No more duplicate rows.
          const flawLines = (t.topFlaws || []).slice(0, 5)
            .map((f) => `[${f.severity}] ${f.symptom}${f.selector ? ` — ${f.selector}` : ''}`).join('\n');
          const head = action
            ? `⚙️ ${action.committed ? 'COMMITTED' : 'attempted'}: ${action.label}`
            : flaw ? `[${flaw.severity}] ${flaw.symptom}` : `taste ${t.overall}/10`;
          const fs = await import('node:fs');
          recordCouncilFinding(fs, {
            at: new Date().toISOString(), cycle, taste: t.overall, wow: t.humanAppeal?.wow ?? null,
            flaw: head,
            council:
              `SCORES  comp ${t.scores?.composition} · motion ${t.scores?.motion} · interaction ${t.scores?.interactionFeel} · identity ${t.scores?.visualIdentity} · wow ${t.humanAppeal?.wow}\n\n`
              + `FLAWS\n${flawLines || '(none)'}\n\n`
              + (responded >= 1 ? `COUNCIL (${responded} responded)\n${councilFix}\n\n` : `COUNCIL: no members responded this cycle\n\n`)
              + (action ? `ACTION → ${action.label}\nVERIFY (tsc): ${action.committed ? '✅ PASS — committed to council/auto-improve' : '↩ reverted/skipped (not committed)'}\n${action.detail}` : `ACTION: none (observe, or no actionable contrast class)`),
          });
          log(`cycle ${cycle} : recorded (council ${responded}, action ${action ? (action.committed ? 'committed' : 'attempted') : 'none'})`);
        }
      } catch (e) { log('council-on-eyes skipped: ' + String(e).slice(0, 80)); }
      if (stop) break;
      log(`cycle ${cycle} done · resting ${REST_S}s…`);
      await restWithStop(REST_S);
      continue;
    }
    log(`━━━ cycle ${cycle} : OBSERVE ━━━`);
    const runArgs = ['--per-class', PER_CLASS, '--base-url', BASE_URL];
    if (SEEDS_ONLY) runArgs.push('--seeds-only');
    if (VRAM_GB) runArgs.push('--vram-gb', VRAM_GB);
    if (COOLDOWN_MS) runArgs.push('--cooldown', COOLDOWN_MS);
    if (QWEN_FRAC) runArgs.push('--qwen-frac', QWEN_FRAC);
    if (LIMIT) runArgs.push('--limit', LIMIT);
    if (MAX_RUN_MS) runArgs.push('--max-run-ms', MAX_RUN_MS);
    await runChild('scripts/improve-loop/run.mjs', runArgs);
    if (stop) break;

    // PROPOSE for each class that has queued failures this run.
    const db = openDb(DB_PATH);
    const run = db.prepare('SELECT id FROM runs ORDER BY id DESC LIMIT 1').get();
    let classes = db.prepare('SELECT DISTINCT class FROM fixes WHERE run_id=?').all(run.id).map((r) => r.class);
    // BUDGET GUARD: drop classes the loop can NEVER ground a fix for (orphan classes with no real
    // source file — e.g. the routing/comparison phantom that burned 50 no-file rejections, or a
    // class flagged ungroundable after ≥3 hallucinated proposals). The engine path already filters
    // these via buildLoopContext; the fixed path did not, so a permanently-0% phantom sorted to the
    // TOP of weakest-first and ate the one-at-a-time GPU budget every cycle. This is the #1 reason
    // proposal yield was <1%. Read-only; never throws into the loop.
    try {
      const { ungroundableClasses } = await import('./db.mjs');
      const skip = ungroundableClasses(db);
      if (skip.size) {
        const dropped = classes.filter((c) => skip.has(c));
        classes = classes.filter((c) => !skip.has(c));
        if (dropped.length) log(`GRADE: skipping ${dropped.length} ungroundable class(es) → ${dropped.join(', ')} (no real source file / model can't land a fix)`);
      }
    } catch (e) { log('ungroundable filter skipped: ' + String(e).slice(0, 80)); }
    // GRADE: order the failing classes WEAKEST-FIRST by campaign-wide pass-rate, so the
    // scarce one-at-a-time GPU budget goes to the LOWEST pass-rate class — not whichever
    // familiar near-passing class happened to fail this tiny run. Deterministic, read-only;
    // never throws into the loop (falls back to the original order on any error).
    try {
      const { campaignClassStats, topTasteLessons, topAnswerLessons } = await import('./db.mjs');
      const { gradeLedger } = await import('./grader.mjs');
      const { buildActionQueue, formatTopAction } = await import('./action-queue.mjs');
      const grade = gradeLedger({
        classStats: campaignClassStats(db),
        tasteLessons: topTasteLessons(db, 8),
        answerLessons: topAnswerLessons(db, 8),
      });
      const order = new Map(grade.targets.map((c, i) => [c.class, i]));
      classes = classes.slice().sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
      const weakest = grade.targets.find((c) => c.target && classes.includes(c.class));
      if (weakest) log(`GRADE: targeting weakest first → ${weakest.class} ${Math.round(weakest.passRate * 100)}% (${weakest.passed}/${weakest.total})`);
      // BRIDGE: surface the top queued fix (stuck lessons outrank weak classes) so the
      // ×N meta-slop lesson is named every cycle. Queue-only — nothing is auto-applied.
      const queue = buildActionQueue(grade);
      if (queue.length) log(`GRADE: ${formatTopAction(queue)}`);
    } catch (e) { log('grade ordering skipped: ' + String(e).slice(0, 80)); }
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
      await runChild('scripts/improve-loop/apply-consensus.mjs', ['--base-url', BASE_URL]);
    }

    // SELF-IMPROVE DRAIN: the Council TRIGGERS its own improvement loops by enqueuing jobs
    // (missingCapability → self_improve_queue, written by the runtime during real turns). Here the
    // loop DRAINS a budgeted, serial batch of them through the gated feature-build → feature-review
    // pipeline (peer-reviewed, branch-guarded). Observe mode = preview (review only, no integrate);
    // apply mode arms integration (still branch-guarded to council/auto-improve inside the job).
    // One heavy task at a time; skipped entirely when the queue is empty (cheap check).
    if (!stop) {
      try {
        const { openJobs, drainSelfImproveQueue, enqueueFromMissingCapability } = await import('./self-improve-queue.mjs');
        const { ingestInbox } = await import('./self-improve-inbox.mjs');
        const { recordKnowledge, topKnowledge, knowledgeConfidence } = await import('./db.mjs');
        const { CLASS_LOCATION } = await import('./brain.mjs');
        const sdb = openDb(DB_PATH);
        // INGEST: pull jobs the RUNTIME produced during live turns (the Council triggering itself)
        // from the cross-process inbox into the queue table. Resolve a code location to ground on
        // from the job's class via CLASS_LOCATION (else null → the job aborts cleanly, not a crash).
        const ingest = ingestInbox(sdb, {
          enqueue: enqueueFromMissingCapability,
          resolveLocation: (job) => CLASS_LOCATION[job.klass] ?? CLASS_LOCATION[job.intent] ?? null,
          effects: { recordKnowledge, topKnowledge, knowledgeConfidence },
        });
        if (ingest.ingested > 0) log(`self-improve inbox: ingested ${ingest.ingested} (enqueued ${ingest.enqueued}, skipped ${ingest.skipped})`);
        // FLYWHEEL: the loop learns from its own terminal outcomes — recurring rejection
        // reasons become standing directives, and aged held-for-review jobs get one
        // bounded, lesson-annotated retry. Cheap (sqlite + changelog parse, no models).
        try {
          const { runOutcomeFlywheel } = await import('./outcome-flywheel.mjs');
          const { readChangelogEntries } = await import('./changelog.mjs');
          const fly = runOutcomeFlywheel(sdb, { entries: readChangelogEntries({ limit: 40 }) });
          if (fly.retried > 0 || (fly.lessons?.length ?? 0) > 0) {
            log(`outcome flywheel: ${fly.retried} held job(s) retried with lessons, ${fly.lessons.length} standing lesson(s)`);
          }
        } catch (err) {
          log(`outcome flywheel skipped: ${err?.message ?? err}`);
        }
        const pending = openJobs(sdb, 1).length;
        if (pending > 0) {
          log(`━━━ cycle ${cycle} : SELF-IMPROVE DRAIN (Council-triggered jobs) ━━━`);
          const { runSelfImproveJob } = await import('./feature-review-job.mjs');
          const summary = await drainSelfImproveQueue(sdb, {
            budget: 3,
            runJob: (job) => runSelfImproveJob(job, { db: sdb, integrate: AUTO_APPLY, log }),
            onEvent: (e) => { if (e.type === 'job:done') log(`  drained job #${e.job.id} → ${e.result?.outcome} (${e.result?.detail ?? ''})`); },
          });
          log(`self-improve drain: ran ${summary.ran} job(s)`);
        }
        sdb.close();
      } catch (e) { log('self-improve drain skipped: ' + String(e).slice(0, 80)); }
    }

    // VISUAL CADENCE: between text cycles, let Vai LOOK at itself. Serial (one heavy task
    // at a time), no-video, recorded to the corpus for the watch page + council packet.
    if (VISUAL_EVERY > 0 && !stop && cycle % VISUAL_EVERY === 0) {
      log(`━━━ cycle ${cycle} : VISUAL (no-video eyes/hands probe) ━━━`);
      await runVisualProbe();
    }

    // Campaign snapshot.
    const db2 = openDb(DB_PATH);
    const trend = db2.prepare(
      `SELECT r.id, COUNT(res.id) t, COALESCE(SUM(res.passed),0) p FROM runs r
       LEFT JOIN results res ON res.run_id=r.id GROUP BY r.id ORDER BY r.id DESC LIMIT 5`,
    ).all().reverse();
    // proposals table is created lazily by propose-fix.mjs; on a fresh corpus where no
    // class failed (so PROPOSE never ran) it may not exist yet — don't crash the loop.
    let proposals = 0;
    try { proposals = db2.prepare('SELECT COUNT(*) c FROM proposals').get().c; } catch { proposals = 0; }
    db2.close();
    log('campaign: ' + trend.map((x) => `#${x.id}:${x.t ? Math.round((x.p / x.t) * 100) : 0}%`).join(' ') + ` · ${proposals} proposals queued for review`);

    // CLOSE-OUT: outcome feedback. Before queuing anything new, measure the previously
    // queued experiment against the runs that have accumulated SINCE it was queued and
    // ADOPT or DISCARD it. This is what proves a change worked (or didn't) — and the
    // discard is what stops the loop re-proposing the same dead end. Reads the corpus
    // series only (no live service); never throws into the loop.
    try {
      const { runNextExperiment } = await import('./experiment-runner.mjs');
      const rdb = openDb(DB_PATH);
      const outcome = runNextExperiment(rdb);
      rdb.close();
      if (outcome.ran) log(`EXPERIMENT #${outcome.experimentId} closed → ${outcome.adopted ? 'ADOPTED' : 'discarded'} · ${outcome.evidence}`);
      else if (outcome.reason && outcome.reason !== 'no open experiment') log(`EXPERIMENT pending: ${outcome.reason}`);
    } catch (e) { log('experiment close-out skipped: ' + String(e).slice(0, 80)); }

    // INNOVATE: the living loop measuring ITSELF. When motion goes flat across the
    // window (spinning, not improving), planNextExperiment RECORDS the next experiment
    // to try (propose-only; deduped so it can't re-queue the same dead end). Never
    // executes it — the human/architect runs the queued experiment.
    try {
      const { planNextExperiment } = await import('./innovation-engine.mjs');
      const idb = openDb(DB_PATH);
      const plan = planNextExperiment(idb, { record: true });
      if (plan.recorded) {
        log(`INNOVATE (${plan.trigger}): queued experiment #${plan.experimentId} → [${plan.suggestion.type}] ${plan.suggestion.hypothesis}`);
        idb.close();
      } else if (plan.exhausted) {
        // INFINITE SOURCE: the fixed candidate pool is exhausted this cycle. Mine the loop's
        // own failure data and ask the resident LOCAL model for a NOVEL grounded experiment.
        // One serial generate (crash-safe), deduped, propose-only. This is what makes the
        // experiment arc genuinely perpetual instead of a finite list re-tried on a timer.
        try {
          const { generateNovelExperiment } = await import('./experiment-generator.mjs');
          const { hasOpenExperiment, recordCandidate } = await import('./innovation-engine.mjs');
          const cand = await generateNovelExperiment(idb);
          if (cand && !hasOpenExperiment(idb, cand)) {
            const id = recordCandidate(idb, cand, plan.scorecard);
            log(`INNOVATE (generated): queued experiment #${id} → [${cand.type}] ${cand.hypothesis}`);
          } else {
            log(`INNOVATE: pool exhausted; ${cand ? 'generated a duplicate' : 'generator returned no usable idea'} — waiting for cooldown rotation.`);
          }
        } catch (e) { log('generate-novel skipped: ' + String(e).slice(0, 80)); }
        idb.close();
      } else if (plan.skipReason) {
        log(`INNOVATE: ${plan.motion.state} — ${plan.skipReason} — not queuing.`);
        idb.close();
      } else { idb.close(); }
    } catch (e) { log('innovate skipped: ' + String(e).slice(0, 80)); }

    // INNOVATION-ARC: the SELF-INNOVATOR (above the self-tuner). Each cycle it mines the loop's
    // own unacted gaps (a stuck low-score lesson re-learned many times — the 52× grounding gap
    // shape), classifies each by IMPACT, and ROUTES it: a guardable discovery → autonomous (the
    // loop may build+prove a pure pre-ship guard, like grounding-gate); anything fundamental (a
    // feature, an answer-path change) → ESCALATED to V3gga (the "flag the fundamental" contract).
    // Pure DB read (cheap), propose/route-only — it never edits Vai source here. Records an escalation
    // to the findings file V3gga watches so a fundamental idea reaches a human, not /dev/null.
    try {
      const { planInnovation, formatInnovation } = await import('./innovation-arc.mjs');
      const adb = openDb(DB_PATH);
      const plan = await planInnovation(adb);
      adb.close();
      if (plan.found) {
        log(`━━━ cycle ${cycle} : INNOVATION-ARC ━━━`);
        for (const line of formatInnovation(plan).split('\n')) log(line);
        if (plan.mode === 'escalate') {
          const fs = await import('node:fs');
          recordCouncilFinding(fs, {
            at: new Date().toISOString(), cycle, taste: null, wow: null,
            flaw: `🚩 INNOVATION (escalate): ${String(plan.candidate.lesson).slice(0, 70)}`,
            council: `${plan.headline}\n\n${(plan.reasons || []).map((r) => `· ${r}`).join('\n')}\n\nFUNDAMENTAL — needs V3gga: the loop found this gap but won't build it unattended.`,
          });
        }
      }
    } catch (e) { log('innovation-arc skipped: ' + String(e).slice(0, 80)); }

    // CAPABILITY: the GENERATIVE arc. Every N cycles, convene the capability council —
    // it reads the north-star + backlog + V3gga's recurring asks + live introspect,
    // investigates the real code through each lens, and appends ranked FEATURE-level
    // upgrade proposals to the backlog. Heavy GPU → serial (after INNOVATE, before the
    // rest). Propose-only: writes the capabilities ledger + backlog, never Vai source.
    if (CAPABILITY_EVERY > 0 && !stop && cycle % CAPABILITY_EVERY === 0) {
      log(`━━━ cycle ${cycle} : CAPABILITY (generative council → backlog) ━━━`);
      const capArgs = ['--base-url', BASE_URL];
      if (CAPABILITY_FOCUS) capArgs.push('--focus', CAPABILITY_FOCUS);
      await runChild('scripts/improve-loop/capability-engine.mjs', capArgs);
    }

    if (stop) break;
    log(`cycle ${cycle} done · resting ${REST_S}s (GPU breather)…`);
    await restWithStop(REST_S);
  }
  log('living loop stopped. Corpus + proposals persisted; re-run to continue where it left off.');
}

// SINGLE-INSTANCE GUARD: refuse to start if a live supervisor already holds the lock. This is the
// fix for the 5-copies-at-once pile-up that stalled the corpus and lagged the machine. A stale lock
// from a crashed run is reclaimed automatically.
const lock = acquireLock(LOCK_PATH);
if (!lock.ok) {
  log(`✋ another supervisor is already running (PID ${lock.holderPid}${lock.startedAt ? `, since ${lock.startedAt}` : ''}).`);
  log(`   One living loop at a time (GPU + crash safety). Stop it first, or delete ${LOCK_PATH} if you're sure it's dead.`);
  process.exit(1);
}
if (lock.reclaimed) log('reclaimed a stale lock from a previous crashed run.');

// Signal handling: FIRST Ctrl-C / SIGTERM asks the loop to stop after the current cycle (resumable,
// no torn DB write). A SECOND signal means "I mean it" → clean the GPU + lock and exit now.
const onSignal = (sig) => {
  if (!stop) {
    stop = true;
    log(`${sig} — finishing current cycle then stopping (resumable). Press again to force-quit now.`);
  } else {
    log(`${sig} again — forcing shutdown.`);
    void cleanShutdown(lock.release).then(() => process.exit(0));
  }
};
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

const entry = USE_ENGINE ? engineMain : main;
entry()
  .then(() => cleanShutdown(lock.release))
  .catch(async (e) => { log('fatal: ' + String(e)); await cleanShutdown(lock.release); process.exit(1); });
