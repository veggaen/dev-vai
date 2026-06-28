/**
 * guard-builder — the AUTONOMOUS build step of the innovation arc. Turns a routed "autonomous"
 * discovery (a stuck answer-quality gap the loop keeps re-learning) into a REAL, PROVEN pre-ship
 * guard — without a human writing the guard.
 *
 * THE SAFETY INSIGHT (why this isn't "let an 8B write code"): we do NOT generate novel source. The
 * grounding-gate proved a general SHAPE — "an answer that trips a measurable signal, and isn't a
 * short reply, should be held/repaired before shipping." That shape generalises across the loop's
 * OWN answer signals (detectAnswerSignals: grounded / confident+unhedged / filler). So a discovery
 * maps to a CONFIGURED guard instance (which signal + a threshold), and the build is just choosing
 * the signal the lesson is about. The structure is human-proven; only the selection is automated.
 *
 * THE HONESTY GATE (why a built guard can be trusted): a guard is only KEPT if it PROVES itself
 * against the loop's own labelled answers — it must flag the genuinely-bad ones AND not false-flag
 * the genuinely-good ones. A guard that can't separate good from bad on real data is DISCARDED and
 * the discovery is escalated instead. The loop never keeps an unproven guard. Same anti-slop
 * contract as the rest of the loop, applied to the loop's own creations.
 *
 * Pure logic + injected data: buildGuardFromDiscovery is pure (takes labelled examples), so the
 * whole conceive→build→prove cycle unit-tests without a DB or a model.
 */
import { detectAnswerSignals } from './vague-answer.mjs';
import { groundingAnchors } from './grounding-gate.mjs';

/** The signal a guard enforces. Each is a pure predicate `bad(answer) => boolean` over the loop's
 *  OWN measured signals — the parameter space a discovery selects from. Adding a shape here widens
 *  what the loop can autonomously build; each is human-vetted so the structure stays sound. */
export const GUARD_SHAPES = {
  // The grounding-gate shape, generalised: a substantive answer with < MIN_ANCHORS concrete anchors.
  grounding: {
    keywords: /\b(grounding|concrete|cite|specific|number|example|file ref)\b/i,
    bad: (answer, { minAnchors = 2 } = {}) => groundingAnchors(answer).anchors < minAnchors,
    label: 'ungrounded (too few concrete anchors)',
    repair: 'add a number, a named tool/file, or a worked example',
  },
  // Overconfident + unhedged: the "AI slop" calibration gap.
  overconfidence: {
    keywords: /\b(overconfident|hedge|calibrat|certain|slop|confidently wrong)\b/i,
    bad: (answer) => { const s = detectAnswerSignals(answer); return s.confident && !s.hedged; },
    label: 'overconfident with no hedging',
    repair: 'hedge where uncertain, or ground the claim',
  },
  // Empty-calorie filler phrasing.
  filler: {
    keywords: /\b(filler|empty|padding|vague|fluff|generic)\b/i,
    bad: (answer) => detectAnswerSignals(answer).filler >= 1,
    label: 'empty-filler phrasing',
    repair: 'cut filler; replace with a concrete detail',
  },
};

/** Pick the guard shape a discovery is about, from the lesson text. Null when none matches (the
 *  discovery isn't signal-shaped → not autonomously buildable → caller escalates). */
export function selectGuardShape(discovery) {
  const lesson = String(discovery?.lesson ?? '');
  for (const [name, shape] of Object.entries(GUARD_SHAPES)) {
    if (shape.keywords.test(lesson)) return { name, ...shape };
  }
  return null;
}

/** Below this many words an answer is a terse reply that no guard should flag (greeting/yes-no). */
export const GUARD_SHORT_WORDS = 25;

/**
 * Build a runtime guard function for a shape. The guard returns { verdict:'ship'|'hold', bad,
 * reason, repair } — the same pre-ship contract as grounding-gate. Short answers always ship.
 */
export function makeGuard(shape, opts = {}) {
  const shortFloor = opts.shortWords ?? GUARD_SHORT_WORDS;
  return (answer) => {
    const words = String(answer ?? '').trim().split(/\s+/).filter(Boolean).length;
    if (words <= shortFloor) return { verdict: 'ship', bad: false, reason: `short (${words}w) — exempt` };
    const bad = !!shape.bad(answer, opts);
    return bad
      ? { verdict: 'hold', bad: true, reason: shape.label, repair: shape.repair }
      : { verdict: 'ship', bad: false, reason: `passes ${shape.name} guard` };
  };
}

/**
 * PROVE a guard against labelled answers. Each example is { answer, bad } where `bad` is the loop's
 * own label (e.g. answer_excellence below a threshold = bad). A guard PASSES only if it catches
 * enough true-bad AND barely false-flags true-good — the same bar the grounding-gate cleared
 * (≥ minCatch catch-rate, ≤ maxFalsePos false-positive-rate). Pure; returns the full scorecard.
 * @returns {{ pass, catchRate, falsePosRate, caught, totalBad, falsePos, totalGood, detail }}
 */
export function proveGuard(guard, examples = [], { minCatch = 0.6, maxFalsePos = 0.1 } = {}) {
  const bad = examples.filter((e) => e && e.bad);
  const good = examples.filter((e) => e && e.bad === false);
  const caught = bad.filter((e) => guard(e.answer).verdict === 'hold').length;
  const falsePos = good.filter((e) => guard(e.answer).verdict === 'hold').length;
  const catchRate = bad.length ? caught / bad.length : 0;
  const falsePosRate = good.length ? falsePos / good.length : 0;
  const pass = bad.length > 0 && good.length > 0 && catchRate >= minCatch && falsePosRate <= maxFalsePos;
  return {
    pass,
    catchRate: Math.round(catchRate * 100) / 100,
    falsePosRate: Math.round(falsePosRate * 100) / 100,
    caught, totalBad: bad.length, falsePos, totalGood: good.length,
    detail: bad.length === 0 || good.length === 0
      ? 'insufficient labelled data (need both good and bad examples) — cannot prove'
      : `caught ${caught}/${bad.length} bad (${Math.round(catchRate * 100)}%), false-flagged ${falsePos}/${good.length} good (${Math.round(falsePosRate * 100)}%)`,
  };
}

/** Candidate parameterisations the builder SEARCHES over for a shape — small, human-vetted grid so
 *  autonomous tuning stays bounded and safe. Each is still subject to the prove-gate. */
const PARAM_GRID = {
  grounding: [{ minAnchors: 2 }, { minAnchors: 3 }, { minAnchors: 2, shortWords: 35 }],
  overconfidence: [{}],
  filler: [{}],
};

/**
 * The full autonomous build: discovery → guard shape → SEARCH the param grid for the configuration
 * that best proves out → keep it, or escalate if NONE proves. Searching (not a single fixed guess)
 * is what makes autonomous success reachable while staying safe: every candidate must clear the
 * same prove-gate, and the BEST passing one (highest catch at acceptable false-positive) is kept.
 * @param discovery the routed candidate from innovation-arc (kind=discovery, autonomous)
 * @param examples  labelled answers from the corpus [{ answer, bad }]
 * @returns {{ built:boolean, shape?, guard?, params?, scorecard?, reason }}
 */
export function buildGuardFromDiscovery(discovery, examples = [], opts = {}) {
  const shape = selectGuardShape(discovery);
  if (!shape) return { built: false, reason: 'discovery is not signal-shaped — no proven guard family fits; escalate' };
  const grid = (PARAM_GRID[shape.name] ?? [{}]).map((p) => ({ ...p, ...opts }));

  let best = null;
  for (const params of grid) {
    const guard = makeGuard(shape, params);
    const scorecard = proveGuard(guard, examples, params);
    if (scorecard.pass && (!best || scorecard.catchRate > best.scorecard.catchRate)) {
      best = { guard, params, scorecard };
    }
  }
  if (!best) {
    // Report the closest attempt so the escalation is informative.
    const probe = proveGuard(makeGuard(shape, grid[0]), examples, grid[0]);
    return { built: false, shape, scorecard: probe, reason: `no ${shape.name} configuration proved out (best attempt: ${probe.detail}) — escalate instead of shipping an unproven guard` };
  }
  return { built: true, shape, guard: best.guard, params: best.params, scorecard: best.scorecard, reason: `built + proved a ${shape.name} guard (${JSON.stringify(best.params)}): ${best.scorecard.detail}` };
}
