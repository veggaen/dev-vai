/**
 * grounding-gate — the loop's first AUTONOMOUS innovation: a pre-ship guard that stops Vai
 * shipping confident, ungrounded "AI slop" BEFORE the user sees it.
 *
 * How this was conceived (real innovation, end-to-end, by the loop's own evidence):
 *   - DISCOVERY: the loop re-learned ONE lesson 52× — "no concrete grounding: cite a number,
 *     name, file ref, or worked example" — at a low ~5.3 score. It kept DIAGNOSING the failure
 *     and shipping the answer anyway. The measurement existed (answer-rubric grounding score);
 *     the ENFORCEMENT did not. That gap is the innovation target.
 *   - GROUNDED: calibrated against the loop's OWN labelled examples — the 4.0–4.2 essay-soup
 *     ("a good company culture is defined by its focus on amazing people…": zero specifics) must
 *     be HELD; the 8.4 answers ("open React DevTools Profiler, record the slow interaction…":
 *     named tool + worked steps) must SHIP. No false positives on real good answers.
 *   - INVENTION: a new pre-ship STAGE (ship | repair | hold) the system didn't have — not a 5th
 *     grading knob, an actual gate with an actionable repair instruction.
 *
 * Pure, no model, no I/O → cheap enough to run on every answer and unit-testable. Reuses the
 * existing detectAnswerSignals so the grounding contract lives in ONE place (no drift).
 */
import { detectAnswerSignals } from './vague-answer.mjs';

/** Below this many words, a terse answer needs no grounding (a yes/no, a short fact, a greeting). */
export const SHORT_ANSWER_WORDS = 25;
/** A long answer this far over the short floor with NO grounding is the worst slop shape → HOLD. */
export const LONG_UNGROUNDED_WORDS = 60;

/**
 * Count DISTINCT kinds of concrete anchor in an answer (not just "any" — DEPTH of grounding).
 * The single boolean `grounded` was too coarse: one stray digit made a 200-word essay "grounded".
 * Counting distinct anchor KINDS (a number, a named entity, a code/file ref, a worked-example
 * phrase, an enumerated list) separates "mentions one year" from "names a tool AND gives steps".
 * @returns {{ anchors: number, kinds: string[] }}
 */
export function groundingAnchors(answer) {
  const text = String(answer ?? '');
  const kinds = [];
  if (/\d/.test(text)) kinds.push('number');
  if (/https?:\/\//i.test(text)) kinds.push('link');
  if (/`[^`]+`|```/.test(text)) kinds.push('code');
  if (/\b[A-Z][a-zA-Z]+(?:\.[a-z]{2,})\b/.test(text)) kinds.push('file-ref');
  if (/\b(for example|e\.g\.|such as|specifically|namely)\b/i.test(text)) kinds.push('example-phrase');
  // A genuine proper-noun tool/name (TitleCase mid-sentence, not the leading word) — "React
  // DevTools", "Pinia", "Next.js". Excludes a capitalised first word so "A good culture…" doesn't
  // count itself as grounding.
  if (/\b\w+[.!?]\s+|\S\s/.test(text) && /[a-z,;:]\s+[A-Z][a-zA-Z]{2,}/.test(text)) kinds.push('proper-noun');
  if (/(^|\n)\s*(?:[-*]|\d+[.)])\s+\S/.test(text)) kinds.push('enumerated');
  return { anchors: kinds.length, kinds };
}

/**
 * Decide whether an answer is grounded enough to SHIP, needs REPAIR, or must be HELD.
 *   - ship   : terse, OR carries real concrete anchors.
 *   - repair : substantive but thin on anchors — a fixable draft (ask for one concrete detail).
 *   - hold   : long, confident, and anchorless — the 52× slop shape; do not ship as-is.
 * Honest by construction: never invents grounding; a missing signal scores conservatively.
 * @returns {{ verdict:'ship'|'repair'|'hold', anchors:number, kinds:string[], reason:string, repair?:string }}
 */
export function gradeGrounding(answer, opts = {}) {
  const sig = detectAnswerSignals(answer);
  const { words, confident, hedged } = sig;
  const { anchors, kinds } = groundingAnchors(answer);
  const shortFloor = opts.shortWords ?? SHORT_ANSWER_WORDS;
  const longFloor = opts.longWords ?? LONG_UNGROUNDED_WORDS;

  // A short answer is allowed to be anchorless (a greeting, a yes/no, a one-line fact).
  if (words <= shortFloor) {
    return { verdict: 'ship', anchors, kinds, reason: `short answer (${words}w ≤ ${shortFloor}) — grounding not required` };
  }
  // Two or more distinct concrete anchors = genuinely grounded → ship.
  if (anchors >= 2) {
    return { verdict: 'ship', anchors, kinds, reason: `grounded: ${anchors} concrete anchor kinds (${kinds.join(', ')})` };
  }
  // Long, anchorless, and CONFIDENT with no hedge = the worst slop shape → HOLD.
  if (anchors === 0 && words > longFloor && confident && !hedged) {
    return {
      verdict: 'hold', anchors, kinds,
      reason: `${words}w, confident, ZERO concrete anchors, no hedge — the 52× slop shape`,
      repair: 'do not ship: add at least two concrete anchors (a named tool/number, a worked example, or an enumerated step) OR hedge the uncertain claims',
    };
  }
  // Otherwise substantive but thin (0–1 anchors) → repairable draft.
  return {
    verdict: 'repair', anchors, kinds,
    reason: `${words}w but only ${anchors} concrete anchor${anchors === 1 ? '' : 's'} — thin grounding`,
    repair: 'strengthen before shipping: cite a specific number, name a real tool/file, or give one worked example',
  };
}

/** Compact one-liner for the loop log / Thinking panel. */
export function describeGrounding(g) {
  if (!g) return '';
  const mark = g.verdict === 'ship' ? '✓' : g.verdict === 'repair' ? '~' : '✗';
  return `grounding ${mark} ${g.verdict} (${g.anchors} anchors${g.kinds?.length ? `: ${g.kinds.join(', ')}` : ''})`;
}
