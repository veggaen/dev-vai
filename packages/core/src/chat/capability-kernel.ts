import type { Resolution, ScoreResult, TurnContext, TurnHandler } from './turn-pipeline.js';

/**
 * A shadow scoring of one capability for one turn — computed for observation,
 * never deciding. This is the safe adoption path: run a Capability alongside
 * the live handlers, surface its score + breakdown + verify outcome in the
 * plan, and only promote it to a real decider once its scoring is trusted.
 */
export interface ShadowScore {
  readonly name: string;
  /** Folded fit 0..1 (null when the capability is inapplicable to this turn). */
  readonly score: number | null;
  /** Inspectable component line for the panel. */
  readonly reason?: string;
  /** Whether the capability WOULD have produced an answer (resolve non-null). */
  readonly wouldResolve: boolean;
  /** Whether that answer WOULD pass its own verify gate. */
  readonly wouldVerify: boolean;
  /** Verify rationale (why it would pass or be refused). */
  readonly verifyReason?: string;
}

/**
 * Vai Capability Kernel — the contract every capability implements.
 *
 * This is the small, typed skeleton of the architecture Codex's review called
 * for: one coherent intelligence system instead of many intelligent side paths.
 * It does NOT replace {@link turn-pipeline.ts}'s scored dispatch — it extends it.
 * The existing `TurnHandler` already gives us `score` (Codex's match+estimate)
 * and `resolve` (execute); this module adds the two pieces the kernel was
 * missing and that the review flagged as the real gaps:
 *
 *   1. `verify(resolution, ctx)` — bind claims to evidence BEFORE the answer is
 *      released. This is the stage whose absence let Vai assert "official
 *      evidence" for a wrong prime-minister answer: the curated fact was right,
 *      but nothing checked the composed claim against the cited source. A
 *      capability that claims grounding must be able to fail its own check.
 *
 *   2. `ScoreBreakdown` — an INSPECTABLE score, not one opaque fit number:
 *        score = intentFit + evidence + history − latency − cost − risk
 *      so the decision trail can show WHY a capability won, and so measured
 *      outcomes can later nudge the bounded weights (the learning loop) instead
 *      of us hand-editing regex priorities.
 *
 * Backward compatibility is deliberate. A `Capability` IS a `TurnHandler`
 * (same `name` / `score` / `resolve`), so the current dispatcher runs a mixed
 * list of plain handlers and capabilities unchanged. Capabilities are simply
 * handlers that ALSO carry an estimate + a verify stage; the de-hardcoding
 * campaign migrates handlers into capabilities one at a time, never in a
 * big-bang rewrite (the review's explicit warning: do not add another large
 * regex layer — extract gradually and let outcomes adjust weights).
 */

/**
 * The inspectable components of a capability's fit for a turn. Every field is
 * 0..1 and signed by convention: the first three ADD to the score, the last
 * three SUBTRACT. `toScore()` folds them into the single number the dispatcher
 * ranks on, but the breakdown is preserved for the plan so a human or AI can
 * see "chose X: high intent fit + fresh evidence, low risk" rather than "0.91".
 */
export interface ScoreBreakdown {
  /** How well the turn matches what this capability is for. */
  readonly intentFit: number;
  /** How much usable, attached evidence this capability has for THIS turn. */
  readonly evidence: number;
  /** Historical success rate of this capability on similar turns (learned). */
  readonly history: number;
  /** Expected time cost, normalized (higher = slower → penalized). */
  readonly latency: number;
  /** Resource/$ cost, normalized (higher = pricier → penalized). */
  readonly cost: number;
  /** Risk of being wrong or harmful, normalized (higher = riskier → penalized). */
  readonly risk: number;
  /** Optional one-line human-readable rationale, surfaced in the plan. */
  readonly reason?: string;
}

/** Weights for folding a breakdown into a scalar. Bounded; tunable by outcome. */
export interface ScoreWeights {
  readonly intentFit: number;
  readonly evidence: number;
  readonly history: number;
  readonly latency: number;
  readonly cost: number;
  readonly risk: number;
}

/**
 * Default weights. Intent fit dominates (it is why a capability is even a
 * candidate); evidence is the next-strongest positive because grounded answers
 * are the product; the penalties are real but smaller so a slightly slower,
 * well-grounded capability still beats a fast guess. These are the bounded
 * knobs the learning loop will eventually nudge — never hand-tuned per phrase.
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  intentFit: 0.45,
  evidence: 0.3,
  history: 0.1,
  latency: 0.05,
  cost: 0.05,
  risk: 0.15,
};

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Render a breakdown as a compact, human-readable component line for the
 * Thinking panel — the inspectable "why this score" the review asked for, so a
 * human sees "intent 0.95 · evidence 0.40 · −risk 0.20" instead of a bare 71%.
 * Folded into the candidate's `reason`, which the existing RoutePlanDetails row
 * already renders — no UI rewrite needed.
 */
export function describeBreakdown(breakdown: ScoreBreakdown): string {
  const parts = [
    `intent ${breakdown.intentFit.toFixed(2)}`,
    `evidence ${breakdown.evidence.toFixed(2)}`,
  ];
  if (breakdown.history !== 0.5) parts.push(`history ${breakdown.history.toFixed(2)}`);
  if (breakdown.risk > 0) parts.push(`−risk ${breakdown.risk.toFixed(2)}`);
  if (breakdown.latency > 0) parts.push(`−latency ${breakdown.latency.toFixed(2)}`);
  if (breakdown.cost > 0) parts.push(`−cost ${breakdown.cost.toFixed(2)}`);
  return parts.join(' · ');
}

/**
 * Fold a breakdown into the single 0..1 fit the dispatcher ranks on. Positives
 * add, penalties subtract, all weight-scaled, result clamped. Kept pure and
 * separate so it is unit-testable and so the same math is auditable everywhere.
 */
export function scoreFromBreakdown(
  breakdown: ScoreBreakdown,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): number {
  const positive =
    weights.intentFit * clamp01(breakdown.intentFit) +
    weights.evidence * clamp01(breakdown.evidence) +
    weights.history * clamp01(breakdown.history);
  const penalty =
    weights.latency * clamp01(breakdown.latency) +
    weights.cost * clamp01(breakdown.cost) +
    weights.risk * clamp01(breakdown.risk);
  return clamp01(positive - penalty);
}

/**
 * A read-only learned-history source. The {@link CapabilityOutcomeLedger} implements this:
 * `history(name, turnClass)` returns the capability's learned success rate in [0,1], or 0.5
 * when there is no data yet (the kernel's cold-start). Kept as a tiny interface so the
 * kernel depends on the SIGNAL, not the whole ledger.
 */
export interface CapabilityHistory {
  history(name: string, turnClass?: string): number;
}

/**
 * Replace a breakdown's hardcoded `history` term with the LEARNED value for `name` from a
 * history source. Every capability ships `history: 0.5` (neutral) because it cannot know
 * its own track record; this is where the dispatcher injects what the ledger has actually
 * observed, so a capability that reliably verify-passes outranks one that often fails — the
 * kernel's `history` term finally does what it was designed to. Returns the breakdown
 * unchanged when no source is given (backward-compatible).
 */
export function withLearnedHistory(
  breakdown: ScoreBreakdown,
  name: string,
  source?: CapabilityHistory,
  turnClass?: string,
): ScoreBreakdown {
  if (!source) return breakdown;
  return { ...breakdown, history: source.history(name, turnClass) };
}

/**
 * Fold a breakdown into a score, but with the `history` term taken from the learned source
 * (when given). Convenience wrapper combining {@link withLearnedHistory} and
 * {@link scoreFromBreakdown} so the dispatcher has one call site.
 */
export function scoreWithHistory(
  breakdown: ScoreBreakdown,
  name: string,
  source?: CapabilityHistory,
  turnClass?: string,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): number {
  return scoreFromBreakdown(withLearnedHistory(breakdown, name, source, turnClass), weights);
}

/**
 * The result of a capability verifying its own resolution before release.
 * `ok: false` means the capability could NOT stand behind its answer — the
 * dispatcher treats that exactly like a decline and falls through, recording
 * the failure reason in the plan so the miss is honest and inspectable.
 */
export interface VerificationResult {
  readonly ok: boolean;
  /** Why verification passed or failed — always present on failure. */
  readonly reason?: string;
  /** Source/evidence identifiers the claims were bound to (for the trace). */
  readonly boundEvidence?: readonly string[];
}

/**
 * One capability in the kernel. It is a `TurnHandler` (so today's dispatcher
 * runs it unchanged) plus the two kernel additions:
 *
 *   - `estimate(ctx)` returns the inspectable {@link ScoreBreakdown}. The
 *     default `score()` adapter (see {@link asTurnHandler}) folds it via
 *     {@link scoreFromBreakdown}, so a capability normally implements estimate
 *     and lets score be derived — keeping the components visible.
 *   - `verify(resolution, ctx)` runs after resolve and gates release. A
 *     capability that claims grounding MUST implement a real check here; one
 *     that cannot be wrong (pure small-talk) returns `{ ok: true }`.
 */
export interface Capability<R extends Resolution = Resolution> extends TurnHandler<R> {
  /** Inspectable multi-factor fit for this turn (null = inapplicable). */
  estimate(ctx: TurnContext): ScoreBreakdown | null;
  /** Bind claims to evidence and decide whether the answer may be released. */
  verify(resolution: R, ctx: TurnContext): VerificationResult;
}

/**
 * Adapt a {@link Capability} to a plain {@link TurnHandler} whose `score`
 * derives from the capability's `estimate` (folded with the given weights) and
 * whose `resolve` runs the capability's resolve THEN its verify, declining
 * (returning null) when verification fails. This is the bridge that lets a
 * capability drop into the existing `dispatchTurn` list with the verify stage
 * enforced — no dispatcher change required for adoption.
 *
 * `onVerifyFail` is an optional observability hook (e.g. to log the rejected
 * claim for the learning loop); it must never throw into the turn.
 */
export function asTurnHandler<R extends Resolution = Resolution>(
  capability: Capability<R>,
  options: {
    readonly weights?: ScoreWeights;
    readonly onVerifyFail?: (name: string, result: VerificationResult, ctx: TurnContext) => void;
  } = {},
): TurnHandler<R> {
  const weights = options.weights ?? DEFAULT_SCORE_WEIGHTS;
  return {
    name: capability.name,
    score(ctx: TurnContext): ScoreResult {
      const breakdown = capability.estimate(ctx);
      if (breakdown === null) return null;
      // The reason carries BOTH the capability's own rationale and the
      // inspectable component breakdown, so the Thinking panel shows a human
      // why the score is what it is — not just the folded percentage.
      const components = describeBreakdown(breakdown);
      const reason = breakdown.reason ? `${breakdown.reason} (${components})` : components;
      return { score: scoreFromBreakdown(breakdown, weights), reason };
    },
    resolve(ctx: TurnContext): R | null {
      const resolution = capability.resolve(ctx);
      if (!resolution) return null;
      let verification: VerificationResult;
      try {
        verification = capability.verify(resolution, ctx);
      } catch (error) {
        // A throwing verifier is treated as a failed verification, not a crash:
        // the safe outcome is to NOT release an unverified claim.
        verification = { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
      if (!verification.ok) {
        if (options.onVerifyFail) {
          try { options.onVerifyFail(capability.name, verification, ctx); } catch { /* observability must not break the turn */ }
        }
        return null;
      }
      return resolution;
    },
  };
}

/**
 * Score a capability in SHADOW for one turn — runs estimate → resolve → verify
 * without affecting the live decision, and reports what WOULD have happened. A
 * thrown error at any stage is swallowed into a non-resolving shadow (shadow
 * observation must never break the real turn). Returns null only when the
 * capability is inapplicable (estimate → null), so callers can skip it.
 */
export function shadowScore<R extends Resolution = Resolution>(
  capability: Capability<R>,
  ctx: TurnContext,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ShadowScore | null {
  let breakdown: ScoreBreakdown | null;
  try {
    breakdown = capability.estimate(ctx);
  } catch {
    breakdown = null;
  }
  if (breakdown === null) return null;

  const components = describeBreakdown(breakdown);
  const reason = breakdown.reason ? `${breakdown.reason} (${components})` : components;

  let resolution: R | null = null;
  try {
    resolution = capability.resolve(ctx);
  } catch {
    resolution = null;
  }

  let wouldVerify = false;
  let verifyReason: string | undefined;
  if (resolution) {
    try {
      const v = capability.verify(resolution, ctx);
      wouldVerify = v.ok;
      verifyReason = v.reason;
    } catch (error) {
      wouldVerify = false;
      verifyReason = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    name: capability.name,
    score: scoreFromBreakdown(breakdown, weights),
    reason,
    wouldResolve: resolution !== null,
    wouldVerify,
    verifyReason,
  };
}
