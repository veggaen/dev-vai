import type { QuestionIntent } from './question-intent.js';
import type { TurnClassification, TurnClass } from './turn-classifier.js';

/**
 * Intent-aware fit adjustment for the deterministic chat handlers.
 *
 * Vai's scored dispatcher ({@link ./turn-pipeline.ts}) ranks handlers by a 0..1
 * fit. Historically the live registry handed each handler a *constant* priority
 * (0.99, 0.98, …, 0.89) and ranked on that, so a handler won by being near the
 * top of the list and not being gated off — NOT by actually fitting the turn.
 * That is the structural source of "intent miss" routing errors (a fact-shim
 * answering a build ask; a country-fact card answering a business-idea ask).
 *
 * This module keeps the constant as a *prior* and layers a bounded, explicit
 * adjustment on top, derived from the turn's already-classified intent
 * ({@link QuestionIntent}) and shape ({@link TurnClassification}). The result:
 *
 *   - A handler is BOOSTED when the turn matches an intent/shape/signal it
 *     genuinely serves, so it can overtake a higher-listed-but-off-intent rival.
 *   - A handler is SUPPRESSED when the turn clearly belongs to a different lane,
 *     so it loses even though its prior is high.
 *   - A handler NOT in the table, or a turn that matches no rule, returns the
 *     prior UNCHANGED — so behavior is identical to before until a signal fires.
 *     (This is the regression-safety invariant the tests pin.)
 *
 * Adjustments are bounded (mirroring `AVOID_MULTIPLIER` / `PREFER_BOOST` in the
 * pipeline): a boost is a capped addend, a suppression is a multiplier. No single
 * rule can invert the whole order on its own — it nudges; the dispatcher's
 * confidence floor and a handler's right to decline still do the final guarding.
 *
 * Pure: no I/O, no state. Trivially testable.
 */

/**
 * A boost reinforces an on-lane handler and breaks ties in its favor, but it is
 * deliberately SMALLER than the smallest gap between adjacent registry priors
 * (the tightest is 0.005, e.g. 0.98 → 0.975). That cap is load-bearing: a boost
 * must never let a fitting handler LEAPFROG a sibling the curated order seated
 * ABOVE it. Concretely, fact-shim (prior 0.91) on a fact lookup must not overtake
 * a strict-format handler (prior 0.92) when the user asked for a specific shape
 * ("Capital of Japan. One word only.") — the format request still owns the turn.
 * The decisive off-lane demotion is the suppression multiplier below; the boost
 * is the gentle on-lane nudge + the auditable "why" reason.
 */
const BOOST_ADDEND = 0.004;
/** A suppression drops an off-lane handler below its rivals without zeroing it. */
const SUPPRESS_MULTIPLIER = 0.45;

/**
 * Per-handler fit rules. Keyed by the handler `name` used in the live registry
 * (see service.ts). Every field is optional; an empty/absent entry means "no
 * opinion" → prior unchanged. Kept as plain data so the table is scannable and
 * a new rule is a one-line edit, not new control flow.
 */
interface FitRule {
  /** Question-intents this handler genuinely serves (boost when matched). */
  readonly boostIntents?: readonly QuestionIntent[];
  /** Question-intents that belong to a different lane (suppress when matched). */
  readonly suppressIntents?: readonly QuestionIntent[];
  /** Turn-shapes this handler serves (boost when matched). */
  readonly boostClasses?: readonly TurnClass[];
  /** Turn-shapes that belong to a different lane (suppress when matched). */
  readonly suppressClasses?: readonly TurnClass[];
  /** Classifier signals (from `classification.signals`) that boost this handler. */
  readonly boostSignals?: readonly string[];
}

/**
 * The fit table. Conservative on purpose: a handler only moves off its prior
 * when a signal clearly applies. Grounded in the existing handler set and the
 * documented response-weakness failure classes.
 */
const FIT_TABLE: Readonly<Record<string, FitRule>> = {
  // Quick single-fact answers belong to lookups/definitions. They must NOT grab
  // build asks, recommendation asks, or product-quality direction (the "Norway
  // business idea → country-fact card" class). Suppress those so a reasoning /
  // product / builder handler overtakes even though fact-shim's prior is high.
  'chat-fact-shim': {
    boostIntents: ['factual-lookup', 'definition'],
    suppressIntents: ['build', 'recommendation'],
    suppressClasses: ['product-quality-recommendation', 'vai-chat-quality-direction'],
  },

  // Open-ended turns that need step-by-step reasoning. Boost on yes/no-action
  // ("does X do Y?") and on the catch-all `other` shape that has no crisp fact
  // anchor — exactly the turns a single-fact shim handles badly.
  'conversation-reasoning': {
    boostIntents: ['action-yesno', 'other'],
  },

  // Grounded answers about Vai itself. Boost on the self-improvement / chat-quality
  // direction shapes and the self-improvement signal so "tell me about your engine"
  // and "make your council answers better" stay on the identity/self lane.
  'chat-vai-identity': {
    boostClasses: ['product-quality-recommendation', 'vai-chat-quality-direction'],
    boostSignals: ['self-improvement'],
  },

  // Structured product-engineering memo + product-quality recommendation lane.
  'chat-product-engineering': {
    boostClasses: ['product-quality-recommendation'],
  },

  // Strict output-shape requests (table / JSON / list) and small grounded code
  // snippets serve build + specificity-flavored asks. Boost those; the strict
  // shape itself is still gated upstream by `applicable`.
  'chat-format-strict': {
    boostIntents: ['build'],
    boostSignals: ['specificity-hint'],
  },
  'chat-constrained-code': {
    boostIntents: ['build'],
    boostSignals: ['specificity-hint'],
  },
};

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Adjust a handler's constant prior into an intent-aware fit.
 *
 * @param handler  Registry handler name (the key into the fit table).
 * @param prior    The handler's constant base priority (0..1).
 * @param ctx      The classified turn — its question-intent and shape/signals.
 * @returns `{ score, reason? }` where `score` is the adjusted 0..1 fit. `reason`
 *          is set only when an adjustment fired, so the visible {@link
 *          ./turn-pipeline.ts} plan can show *why* the score moved; absent when
 *          the prior was returned unchanged.
 *
 * Precedence is intentionally conservative: a SUPPRESSION always wins over a
 * boost. If a turn somehow matches both (it shouldn't, given the table), we err
 * toward NOT letting an off-lane handler answer.
 */
export function intentFit(
  handler: string,
  prior: number,
  ctx: { readonly intent: QuestionIntent; readonly classification: TurnClassification },
): { score: number; reason?: string } {
  const base = clamp01(prior);
  const rule = FIT_TABLE[handler];
  if (!rule) return { score: base };

  const { intent, classification } = ctx;
  const kind = classification.kind;
  const signals = classification.signals;

  // ── Suppression (off-lane) — checked first, wins over any boost ──────────
  const suppressIntent = rule.suppressIntents?.includes(intent) ?? false;
  const suppressClass = rule.suppressClasses?.includes(kind) ?? false;
  if (suppressIntent || suppressClass) {
    const why = suppressIntent ? `intent=${intent}` : `turn=${kind}`;
    return { score: clamp01(base * SUPPRESS_MULTIPLIER), reason: `off-lane (${why})` };
  }

  // ── Boost (on-lane) — bounded addend ─────────────────────────────────────
  const boostIntent = rule.boostIntents?.includes(intent) ?? false;
  const boostClass = rule.boostClasses?.includes(kind) ?? false;
  const boostSignal = rule.boostSignals?.some((s) => signals.includes(s)) ?? false;
  if (boostIntent || boostClass || boostSignal) {
    const why = boostIntent
      ? `intent=${intent}`
      : boostClass
        ? `turn=${kind}`
        : `signal=${rule.boostSignals?.find((s) => signals.includes(s))}`;
    return { score: clamp01(base + BOOST_ADDEND), reason: `on-lane (${why})` };
  }

  // No rule fired — prior unchanged (regression-safety default).
  return { score: base };
}

/** Test/inspection hook: handler names that carry a fit rule. */
export function mappedHandlers(): readonly string[] {
  return Object.keys(FIT_TABLE);
}
