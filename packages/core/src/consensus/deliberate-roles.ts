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

import type { CouncilInput, CouncilMember, CouncilMemberNote } from './types.js';
import type { DiscoveredOllamaModel } from '../models/ollama-discovery.js';
import type { CouncilLens } from './member.js';
import { THORSEN_TIER_RANK } from './member.js';
import { assignModelsToRoles, type RoleAssignment } from './role-assignment.js';
import { deliberate, type DeliberationResult } from './deliberate.js';

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
  const result = await deliberate(members, input, options);

  return {
    ...result,
    assignments,
    seatedRoles: seated.map((x) => x.assignment.role.id),
  };
}
