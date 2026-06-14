/**
 * Stage F — Multi-turn correction guard.
 *
 * The live failure didn't stop at one bad answer: after the user said "you where wrong", Vai
 * was asked again and repeated the SAME fabricated $3,200. Single-turn verification (Stage B)
 * can't catch that on its own — the guard needs conversation memory.
 *
 * This pure function scans the conversation for values the user explicitly DISPUTED (a
 * correction signal near a number, or a different number the user themselves asserted), and
 * flags a draft that re-states a disputed value. ChatService uses the flag to force a fresh
 * grounded redraft / honest decline instead of shipping the repeat. Logged as
 * `persistent_error_after_correction`.
 *
 * Pure + deterministic — no model, no I/O. Unit-tested in full.
 */

export interface CorrectionTurn {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
}

export interface CorrectionGuardResult {
  /** The draft re-asserts a value the user disputed earlier in this conversation. */
  readonly repeatsDisputedValue: boolean;
  /** The specific disputed value the draft repeats (normalized numeric), or null. */
  readonly disputedValue: number | null;
  /** The raw token from the draft that triggered the flag (for the log/message). */
  readonly repeatedToken: string | null;
  /** A value the user explicitly offered as the correction (use this as a grounding hint). */
  readonly userCorrectedTo: number | null;
}

const NUMBER_RE = /(?:[$€£]\s?)?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?:[$€£]\s?)?\d+(?:\.\d+)?/g;
// Phrases that signal the user is correcting / rejecting the previous answer.
const CORRECTION_RE = /\b(you('?re| are| were)? wrong|that('?s| is)? (?:wrong|incorrect|not right)|not (?:correct|right|true)|wrong|incorrect|actually (?:it'?s|its|the)|no,? it'?s|that'?s not|isn'?t (?:right|correct)|mistake)\b/i;

function parseNumeric(token: string): number | null {
  const cleaned = token.replace(/[$€£,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function numbersIn(text: string): { token: string; value: number }[] {
  return (text.match(NUMBER_RE) ?? [])
    .map((token) => ({ token: token.trim(), value: parseNumeric(token) ?? NaN }))
    .filter((n) => Number.isFinite(n.value) && n.value > 0);
}

/** A value previously asserted by Vai that the user then disputed, with any correction offered. */
interface DisputedValue {
  readonly value: number;
  readonly correctedTo: number | null;
}

/**
 * Collect values the user disputed. Two signals:
 *  1) A user turn carries a correction phrase → the immediately-preceding assistant turn's
 *     salient value is "disputed". If that same user turn ALSO states a number, that's the
 *     correction target.
 *  2) (looser) A user turn states a number that differs from the prior assistant value while
 *     correcting → treat the assistant's value as disputed and the user's as the correction.
 */
export function collectDisputedValues(history: readonly CorrectionTurn[]): DisputedValue[] {
  const disputed: DisputedValue[] = [];
  for (let i = 0; i < history.length; i++) {
    const turn = history[i];
    if (turn.role !== 'user' || !CORRECTION_RE.test(turn.content)) continue;
    // Find the most recent assistant turn before this correction.
    let prevAssistant: CorrectionTurn | undefined;
    for (let j = i - 1; j >= 0; j--) {
      if (history[j].role === 'assistant') { prevAssistant = history[j]; break; }
    }
    if (!prevAssistant) continue;
    const assistantNums = numbersIn(prevAssistant.content);
    if (assistantNums.length === 0) continue;
    // The salient assistant value: the largest currency-ish / grouped number (a real value).
    const salient = assistantNums.sort((a, b) => b.value - a.value)[0];
    const userNums = numbersIn(turn.content);
    const correctedTo = userNums.find((u) => Math.abs(u.value - salient.value) > Math.abs(salient.value) * 0.05)?.value ?? null;
    disputed.push({ value: salient.value, correctedTo });
  }
  return disputed;
}

/** Numbers within this relative tolerance count as "the same disputed value". */
const REPEAT_TOLERANCE = 0.02;

/**
 * Check whether a draft repeats a value the user disputed earlier this conversation.
 * `history` should be the turns BEFORE the current draft (user + assistant), in order.
 */
export function checkCorrectionGuard(history: readonly CorrectionTurn[], draft: string): CorrectionGuardResult {
  const none: CorrectionGuardResult = { repeatsDisputedValue: false, disputedValue: null, repeatedToken: null, userCorrectedTo: null };
  const disputed = collectDisputedValues(history);
  if (disputed.length === 0) return none;

  const draftNums = numbersIn(draft);
  for (const d of disputed) {
    const hit = draftNums.find((n) => Math.abs(n.value - d.value) <= Math.abs(d.value) * REPEAT_TOLERANCE);
    if (hit) {
      return { repeatsDisputedValue: true, disputedValue: d.value, repeatedToken: hit.token, userCorrectedTo: d.correctedTo };
    }
  }
  return none;
}
