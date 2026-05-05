/**
 * KnowledgeConfidenceLedger
 * ─────────────────────────
 * A tiny in-memory ledger that tracks Vai's *self-assessed* confidence on
 * every topic it has talked about. The ledger is updated by two signals:
 *
 *  1. **Response signal** (`recordResponse`) — every emitted response
 *     contributes +Δ to its topic confidence, scaled by the strategy's
 *     baseline confidence.
 *  2. **User feedback signal** (`recordFeedback`) — when the next user
 *     turn is corrective ("no", "wrong", "actually no"), the previous
 *     topic's confidence is penalized; when it's affirmative ("yes",
 *     "correct", "thanks"), it's reinforced.
 *
 * The `dream()` method is an offline consolidation pass: it sweeps the
 * ledger, decays stale entries, surfaces low-confidence topics that need
 * review, and promotes consistently-high-confidence topics. It returns a
 * structured report the engine can log and the UI can render.
 *
 * Design notes:
 *  - Pure in-memory by default. Persistence is the engine's concern; the
 *    ledger only exposes `serialize()` / `restore()` for round-tripping.
 *  - All math is bounded to [0, 1] to keep scores interpretable.
 *  - No timers, no I/O, no globals. Safe to instantiate per-engine.
 */

export type FeedbackSignal = 'positive' | 'negative' | 'neutral';

export interface ConfidenceEntry {
  /** Normalized topic key (lowercased, trimmed). */
  readonly topic: string;
  /** Current confidence in [0, 1]. */
  confidence: number;
  /** Number of responses that contributed to this entry. */
  responses: number;
  /** Last update timestamp (ms since epoch). */
  lastTouchedMs: number;
  /** Cumulative positive feedback count. */
  positiveFeedback: number;
  /** Cumulative negative feedback count. */
  negativeFeedback: number;
  /** Strategies that contributed (set of strategy ids). */
  readonly strategies: Set<string>;
}

export interface DreamReport {
  /** Total topics scanned. */
  readonly scanned: number;
  /** Topics whose confidence dropped below the review threshold. */
  readonly needsReview: readonly string[];
  /** Topics that crossed the consolidation threshold during this pass. */
  readonly promoted: readonly string[];
  /** Topics decayed for staleness (no activity in `staleAfterMs`). */
  readonly decayed: readonly string[];
  /** Wall-clock duration of the sweep, in milliseconds. */
  readonly durationMs: number;
}

export interface LedgerSnapshot {
  readonly topics: ReadonlyArray<{
    readonly topic: string;
    readonly confidence: number;
    readonly responses: number;
    readonly lastTouchedMs: number;
    readonly positiveFeedback: number;
    readonly negativeFeedback: number;
    readonly strategies: readonly string[];
  }>;
}

const POSITIVE_FEEDBACK_RE = /^(?:yes|yep|yeah|correct|right|exactly|perfect|thanks?|thx|ty|thank\s+you|nice|great|good|ok\s*cool|that['\s]?s\s+(?:right|correct|it))[\s!.?]*$/i;
const NEGATIVE_FEEDBACK_RE = /\b(?:no|nope|wrong|incorrect|not\s+(?:right|correct|quite|really)|that['\s]?s\s+(?:not|wrong)|actually(?:\s+no)?|you['\s]?re\s+wrong|that['\s]?s\s+not\s+what\s+i\s+meant)\b/i;

export interface LedgerOptions {
  /** Topics not touched within this window are decayed during dream(). */
  readonly staleAfterMs?: number;
  /** Multiplicative decay applied to stale topics during dream(). */
  readonly staleDecay?: number;
  /** Confidence threshold below which topics are flagged needsReview. */
  readonly reviewThreshold?: number;
  /** Confidence threshold above which a topic counts as promoted. */
  readonly promoteThreshold?: number;
  /** Penalty applied per negative feedback signal. */
  readonly negativePenalty?: number;
  /** Reinforcement applied per positive feedback signal. */
  readonly positiveReward?: number;
}

const DEFAULTS: Required<LedgerOptions> = {
  staleAfterMs: 1000 * 60 * 60 * 24 * 7, // one week
  staleDecay: 0.85,
  reviewThreshold: 0.35,
  promoteThreshold: 0.8,
  negativePenalty: 0.25,
  positiveReward: 0.1,
};

export class KnowledgeConfidenceLedger {
  private readonly entries = new Map<string, ConfidenceEntry>();
  private readonly opts: Required<LedgerOptions>;
  /**
   * Topic → previously-promoted flag. Used so `dream()` only reports
   * NEW promotions per pass, not the same one over and over.
   */
  private readonly previouslyPromoted = new Set<string>();

  constructor(options: LedgerOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * Record that a response was emitted for `topic`. The strategy's
   * baseline confidence (in [0, 1]) is blended into the topic's running
   * confidence using a small learning rate.
   */
  recordResponse(topic: string, strategy: string, strategyConfidence: number, now: number = Date.now()): void {
    const key = this.normalize(topic);
    if (key.length === 0) return;
    const clamped = clamp01(strategyConfidence);
    const entry = this.entries.get(key) ?? this.createEntry(key, now);
    // Exponential moving average so confidence smooths over many turns.
    const alpha = 0.3;
    entry.confidence = clamp01(entry.confidence * (1 - alpha) + clamped * alpha);
    entry.responses += 1;
    entry.lastTouchedMs = now;
    entry.strategies.add(strategy);
    this.entries.set(key, entry);
  }

  /**
   * Record a user feedback signal targeting the most-recent topic. Returns
   * the resolved signal so callers can trace what was applied.
   */
  recordFeedback(topic: string, userMessage: string, now: number = Date.now()): FeedbackSignal {
    const key = this.normalize(topic);
    if (key.length === 0) return 'neutral';
    const entry = this.entries.get(key);
    if (!entry) return 'neutral';
    const signal = classifyFeedback(userMessage);
    if (signal === 'positive') {
      entry.confidence = clamp01(entry.confidence + this.opts.positiveReward);
      entry.positiveFeedback += 1;
      entry.lastTouchedMs = now;
    } else if (signal === 'negative') {
      entry.confidence = clamp01(entry.confidence - this.opts.negativePenalty);
      entry.negativeFeedback += 1;
      entry.lastTouchedMs = now;
    }
    return signal;
  }

  /** Snapshot a single topic's entry, or `null` if unknown. */
  get(topic: string): Readonly<ConfidenceEntry> | null {
    return this.entries.get(this.normalize(topic)) ?? null;
  }

  /** Number of topics tracked. */
  size(): number {
    return this.entries.size;
  }

  /**
   * Run an offline consolidation pass. Decays stale topics, flags
   * low-confidence topics for review, and reports newly-promoted topics.
   */
  dream(now: number = Date.now()): DreamReport {
    const start = now;
    const needsReview: string[] = [];
    const promoted: string[] = [];
    const decayed: string[] = [];

    for (const entry of this.entries.values()) {
      const ageMs = now - entry.lastTouchedMs;
      if (ageMs > this.opts.staleAfterMs) {
        const before = entry.confidence;
        entry.confidence = clamp01(entry.confidence * this.opts.staleDecay);
        if (entry.confidence < before) decayed.push(entry.topic);
      }
      if (entry.confidence < this.opts.reviewThreshold) {
        needsReview.push(entry.topic);
      }
      if (entry.confidence >= this.opts.promoteThreshold && !this.previouslyPromoted.has(entry.topic)) {
        promoted.push(entry.topic);
        this.previouslyPromoted.add(entry.topic);
      }
      if (entry.confidence < this.opts.promoteThreshold) {
        // If a topic falls back below the bar, allow re-promotion next time.
        this.previouslyPromoted.delete(entry.topic);
      }
    }

    return {
      scanned: this.entries.size,
      needsReview,
      promoted,
      decayed,
      durationMs: Math.max(0, Date.now() - start),
    };
  }

  /** Wipe the ledger. Used by tests and `engine.reset()`. */
  clear(): void {
    this.entries.clear();
    this.previouslyPromoted.clear();
  }

  /** Serialize for persistence. Sets are flattened to arrays. */
  serialize(): LedgerSnapshot {
    return {
      topics: Array.from(this.entries.values()).map((e) => ({
        topic: e.topic,
        confidence: e.confidence,
        responses: e.responses,
        lastTouchedMs: e.lastTouchedMs,
        positiveFeedback: e.positiveFeedback,
        negativeFeedback: e.negativeFeedback,
        strategies: Array.from(e.strategies),
      })),
    };
  }

  /** Restore from a previous `serialize()` snapshot. Replaces current state. */
  restore(snapshot: LedgerSnapshot): void {
    this.entries.clear();
    this.previouslyPromoted.clear();
    for (const t of snapshot.topics) {
      this.entries.set(t.topic, {
        topic: t.topic,
        confidence: clamp01(t.confidence),
        responses: t.responses,
        lastTouchedMs: t.lastTouchedMs,
        positiveFeedback: t.positiveFeedback,
        negativeFeedback: t.negativeFeedback,
        strategies: new Set(t.strategies),
      });
      if (t.confidence >= this.opts.promoteThreshold) {
        this.previouslyPromoted.add(t.topic);
      }
    }
  }

  private createEntry(topic: string, now: number): ConfidenceEntry {
    return {
      topic,
      confidence: 0.5,
      responses: 0,
      lastTouchedMs: now,
      positiveFeedback: 0,
      negativeFeedback: 0,
      strategies: new Set<string>(),
    };
  }

  private normalize(topic: string): string {
    return (topic ?? '').toString().trim().toLowerCase();
  }
}

/** Classify a user message into a feedback signal. Exposed for testing. */
export function classifyFeedback(message: string): FeedbackSignal {
  const trimmed = (message ?? '').trim();
  if (trimmed.length === 0) return 'neutral';
  if (POSITIVE_FEEDBACK_RE.test(trimmed)) return 'positive';
  if (NEGATIVE_FEEDBACK_RE.test(trimmed)) return 'negative';
  return 'neutral';
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
