/**
 * perpetual-health — the answer to "is the system ACTUALLY doing its job?"
 *
 * The loop's job is to increase the quality of its own codebase, perpetually. "The loop ran"
 * is NOT evidence of that — a loop can spin forever and improve nothing (the meta-slop failure).
 * This module measures the real thing: it samples OBJECTIVE, mechanical quality signals from the
 * codebase over time and decides whether quality is genuinely RISING, FLAT, or FALLING — and
 * whether that motion is ATTRIBUTABLE to the loop (commits landed on its branch).
 *
 * Design for scale + the future:
 *   - Signals are deterministic + cheap to collect (counts/exit-codes), never model judgments.
 *   - Each signal declares a DIRECTION (higher-is-better or lower-is-better) so new signals plug
 *     in without changing the math. Add a signal = add one entry; the verdict logic is generic.
 *   - A quality SAMPLE is a timestamped vector of signals. The trend is read from the sample
 *     series (reusing the same least-squares slope the motion meter uses — one definition of
 *     "trend" across the whole system). Samples are a thin time series, not a growing corpus.
 *   - Verdict is honest: 'improving' | 'flat' | 'regressing' | 'cold-start', plus attribution.
 *
 * Pure where it matters (scoring/verdict are I/O-free + unit-tested); collection is injectable
 * so the orchestrator can gather signals however it likes (and tests run without a real repo).
 */
import { seriesSlope, classifyTrend } from './motion.mjs';

/**
 * The quality signals, each with a direction and a per-step "meaningful change" epsilon (so
 * noise doesn't read as motion). Extend this list to add a signal — nothing else changes.
 * normalize() maps every signal to a higher-is-better [0,1]-ish scale so they're comparable
 * and a single composite quality score is well-defined.
 */
export const SIGNALS = {
  testsPassing:   { dir: 'up',   eps: 0,    weight: 3, normalize: (v, s) => (s.testsTotal ? v / s.testsTotal : 0) },
  tscErrors:      { dir: 'down', eps: 0,    weight: 3, normalize: (v) => 1 / (1 + v) },
  lintWarnings:   { dir: 'down', eps: 1,    weight: 1, normalize: (v) => 1 / (1 + v / 10) },
  maxFileLines:   { dir: 'down', eps: 25,   weight: 1, normalize: (v) => 1 / (1 + v / 2000) }, // god-class pressure
  todoCount:      { dir: 'down', eps: 2,    weight: 1, normalize: (v) => 1 / (1 + v / 50) },
};

/** Build one quality SAMPLE from raw collected signal values. Adds a composite score (weighted
 *  mean of normalized signals) so a single number tracks overall quality. Pure. */
export function makeSample(raw = {}, at = new Date().toISOString()) {
  const signals = {};
  let wsum = 0; let acc = 0;
  for (const [key, def] of Object.entries(SIGNALS)) {
    // Only score a signal that was ACTUALLY measured this cycle. Defaulting a missing signal to 0
    // froze the composite: on cheap (no-tsc) cycles testsPassing/tscErrors/lintWarnings were absent
    // → counted as 0/perfect every time → composite stuck at a constant (0.5135…) forever, so the
    // health verdict was permanently "flat despite work" and could never detect improvement. Skipping
    // unmeasured signals lets the composite move with the signals that DID run (maxFileLines shrinks
    // as the god-class is decomposed; todoCount changes), and fold in tsc/tests on the cycles they run.
    if (raw[key] == null) continue;
    const v = Number(raw[key]);
    signals[key] = v;
    const n = clamp01(def.normalize(v, raw));
    acc += n * def.weight; wsum += def.weight;
  }
  const composite = wsum ? acc / wsum : 0;
  return { at, signals, composite, attribution: raw.attribution ?? null };
}
const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/**
 * Read the quality TREND from a chronological sample series (oldest first). Reuses the motion
 * meter's slope so "trend" means the same thing everywhere. Reports per-signal direction-aware
 * verdicts AND the composite verdict. window/eps mirror analyzeMotion's noise discipline.
 * @returns {{ state, composite:{current,first,slope,verdict}, perSignal, samples }}
 */
export function analyzeQuality(samples = [], { window = 3, compositeEps = 0.01 } = {}) {
  const xs = samples.filter((s) => s && typeof s.composite === 'number');
  if (xs.length < 2) {
    return { state: 'cold-start', composite: { current: xs.at(-1)?.composite ?? null, first: xs[0]?.composite ?? null, slope: 0, verdict: 'flat' }, perSignal: {}, samples: xs.length };
  }
  const series = xs.map((s) => s.composite);
  const slope = seriesSlope(series);
  const verdict = classifyTrend(slope, compositeEps);

  const perSignal = {};
  for (const [key, def] of Object.entries(SIGNALS)) {
    // Only build the series from samples that ACTUALLY measured this signal. The old `?? 0` made a
    // skipped probe look like a real zero — a cheap (no-tsc) cycle then read as tscErrors=0 "perfect"
    // and tanked/biased the trend (CodeRabbit #25, the companion to makeSample's unmeasured-skip).
    const sv = xs.map((s) => s.signals?.[key]).filter((v) => v != null).map(Number);
    if (sv.length < 2) { perSignal[key] = { current: sv.at(-1) ?? null, slope: 0, verdict: 'flat' }; continue; }
    const raw = seriesSlope(sv);
    // direction-aware: for a lower-is-better signal, a falling raw slope is IMPROVING.
    const orientedSlope = def.dir === 'down' ? -raw : raw;
    perSignal[key] = { current: sv.at(-1), slope: raw, verdict: classifyTrend(orientedSlope, def.eps / Math.max(1, Math.abs(sv[0] || 1))) };
  }

  // Composite state, with the same flat-window discipline the motion meter uses.
  const tail = series.slice(-window);
  const flatWindow = tail.length >= window && (Math.max(...tail) - Math.min(...tail)) <= compositeEps;
  let state;
  if (verdict === 'regressing') state = 'regressing';
  else if (verdict === 'improving') state = 'improving';
  else state = flatWindow ? 'flat' : 'warming';

  return {
    state,
    composite: { current: series.at(-1), first: series[0], slope, verdict },
    perSignal,
    samples: xs.length,
  };
}

/**
 * The headline verification: is the loop perpetually doing its job? Combines the quality trend
 * with ATTRIBUTION (did the loop actually land changes in the window?). This is the honest
 * answer V3gga asked for — it can say "quality flat AND loop landed nothing → it is NOT working"
 * vs "quality rising and the loop landed the commits → it IS working".
 * @param attribution {{ commitsByLoop:number, proposalsAdopted:number,
 *   actions?: {process:string, cycle:number, experimentId?:number}[] }}
 *   `actions` is the explicit list of loop actions credited with the landed change(s), so the
 *   verdict can NAME what caused the delta (process+cycle+experiment), not just count it. The
 *   honest-attribution requirement: "this specific loop action caused this quality delta."
 */
export function verifyPerpetualWork(quality, attribution = {}) {
  const actions = Array.isArray(attribution.actions) ? attribution.actions : [];
  const landed = Number(attribution.commitsByLoop ?? 0) + Number(attribution.proposalsAdopted ?? 0) || actions.length;
  const credit = actions.length
    ? ` [${actions.map((a) => `${a.process}@c${a.cycle}${a.experimentId != null ? `#${a.experimentId}` : ''}`).join(', ')}]`
    : '';
  const { state } = quality;
  let working; let reason;
  if (state === 'cold-start') { working = null; reason = 'not enough quality samples yet — keep sampling'; }
  else if (state === 'regressing') { working = false; reason = `codebase quality is REGRESSING (composite slope ${quality.composite.slope.toFixed(4)}) — the loop is net-harmful or something else is; bisect before generating more work${credit}`; }
  else if (state === 'improving' && landed > 0) { working = true; reason = `quality RISING and the loop landed ${landed} change(s) in-window — attributable improvement${credit}`; }
  else if (state === 'improving' && landed === 0) { working = null; reason = 'quality rising but the loop landed nothing — improvement not attributable to the loop (someone/something else)'; }
  else if (landed === 0) { working = false; reason = `quality ${state} and the loop landed NOTHING — it is running but not doing its job (meta-slop)`; }
  else { working = null; reason = `quality ${state} despite ${landed} landed change(s) — work is happening but not yet moving the needle; watch the next samples${credit}`; }
  return { working, reason, state, landed, actions, composite: quality.composite.current };
}

/**
 * Collect a REAL quality sample from the codebase — deterministic, cheap, no model. Each probe
 * is wrapped so one failure (a tool missing) degrades to a neutral value instead of crashing
 * the loop. Heavy probes (tsc) are opt-in via flags so the perpetual loop can sample cheaply
 * every cycle and run the expensive ones occasionally. Returns a value object for makeSample().
 * `exec` is injectable for tests; defaults to a real child_process runner.
 */
export async function collectSignals({ exec, cwd = process.cwd(), withTsc = false } = {}) {
  // Default runner: capture raw stdout (the caller's probe owns the counting in JS, so we don't
  // depend on shell pipelines like wc/sed that differ across cmd/bash). execFileSync with git
  // avoids shell-quoting issues entirely.
  const run = exec ?? (async (file, args) => {
    const { execFileSync } = await import('node:child_process');
    try { return { ok: true, out: execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000, maxBuffer: 64 * 1024 * 1024 }) }; }
    catch (e) { return { ok: false, out: String(e.stdout ?? ''), err: String(e.stderr ?? e) }; }
  });
  const out = { attribution: null };

  // TODO/FIXME/XXX count — cheap latent-debt proxy (lower is better). git grep -I, count lines in JS.
  const todo = await run('git', ['grep', '-I', '-E', 'TODO|FIXME|XXX', '--', '*.ts', '*.tsx', '*.mjs']).catch(() => ({ out: '' }));
  out.todoCount = todo.out ? todo.out.split('\n').filter(Boolean).length : 0;

  // Largest tracked source file (god-class pressure — lower is better). List files via git, read
  // line counts in JS (no xargs/wc/sort pipeline → robust on every shell). Bounded sample for scale.
  const list = await run('git', ['ls-files', '*.ts', '*.tsx', '*.mjs']).catch(() => ({ out: '' }));
  const files = (list.out || '').split('\n').filter(Boolean);
  let maxLines = 0;
  try {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const rel of files) {
      try {
        const n = readFileSync(join(cwd, rel), 'utf8').split('\n').length;
        if (n > maxLines) maxLines = n;
      } catch {}
    }
  } catch {}
  out.maxFileLines = maxLines;

  // tsc errors (opt-in — heavy). When not run, omit the signal entirely. A skipped
  // typecheck is not evidence of "0 errors"; makeSample() will score only measured signals.
  if (withTsc) {
    const tsc = await run('npx', ['tsc', '--noEmit']).catch(() => ({ out: '' }));
    out.tscErrors = ((tsc.out || '').match(/error TS\d+/g) || []).length;
  }
  return out;
}
const num = (s) => { const m = String(s).match(/-?\d+/); return m ? Number(m[0]) : 0; };

/** One-line operator render. */
export function formatHealth(quality, verify) {
  const c = quality.composite;
  const mark = verify.working === true ? '✓ WORKING' : verify.working === false ? '✗ NOT WORKING' : '… inconclusive';
  return `Perpetual health: ${mark} · quality ${c.current == null ? 'n/a' : c.current.toFixed(3)} ${arrow(c.slope)} (${quality.state}) · ${verify.reason}`;
}
const arrow = (s) => (s > 0.01 ? '↑' : s < -0.01 ? '↓' : '→');
