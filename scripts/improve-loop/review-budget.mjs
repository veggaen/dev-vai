/**
 * review-budget — configurable "notify me when N things are done" for the perpetual loop.
 *
 * V3gga's model: the council produces all day; we don't want a ping per item, nor to poll. Instead
 * accumulate produced fixes into a weighted BUDGET across three IMPACT TIERS, and notify only when
 * the accumulated value (or a per-tier count) crosses a threshold WE set. Fully configurable so the
 * same loop can mean "notify at 100 minor fixes" one day and "notify at 10 high-impact" the next.
 *
 * The three tiers map deterministically from the capability engine's `impact` score (0–10), which is
 * already stored per proposal. Each tier carries a WEIGHT (the "devalue a number on each stage") so a
 * high-impact fix is worth more points than a minor one — fewer of them trip the same threshold.
 *
 * Two threshold shapes, OR'd (whichever trips first):
 *   - total-value: notify when Σ(weight of each item's tier) ≥ N   (e.g. 50 high × 10 = 500)
 *   - per-tier count: notify when the count of a given tier ≥ N     (e.g. 100 minor, or 10 high)
 *
 * Pure + config-driven so it's fully unit-tested; the loop just feeds it the produced items.
 */

export const TIERS = ['minor', 'medium', 'high'];

/**
 * Default config. Tune any of it per session.
 *  - cutoffs: impact ≥ high → 'high'; ≥ medium → 'medium'; else 'minor'. (medium=7 aligns with the
 *    engine's QUALITY_BAR "qualified" line; high=8.5 is the strong-idea line.)
 *  - weights: points a fix of each tier contributes to the total budget.
 *  - thresholds: notify when ANY of these trips. `totalValue` sums weighted points; `counts` is a
 *    per-tier count gate. Set a field to null/omit to disable that gate.
 */
export const DEFAULT_BUDGET_CONFIG = {
  cutoffs: { medium: 7, high: 8.5 },
  weights: { minor: 1, medium: 3, high: 10 },
  // Leverage boost (V3gga): an ENABLING feature (unlocks others downstream) is worth more than an
  // isolated one of the same impact, so high-leverage work trips the notify threshold sooner. An
  // item's value = tierWeight × (1 + leverage × leverageBoost). leverageBoost=0 disables it (value
  // = tier weight, as before). A feature that enables 3 others at boost 0.25 → ×1.75 its tier weight.
  leverageBoost: 0.25,
  thresholds: {
    totalValue: 100,           // notify when weighted points ≥ 100 (e.g. 10 high, or 100 minor)
    counts: { minor: null, medium: null, high: null }, // optional per-tier count gates
  },
};

/** Deterministically map an impact score (0–10) to a tier. Out-of-range clamps sanely. */
export function tierForImpact(impact, cutoffs = DEFAULT_BUDGET_CONFIG.cutoffs) {
  const n = Number(impact);
  if (!Number.isFinite(n)) return 'minor';
  if (n >= (cutoffs.high ?? 8.5)) return 'high';
  if (n >= (cutoffs.medium ?? 7)) return 'medium';
  return 'minor';
}

/**
 * Summarize a batch of produced items into per-tier counts + weighted total value.
 * `items` = [{ impact }] (extra fields ignored). Pure.
 */
export function summarizeBudget(items = [], config = DEFAULT_BUDGET_CONFIG) {
  const cutoffs = { ...DEFAULT_BUDGET_CONFIG.cutoffs, ...(config.cutoffs ?? {}) };
  const weights = { ...DEFAULT_BUDGET_CONFIG.weights, ...(config.weights ?? {}) };
  const leverageBoost = config.leverageBoost ?? DEFAULT_BUDGET_CONFIG.leverageBoost;
  const counts = { minor: 0, medium: 0, high: 0 };
  let totalValue = 0;
  for (const item of items) {
    const tier = tierForImpact(item?.impact, cutoffs);
    counts[tier] += 1;
    // Leverage boost: an item that unlocks downstream features is worth more. A missing/zero
    // leverage field leaves value = tier weight (backward-compatible).
    const lev = Math.max(0, Number(item?.leverage ?? 0));
    totalValue += (weights[tier] ?? 0) * (1 + lev * leverageBoost);
  }
  // Round to 1 dp so the weighted total stays readable (leverage introduces fractions).
  return { counts, totalValue: Math.round(totalValue * 10) / 10, total: items.length };
}

/**
 * Decide whether to notify given a batch and a config. Returns:
 *   { notify, reason, tripped, summary }
 * `tripped` lists every threshold that fired (there may be more than one). `reason` is a short
 * human line for the notification. Pure — the loop persists progress + calls this each round.
 */
export function shouldNotify(items = [], config = DEFAULT_BUDGET_CONFIG) {
  const summary = summarizeBudget(items, config);
  const th = { ...DEFAULT_BUDGET_CONFIG.thresholds, ...(config.thresholds ?? {}) };
  const tripped = [];

  if (th.totalValue != null && summary.totalValue >= th.totalValue) {
    tripped.push({ kind: 'totalValue', threshold: th.totalValue, value: summary.totalValue });
  }
  const counts = th.counts ?? {};
  for (const tier of TIERS) {
    const limit = counts[tier];
    if (limit != null && summary.counts[tier] >= limit) {
      tripped.push({ kind: 'count', tier, threshold: limit, value: summary.counts[tier] });
    }
  }

  const notify = tripped.length > 0;
  const reason = notify ? formatTrip(tripped, summary) : '';
  return { notify, reason, tripped, summary };
}

/** A compact human line for the notification / log. */
export function formatTrip(tripped, summary) {
  const parts = tripped.map((t) =>
    t.kind === 'totalValue'
      ? `weighted value ${t.value} ≥ ${t.threshold}`
      : `${t.value} ${t.tier} ≥ ${t.threshold}`,
  );
  const mix = `${summary.counts.high}H · ${summary.counts.medium}M · ${summary.counts.minor}m (value ${summary.totalValue})`;
  return `Review threshold reached — ${parts.join('; ')}. Batch: ${mix}.`;
}

/**
 * Parse a compact config override string (for CLI/env), e.g.:
 *   "high=10;value=200"           → 10 high-impact fixes OR total value 200
 *   "minor=100"                    → 100 minor fixes
 *   "value=500;weights=1,3,10"     → total value 500 with those tier weights
 * Unknown keys are ignored. Returns a partial config merged over the default by the caller.
 */
export function parseBudgetSpec(spec, base = DEFAULT_BUDGET_CONFIG) {
  const cfg = {
    cutoffs: { ...base.cutoffs },
    weights: { ...base.weights },
    thresholds: { totalValue: base.thresholds.totalValue, counts: { ...base.thresholds.counts } },
  };
  if (!spec) return cfg;
  // Start from a clean slate on thresholds when a spec is given, so "high=10" means ONLY that gate
  // unless the caller also sets value.
  cfg.thresholds = { totalValue: null, counts: { minor: null, medium: null, high: null } };
  for (const rawPart of String(spec).split(';')) {
    const [k, v] = rawPart.split('=').map((s) => s.trim());
    if (!k || v == null) continue;
    const key = k.toLowerCase();
    if (key === 'value' || key === 'total' || key === 'totalvalue') {
      const n = Number(v); if (Number.isFinite(n)) cfg.thresholds.totalValue = n;
    } else if (TIERS.includes(key)) {
      const n = Number(v); if (Number.isFinite(n)) cfg.thresholds.counts[key] = n;
    } else if (key === 'weights') {
      const [mi, me, hi] = v.split(',').map(Number);
      if ([mi, me, hi].every(Number.isFinite)) cfg.weights = { minor: mi, medium: me, high: hi };
    } else if (key === 'cutoffs') {
      const [me, hi] = v.split(',').map(Number);
      if ([me, hi].every(Number.isFinite)) cfg.cutoffs = { medium: me, high: hi };
    }
  }
  return cfg;
}
