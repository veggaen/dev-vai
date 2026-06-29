/**
 * Basic multi-turn deliberation (Thorsen-inspired role-based deliberation, Milestone 1
 * slice 3). FLAG-GATED, additive: the default single-round council path is unchanged.
 *
 * Today the council is a PANEL — every role reviews the draft independently in one round and
 * the notes are folded into consensus. They never see each other. Deliberation adds a second
 * round: each role is shown the OTHER roles' round-1 reviews (via CouncilInput.peerNotes) and
 * may revise — agree, push back, or hold its ground with a reason. The think-first prompt
 * (member.ts buildUserPrompt) asks it to reason about the strongest disagreement before
 * answering. The result is a genuine deliberation, then reachConsensus over the round-2 notes.
 *
 * Crash-safe by construction: members run SEQUENTIALLY (one model resident at a time), exactly
 * like the existing path — deliberation just runs the panel twice, it never parallelises.
 * Bounded: round 2 is skipped unless round 1 produced ≥2 usable, NON-UNANIMOUS notes (no point
 * deliberating when everyone already agrees, and a single voice has no peers to react to).
 *
 * Enable with VAI_COUNCIL_DELIBERATE=1. Pure orchestration over existing pieces
 * (member.review + reachConsensus); no new model plumbing, no consensus-math change.
 */

import type { CouncilInput, CouncilMember, CouncilMemberNote, CouncilConsensus } from './types.js';
import { reachConsensus } from './council.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Is multi-turn deliberation enabled? Off by default — never changes default behavior. */
export function isDeliberationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VAI_COUNCIL_DELIBERATE === '1';
}

/** Run one member with an outer timeout, mirroring runOneMember's safety (a fail → null). */
async function reviewOnce(
  member: CouncilMember,
  input: CouncilInput,
  timeoutMs: number,
): Promise<CouncilMemberNote | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    return await Promise.race([member.review(input).catch(() => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Build the compact peer-note view a member sees in round 2 (intent/method/verdict only). */
export function buildPeerNotes(notes: readonly CouncilMemberNote[]): NonNullable<CouncilInput['peerNotes']> {
  return notes
    .filter((n) => !n.error)
    .map((n) => ({
      role: n.memberName,
      verdict: n.verdict,
      intent: (n.realIntent || '').slice(0, 200),
      concern: (n.concerns[0] || n.methodLesson || '').slice(0, 200),
    }));
}

export interface DeliberationResult {
  readonly consensus: CouncilConsensus;
  readonly rounds: number;
  /** Round-1 notes (kept for the audit/UI — shows what changed in round 2). */
  readonly round1Notes: readonly CouncilMemberNote[];
}

/**
 * Run a bounded 2-round deliberation. Round 1: independent reviews (sequential). If the panel
 * is split (≥2 usable notes, not unanimous), round 2: each member re-reviews seeing peers'
 * round-1 notes, then consensus is reached over the round-2 notes. Otherwise round 1 stands.
 *
 * `weightFor` matches the caller's trust-weighting (topic-fit/proof) so consensus is identical
 * in spirit to the single-round path. Sequential + timeout-bounded → crash-safe. Never throws.
 */
export async function deliberate(
  members: readonly CouncilMember[],
  input: CouncilInput,
  options: {
    readonly timeoutMs?: number;
    readonly weightFor?: (note: CouncilMemberNote) => number;
    readonly maxItems?: number;
    readonly escalateBelow?: number;
  } = {},
): Promise<DeliberationResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const consensusOpts = { weightFor: options.weightFor, maxItems: options.maxItems, escalateBelow: options.escalateBelow };

  // ── Round 1: independent reviews, sequential (crash-safe). ──
  const round1: CouncilMemberNote[] = [];
  for (const m of members) {
    const note = await reviewOnce(m, input, timeoutMs);
    if (note) round1.push(note);
  }

  const usable = round1.filter((n) => !n.error);
  const verdicts = new Set(usable.map((n) => n.verdict));
  const shouldDeliberate = usable.length >= 2 && verdicts.size > 1; // split panel only

  if (!shouldDeliberate) {
    return { consensus: reachConsensus(round1, consensusOpts), rounds: 1, round1Notes: round1 };
  }

  // ── Round 2: peer-aware reconsideration. Each member sees the OTHERS' round-1 notes. ──
  const round2: CouncilMemberNote[] = [];
  for (const m of members) {
    const peers = buildPeerNotes(usable.filter((n) => n.memberId !== m.id));
    const note = await reviewOnce(m, { ...input, peerNotes: peers }, timeoutMs);
    // Keep the round-1 note if round 2 failed/empty — never lose a voice to a flaky round.
    round2.push(note ?? round1.find((n) => n.memberId === m.id) ?? note!);
  }

  return {
    consensus: reachConsensus(round2.filter(Boolean), consensusOpts),
    rounds: 2,
    round1Notes: round1,
  };
}
