/**
 * Role-aware deliberation (Thorsen-inspired role-based deliberation, Milestone 1 slice 3).
 *
 * This is the piece that makes ROLES actively participate in a deliberation SEQUENCE, instead of
 * a flat anonymous panel. It composes the three role primitives already built in M1:
 *   1. assignModelsToRoles  — capability-probe: seat each role (lens+Thorsen tier) on the best
 *      available local model (dynamic, graceful degradation, auditable .reason).
 *   2. a member factory      — turn each {role, model} into a CouncilMember (INJECTED, so tests
 *      run with mock members and NO Ollama/GPU; production passes the real factory).
 *   3. deliberate            — the bounded think→critique rounds (round 1 independent, round 2
 *      peer-aware on a split panel), sequential + timeout-bounded (crash-safe).
 *
 * Sequence: members are ordered by Thorsen tier (senior → … → distinguished) so the round plays
 * as a real deliberation — the front-line senior frames correctness first, and the higher tiers
 * (principal/distinguished) get the last, peer-aware word on systemic value + Vai's evolution.
 *
 * FLAG-GATED behind VAI_COUNCIL_DELIBERATE (shared with deliberate) — default OFF, the normal
 * single-round council path is untouched. Returns the deliberation result PLUS the auditable
 * role assignments so the UI can show "who sat in which chair and why".
 */

import type { CouncilInput, CouncilMember, CouncilMemberNote, CouncilConsensus } from './types.js';
import type { DiscoveredOllamaModel } from '../models/ollama-discovery.js';
import type { CouncilLens } from './member.js';
import { THORSEN_TIER_RANK } from './member.js';
import { assignModelsToRoles, type RoleAssignment } from './role-assignment.js';
import { deliberate, buildPeerNotes, type DeliberationResult } from './deliberate.js';
import { reachConsensus } from './council.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Whether a set of notes still disagrees (≥2 usable notes with more than one verdict). */
function isSplit(notes: readonly CouncilMemberNote[]): boolean {
  const usable = notes.filter((n) => !n.error);
  return usable.length >= 2 && new Set(usable.map((n) => n.verdict)).size > 1;
}

/** A reasoned read of who still disagrees and on what, after the rounds have run. */
export interface DisagreementSummary {
  /** True when the panel never reconciled to a single verdict. */
  readonly unresolved: boolean;
  /** The distinct verdicts still on the table (e.g. ['good','bad']). */
  readonly verdicts: readonly string[];
  /** The minority side: members whose verdict is NOT the modal one, with their concern. */
  readonly holdouts: ReadonlyArray<{ readonly role: string; readonly verdict: string; readonly concern: string }>;
}

/** Summarise the disagreement left in a set of notes (the modal verdict wins; the rest are holdouts). */
export function summariseDisagreement(notes: readonly CouncilMemberNote[]): DisagreementSummary {
  const usable = notes.filter((n) => !n.error);
  const tally = new Map<string, number>();
  for (const n of usable) tally.set(n.verdict, (tally.get(n.verdict) ?? 0) + 1);
  const verdicts = [...tally.keys()];
  const modal = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const holdouts = usable
    .filter((n) => n.verdict !== modal)
    .map((n) => ({ role: n.memberName, verdict: n.verdict, concern: (n.concerns[0] || n.methodLesson || '').slice(0, 200) }));
  return { unresolved: verdicts.length > 1, verdicts, holdouts };
}

/** Numeric altitude of a role's tier (higher = more architectural authority). Senior if unset. */
function tierRank(role: CouncilLens): number {
  return THORSEN_TIER_RANK[role.tier ?? 'senior'];
}

/**
 * A factory that builds a CouncilMember for a role seated on a model. INJECTED so the orchestrator
 * is mockable: tests pass a factory returning a stub member; production passes one that wires a
 * real adapter. Returns null when the role couldn't be seated (no model) — that role is skipped.
 */
export type RoleMemberFactory = (assignment: RoleAssignment) => CouncilMember | null;

export interface RoleDeliberationResult extends DeliberationResult {
  /** Who sat in which chair + why (capability-probe audit trail). */
  readonly assignments: readonly RoleAssignment[];
  /** The roles that actually got a seated member (in tier order, the deliberation sequence). */
  readonly seatedRoles: readonly string[];
  /** A reasoned read of any disagreement that remained at the end (after all rounds). */
  readonly disagreement: DisagreementSummary;
}

/**
 * Run a role-aware deliberation: assign models → roles, seat members (tier-ordered), deliberate.
 *
 * @param roles   the council roles (lenses with Thorsen tiers) — e.g. LOCAL_COUNCIL_ROLES.
 * @param models  the models discovered on this machine (from discoverOllamaModels). Empty → the
 *                assignments are all null-model and no member is seated (graceful no-op).
 * @param input   the council input (the draft + topic) the panel deliberates over.
 * @param makeMember  factory {role,model} → CouncilMember | null (injected; mockable).
 * @param options pass-through to deliberate (timeout/weighting/etc).
 *
 * Never throws. If fewer than one role seats, there is nothing to deliberate — the caller gets a
 * 1-round result over whatever (possibly zero) notes, exactly like the degenerate panel case.
 */
export async function deliberateWithRoles(
  roles: readonly CouncilLens[],
  models: readonly DiscoveredOllamaModel[],
  input: CouncilInput,
  makeMember: RoleMemberFactory,
  options: {
    readonly timeoutMs?: number;
    readonly weightFor?: (note: CouncilMemberNote) => number;
    readonly maxItems?: number;
    readonly escalateBelow?: number;
  } = {},
): Promise<RoleDeliberationResult> {
  const assignments = assignModelsToRoles(models, roles);

  // Seat members in TIER ORDER (senior first → distinguished last) so the deliberation sequence
  // reads top-down by altitude. Pair each member with its role tier for the ordering.
  const seated = assignments
    .map((a) => ({ assignment: a, member: makeMember(a), rank: tierRank(a.role) }))
    .filter((x): x is { assignment: RoleAssignment; member: CouncilMember; rank: number } => x.member !== null)
    .sort((a, b) => a.rank - b.rank);

  const members = seated.map((x) => x.member);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const consensusOpts = { weightFor: options.weightFor, maxItems: options.maxItems, escalateBelow: options.escalateBelow };

  // Rounds 1 (think) → 2 (critique, peer-aware). deliberate handles the split-panel gate.
  const result = await deliberate(members, input, options);
  let consensus = result.consensus;
  let rounds = result.rounds;

  // ── Round 3: VERIFICATION / agreement. Only when critique left the panel STILL split — give
  // each role one final peer-aware pass framed as "verify or concede": confirm your verdict
  // against the others, or move toward the emerging consensus if you can't defend the gap. This
  // is the disagreement-handling step — it gives genuine dissent a last chance to reconcile (or
  // to hold with a reason) rather than freezing the round-2 split. Sequential, bounded, no model
  // plumbing change. Only runs if round 2 actually ran (rounds === 2) and is still split. ──
  if (rounds === 2 && isSplit(consensus.notes)) {
    const round2Notes = consensus.notes;
    const round3: CouncilMemberNote[] = [];
    for (const m of members) {
      const peers = buildPeerNotes(round2Notes.filter((n) => n.memberId !== m.id));
      // verify=true signals the member this is the reconciliation pass (read in the prompt layer
      // when wired to real adapters; mocks can branch on it). Additive to CouncilInput.
      const note = await reviewVerification(m, { ...input, peerNotes: peers }, timeoutMs);
      round3.push(note ?? round2Notes.find((n) => n.memberId === m.id) ?? note!);
    }
    consensus = reachConsensus(round3.filter(Boolean), consensusOpts);
    rounds = 3;
  }

  return {
    consensus,
    rounds,
    round1Notes: result.round1Notes,
    assignments,
    seatedRoles: seated.map((x) => x.assignment.role.id),
    disagreement: summariseDisagreement(consensus.notes),
  };
}

/** Run a member's verification pass with the same outer-timeout safety as the other rounds. */
async function reviewVerification(
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
