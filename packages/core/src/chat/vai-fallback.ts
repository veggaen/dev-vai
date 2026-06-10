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
  "I don't have a confident answer for",
  "I don't yet hold",
  "isn't in my knowledge yet",
  "Stay on **",
  "or pivot fully",
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

/**
 * Structural decline detector (Master.md §8 — avoid the Template-Matcher).
 *
 * The verbatim marker list above is a fast path, but it silently fails to
 * escalate when the engine declines with *new* wording. These patterns match
 * the decline *shape* — a first-person negation in close proximity to a
 * knowledge/answer noun — so escalation generalizes to phrasings we never
 * hard-coded. Kept deliberately conservative (negation + knowledge token, or
 * an explicit "still learning"/"not in my knowledge" idiom) to avoid
 * escalating genuine answers that merely contain the word "know".
 */
export const DECLINE_SHAPE_PATTERNS: readonly RegExp[] = [
  /\b(?:i\s+(?:don['’]?t|do\s+not|can['’]?t|cannot|am\s+not)|i['’]?m\s+not|isn['’]?t|is\s+not|not\s+yet)\b[^.?!]{0,40}\b(?:know|knowledge|answer|hold|aware|familiar|information|details?|data\s+on)\b/i,
  /\bstill\s+learning\b/i,
  /\bnot\s+in\s+my\s+knowledge\b/i,
  /\b(?:outside|beyond)\s+(?:my|its)\s+(?:knowledge|competence|expertise)\b/i,
  /\bdon['’]?t\s+(?:yet\s+)?(?:have|hold)\b[^.?!]{0,30}\b(?:answer|knowledge|information|take)\b/i,
  // Real-engine decline idioms surfaced by the live escalation trace: the
  // deterministic core deflects a chat question into a "not enough grounding /
  // give me a stack and I'll scaffold" builder ask. That is a decline, not an
  // answer, and must escalate.
  /\bnot\s+enough\s+(?:grounding|context|signal|to\s+go\s+on)\b/i,
  /\bcan['’]?t\s+(?:build|work|reason)\b[^.?!]{0,30}\b(?:yet|grounding|context|on\s+that|around\s+that)\b/i,
];

/** True when `text` matches a decline by explicit marker OR structural shape. */
export function looksLikeDecline(text: string, extraMarkers?: readonly string[]): boolean {
  if (!text) return false;
  if (containsNoKnowledgeMarker(text)) return true;
  if (extraMarkers?.some((m) => m && text.includes(m))) return true;
  return DECLINE_SHAPE_PATTERNS.some((re) => re.test(text));
}

/**
 * Decline-escalation guard for the *deterministic dispatch* stage.
 *
 * A deterministic handler can win the dispatch with an answer that is itself a
 * non-answer — e.g. "X isn't in my knowledge yet" — at a confidence above the
 * floor. Emitting that short-circuits the generative model path, so the turn
 * never reaches a backend that could actually answer. This returns true when
 * such a win should instead yield to escalation: the winning text is
 * decline-shaped AND a generative fallback target is actually reachable.
 *
 * The `hasGenerativeFallback` gate keeps the terminal safety net intact — when
 * no backend is configured (the local/keyless default), a decline-shaped
 * deterministic answer is still the best available reply and must be emitted.
 */
export function shouldEscalateDeterministicDecline(
  winnerText: string,
  hasGenerativeFallback: boolean,
  extraDeclineMarkers?: readonly string[],
): boolean {
  if (!hasGenerativeFallback) return false;
  return looksLikeDecline(winnerText, extraDeclineMarkers);
}


/**
 * Distinctive named subjects of a prompt: capitalized proper nouns (`Flimsy`,
 * `Quibblr`, `France`) or digit-bearing identifiers (`Zorblax-7`, `gpt-4`).
 * Deliberately EXCLUDES generic all-caps acronyms (`ORM`, `TCP`, `CAP`) and
 * lowercase common words — those are not the *subject* the user is asking about.
 * Case-independent on the answer side: we lowercase for the membership test, so
 * an engine that lowercases its output cannot evade the check.
 */
export function extractDistinctiveSubjects(text: string): string[] {
  if (!text) return [];
  const tokens = text.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? [];
  const out = new Set<string>();
  for (const raw of tokens) {
    const hasDigit = /[0-9]/.test(raw);
    const isCapitalizedWord = /^[A-Z][a-z]+/.test(raw); // Flimsy, Quibblr, France — not ORM/TCP
    if (hasDigit || isCapitalizedWord) out.add(raw.toLowerCase());
  }
  return [...out];
}

const TOPIC_MISMATCH_MIN_WORDS = 25;

/**
 * Article-hijack / Confident-Bullshitter detector (Master.md §8). When the user
 * names a distinctive subject and a substantive answer mentions *none* of those
 * subjects, the engine answered a different question — a confident-wrong leak
 * that must escalate. Conservative: it only fires on long answers (≥25 words)
 * with zero distinctive-subject overlap, so genuine answers (which name the
 * subject) and short pronoun replies are never flagged. Case-independent, so it
 * is robust to the engine lowercasing its output (a real regression caught in
 * live dogfood when the prior version leaned on the answer's capitalization).
 */
export function detectAnswerTopicMismatch(prompt: string | undefined, response: string): boolean {
  if (!prompt || !response) return false;
  const wordCount = response.trim().split(/\s+/).length;
  if (wordCount < TOPIC_MISMATCH_MIN_WORDS) return false;

  const subjects = extractDistinctiveSubjects(prompt);
  if (subjects.length === 0) return false;

  const responseLower = response.toLowerCase();
  return !subjects.some((subject) => responseLower.includes(subject));
}

export interface VaiFallbackDecisionInput {
  /** Full assistant text that vai:v0 produced (after stream completes). */
  readonly text: string;
  /** Confidence emitted on the most recent `sources` chunk, if any. */
  readonly confidence?: number;
  /** Optional override threshold — defaults to `VAI_FALLBACK_CONFIDENCE_THRESHOLD`. */
  readonly threshold?: number;
  /** Operator-supplied extra decline markers (configurable, e.g. localized phrasings). */
  readonly extraDeclineMarkers?: readonly string[];
  /** Original user prompt — enables the article-hijack / topical-mismatch check. */
  readonly prompt?: string;
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
  if (looksLikeDecline(text, input.extraDeclineMarkers)) {
    return { shouldFallback: true, reason: 'no-knowledge' };
  }
  if (detectAnswerTopicMismatch(input.prompt, text)) {
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
