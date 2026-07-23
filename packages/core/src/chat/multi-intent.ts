import { classifyAgentBuildIntent, type AgentBuildIntent } from './build-execution-intent.js';
import { classifyQuestionIntent, type QuestionIntent } from './question-intent.js';

/**
 * Multi-intent decomposition.
 *
 * A single user message can carry MORE THAN ONE distinct ask:
 *   "Explain how JWT auth works AND THEN build me a login page"
 *   "Compare Postgres and SQLite AND recommend one"
 * Historically Vai classified the whole message as ONE intent and answered only
 * the first (or neither) — the "understanding → action" gap: the second deliverable
 * was silently dropped. This module detects those parts so the turn pipeline can
 * plan and satisfy EACH one, and so the timeline UI can show "I heard 2 requests".
 *
 * Deliberately high-precision: it only splits when there are clearly separable
 * clauses joined by an intent boundary AND at least two parts carry a real,
 * DIFFERENT actionable intent (e.g. an answer part + a build part). A plain
 * compound question of the same kind ("what is X and what is Y") is NOT a
 * multi-intent turn here — that is handled by `splitCompoundQuestion`; conflating
 * them would double-count. Pure: no IO, no state.
 */

/** One decomposed part of a multi-intent message. */
export interface IntentPart {
  /** The clause text for this part (trimmed). */
  readonly text: string;
  /** Agent build-band for this part in isolation. */
  readonly buildIntent: AgentBuildIntent;
  /** Question-intent for this part in isolation. */
  readonly questionIntent: QuestionIntent;
  /** A coarse action label the pipeline + UI branch on. */
  readonly action: 'answer' | 'build';
}

export interface MultiIntentResult {
  /** True when the message carries 2+ distinct actionable intents. */
  readonly isMultiIntent: boolean;
  /** The decomposed parts (best→source order). Length 1 when not multi-intent. */
  readonly parts: readonly IntentPart[];
  /** Distinct action kinds present, e.g. `['answer','build']`. */
  readonly actions: readonly ('answer' | 'build')[];
}

// Intent-boundary connectives, STRONGEST first. "and then" / "then" / "also" mark
// a sequence of separate asks; a bare "and" is the weakest (it also appears inside
// a single clause, e.g. "altered and unaltered states") so it is only used as a
// LAST-resort boundary when no stronger one is present.
const BOUNDARY_RE = /\s+(?:and\s+then|,?\s*then|and\s+also|,?\s*also|\bplus\b|;|\band\b)\s+/i;
// Ordered strong→weak. The detector splits on the FIRST pattern that yields 2–3
// clean request-shaped parts, so "explain X, and then build Y ... and Z" splits at
// "and then" (2 parts) instead of shattering on every "and".
const SPLIT_PATTERNS: readonly RegExp[] = [
  /\s+(?:and\s+then|,?\s*then\s+)\s*/i,
  /\s+(?:and\s+also|,?\s*also)\s+/i,
  /\s+\bplus\b\s+/i,
  /\s+\band\b\s+/i,
];

// A clause looks like an independent request if it has an imperative/interrogative
// shape — a verb or a question word near its start. Used to reject noise splits
// ("nature images only, login for altered and unaltered states" must NOT split on
// that internal "and").
const REQUEST_SHAPE_RE =
  /^\s*(?:please\s+)?(?:explain|describe|tell|show|build|create|make|generate|scaffold|write|implement|add|compare|recommend|suggest|what|who|when|where|why|which|how|can|could|would|should|give|list|design|develop)\b/i;

function actionOf(buildIntent: AgentBuildIntent): 'answer' | 'build' {
  return buildIntent === 'build' ? 'build' : 'answer';
}

function classifyPart(text: string): IntentPart {
  const buildIntent = classifyAgentBuildIntent(text);
  const questionIntent = classifyQuestionIntent(text);
  return { text, buildIntent, questionIntent, action: actionOf(buildIntent) };
}

/**
 * Decompose a message into its distinct intent-parts.
 *
 * Returns `isMultiIntent: false` (with a single part) unless the message splits
 * into 2+ clauses that each carry a request shape AND together contain more than
 * one DISTINCT action (an answer part + a build part, or two clearly different
 * asks). This keeps ordinary sentences and same-kind compound questions single.
 */
export function detectMultiIntent(rawInput: string): MultiIntentResult {
  const input = (rawInput || '').trim();
  const single = (): MultiIntentResult => {
    const part = classifyPart(input || '');
    return { isMultiIntent: false, parts: [part], actions: [part.action] };
  };
  if (!input || !BOUNDARY_RE.test(input)) return single();

  // Try each boundary strongest→weakest; accept the first that yields 2–3 clean,
  // request-shaped parts. This splits "explain X, and then build Y ... and Z" at
  // the strong "and then" (into 2 parts) instead of shattering on every "and".
  let rawParts: string[] | null = null;
  for (const pattern of SPLIT_PATTERNS) {
    const candidate = input.split(pattern).map((p) => p.trim()).filter(Boolean);
    if (candidate.length < 2 || candidate.length > 3) continue;
    if (candidate.every((p) => REQUEST_SHAPE_RE.test(p) && p.split(/\s+/).length >= 2)) {
      rawParts = candidate;
      break;
    }
  }
  if (!rawParts) return single();

  const parts = rawParts.map(classifyPart);
  const actions = Array.from(new Set(parts.map((p) => p.action)));

  // Multi-intent only when there is MORE THAN ONE distinct action. Two answer
  // parts of the same kind are left to `splitCompoundQuestion`; here we care about
  // heterogeneous asks (answer + build) — the class that silently drops a deliverable.
  const isMultiIntent = actions.length > 1;
  if (!isMultiIntent) return single();

  return { isMultiIntent: true, parts, actions };
}
