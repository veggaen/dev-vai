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
  | 'build'           // "build/create me a <app>"
  | 'meta'            // about the conversation itself
  | 'other';

// Sentence-initial yes/no auxiliaries.
const YESNO_AUX_RE = /^\s*(?:does|do|did|can|could|will|would|is|are|was|were|has|have|had|should|shall|may|might|am)\b/i;

// An "action" predicate verb — distinguishes "does X MAKE Y?" (action) from a
// bare "is X?" definitional/copular question.
const ACTION_VERB_RE = /\b(?:makes?|made|making|sells?|sold|selling|offers?|serves?|produces?|owns?|sponsors?|ships?|delivers?|supports?|accepts?|costs?|charges?|stocks?|carr(?:y|ies)|provides?|runs?|operates?|eats?|drinks?|contains?|includes?|causes?|works?|fits?|flies|floats?|wins?|beats?|reaches?|exists?|grows?|happens?|helps?|hurts?|needs?|uses?|takes?|gives?|gets?)\b/i;

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

  // Action yes/no requires BOTH a leading yes/no auxiliary AND an action verb,
  // so "is the sky blue?" (copular) is NOT mislabeled as action.
  if (YESNO_AUX_RE.test(input) && ACTION_VERB_RE.test(input)) return 'action-yesno';

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
  const input = (rawInput || '').trim().replace(/\?+\s*$/, '');
  if (!input) return null;
  if (/```|title=|\bpath=/.test(input)) return null; // never split code/build payloads
  if (COMPARISON_MARKER_RE.test(input)) return null; // single comparison question

  const parts = input.split(/\s*,?\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => QUESTION_START_RE.test(p))) return null;
  if (!parts.every((p) => p.split(/\s+/).length >= 3)) return null;

  return parts.map((p) => (p.endsWith('?') ? p : `${p}?`));
}

/** Combine sub-answers from a split compound question into one reply. */
export function combineCompoundAnswers(answers: readonly string[]): string {
  return answers.map((a) => a.trim()).filter(Boolean).join('\n\n');
}
