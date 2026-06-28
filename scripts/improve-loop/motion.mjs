/**
 * motion - the perpetual loop's measurement of ITSELF.
 *
 * pass-rate.mjs answers "did one fix help?" (two runs). campaignTrend gives the
 * pass-rate series. But a perpetual loop's real failure mode isn't crashing - it
 * is SPINNING: running forever, burning compute, improving nothing. That is the
 * meta-version of slop. This module turns the corpus's cross-run series into a
 * single MOTION verdict: is the loop improving, stalling (spinning), or
 * regressing - across BOTH gradients it now has (read-the-prompt pass-rate AND
 * answer-excellence craft). When both gradients go flat, the loop is stalled and
 * the honest move is to INNOVATE (different model / prompt / tool / seed class),
 * not keep grinding the same lane.
 *
 * Pure + I/O-free -> fully unit-testable, like pass-rate.mjs. db.mjs reads the
 * series; the operator surfaces the verdict; the loop can act on the recommendation.
 */

/** Least-squares slope of y over its own index 0..n-1. 0 for <2 points. */
export function seriesSlope(values) {
  const ys = (values ?? []).filter((v) => Number.isFinite(v));
  const n = ys.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

/** Direction of a per-run series given a flat-band epsilon (per step). */
export function classifyTrend(slope, eps) {
  if (slope > eps) return 'improving';
  if (slope < -eps) return 'regressing';
  return 'flat';
}

/**
 * Stagnation: are the last `window` values all inside a flat band? That is the
 * loop spinning without motion. Returns how many trailing runs are flat.
 */
export function detectStagnation(values, { window = 3, eps = 0.01 } = {}) {
  const ys = (values ?? []).filter((v) => Number.isFinite(v));
  if (ys.length < window) return { stalled: false, runsFlat: 0, window };
  const tail = ys.slice(-window);
  const flat = Math.max(...tail) - Math.min(...tail) <= eps;
  let runsFlat = 0;
  for (let i = ys.length - 1; i > 0; i--) {
    if (Math.abs(ys[i] - ys[i - 1]) <= eps) runsFlat++;
    else break;
  }
  return { stalled: flat, runsFlat: flat ? Math.max(runsFlat, window - 1) : runsFlat, window };
}

function summarize(values, eps, window) {
  const ys = (values ?? []).filter((v) => Number.isFinite(v));
  const slope = seriesSlope(ys);
  return {
    samples: ys.length,
    first: ys.length ? ys[0] : null,
    current: ys.length ? ys[ys.length - 1] : null,
    slope,
    verdict: classifyTrend(slope, eps),
    stagnation: detectStagnation(ys, { window, eps }),
  };
}

/**
 * Read the loop's motion from its two cross-run gradients.
 * @param series {{ passRate?: number[], excellence?: number[] }}
 *   passRate in 0..1, excellence in 0..10 (per-run series, oldest first).
 * @returns {{ state, passRate, excellence, stagnation, recommendation, headline }}
 */
export function analyzeMotion(series = {}, opts = {}) {
  const window = opts.window ?? 3;
  const passEps = opts.passEpsilon ?? 0.01;   // 1% pass-rate step = noise
  const exEps = opts.excellenceEpsilon ?? 0.2; // 0.2/10 craft step = noise

  const passRate = summarize(series.passRate, passEps, window);
  const excellence = summarize(series.excellence, exEps, window);
  const haveBoth = passRate.samples >= 2 || excellence.samples >= 2;

  // Stalled only when NEITHER gradient is moving - a maxed pass-rate while
  // excellence still climbs is motion, not a stall.
  const bothFlat =
    (passRate.samples < 2 || passRate.verdict === 'flat') &&
    (excellence.samples < 2 || excellence.verdict === 'flat');
  const stalled =
    bothFlat &&
    (passRate.stagnation.stalled || passRate.samples < 2) &&
    (excellence.stagnation.stalled || excellence.samples < 2) &&
    (passRate.samples >= window || excellence.samples >= window);

  const regressing = passRate.verdict === 'regressing' || excellence.verdict === 'regressing';
  const improving = passRate.verdict === 'improving' || excellence.verdict === 'improving';

  let state;
  if (!haveBoth) state = 'cold-start';
  else if (regressing) state = 'regressing';
  else if (improving) state = 'improving';
  else if (stalled) state = 'stalling';
  else state = 'warming';

  const recommendation = buildRecommendation({ state, passRate, excellence });

  return {
    state,
    passRate,
    excellence,
    stagnation: { stalled, runsFlat: Math.max(passRate.stagnation.runsFlat, excellence.stagnation.runsFlat), window },
    recommendation,
    headline: formatMotion({ state, passRate, excellence, stagnation: { stalled } }),
  };
}

function buildRecommendation({ state, passRate, excellence }) {
  if (state === 'regressing') {
    const lane = passRate.verdict === 'regressing' ? 'pass-rate' : 'answer-excellence';
    return `Regression on ${lane}: bisect the last applied change before generating more work.`;
  }
  if (state === 'stalling') {
    return 'Loop is spinning (both gradients flat): innovate - try a different model, a tighter prompt, a new tool, or a fresh seed class.';
  }
  if (state === 'cold-start') return 'Not enough runs yet to read motion - keep observing.';
  return null;
}

const pct = (n) => (n == null ? 'n/a' : `${Math.round(n * 100)}%`);
const sign = (s, eps) => (s > eps ? '↑' : s < -eps ? '↓' : '→');
const num1 = (n) => (n == null ? 'n/a' : (Math.round(n * 10) / 10).toString());

/** One-line motion summary for the operator/dashboard. */
export function formatMotion(m) {
  const stall = m.stagnation?.stalled ? ' · STALLED' : '';
  return (
    `Perpetual motion: ${m.state}${stall}` +
    ` · pass ${pct(m.passRate.current)} ${sign(m.passRate.slope, 0.01)}` +
    ` · excellence ${num1(m.excellence.current)}/10 ${sign(m.excellence.slope, 0.2)}`
  );
}
