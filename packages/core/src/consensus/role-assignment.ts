/**
 * Capability-probe role assignment (Thorsen-inspired role-based deliberation, Milestone 1).
 *
 * The dynamic, future-proof half of the role layer: given the models actually available on
 * THIS machine right now (from Ollama discovery — `discoverOllamaModels`) and the council's
 * roles (lenses carrying a Thorsen tier), decide which model each role should run on. Nothing
 * is hardcoded — a newer/better/smaller model that appears is picked up automatically, and a
 * weaker machine with fewer models degrades gracefully.
 *
 * Policy (grounded in the Thorsen doctrine — higher altitude = more architectural authority):
 *   - Rank available models by capability (reuse `rankDiscoveredModels`).
 *   - Assign the MOST capable models to the HIGHEST tiers (distinguished/principal), because
 *     those roles do the deepest reasoning and shape Vai's evolution. Lower tiers (senior) can
 *     run a lighter model — which also helps the crash-safe budget (cheaper where it suffices).
 *   - Fewer distinct models than roles → reuse the best-fit model across roles (mirrors today's
 *     single-adapter-multi-lens reality). More models than roles → the extras stay unused.
 *
 * PURE + dependency-free (no I/O): the caller supplies already-discovered models, so this
 * unit-tests without Ollama. It only DECIDES the mapping; building members stays in the
 * existing council-lenses/member code. Consensus math is untouched.
 */

import type { DiscoveredOllamaModel } from '../models/ollama-discovery.js';
import { rankDiscoveredModels } from '../models/ollama-discovery.js';
import type { CouncilLens, ThorsenTier } from './member.js';
import { THORSEN_TIER_RANK } from './member.js';

/** One role seated on a concrete model for this run. */
export interface RoleAssignment {
  /** The role (lens) being seated. */
  readonly role: CouncilLens;
  /** The model chosen to run it (Ollama name, e.g. "qwen3:8b"), or null if none available. */
  readonly modelName: string | null;
  /** Why this model was chosen — auditable (capability-probe transparency). */
  readonly reason: string;
}

/** A role must carry a Thorsen tier to be assignable; plain lenses fall back to tier rank 0. */
function tierRank(role: CouncilLens): number {
  return role.tier ? THORSEN_TIER_RANK[role.tier as ThorsenTier] : 0;
}

/**
 * Assign the best available model to each role by capability, highest tier first.
 *
 * @param models  Models discovered on this machine (any order; ranked internally).
 * @param roles   Council roles (lenses with tiers) to seat.
 * @returns       One assignment per role, in the SAME order as `roles` (stable for the UI).
 *                Every assignment is auditable via `.reason`. Never throws.
 */
export function assignModelsToRoles(
  models: readonly DiscoveredOllamaModel[],
  roles: readonly CouncilLens[],
): RoleAssignment[] {
  // Chat/reasoning models only — embedding models can't review a draft.
  const usable = rankDiscoveredModels(models.filter((m) => !m.embedding));

  if (usable.length === 0) {
    return roles.map((role) => ({ role, modelName: null, reason: 'no local chat model discovered' }));
  }

  // Seat the strongest models on the highest tiers. Sort role INDEXES by tier desc (stable on
  // ties) so we hand out `usable[0]` (strongest) to the most senior role first, then reuse the
  // best-fit model when there are more roles than distinct models.
  const order = roles
    .map((role, index) => ({ index, rank: tierRank(role) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index);

  const out: RoleAssignment[] = new Array(roles.length);
  order.forEach((entry, seat) => {
    const role = roles[entry.index];
    // Strongest model to the first (highest-tier) seat; clamp so extra roles reuse the best
    // remaining model rather than running out — graceful degradation on small machines.
    const model = usable[Math.min(seat, usable.length - 1)];
    const reused = seat >= usable.length;
    out[entry.index] = {
      role,
      modelName: model.name,
      reason: reused
        ? `reused ${model.name} (more roles than models; ${role.tier ?? 'untiered'} role)`
        : `best available for ${role.tier ?? 'untiered'} tier: ${model.name}` +
          (model.parameterB ? ` (~${model.parameterB}B${model.thinking ? ', thinking' : ''})` : ''),
    };
  });
  return out;
}
