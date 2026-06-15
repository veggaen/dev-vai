/**
 * member-availability — know WHY a council member is down, stop wasting time on it, and tell
 * the user how to fix it.
 *
 * V3gga's exact ask, from the BTC trace: Grok kept failing (403 / out of credits) and the
 * council just re-tried it every turn, logging "advisor unavailable" four times and getting
 * nothing. Instead: when a member fails, classify the REASON, record an availability state,
 * and SKIP that member on subsequent turns until the state is likely resolved — and surface a
 * concrete fix to the user ("add credits" / "switch account"). When the member succeeds again,
 * the state clears automatically.
 *
 * Deterministic and pure: a small in-memory (serializable) store keyed by member id. No
 * timers — "should I retry yet?" is a function of the recorded time + a per-reason cooldown,
 * evaluated when the roster is built. The point is that the council stops burning cycles on a
 * member that cannot help until something actually changes.
 */

/** Why a member is unavailable — drives the cooldown and the user-facing fix. */
export type UnavailabilityReason =
  | 'no-credits'      // 402 / "out of credits" / usage exhausted — needs user action
  | 'auth'            // 401 / 403 / forbidden / invalid key — needs user action
  | 'rate-limited'    // 429 / too many requests — clears on its own, short cooldown
  | 'timeout'         // the member didn't respond in time — transient, short cooldown
  | 'network'         // connection refused / DNS / offline — transient
  | 'unknown';        // anything else

export interface MemberAvailability {
  readonly memberId: string;
  readonly memberName: string;
  /** 'available' once cleared; 'unavailable' while in a recorded failure state. */
  readonly status: 'available' | 'unavailable';
  readonly reason: UnavailabilityReason;
  /** Human-readable reason detail (the error tail), for the trace. */
  readonly detail: string;
  /** A concrete fix the USER can take, when the reason needs user action. */
  readonly fixHint: string;
  /** When the failure was recorded (ms). */
  readonly since: number;
  /** Consecutive failures — escalates the cooldown so a flapping member backs off. */
  readonly failureCount: number;
}

/** Per-reason base cooldown (ms) before it's worth retrying the member. */
const COOLDOWN_MS: Record<UnavailabilityReason, number> = {
  // User-action reasons: long cooldown — retrying won't help until the user fixes it, but we
  // still re-check occasionally in case they added credits / switched account.
  'no-credits': 30 * 60_000,
  'auth': 30 * 60_000,
  // Transient reasons: short cooldown — likely to recover on its own.
  'rate-limited': 60_000,
  'timeout': 2 * 60_000,
  'network': 2 * 60_000,
  'unknown': 5 * 60_000,
};

/** Classify a raw error string/object into a reason. */
export function classifyUnavailability(error: unknown): UnavailabilityReason {
  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  if (/\b(402|out of credits|no credits|insufficient (?:credit|balance|funds|quota)|usage|billing|upgrade|supergrok)\b/.test(msg)) return 'no-credits';
  if (/\b(401|403|forbidden|unauthor|invalid (?:api )?key|authentication|permission denied)\b/.test(msg)) return 'auth';
  if (/\b(429|rate.?limit|too many requests|quota exceeded)\b/.test(msg)) return 'rate-limited';
  if (/\b(timed? ?out|timeout|deadline|aborted|etimedout)\b/.test(msg)) return 'timeout';
  if (/\b(econnrefused|enotfound|network|offline|dns|socket hang up|fetch failed|connect)\b/.test(msg)) return 'network';
  return 'unknown';
}

/** The concrete fix the user can take for a reason (empty when nothing to do). */
export function fixHintFor(reason: UnavailabilityReason, memberName: string): string {
  switch (reason) {
    case 'no-credits':
      return `${memberName} is out of credits. Add credits or switch to an account with available usage to re-enable it.`;
    case 'auth':
      return `${memberName} rejected the request (auth/forbidden). Check the API key or switch to a valid account.`;
    case 'rate-limited':
      return `${memberName} is rate-limited right now; it will retry automatically after a short cooldown.`;
    case 'timeout':
    case 'network':
      return `${memberName} didn't respond (transient); it will retry automatically shortly.`;
    default:
      return `${memberName} is temporarily unavailable; it will retry after a cooldown.`;
  }
}

/** True when a reason requires the USER to act (vs clearing on its own). */
export function needsUserAction(reason: UnavailabilityReason): boolean {
  return reason === 'no-credits' || reason === 'auth';
}

export interface MemberAvailabilitySnapshot {
  readonly members: readonly MemberAvailability[];
}

/**
 * Tracks per-member availability so the council can skip a member that cannot help until its
 * state is likely resolved. Pure/in-memory; serialize()/restore() round-trips it.
 */
export class MemberAvailabilityStore {
  private readonly states = new Map<string, MemberAvailability>();

  /** Record a member failure, classifying the reason and escalating its failure count. */
  recordFailure(memberId: string, memberName: string, error: unknown, now: number = Date.now()): MemberAvailability {
    const reason = classifyUnavailability(error);
    const detail = (error instanceof Error ? error.message : String(error ?? '')).slice(0, 160);
    const prev = this.states.get(memberId);
    const state: MemberAvailability = {
      memberId,
      memberName,
      status: 'unavailable',
      reason,
      detail,
      fixHint: fixHintFor(reason, memberName),
      since: now,
      failureCount: (prev?.memberId === memberId ? prev.failureCount : 0) + 1,
    };
    this.states.set(memberId, state);
    return state;
  }

  /** Record a member SUCCESS — clears any unavailability state. */
  recordSuccess(memberId: string): void {
    this.states.delete(memberId);
  }

  /** Current state for a member, or null if it has no recorded failure. */
  get(memberId: string): MemberAvailability | null {
    return this.states.get(memberId) ?? null;
  }

  /**
   * Should the council bother trying this member now? False while the member is within its
   * (failure-count-escalated) cooldown — so the council stops burning cycles on it. True once
   * the cooldown elapses (a re-check, in case the user fixed it) or if it was never failing.
   */
  shouldTry(memberId: string, now: number = Date.now()): boolean {
    const state = this.states.get(memberId);
    if (!state || state.status === 'available') return true;
    // Escalate the cooldown with consecutive failures (cap at 4×) so a persistently-dead
    // member backs off further, but we still re-check eventually.
    const base = COOLDOWN_MS[state.reason];
    const cooldown = base * Math.min(4, state.failureCount);
    return now - state.since >= cooldown;
  }

  /** All members currently unavailable (for the UI / a status surface). */
  unavailable(): MemberAvailability[] {
    return [...this.states.values()].filter((s) => s.status === 'unavailable');
  }

  /** User-facing fix hints for members that need the user to act. */
  userActionHints(): string[] {
    return this.unavailable()
      .filter((s) => needsUserAction(s.reason))
      .map((s) => s.fixHint);
  }

  clear(): void {
    this.states.clear();
  }

  serialize(): MemberAvailabilitySnapshot {
    return { members: [...this.states.values()].map((s) => ({ ...s })) };
  }

  restore(snapshot: MemberAvailabilitySnapshot): void {
    this.states.clear();
    for (const s of snapshot.members) this.states.set(s.memberId, { ...s });
  }
}
