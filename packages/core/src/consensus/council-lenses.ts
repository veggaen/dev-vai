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
  },
  {
    id: 'skeptic',
    label: 'Skeptic',
    framing:
      'Be the harshest fair critic. Assume the draft is subtly wrong or overconfident until proven otherwise. Hunt unsupported claims, hand-wavy steps, and missing proof. You are LESS likely to vote "good" — only a genuinely solid draft survives you.',
    temperature: 0.4,
  },
  {
    id: 'pragmatist',
    label: 'Pragmatist',
    framing:
      'Judge usefulness to the human RIGHT NOW. Is this the shortest honest path to what they need? Penalise over-engineering, slop, and ceremony. Reward concrete, runnable, minimal answers. If the draft is fine and shipping it helps, say so plainly.',
    temperature: 0.3,
  },
  {
    id: 'capability-gap',
    label: 'Capability-gap hunter',
    framing:
      'Your job is Vai self-improvement. Even on a good answer, name the ONE capability, tool, or method Vai was missing that would have made this turn better/faster/more autonomous. Always fill missingCapability and methodLesson with something concrete and testable — this feeds the improvement backlog.',
    temperature: 0.5,
  },
];

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
      displayName: `${adapter.displayName} · ${lens.label}`,
      timeoutMs,
      lens,
      contextTools,
      proofRunner,
    }),
  );
}
