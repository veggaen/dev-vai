/**
 * prototype — the missing "how do we prototype, and how do we value a prototype" link.
 *
 * The loop already SELECTS (innovation-engine.rankExperiments + speculator EV), ACCEPTS
 * (experiment-runner adopt/discard on measured delta), and PRIORITIZES (process-engine density).
 * What it could NOT do is take a candidate, build the smallest REAL artifact, and VALUE it
 * cheaply before committing. This module is that step — converging V3gga's three sources
 * (Grok's Living-Prompt §4 "Verified Code Proposal Flow", Perplexity's "quality-delta × compute",
 * Google's "smallest verifiable artifact + cheap→expensive gates + revert on regression").
 *
 * A prototype = the smallest verifiable artifact for an experiment's hypothesis. Two shapes,
 * chosen by experiment type (the combination V3gga asked for):
 *   - CODE experiments  → a verified code proposal (proposal-verifier gate → tsc/test gate)
 *   - CONFIG experiments → a measured A/B (the experiment-runner's existing metric delta)
 * Both are VALUED on ONE shared scale so the loop can compare a code change and a config change
 * apples-to-apples, then accept/discard with full attribution.
 *
 * Pure where it counts: valuePrototype() and the gate ladder are I/O-free + unit-tested. The
 * actual build/verify side effects are injected, so orchestration tests without a GPU or a repo.
 */

/** Cheap→expensive verification GATES. A prototype must clear each in order; the first failure
 *  short-circuits (don't spend tsc time on a hallucinated find). Order = cost-ascending, the
 *  Google "cheap-to-expensive gates" rule. Each gate is { name, run(ctx)→{pass,detail} }. */
export const GATE_ORDER = ['shape', 'verify', 'review', 'typecheck', 'test'];

/**
 * Value a prototype on the ONE shared scale (Perplexity + Grok §4): quality-delta per unit of
 * compute, hard-gated by correctness. A prototype that didn't pass its gates is worth 0 — never
 * negative-credit a broken build. A prototype that passed but moved nothing is worth ~0. A
 * prototype that raised codebase quality cheaply scores high.
 *
 *   value = gatesPassed ? max(0, qualityDelta) / max(compute, 1) : 0
 *
 * qualityDelta is the perpetual-health composite delta (after − before); compute is compute-roi
 * units (≈ model calls) spent building+verifying it. Returns { value, qualityDelta, compute,
 * gatesPassed, verdict } — verdict drives accept/discard.
 * @param p {{ gatesPassed:boolean, qualityBefore:number, qualityAfter:number, compute:number,
 *            metricDelta?:number }}  metricDelta is the config-A/B fallback when there's no
 *            codebase-quality signal (e.g. a pure prompt experiment).
 */
export function valuePrototype(p = {}) {
  const compute = Math.max(Number(p.compute ?? 1), 1);
  if (!p.gatesPassed) {
    return { value: 0, qualityDelta: 0, compute, gatesPassed: false, verdict: 'rejected: failed a gate' };
  }
  // Prefer the codebase-quality delta; fall back to the experiment metric delta when quality
  // can't move (config-only experiments). Both are "higher is better".
  const haveQuality = p.qualityBefore != null && p.qualityAfter != null;
  const qualityDelta = haveQuality ? Number(p.qualityAfter) - Number(p.qualityBefore) : Number(p.metricDelta ?? 0);
  const value = Math.max(0, qualityDelta) / compute;
  let verdict;
  if (qualityDelta > 0) verdict = `adopt: +${qualityDelta.toFixed(4)} quality / ${compute} compute = ${value.toFixed(4)}`;
  else if (qualityDelta === 0) verdict = 'discard: passed gates but moved no metric (no value)';
  else verdict = `discard: regressed (${qualityDelta.toFixed(4)})`;
  return { value, qualityDelta, compute, gatesPassed: true, verdict };
}

/** Should this prototype be ADOPTED? Positive quality delta AND all gates green. The accept
 *  contract — deliberately strict: a prototype that didn't measurably improve the codebase is
 *  not adopted, no matter how clever (kills the "looks done" slop at the commit boundary). */
export function shouldAdopt(valued, { minValue = 0 } = {}) {
  return !!valued.gatesPassed && valued.qualityDelta > 0 && valued.value > minValue;
}

/**
 * Run a prototype end-to-end: build the smallest artifact, walk the cheap→expensive gate ladder,
 * sample quality before/after, value it, and return an accept/discard decision with attribution.
 * Every side effect is injected (build/gates/sampleQuality/computeOf) so this orchestration is
 * fully unit-testable. Crash-safe: a thrown gate/build is treated as a failed gate, never crashes.
 *
 * @param candidate {{ type, hypothesis, config }}  from innovation-engine
 * @param deps {{
 *   build(candidate)→Promise<artifact>,            // smallest real artifact (patch or config)
 *   gates: { [name]: (ctx)→Promise<{pass,detail}> },// the gate ladder (subset of GATE_ORDER)
 *   sampleQuality()→Promise<number>,                // perpetual-health composite (0..1)
 *   computeOf(ctx)→number,                          // compute-roi units spent
 *   onEvent?(e),                                    // trace hook
 *   cycle?, experimentId?,                          // attribution
 * }}
 * @returns {{ adopted, valued, artifact, gateResults, attribution }}
 */
export async function runPrototype(candidate, deps = {}) {
  const { build, gates = {}, sampleQuality, computeOf, onEvent, cycle = 0, experimentId = null } = deps;
  const emit = (e) => { try { onEvent?.(e); } catch {} };
  const attribution = { process: 'prototype', cycle, experimentId, hypothesis: candidate?.hypothesis ?? null };

  const qualityBefore = sampleQuality ? await safe(() => sampleQuality(), null) : null;
  emit({ type: 'prototype:start', candidate: candidate?.type, qualityBefore });

  let artifact = null;
  try { artifact = build ? await build(candidate) : null; }
  catch (e) { emit({ type: 'prototype:build-failed', error: String(e).slice(0, 120) }); }
  const ctx = { candidate, artifact, cycle, experimentId };

  // Cheap→expensive gate ladder. First failure short-circuits.
  const gateResults = [];
  let gatesPassed = artifact != null;
  if (artifact == null) gateResults.push({ name: 'build', pass: false, detail: 'no artifact produced' });
  else {
    for (const name of GATE_ORDER) {
      const g = gates[name];
      if (!g) continue; // a gate the caller didn't supply is skipped, not failed
      const r = await safe(() => g(ctx), { pass: false, detail: `${name} gate threw` });
      gateResults.push({ name, ...r });
      emit({ type: 'prototype:gate', name, pass: r.pass });
      if (!r.pass) { gatesPassed = false; break; } // short-circuit — don't pay the next gate
    }
  }

  const qualityAfter = gatesPassed && sampleQuality ? await safe(() => sampleQuality(), qualityBefore) : qualityBefore;
  const compute = computeOf ? await safe(() => computeOf(ctx), 1) : 1;
  const valued = valuePrototype({
    gatesPassed,
    qualityBefore, qualityAfter, compute,
    metricDelta: ctx.metricDelta,
  });
  const adopted = shouldAdopt(valued);
  emit({ type: 'prototype:done', adopted, value: valued.value, verdict: valued.verdict, attribution });
  return { adopted, valued, artifact, gateResults, attribution };
}

async function safe(fn, dflt) { try { return await fn(); } catch { return dflt; } }
