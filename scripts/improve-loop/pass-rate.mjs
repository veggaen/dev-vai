/**
 * Pass-rate delta — the measurement that proves a self-improvement actually made Vai better
 * (Vegga's agreed primary metric: improve-loop pass-rate over time, anti-slop). Pure: given two
 * runs' class stats (from db.classStats: [{class,total,passed}]), compute per-class and overall
 * before→after deltas and a verdict. No I/O → fully unit-tested; the loop calls it to gate
 * "did this fix help?" instead of asserting it did.
 */

/** Fraction passed for a stats row, 0 when no samples (avoids NaN). */
function rate(row) {
  const total = Number(row?.total ?? 0);
  return total > 0 ? Number(row?.passed ?? 0) / total : 0;
}

/**
 * Compare two runs' class stats.
 * @param before [{class,total,passed}]  (e.g. the run before a fix)
 * @param after  [{class,total,passed}]  (the run after)
 * @returns {
 *   overall: { beforeRate, afterRate, delta },          // weighted by samples
 *   classes: [{ class, beforeRate, afterRate, delta }], // per class, sorted by |delta| desc
 *   verdict: 'improved' | 'regressed' | 'flat',         // overall direction
 *   regressions: string[],                               // classes that got worse (gate signal)
 * }
 */
export function passRateDelta(before, after, opts = {}) {
  const eps = opts.epsilon ?? 0.01; // ignore sub-1% noise as flat
  const byClass = (rows) => new Map((rows ?? []).map((r) => [r.class, r]));
  const b = byClass(before);
  const a = byClass(after);
  const allClasses = [...new Set([...b.keys(), ...a.keys()])].sort();

  const classes = allClasses.map((cls) => {
    const beforeRate = rate(b.get(cls));
    const afterRate = rate(a.get(cls));
    return { class: cls, beforeRate, afterRate, delta: afterRate - beforeRate };
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const sum = (rows, key) => (rows ?? []).reduce((s, r) => s + Number(r?.[key] ?? 0), 0);
  const beforeTotal = sum(before, 'total'); const afterTotal = sum(after, 'total');
  const beforeRate = beforeTotal > 0 ? sum(before, 'passed') / beforeTotal : 0;
  const afterRate = afterTotal > 0 ? sum(after, 'passed') / afterTotal : 0;
  const overall = { beforeRate, afterRate, delta: afterRate - beforeRate };

  const regressions = classes.filter((c) => c.delta < -eps).map((c) => c.class);
  const verdict = overall.delta > eps ? 'improved' : overall.delta < -eps ? 'regressed' : 'flat';

  return { overall, classes, verdict, regressions };
}

/** One-line human summary for the loop log / dashboard. */
export function formatPassRateDelta(d) {
  const pct = (n) => `${Math.round(n * 100)}%`;
  const arrow = d.verdict === 'improved' ? '↑' : d.verdict === 'regressed' ? '↓' : '→';
  const reg = d.regressions.length ? ` · regressions: ${d.regressions.join(', ')}` : '';
  return `${arrow} ${d.verdict}: overall ${pct(d.overall.beforeRate)} → ${pct(d.overall.afterRate)} (${d.overall.delta >= 0 ? '+' : ''}${pct(d.overall.delta)})${reg}`;
}
