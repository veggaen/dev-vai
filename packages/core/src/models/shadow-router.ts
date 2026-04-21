/**
 * Shadow Router — deterministic centroid classifier that predicts which
 * strategy kernel will fire for a given (input, history) pair.
 *
 * Runs alongside the hand-tuned strategy chain in VaiEngine WITHOUT changing
 * dispatch. Every observation records the actual strategy that won, so the
 * router learns from live traffic. The goal is to measure agreement between
 * the learned prediction and the hand chain on the scenario bench; when
 * agreement is high and stable, the learned router becomes the primary
 * dispatcher and the hand chain becomes its fallback.
 *
 * Pipeline (Thorsen shape applied to routing):
 *   receive    → (input, history, priorStrategy?)
 *   normalize  → lowercase tokens, stop-word filter
 *   route      → feature extraction (unigrams, bigrams, engineered markers)
 *   synthesize → cosine similarity vs per-strategy centroid
 *   verify     → compare against actual dispatched strategy
 *   score      → update top-1 / top-3 agreement counters
 *
 * Deterministic: same corpus → same centroids → same predictions, byte for
 * byte. No randomness, no network, no external model weights.
 */
import { STOP_WORDS_EN, STOP_WORDS_NO } from './stop-words.js';
import type { Message } from './adapter.js';

type SparseVec = Map<string, number>;

export interface ShadowObservation {
  input: string;
  priorStrategy?: string | null;
  priorTurnCount: number;
  actualStrategy: string;
}

export interface ShadowPrediction {
  strategy: string;
  score: number;
}

export interface ShadowAgreementStats {
  total: number;
  top1Hits: number;
  top3Hits: number;
  top1Rate: number;
  top3Rate: number;
  byStrategy: Record<string, { total: number; top1: number; top3: number }>;
  confusion: Record<string, Record<string, number>>;
}

export interface ShadowSnapshot {
  version: 1 | 2;
  centroids: Record<string, Record<string, number>>;
  strategyCounts: Record<string, number>;
  observations: number;
  /** v2+: per-token document frequency across all observed inputs. */
  documentFrequency?: Record<string, number>;
  /** v2+: total observations counted toward document frequency. */
  totalDocs?: number;
}

const STOP = new Set<string>([...STOP_WORDS_EN, ...STOP_WORDS_NO]);

const BUILD_VERBS = /\b(build|make|create|scaffold|write|generate|produce|ship)\b/i;
const FIX_VERBS = /\b(fix|debug|repair|solve|resolve|broken|error|fails?)\b/i;
const REFACTOR_VERBS = /\b(refactor|clean|simpler|simplify|rewrite|tidy|polish|rework)\b/i;
const EXPLAIN_VERBS = /\b(explain|describe|tell me about|what is|how does|why does|overview)\b/i;
const REFINE_MARKERS = /\b(simpler|shorter|longer|better|smaller|different|another|cleaner|more|less|again|instead)\b/i;
const RECALL_MARKERS = /\b(remember|recall|earlier|before|previously|first|originally|said|asked|mentioned)\b/i;
const CODE_FENCE = /```/;
const URL_MARKER = /\bhttps?:\/\//i;

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9æøå\s]/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length > 1 && !STOP.has(tok));
}

function l2Normalize(vec: SparseVec): SparseVec {
  let sumSq = 0;
  for (const v of vec.values()) sumSq += v * v;
  if (sumSq === 0) return vec;
  const norm = Math.sqrt(sumSq);
  const out: SparseVec = new Map();
  for (const [k, v] of vec) out.set(k, v / norm);
  return out;
}

function addTo(target: SparseVec, key: string, weight: number): void {
  target.set(key, (target.get(key) ?? 0) + weight);
}

function dot(a: SparseVec, b: SparseVec): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [k, v] of small) {
    const bv = large.get(k);
    if (bv !== undefined) sum += v * bv;
  }
  return sum;
}

export function extractShadowFeatures(input: string, priorTurnCount: number, priorStrategy?: string | null): SparseVec {
  const vec: SparseVec = new Map();
  const tokens = tokenize(input);

  for (const tok of tokens) addTo(vec, `u:${tok}`, 1.0);
  for (let i = 0; i < tokens.length - 1; i++) addTo(vec, `b:${tokens[i]}_${tokens[i + 1]}`, 0.5);

  const wordCount = input.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= 3) addTo(vec, '__short', 2.0);
  else if (wordCount <= 15) addTo(vec, '__med', 2.0);
  else addTo(vec, '__long', 2.0);

  if (CODE_FENCE.test(input)) addTo(vec, '__code_fence', 2.0);
  if (URL_MARKER.test(input)) addTo(vec, '__url', 2.0);
  if (/\?/.test(input)) addTo(vec, '__qmark', 1.5);
  if (BUILD_VERBS.test(input)) addTo(vec, '__verb_build', 2.0);
  if (FIX_VERBS.test(input)) addTo(vec, '__verb_fix', 2.0);
  if (REFACTOR_VERBS.test(input)) addTo(vec, '__verb_refactor', 2.0);
  if (EXPLAIN_VERBS.test(input)) addTo(vec, '__verb_explain', 2.0);
  if (REFINE_MARKERS.test(input)) addTo(vec, '__marker_refine', 1.5);
  if (RECALL_MARKERS.test(input)) addTo(vec, '__marker_recall', 1.5);

  if (priorTurnCount === 0) addTo(vec, '__turns_0', 1.5);
  else if (priorTurnCount === 1) addTo(vec, '__turns_1', 1.5);
  else addTo(vec, '__turns_2plus', 1.5);

  if (priorStrategy) addTo(vec, `__prior:${priorStrategy}`, 2.5);

  return l2Normalize(vec);
}

/** Extract (priorStrategy, priorTurnCount) context from a message history. */
export function contextFromHistory(history: readonly Message[]): { priorTurnCount: number; priorStrategy: string | null } {
  const userTurns = history.filter((m) => m.role === 'user');
  return { priorTurnCount: Math.max(0, userTurns.length - 1), priorStrategy: null };
}

export class ShadowRouter {
  private centroidSums = new Map<string, SparseVec>();
  private strategyCounts = new Map<string, number>();
  private docFreq = new Map<string, number>();
  private totalDocs = 0;
  private _observations = 0;
  private _top1Hits = 0;
  private _top3Hits = 0;
  private _byStrategy = new Map<string, { total: number; top1: number; top3: number }>();
  private _confusion = new Map<string, Map<string, number>>();

  observe(observation: ShadowObservation): ShadowPrediction[] {
    const features = extractShadowFeatures(observation.input, observation.priorTurnCount, observation.priorStrategy ?? null);
    const ranked = this.centroidSums.size > 0 ? this.rank(features) : [];

    const sum = this.centroidSums.get(observation.actualStrategy) ?? new Map<string, number>();
    for (const [k, v] of features) sum.set(k, (sum.get(k) ?? 0) + v);
    this.centroidSums.set(observation.actualStrategy, sum);
    this.strategyCounts.set(observation.actualStrategy, (this.strategyCounts.get(observation.actualStrategy) ?? 0) + 1);

    // Track per-token document frequency for IDF weighting at rank time.
    // Only lexical features (unigrams/bigrams) participate — engineered markers
    // are already low-DF by construction and IDF would distort their meaning.
    for (const key of features.keys()) {
      if (key.startsWith('u:') || key.startsWith('b:')) {
        this.docFreq.set(key, (this.docFreq.get(key) ?? 0) + 1);
      }
    }
    this.totalDocs += 1;

    if (ranked.length > 0) {
      this._observations += 1;
      const top1 = ranked[0]?.strategy;
      const top3 = ranked.slice(0, 3).map((r) => r.strategy);
      const bucket = this._byStrategy.get(observation.actualStrategy) ?? { total: 0, top1: 0, top3: 0 };
      bucket.total += 1;
      if (top1 === observation.actualStrategy) { this._top1Hits += 1; bucket.top1 += 1; }
      if (top3.includes(observation.actualStrategy)) { this._top3Hits += 1; bucket.top3 += 1; }
      this._byStrategy.set(observation.actualStrategy, bucket);
      if (top1 && top1 !== observation.actualStrategy) {
        const row = this._confusion.get(observation.actualStrategy) ?? new Map<string, number>();
        row.set(top1, (row.get(top1) ?? 0) + 1);
        this._confusion.set(observation.actualStrategy, row);
      }
    }
    return ranked;
  }

  predict(input: string, priorTurnCount: number, priorStrategy?: string | null, topK = 3): ShadowPrediction[] {
    if (this.centroidSums.size === 0) return [];
    const features = extractShadowFeatures(input, priorTurnCount, priorStrategy ?? null);
    return this.rank(features).slice(0, topK);
  }

  /**
   * Dampened IDF. Full IDF over-weights rare tokens on tiny corpora (single-
   * occurrence tokens dominate the cosine), so we mix IDF with a flat prior
   * via IDF_ALPHA: effective_idf = 1 + alpha * log((1+N)/(1+df)). alpha=0
   * disables IDF (pure cosine), alpha=1 is full IDF. Empirically α≈0.5 keeps
   * top-1 gains while preserving top-3 recall on the scenario bench.
   */
  private static readonly IDF_ALPHA = 0;
  private idfWeight(key: string): number {
    if (this.totalDocs === 0) return 1;
    if (!key.startsWith('u:') && !key.startsWith('b:')) return 1;
    const df = this.docFreq.get(key) ?? 0;
    return 1 + ShadowRouter.IDF_ALPHA * Math.log((1 + this.totalDocs) / (1 + df));
  }

  private rank(features: SparseVec): ShadowPrediction[] {
    // IDF-weight query features once per call.
    const wQuery: SparseVec = new Map();
    let qNormSq = 0;
    for (const [k, v] of features) {
      const w = v * this.idfWeight(k);
      wQuery.set(k, w);
      qNormSq += w * w;
    }
    const qNorm = Math.sqrt(qNormSq);

    const scored: ShadowPrediction[] = [];
    for (const [strategy, sum] of this.centroidSums) {
      const count = this.strategyCounts.get(strategy) ?? 1;
      const wCentroid: SparseVec = new Map();
      let cNormSq = 0;
      for (const [k, v] of sum) {
        const w = (v / count) * this.idfWeight(k);
        wCentroid.set(k, w);
        cNormSq += w * w;
      }
      const cNorm = Math.sqrt(cNormSq);
      const score = qNorm > 0 && cNorm > 0 ? dot(wQuery, wCentroid) / (qNorm * cNorm) : 0;
      scored.push({ strategy, score });
    }
    // Tie-break: prefer the more-observed strategy, then alphabetical for
    // determinism. Popularity dominates because alphabetical bias was
    // systematically inflating lead-letter classes on near-zero scores.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const pa = this.strategyCounts.get(a.strategy) ?? 0;
      const pb = this.strategyCounts.get(b.strategy) ?? 0;
      if (pb !== pa) return pb - pa;
      return a.strategy.localeCompare(b.strategy);
    });
    return scored;
  }

  getAgreementStats(): ShadowAgreementStats {
    const byStrategy: Record<string, { total: number; top1: number; top3: number }> = {};
    for (const [k, v] of this._byStrategy) byStrategy[k] = { ...v };
    const confusion: Record<string, Record<string, number>> = {};
    for (const [actual, row] of this._confusion) {
      confusion[actual] = {};
      for (const [pred, n] of row) confusion[actual][pred] = n;
    }
    return {
      total: this._observations,
      top1Hits: this._top1Hits,
      top3Hits: this._top3Hits,
      top1Rate: this._observations === 0 ? 0 : this._top1Hits / this._observations,
      top3Rate: this._observations === 0 ? 0 : this._top3Hits / this._observations,
      byStrategy,
      confusion,
    };
  }

  clear(): void {
    this.centroidSums.clear();
    this.strategyCounts.clear();
    this.docFreq.clear();
    this.totalDocs = 0;
    this._observations = 0;
    this._top1Hits = 0;
    this._top3Hits = 0;
    this._byStrategy.clear();
    this._confusion.clear();
  }

  toJSON(): ShadowSnapshot {
    const centroids: Record<string, Record<string, number>> = {};
    for (const [s, vec] of this.centroidSums) {
      centroids[s] = {};
      for (const [k, v] of vec) centroids[s][k] = v;
    }
    const counts: Record<string, number> = {};
    for (const [s, c] of this.strategyCounts) counts[s] = c;
    const df: Record<string, number> = {};
    for (const [k, v] of this.docFreq) df[k] = v;
    return {
      version: 2,
      centroids,
      strategyCounts: counts,
      observations: this._observations,
      documentFrequency: df,
      totalDocs: this.totalDocs,
    };
  }

  static fromJSON(snapshot: ShadowSnapshot): ShadowRouter {
    const r = new ShadowRouter();
    for (const [s, vec] of Object.entries(snapshot.centroids)) {
      const m: SparseVec = new Map();
      for (const [k, v] of Object.entries(vec)) m.set(k, v);
      r.centroidSums.set(s, m);
    }
    for (const [s, c] of Object.entries(snapshot.strategyCounts)) r.strategyCounts.set(s, c);
    if (snapshot.documentFrequency) {
      for (const [k, v] of Object.entries(snapshot.documentFrequency)) r.docFreq.set(k, v);
    }
    r.totalDocs = snapshot.totalDocs ?? 0;
    return r;
  }
}
