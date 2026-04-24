/**
 * Vai → external LLM fallback decision logic.
 *
 * When a `vai:v0` turn finishes with one of the canonical "I don't know"
 * fallback responses, OR the source-confidence signal it emitted is below
 * the configured threshold, the chat service transparently re-dispatches
 * the same conversation history to the first available external provider.
 *
 * This module contains the *pure* decision functions so they can be tested
 * without a live engine.
 */

/** Default confidence floor below which we promote vai:v0 → external. */
export const VAI_FALLBACK_CONFIDENCE_THRESHOLD = 0.4;

/**
 * Canonical no-answer phrases the vai:v0 fallback strategy emits verbatim.
 *
 * When the primary engine returns any of these (usually because the knowledge
 * store matched the greeting bootstrap entry or returned the stock "still
 * learning" placeholder), we treat the response as "no knowledge" and hand
 * the turn off to an external fallback model when one is configured.
 */
const NO_KNOWLEDGE_MARKERS: readonly string[] = [
  "I don't have a solid answer for",
  "I don't know about",
  "Not in my knowledge base yet",
  // The bootstrap greeting often collides with factual questions that happen
  // to start with "hello," so we treat the stock greeting as a no-answer too.
  'I am still learning, but I will do my best',
  'Jeg laerer fortsatt, men jeg skal gjore mitt beste',
  'I do not know.',
  "I don't know.",
];

export interface VaiFallbackDecisionInput {
  /** Full assistant text that vai:v0 produced (after stream completes). */
  readonly text: string;
  /** Confidence emitted on the most recent `sources` chunk, if any. */
  readonly confidence?: number;
  /** Optional override threshold — defaults to `VAI_FALLBACK_CONFIDENCE_THRESHOLD`. */
  readonly threshold?: number;
}

export interface VaiFallbackDecision {
  readonly shouldFallback: boolean;
  readonly reason: 'low-confidence' | 'no-knowledge' | null;
}

export interface FallbackRoutingContext {
  /** Current user text that triggered the fallback evaluation. */
  readonly content?: string;
  /** Conversation mode, when available. */
  readonly mode?: string;
}

/**
 * Decide whether the vai:v0 response is weak enough to promote to an
 * external LLM. Pure: depends only on the response text + confidence number.
 */
export function decideVaiFallback(input: VaiFallbackDecisionInput): VaiFallbackDecision {
  const text = input.text ?? '';
  if (containsNoKnowledgeMarker(text)) {
    return { shouldFallback: true, reason: 'no-knowledge' };
  }
  const threshold = input.threshold ?? VAI_FALLBACK_CONFIDENCE_THRESHOLD;
  if (typeof input.confidence === 'number' && input.confidence < threshold) {
    return { shouldFallback: true, reason: 'low-confidence' };
  }
  return { shouldFallback: false, reason: null };
}

function containsNoKnowledgeMarker(text: string): boolean {
  if (!text) return false;
  for (const marker of NO_KNOWLEDGE_MARKERS) {
    if (text.includes(marker)) return true;
  }
  return false;
}

/**
 * Pick the first registered model id from `chain` that is *not* `vai:v0`
 * and is currently available via `tryGet`. Returns `null` when no external
 * provider is reachable, in which case the caller must keep the original
 * vai:v0 response.
 */
export function pickFallbackModelId(
  chain: readonly string[] | undefined,
  isAvailable: (modelId: string) => boolean,
  context?: FallbackRoutingContext,
): string | null {
  const available = (chain ?? []).filter((id) => id !== 'vai:v0' && isAvailable(id));
  if (available.length === 0) return null;

  if (looksLikeCodingTurn(context)) {
    const codex = available.find((id) => /\bcodex\b/i.test(id));
    if (codex) return codex;
  }

  return available[0] ?? null;
}

function looksLikeCodingTurn(context: FallbackRoutingContext | undefined): boolean {
  if (!context) return false;
  const mode = context.mode?.toLowerCase();
  if (mode === 'builder' || mode === 'agent') return true;

  const text = context.content?.toLowerCase() ?? '';
  if (text.length === 0) return false;

  return /```|`[^`]+`|\b(code|coding|bug|debug|fix|refactor|implement|function|class|component|typescript|javascript|ts|tsx|react|nextjs|node|api|sql|query|test|stack trace|compile|runtime)\b/i.test(text);
}
