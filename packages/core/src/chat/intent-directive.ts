import type { QuestionIntent } from './question-intent.js';

/**
 * Intent-directed escalation directive (Slice 3).
 *
 * When no deterministic handler clears the confidence floor, the turn escalates
 * to the model. Historically it went to the model with no shape guidance, so a
 * recommendation ask could come back as generic prose or fact-shim-flavored
 * filler. This composes a small, additive system directive that tells the model
 * the CLASSIFIED intent and the shape expected for it — so the escalation lands
 * on-intent instead of drifting.
 *
 * Pure: `(intent) → directive string | null`. Returns `null` for `'other'`
 * (and `'meta'`), because when even the scorer couldn't name a shape we do NOT
 * fabricate one — the honest choice is to add no directive and let the model
 * answer conversationally. This is the documented `intent === 'other'` behavior.
 */

/** Per-intent shape guidance. Absent intents (`other`, `meta`) get no directive. */
const INTENT_SHAPE: Partial<Record<QuestionIntent, string>> = {
  recommendation:
    'a recommendation: give a specific suggested choice (or a short ranked shortlist) '
    + 'with the one or two reasons that decide it. Do not answer with a neutral definition or a generic overview.',
  'factual-lookup':
    'a factual lookup: lead with the direct answer in the first sentence, then at most a line of context. '
    + 'Do not pad with background before the fact.',
  definition:
    'a definition/explanation: define the thing plainly first, then add just enough detail to make it usable. '
    + 'Do not turn it into a recommendation or a build.',
  build:
    'a build request: produce the concrete artifact (code / steps / structure) asked for, grounded and runnable. '
    + 'Do not answer with prose about the topic instead of building it.',
  'action-yesno':
    'a yes/no question about whether something does X: answer yes or no first, then the one fact that settles it. '
    + 'Do not evade with a general description.',
};

/**
 * Compose the intent-shaped directive for a below-floor escalation.
 *
 * @param intent The classified {@link QuestionIntent} for the turn.
 * @returns A system directive string, or `null` when no shape should be forced
 *          (`other` / `meta`, or any unmapped intent).
 */
export function composeIntentDirective(intent: QuestionIntent): string | null {
  const shape = INTENT_SHAPE[intent];
  if (!shape) return null;
  return `The user's request was classified as ${shape} Stay in that shape; do not fall back to generic prose or a canned fact card.`;
}

/**
 * Human-readable reason for the streamed route plan explaining WHY the turn
 * escalated below the floor and what intent shape (if any) was injected. Pure.
 */
export function belowFloorReason(intent: QuestionIntent, directiveApplied: boolean): string {
  const base = `no handler cleared the confidence floor for intent: ${intent}`;
  return directiveApplied
    ? `${base} — escalated to the model with an intent-shaped directive`
    : `${base} — escalated to the model (no shape forced)`;
}
