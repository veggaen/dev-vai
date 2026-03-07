/**
 * Knowledge Intelligence Engine — makes VaiEngine smarter without external APIs.
 *
 * Decompose → Connect → Hygiene → Query
 *
 * This module implements four capabilities:
 *
 * 1. DECOMPOSITION: Break knowledge entries and questions into atomic facts.
 *    Like breaking "0123010230123033" into blocks "0123, 0102, 3012, 3033"
 *    and finding sub-pattern "01" appears 3 times.
 *
 * 2. CONNECTIONS: Build a graph linking entries that share sub-patterns.
 *    Weight edges by how many patterns they share. Enable traversal
 *    for finding related knowledge during answer generation.
 *
 * 3. HYGIENE: Clean the knowledge base — deduplicate, merge related entries,
 *    remove low-quality content, strengthen confirmed patterns.
 *
 * 4. QUESTION DECOMPOSITION: Break complex questions into simpler sub-questions,
 *    answer each independently, combine into a composite response.
 *
 * All algorithmic. No embeddings. No external APIs. Pure pattern intelligence.
 */

import { KnowledgeStore, type KnowledgeEntry } from './vai-engine.js';
import { STOP_WORDS } from './stop-words.js';

// ─── Types ──────────────────────────────────────────────────────

/**
 * Classification of an atomic fact based on its textual content.
 * Enables answer composition to pick the right fact type for the question type
 * (definitions for "what is X", procedures for "how to X", etc.).
 */
export type FactType = 'definition' | 'example' | 'comparison' | 'procedure' | 'fact';

/**
 * An atomic fact decomposed from a knowledge entry.
 *
 * These are transient, in-memory decomposition artifacts rebuilt on each
 * `build()` call. The entryIndex is stable within a single build cycle.
 *
 * Why no id/hash/version:
 * - `id`: Nothing references individual facts by ID. The connection graph
 *   works at entry level. Adding a numeric id without refactoring the graph
 *   to fact-level granularity would be a dead field.
 * - `hash`: Useful for dedup, but `buildSubPatterns` doesn't consume
 *   AtomicFact — it works directly on entries with n-grams. Hash without
 *   the dedup consumer is dead code.
 * - `version`: Facts are wiped and rebuilt from scratch on every build().
 *   There is nothing to version. The field would always be 1.
 */
export interface AtomicFact {
  readonly text: string;
  readonly words: string[];
  /** Index into KnowledgeStore.entries — stable within one build cycle */
  readonly entryIndex: number;
  /** Copied from the parent entry — avoids entry lookup in downstream consumers */
  readonly source: string;
  /** Derived from entry source tier — enables quality-weighted answer composition */
  readonly confidence: number;
  /** Classified from text analysis — enables type-appropriate answer selection */
  readonly type: FactType;
}

export interface SubPattern {
  readonly key: string;         // normalized joined words
  readonly words: string[];
  frequency: number;   // mutable: incremented during build
  entryIndices: number[]; // mutable: appended during build
}

export interface Connection {
  readonly from: number;
  readonly to: number;
  readonly weight: number;
  readonly sharedPatterns: string[];
  /** How this connection was discovered */
  readonly type: 'sub-pattern' | 'word-overlap' | 'mixed';
}

export interface DuplicateGroup {
  readonly canonical: number;
  readonly duplicates: number[];
  readonly similarity: number;
}

export interface HygieneReport {
  readonly duplicatesFound: number;
  readonly entriesMerged: number;
  readonly lowQualityRemoved: number;
  readonly totalBefore: number;
  readonly totalAfter: number;
}

// ── Functional QuestionType Grouping ──────────────────────────────
// Grouped by cognitive function rather than alphabetical prefix.
// This scales cleanly as new types are added.

/** Interrogative W-questions: seek facts, identity, location, time */
export type InterrogativeType = 'what' | 'why' | 'when' | 'where' | 'who' | 'which';
/** Procedural H-questions: seek process, steps, method */
export type ProceduralType = 'how';
/** Operational questions: comparison, enumeration, catch-all */
export type OperationalType = 'compare' | 'list' | 'general';
/** All question types — the master union */
export type QuestionType = InterrogativeType | ProceduralType | OperationalType;

/** Category lookup for downstream dispatch (if needed in future) */
export type QuestionCategory = 'interrogative' | 'procedural' | 'operational';
export function classifyQuestionCategory(type: QuestionType): QuestionCategory {
  switch (type) {
    case 'what': case 'why': case 'when': case 'where': case 'who': case 'which':
      return 'interrogative';
    case 'how':
      return 'procedural';
    case 'compare': case 'list': case 'general':
      return 'operational';
  }
}

export interface SubQuestion {
  readonly text: string;
  readonly type: QuestionType;
}

export interface SubAnswer {
  readonly question: string;
  readonly answer: string;
  readonly confidence: number;
  readonly source: string;
  /** Which retrieval method found this answer */
  readonly answerStrategy: 'direct' | 'pattern' | 'document';
  /** Index into KnowledgeStore.entries — enables traceability back to the knowledge base */
  readonly entryIndex?: number;
}

export interface CompositeAnswer {
  readonly text: string;
  readonly subAnswers: readonly SubAnswer[];
  readonly confidence: number;
  readonly strategy: 'decomposed' | 'connected' | 'direct';
  /** All knowledge entry indices that contributed to this answer */
  readonly entryIndices: readonly number[];
}

// ─── Constants ──────────────────────────────────────────────────

// Shared bilingual stop words from stop-words.ts (EN + NO)

/** Minimum sub-pattern length (words) */
const MIN_SUBPATTERN_LEN = 2;

/** Maximum sub-pattern length (words) */
const MAX_SUBPATTERN_LEN = 4;

/** Minimum frequency for a sub-pattern to be kept */
const MIN_SUBPATTERN_FREQ = 2;

/** Similarity threshold for deduplication */
const DUPLICATE_THRESHOLD = 0.75;

/** Quality score below which entries get flagged */
const LOW_QUALITY_THRESHOLD = 0.15;

/** Minimum connection weight to create an edge */
const MIN_CONNECTION_WEIGHT = 0.2;

// ── Answer scoring thresholds ──

/** Minimum confidence for a sub-answer to be included in decomposed results */
const DECOMPOSED_SUB_MIN = 0.15;

/** Direct match score above which we accept without fallback */
const DIRECT_MATCH_STRONG = 0.4;

/** Direct match fallback threshold (weaker but acceptable) */
const DIRECT_MATCH_WEAK = 0.2;

/** Minimum TF-IDF document match score */
const DOC_MATCH_MIN = 0.05;

/** Cap for document match confidence */
const DOC_MATCH_CAP = 0.7;

/** Normalize pattern score by dividing by this factor */
const PATTERN_SCORE_DIVISOR = 3;

/** Maximum pattern-derived confidence */
const PATTERN_SCORE_CAP = 0.85;

/** Jaccard threshold for overlap/dedup detection */
const OVERLAP_JACCARD_THRESHOLD = 0.6;

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Derive a 0–1 confidence score from the entry source.
 * Bootstrap and user-taught entries are highly trusted; web/youtube less so.
 */
function sourceConfidence(source: string): number {
  if (source === 'user-taught') return 0.95;
  if (source.includes('vcus')) return 0.90;
  if (source.startsWith('bootstrap')) return 0.85;
  if (source === 'auto-learned') return 0.70;
  if (source.includes('youtube')) return 0.40;
  return 0.60; // web ingested, unknown
}

/**
 * Classify a text fragment into a FactType based on linguistic signals.
 * Not ML — just pattern-based heuristics, which is fine for enriching composition.
 */
function classifyFact(text: string): FactType {
  const lower = text.toLowerCase();

  // Definition: "X is a ...", "X refers to ...", "X means ..."
  if (/\b(?:is a|is an|is the|refers to|means|defined as|stands for)\b/.test(lower)) return 'definition';

  // Procedure: "to X, do Y", "step 1", "first ... then", "use X to", "run X"
  if (/\b(?:step \d|first[,.]|then[,.]|to do this|how to|run |install |use .+ to|execute|configure)\b/.test(lower)) return 'procedure';

  // Example: code blocks, "for example", "e.g.", "such as", "like"
  if (/```|`[^`]+`|\b(?:for example|e\.g\.|such as|for instance)\b/.test(lower)) return 'example';

  // Comparison: "vs", "compared to", "unlike", "whereas", "better than", "faster than"
  if (/\b(?:vs\.?|compared to|unlike|whereas|better than|faster than|slower than|differs from|difference between)\b/.test(lower)) return 'comparison';

  // Default: a statement of fact
  return 'fact';
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
}

function meaningfulWords(text: string): string[] {
  return tokenize(text).filter(w => !STOP_WORDS.has(w) && w.length > 2);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function nGrams(words: string[], n: number): string[] {
  const result: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    result.push(words.slice(i, i + n).join(' '));
  }
  return result;
}

// ─── KnowledgeDecomposer ────────────────────────────────────────

export class KnowledgeDecomposer {
  private subPatternIndex: Map<string, SubPattern> = new Map();

  /**
   * Decompose a text string into atomic facts by splitting on sentence
   * boundaries and conjunctions.
   *
   * @param text - The text to decompose (entry pattern + response, or just response)
   * @param entryIndex - Index into KnowledgeStore.entries
   * @param source - Entry source string (for confidence + provenance)
   */
  decomposeText(text: string, entryIndex: number, source = 'unknown'): AtomicFact[] {
    const facts: AtomicFact[] = [];
    const conf = sourceConfidence(source);

    // Split by sentence boundaries
    const sentences = text
      .split(/(?<=[.!?;])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 5);

    for (const sentence of sentences) {
      // Split compound sentences at conjunctions
      const clauses = sentence
        .split(/\s*(?:,\s*(?:and|but|or|however|while|whereas|although|though)\s|;\s*|\band\s+(?:also|then)\b)/i)
        .map(c => c.trim())
        .filter(c => c.length > 5 && meaningfulWords(c).length >= 2);

      if (clauses.length > 1) {
        for (const clause of clauses) {
          facts.push({
            text: clause,
            words: meaningfulWords(clause),
            entryIndex,
            source,
            confidence: conf,
            type: classifyFact(clause),
          });
        }
      } else {
        facts.push({
          text: sentence,
          words: meaningfulWords(sentence),
          entryIndex,
          source,
          confidence: conf,
          type: classifyFact(sentence),
        });
      }
    }

    // If no sentences found (short pattern), treat whole text as one fact
    if (facts.length === 0 && text.trim().length > 3) {
      facts.push({
        text: text.trim(),
        words: meaningfulWords(text),
        entryIndex,
        source,
        confidence: conf,
        type: classifyFact(text),
      });
    }

    return facts;
  }

  /**
   * Build sub-pattern index from all knowledge entries.
   * Finds recurring word sequences (n-grams of meaningful words) across entries.
   *
   * Like finding "01" appears 3 times in different blocks.
   */
  buildSubPatterns(entries: KnowledgeEntry[]): Map<string, SubPattern> {
    this.subPatternIndex.clear();

    // Count per-entry: build n-grams for each entry's pattern + response
    const entryNgrams: Map<number, Set<string>> = new Map();

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const combined = `${e.pattern} ${e.response}`;
      const words = meaningfulWords(combined);

      const grams = new Set<string>();
      for (let n = MIN_SUBPATTERN_LEN; n <= MAX_SUBPATTERN_LEN; n++) {
        for (const gram of nGrams(words, n)) {
          grams.add(gram);
        }
      }
      entryNgrams.set(i, grams);
    }

    // Count how many entries contain each n-gram
    const gramEntries: Map<string, number[]> = new Map();
    for (const [entryIdx, grams] of entryNgrams) {
      for (const gram of grams) {
        let arr = gramEntries.get(gram);
        if (!arr) {
          arr = [];
          gramEntries.set(gram, arr);
        }
        arr.push(entryIdx);
      }
    }

    // Keep only sub-patterns appearing in multiple entries
    for (const [gram, indices] of gramEntries) {
      if (indices.length >= MIN_SUBPATTERN_FREQ) {
        const words = gram.split(' ');
        this.subPatternIndex.set(gram, {
          key: gram,
          words,
          frequency: indices.length,
          entryIndices: indices,
        });
      }
    }

    return this.subPatternIndex;
  }

  /**
   * Find which sub-patterns are shared between two entries.
   */
  findSharedPatterns(entryA: number, entryB: number): SubPattern[] {
    const shared: SubPattern[] = [];
    for (const pattern of this.subPatternIndex.values()) {
      if (pattern.entryIndices.includes(entryA) && pattern.entryIndices.includes(entryB)) {
        shared.push(pattern);
      }
    }
    return shared;
  }

  /**
   * Find all entries related to a query via sub-pattern overlap.
   * Returns entries sorted by how many sub-patterns they share with the query words.
   */
  findBySubPatterns(query: string): Array<{ entryIndex: number; matchedPatterns: string[]; score: number }> {
    const queryWords = meaningfulWords(query);
    if (queryWords.length < 2) return [];

    const queryGrams = new Set<string>();
    for (let n = MIN_SUBPATTERN_LEN; n <= MAX_SUBPATTERN_LEN; n++) {
      for (const gram of nGrams(queryWords, n)) {
        queryGrams.add(gram);
      }
    }

    // Find entries that match any query sub-pattern
    const entryScores: Map<number, { patterns: string[]; score: number }> = new Map();
    for (const gram of queryGrams) {
      const pattern = this.subPatternIndex.get(gram);
      if (!pattern) continue;
      for (const idx of pattern.entryIndices) {
        let existing = entryScores.get(idx);
        if (!existing) {
          existing = { patterns: [], score: 0 };
          entryScores.set(idx, existing);
        }
        existing.patterns.push(gram);
        // Weight by inverse frequency: rarer shared patterns are more valuable
        existing.score += 1 / Math.log2(pattern.frequency + 1);
      }
    }

    return Array.from(entryScores.entries())
      .map(([entryIndex, { patterns, score }]) => ({
        entryIndex,
        matchedPatterns: patterns,
        score,
      }))
      .sort((a, b) => b.score - a.score);
  }

  get patternCount(): number {
    return this.subPatternIndex.size;
  }

  getTopPatterns(limit: number = 20): SubPattern[] {
    return Array.from(this.subPatternIndex.values())
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);
  }
}

// ─── KnowledgeConnector ─────────────────────────────────────────

export class KnowledgeConnector {
  private adjacency: Map<number, Connection[]> = new Map();
  private nodeCount = 0;

  /**
   * Build a connection graph from entries + decomposer sub-patterns.
   * Two entries are connected if they share sub-patterns or have significant
   * word overlap in their responses.
   */
  buildGraph(entries: KnowledgeEntry[], decomposer: KnowledgeDecomposer): void {
    this.adjacency.clear();
    this.nodeCount = entries.length;

    // Track edge origins to classify Connection.type
    const edgeCandidates: Map<string, { shared: string[]; weight: number; hasSubPattern: boolean; hasWordOverlap: boolean }> = new Map();

    const topPatterns = decomposer.getTopPatterns(500);
    for (const pattern of topPatterns) {
      const indices = pattern.entryIndices;
      for (let i = 0; i < indices.length; i++) {
        for (let j = i + 1; j < indices.length; j++) {
          const a = Math.min(indices[i], indices[j]);
          const b = Math.max(indices[i], indices[j]);
          const edgeKey = `${a}:${b}`;

          let edge = edgeCandidates.get(edgeKey);
          if (!edge) {
            edge = { shared: [], weight: 0, hasSubPattern: false, hasWordOverlap: false };
            edgeCandidates.set(edgeKey, edge);
          }
          edge.shared.push(pattern.key);
          edge.hasSubPattern = true;
          edge.weight += 1 / Math.log2(pattern.frequency + 1);
        }
      }
    }

    // Also add word-overlap edges for entries that share meaningful words
    // but might not share exact n-gram sub-patterns
    for (let i = 0; i < entries.length; i++) {
      const wordsA = new Set(meaningfulWords(entries[i].response));
      if (wordsA.size < 3) continue;

      for (let j = i + 1; j < entries.length; j++) {
        const wordsB = new Set(meaningfulWords(entries[j].response));
        if (wordsB.size < 3) continue;

        const sim = jaccard(wordsA, wordsB);
        if (sim < MIN_CONNECTION_WEIGHT) continue;

        const edgeKey = `${i}:${j}`;
        let edge = edgeCandidates.get(edgeKey);
        if (!edge) {
          edge = { shared: [], weight: 0, hasSubPattern: false, hasWordOverlap: false };
          edgeCandidates.set(edgeKey, edge);
        }
        edge.hasWordOverlap = true;
        edge.weight += sim;
      }
    }

    // Store adjacency with typed connections
    for (const [key, { shared, weight, hasSubPattern, hasWordOverlap }] of edgeCandidates) {
      if (weight < MIN_CONNECTION_WEIGHT) continue;
      const [a, b] = key.split(':').map(Number);

      const connType: Connection['type'] = hasSubPattern && hasWordOverlap
        ? 'mixed'
        : hasSubPattern ? 'sub-pattern' : 'word-overlap';

      const conn: Connection = { from: a, to: b, weight, sharedPatterns: shared, type: connType };

      let listA = this.adjacency.get(a);
      if (!listA) { listA = []; this.adjacency.set(a, listA); }
      listA.push(conn);

      let listB = this.adjacency.get(b);
      if (!listB) { listB = []; this.adjacency.set(b, listB); }
      listB.push({ from: b, to: a, weight, sharedPatterns: shared, type: connType });
    }
  }

  /**
   * Get directly connected entries, sorted by connection weight.
   */
  getConnected(entryIndex: number): Connection[] {
    return (this.adjacency.get(entryIndex) ?? [])
      .sort((a, b) => b.weight - a.weight);
  }

  /**
   * BFS traversal from a start entry up to a given depth.
   * Returns unique entries sorted by cumulative path weight.
   */
  traverse(startIndex: number, maxDepth: number = 2, maxResults: number = 10): Array<{ index: number; weight: number; depth: number }> {
    const visited = new Set<number>([startIndex]);
    const results: Array<{ index: number; weight: number; depth: number }> = [];
    let frontier = [{ index: startIndex, weight: 1.0 }];

    for (let depth = 1; depth <= maxDepth; depth++) {
      const nextFrontier: typeof frontier = [];
      for (const { index, weight } of frontier) {
        const connections = this.adjacency.get(index) ?? [];
        for (const conn of connections) {
          const neighbor = conn.from === index ? conn.to : conn.from;
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);

          const cumulativeWeight = weight * conn.weight;
          results.push({ index: neighbor, weight: cumulativeWeight, depth });
          nextFrontier.push({ index: neighbor, weight: cumulativeWeight });
        }
      }
      frontier = nextFrontier;
    }

    return results
      .sort((a, b) => b.weight - a.weight)
      .slice(0, maxResults);
  }

  /**
   * Find clusters: groups of tightly connected entries.
   * Uses simple connected-component detection.
   */
  findClusters(minSize: number = 3): Array<{ entries: number[]; cohesion: number }> {
    const visited = new Set<number>();
    const clusters: Array<{ entries: number[]; cohesion: number }> = [];

    for (let i = 0; i < this.nodeCount; i++) {
      if (visited.has(i) || !this.adjacency.has(i)) continue;

      // BFS to find connected component
      const component: number[] = [];
      const queue = [i];
      visited.add(i);
      let totalWeight = 0;
      let edgeCount = 0;

      while (queue.length > 0) {
        const node = queue.shift()!;
        component.push(node);
        for (const conn of this.adjacency.get(node) ?? []) {
          const neighbor = conn.from === node ? conn.to : conn.from;
          totalWeight += conn.weight;
          edgeCount++;
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }

      if (component.length >= minSize) {
        // Cohesion = average edge weight / possible edges
        const possibleEdges = component.length * (component.length - 1) / 2;
        const cohesion = possibleEdges > 0 ? (totalWeight / 2) / possibleEdges : 0;
        clusters.push({ entries: component, cohesion });
      }
    }

    return clusters.sort((a, b) => b.cohesion - a.cohesion);
  }

  get edgeCount(): number {
    let count = 0;
    for (const conns of this.adjacency.values()) {
      count += conns.length;
    }
    return count / 2; // each edge counted twice
  }
}

// ─── KnowledgeHygiene ───────────────────────────────────────────

export class KnowledgeHygiene {
  /**
   * Find groups of near-duplicate entries.
   */
  findDuplicates(entries: KnowledgeEntry[]): DuplicateGroup[] {
    const groups: DuplicateGroup[] = [];
    const assigned = new Set<number>();

    for (let i = 0; i < entries.length; i++) {
      if (assigned.has(i)) continue;

      const wordsI = new Set(meaningfulWords(`${entries[i].pattern} ${entries[i].response}`));
      if (wordsI.size < 2) continue;

      const duplicates: number[] = [];

      for (let j = i + 1; j < entries.length; j++) {
        if (assigned.has(j)) continue;

        const wordsJ = new Set(meaningfulWords(`${entries[j].pattern} ${entries[j].response}`));
        const sim = jaccard(wordsI, wordsJ);

        if (sim >= DUPLICATE_THRESHOLD) {
          duplicates.push(j);
          assigned.add(j);
        }
      }

      if (duplicates.length > 0) {
        assigned.add(i);
        groups.push({
          canonical: i,
          duplicates,
          similarity: DUPLICATE_THRESHOLD, // minimum sim in group
        });
      }
    }

    return groups;
  }

  /**
   * Score an entry's quality (0-1). Higher = better.
   *
   * Factors: information density, length, source quality, junk signals.
   */
  scoreQuality(entry: KnowledgeEntry): number {
    const response = entry.response;
    const words = tokenize(response);
    const meaningful = meaningfulWords(response);

    // Information density: ratio of meaningful words to total words
    const density = words.length > 0 ? meaningful.length / words.length : 0;

    // Length score: too short (< 5 words) or too long (> 500 words) gets penalized
    let lengthScore: number;
    if (words.length < 5) lengthScore = 0.2;
    else if (words.length < 15) lengthScore = 0.6;
    else if (words.length <= 300) lengthScore = 1.0;
    else if (words.length <= 500) lengthScore = 0.8;
    else lengthScore = 0.5;

    // Source quality
    let sourceScore: number;
    const src = entry.source.toLowerCase();
    if (src === 'bootstrap' || src.startsWith('bootstrap:')) sourceScore = 0.7;
    else if (src === 'vcus' || src.startsWith('vcus:') || src === 'user-taught') sourceScore = 0.9;
    else if (src.startsWith('http')) sourceScore = 0.5;
    else sourceScore = 0.6;

    // Junk penalty
    const isJunk = KnowledgeStore.isJunkContent(response) ? 0.0 : 1.0;

    // Unique word ratio — penalize repetitive text
    const uniqueWords = new Set(meaningful);
    const uniqueRatio = meaningful.length > 0 ? uniqueWords.size / meaningful.length : 0;

    // Composite
    return (
      density * 0.25 +
      lengthScore * 0.20 +
      sourceScore * 0.20 +
      isJunk * 0.20 +
      uniqueRatio * 0.15
    );
  }

  /**
   * Clean the knowledge base: flag duplicates, score quality, produce report.
   * Returns a hygiene report with indexes to remove.
   *
   * NOTE: This does NOT mutate the store directly — it returns recommendations.
   * The caller decides whether to apply them.
   */
  analyze(entries: KnowledgeEntry[]): {
    report: HygieneReport;
    duplicateGroups: DuplicateGroup[];
    lowQuality: Array<{ index: number; score: number }>;
    qualityScores: Map<number, number>;
  } {
    const totalBefore = entries.length;

    // Find duplicates
    const duplicateGroups = this.findDuplicates(entries);
    const duplicateIndices = new Set<number>();
    for (const group of duplicateGroups) {
      for (const d of group.duplicates) {
        duplicateIndices.add(d);
      }
    }

    // Score all entries
    const qualityScores = new Map<number, number>();
    const lowQuality: Array<{ index: number; score: number }> = [];
    for (let i = 0; i < entries.length; i++) {
      const score = this.scoreQuality(entries[i]);
      qualityScores.set(i, score);
      if (score < LOW_QUALITY_THRESHOLD && !duplicateIndices.has(i)) {
        lowQuality.push({ index: i, score });
      }
    }

    const entriesToRemove = duplicateIndices.size + lowQuality.length;

    return {
      report: {
        duplicatesFound: duplicateGroups.reduce((sum, g) => sum + g.duplicates.length, 0),
        entriesMerged: duplicateGroups.length,
        lowQualityRemoved: lowQuality.length,
        totalBefore,
        totalAfter: totalBefore - entriesToRemove,
      },
      duplicateGroups,
      lowQuality,
      qualityScores,
    };
  }
}

// ─── QuestionDecomposer ─────────────────────────────────────────

export class QuestionDecomposer {
  /**
   * Break a complex question into simpler sub-questions.
   *
   * "What is React and how does it compare to Vue?" →
   *   ["What is React?", "How does React compare to Vue?"]
   *
   * "Tell me about Docker networking and volumes" →
   *   ["What is Docker networking?", "What are Docker volumes?"]
   */
  decompose(question: string): SubQuestion[] {
    const trimmed = question.trim();
    if (trimmed.length < 5) return [{ text: trimmed, type: 'general' }];

    const results: SubQuestion[] = [];

    // Strategy 1: Split on " and " / " or " between clauses
    const andSplit = trimmed.split(/\s+(?:and|or)\s+(?=(?:how|what|why|when|where|who|which|can|does|is|are)\b)/i);
    if (andSplit.length > 1) {
      for (const part of andSplit) {
        const sub = this.ensureQuestion(part.trim());
        if (sub) results.push(sub);
      }
      return results;
    }

    // Strategy 2: Multi-topic with "about X and Y" or "X, Y, and Z"
    const aboutMatch = trimmed.match(/(?:about|regarding|on)\s+(.+)/i);
    if (aboutMatch) {
      const topics = aboutMatch[1]
        .split(/(?:,\s*(?:and\s+)?|\s+and\s+)/)
        .map(t => t.trim().replace(/[?.!]+$/, ''))
        .filter(t => t.length > 2);

      if (topics.length > 1) {
        for (const topic of topics) {
          results.push({ text: `What is ${topic}?`, type: 'what' });
        }
        return results;
      }
    }

    // Strategy 3: Comparative questions "X vs Y", "X compared to Y"
    const vsMatch = trimmed.match(/(.+?)\s+(?:vs\.?|versus|compared?\s+to|eller)\s+(.+)/i);
    if (vsMatch) {
      const [, a, b] = vsMatch;
      results.push({ text: `What is ${a.trim()}?`, type: 'what' });
      results.push({ text: `What is ${b.trim().replace(/[?.!]+$/, '')}?`, type: 'what' });
      results.push({ text: trimmed, type: 'compare' });
      return results;
    }

    // Strategy 4: "How to X and Y" — split on "and" within action phrases
    const howToMatch = trimmed.match(/^how\s+(?:to|do\s+(?:i|you|we))\s+(.+)/i);
    if (howToMatch) {
      const actionParts = howToMatch[1].split(/\s+and\s+/).map(p => p.trim()).filter(p => p.length > 3);
      if (actionParts.length > 1) {
        for (const part of actionParts) {
          results.push({ text: `How to ${part}?`, type: 'how' });
        }
        return results;
      }
    }

    // Strategy 5: Questions with multiple listed items "what are X, Y, Z"
    const listMatch = trimmed.match(/^(?:what\s+(?:are|is)|list|name|explain)\s+(.+)/i);
    if (listMatch) {
      const items = listMatch[1]
        .split(/(?:,\s*(?:and\s+)?|\s+and\s+)/)
        .map(i => i.trim().replace(/[?.!]+$/, ''))
        .filter(i => i.length > 2);

      if (items.length > 1) {
        for (const item of items) {
          results.push({ text: `What is ${item}?`, type: 'what' });
        }
        return results;
      }
    }

    // Not decomposable — return as-is
    return [this.ensureQuestion(trimmed) ?? { text: trimmed, type: 'general' }];
  }

  /**
   * Ensure a text fragment is phrased as a proper question.
   */
  private ensureQuestion(text: string): SubQuestion | null {
    if (text.length < 3) return null;

    const lower = text.toLowerCase();
    let type: SubQuestion['type'] = 'general';

    if (/^what\b/.test(lower)) type = 'what';
    else if (/^how\b/.test(lower)) type = 'how';
    else if (/^why\b/.test(lower)) type = 'why';
    else if (/^when\b/.test(lower)) type = 'when';
    else if (/^where\b/.test(lower)) type = 'where';
    else if (/^who\b/.test(lower)) type = 'who';
    else if (/^which\b/.test(lower)) type = 'which';
    else if (/\bvs\.?\b|\bcompare\b|\bversus\b/i.test(lower)) type = 'compare';
    else if (/^list\b|^name\b/.test(lower)) type = 'list';

    // Add question mark if missing
    const cleaned = text.replace(/[.]+$/, '');
    const finalText = cleaned.endsWith('?') ? cleaned : `${cleaned}?`;

    return { text: finalText, type };
  }
}

// ─── KnowledgeIntelligence (Orchestrator) ───────────────────────

export class KnowledgeIntelligence {
  readonly decomposer = new KnowledgeDecomposer();
  readonly connector = new KnowledgeConnector();
  readonly hygiene = new KnowledgeHygiene();
  readonly questionDecomposer = new QuestionDecomposer();

  private built = false;

  constructor(private store: KnowledgeStore) {}

  /**
   * Build all intelligence indexes.
   * Call after loading knowledge (entries + corpus).
   */
  build(): void {
    const entries = this.getEntries();

    // 1. Build sub-pattern index
    this.decomposer.buildSubPatterns(entries);

    // 2. Build connection graph
    this.connector.buildGraph(entries, this.decomposer);

    this.built = true;
  }

  /**
   * Enhanced query: decompose the question, match sub-questions, follow
   * connections, combine answers. Returns null if no good answer found.
   */
  answerDecomposed(question: string): CompositeAnswer | null {
    if (!this.built) this.build();

    const subQuestions = this.questionDecomposer.decompose(question);

    // Single question? Try direct match first for efficiency.
    if (subQuestions.length === 1) {
      return this.answerSingle(subQuestions[0].text);
    }

    // Multiple sub-questions: answer each, combine
    const subAnswers: SubAnswer[] = [];
    for (const sq of subQuestions) {
      const result = this.answerSingle(sq.text);
      if (result && result.confidence > DECOMPOSED_SUB_MIN) {
        subAnswers.push(...result.subAnswers);
      }
    }

    if (subAnswers.length === 0) return null;

    // Deduplicate answers: remove near-identical sub-answers
    const unique = this.deduplicateAnswers(subAnswers);

    // Combine into composite text
    const parts = unique.map(a => a.answer);
    const avgConfidence = unique.reduce((sum, a) => sum + a.confidence, 0) / unique.length;

    // Aggregate all contributing entry indices from sub-results
    const allIndices = unique
      .filter(a => a.entryIndex != null)
      .map(a => a.entryIndex as number);
    const uniqueIndices = [...new Set(allIndices)];

    return {
      text: parts.join('\n\n'),
      subAnswers: unique,
      confidence: avgConfidence,
      strategy: 'decomposed',
      entryIndices: uniqueIndices,
    };
  }

  /**
   * Answer a single (non-compound) question using knowledge store + connections.
   */
  private answerSingle(question: string): CompositeAnswer | null {
    const entries = this.getEntries();

    // Try direct best match first
    const directMatch = this.store.findBestMatchWithScore(question);
    if (directMatch && directMatch.score > DIRECT_MATCH_STRONG) {
      return {
        text: directMatch.entry.response,
        subAnswers: [{
          question,
          answer: directMatch.entry.response,
          confidence: directMatch.score,
          source: directMatch.entry.source,
          answerStrategy: 'direct',
        }],
        confidence: directMatch.score,
        strategy: 'direct',
        entryIndices: [],
      };
    }

    // Try sub-pattern search
    const patternMatches = this.decomposer.findBySubPatterns(question);
    if (patternMatches.length > 0) {
      const bestPatternIdx = patternMatches[0].entryIndex;
      const bestEntry = entries[bestPatternIdx];
      if (bestEntry) {
        // Follow connections to enrich the answer
        const related = this.connector.traverse(bestPatternIdx, 2, 3);
        const relatedEntries = related
          .map(r => entries[r.index])
          .filter((e): e is KnowledgeEntry => e != null);

        const mainAnswer = bestEntry.response;
        const supplements = relatedEntries
          .map(e => e.response)
          .filter(r => !this.isOverlapping(r, mainAnswer));

        const combined = supplements.length > 0
          ? `${mainAnswer}\n\nRelated: ${supplements.slice(0, 2).join(' ')}`
          : mainAnswer;

        const score = Math.min(patternMatches[0].score / PATTERN_SCORE_DIVISOR, PATTERN_SCORE_CAP); // normalize
        const contributingIndices = [bestPatternIdx, ...related.map(r => r.index)];
        return {
          text: combined,
          subAnswers: [{
            question,
            answer: combined,
            confidence: score,
            source: bestEntry.source,
            answerStrategy: 'pattern',
            entryIndex: bestPatternIdx,
          }],
          confidence: score,
          strategy: 'connected',
          entryIndices: contributingIndices,
        };
      }
    }

    // Fall back to direct match with lower threshold
    if (directMatch && directMatch.score > DIRECT_MATCH_WEAK) {
      return {
        text: directMatch.entry.response,
        subAnswers: [{
          question,
          answer: directMatch.entry.response,
          confidence: directMatch.score,
          source: directMatch.entry.source,
          answerStrategy: 'direct',
        }],
        confidence: directMatch.score,
        strategy: 'direct',
        entryIndices: [],
      };
    }

    // Fall back to TF-IDF document retrieval (catches knowledge from train() calls)
    const docMatch = this.store.findBestDocumentMatch(question, DOC_MATCH_MIN);
    if (docMatch && docMatch.score > DOC_MATCH_MIN) {
      const snippet = docMatch.text.length > 400
        ? docMatch.text.slice(0, 400) + '...'
        : docMatch.text;
      return {
        text: snippet,
        subAnswers: [{
          question,
          answer: snippet,
          confidence: Math.min(docMatch.score, DOC_MATCH_CAP),
          source: docMatch.source,
          answerStrategy: 'document',
        }],
        confidence: Math.min(docMatch.score, DOC_MATCH_CAP),
        strategy: 'connected',
        entryIndices: [],
      };
    }

    return null;
  }

  /**
   * Check if two responses overlap significantly.
   */
  private isOverlapping(a: string, b: string): boolean {
    const wordsA = new Set(meaningfulWords(a));
    const wordsB = new Set(meaningfulWords(b));
    return jaccard(wordsA, wordsB) > OVERLAP_JACCARD_THRESHOLD;
  }

  /**
   * Deduplicate sub-answers by removing near-identical entries.
   */
  private deduplicateAnswers(answers: SubAnswer[]): SubAnswer[] {
    const unique: SubAnswer[] = [];
    for (const answer of answers) {
      const isDup = unique.some(u => {
        const wordsA = new Set(meaningfulWords(u.answer));
        const wordsB = new Set(meaningfulWords(answer.answer));
        return jaccard(wordsA, wordsB) > OVERLAP_JACCARD_THRESHOLD;
      });
      if (!isDup) unique.push(answer);
    }
    return unique;
  }

  /**
   * Run hygiene analysis on the knowledge base.
   */
  analyzeHygiene() {
    return this.hygiene.analyze(this.getEntries());
  }

  /**
   * Get intelligence stats for diagnostics.
   */
  getStats(): {
    entries: number;
    subPatterns: number;
    connections: number;
    built: boolean;
  } {
    return {
      entries: this.store.entryCount,
      subPatterns: this.decomposer.patternCount,
      connections: this.connector.edgeCount,
      built: this.built,
    };
  }

  /**
   * Access the underlying entries array via KnowledgeStore export.
   */
  private getEntries(): KnowledgeEntry[] {
    return this.store.exportData().entries;
  }
}
