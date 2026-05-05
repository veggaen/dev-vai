/**
 * CognitiveFoundationReasoner
 * ───────────────────────────
 * Deterministic, side-effect-free analysis of a user prompt that produces a
 * structured `CognitiveFrame` describing WHAT the user is asking before any
 * strategy tries to ANSWER it.
 *
 * Design goals:
 *  - **No theater.** Every signal is computed from explicit lexical/structural
 *    rules. Nothing pretends to be more than it is.
 *  - **Strategy-agnostic.** This module never produces an answer. It only
 *    produces metadata strategies and the UI can use.
 *  - **Cheap.** Pure regex + token work. Safe to call at the top of every
 *    `generateResponse()`.
 *  - **Composable.** The frame is plain data so it can be serialized into
 *    `ResponseMeta` for transparent debugging and benchmarks.
 *
 * The taxonomy is intentionally small. Adding kinds is fine — but the bar is
 * "a downstream strategy or evaluator will branch on this kind". We do not
 * add labels for their own sake.
 */

export type QuestionKind =
  | 'factual'        // "what is the capital of france", "who wrote 1984"
  | 'definitional'   // "what is docker", "define recursion"
  | 'procedural'     // "how do I install node on windows"
  | 'comparative'    // "react vs vue", "is X better than Y"
  | 'causal'         // "why does my docker build fail"
  | 'hypothetical'   // "what would happen if", "imagine that"
  | 'opinion'        // "do you think", "what's your favorite"
  | 'meta'           // "what model are you", "who built you"
  | 'conversational' // "hi", "thanks", "lol"
  | 'imperative'     // "build me a", "write a function that"
  | 'unknown';

export interface CognitiveFrame {
  /** Primary classification of the prompt. */
  readonly kind: QuestionKind;
  /** Confidence in the classification (0–1). 0 means default fallback was used. */
  readonly kindConfidence: number;
  /** True when the prompt asks more than one question / contains a hard "and". */
  readonly isCompound: boolean;
  /** Sub-questions if the prompt is compound; otherwise `[input]`. */
  readonly subQuestions: readonly string[];
  /** Lightweight noun-phrase / proper-noun candidates extracted from the prompt. */
  readonly entities: readonly string[];
  /** True when the prompt contains explicit format/length/style constraints. */
  readonly hasConstraints: boolean;
  /** Detected interrogative head ("what" | "how" | "why" | …) if present. */
  readonly interrogative?: string;
  /** Approximate token count of the input. */
  readonly tokenCount: number;
  /** Useful auxiliary signals that didn't earn their own field. */
  readonly signals: {
    readonly endsWithQuestionMark: boolean;
    readonly hasCodeFence: boolean;
    readonly hasNumberRange: boolean;
    readonly mentionsSelf: boolean; // "you", "your", "yourself"
  };
}

const INTERROGATIVES = ['what', 'who', 'where', 'when', 'why', 'how', 'which', 'whose', 'whom'] as const;

const META_RE = /\b(?:who\s+(?:are|made|built|created)\s+you|what\s+model|what\s+are\s+you|your\s+(?:name|creator|model|version)|which\s+(?:llm|model)|are\s+you\s+(?:gpt|claude|gemini|chatgpt|an?\s+ai))\b/i;
const CONVERSATIONAL_RE = /^(?:hi+|hey+|hello+|yo+|sup|thanks?|thx|ty|thank\s+you|lol|haha+|ok(?:ay)?|cool|nice|gm|gn|good\s+(?:morning|night|evening|afternoon))\b[!.?\s]*$/i;
const OPINION_RE = /\b(?:do\s+you\s+(?:think|believe|like|prefer)|what(?:'s|\s+is)\s+your\s+(?:favorite|opinion|take)|in\s+your\s+opinion)\b/i;
const HYPOTHETICAL_RE = /\b(?:what\s+would\s+happen|what\s+if|imagine\s+(?:that|if)|suppose\s+(?:that|you)|hypothetically|in\s+a\s+world\s+where)\b/i;
const COMPARATIVE_RE = /\b(?:vs\.?|versus|compared\s+to|difference\s+between|better\s+than|worse\s+than|prefer\s+\w+\s+(?:over|to))\b/i;
const CAUSAL_RE = /\b(?:why\s+(?:does|is|are|do|did|won['’]t|can['’]t)|what\s+causes|reason\s+(?:for|why)|because\s+of\s+what)\b/i;
const PROCEDURAL_RE = /\b(?:how\s+(?:do|can|should|would)\s+i|how\s+to|step[s]?\s+to|guide\s+me|walk\s+me\s+through|tutorial\s+(?:for|on))\b/i;
const DEFINITIONAL_RE = /\b(?:what\s+(?:is|are|does)\s+(?:an?\s+)?[a-z][\w-]+|define\s+\w+|meaning\s+of\s+\w+|explain\s+(?:what|the\s+concept))\b/i;
const IMPERATIVE_RE = /^(?:build|make|create|generate|write|draft|design|implement|refactor|fix|debug|translate|summarize|rewrite|convert)\b/i;
const CONSTRAINT_RE = /\b(?:in\s+\d+\s+(?:words?|sentences?|lines?|chars?|characters?)|exactly\s+\d+|no\s+more\s+than\s+\d+|at\s+(?:most|least)\s+\d+|reply\s+only|just\s+(?:say|reply|answer)|format\s+as|in\s+(?:json|xml|yaml|markdown|table|bullet\s+points?)|uppercase|lowercase|all\s+caps)\b/i;
const CODE_FENCE_RE = /```|~~~/;
const NUMBER_RANGE_RE = /\b\d+\s*[-–—to]+\s*\d+\b/;
const SELF_REF_RE = /\b(?:you|your|yourself|yours)\b/i;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from',
  'as', 'that', 'this', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me',
  'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'what', 'who', 'when',
  'where', 'why', 'how', 'which', 'about', 'so', 'if', 'then', 'than', 'just', 'will', 'would',
  'should', 'could', 'can', 'may', 'might', 'must',
]);

/**
 * Classify the prompt's primary kind. Highest-priority rule wins.
 * Confidence reflects how many independent signals supported the choice.
 */
export function classifyQuestion(input: string): { kind: QuestionKind; confidence: number } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { kind: 'unknown', confidence: 0 };

  if (CONVERSATIONAL_RE.test(trimmed)) return { kind: 'conversational', confidence: 0.95 };
  if (META_RE.test(trimmed)) return { kind: 'meta', confidence: 0.9 };
  if (HYPOTHETICAL_RE.test(trimmed)) return { kind: 'hypothetical', confidence: 0.85 };
  if (OPINION_RE.test(trimmed)) return { kind: 'opinion', confidence: 0.85 };
  if (COMPARATIVE_RE.test(trimmed)) return { kind: 'comparative', confidence: 0.85 };
  if (CAUSAL_RE.test(trimmed)) return { kind: 'causal', confidence: 0.8 };
  if (PROCEDURAL_RE.test(trimmed)) return { kind: 'procedural', confidence: 0.8 };
  if (IMPERATIVE_RE.test(trimmed)) return { kind: 'imperative', confidence: 0.8 };
  if (DEFINITIONAL_RE.test(trimmed)) return { kind: 'definitional', confidence: 0.75 };

  // Generic factual fallback when there's an interrogative head and a question mark.
  const head = firstInterrogative(trimmed);
  if (head !== undefined) {
    return { kind: 'factual', confidence: trimmed.endsWith('?') ? 0.7 : 0.55 };
  }

  return { kind: 'unknown', confidence: 0 };
}

/**
 * Split a prompt into sub-questions on hard conjunctions / multiple
 * question marks. Returns `[input]` when there's nothing to split.
 *
 * We are deliberately conservative: splitting is only done when the
 * boundary is clearly a question boundary, never on every "and".
 */
export function decomposeCompound(input: string): string[] {
  const trimmed = input.trim();
  if (trimmed.length === 0) return [];

  // Multiple question marks → split on them.
  const qmarkPieces = trimmed.split(/\?\s+/).map((p) => p.trim()).filter((p) => p.length > 0);
  if (qmarkPieces.length > 1) {
    return qmarkPieces.map((p) => (p.endsWith('?') ? p : `${p}?`));
  }

  // " and also " / " and then " / " ; then " — strong compound markers.
  const strongSplit = trimmed.split(/\s+(?:and\s+(?:also|then)|;\s*then|\bplus\s+(?:also|tell\s+me))\s+/i);
  if (strongSplit.length > 1) return strongSplit.map((p) => p.trim()).filter((p) => p.length > 0);

  // "X. Y?" with both halves looking like questions.
  const sentencePieces = trimmed.split(/(?<=[.!?])\s+(?=[A-Z])/);
  if (
    sentencePieces.length > 1
    && sentencePieces.every((p) => p.length > 6 && (p.endsWith('?') || /^(what|how|why|when|where|who|which|can|do|does|is|are)\b/i.test(p)))
  ) {
    return sentencePieces.map((p) => p.trim());
  }

  return [trimmed];
}

/**
 * Pull out lightweight entity candidates: capitalized tokens, quoted
 * strings, and `code-style` identifiers. Falls back to top non-stopword
 * tokens when nothing else matches.
 */
export function extractEntities(input: string): string[] {
  const found = new Set<string>();

  // Quoted phrases — these are almost always entities.
  for (const m of input.matchAll(/[\"\u201C]([^\"\u201D]{1,80})[\"\u201D]/g)) {
    if (m[1]) found.add(m[1].trim());
  }
  // Single-quoted phrases.
  for (const m of input.matchAll(/'([^']{2,60})'/g)) {
    if (m[1]) found.add(m[1].trim());
  }
  // Backtick code identifiers.
  for (const m of input.matchAll(/`([^`]{1,60})`/g)) {
    if (m[1]) found.add(m[1].trim());
  }

  // Capitalized multi-word phrases — skip the very first token (it might be
  // a sentence-initial cap that isn't really a proper noun).
  const tokens = input.split(/\s+/);
  let buf: string[] = [];
  for (let i = 1; i < tokens.length; i += 1) {
    const t = tokens[i].replace(/[^\w-]/g, '');
    if (/^[A-Z][\w-]{1,}$/.test(t) && !STOPWORDS.has(t.toLowerCase())) {
      buf.push(t);
    } else {
      if (buf.length > 0) {
        found.add(buf.join(' '));
        buf = [];
      }
    }
  }
  if (buf.length > 0) found.add(buf.join(' '));

  // Fallback: significant lowercase tokens (length >= 4, non-stopword).
  if (found.size === 0) {
    for (const t of tokens) {
      const cleaned = t.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (cleaned.length >= 4 && !STOPWORDS.has(cleaned)) {
        found.add(cleaned);
        if (found.size >= 3) break;
      }
    }
  }

  return Array.from(found);
}

/** Locate the first interrogative head in the prompt, if any. */
function firstInterrogative(input: string): string | undefined {
  const head = input.toLowerCase().trim().split(/\s+/)[0];
  return (INTERROGATIVES as readonly string[]).includes(head) ? head : undefined;
}

/** Approximate token count — splits on whitespace. */
function approxTokenCount(input: string): number {
  const trimmed = input.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Build the full cognitive frame. This is the only function the engine
 * needs to call — everything else is exposed for testing and reuse.
 */
export function analyze(input: string): CognitiveFrame {
  const safeInput = typeof input === 'string' ? input : '';
  const { kind, confidence } = classifyQuestion(safeInput);
  const subQuestions = decomposeCompound(safeInput);
  const entities = extractEntities(safeInput);
  const interrogative = firstInterrogative(safeInput);

  return {
    kind,
    kindConfidence: confidence,
    isCompound: subQuestions.length > 1,
    subQuestions,
    entities,
    hasConstraints: CONSTRAINT_RE.test(safeInput),
    interrogative,
    tokenCount: approxTokenCount(safeInput),
    signals: {
      endsWithQuestionMark: safeInput.trim().endsWith('?'),
      hasCodeFence: CODE_FENCE_RE.test(safeInput),
      hasNumberRange: NUMBER_RANGE_RE.test(safeInput),
      mentionsSelf: SELF_REF_RE.test(safeInput),
    },
  };
}
