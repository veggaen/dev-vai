/**
 * Council loop stagnation detection — the "any repeat is bad, the pattern might be stuck" rule.
 *
 * The redraft loop can fail in a scale-invariant way that no per-query guard catches: Vai keeps
 * producing the SAME answer round after round, the council keeps rejecting it, and the loop either
 * ships the repeat or spins. This module turns that into a measurable, enforced signal:
 *
 *   - a draft's SIGNATURE (normalized shingle set) lets us compare rounds semantically, not by exact
 *     string — "There are 2 shops." vs "There are 2 shops!" are the same attempt;
 *   - `isStagnant` fires when a redraft is ~the same as a prior attempt (Jaccard ≥ threshold);
 *   - `escalationForStuck` names the NEXT strategy to break the loop, based on WHY it's stuck
 *     (no evidence yet → force search; evidence present but ignored → force grounded rewrite;
 *     genuinely ambiguous → ask one clarifying question). Escalating beats shipping the repeat.
 *
 * Pure and dependency-free so it unit-tests without the loop, a DOM, or live models.
 */

export interface DraftSignature {
  /** Normalized shingles (word bigrams) — order-insensitive enough to catch reworded repeats. */
  readonly shingles: ReadonlySet<string>;
  /** Length in words, for a cheap "did it even change size" pre-check. */
  readonly words: number;
}

/**
 * Normalize text for comparison: lowercase, strip markdown fences/punctuation, collapse whitespace.
 * Code-fence CONTENT is kept (only the ``` markers and language tag are removed) so that a redraft
 * whose new material is code still registers as novel — while two identical scaffolds still match on
 * their shared code tokens. (Dropping fence content entirely made "kept prose + appended app" look
 * like a no-op repeat, which wrongly blocked legitimate multi-intent redrafts.)
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/```[a-z0-9]*\n?/gi, ' ') // strip the fence markers + lang tag, keep the code inside
    .replace(/[*_`#>|~-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function signature(text: string): DraftSignature {
  const words = normalize(text).split(' ').filter(Boolean);
  const shingles = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    shingles.add(`${words[i]} ${words[i + 1]}`);
  }
  // Very short texts have no bigrams; fall back to the single words so they still compare.
  if (shingles.size === 0) for (const w of words) shingles.add(w);
  return { shingles, words: words.length };
}

/** Jaccard similarity of two signatures' shingle sets, 0..1. */
export function similarity(a: DraftSignature, b: DraftSignature): number {
  if (a.shingles.size === 0 && b.shingles.size === 0) return 1;
  let inter = 0;
  for (const s of a.shingles) if (b.shingles.has(s)) inter++;
  const union = a.shingles.size + b.shingles.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Fraction of the CANDIDATE's shingles that are NEW (absent from a prior attempt). This is the
 * "did the redraft actually add anything" signal, and it is what distinguishes real progress from a
 * stuck loop: a multi-intent redraft that keeps the correct first part and APPENDS a new deliverable
 * shares most shingles with the original (low Jaccard novelty by union) yet introduces a lot of new
 * content — so it is progress, not a repeat. A reworded repeat introduces almost nothing new.
 */
export function novelty(candidate: DraftSignature, prior: DraftSignature): number {
  if (candidate.shingles.size === 0) return 0;
  let fresh = 0;
  for (const s of candidate.shingles) if (!prior.shingles.has(s)) fresh++;
  return fresh / candidate.shingles.size;
}

/** Default similarity at/above which a new draft counts as "the same attempt". */
export const STAGNATION_THRESHOLD = 0.82;
/**
 * Minimum fraction of NEW shingles a redraft must introduce to count as progress. Below this, even a
 * longer draft is treated as a repeat (it padded without changing the substance). Tuned so appending
 * a real second deliverable clears it while a reworded repeat does not.
 */
export const MIN_NOVELTY = 0.2;

/**
 * Is `candidate` a stagnant repeat of any prior attempt? Two independent ways to be stuck:
 *  - high overlap by Jaccard (a straight reworded repeat), OR
 *  - the candidate introduces almost no NEW content vs. a prior draft (padded/kept-same),
 * checked against EVERY previous round so an A→B→A oscillation is still caught. A redraft that adds
 * substantial new material (e.g. a dropped deliverable) is progress and passes.
 */
export function isStagnant(
  candidate: string,
  priorAttempts: readonly string[],
  threshold = STAGNATION_THRESHOLD,
): boolean {
  if (priorAttempts.length === 0) return false;
  const sig = signature(candidate);
  return priorAttempts.some((priorText) => {
    const prior = signature(priorText);
    // Adding substantial new content vs. this prior draft is progress, never stagnation.
    if (novelty(sig, prior) >= MIN_NOVELTY) return false;
    // Otherwise: stuck if it's a near-duplicate by overlap, or it introduced almost nothing new.
    return similarity(sig, prior) >= threshold || novelty(sig, prior) < MIN_NOVELTY;
  });
}

export type StuckEscalation =
  | { kind: 'force-search'; reason: string }
  | { kind: 'force-grounded-rewrite'; reason: string }
  | { kind: 'ask-clarifying'; reason: string }
  | { kind: 'accept-best'; reason: string };

/**
 * Given a stuck loop, choose the NEXT move to break it — the escalation ladder. Ordered by leverage:
 *  1. No evidence gathered yet AND the ask needs external facts → force a web/business search.
 *  2. Evidence WAS gathered but the repeat ignored it → force a grounded rewrite that must cite it.
 *  3. The ask is genuinely ambiguous → ask ONE clarifying question instead of guessing again.
 *  4. Nothing left to try → accept the best-so-far honestly (never ship a silent repeat).
 */
export function escalationForStuck(params: {
  readonly hasEvidence: boolean;
  readonly needsExternalFacts: boolean;
  readonly isAmbiguous: boolean;
  readonly searchAlreadyTried: boolean;
}): StuckEscalation {
  const { hasEvidence, needsExternalFacts, isAmbiguous, searchAlreadyTried } = params;
  if (needsExternalFacts && !hasEvidence && !searchAlreadyTried) {
    return { kind: 'force-search', reason: 'Repeated draft with no evidence for a fact-seeking ask — searching before answering.' };
  }
  if (hasEvidence) {
    return { kind: 'force-grounded-rewrite', reason: 'Draft repeated while ignoring gathered evidence — rewriting strictly from the evidence.' };
  }
  if (isAmbiguous) {
    return { kind: 'ask-clarifying', reason: 'Loop stuck on an ambiguous ask — asking one clarifying question instead of guessing again.' };
  }
  return { kind: 'accept-best', reason: 'No further escalation available — accepting best-so-far rather than looping.' };
}

/**
 * Cheap heuristic: does this prompt seek external/current facts (a count, contact, price, place,
 * "how many", a named business/place)? Used to decide whether a repeat should force a search. Kept
 * deliberately broad — false-positives just trigger a search that returns nothing and degrades to
 * the honest fallback, which is strictly better than shipping a confident repeat.
 */
export function promptNeedsExternalFacts(prompt: string): boolean {
  const p = prompt.toLowerCase();
  return /\b(number\s+of|how\s+many|count\s+of|phone|address|price|cost|open|hours|when|where|who\s+is|latest|current|today|nearest|contact|antall|hvor|når|pris|åpningstid)\b/.test(p)
    || /\b(restaurant|hotel|shop|store|butikk|pizzabakeren|cafe|kafe|business|company|firma|bedrift)\b/.test(p);
}
