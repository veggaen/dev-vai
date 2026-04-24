/**
 * Thorsen Intent Protocol — Typed intent-to-artifact pipeline.
 *
 * Instead of natural language prompts, intents are structured packets
 * with a fixed schema. The runtime resolves them into verified artifacts.
 *
 * The Thorsen Curve defines three sync states based on end-to-end latency:
 *   Linear   (>200ms)  — single modality, confused
 *   Parallel (100-200ms) — multi-modal braid, emerging
 *   Wormhole (<100ms)  — unified, language-agnostic
 *
 * @author V3gga Thorsen
 */

/* ── Intent Packet ────────────────────────────────────────────── */

/** Actions the synthesizer can perform */
export type ThorsenAction = 'create' | 'optimize' | 'debug' | 'explain' | 'transpile' | 'test' | 'converse';

/** Target domains for synthesis */
export type ThorsenDomain =
  | 'calculator'
  | 'component'
  | 'api-route'
  | 'utility'
  | 'dataset'
  | 'pipeline'
  | 'vai-drill'
  | 'test'
  | 'cognitive-test'
  | 'custom';

/** Logic paradigm hint */
export type ThorsenLogicType = 'functional' | 'stateful' | 'reactive' | 'declarative';

/** Target execution environment */
export type ThorsenTargetEnv = 'node' | 'browser' | 'wsl2' | 'docker' | 'edge';

/** Target output language */
export type ThorsenLanguage = 'typescript' | 'python' | 'rust' | 'go' | 'auto';

/**
 * The core intent packet — replaces natural language prompts.
 * 2-6 structured fields encode the full intent.
 */
export interface ThorsenIntent {
  /** What to do */
  action: ThorsenAction;
  /** Target domain / artifact type */
  domain: ThorsenDomain;
  /** Paradigm hint (default: 'functional') */
  logicType?: ThorsenLogicType;
  /** Where it runs (default: 'node') */
  targetEnv?: ThorsenTargetEnv;
  /** Output language (default: 'typescript') */
  language?: ThorsenLanguage;
  /** Free-form specification when domain='custom' */
  spec?: string;
  /** Optional constraints (e.g. "no external deps", "< 50 lines") */
  constraints?: string[];
  /** Microsecond timestamp for latency measurement */
  timestampUs?: number;
}

/* ── Software Artifact (output) ───────────────────────────────── */

export interface ThorsenArtifact {
  /** Output language */
  language: string;
  /** Generated code */
  code: string;
  /** Suggested filename */
  filename: string;
  /** Thorsen sync score: 0.0-1.0 — how well the artifact matches intent */
  thorsenScore: number;
  /** Whether the artifact was verified (ran without errors) */
  verified: boolean;
  /** Verification output (stdout or error) */
  verifyOutput?: string;
}

/* ── Sync Status (latency measurement) ────────────────────────── */

export type ThorsenSyncState = 'linear' | 'parallel' | 'wormhole';

export interface ThorsenSyncStatus {
  /** Current sync state based on latency */
  state: ThorsenSyncState;
  /** Round-trip latency in milliseconds */
  latencyMs: number;
  /** Whether intent was successfully resolved */
  resolved: boolean;
}

/* ── Full Response ────────────────────────────────────────────── */

export interface ThorsenResponse {
  artifact: ThorsenArtifact;
  sync: ThorsenSyncStatus;
  /** Engine stats at time of synthesis */
  engineStats?: {
    vocabSize: number;
    knowledgeEntries: number;
    documentsIndexed: number;
  };
}

/* ── Thorsen Curve thresholds (ms) ────────────────────────────── */

export const THORSEN_CURVE = {
  /** Above this = Linear (confused) */
  LINEAR_THRESHOLD: 200,
  /** Below this = Wormhole (unified) */
  WORMHOLE_THRESHOLD: 100,
  /** Adaptive concurrency windows — derived from sync state */
  CONCURRENCY: {
    wormhole: { min: 10, max: 50 },
    parallel: { min: 3, max: 10 },
    linear:   { min: 1, max: 3 },
  },
} as const;

/**
 * Classify latency into a Thorsen Curve state.
 */
export function classifySyncState(latencyMs: number): ThorsenSyncState {
  if (latencyMs < THORSEN_CURVE.WORMHOLE_THRESHOLD) return 'wormhole';
  if (latencyMs <= THORSEN_CURVE.LINEAR_THRESHOLD) return 'parallel';
  return 'linear';
}

/* ── Conversation Curve ───────────────────────────────────────── */

/** Per-turn quality point (from ConversationScorer CurvePoint) */
export interface ConversationCurvePoint {
  readonly turnIndex: number;
  readonly turnScore: number;
  readonly cumulativeScore: number;
  readonly slope: number;
}

/**
 * Conversation-level quality trajectory mapped onto the Thorsen Curve.
 *
 * A "wormhole conversation" has: turnsBeforeDecay === null, avgSlope > 0,
 * and points.length >= 20 — meaning quality never drops and grows over time.
 */
export interface ConversationCurve {
  readonly points: readonly ConversationCurvePoint[];
  readonly state: ThorsenSyncState;
  readonly avgSlope: number;
  readonly contextRetentionScore: number;
  readonly turnsBeforeDecay: number | null;
}

/* ── Adaptive Throughput Controller ───────────────────────────── */

/**
 * Thorsen Adaptive Controller — adjusts concurrency based on observed latency.
 *
 * The Thorsen Curve becomes actionable: instead of just labeling latency,
 * the controller uses a sliding window of measurements to adapt throughput.
 *
 * When the system is fast (wormhole), push more concurrent work.
 * When the system is slow (linear), throttle to avoid overload.
 *
 * This is the "dynamic wormhole usage" — optimize resources based on
 * real-time performance, not fixed static configuration.
 */
export class ThorsenAdaptiveController {
  private readonly window: number[] = [];
  private readonly windowSize: number;
  private _concurrency: number;

  constructor(opts?: { windowSize?: number; initialConcurrency?: number }) {
    this.windowSize = opts?.windowSize ?? 20;
    this._concurrency = opts?.initialConcurrency ?? 5;
  }

  /** Record a latency observation and recalculate optimal concurrency. */
  observe(latencyMs: number): void {
    this.window.push(latencyMs);
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }
    this.recalculate();
  }

  /** Current recommended concurrency level. */
  get concurrency(): number {
    return this._concurrency;
  }

  /** Current dominant sync state based on the sliding window. */
  get state(): ThorsenSyncState {
    if (this.window.length === 0) return 'parallel';
    const avg = this.window.reduce((a, b) => a + b, 0) / this.window.length;
    return classifySyncState(avg);
  }

  /** Median latency of the current window. */
  get medianLatency(): number {
    if (this.window.length === 0) return 0;
    const sorted = [...this.window].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /** P95 latency of the current window. */
  get p95Latency(): number {
    if (this.window.length === 0) return 0;
    const sorted = [...this.window].sort((a, b) => a - b);
    return sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)];
  }

  private recalculate(): void {
    const state = this.state;
    const band = THORSEN_CURVE.CONCURRENCY[state];

    // Smooth adjustment: move toward the target band's middle
    const target = Math.round((band.min + band.max) / 2);

    // Don't jump — step toward target by 1-2 each observation
    if (this._concurrency < band.min) {
      this._concurrency = Math.min(this._concurrency + 2, band.min);
    } else if (this._concurrency > band.max) {
      this._concurrency = Math.max(this._concurrency - 2, band.max);
    } else if (this._concurrency < target) {
      this._concurrency = Math.min(this._concurrency + 1, target);
    } else if (this._concurrency > target) {
      this._concurrency = Math.max(this._concurrency - 1, target);
    }
  }

  /** Reset the controller to initial state. */
  reset(): void {
    this.window.length = 0;
    this._concurrency = 5;
  }

  /** Get a snapshot of the controller's state for observability. */
  snapshot(): {
    state: ThorsenSyncState;
    concurrency: number;
    medianLatency: number;
    p95Latency: number;
    windowSize: number;
    observations: number;
  } {
    return {
      state: this.state,
      concurrency: this._concurrency,
      medianLatency: this.medianLatency,
      p95Latency: this.p95Latency,
      windowSize: this.windowSize,
      observations: this.window.length,
    };
  }
}
