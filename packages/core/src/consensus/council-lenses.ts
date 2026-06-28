/**
 * Multi-angle local council lenses.
 *
 * One local model is a single voice. To get genuine deliberation from a free, on-device stack
 * (and to STOP depending on a paid external voice like Grok), we run the SAME local adapter
 * through several distinct lenses. Each lens reframes the review so the model attacks the draft
 * from a different angle; the resulting notes are mixed and re-judged by the existing consensus
 * machinery exactly as if they came from different models.
 *
 * Design choices (validated against the crash-safe constraint — one heavy task at a time, bounded
 * work): lenses are CHEAP framings on top of the base prompt, capped small, and each is given a
 * slightly different temperature so the angles don't collapse onto the same deterministic
 * completion. The first lens stays at temperature 0 (a stable anchor); later lenses warm up.
 */

import type { CouncilLens, CouncilMemberOptions } from './member.js';
import { createCouncilMember } from './member.js';
import type { CouncilMember, CouncilTopic } from './types.js';

/**
 * Ordered lens set. Index 0 is the deterministic anchor; later entries add diversity.
 * Order matters: callers take the first N. Keep the highest-signal angles first.
 */
export const LOCAL_COUNCIL_LENSES: readonly CouncilLens[] = [
  {
    id: 'intent',
    label: 'Intent reader',
    framing:
      'Focus above all on the REAL intent and any hidden/secondary meaning. Did Vai answer the question the user actually asked, or a nearby one? Catch misread asks, scope drift, and "they wanted an answer but Vai started building" mistakes.',
    temperature: 0,
    // ROLE (Thorsen-inspired): front-line correctness — does the work meet the literal ask?
    tier: 'senior',
    mandate: 'Guard front-line correctness: verify Vai answered the REAL ask, not a nearby one.',
    weight: 1,
  },
  {
    id: 'skeptic',
    label: 'Skeptic',
    framing:
      'Be the harshest fair critic. Assume the draft is subtly wrong or overconfident until proven otherwise. Hunt unsupported claims, hand-wavy steps, and missing proof. You are LESS likely to vote "good" — only a genuinely solid draft survives you.',
    temperature: 0.4,
    // ROLE: cross-cutting risk + quality enforcement (Staff/Lead altitude).
    tier: 'staff',
    mandate: 'Enforce quality + risk: hunt unsupported claims and missing proof before anything ships.',
    weight: 1.1,
  },
  {
    id: 'pragmatist',
    label: 'Pragmatist',
    framing:
      'Judge usefulness to the human RIGHT NOW. Is this the shortest honest path to what they need? Penalise over-engineering, slop, and ceremony. Reward concrete, runnable, minimal answers. If the draft is fine and shipping it helps, say so plainly.',
    temperature: 0.3,
    // ROLE: systemic usefulness + direction — is this the right shape of answer? (Principal).
    tier: 'principal',
    mandate: 'Judge systemic usefulness: the shortest honest path; penalise over-engineering and slop.',
    weight: 1.1,
  },
  {
    id: 'capability-gap',
    label: 'Capability-gap hunter',
    framing:
      'Your job is Vai self-improvement. Even on a good answer, name the ONE capability, tool, or method Vai was missing that would have made this turn better/faster/more autonomous. Always fill missingCapability and methodLesson with something concrete and testable — this feeds the improvement backlog.',
    temperature: 0.5,
    // ROLE: institutional doctrine + Vai's own evolution (Distinguished — "thinks in decades").
    tier: 'distinguished',
    mandate: "Drive Vai's evolution: name the one missing capability/method that compounds future turns.",
    weight: 1,
  },
];

/**
 * The same set, named as ROLES for the Thorsen-inspired role-based deliberation system
 * (Milestone 1). Every entry above now carries `tier`/`mandate`/`weight`, so a "role" is just
 * a lens that has been seated on the Thorsen seniority ladder. This alias is the role-facing
 * name; `LOCAL_COUNCIL_LENSES` stays for backward-compatible callers.
 */
export const LOCAL_COUNCIL_ROLES = LOCAL_COUNCIL_LENSES;

/** True when a lens has been promoted to a full role (carries a Thorsen tier). */
export function isRole(lens: CouncilLens): boolean {
  return typeof lens.tier === 'string';
}

/** One role seated on a specific adapter (the capability-probe's decision made concrete). */
export interface RoleSeat {
  readonly role: CouncilLens;
  readonly adapter: CouncilMemberOptions['adapter'];
}

export interface RoleMembersOptions {
  readonly seats: readonly RoleSeat[];
  readonly topic: CouncilTopic;
  readonly timeoutMs?: number;
  readonly idPrefix?: string;
  readonly contextTools?: CouncilMemberOptions['contextTools'];
  readonly proofRunner?: CouncilMemberOptions['proofRunner'];
}

/**
 * Build council members from explicit (role → adapter) seats. Unlike `buildLocalLensMembers`
 * (one adapter, N lenses), this seats EACH role on its OWN assigned model — the runtime form
 * of the capability probe (`assignModelsToRoles`): the distinguished/principal roles can run a
 * stronger model than the senior role. Each member is labelled with its role + tier so the
 * panel reads as a seniority ladder of distinct voices. Falls back gracefully — a seat whose
 * adapter is the same as another's is fine (multiple roles can share one model on a small box).
 */
export function buildRoleMembers(options: RoleMembersOptions): CouncilMember[] {
  const { seats, topic, timeoutMs, contextTools, proofRunner } = options;
  return seats.map(({ role, adapter }) =>
    createCouncilMember({
      adapter,
      topic,
      id: `${options.idPrefix ?? 'role'}-${role.id}-${adapter.id}`,
      displayName: role.tier
        ? `${adapter.displayName} · ${role.label} · ${role.tier}`
        : `${adapter.displayName} · ${role.label}`,
      timeoutMs,
      lens: role,
      contextTools,
      proofRunner,
    }),
  );
}

export interface LocalLensMembersOptions {
  /** The local model every lens runs on. */
  readonly adapter: CouncilMemberOptions['adapter'];
  /** Topic seat for these members (usually 'reasoning' or 'other'). */
  readonly topic: CouncilTopic;
  /** How many lenses to seat (clamped to [1, LOCAL_COUNCIL_LENSES.length]). */
  readonly count: number;
  readonly timeoutMs?: number;
  /** Prefix for member ids so lens members don't collide with the plain adapter member. */
  readonly idPrefix?: string;
  /** Optional read-only context tools (pull-model) passed to every lens member. */
  readonly contextTools?: CouncilMemberOptions['contextTools'];
  /** Optional proof runner (experiment loop) passed to every lens member. */
  readonly proofRunner?: CouncilMemberOptions['proofRunner'];
}

/**
 * Build N lens-backed council members from a single local adapter. Returns one {@link CouncilMember}
 * per lens, each with a distinct id/displayName so the panel and timeline show them as separate
 * voices. `count <= 1` returns a single anchor-lens member (still labelled so the UI is honest about
 * what it is).
 */
export function buildLocalLensMembers(options: LocalLensMembersOptions): CouncilMember[] {
  const { adapter, topic, timeoutMs, contextTools, proofRunner } = options;
  const max = LOCAL_COUNCIL_LENSES.length;
  const count = Math.min(max, Math.max(1, Math.floor(options.count) || 1));
  const prefix = options.idPrefix ?? adapter.id;
  return LOCAL_COUNCIL_LENSES.slice(0, count).map((lens) =>
    createCouncilMember({
      adapter,
      topic,
      id: `${prefix}-lens-${lens.id}`,
      // Surface the Thorsen tier in the display name when this lens is a role, so the panel
      // reads as a seniority ladder ("Skeptic · staff") and not just a flat list of angles.
      displayName: lens.tier
        ? `${adapter.displayName} · ${lens.label} · ${lens.tier}`
        : `${adapter.displayName} · ${lens.label}`,
      timeoutMs,
      lens,
      contextTools,
      proofRunner,
    }),
  );
}
