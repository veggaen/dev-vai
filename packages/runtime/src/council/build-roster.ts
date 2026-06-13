/**
 * Council roster builder — turns the live, free, local model adapters into a
 * {@link CouncilRoster} so the SCIS consensus council (`convene`) actually runs.
 *
 * Free-only by design: members are the local Ollama models already registered
 * (qwen variants, etc.). No paid keys are read here. The BYOK seam is documented
 * at the bottom — a hosted adapter dropped into the registry would slot in via the
 * exact same `createCouncilMember` path, but nothing here requires one.
 *
 * Topic mapping: a single local model is a generalist, so it sits on the roster
 * `default` (convened for every topic). When two or more distinct local models
 * exist we spread them across topics so the panel has independent voices on the
 * niches that benefit most (code / reasoning / factual), while every member also
 * stays on `default` for breadth. De-dupe in `selectMembers` keeps that honest.
 */

import { createCouncilMember } from '@vai/core';
import type { CouncilMember, CouncilRoster, CouncilTopic, ModelAdapter, ModelRegistry } from '@vai/core';

/** Topics we prefer to seat a dedicated specialist on when we have spare members. */
const SPECIALIST_TOPICS: readonly CouncilTopic[] = ['code', 'reasoning', 'factual', 'local'];

export interface BuildRosterOptions {
  /** Per-member review timeout. Council is advisory, so keep it tight. Default 12_000. */
  readonly timeoutMs?: number;
  /** Cap on how many local models become members (cost/latency guard). Default 3. */
  readonly maxMembers?: number;
}

/**
 * Build a council roster from the registry's local adapters. Returns `undefined`
 * when there is nothing free to convene — callers leave `councilRoster` unset so
 * the council stays dormant (no behavior change) rather than convening an empty panel.
 */
export function buildLocalCouncilRoster(
  models: Pick<ModelRegistry, 'listByProvider'>,
  options: BuildRosterOptions = {},
): CouncilRoster | undefined {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxMembers = Math.max(1, options.maxMembers ?? 3);

  const localAdapters = models.listByProvider('local');
  if (localAdapters.length === 0) return undefined;

  // Stable order: cheaper/smaller first so the generalist seat is predictable.
  const chosen = [...localAdapters].slice(0, maxMembers);

  const byTopic: Partial<Record<CouncilTopic, CouncilMember[]>> = {};
  const defaultMembers: CouncilMember[] = [];

  chosen.forEach((adapter, index) => {
    // First member is the always-on generalist (sits on `default`, every topic).
    // Extra members each anchor one specialist niche AND stay on default for breadth.
    const specialistTopic = index === 0 ? 'other' : SPECIALIST_TOPICS[(index - 1) % SPECIALIST_TOPICS.length];
    const member = createCouncilMember({
      adapter: adapter as ModelAdapter,
      topic: specialistTopic,
      timeoutMs,
    });
    defaultMembers.push(member);
    if (specialistTopic !== 'other') {
      (byTopic[specialistTopic] ??= []).push(member);
    }
  });

  return { byTopic, default: defaultMembers };
}

/*
 * BYOK seam (intentionally not wired — no paid keys in use):
 *
 *   const hosted = models.tryGet('anthropic:claude-...') ?? models.tryGet('openai:...');
 *   if (hosted) defaultMembers.push(createCouncilMember({ adapter: hosted, topic: 'reasoning' }));
 *
 * Any adapter registered from a user-supplied key becomes a member with no other
 * change. Kept here so adding a key later is a one-liner, not a redesign.
 */
