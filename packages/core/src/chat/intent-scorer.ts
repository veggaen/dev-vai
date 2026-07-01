import type { QuestionIntent } from './question-intent.js';
import {
  extractLexicalTokens,
  salientLexicalTokens,
  REQUEST_START_WORDS,
} from './intent-lexicon.js';

/**
 * Lexical-feature intent scorer — the second-opinion classifier.
 *
 * {@link ./question-intent.ts}'s `classifyQuestionIntent` is a small, high-precision
 * regex cascade. It is deliberately conservative: anything that doesn't match a
 * crisp pattern returns `'other'`. That is safe, but `'other'` is exactly the
 * bucket where wrong-lane answers happen — a turn with a real intent that the
 * regexes simply didn't shape-match falls through with no signal for
 * {@link ./intent-fit.ts} to act on.
 *
 * This module adds a bounded, feature-based scorer that produces a *ranked
 * confidence distribution* over the intents. It never overrides a confident
 * regex verdict; the caller ({@link ./question-intent.ts#classifyQuestionIntentSmart})
 * only consults it when the regex path already returned `'other'`, and only
 * adopts the top guess when it clears a confidence margin. So the regex behavior
 * is preserved byte-for-byte on every turn it had an opinion about — this only
 * ever *shrinks the `'other'` bucket*, never reshapes an existing decision.
 *
 * Pure: no I/O, no state. The features are additive weighted votes, so a new
 * signal is a one-line table edit, and the whole thing is trivially testable.
 */

/** A single scored intent guess. */
export interface IntentScore {
  readonly intent: QuestionIntent;
  /** 0..1 confidence, normalized across the distribution. */
  readonly score: number;
  /** Human-readable features that fired for this intent (auditable trail). */
  readonly features: readonly string[];
}

/** The full ranked result. `top` is `distribution[0]` for convenience. */
export interface IntentScoreResult {
  readonly top: IntentScore;
  readonly distribution: readonly IntentScore[];
  /**
   * The confidence GAP between the top and runner-up (0..1). A large margin
   * means the scorer is decisive; a small one means the turn is genuinely
   * ambiguous and the caller should stay with `'other'`.
   */
  readonly margin: number;
}

// ── Feature weights ──────────────────────────────────────────────────────────
// Each feature contributes a weighted vote to one or more intents. Weights are
// small integers so the table stays readable; the raw sums are softmax-free
// normalized (divide by total) at the end, so only RELATIVE weight matters.

interface Feature {
  readonly id: string;
  readonly test: (ctx: FeatureContext) => boolean;
  /** Partial map of intent → vote weight. Absent intents get 0. */
  readonly votes: Partial<Record<QuestionIntent, number>>;
}

interface FeatureContext {
  readonly text: string;
  readonly lower: string;
  readonly tokens: readonly string[];
  readonly salient: readonly string[];
  readonly firstToken: string;
  readonly wordCount: number;
}

// Recommendation vocabulary — asks for a suggested choice among options.
const RECOMMEND_WORDS = new Set([
  'recommend', 'recommendation', 'recommendations', 'suggest', 'suggestion',
  'suggestions', 'advice', 'advise', 'should', 'best', 'better', 'ideas',
  'idea', 'options', 'worth', 'prefer', 'pick', 'choose', 'choice',
]);
// Definition vocabulary — asks to be told what/who something is.
const DEFINITION_WORDS = new Set([
  'explain', 'define', 'definition', 'describe', 'overview', 'meaning',
  'means', 'understand', 'concept', 'basics', 'introduction', 'intro',
]);
// Build vocabulary — asks to produce an artifact.
const BUILD_WORDS = new Set([
  'build', 'create', 'make', 'generate', 'scaffold', 'implement', 'code',
  'develop', 'write', 'add', 'wire', 'set', 'setup', 'prototype', 'ship',
]);
// Artifact nouns that turn a build verb from generic ("make dinner") into a
// software build ("make a component").
const ARTIFACT_WORDS = new Set([
  'app', 'application', 'api', 'site', 'website', 'page', 'dashboard', 'tool',
  'component', 'service', 'server', 'cli', 'game', 'clone', 'landing', 'store',
  'bot', 'script', 'function', 'widget', 'form', 'endpoint', 'module', 'class',
  'feature', 'button', 'modal', 'form', 'hook', 'route', 'schema',
]);
// A concrete factual anchor — the same class question-intent's FACTUAL_ANCHOR_RE
// covers, restated as tokens so the scorer agrees with the regex on the turns it
// DOES reach here.
const FACTUAL_ANCHOR_WORDS = new Set([
  'capital', 'currency', 'population', 'invented', 'inventor', 'founded',
  'located', 'tallest', 'largest', 'biggest', 'smallest', 'highest',
  'longest', 'oldest', 'distance', 'height', 'weight', 'area',
]);

const YESNO_AUX = new Set([
  'does', 'do', 'did', 'can', 'could', 'will', 'would', 'is', 'are', 'was',
  'were', 'has', 'have', 'had', 'should', 'shall', 'may', 'might', 'am',
]);
const WH_WORDS = new Set(['what', 'which', 'who', 'when', 'where']);

function has(set: ReadonlySet<string>, tokens: readonly string[]): boolean {
  for (const t of tokens) if (set.has(t)) return true;
  return false;
}

const FEATURES: readonly Feature[] = [
  {
    id: 'wh-opener',
    test: (c) => WH_WORDS.has(c.firstToken),
    votes: { 'factual-lookup': 2, definition: 1 },
  },
  {
    id: 'factual-anchor',
    test: (c) => has(FACTUAL_ANCHOR_WORDS, c.tokens),
    votes: { 'factual-lookup': 4 },
  },
  {
    id: 'how-many/much',
    test: (c) => /^how\s+(?:many|much|tall|big|old|far|long|fast|deep|wide|high)\b/.test(c.lower),
    votes: { 'factual-lookup': 4 },
  },
  {
    id: 'definition-verb',
    test: (c) => has(DEFINITION_WORDS, c.tokens),
    votes: { definition: 4 },
  },
  {
    id: 'what-is-opener',
    test: (c) => /^(?:what|who)(?:'?s|\s+(?:is|are|was|were))\b/.test(c.lower),
    votes: { definition: 3, 'factual-lookup': 1 },
  },
  {
    id: 'recommend-vocab',
    test: (c) => has(RECOMMEND_WORDS, c.tokens),
    votes: { recommendation: 4 },
  },
  {
    id: 'good-X-in-place',
    test: (c) => /\b(?:good|best|top|great|recommended)\b[\s\S]{0,40}\b(?:in|near|around|for)\b/.test(c.lower),
    votes: { recommendation: 3 },
  },
  {
    id: 'build-verb',
    test: (c) => has(BUILD_WORDS, c.tokens) && REQUEST_START_WORDS.has(c.firstToken),
    votes: { build: 3 },
  },
  {
    id: 'build-verb+artifact',
    test: (c) => has(BUILD_WORDS, c.tokens) && has(ARTIFACT_WORDS, c.tokens),
    votes: { build: 4 },
  },
  {
    // Imperative build phrasings the single-verb set misses ("spin up a …",
    // "put together a …", "set up a …", "stand up a …").
    id: 'build-phrase',
    test: (c) => /^(?:spin\s+up|put\s+together|set\s+up|stand\s+up|throw\s+together|whip\s+up|hook\s+up)\b/.test(c.lower),
    votes: { build: 4 },
  },
  {
    // "I need a <artifact> that …" — a build ask stated as a need, not an
    // imperative. Suppressed when recommendation vocab is present, so "I want the
    // BEST WAY to cache api responses" stays a recommendation, not a build.
    id: 'need-artifact',
    test: (c) =>
      /\b(?:need|want)\s+(?:a|an|the|some)\b/.test(c.lower)
      && has(ARTIFACT_WORDS, c.tokens)
      && !has(RECOMMEND_WORDS, c.tokens),
    votes: { build: 3 },
  },
  {
    // Explain-paraphrase openers that DEFINITION_WORDS (single tokens) miss:
    // "talk me through …", "walk me through …", "break down …", "give me the gist …".
    id: 'explain-paraphrase',
    test: (c) =>
      /\b(?:talk|walk)\s+me\s+through\b/.test(c.lower)
      || /\bbreak\s+(?:it\s+)?down\b/.test(c.lower)
      || /\b(?:the\s+)?gist\s+of\b/.test(c.lower),
    votes: { definition: 4 },
  },
  {
    // Softened factual magnitude asks ("roughly how tall …", "about how many …")
    // that the anchored `how-many/much` opener misses because of the lead-in word.
    id: 'soft-factual-magnitude',
    test: (c) => /\b(?:roughly|about|approximately|around)\s+how\s+(?:many|much|tall|big|old|far|long|fast|deep|wide|high)\b/.test(c.lower),
    votes: { 'factual-lookup': 4 },
  },
  {
    id: 'yesno-action',
    test: (c) =>
      YESNO_AUX.has(c.firstToken)
      && c.firstToken !== 'is' && c.firstToken !== 'are'
      && !/^(?:does|do|did|can|could|will|would|is|are|was|were|has|have|had|should|shall|may|might|am)\s+(?:you|we)\b/.test(c.lower),
    votes: { 'action-yesno': 3 },
  },
  {
    id: 'copular-is-are',
    test: (c) => (c.firstToken === 'is' || c.firstToken === 'are'),
    votes: { 'action-yesno': 1, definition: 1 },
  },
];

const ALL_INTENTS: readonly QuestionIntent[] = [
  'action-yesno', 'definition', 'factual-lookup', 'recommendation', 'build', 'other',
];

/**
 * Score a turn's likely intent from lexical features.
 *
 * Always returns a full ranked distribution (every intent present, summing to 1).
 * When NO feature fires, all weight collapses onto `'other'` with margin 0 — the
 * honest "I have no lexical opinion" answer, which the caller treats as "keep the
 * regex's `'other'`".
 */
export function scoreQuestionIntent(rawInput: string): IntentScoreResult {
  const text = (rawInput || '').trim();
  const lower = text.toLowerCase();
  const tokens = extractLexicalTokens(text);
  const salient = salientLexicalTokens(text);
  const firstToken = tokens[0] ?? '';
  const wordCount = tokens.length;

  const ctx: FeatureContext = { text, lower, tokens, salient, firstToken, wordCount };

  const raw = new Map<QuestionIntent, number>();
  const featuresByIntent = new Map<QuestionIntent, string[]>();
  for (const intent of ALL_INTENTS) {
    raw.set(intent, 0);
    featuresByIntent.set(intent, []);
  }

  for (const feature of FEATURES) {
    if (!feature.test(ctx)) continue;
    for (const [intent, weight] of Object.entries(feature.votes) as [QuestionIntent, number][]) {
      raw.set(intent, (raw.get(intent) ?? 0) + weight);
      featuresByIntent.get(intent)!.push(feature.id);
    }
  }

  const total = [...raw.values()].reduce((a, b) => a + b, 0);
  // No feature fired → all mass on `'other'`. This is the "no opinion" default.
  if (total === 0) {
    const distribution: IntentScore[] = ALL_INTENTS.map((intent) => ({
      intent,
      score: intent === 'other' ? 1 : 0,
      features: [],
    }));
    return { top: distribution.find((d) => d.intent === 'other')!, distribution, margin: 0 };
  }

  const distribution: IntentScore[] = ALL_INTENTS.map((intent) => ({
    intent,
    score: (raw.get(intent) ?? 0) / total,
    features: featuresByIntent.get(intent) ?? [],
  }))
    .filter((d) => d.score > 0 || d.intent === 'other')
    .sort((a, b) => b.score - a.score);

  const top = distribution[0];
  const runnerUp = distribution[1];
  const margin = top.score - (runnerUp?.score ?? 0);
  return { top, distribution, margin };
}

/**
 * A single fired feature and the votes it contributed — the raw evidence behind
 * a score, for live re-judging and lexicon tuning.
 */
export interface FiredFeature {
  readonly id: string;
  readonly votes: Partial<Record<QuestionIntent, number>>;
}

/**
 * Debug companion to {@link scoreQuestionIntent}: returns the result PLUS the
 * exact features that fired (in table order) and the raw vote total. Useful when
 * inspecting why a turn scored the way it did during live re-judge / when tuning
 * feature weights against the labeled probe set. Not on the hot path.
 */
export function debugScoreQuestionIntent(rawInput: string): IntentScoreResult & {
  readonly fired: readonly FiredFeature[];
  readonly rawTotal: number;
} {
  const text = (rawInput || '').trim();
  const lower = text.toLowerCase();
  const tokens = extractLexicalTokens(text);
  const salient = salientLexicalTokens(text);
  const ctx: FeatureContext = {
    text, lower, tokens, salient, firstToken: tokens[0] ?? '', wordCount: tokens.length,
  };
  const fired = FEATURES.filter((f) => f.test(ctx)).map((f) => ({ id: f.id, votes: f.votes }));
  const rawTotal = fired.reduce(
    (sum, f) => sum + Object.values(f.votes).reduce((a, b) => a + (b ?? 0), 0),
    0,
  );
  return { ...scoreQuestionIntent(rawInput), fired, rawTotal };
}
