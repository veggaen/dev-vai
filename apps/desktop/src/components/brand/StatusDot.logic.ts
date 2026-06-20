/**
 * StatusDot.logic — pure mapping from a council member's live status to its visual
 * presentation (tone token, label, whether it should breathe). Kept separate from the
 * component so the green/amber/red contract is unit-tested without a DOM.
 *
 * Mirrors the backend `MemberLiveStatus` ('available' | 'cooldown' | 'down') — see
 * packages/core/src/consensus/council.ts. Anything unrecognized degrades to a neutral
 * "unknown" rather than throwing, so an older runtime never breaks the card.
 */

export type MemberLiveStatus = 'available' | 'cooldown' | 'down';

export interface StatusPresentation {
  /** CSS custom-property name carrying the tone color. */
  readonly toneVar: string;
  /** Short word shown next to / under the dot. */
  readonly label: string;
  /** Longer tooltip explaining the state. */
  readonly title: string;
  /** Only a healthy, active member breathes — a calm "alive" signal, not an alarm. */
  readonly breathe: boolean;
  /** Stable key for styling hooks / tests. */
  readonly kind: 'available' | 'cooldown' | 'down' | 'unknown';
}

const PRESENTATIONS: Record<StatusPresentation['kind'], StatusPresentation> = {
  available: {
    toneVar: '--tone-good',
    label: 'Active',
    title: 'Seated and healthy — responding this turn.',
    breathe: true,
    kind: 'available',
  },
  cooldown: {
    toneVar: '--tone-warn',
    label: 'Resting',
    title: 'Recently failed; the council is resting it and will retry after a short cooldown.',
    breathe: false,
    kind: 'cooldown',
  },
  down: {
    toneVar: '--tone-bad',
    label: 'Down',
    title: 'Unavailable — needs attention before it can rejoin.',
    breathe: false,
    kind: 'down',
  },
  unknown: {
    toneVar: '--color-muted',
    label: 'Unknown',
    title: 'Status not reported.',
    breathe: false,
    kind: 'unknown',
  },
};

/** Map a raw status string (possibly from an older/newer runtime) to its presentation. */
export function presentStatus(status: string | undefined | null): StatusPresentation {
  switch (status) {
    case 'available':
      return PRESENTATIONS.available;
    case 'cooldown':
      return PRESENTATIONS.cooldown;
    case 'down':
      return PRESENTATIONS.down;
    default:
      return PRESENTATIONS.unknown;
  }
}

/** True when at least one member is down/resting — drives a roster-level summary affordance. */
export function rosterHasTrouble(statuses: readonly (string | undefined)[]): boolean {
  return statuses.some((s) => s === 'down' || s === 'cooldown');
}
