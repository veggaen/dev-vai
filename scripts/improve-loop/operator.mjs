#!/usr/bin/env node
/**
 * operator - Windows-first switchboard for the perpetual improvement loop.
 *
 * It does not replace supervisor.mjs. It wraps the existing safe machinery with:
 * - a readable observe/apply switch
 * - status/doctor commands before unattended runs
 * - handoff text for other agents or compute
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  buildHandoffMarkdown,
  buildReportNodeArgs,
  buildSupervisorNodeArgs,
  buildVisualNodeArgs,
  buildWatchNodeArgs,
  classifyLoopLiveness,
  formatNodeCommand,
  parseOperatorArgs,
} from './operator-utils.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const SUPERVISOR_LOCK_PATH = 'scripts/improve-loop/.supervisor.lock';
const SUPERVISOR_STOP_PATH = 'scripts/improve-loop/.supervisor.stop';

function abs(path) {
  return isAbsolute(path) ? path : resolve(ROOT, path);
}

function usage() {
  console.log(`Vai improvement loop operator

Usage:
  node --experimental-sqlite scripts/improve-loop/operator.mjs doctor [options]
  node --experimental-sqlite scripts/improve-loop/operator.mjs start [--mode observe|apply] [options]
  node --experimental-sqlite scripts/improve-loop/operator.mjs stop [--force]
  node --experimental-sqlite scripts/improve-loop/operator.mjs status [options]
  node --experimental-sqlite scripts/improve-loop/operator.mjs watch [options]
  node --experimental-sqlite scripts/improve-loop/operator.mjs report [options]
  node --experimental-sqlite scripts/improve-loop/operator.mjs handoff [--out docs/handoff/loop.md]
  node --experimental-sqlite scripts/improve-loop/operator.mjs visual [--headed] [--packet]

Common options:
  --mode observe|apply       observe queues fixes only; apply verifies+commits on council/auto-improve
  --db <path>                corpus DB path (default scripts/improve-loop/.corpus.sqlite)
  --base-url <url>           Vai runtime URL (default http://localhost:3006)
  --max-cycles <n>           0/omitted means forever
  --per-class <n>            prompts per failure class
  --seeds-only               fast regression pass, no generated prompt top-up
  --vram-gb <n>              VRAM guard budget passed to run.mjs
  --cooldown <ms>            cooldown between turns passed to run.mjs
  --qwen-frac <0..1>         generated prompt top-up fraction
  --limit <n>                cap prepared prompts for a tiny controlled probe
  --port <n>                 watch page port
  --app <url>                visual probe target app URL
  --chrome <path>            visual probe Chrome executable fallback
  --stream <path|off>        visual probe NDJSON event stream path
  --stream-stdout            also print visual events as NDJSON
  --no-video                 skip Playwright video recording
  --headed                   show the visual probe browser
  --packet                   print the latest visual run as a compact council packet (no probe)
  --visual-every <n>         (start) run a no-video visual probe every n text cycles
  --force                    (stop) send SIGKILL instead of a graceful stop request
  --dry-run                  print the start command without running it
`);
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: opts.timeoutMs ?? 10_000 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), error: r.error };
}

function runNode(nodeArgs, env = {}) {
  const child = spawn(process.execPath, nodeArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error(String(err));
    process.exit(1);
  });
}

function readSupervisorLock() {
  const path = abs(SUPERVISOR_LOCK_PATH);
  if (!existsSync(path)) return null;
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8'));
    const pid = Number(payload.pid);
    if (!Number.isInteger(pid) || pid <= 0) return { pid: null, startedAt: payload.startedAt ?? null, malformed: true };
    return { pid, startedAt: payload.startedAt ?? null, malformed: false };
  } catch {
    return { pid: null, startedAt: null, malformed: true };
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function stopSupervisor(opts) {
  const lock = readSupervisorLock();
  if (!lock || !lock.pid) {
    console.log(`No live supervisor lock found at ${SUPERVISOR_LOCK_PATH}.`);
    console.log('If status still shows a stale running corpus row, it is safe to start a new observe run after confirming no old process is active.');
    return { ok: true };
  }

  if (!isPidAlive(lock.pid)) {
    console.log(`Supervisor lock is stale (PID ${lock.pid} is not running).`);
    console.log(`Start will reclaim ${SUPERVISOR_LOCK_PATH}; no process was signaled.`);
    return { ok: true };
  }

  const requestedAt = new Date().toISOString();
  writeFileSync(abs(SUPERVISOR_STOP_PATH), JSON.stringify({
    requestedAt,
    pid: lock.pid,
    force: Boolean(opts.forceStop),
  }, null, 2));

  const signal = opts.forceStop ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(lock.pid, signal);
    console.log(`${opts.forceStop ? 'Force stop' : 'Graceful stop'} requested for supervisor PID ${lock.pid}${lock.startedAt ? ` (since ${lock.startedAt})` : ''}.`);
    console.log(`Stop request recorded at ${SUPERVISOR_STOP_PATH}.`);
    return { ok: true };
  } catch (err) {
    console.log(`Stop request was written, but signaling PID ${lock.pid} failed: ${String(err?.message ?? err)}`);
    return { ok: false };
  }
}

async function runVisual(opts) {
  const {
    openDb,
    startVisualRun,
    endVisualRun,
    recordVisualEvent,
    recordTasteLesson,
  } = await import('./db.mjs');

  const db = openDb(abs(opts.db));
  const visualRunId = startVisualRun(db, {
    appUrl: opts.appUrl,
    outDir: opts.out ?? 'Temporary_files/improve-loop-visual',
  });
  const args = buildVisualNodeArgs({ ...opts, streamStdout: true });
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  });

  let buffer = '';
  let stored = 0;
  let done = null;
  const handleLine = (line) => {
    process.stdout.write(`${line}\n`);
    const text = line.trim();
    if (!text.startsWith('{')) return;
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      return;
    }
    if (!event || !event.type || event.seq == null) return;
    if (recordVisualEvent(db, visualRunId, event)) stored += 1;
    if (event.type === 'vision.rubric' && event.data?.tasteLesson) {
      recordTasteLesson(db, { lesson: event.data.tasteLesson, visualRunId, overall: event.data.overall });
    }
    if (event.type === 'probe.start') {
      db.prepare('UPDATE visual_runs SET out_dir = COALESCE(?, out_dir), event_stream = COALESCE(?, event_stream) WHERE id = ?')
        .run(event.data?.outDir ?? null, event.data?.eventStream ?? null, visualRunId);
    }
    if (event.type === 'probe.done') done = event;
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let next;
    while ((next = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, next));
      buffer = buffer.slice(next + 1);
    }
  });

  const code = await new Promise((resolve) => {
    child.on('exit', (exitCode) => resolve(exitCode ?? 0));
    child.on('error', (err) => {
      console.error(String(err));
      resolve(1);
    });
  });
  if (buffer.trim()) handleLine(buffer);

  const passed = typeof done?.data?.passed === 'boolean' ? done.data.passed : code === 0;
  endVisualRun(db, visualRunId, {
    status: code === 0 ? 'done' : 'failed',
    passed,
    reportPath: done?.data?.reportPath ?? null,
    eventStream: done?.data?.eventStream ?? null,
    summary: `${stored} sampled visual events stored`,
  });
  db.close();
  process.exit(code);
}

async function printVisualPacket(opts) {
  const dbPath = abs(opts.db);
  if (!existsSync(dbPath)) {
    console.log(`No corpus yet at ${opts.db}. Run a visual probe first: corepack pnpm self-improve:visual -- --no-video`);
    return;
  }
  const { openDb, buildVisualCouncilPacket } = await import('./db.mjs');
  const db = openDb(dbPath);
  const packet = buildVisualCouncilPacket(db);
  db.close();
  if (!packet) {
    console.log('No visual run recorded yet. Run: corepack pnpm self-improve:visual -- --no-video');
    return;
  }
  // Compact, council-friendly JSON: no screenshots, no pointer trace — just the verdict.
  console.log(JSON.stringify(packet, null, 2));
}

function tableCount(db, table, where = '') {
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get().c ?? 0);
  } catch {
    return 0;
  }
}

async function printStatus(opts) {
  const dbPath = abs(opts.db);
  if (!existsSync(dbPath)) {
    console.log(`No improvement corpus yet at ${opts.db}`);
    console.log('Start observe mode first:');
    console.log(`  ${formatNodeCommand(buildSupervisorNodeArgs({ ...opts, apply: false }))}`);
    return { ok: true };
  }

  const { openDb, classStats, readHeartbeat, latestVisualRun, readVisualLive, buildVisualCouncilPacket, topTasteLessons, answerExcellenceStats, topAnswerLessons } = await import('./db.mjs');
  const db = openDb(dbPath);
  const lastRun = db.prepare('SELECT id,status,started_at,ended_at,note FROM runs ORDER BY id DESC LIMIT 1').get();
  const fixes = tableCount(db, 'fixes');
  const proposals = tableCount(db, 'proposals');
  const consensus = tableCount(db, 'consensus');
  const visualRuns = tableCount(db, 'visual_runs');
  const visualEvents = tableCount(db, 'visual_events');
  const unappliedConsensus = tableCount(db, 'consensus', "WHERE verified=1 AND (applied IS NULL OR applied='')");
  const live = readHeartbeat(db);
  const visualRun = latestVisualRun(db);
  const visualLive = readVisualLive(db);
  const liveness = classifyLoopLiveness({ run: lastRun, heartbeat: live });

  console.log(`Corpus: ${opts.db}`);
  if (!lastRun) {
    console.log('Runs: none yet');
  } else {
    console.log(`Latest run: #${lastRun.id} ${lastRun.status} (${lastRun.started_at}${lastRun.ended_at ? ` -> ${lastRun.ended_at}` : ''})`);
    const stats = classStats(db, lastRun.id);
    for (const row of stats) {
      const pct = row.total ? Math.round((row.passed / row.total) * 100) : 0;
      console.log(`  ${row.class.padEnd(34)} ${String(pct).padStart(3)}% (${row.passed}/${row.total})`);
    }
  }
  console.log(`Queued fixes: ${fixes}`);
  console.log(`Model proposals: ${proposals}`);
  console.log(`Consensus rows: ${consensus} (${unappliedConsensus} verified unapplied)`);
  console.log(`Visual telemetry: ${visualRuns} runs, ${visualEvents} sampled events`);
  if (visualRun) {
    const state = visualRun.passed == null ? visualRun.status : `${visualRun.status}/${visualRun.passed ? 'pass' : 'fail'}`;
    console.log(`Latest visual: #${visualRun.id} ${state}${visualRun.report_path ? ` report=${visualRun.report_path}` : ''}`);
  }
  if (visualLive) {
    console.log(`Visual live: #${visualLive.visual_run_id} seq=${visualLive.seq} ${visualLive.type}`);
  }
  const tastePacket = buildVisualCouncilPacket(db);
  if (tastePacket?.taste) {
    const t = tastePacket.taste;
    console.log(`Visual taste: ${t.overall}/10 (comp ${t.scores.composition} motion ${t.scores.motion} feel ${t.scores.interactionFeel} identity ${t.scores.visualIdentity}) · wow ${t.humanAppeal.wow}/10 · flaws ${t.flawCounts.P0}×P0 ${t.flawCounts.P1}×P1`);
    if (t.topFlaws?.length) console.log(`  top flaw: [${t.topFlaws[0].severity}] ${t.topFlaws[0].symptom}${t.topFlaws[0].selector ? ` (${t.topFlaws[0].selector})` : ''}`);
    console.log(`  taste lesson: ${t.tasteLesson}`);
  }
  const lessons = topTasteLessons(db, 3);
  if (lessons.length) {
    console.log(`Taste lessons learned (${lessons.length} shown):`);
    for (const l of lessons) console.log(`  ×${l.times_seen} ${l.lesson}`);
  }
  const answerStats = answerExcellenceStats(db, lastRun?.id ?? null);
  if (answerStats.n) {
    console.log(`Answer excellence: avg ${answerStats.avg.toFixed(1)}/10 · worst ${answerStats.worst.toFixed(1)}/10 (n=${answerStats.n}, last run)`);
  }
  const answerLessons = topAnswerLessons(db, 3);
  if (answerLessons.length) {
    console.log(`Answer lessons learned (${answerLessons.length} shown):`);
    for (const l of answerLessons) console.log(`  ×${l.times_seen} ${l.lesson}`);
  }
  // Perpetual motion: does the loop ITSELF move across runs, or just spin? When it
  // stalls, planNextExperiment (read-only here) previews the experiment the living
  // loop would queue — bringing the innovation engine's decision into view.
  const { planNextExperiment, experimentHistory, formatExperiment } = await import('./innovation-engine.mjs');
  const plan = planNextExperiment(db, { record: false });
  const motion = plan.motion;
  if (motion.state !== 'cold-start') {
    console.log(motion.headline);
    if (motion.recommendation) console.log(`  → ${motion.recommendation}`);
    const sc = plan.scorecard;
    const ipct = (n) => (n == null ? 'n/a' : `${Math.round(n * 100)}%`);
    console.log(`  scorecard: hit-rate ${ipct(sc.proposalQuality.hitRate)} (${sc.proposalQuality.total} classes) · council ${ipct(sc.councilHealth.responseRate)} · low-craft ${sc.slopScore.score}/${sc.slopScore.graded}`);
    if (motion.state === 'stalling') {
      const ev = plan.suggestion.evRationale ? ` (${plan.suggestion.evRationale})` : '';
      console.log(`  next experiment: [${plan.suggestion.type}] ${plan.suggestion.hypothesis}${ev}`);
      if (plan.skipReason) console.log(`    (would not queue: ${plan.skipReason})`);
    }
  }
  // Experiment ledger: the closed-loop outcome feedback (open = awaiting post-queue
  // runs; closed = adopted/discarded with measured delta).
  const experiments = experimentHistory(db, 3);
  if (experiments.length) {
    console.log(`Experiments (${experiments.length} shown):`);
    for (const exp of experiments) console.log(`  ${formatExperiment(exp)}`);
  }
  // GRADE: the deterministic self-grader — which weakest classes to target next, any
  // stuck lessons (re-learned but never acted on), and a per-agent adopt/reject/keep
  // verdict bound to a measured signal. Read-only; reuses the scorecard already built.
  const { campaignClassStats } = await import('./db.mjs');
  const { gradeLedger } = await import('./grader.mjs');
  const { buildActionQueue, formatTopAction } = await import('./action-queue.mjs');
  const grade = gradeLedger({
    classStats: campaignClassStats(db),
    tasteLessons: topTasteLessons(db, 8),
    answerLessons: topAnswerLessons(db, 8),
    proposalQuality: plan.scorecard.proposalQuality,
    councilHealth: plan.scorecard.councilHealth,
  });
  console.log(grade.headline);
  if (grade.targets.length) {
    console.log(`  targets (weakest first): ${grade.targets.slice(0, 3).map((c) => `${c.class} ${Math.round(c.passRate * 100)}%`).join(' · ')}`);
  }
  const queue = buildActionQueue(grade);
  console.log(`  ${formatTopAction(queue)}`);
  for (const v of grade.verdicts) console.log(`  [${v.verdict.toUpperCase()}] ${v.agent}: ${v.why}`);
  // CAPABILITY preview: the most recent FEATURE-level proposals from the generative
  // council (read-only). Shows what the capability arc is steering toward next.
  try {
    const { capabilityHistory, computeRoiSeries } = await import('./capability-engine.mjs');
    const caps = capabilityHistory(db, 3);
    if (caps.length) {
      console.log(`Capability council: ${caps.length} recent proposal(s) (propose-only → backlog)`);
      for (const c of caps) console.log(`  [${c.area}] ${c.title} (impact ${c.impact ?? '?'}/10) — ${String(c.capability).slice(0, 80)}`);
    }
    // COMPUTE-ROI verdict: is the loop converting GPU compute into shipped value, or
    // spinning (the Zig "wasteful review burden" failure)? Deterministic, read-only.
    const series = computeRoiSeries(db, 30);
    if (series.length) {
      const { analyzeRoiTrend, formatRoi } = await import('./compute-roi.mjs');
      console.log(formatRoi(analyzeRoiTrend(series)));
    }
  } catch (e) { /* ledger not created yet — capability arc hasn't run; silent */ }
  if (live) {
    const label = lastRun?.status === 'running' ? 'Live heartbeat' : 'Last heartbeat';
    const suffix = lastRun?.status === 'running' ? (live.phase ?? '') : '(run complete)';
    console.log(`${label}: ${liveness.heartbeatFresh ? 'fresh' : 'stale'} (${Math.round((liveness.heartbeatAgeMs ?? 0) / 1000)}s) ${suffix}`);
    if (lastRun?.status === 'running' && liveness.heartbeatFresh && live.prompt) console.log(`  now: ${String(live.prompt).slice(0, 90)}`);
  }
  if (liveness.staleRunning) {
    console.log('Warning: latest run is marked running but the heartbeat is stale. The previous loop likely stopped; the corpus is resumable, and starting a new run is safe after checking no old operator process is active.');
  }
  db.close();
  return { ok: true, warnings: liveness.staleRunning ? ['stale-running-run'] : [] };
}

async function probeJson(url, timeoutMs = 5000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: res.ok, status: res.status, text: res.ok ? '' : await res.text().catch(() => '') };
  } catch (err) {
    return { ok: false, status: 0, text: String(err) };
  }
}

async function doctor(opts) {
  let ok = true;
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  console.log(`Node: ${process.versions.node} ${nodeMajor >= 22 ? 'OK' : 'FAIL (need >=22)'}`);
  if (nodeMajor < 22) ok = false;

  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out;
  const dirty = sh('git', ['status', '--short']).out.split('\n').filter(Boolean).length;
  console.log(`Git branch: ${branch || '(unknown)'}${dirty ? ` (${dirty} changed paths)` : ' (clean)'}`);
  if (opts.apply && branch !== 'council/auto-improve') {
    console.log("Apply guard: FAIL (switch to council/auto-improve before --mode apply)");
    ok = false;
  } else {
    console.log(`Apply guard: ${opts.apply ? 'OK' : 'not requested'}`);
  }

  const base = opts.baseUrl.replace(/\/$/, '');
  const runtime = await probeJson(`${base}/api/agent/introspect`, 7000);
  console.log(`Vai runtime: ${runtime.ok ? 'OK' : `FAIL (${runtime.status || runtime.text.slice(0, 80)})`} at ${base}`);
  if (!runtime.ok) ok = false;

  const ollamaBase = (process.env.LOCAL_MODEL_URL ?? 'http://localhost:11434').replace(/\/$/, '');
  const ollama = await probeJson(`${ollamaBase}/api/ps`, 5000);
  console.log(`Ollama/model host: ${ollama.ok ? 'OK' : `WARN (${ollama.status || ollama.text.slice(0, 80)})`} at ${ollamaBase}`);

  const status = await printStatus(opts);
  const warnings = [...(status.warnings ?? [])];
  // A FAIL must never be masked as WARN (CodeRabbit #25): if an earlier check set ok=false, report
  // FAIL even when warnings also exist. WARN is only for "passed, with advisories".
  if (!ok) {
    console.log(`Doctor: FAIL${warnings.length ? ` (+ warnings: ${warnings.join(', ')})` : ''}`);
  } else if (warnings.length) {
    console.log(`Doctor: WARN (${warnings.join(', ')})`);
  } else {
    console.log('Doctor: PASS');
  }
  return { ok, warnings };
}

async function main() {
  let opts;
  try {
    opts = parseOperatorArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message ?? err));
    usage();
    process.exit(1);
  }

  if (opts.command === 'help') {
    usage();
    return;
  }

  if (opts.command === 'start') {
    const args = buildSupervisorNodeArgs(opts);
    if (opts.dryRun) {
      console.log(formatNodeCommand(args));
      return;
    }
    runNode(args, { VAI_API: opts.baseUrl });
    return;
  }

  if (opts.command === 'stop') {
    const result = stopSupervisor(opts);
    process.exit(result.ok ? 0 : 1);
  }

  if (opts.command === 'watch') {
    runNode(buildWatchNodeArgs(opts));
    return;
  }

  if (opts.command === 'report') {
    runNode(buildReportNodeArgs(opts));
    return;
  }

  if (opts.command === 'visual') {
    if (opts.packet) {
      await printVisualPacket(opts);
      return;
    }
    const args = buildVisualNodeArgs(opts);
    if (opts.dryRun) {
      console.log(formatNodeCommand(buildVisualNodeArgs({ ...opts, streamStdout: true })));
      return;
    }
    await runVisual(opts);
    return;
  }

  if (opts.command === 'status') {
    await printStatus(opts);
    return;
  }

  if (opts.command === 'doctor') {
    const result = await doctor(opts);
    process.exit(result.ok ? 0 : 1);
  }

  if (opts.command === 'handoff') {
    const markdown = buildHandoffMarkdown(opts);
    if (opts.out) {
      writeFileSync(abs(opts.out), markdown);
      console.log(`Wrote ${opts.out}`);
    } else {
      console.log(markdown);
    }
  }
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
