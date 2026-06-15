/**
 * CapabilityOutcomeLedger — close the kernel's learning loop.
 *
 * The capability kernel was DESIGNED to learn: every `ScoreBreakdown` carries a `history`
 * term ("historical success rate of this capability on similar turns (learned)"). But every
 * capability hardcodes `history: 0.5` (neutral), so the term is dead — git can verify-pass a
 * thousand times and a flaky capability can verify-fail half its turns, and the dispatcher
 * ranks them identically forever. This ledger is the missing half: it records each
 * capability's real outcomes and computes a learned `history` signal the dispatcher folds
 * into the score, so routing gets measurably better with use.
 *
 * What it records per (capability) — and optionally per (capability, turn-class), so a
 * capability that's reliable on one kind of turn but not another is learned separately:
 *   - chosen          : it won the turn
 *   - verifyPassed    : its answer bound to evidence and was released (the success signal)
 *   - verifyFailed    : it composed an answer that FAILED its own verify gate (a real miss —
 *                       it claimed something it couldn't ground)
 *   - declined        : it scored high but resolve()→null (benign; not counted against it)
 *   - userPositive /  : downstream feedback on a turn it won
 *     userNegative
 *
 * The learned history is a smoothed success rate in [0,1], Laplace-shrunk toward the 0.5
 * cold-start so a capability with little data stays near neutral (no overconfident swings
 * from one outcome). Pure, bounded, serializable — the same shape as the confidence ledger.
 */

export type CapabilityOutcomeKind =
  | 'verifyPassed'
  | 'verifyFailed'
  | 'declined'
  | 'userPositive'
  | 'userNegative';

export interface CapabilityStat {
  /** Capability name (and turn-class suffix when scoped). */
  readonly key: string;
  /** Times this capability won AND its answer passed verify (the success signal). */
  passes: number;
  /** Times it composed an answer that failed its own verify gate (a grounding miss). */
  verifyFails: number;
  /** Times it declined after scoring high (resolve→null) — benign, tracked for insight. */
  declines: number;
  /** Positive downstream feedback on a turn it won. */
  userPositive: number;
  /** Negative downstream feedback on a turn it won. */
  userNegative: number;
  /** Last update (ms since epoch). */
  lastTouchedMs: number;
}

export interface CapabilityLedgerSnapshot {
  readonly stats: readonly CapabilityStat[];
}

export interface CapabilityLedgerOptions {
  /**
   * Laplace/shrinkage strength: how many "virtual neutral observations" anchor a key to
   * 0.5 before real data dominates. Higher = slower, steadier learning. Default 4.
   */
  readonly priorStrength?: number;
  /** Weight of a negative user-feedback signal relative to a verify-fail. Default 1. */
  readonly userNegativeWeight?: number;
  /** Weight of a positive user-feedback signal relative to a verify-pass. Default 0.5. */
  readonly userPositiveWeight?: number;
}

const DEFAULTS: Required<CapabilityLedgerOptions> = {
  priorStrength: 4,
  userNegativeWeight: 1,
  userPositiveWeight: 0.5,
};

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export class CapabilityOutcomeLedger {
  private readonly stats = new Map<string, CapabilityStat>();
  private readonly opts: Required<CapabilityLedgerOptions>;

  constructor(options: CapabilityLedgerOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * The learned history signal for a capability in [0,1]. Combines verify outcomes and user
   * feedback into a smoothed success rate, Laplace-shrunk toward 0.5 so a key with little
   * data stays near neutral. Unknown keys return exactly 0.5 (the kernel's cold-start).
   */
  history(name: string, turnClass?: string): number {
    const scoped = turnClass ? this.stats.get(this.key(name, turnClass)) : undefined;
    // Prefer the turn-class-scoped stat when it has data; else the global stat.
    const stat = scoped && (scoped.passes + scoped.verifyFails + scoped.userPositive + scoped.userNegative) > 0
      ? scoped
      : this.stats.get(name);
    if (!stat) return 0.5;

    const successes =
      stat.passes + this.opts.userPositiveWeight * stat.userPositive;
    const failures =
      stat.verifyFails + this.opts.userNegativeWeight * stat.userNegative;
    const total = successes + failures;
    if (total <= 0) return 0.5;

    // Laplace smoothing toward 0.5: (successes + p/2) / (total + p).
    const p = this.opts.priorStrength;
    return clamp01((successes + p / 2) / (total + p));
  }

  /** Record one outcome for a capability (and optionally its turn-class scope). */
  record(name: string, kind: CapabilityOutcomeKind, turnClass?: string, now: number = Date.now()): void {
    if (!name) return;
    this.apply(this.entry(name, now), kind, now);
    if (turnClass) this.apply(this.entry(this.key(name, turnClass), now), kind, now);
  }

  /** Snapshot a capability's global stat, or null if unknown. */
  get(name: string): Readonly<CapabilityStat> | null {
    return this.stats.get(name) ?? null;
  }

  size(): number {
    return this.stats.size;
  }

  clear(): void {
    this.stats.clear();
  }

  serialize(): CapabilityLedgerSnapshot {
    return { stats: Array.from(this.stats.values()).map((s) => ({ ...s })) };
  }

  restore(snapshot: CapabilityLedgerSnapshot): void {
    this.stats.clear();
    for (const s of snapshot.stats) this.stats.set(s.key, { ...s });
  }

  private apply(stat: CapabilityStat, kind: CapabilityOutcomeKind, now: number): void {
    switch (kind) {
      case 'verifyPassed': stat.passes += 1; break;
      case 'verifyFailed': stat.verifyFails += 1; break;
      case 'declined': stat.declines += 1; break;
      case 'userPositive': stat.userPositive += 1; break;
      case 'userNegative': stat.userNegative += 1; break;
    }
    stat.lastTouchedMs = now;
  }

  private entry(key: string, now: number): CapabilityStat {
    let stat = this.stats.get(key);
    if (!stat) {
      stat = { key, passes: 0, verifyFails: 0, declines: 0, userPositive: 0, userNegative: 0, lastTouchedMs: now };
      this.stats.set(key, stat);
    }
    return stat;
  }

  private key(name: string, turnClass: string): string {
    return `${name}@${turnClass}`;
  }
}

/** A read-only history provider the kernel/dispatcher can consult without the full ledger. */
export interface HistoryProvider {
  history(name: string, turnClass?: string): number;
}
