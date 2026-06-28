/**
 * Speculator — the evidence-bound forecaster for the perpetual loop.
 *
 * The innovation engine RANKS candidate experiments by a fixed heuristic, then
 * fall-through queues the first un-tried one. That heuristic is blind to HISTORY:
 * if `model` experiments have adopted 3/4 times with a fat delta while `prompt`
 * ones never beat the bar, the loop should SPEND its one-heavy-task budget on the
 * model lever first. This module computes that prior — deterministically, from the
 * experiments the loop has already closed — and re-orders the candidates by it.
 *
 * It is NOT prompt-magic: every number comes from the experiments table (closed
 * rows with a measured delta). No model call, no GPU. Pure compute, unit-testable.
 *
 * EV(candidate) = exploit + explore
 *   exploit  = adoptRate * clamp(normMeanDelta, 0, DELTA_CAP)
 *   explore  = EXPLORE_BONUS / (1 + triedVariant)
 * where adoptRate is Laplace-smoothed (prior 0.5) and delta is normalized by the
 * candidate type's adoption threshold so cross-type EV is comparable (a +4pp model
 * move and a +0.4/10 grading move both normalize to ~2.0). With NO history every
 * candidate scores the same explore-only EV, so a stable sort preserves the
 * engine's base order — the speculator only ever REFINES, never destabilizes.
 */
import { experimentHistory, targetMetric, ADOPT_THRESHOLD, ADOPT_THRESHOLD_EXCELLENCE } from './innovation-engine.mjs';

/** Laplace prior (a successes, b failures) ⇒ unknown adopt-rate defaults to 0.5. */
export const PRIOR_A = 1;
export const PRIOR_B = 1;
/** Weight of the "try something we haven't" term; decays as a variant is tried. */
export const EXPLORE_BONUS = 0.5;
/** Cap on normalized delta so one freak win can't dominate the prior forever. */
export const DELTA_CAP = 3;

const variantOf = (config) => {
  if (!config) return null;
  if (typeof config === 'object') return config.variant ?? null;
  try { return JSON.parse(config)?.variant ?? null; } catch { return null; }
};
const thresholdFor = (type) => (targetMetric(type) === 'excellence' ? ADOPT_THRESHOLD_EXCELLENCE : ADOPT_THRESHOLD);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Aggregate CLOSED experiments (delta measured) into per type+variant stats.
 * Returns { byKey: Map<'type\u0000variant', stat>, byType: Map<type, stat> } where a
 * stat is { tried, adopted, deltas:number[] }. Open experiments are ignored — an
 * unfinished arm has no outcome to learn from.
 */
export function experimentStats(db) {
  const rows = experimentHistory(db, 1000).filter((r) => r.delta != null);
  const byKey = new Map();
  const byType = new Map();
  const bump = (map, k, row) => {
    const s = map.get(k) ?? { tried: 0, adopted: 0, deltas: [] };
    s.tried += 1;
    if (row.adopted) s.adopted += 1;
    s.deltas.push(Number(row.delta));
    map.set(k, s);
  };
  for (const r of rows) {
    bump(byType, r.type, r);
    bump(byKey, `${r.type}\u0000${variantOf(r.config) ?? ''}`, r);
  }
  return { byKey, byType };
}

/** Laplace-smoothed adoption rate for a stat (or the 0.5 prior when absent). */
function adoptRate(stat) {
  if (!stat || stat.tried === 0) return PRIOR_A / (PRIOR_A + PRIOR_B);
  return (stat.adopted + PRIOR_A) / (stat.tried + PRIOR_A + PRIOR_B);
}

/**
 * Expected value of a single candidate against the aggregated stats. Prefers the
 * variant-specific history when present, else falls back to the type-level signal.
 * Returns { ev, exploit, explore, adoptRate, meanDelta, tried, basis }.
 */
export function expectedValue(candidate, stats) {
  const type = candidate.type;
  const variant = candidate.config?.variant ?? null;
  const vStat = stats.byKey.get(`${type}\u0000${variant ?? ''}`);
  const tStat = stats.byType.get(type);
  const stat = vStat && vStat.tried > 0 ? vStat : tStat;
  const basis = vStat && vStat.tried > 0 ? 'variant' : tStat ? 'type' : 'prior';

  const rate = adoptRate(stat);
  const md = stat ? mean(stat.deltas) : 0;
  const normMeanDelta = md / thresholdFor(type);
  const exploit = rate * Math.max(0, Math.min(normMeanDelta, DELTA_CAP));
  // Exploration decays with how often THIS exact variant has been tried, so the
  // loop keeps probing untried levers but stops re-weighting exhausted ones.
  const tried = vStat ? vStat.tried : 0;
  const explore = EXPLORE_BONUS / (1 + tried);
  return { ev: exploit + explore, exploit, explore, adoptRate: rate, meanDelta: md, tried, basis };
}

/**
 * Re-order candidates best-EV-first. STABLE: equal EV keeps the engine's incoming
 * order (so a no-history loop behaves exactly as before). Returns NEW objects with
 * { ev, evRationale } attached — never mutates the inputs.
 */
export function speculate(db, candidates) {
  const stats = experimentStats(db);
  const scored = candidates.map((c, i) => {
    const v = expectedValue(c, stats);
    return { ...c, ev: v.ev, evRationale: rationale(v), _i: i };
  });
  scored.sort((a, b) => (b.ev - a.ev) || (a._i - b._i));
  return scored.map(({ _i, ...c }) => c);
}

/** One-line, honest provenance of an EV (so the operator shows WHY, not a magic number). */
function rationale(v) {
  if (v.basis === 'prior') return `no history — exploring (ev ${v.ev.toFixed(2)})`;
  const pct = Math.round(v.adoptRate * 100);
  const unit = v.meanDelta >= 0 ? '+' : '';
  return `${v.basis} adopt ${pct}% · mean ${unit}${v.meanDelta.toFixed(3)} · ev ${v.ev.toFixed(2)}`;
}
