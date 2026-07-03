/**
 * compute-roi — deterministic accounting of COMPUTE SPENT vs BENEFIT GAINED, plus a
 * diminishing-returns detector ON THE MEASURE ITSELF.
 *
 * The perpetual loop's sharpest failure mode (the one V3gga named): it runs for hours,
 * burns the single GPU, and ships nothing — proposals pile up unreviewed. That is the
 * Zig critique of AI made concrete ("invariably wasteful review burden"). This module
 * makes the waste VISIBLE and bounded so the loop can stop spending compute that returns
 * nothing, and prove the critique wrong on the only axis that matters: benefit-per-compute.
 *
 * Definitions (honest on purpose):
 *   computeUnits  = model calls this round (serial-GPU proxy; wall-time is a soft fallback)
 *   realized      = proposals actually SHIPPED/adopted — the ONLY true benefit
 *   qualified     = proposals that cleared the review bar (POTENTIAL value, not yet realized)
 *   roi           = realized / computeUnits      (the truth: did compute produce shipped value?)
 *   potentialRoi  = qualified / computeUnits     (review-worthy output per unit of compute)
 *
 * Pure + I/O-free, like motion.mjs / grader.mjs — db.mjs records the per-round series,
 * the operator surfaces the verdict, the loop can act on the recommendation.
 */
import { seriesSlope, classifyTrend } from './motion.mjs';
import { LOOP_DEFAULTS } from './loop-config.mjs';

/** A proposal at/above this impact is "qualified" — worth a human's scarce review time. */
export const QUALITY_BAR = LOOP_DEFAULTS.qualityBar;
/** Below this many rounds we don't trust a trend (cold-start edge case). */
export const MIN_ROUNDS = 3;
/** Compute spent with ZERO shipped value beyond this ⇒ a hard waste signal. */
export const WASTE_COMPUTE_FLOOR = 12;
/** Sustained realized benefit-per-compute below this is "low" (plateau-low, not plateau-high). */
export const ROI_FLOOR = LOOP_DEFAULTS.roiFloor;
/** Flat-band epsilon for the ROI slope (per round). */
export const ROI_EPS = LOOP_DEFAULTS.roiEps;

const round2 = (n) => Math.round(n * 100) / 100;
const num = (x) => Math.max(0, Number(x ?? 0));

/** Normalise one round's compute cost. modelCalls is primary; wallMs is a fallback. */
export function roundCompute(rec = {}) {
  const modelCalls = num(rec.modelCalls);
  const wallMs = num(rec.wallMs);
  const computeUnits = modelCalls > 0 ? modelCalls : Math.max(1, Math.round(wallMs / 60000));
  return { computeUnits, modelCalls, wallMs };
}

/** Cost + benefit + the two ROIs for a single round. */
export function roundRoi(rec = {}) {
  const { computeUnits, modelCalls, wallMs } = roundCompute(rec);
  const proposals = num(rec.proposals);
  const realized = num(rec.adopted);
  const qualified = num(rec.qualified);
  return {
    computeUnits, modelCalls, wallMs, proposals, realized, qualified,
    roi: round2(realized / Math.max(computeUnits, 1)),
    potentialRoi: round2(qualified / Math.max(computeUnits, 1)),
  };
}

const recommend = (state, { totalQualified, cumulativeRoi } = {}) => {
  switch (state) {
    case 'insufficient-data': return `Need ≥${MIN_ROUNDS} rounds before trusting a compute-ROI trend.`;
    case 'wasteful': return totalQualified > 0
      ? `Compute is producing review-worthy proposals but ZERO are shipped — the bottleneck is ADOPTION, not generation. Spend the next cycle APPLYING the backlog (human/Opus review), not generating more.`
      : `Compute spent, nothing qualified and nothing shipped — raise the proposal bar or pause generation; this is pure waste.`;
    case 'unproven': return `Not yet enough compute to call it waste, but nothing is shipped — adopt at least one backlog item to prove the loop returns value.`;
    case 'diminishing': return `Benefit-per-compute is flat/falling at a LOW level (${round2(cumulativeRoi)}) — tighten the quality bar, dedupe repeat proposals, or redirect compute; more of the same won't pay.`;
    case 'productive-plateau': return `Steady, healthy benefit-per-compute (${round2(cumulativeRoi)}) — keep going; no change warranted.`;
    case 'productive': return `Benefit-per-compute is rising — the loop is converting compute into shipped value. Keep going.`;
    default: return 'No recommendation.';
  }
};

/**
 * Verdict over a chronological series of round records. Detects the meta-failure
 * (diminishing returns on our own ROI measure) and the absolute-waste edge case, and
 * distinguishes plateau-HIGH (good) from plateau-LOW (waste) via ROI_FLOOR.
 */
export function analyzeRoiTrend(series = [], { minRounds = MIN_ROUNDS } = {}) {
  const rounds = (series ?? []).map(roundRoi);
  const totalCompute = rounds.reduce((s, r) => s + r.computeUnits, 0);
  const totalRealized = rounds.reduce((s, r) => s + r.realized, 0);
  const totalQualified = rounds.reduce((s, r) => s + r.qualified, 0);
  const cumulativeRoi = round2(totalRealized / Math.max(totalCompute, 1));
  const cumulativePotentialRoi = round2(totalQualified / Math.max(totalCompute, 1));

  let state;
  if (rounds.length < minRounds) {
    state = 'insufficient-data';
  } else if (totalRealized === 0) {
    state = totalCompute >= WASTE_COMPUTE_FLOOR ? 'wasteful' : 'unproven';
  } else {
    const slope = seriesSlope(rounds.map((r) => r.roi));
    const dir = classifyTrend(slope, ROI_EPS);
    if (dir === 'improving') state = 'productive';
    else if (dir === 'regressing') state = 'diminishing';
    else state = cumulativeRoi >= ROI_FLOOR ? 'productive-plateau' : 'diminishing';
  }

  const roiSlope = round2(seriesSlope(rounds.map((r) => r.roi)));
  const diminishingReturns = state === 'diminishing' || state === 'wasteful';
  return {
    state, diminishingReturns,
    rounds: rounds.length, totalCompute, totalRealized, totalQualified,
    cumulativeRoi, cumulativePotentialRoi, roiSlope,
    headline: `compute-ROI ${cumulativeRoi}/unit (${state}) · ${totalRealized} shipped / ${totalQualified} qualified over ${totalCompute} compute`,
    recommendation: recommend(state, { totalQualified, cumulativeRoi }),
  };
}

/** Multi-line operator render of an analyzeRoiTrend() report. */
export function formatRoi(report) {
  if (!report) return 'Compute ROI: n/a';
  return [
    `Compute ROI: ${report.headline}`,
    `  realized ${report.cumulativeRoi}/unit · potential ${report.cumulativePotentialRoi}/unit · slope ${report.roiSlope}`,
    `  ${report.diminishingReturns ? '⚠ ' : ''}${report.recommendation}`,
  ].join('\n');
}
