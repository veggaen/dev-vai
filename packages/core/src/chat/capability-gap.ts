import type { DispatchOutcome, DispatchPlan, ScoredCandidate } from './turn-pipeline.js';

/**
 * Capability-gap diagnosis — honest "I can't do this (yet), and here's exactly why".
 *
 * The gap this fills (found by the self-improvement loop's capability council, then sharpened
 * against the real code): when `dispatchTurn` returns no resolution — every capability scored
 * below the confidence floor, or matched but declined/failed its own verify — Vai today just
 * "falls back honestly" with no SPECIFICS. The user gets a vague non-answer; the system records
 * nothing structured about what was missing. The capability kernel already verifies before
 * release (capability-kernel.ts) and the dispatch plan already records every candidate, its
 * score, and what declined — so the missing piece is purely to TURN that trace into an honest,
 * structured capability gap. No model call, no new I/O: a pure read of the plan.
 *
 * Two distinct kinds of miss, because they mean different things to a user:
 *   - 'below-floor'  → nothing Vai has is a strong enough match. It doesn't have the capability.
 *   - 'declined'     → a capability matched but could not stand behind an answer (couldn't ground
 *                      / verify). Vai HAS the route but lacked the evidence this turn.
 *   - 'no-candidates'→ nothing even applied. The turn is outside everything Vai knows how to do.
 *
 * `shouldEscalate` is true when the gap is a genuine capability limit (not just a thin-evidence
 * decline) — the signal a higher tier (a stronger model, or a human/Opus) should pick it up,
 * which is the loop council's actual ask: "escalate to V3gga/Opus when a missing capability is
 * identified" — done as a deterministic signal, not a bluff.
 */

/** The structured diagnosis of a missed turn. Always safe to compute; never throws. */
export interface CapabilityGap {
  /** Why the turn went unanswered. */
  readonly kind: 'below-floor' | 'declined' | 'no-candidates';
  /** The closest capabilities and their scores — what ALMOST answered. */
  readonly nearest: readonly { readonly name: string; readonly score: number; readonly reason?: string }[];
  /** Capabilities that matched but declined (couldn't resolve/verify) this turn. */
  readonly declined: readonly string[];
  /** Top score reached (0 when nothing applied) — how close Vai got. */
  readonly topScore: number;
  /** True when this is a real capability limit worth escalating, not just thin evidence. */
  readonly shouldEscalate: boolean;
  /** One honest, user-facing sentence. Plain language, no jargon, never a bluff. */
  readonly message: string;
}

/** How many near-miss candidates to surface (enough to be useful, not a dump). */
const MAX_NEAREST = 3;

/**
 * A 'declined' miss (a capability matched but couldn't ground) is NOT a capability gap to escalate
 * — Vai has the route, it just lacked evidence this turn; retrying or asking for more input is the
 * right move, not escalation. A 'below-floor'/'no-candidates' miss IS a capability limit: nothing
 * Vai has fits, so a stronger tier should take it. This keeps escalation honest (real gaps only).
 */
function decideEscalation(kind: CapabilityGap['kind'], declinedOnly: boolean): boolean {
  if (kind === 'declined' && declinedOnly) return false;
  return kind === 'below-floor' || kind === 'no-candidates' || kind === 'declined';
}

/** Plain-language message per gap kind — honest about WHAT Vai couldn't do. */
function gapMessage(
  kind: CapabilityGap['kind'],
  nearest: CapabilityGap['nearest'],
  declined: readonly string[],
): string {
  if (kind === 'no-candidates') {
    return "I don't have a capability that fits this request, so I can't answer it reliably. Tell me a bit more about what you're after, or this may be something to escalate.";
  }
  if (kind === 'declined') {
    const which = declined.length ? ` (${declined.slice(0, 3).join(', ')})` : '';
    return `I started on this but couldn't ground a confident answer${which} — I won't guess. Give me more detail or a source, or I can escalate it.`;
  }
  // below-floor
  const top = nearest[0];
  const close = top ? ` The closest I have is "${top.name}", but it wasn't a strong enough match.` : '';
  return `I'm not confident I can do this well yet — none of my capabilities matched it strongly.${close} I'd rather say so than bluff.`;
}

/**
 * Diagnose a missed dispatch into an honest capability gap. Returns null when the dispatch
 * actually produced a resolution (no gap). Pure: reads only the plan. Never throws.
 */
export function diagnoseCapabilityGap(outcome: DispatchOutcome): CapabilityGap | null {
  if (!outcome || outcome.resolution !== null) return null;
  const plan: Partial<DispatchPlan> = outcome.plan ?? {};
  const candidates: readonly ScoredCandidate[] = plan.candidates ?? [];
  const declined: readonly string[] = plan.declined ?? [];
  const belowFloor = plan.belowFloor !== false; // default to "weak" when the plan didn't say
  const topScore = candidates.length > 0 ? Math.max(0, candidates[0].score) : 0;

  // Kind: nothing applied at all → no-candidates; something matched+declined but nothing scored
  // below floor as the cause → declined; otherwise everything was simply too weak → below-floor.
  let kind: CapabilityGap['kind'];
  if (candidates.length === 0) {
    kind = 'no-candidates';
  } else if (declined.length > 0 && belowFloor === false) {
    // A candidate cleared the floor but declined (resolve/verify → null): Vai had the route.
    kind = 'declined';
  } else if (declined.length > 0 && topScore >= 0.5) {
    kind = 'declined';
  } else {
    kind = 'below-floor';
  }

  const nearest = candidates
    .slice(0, MAX_NEAREST)
    .map((c) => ({ name: c.name, score: c.score, reason: c.reason }));

  // "declinedOnly" = the only reason we missed is a decline (no separate below-floor weakness).
  const declinedOnly = kind === 'declined' && declined.length > 0;
  const shouldEscalate = decideEscalation(kind, declinedOnly);
  const message = gapMessage(kind, nearest, declined);

  return { kind, nearest, declined, topScore, shouldEscalate, message };
}

/** Compact, friend-readable one-liner for the Thinking panel / logs. */
export function describeCapabilityGap(gap: CapabilityGap | null): string {
  if (!gap) return '';
  const near = gap.nearest.length
    ? ` · nearest ${gap.nearest.map((n) => `${n.name} ${(n.score * 100).toFixed(0)}%`).join(', ')}`
    : '';
  const esc = gap.shouldEscalate ? ' · escalate' : '';
  return `capability gap: ${gap.kind}${near}${esc}`;
}
