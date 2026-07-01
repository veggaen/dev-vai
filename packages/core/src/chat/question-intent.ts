import { isExplicitResearchRequest } from '../models/explicit-web-search.js';
import { isFreshLocalRecommendationRequest } from '../models/web-conclude-policy.js';
import { scoreQuestionIntent } from './intent-scorer.js';

/**
 * Lightweight question-intent classifier.
 *
 * The engine routes by greedy keyword handlers, which misfire when a question's
 * surface keywords match the wrong handler ("does Starbucks make cappuccino?"
 * grabbing the brand *definition*). Classifying intent up front lets handlers be
 * gated to the intent they actually serve, instead of firing on any keyword.
 *
 * Deliberately conservative: returns 'other' rather than guess.
 */

export type QuestionIntent =
  | 'action-yesno'    // "does/do/can/will X <verb> Y?" — whether X does something
  | 'definition'      // "what/who is X", "explain X", "tell me about X"
  | 'factual-lookup'  // "capital of X", "who invented Y", "when was Z founded"
  | 'recommendation'  // "what are good restaurants in Hommersak?"
  | 'build'           // "build/create me a <app>"
  | 'meta'            // about the conversation itself
  | 'other';

// Sentence-initial yes/no auxiliaries.
const YESNO_AUX_RE = /^\s*(?:does|do|did|can|could|will|would|is|are|was|were|has|have|had|should|shall|may|might|am)\b/i;
const CONVERSATIONAL_SUBJECT_RE = /^\s*(?:does|do|did|can|could|will|would|is|are|was|were|has|have|had|should|shall|may|might|am)\s+(?:you|we)\b/i;

// An "action" predicate verb — distinguishes "does X MAKE Y?" (action) from a
// bare "is X?" definitional/copular question.
const ACTION_VERB_RE = /\b(?:makes?|made|making|sells?|sold|selling|has|have|had|offers?|serves?|produces?|owns?|sponsors?|ships?|delivers?|supports?|accepts?|costs?|charges?|stocks?|carr(?:y|ies)|provides?|runs?|operates?|eats?|drinks?|contains?|includes?|causes?|works?|fits?|flies|floats?|wins?|beats?|reaches?|exists?|grows?|happens?|helps?|hurts?|needs?|uses?|takes?|gives?|gets?)\b/i;

const META_RE = /\b(?:my|your)\s+(?:first|last|previous|earlier)\s+(?:message|question|answer|reply)|what\s+did\s+i\s+(?:say|ask|write)|(?:this|the)\s+(?:chat|conversation)\b/i;

const BUILD_RE = /^\s*(?:please\s+)?(?:build|create|make|generate|scaffold|code|develop|design)\s+(?:me\s+)?(?:a|an|the|my)\b[\s\S]*\b(?:app|application|api|site|website|page|dashboard|tool|component|service|server|cli|game|clone|landing|store|bot|script|function|widget|form)\b/i;

const DEFINITION_RE = /^\s*(?:what|who)(?:'?s|\s+(?:is|are|was|were))\b|^\s*(?:explain|define|describe|tell\s+me\s+about|give\s+me\s+(?:an?\s+)?overview)\b/i;

// A specific factual anchor ("capital of", "who invented", "how many") marks a
// fact lookup even though it also starts with "what/who is".
const FACTUAL_ANCHOR_RE = /\b(?:capital|currency|population|invent(?:ed|or)|founded|located|tallest|largest|biggest|smallest|highest|longest|oldest)\b|^\s*how\s+(?:many|much|tall|big|old|far|long|fast|deep|wide|high)\b/i;
const WH_RE = /^\s*(?:what|which|who|when|where)\b/i;

export function classifyQuestionIntent(rawInput: string): QuestionIntent {
  const input = (rawInput || '').trim();
  if (!input) return 'other';

  if (META_RE.test(input)) return 'meta';

  if (isExplicitResearchRequest(input)) return 'other';
  if (isFreshLocalRecommendationRequest(input)) return 'recommendation';

  // Action yes/no requires BOTH a leading yes/no auxiliary AND an action verb,
  // so "is the sky blue?" (copular) is NOT mislabeled as action.
  if (YESNO_AUX_RE.test(input) && !CONVERSATIONAL_SUBJECT_RE.test(input) && ACTION_VERB_RE.test(input)) return 'action-yesno';

  if (BUILD_RE.test(input)) return 'build';
  // Specific fact anchors win over the generic "what is X" definition pattern.
  if (FACTUAL_ANCHOR_RE.test(input)) return 'factual-lookup';
  if (DEFINITION_RE.test(input)) return 'definition';
  if (WH_RE.test(input)) return 'factual-lookup';

  return 'other';
}

/** True when the input is a yes/no question about whether an entity DOES something. */
export function isActionYesNoQuestion(input: string): boolean {
  return classifyQuestionIntent(input) === 'action-yesno';
}

/**
 * The confidence margin the lexical scorer must clear before its guess is
 * allowed to REPLACE a regex `'other'`. Below this, the turn is genuinely
 * ambiguous and we keep `'other'` (conservative — never invent an intent the
 * features only weakly support). Tuned so a clean single-lane turn (one strong
 * feature) passes while a mixed-signal turn does not.
 */
const SMART_ADOPT_MARGIN = 0.25;

/**
 * Intent classification with a lexical-feature fallback.
 *
 * This is a strict SUPERSET of {@link classifyQuestionIntent}: whenever the
 * regex cascade returns a concrete intent, that verdict is returned UNCHANGED
 * (the proven, high-precision path is never overridden). Only when the regex
 * path bottoms out at `'other'` do we consult the {@link ./intent-scorer.ts}
 * lexical scorer, and only adopt its top guess when it is (a) not itself
 * `'other'` and (b) decisive enough (`margin >= SMART_ADOPT_MARGIN`). So this
 * can only ever SHRINK the `'other'` bucket — it never reshapes a decision the
 * regexes already made.
 *
 * @returns `{ intent, source, scorer }` — `source` is `'regex'` when the fast
 *   path decided, `'scorer'` when the lexical fallback did, so the visible
 *   route plan can show which layer classified the turn.
 */
export function classifyQuestionIntentSmart(rawInput: string): {
  readonly intent: QuestionIntent;
  readonly source: 'regex' | 'scorer';
  readonly scorer?: ReturnType<typeof scoreQuestionIntent>;
} {
  const regexIntent = classifyQuestionIntent(rawInput);
  if (regexIntent !== 'other') return { intent: regexIntent, source: 'regex' };

  const scored = scoreQuestionIntent(rawInput);
  if (scored.top.intent !== 'other' && scored.margin >= SMART_ADOPT_MARGIN) {
    return { intent: scored.top.intent, source: 'scorer', scorer: scored };
  }
  return { intent: 'other', source: 'regex', scorer: scored };
}

// Compound-splittable starts are factual/yes-no only. "why"/"how" are excluded:
// they are explanatory and usually part of one reasoning question, not two
// independent ones ("What is X and why would I use it over Y?").
const QUESTION_START_RE = /^(?:what|who|whom|whose|when|where|which|is|are|was|were|does|do|did|can|could|will|would|should|has|have|had)\b/i;

// A comparison / back-reference marker means it's a single question, not two.
const COMPARISON_MARKER_RE = /\b(?:over|versus|vs\.?|compared\s+to|rather\s+than|instead\s+of|better\s+than|difference\s+between)\b/i;

/**
 * Split a compound question ("A and B?") into standalone sub-questions.
 *
 * High-precision on purpose: every part must independently start like a
 * question and be a real clause (>= 3 words), so statements ("X is fast and
 * reliable") and build instructions ("build an app and add auth") are NOT
 * split. Returns null when the input is not a clear compound question.
 */
export function splitCompoundQuestion(rawInput: string): string[] | null {
  if (typeof rawInput !== 'string') return null;
  // Strip a short conversational lead-in ("okay then —", "so", "and also")
  // so "okay then — what is X and which is Y" still splits into its two
  // questions instead of failing the question-start check.
  const input = rawInput
    .trim()
    .replace(/\?+\s*$/, '')
    .replace(/^(?:try\s+this|(?:hello[\s,]+)?quick\s+question)\s*[:,\-\s]*/i, '')
    .replace(/^(?:(?:okay|ok|so|well|alright|right|also|actually|now|hmm|umm?|and|but|then|hey|yeah|yo)[\s,]+){1,3}(?:[—–\-:]\s*)?/i, '')
    .replace(/^(?:try\s+this|(?:hello[\s,]+)?quick\s+question)\s*[:,\-\s]*/i, '')
    .replace(/^(?:tell\s+me|and\s+tell\s+me|also\s+tell\s+me|hey\s+tell\s+me)\s+/i, '')
    .replace(/^i\s+need\s+(?:two|2)\s+things?\s*[:,\-\s]*/i, '')
    .replace(/\s+(?:reply|respond|answer|just\s+give\s+me|give\s+me)\b[\s\S]*$/i, '')
    .trim();
  if (!input) return null;
  if (/```|title=|\bpath=/.test(input)) return null; // never split code/build payloads
  if (COMPARISON_MARKER_RE.test(input)) return null; // single comparison question

  const repeatedProperty = input.match(/^(what\s+(?:is|are)\s+the\s+)(.+?)\s+of\s+(.+?)\s+and\s+(?:the\s+)?\2\s+of\s+(.+)$/i);
  if (repeatedProperty) {
    const [, lead, property, firstSubject, secondSubject] = repeatedProperty;
    return [
      `${lead}${property} of ${firstSubject}?`,
      `${lead}${property} of ${secondSubject}?`,
    ];
  }

  const parts = input.split(/\s*,?\s+and(?:\s+also)?\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  const normalizedParts = parts.map((part) => {
    const cleaned = part.replace(/[,.!?\s]+$/, '').trim();
    const arithmetic = cleaned.match(/^(?:work\s+out|calculate|compute)\s+(\d+(?:\s*(?:plus|minus|times|multiplied|divided|\+|-|\*|\/)\s*\d+)+)$/i)?.[1];
    if (arithmetic) return `what is ${arithmetic}`;
    const requestedFact = cleaned.replace(/^tell\s+me\s+/i, '');
    if (/^(?:the\s+)?capital(?:\s+city)?\s+of\b/i.test(requestedFact)) return `what is ${requestedFact}`;
    if (QUESTION_START_RE.test(cleaned)) return cleaned;
    if (/^\d+\s+(?:plus|minus|times|multiplied|divided|\+|-|\*|\/)\b/i.test(cleaned)) return `what is ${cleaned}`;
    if (/^(?:the\s+)?capital(?:\s+city)?\s+of\b/i.test(cleaned)) return `what is ${cleaned}`;
    return null;
  });
  if (normalizedParts.some((part) => part === null)) return null;
  if (!normalizedParts.every((part) => part!.split(/\s+/).length >= 3)) return null;

  return normalizedParts.map((part) => (part!.endsWith('?') ? part! : `${part}?`));
}

/** Combine sub-answers from a split compound question into one reply.
 * When subQuestions are supplied (and lengths match), produces a structured
 * response with clear per-part headings so spoken "tell me X and Y" yields
 * scannable, non-blended output. Default (no subs) preserves prior simple
 * join for callers that don't have the parts.
 */
export function combineCompoundAnswers(
  answers: readonly string[],
  subQuestions?: readonly string[],
): string {
  const cleanAnswers = answers.map((a) => a.trim()).filter(Boolean);
  if (cleanAnswers.length === 0) return '';
  if (!subQuestions || subQuestions.length !== cleanAnswers.length) {
    return cleanAnswers.join('\n\n');
  }
  return cleanAnswers
    .map((ans, i) => {
      const q = (subQuestions[i] ?? '').trim().replace(/\?+$/, '').trim();
      const heading = q ? `**${q}?**` : `**Part ${i + 1}**`;
      return `${heading}\n${ans}`;
    })
    .join('\n\n');
}
