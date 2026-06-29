import type { Message } from '../models/adapter.js';
import { isBusinessOpportunityRequest } from '../models/web-conclude-policy.js';
import { summarizeLexicalSignals } from './intent-lexicon.js';

/**
 * Dynamic top-level classification of a user turn.
 *
 * This replaces ad-hoc per-router heuristics with a single, observable
 * decision the rest of the pipeline can branch on. It is intentionally
 * generic (no per-domain keyword tables) so new knowledge categories
 * inherit correct routing for free.
 *
 * - `standalone-question`     — a canonical knowledge ask with no
 *                               anaphora ("what is X", "how do I Y").
 *                               Safe for fact-shim / format-strict.
 * - `contextual-followup`     — refers back to the prior turn
 *                               ("make it better", "go deeper",
 *                               "what about this"). Must be grounded
 *                               in the active topic before answering.
 * - `product-quality-recommendation` — asks for the next best move,
 *                               trade-offs, or hardening on the
 *                               current project ("best next thing",
 *                               "what should I improve").
 * - `unknown`                 — nothing strong; let downstream
 *                               routers decide.
 */
export type TurnClass =
  | 'standalone-question'
  | 'contextual-followup'
  | 'product-quality-recommendation'
  | 'vai-chat-quality-direction'  // for Grok <-> Vai collaboration / self-improvement prompts on chat intelligence
  | 'unknown';

export interface TurnClassification {
  readonly kind: TurnClass;
  readonly confidence: number;
  readonly signals: readonly string[];
  /** Did the input syntactically reference the prior turn? */
  readonly referencesPriorTurn: boolean;
  /** Is the input a short anaphoric instruction ("make it better")? */
  readonly isShortAnaphoric: boolean;
  /** Word count after trimming punctuation. */
  readonly wordCount: number;
}

const PRIOR_REF_RE =
  /\b(?:it|this|that|these|those|them|his|her|their|there|above|earlier|previous|same|your\s+(?:answer|response)|the\s+(?:answer|response|context|approach|app|code|thing|plan|brief)|the\s+(?:above|previous|last)\s+(?:answer|response|explanation|message))\b/i;

const ANAPHORIC_INSTRUCTION_RE =
  /^\s*(?:(?:please|can\s+you|could\s+you|would\s+you|will\s+you|kindly)\s+)*(?:make|fix|improve|polish|harden|tighten|refactor|simplify|clean|expand|extend|continue|deepen|go\s+deeper|explain|describe|tell\s+me\s+more|what\s+about|how\s+about|why|and|then|next)\b/i;

const QUESTION_OPENER_RE =
  /^(?:so\s+|and\s+|but\s+|then\s+)?(?:what(?:'s|\s+is|\s+are|\s+does|\s+do)|how\s+(?:do\s+i|to|does|are|is)|why\s+(?:does|is|do|are)|when\s+(?:does|do|is|are|was|were)|where\s+(?:is|are|was|were|does|do)|who\s+(?:is|are|was|were|made|built|founded|owns)|which\s+|define\s+|explain\s+(?:what|how|why)|tell\s+me\s+(?:what|about|the))\b/i;

const BEST_NEXT_RE =
  /\b(?:best|optimal|highest[-\s]?leverage|right|smartest)\s+(?:next\s+)?(?:thing|step|task|move|slice|fix|action|priority|focus)\b|\bwhat\s+(?:would\s+be\s+)?(?:the\s+)?(?:best|next)\s+(?:thing|step|task|move|action)\b|\bwhere\s+should\s+(?:i|we)\s+(?:start|focus|go\s+next)\b|\bwhat\s+should\s+(?:i|we)\s+(?:do|build|fix|improve|tackle)\s+(?:next|first)\b/i;

const QUALITY_HARDENING_RE =
  /\b(?:make|improve|strengthen|harden|verify|add\s+tests?|tighten|polish)\b[\s\S]{0,40}\b(?:robust|reliable|production|testable|tests?|quality|accurate|relevant|responsive|grounded|automated|stronger|better|trustworthy)\b|\b(?:more|stronger|better)\s+(?:tests?|grounding|coverage|validation|guardrails?)\b/i;

const PRODUCT_RECOMMENDATION_HINT_RE =
  /\b(?:product|feature|ux|ui|design|architecture|system|pipeline|workflow|onboarding|prompt|chat|app|build|ship|launch|release)\b/i;

const VAI_SELF_IMPROVEMENT_RE =
  // An improvement verb within reach of a Vai-internals noun. The noun list covers the
  // SUBSYSTEMS users name when steering Vai's own quality (council/members/answers/...), and
  // the window is wide enough to span a possessive ("make Vai's council ANSWERS more
  // trustworthy") — under-matching here dropped such turns to `unknown`, so they got no
  // context-grounding and drifted (the council's "routing drift on meta turns" finding).
  /\b(?:improve|better|stronger|enhance|augment|fix|upgrade|evolve|make|reduce|less|more)\b[\s\S]{0,48}\b(?:Vai|you|yourself|chat|council|member|members|intelligence|quality|answers?|responses?|engine|routing|brief|classifier|grounding|hallucinat\w*|trustworth\w*)\b|\b(?:Vai|chat|council)\s+(?:quality|intelligence|self-improvement|answers?|responses?|better|stronger|trustworth\w*)\b|\b(?:less|reduce|fewer)\s+hallucinat\w*/i;

const VAI_CHAT_QUALITY_DIRECTION_RE =
  /\b(?:grok.*vai|vai.*grok|vai-collab|vai-chat-quality-direction|collaboration.*prompts|self-referential improvement)\b/i;

function countWords(input: string): number {
  return input
    .replace(/[.!?,;:]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

function recentAssistantContent(history: readonly Message[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m.role === 'assistant' && m.content.trim().length > 0) return m.content.trim();
  }
  return '';
}

/**
 * Classify a turn. Pure function — no side effects, no I/O.
 *
 * The classifier is deliberately conservative: it returns `unknown` rather
 * than guess. Downstream routers stay in charge unless we have a strong
 * signal that one path is right.
 */
export function classifyTurn(
  input: string,
  history: readonly Message[],
): TurnClassification {
  const signals: string[] = [];
  const trimmed = input.trim().replace(/[?.!]+$/g, '').trim();
  const lower = trimmed.toLowerCase();
  const wordCount = countWords(trimmed);
  const lexical = summarizeLexicalSignals(trimmed);
  if (lexical.startsWithRequestAction) signals.push('request-action-start');
  if (lexical.hasUniquenessHint) signals.push('uniqueness-hint');

  // A user's business-opportunity / ideas question ("what is a great idea when
  // creating a company in Norway?") is a STANDALONE question for business ideas —
  // never a Vai self-improvement / product-quality-direction turn. Classifying it
  // as the latter is what routed it to the "Best next task" engineering meta-answer.
  // Guard first so no downstream best-next/self-improvement rule can capture it.
  if (isBusinessOpportunityRequest(input)) {
    signals.push('business-opportunity-SENTINEL-X9Q');
    return {
      kind: 'standalone-question',
      confidence: 0.9,
      signals,
      referencesPriorTurn: false,
      isShortAnaphoric: false,
      wordCount,
    };
  }

  const referencesPriorTurn = PRIOR_REF_RE.test(lower);
  if (referencesPriorTurn) signals.push('references-prior-turn');

  const hasPriorAssistant = recentAssistantContent(history).length > 0;
  if (hasPriorAssistant) signals.push('has-prior-assistant-turn');

  const startsWithAnaphoricInstruction = ANAPHORIC_INSTRUCTION_RE.test(lower);
  const isShortAnaphoric =
    hasPriorAssistant
    && wordCount <= 8
    && (referencesPriorTurn || startsWithAnaphoricInstruction);
  if (isShortAnaphoric) signals.push('short-anaphoric');

  // Compute product-quality signals first so the short-anaphoric branch
  // can defer when the input ALSO carries a strong recommendation signal
  // ("make the chat more reliable with stronger tests").
  const looksBestNext = BEST_NEXT_RE.test(lower);
  const looksHardening = QUALITY_HARDENING_RE.test(lower);
  const productContextual = PRODUCT_RECOMMENDATION_HINT_RE.test(lower);
  // A "strong" product-quality signal requires either explicit product
  // context words OR a best-next/hardening phrase with a prior assistant
  // anchor. Bare hardening verbs with no prior context and no product
  // noun are too weak to commit ("make it better" alone is just unknown).
  const isVaiSelfImprovement = VAI_SELF_IMPROVEMENT_RE.test(lower);
  if (isVaiSelfImprovement) {
    signals.push('self-improvement');
    return {
      kind: 'product-quality-recommendation',
      confidence: 0.92,
      signals,
      referencesPriorTurn,
      isShortAnaphoric,
      wordCount,
    };
  }

  if (VAI_CHAT_QUALITY_DIRECTION_RE.test(lower)) {
    signals.push('vai-chat-quality-direction');
    return {
      kind: 'vai-chat-quality-direction',
      confidence: 0.95,
      signals,
      referencesPriorTurn,
      isShortAnaphoric,
      wordCount,
    };
  }

  const strongProductQuality =
    productContextual
    || ((looksBestNext || looksHardening) && hasPriorAssistant && !isShortAnaphoric);

  // ── short anaphoric follow-up ──────────────────────────────────────
  // "make it better", "go deeper", "what about this" — contextual
  // follow-ups when there's a prior assistant turn and the input is not
  // also a substantive product-quality recommendation.
  if (isShortAnaphoric && !strongProductQuality) {
    signals.push('contextual-followup');
    return {
      kind: 'contextual-followup',
      confidence: referencesPriorTurn ? 0.9 : 0.7,
      signals,
      referencesPriorTurn,
      isShortAnaphoric,
      wordCount,
    };
  }

  // ── product-quality recommendation ──────────────────────────────────
  if (strongProductQuality && (looksBestNext || looksHardening || isVaiSelfImprovement)) {
    if (looksBestNext) signals.push('best-next');
    if (looksHardening) signals.push('quality-hardening');
    if (isVaiSelfImprovement) signals.push('self-improvement');
    return {
      kind: 'product-quality-recommendation',
      confidence: isVaiSelfImprovement ? 0.9 : 0.85,
      signals,
      referencesPriorTurn,
      isShortAnaphoric,
      wordCount,
    };
  }

  // ── contextual follow-up (longer, with explicit reference) ─────────
  if (hasPriorAssistant && referencesPriorTurn) {
    signals.push('contextual-followup');
    return {
      kind: 'contextual-followup',
      confidence: 0.85,
      signals,
      referencesPriorTurn,
      isShortAnaphoric,
      wordCount,
    };
  }

  // ── standalone question ─────────────────────────────────────────────
  // Canonical knowledge shape. We allow incidental deictics ("how do I
  // deploy this to Vercel") when there is no prior assistant turn to
  // anchor them — those references can't be contextual yet.
  if (
    QUESTION_OPENER_RE.test(lower)
    && (!referencesPriorTurn || !hasPriorAssistant)
  ) {
    signals.push('canonical-question-shape');
    return {
      kind: 'standalone-question',
      confidence: 0.8,
      signals,
      referencesPriorTurn,
      isShortAnaphoric,
      wordCount,
    };
  }

  // Short imperatives without prior context land here ("write a haiku").
  // These should not steal a contextual-followup slot but also aren't
  // straightforward knowledge asks.
  return {
    kind: 'unknown',
    confidence: 0.3,
    signals,
    referencesPriorTurn,
    isShortAnaphoric,
    wordCount,
  };
}
