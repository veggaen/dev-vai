/**
 * meaning-selector — what is the MOST MEANINGFUL thing to improve right now?
 *
 * The flaw V3gga named: the loop only ever worked on ~8 hand-written ROUTING micro-classes, so
 * even running perfectly it just nudged a classifier 35%→40% — logical motion, not meaningful
 * improvement. Its whole notion of "what to improve" was a fixed synthetic list.
 *
 * This module widens that. It weighs ALL the meaningful work sources the loop already measures —
 * routing correctness, ANSWER QUALITY (is the answer actually good?), CAPABILITY gaps (can Vai do
 * more?), and stuck recurring weaknesses — and ranks them by LEVERAGE: how far below its bar a
 * lane is × how much that lane matters to a real user × whether the loop can actually act on it.
 * The loop then spends its cycle on the highest-leverage lane instead of always defaulting to
 * routing. Self-directed meaning, grounded in the loop's own evidence.
 *
 * Pure + I/O-free: takes already-measured signals, returns a ranked plan. Unit-tests without a DB.
 */
import { LOOP_DEFAULTS } from './loop-config.mjs';

/**
 * Each lane's "importance" — how much improving it actually matters to a real user. Routing is
 * table-stakes (a mis-routed turn is wrong) but capped; ANSWER QUALITY is what a human notices most;
 * CAPABILITY is high-ceiling (new things Vai can do) but lower-confidence to land. These are the
 * meaningful-ness weights — the thing that was missing when everything was treated as equal routing.
 *
 * quality 1.0 (what a human feels first) · capability 0.9 (growth lane, high ceiling) ·
 * codebase 0.85 (compounding craft debt) · reliability 0.8 (stuck weaknesses compound) ·
 * routing 0.7 (necessary, but table-stakes, not delight). Values live in loop-config.mjs.
 */
export const LANE_WEIGHT = LOOP_DEFAULTS.laneWeights;

/** A lane is "below bar" (worth working on) under these targets. Gap = how far below, normalized. */
export const LANE_BAR = {
  quality: 8.0,     // out of 10 — below this, answers aren't excellent
  routing: 0.85,    // 0..1 pass-rate
  codebase: 0.85,   // 0..1 perpetual-health composite — below this, the app has real craft debt
};

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/**
 * Score the candidate lanes from measured signals.
 * @param signals {
 *   routingPassRate?: number(0..1), routingWeakestClass?: {class,passRate}|null,
 *   answerQuality?: number(0..10), answerSampleCount?: number,
 *   capabilityGaps?: number, stuckQualityGaps?: number,
 *   canActQuality?: boolean   // is there a buildable quality guard available this cycle?
 * }
 * @returns ranked lanes [{ lane, leverage, gap, reason, actionable }]
 */
export function scoreLanes(signals = {}) {
  const lanes = [];

  // QUALITY lane — gap below the excellence bar, weighted highest. Only meaningful with real samples.
  if (signals.answerQuality != null && (signals.answerSampleCount ?? 0) >= 10) {
    const gap = clamp01((LANE_BAR.quality - signals.answerQuality) / LANE_BAR.quality);
    const actionable = !!signals.canActQuality || (signals.stuckQualityGaps ?? 0) > 0;
    lanes.push({
      lane: 'quality', gap, actionable,
      leverage: gap * LANE_WEIGHT.quality * (actionable ? 1 : 0.4),
      reason: `answer quality ${signals.answerQuality.toFixed(1)}/10 vs bar ${LANE_BAR.quality} (${signals.answerSampleCount} samples)${actionable ? '' : ' — no buildable guard yet'}`,
    });
  }

  // CAPABILITY lane — unbuilt feature proposals. A backlog is POTENTIAL value, not proven value, so
  // its depth saturates LOW (a pile of unvalidated proposals must not outrank a MEASURED quality
  // deficit). Capped at 0.6 depth so capability competes but doesn't monopolise on backlog size alone.
  if ((signals.capabilityGaps ?? 0) > 0) {
    const depth = Math.min(0.6, clamp01((signals.capabilityGaps ?? 0) / 12));
    lanes.push({
      lane: 'capability', gap: depth, actionable: true,
      leverage: depth * LANE_WEIGHT.capability,
      reason: `${signals.capabilityGaps} capability proposal(s) waiting, none built — Vai's growth lane is idle`,
    });
  }

  // CODEBASE lane — the WHOLE APP's craft: completeness, structure, polish, modern animation. Driven
  // by the perpetual-health composite (tsc/tests/god-class file size/TODO debt) plus any named code
  // gap (an oversized file to decompose, a missing test, an untyped/duplicated module). This is what
  // makes the process improve the app itself — frontend + backend structure — not just answer routing.
  // Below the bar = real craft debt; the gap is how far the composite sits under the target.
  if (signals.codebaseHealth != null) {
    const gap = clamp01((LANE_BAR.codebase - signals.codebaseHealth) / LANE_BAR.codebase);
    const actionable = (signals.codebaseGaps ?? 0) > 0; // a concrete, buildable code-health target exists
    if (gap > 0) lanes.push({
      lane: 'codebase', gap, actionable,
      leverage: gap * LANE_WEIGHT.codebase * (actionable ? 1 : 0.5),
      reason: `codebase health ${(signals.codebaseHealth * 100).toFixed(0)}% vs bar ${Math.round(LANE_BAR.codebase * 100)}%`
        + (signals.codebaseTopGap ? ` — top gap: ${signals.codebaseTopGap}` : (actionable ? `, ${signals.codebaseGaps} buildable` : ' — no concrete target yet')),
    });
  }

  // RELIABILITY lane — stuck recurring weaknesses (compounding if ignored).
  if ((signals.stuckQualityGaps ?? 0) > 0) {
    const depth = clamp01((signals.stuckQualityGaps ?? 0) / 3);
    lanes.push({
      lane: 'reliability', gap: depth, actionable: true,
      leverage: depth * LANE_WEIGHT.reliability,
      reason: `${signals.stuckQualityGaps} recurring weakness(es) the loop keeps re-learning without acting`,
    });
  }

  // ROUTING lane — table-stakes correctness. Gap below pass-rate bar; weighted lowest so it stops
  // monopolising the loop, but still wins when routing is genuinely broken (e.g. a class at 35%).
  if (signals.routingPassRate != null) {
    const gap = clamp01((LANE_BAR.routing - signals.routingPassRate) / LANE_BAR.routing);
    const weakest = signals.routingWeakestClass;
    lanes.push({
      lane: 'routing', gap, actionable: !!weakest,
      leverage: gap * LANE_WEIGHT.routing * (weakest ? 1 : 0.5),
      reason: weakest
        ? `routing ${Math.round(signals.routingPassRate * 100)}% (weakest ${weakest.class} ${Math.round((weakest.passRate ?? 0) * 100)}%)`
        : `routing ${Math.round(signals.routingPassRate * 100)}% — no actionable class`,
    });
  }

  return lanes.sort((a, b) => b.leverage - a.leverage);
}

/**
 * The meaningful work plan: the highest-leverage lane + the full ranking + a friend-readable line.
 * @returns { lane, leverage, reason, ranking, headline } — lane null only when nothing is below bar.
 */
export function chooseMeaningfulWork(signals = {}) {
  const ranking = scoreLanes(signals);
  const top = ranking.find((l) => l.leverage > 0) ?? null;
  return {
    lane: top?.lane ?? null,
    leverage: top?.leverage ?? 0,
    reason: top?.reason ?? 'all lanes at or above bar — the loop is in good shape',
    ranking,
    headline: top
      ? `most meaningful now: ${top.lane.toUpperCase()} (leverage ${top.leverage.toFixed(2)}) — ${top.reason}`
      : 'no lane below its bar — nothing high-leverage to do',
  };
}

/**
 * Gather the live meaning signals from the corpus (the I/O half; the scorer above is pure). Reads
 * routing pass-rate + weakest class, average answer quality + sample count, unbuilt capability
 * count, and stuck quality-gap count. Never throws — a missing table yields a conservative signal.
 */
export function gatherMeaningSignals(db, extra = {}) {
  const get = (s, d = null) => { try { return db.prepare(s).get() ?? d; } catch { return d; } };
  const routing = get("SELECT AVG(1.0*p/t) avg FROM (SELECT class, COUNT(*) t, SUM(passed) p FROM results GROUP BY class HAVING t>=4)", { avg: null });
  const weakest = get("SELECT class, 1.0*SUM(passed)/COUNT(*) pr FROM results GROUP BY class HAVING COUNT(*)>=4 ORDER BY pr ASC LIMIT 1", null);
  const qual = get("SELECT AVG(answer_excellence) avg, COUNT(answer_excellence) n FROM results WHERE answer_excellence IS NOT NULL", { avg: null, n: 0 });
  const caps = get("SELECT COUNT(*) n FROM capabilities WHERE status='proposed'", { n: 0 });
  const stuck = get("SELECT COUNT(*) n FROM answer_lessons WHERE times_seen>=40 AND last_overall<7 AND lesson NOT LIKE '%RESOLVED%'", { n: 0 });
  return {
    routingPassRate: routing?.avg ?? null,
    routingWeakestClass: weakest ? { class: weakest.class, passRate: weakest.pr } : null,
    answerQuality: qual?.avg ?? null,
    answerSampleCount: Number(qual?.n ?? 0),
    capabilityGaps: Number(caps?.n ?? 0),
    stuckQualityGaps: Number(stuck?.n ?? 0),
    canActQuality: Number(stuck?.n ?? 0) > 0, // a stuck gap = a buildable guard target (innovation-arc)
    // WHOLE-APP code health — injected by the caller (the supervisor already samples the perpetual-
    // health composite each cycle; it can't be computed from a pure DB read since it shells tsc/git).
    // codebaseHealth: 0..1 composite; codebaseGaps: count of concrete buildable code targets;
    // codebaseTopGap: a human label for the biggest one (e.g. "vai-engine.ts 36k lines — decompose").
    codebaseHealth: extra.codebaseHealth ?? null,
    codebaseGaps: Number(extra.codebaseGaps ?? 0),
    codebaseTopGap: extra.codebaseTopGap ?? null,
  };
}

/** Friend-readable multi-line render of the meaning ranking. */
export function formatMeaning(plan) {
  if (!plan?.ranking?.length) return 'meaning: no measurable lanes yet';
  const lines = [plan.headline];
  for (const l of plan.ranking) {
    const mark = l.lane === plan.lane ? '→' : ' ';
    lines.push(`  ${mark} ${l.lane} · leverage ${l.leverage.toFixed(2)} · ${l.reason}`);
  }
  return lines.join('\n');
}
