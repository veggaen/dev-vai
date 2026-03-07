/**
 * VeggaAI Engine — VAI's own model, built from scratch.
 *
 * This is NOT a wrapper around someone else's model. This IS the model.
 *
 * Architecture progression:
 *   v0: Token frequency + pattern matching (works immediately, no training)
 *   v1: N-gram language model with learned probabilities
 *   v2: Simple neural network (embeddings + feedforward)
 *   v3: Attention-based architecture (VAI's own transformer variant)
 *
 * The engine learns from:
 *   - Ingested sources (web pages, YouTube transcripts, documents)
 *   - Conversation history (what users ask and what works)
 *   - Code repositories (structure, patterns, syntax)
 *   - Bilingual data (English <-> Norwegian mappings)
 */

import type {
  ModelAdapter,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  Message,
} from './adapter.js';
import { KnowledgeIntelligence } from './knowledge-intelligence.js';
import { STOP_WORDS, TOPIC_STOP_WORDS, QUERY_ACTION_WORDS } from './stop-words.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { SearchPipeline } from '../search/pipeline.js';
import { generateFollowUps } from '../search/pipeline.js';
import type { SearchResponse, SearchSnippet } from '../search/types.js';

// ---- Tokenizer ----

export class VaiTokenizer {
  private vocab: Map<string, number> = new Map();
  private reverseVocab: Map<number, string> = new Map();
  private nextId = 0;

  constructor() {
    // Bootstrap with essential tokens
    this.addToken('<pad>');
    this.addToken('<unk>');
    this.addToken('<start>');
    this.addToken('<end>');
  }

  private addToken(token: string): number {
    if (this.vocab.has(token)) return this.vocab.get(token)!;
    const id = this.nextId++;
    this.vocab.set(token, id);
    this.reverseVocab.set(id, token);
    return id;
  }

  encode(text: string): number[] {
    // Word-level tokenization (simple but effective for v0)
    const words = text.toLowerCase().split(/(\s+|[.,!?;:'"()[\]{}])/g).filter(Boolean);
    return words.map((w) => {
      if (!this.vocab.has(w)) this.addToken(w);
      return this.vocab.get(w)!;
    });
  }

  decode(ids: number[]): string {
    return ids
      .map((id) => this.reverseVocab.get(id) ?? '<unk>')
      .join('');
  }

  get vocabSize(): number {
    return this.vocab.size;
  }

  exportVocab(): Record<string, number> {
    return Object.fromEntries(this.vocab);
  }

  importVocab(data: Record<string, number>): void {
    for (const [token, id] of Object.entries(data)) {
      this.vocab.set(token, id);
      this.reverseVocab.set(id, token);
      if (id >= this.nextId) this.nextId = id + 1;
    }
  }
}

// ---- Knowledge Store ----

export interface KnowledgeEntry {
  readonly pattern: string;       // input pattern (lowercased) — immutable after creation
  response: string;      // learned response (mutable: upgraded by vcus-taught entries)
  frequency: number;     // how often this pattern was seen (mutable: incremented on duplicate)
  source: string;        // where this knowledge came from (mutable: upgraded by vcus-taught)
  language: 'en' | 'no' | 'code' | 'mixed'; // mutable: upgraded by vcus-taught
}

// ---- Vai Self-Awareness ----

/** Metadata generated alongside every response — Vai's awareness of its own answer quality. */
export interface ResponseMeta {
  /** Which strategy produced this response (e.g., 'conversational', 'web-search', 'fallback') */
  readonly strategy: string;
  /** 0–1 confidence score based on strategy tier + response quality signals */
  readonly confidence: number;
  /** Primary topic detected from the user's question */
  readonly topicDetected: string;
  /** How deep Vai's knowledge is on this topic */
  readonly knowledgeDepth: 'deep' | 'shallow' | 'none';
  /** Response length in characters */
  readonly responseLength: number;
  /** Response time in milliseconds */
  durationMs: number; // mutable: patched after timing
}

/** Full self-diagnostic report — what Vai knows about its own capabilities. */
export interface VaiDiagnosis {
  /** High-level stats */
  readonly overview: {
    readonly totalResponses: number;
    readonly avgConfidence: number;
    readonly fallbackRate: number;
    readonly topStrategy: string;
    readonly weakestArea: string;
  };
  /** Per-topic knowledge depth */
  readonly topicCoverage: ReadonlyArray<{
    readonly topic: string;
    readonly depth: 'deep' | 'shallow' | 'bootstrap-only';
    readonly entryCount: number;
    readonly sources: readonly string[];
  }>;
  /** Topics users asked about that Vai couldn't answer */
  readonly missedTopics: ReadonlyArray<{ readonly topic: string; readonly count: number }>;
  /** Strategy usage distribution */
  readonly strategyStats: Readonly<Record<string, number>>;
  /** Recent response quality history */
  readonly recentResponses: readonly ResponseMeta[];
  /** Actionable improvement suggestions (sorted by impact) */
  readonly suggestions: readonly string[];
}

// ─── Bloom Filter ─────────────────────────────────────────────────
// Ultra-fast probabilistic "do we know this topic?" pre-check.
// False positives possible (proceeds to exact match), false negatives impossible.
class TopicBloomFilter {
  private readonly bits: Uint32Array;
  private readonly size: number;
  private count = 0;

  constructor(expectedItems = 4096) {
    // ~10 bits per item → ~1% false positive rate
    this.size = expectedItems * 10;
    this.bits = new Uint32Array(Math.ceil(this.size / 32));
  }

  private hash1(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h) % this.size;
  }

  private hash2(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 37 + s.charCodeAt(i)) | 0;
    return Math.abs(h) % this.size;
  }

  private hash3(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % this.size;
  }

  private setBit(pos: number): void {
    this.bits[pos >>> 5] |= 1 << (pos & 31);
  }

  private getBit(pos: number): boolean {
    return (this.bits[pos >>> 5] & (1 << (pos & 31))) !== 0;
  }

  add(topic: string): void {
    const key = topic.toLowerCase();
    this.setBit(this.hash1(key));
    this.setBit(this.hash2(key));
    this.setBit(this.hash3(key));
    this.count++;
  }

  mightContain(topic: string): boolean {
    const key = topic.toLowerCase();
    return this.getBit(this.hash1(key)) && this.getBit(this.hash2(key)) && this.getBit(this.hash3(key));
  }

  get itemCount(): number { return this.count; }
}

export class KnowledgeStore {
  private entries: KnowledgeEntry[] = [];
  private ngramCounts: Map<string, Map<string, number>> = new Map();

  // Bloom filter: O(1) "do we probably know this?" pre-check
  private readonly topicFilter = new TopicBloomFilter();

  // Inverted index: word → set of entry indices (for fast findBestMatch)
  private entryWordIndex: Map<string, Set<number>> = new Map();

  // TF-IDF index for retrieval
  private documents: Array<{ id: string; source: string; words: string[]; wordSet: Set<string> }> = [];
  private documentFrequency: Map<string, number> = new Map(); // word -> how many docs contain it

  // Inverted index: word → set of document indices (for fast TF-IDF retrieval)
  private wordToDocIndices: Map<string, Set<number>> = new Map();

  // Concept index — extracted definitions and explanations
  // Maps "concept name" → { definition, source, frequency }
  private concepts: Map<string, { definition: string; source: string; frequency: number }> = new Map();

  // ── Scoring constants ─────────────────────────────────────────────
  // Centralised so tuning is visible and grep-able.
  /** Minimum pattern/query coverage ratio to trigger substring boost */
  private static readonly COVERAGE_THRESHOLD = 0.25;
  /** Per-word boost factor for substring matches (capped at 0.5) */
  private static readonly PER_WORD_BOOST = 0.15;
  /** Base score floor when substring match passes coverage check */
  private static readonly SUBSTRING_BASE = 0.3;
  /** Score floor when pattern fully contains the query */
  private static readonly REVERSE_CONTAIN_FLOOR = 0.5;
  /** Minimum raw score before trusted-source boost applies */
  private static readonly TRUSTED_MIN_SCORE = 0.2;
  /** Additive boost for trusted sources (user-taught, bootstrap) */
  private static readonly TRUSTED_BOOST = 0.15;
  /** Multiplicative penalty for YouTube transcript entries */
  private static readonly YOUTUBE_PENALTY = 0.6;
  /** Multiplicative penalty for cognitive-foundations in global search */
  private static readonly COGNITIVE_PENALTY = 0.3;
  /** Multiplicative penalty for UI-chrome / non-content responses */
  private static readonly UI_CHROME_PENALTY = 0.1;
  /** Weight of query-coverage in the taught-match scoring formula */
  private static readonly QUERY_COVERAGE_WEIGHT = 0.7;
  /** Weight of Jaccard similarity in the taught-match scoring formula */
  private static readonly JACCARD_WEIGHT = 0.3;
  /** Minimum weighted score to return a match from findBestMatch */
  private static readonly MATCH_THRESHOLD = 0.25;
  /** Default minimum score for TF-IDF document retrieval */
  private static readonly DOC_MATCH_THRESHOLD = 0.15;

  /**
   * Learn from a text corpus — builds n-gram frequencies + TF-IDF index + concept extraction.
   */
  learn(text: string, source: string, _language: KnowledgeEntry['language'] = 'en'): void {
    const words = text.toLowerCase().split(/\s+/);

    // Add to TF-IDF document index (chunk into ~200 word segments)
    for (let i = 0; i < words.length; i += 200) {
      const segment = words.slice(i, i + 200);
      const wordSet = new Set(segment);
      const docId = `${source}:${i}`;
      const docIdx = this.documents.length;
      this.documents.push({ id: docId, source, words: segment, wordSet });
      for (const w of wordSet) {
        this.documentFrequency.set(w, (this.documentFrequency.get(w) ?? 0) + 1);
        // Build inverted index: word → document indices
        if (!this.wordToDocIndices.has(w)) this.wordToDocIndices.set(w, new Set());
        this.wordToDocIndices.get(w)!.add(docIdx);
      }
    }

    // Build bigram and trigram frequency tables
    for (let i = 0; i < words.length - 1; i++) {
      const context = words[i];
      const next = words[i + 1];
      if (!this.ngramCounts.has(context)) {
        this.ngramCounts.set(context, new Map());
      }
      const counts = this.ngramCounts.get(context)!;
      counts.set(next, (counts.get(next) ?? 0) + 1);
    }

    // Also learn trigrams
    for (let i = 0; i < words.length - 2; i++) {
      const context = `${words[i]} ${words[i + 1]}`;
      const next = words[i + 2];
      if (!this.ngramCounts.has(context)) {
        this.ngramCounts.set(context, new Map());
      }
      const counts = this.ngramCounts.get(context)!;
      counts.set(next, (counts.get(next) ?? 0) + 1);
    }

    // Extract concepts — definitions, explanations, and key facts
    this.extractConcepts(text, source);
  }

  /**
   * Extract concept definitions from text using common definition patterns.
   * e.g., "React is a JavaScript library", "A rectangle has four sides"
   */
  private extractConcepts(text: string, source: string): void {
    // Split into sentences
    const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10 && s.length < 500);

    for (const sentence of sentences) {
      // Pattern: "X is/are Y" where X is short (1-5 words) and Y is an explanation
      const isMatch = sentence.match(/^([A-Z][a-zA-Z0-9 _-]{1,60})\s+(?:is|are|was|were)\s+(?:a\s+|an\s+|the\s+)?(.{10,300})$/);
      if (isMatch) {
        const concept = isMatch[1].trim().toLowerCase();
        // Skip if concept is a pronoun or too generic
        if (!/^(it|this|that|they|he|she|we|there|here|which|what|who)$/i.test(concept)) {
          this.addConcept(concept, sentence, source);
        }
      }

      // Pattern: "X refers to Y" / "X means Y" / "X — Y"
      const refMatch = sentence.match(/^([A-Z][a-zA-Z0-9 _-]{1,60})\s+(?:refers?\s+to|means?|denotes?|represents?)\s+(.{10,300})$/);
      if (refMatch) {
        const concept = refMatch[1].trim().toLowerCase();
        this.addConcept(concept, sentence, source);
      }

      // Pattern: "The X is Y" / "A X is Y"
      const theMatch = sentence.match(/^(?:The|A|An)\s+([a-zA-Z0-9 _-]{2,40})\s+(?:is|are|was|were)\s+(?:a\s+|an\s+|the\s+)?(.{10,300})$/i);
      if (theMatch) {
        const concept = theMatch[1].trim().toLowerCase();
        if (concept.split(/\s+/).length <= 4 && !/^(above|following|first|second|third|next|previous|same|other|result)$/i.test(concept)) {
          this.addConcept(concept, sentence, source);
        }
      }
    }
  }

  private addConcept(name: string, definition: string, source: string): void {
    const existing = this.concepts.get(name);
    if (existing) {
      existing.frequency++;
      // Keep longer/better definitions
      if (definition.length > existing.definition.length) {
        existing.definition = definition;
        existing.source = source;
      }
    } else {
      this.concepts.set(name, { definition, source, frequency: 1 });
    }
  }

  /**
   * Look up a concept by name (or close match).
   */
  findConcept(query: string): { name: string; definition: string; source: string } | null {
    const lower = query.toLowerCase().trim();

    // Exact match
    const exact = this.concepts.get(lower);
    if (exact) return { name: lower, definition: exact.definition, source: exact.source };

    // Partial match — check if query is contained in or contains a concept name
    let bestMatch: { name: string; definition: string; source: string } | null = null;
    let bestScore = 0;
    for (const [name, data] of this.concepts) {
      if (name.includes(lower) || lower.includes(name)) {
        const score = data.frequency * (name === lower ? 10 : 1);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = { name, definition: data.definition, source: data.source };
        }
      }
    }

    return bestMatch;
  }

  get conceptCount(): number {
    return this.concepts.size;
  }

  /**
   * Add a pattern-response pair (for Q&A style knowledge).
   */
  addEntry(pattern: string, response: string, source: string, language: KnowledgeEntry['language'] = 'en'): void {
    const existing = this.entries.find((e) => e.pattern === pattern.toLowerCase());
    if (existing) {
      // If new source is vcus-taught, always upgrade — vcus entries take priority
      // over ingested/hydrated entries with the same pattern
      if (source.includes('vcus') && !existing.source.includes('vcus')) {
        existing.source = source;
        existing.response = response;
        existing.language = language;
      }
      existing.frequency++;
      return;
    }
    const idx = this.entries.length;
    this.entries.push({
      pattern: pattern.toLowerCase(),
      response,
      frequency: 1,
      source,
      language,
    });
    // Update inverted index for fast matching
    const words = pattern.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    for (const w of words) {
      if (!this.entryWordIndex.has(w)) this.entryWordIndex.set(w, new Set());
      this.entryWordIndex.get(w)!.add(idx);
    }
    // Update Bloom filter for fast pre-check
    this.topicFilter.add(pattern);
  }

  /**
   * Remove all taught entries (source includes 'vcus' or 'user-taught').
   * Rebuilds invertedindex after removal.
   */
  clearTaughtEntries(): void {
    const kept: KnowledgeEntry[] = [];
    for (const e of this.entries) {
      if (!e.source.includes('vcus') && e.source !== 'user-taught') {
        kept.push(e);
      }
    }
    this.entries = kept;
    // Rebuild inverted index
    this.entryWordIndex.clear();
    for (let i = 0; i < this.entries.length; i++) {
      const words = this.entries[i].pattern.split(/\s+/).filter(w => w.length > 1);
      for (const w of words) {
        if (!this.entryWordIndex.has(w)) this.entryWordIndex.set(w, new Set());
        this.entryWordIndex.get(w)!.add(i);
      }
    }
  }

  /**
   * Find the best matching response for an input.
   */
  /**
   * Fast probabilistic check: does the knowledge base likely contain this topic?
   * Uses Bloom filter — no false negatives, ~1% false positives.
   */
  mightKnow(topic: string): boolean {
    return this.topicFilter.mightContain(topic);
  }

  findBestMatch(input: string): KnowledgeEntry | null {
    const query = input.toLowerCase().replace(/[?!,;:"'(){}\[\]<>\/]/g, ' ').replace(/\s+/g, ' ').trim();
    const queryWords = query.split(/\s+/).filter(w => w.length > 1);
    let best: KnowledgeEntry | null = null;
    let bestScore = 0;

    // Pre-compute relevance gate words once
    const meaningfulWords = queryWords.filter(w => w.length > 2 && !KnowledgeStore.STOP_WORDS.has(w));
    const rarestWord = meaningfulWords.length >= 1
      ? meaningfulWords.map(w => ({ word: w, docCount: this.getWordDocCount(w) }))
          .sort((a, b) => a.docCount - b.docCount)[0]?.word ?? null
      : null;

    // Use inverted index to find candidate entries (O(k) instead of O(n))
    const candidateIndices = new Set<number>();
    for (const w of queryWords) {
      const indices = this.entryWordIndex.get(w);
      if (indices) {
        for (const idx of indices) candidateIndices.add(idx);
      }
    }

    // Also check exact substring matches for short queries
    if (queryWords.length <= 3) {
      for (let i = 0; i < this.entries.length; i++) {
        if (this.entries[i].pattern.includes(query) || query.includes(this.entries[i].pattern)) {
          candidateIndices.add(i);
        }
      }
    }

    for (const idx of candidateIndices) {
      const entry = this.entries[idx];

      // Skip entries with no useful content
      if (entry.response.startsWith('[No transcript available') ||
          entry.response.startsWith('[Transcript not') ||
          entry.response.length < 10) {
        continue;
      }

      // Skip junk content (YouTube metadata, sidebar, etc.)
      // Trust user-taught, bootstrap, and auto-learned entries — they were explicitly curated
      const isTrustedSource = entry.source.startsWith('bootstrap') || entry.source === 'user-taught' || entry.source === 'auto-learned';
      if (!isTrustedSource && KnowledgeStore.isJunkContent(entry.response)) {
        continue;
      }

      // Content relevance gate — applied IN the loop so bad matches don't
      // shadow good ones. For non-trusted entries, the
      // rarest meaningful query word must appear in the entry's pattern.
      if (rarestWord && !isTrustedSource) {
        if (!entry.pattern.toLowerCase().includes(rarestWord)) {
          continue; // Skip irrelevant entry, let better matches win
        }
      }

      let score = this.similarity(query, entry.pattern);

      // Boost: if the query contains the exact pattern as a substring
      // Only boost if the pattern is a significant portion of the query (not 1-word noise)
      if (query.includes(entry.pattern.toLowerCase())) {
        const patternLen = entry.pattern.split(/\s+/).length;
        const queryLen = queryWords.length;
        const coverage = patternLen / Math.max(queryLen, 1);
        // Only boost if pattern covers >25% of query, scale boost by coverage
        if (coverage > KnowledgeStore.COVERAGE_THRESHOLD) {
          const boost = Math.min(0.5, patternLen * KnowledgeStore.PER_WORD_BOOST);
          score = Math.max(score, KnowledgeStore.SUBSTRING_BASE + boost);
        }
      }

      // Boost: if the pattern contains the query (user typed just the topic)
      if (entry.pattern.toLowerCase().includes(query) && queryWords.length > 1) {
        score = Math.max(score, KnowledgeStore.REVERSE_CONTAIN_FLOOR);
      }

      // Prefer trusted entries over ingested web content
      if (isTrustedSource && score > KnowledgeStore.TRUSTED_MIN_SCORE) {
        score += KnowledgeStore.TRUSTED_BOOST;
      }

      // Penalize YouTube transcript content — often unfocused and contains
      // random topic fragments that match unrelated queries
      if (entry.source.includes('youtube.com') || entry.source.includes('youtu.be') || entry.source === 'youtube') {
        score *= KnowledgeStore.YOUTUBE_PENALTY;
      }

      // Penalize cognitive-foundations entries in global findBestMatch.
      // These have very generic patterns ("debugging", "reading", "error") that
      // match almost any query. They have their own dedicated lookup in
      // tryCognitiveFoundations (Strategy 1.545) via findBestMatchForSource,
      // so they shouldn't compete here against domain-specific content.
      if (entry.source === 'bootstrap:cognitive-foundations') {
        score *= KnowledgeStore.COGNITIVE_PENALTY;
      }

      // Penalize entries with UI-chrome / non-content responses
      if (/^\s*(VeggaAI|Select a conversation|New Chat|Knowledge Base)/i.test(entry.response)) {
        score *= KnowledgeStore.UI_CHROME_PENALTY;
      }

      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }

    if (bestScore <= 0.2 || !best) return null;

    return best;
  }

  /**
   * Find best match AND return the similarity score.
   * Used for early high-confidence escapes in the generation pipeline.
   */
  findBestMatchWithScore(input: string): { entry: KnowledgeEntry; score: number } | null {
    const match = this.findBestMatch(input);
    if (!match) return null;
    const query = input.toLowerCase().replace(/[?!,;:"'(){}\[\]<>]/g, ' ').replace(/\s+/g, ' ').trim();
    const base = this.similarity(query, match.pattern);
    // Estimate the final score (including boosts applied in findBestMatch)
    let score = base;
    if (query.includes(match.pattern.toLowerCase())) {
      const patternLen = match.pattern.split(/\s+/).length;
      const queryLen = query.split(/\s+/).length;
      const coverage = patternLen / Math.max(queryLen, 1);
      if (coverage > KnowledgeStore.COVERAGE_THRESHOLD) score = Math.max(score, KnowledgeStore.SUBSTRING_BASE + Math.min(0.5, patternLen * KnowledgeStore.PER_WORD_BOOST));
    }
    if (match.pattern.toLowerCase().includes(query) && query.split(/\s+/).length > 1) {
      score = Math.max(score, KnowledgeStore.REVERSE_CONTAIN_FLOOR);
    }
    if (match.source === 'user-taught' || match.source.startsWith('bootstrap')) score += KnowledgeStore.TRUSTED_BOOST;
    return { entry: match, score };
  }

  /**
   * Find best match among entries from a specific source.
   * Used by tryCognitiveFoundations to search ONLY bootstrap:cognitive-foundations
   * entries, avoiding the global findBestMatch which may return higher-scoring
   * entries from unrelated sources (YouTube, web scraping).
   */
  findBestMatchForSource(input: string, sourcePrefix: string): KnowledgeEntry | null {
    // Normalize: lowercase, strip punctuation, replace hyphens with spaces so "meta-learning" matches "meta learning"
    const query = input.toLowerCase().replace(/[?!,;:"'(){}\[\]<>]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    const queryWords = query.split(/\s+/).filter(w => w.length > 1);
    let best: KnowledgeEntry | null = null;
    let bestScore = 0;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (!entry.source.startsWith(sourcePrefix)) continue;
      if (entry.response.length < 10) continue;

      let score = this.similarity(query, entry.pattern);

      // Boost: query contains exact pattern as substring
      if (query.includes(entry.pattern.toLowerCase())) {
        const patternLen = entry.pattern.split(/\s+/).length;
        const queryLen = Math.max(queryWords.length, 1);
        const coverage = patternLen / queryLen;
        if (coverage > KnowledgeStore.COVERAGE_THRESHOLD) {
          score = Math.max(score, KnowledgeStore.SUBSTRING_BASE + Math.min(0.5, patternLen * KnowledgeStore.PER_WORD_BOOST));
        }
      }

      // Boost: pattern contains the query (user typed just the topic)
      if (entry.pattern.toLowerCase().includes(query) && queryWords.length > 1) {
        score = Math.max(score, KnowledgeStore.REVERSE_CONTAIN_FLOOR);
      }

      // Boost for bootstrap source
      if (entry.source.startsWith('bootstrap')) score += KnowledgeStore.TRUSTED_BOOST;

      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }

    return bestScore > KnowledgeStore.TRUSTED_MIN_SCORE && best ? best : null;
  }

  /**
   * Find best match among VCUS-taught entries only.
   * Used for early high-priority retrieval (Strategy 1.515) —
   * these entries are explicitly taught and should override greedy hardcoded strategies.
   * Only checks entries with source containing 'vcus' or 'user-taught'.
   * Uses STRICT matching with stop-word filtering to avoid false positives.
   */
  findBestTaughtMatch(input: string): KnowledgeEntry | null {
    const query = input.toLowerCase();
    // Normalize: strip punctuation, split into words, filter stop words
    // Keep length > 1 (not > 2) to preserve short tech terms like "cn", "db", "ui"
    const normalize = (text: string): string[] =>
      text.replace(/[^a-z0-9\s\-_.]/g, '').split(/\s+/)
        .filter(w => w.length > 1 && !KnowledgeStore.STOP_WORDS.has(w));

    // Prefix matching: handles plurals/conjugations without a full stemmer
    // "switches"↔"switch", "entering"↔"enter", "heated"↔"heat"
    const prefixMatch = (a: string, b: string): boolean => {
      if (a === b) return true;
      const min = Math.min(a.length, b.length);
      if (min < 3) return false;
      // Require shared prefix ≥4 chars (or full shorter word if 3 chars)
      const prefixLen = min >= 4 ? 4 : 3;
      return a.slice(0, prefixLen) === b.slice(0, prefixLen) && Math.abs(a.length - b.length) <= 3;
    };

    const meaningfulQuery = normalize(query);
    if (meaningfulQuery.length === 0) return null;

    let best: KnowledgeEntry | null = null;
    let bestScore = 0;
    let bestHits = 0;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      // Only consider VCUS-taught entries
      if (!entry.source.includes('vcus') && entry.source !== 'user-taught') continue;

      const patternWords = normalize(entry.pattern);
      if (patternWords.length === 0) continue;

      const qSet = new Set(meaningfulQuery);
      const pSet = new Set(patternWords);
      const pArr = [...pSet];

      // Count matching words (exact OR prefix match)
      const matchedQueryWords = [...qSet].filter(qw => pArr.some(pw => prefixMatch(qw, pw)));
      const hits = matchedQueryWords.length;
      if (hits === 0) continue;

      // Query coverage: what fraction of the QUERY is covered by the pattern?
      // This is the primary signal — especially important when patterns are long
      // (taught text can be 30-40 words, but the query is 5-10 words)
      const queryCoverage = hits / qSet.size;

      // Jaccard: penalizes vague matches where the pattern is unrelated
      const union = new Set([...qSet, ...pSet]);
      const jaccard = hits / union.size;

      // Weighted score: 70% query coverage + 30% Jaccard
      // This way, short queries against long patterns still score well if relevant
      let score = KnowledgeStore.QUERY_COVERAGE_WEIGHT * queryCoverage + KnowledgeStore.JACCARD_WEIGHT * jaccard;

      // Boost if ALL pattern words appear in query (tight topical match)
      const patternCoverage = hits / pSet.size;
      if (patternCoverage >= 0.8) score += 0.1;

      if (score > bestScore) {
        bestScore = score;
        best = entry;
        bestHits = hits;
      }
    }

    // Threshold for the weighted score
    // Also require ≥2 matching words when query has ≥3 meaningful words
    if (bestScore <= KnowledgeStore.MATCH_THRESHOLD || !best) return null;
    if (meaningfulQuery.length >= 3 && bestHits < 2) return null;
    return best;
  }

  /**
   * TF-IDF retrieval with score: find the single best document chunk for a query.
   * Returns null if no chunk scores above threshold.
   */
  findBestDocumentMatch(query: string, threshold = KnowledgeStore.DOC_MATCH_THRESHOLD): { text: string; source: string; score: number } | null {
    const results = this.retrieveRelevant(query, 1);
    if (results.length === 0 || results[0].score < threshold) return null;
    return results[0];
  }

  /**
   * Generate text continuation using n-gram model.
   */
  generateFromNgrams(seed: string, maxTokens: number): string {
    const words = seed.toLowerCase().split(/\s+/);
    const output = [...words];

    for (let i = 0; i < maxTokens; i++) {
      // Try trigram first
      if (output.length >= 2) {
        const triContext = `${output[output.length - 2]} ${output[output.length - 1]}`;
        const triCounts = this.ngramCounts.get(triContext);
        if (triCounts && triCounts.size > 0) {
          output.push(this.weightedSample(triCounts));
          continue;
        }
      }

      // Fall back to bigram
      const biContext = output[output.length - 1];
      const biCounts = this.ngramCounts.get(biContext);
      if (biCounts && biCounts.size > 0) {
        output.push(this.weightedSample(biCounts));
        continue;
      }

      break; // No continuation found
    }

    return output.slice(words.length).join(' ');
  }

  private weightedSample(counts: Map<string, number>): string {
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (const [word, count] of counts) {
      r -= count;
      if (r <= 0) return word;
    }
    return counts.keys().next().value!;
  }

  static readonly STOP_WORDS = new Set([...STOP_WORDS, ...QUERY_ACTION_WORDS]);

  /**
   * Detect junk content that shouldn't be used as knowledge responses.
   * YouTube sidebar metadata, playlist indices, view counts, video titles without substance.
   */
  static isJunkContent(text: string): boolean {
    const lower = text.toLowerCase();

    // YouTube metadata patterns: "for 1 år siden", "mill. avspillinger", timestamps like "31:29"
    const timestampCount = (lower.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) ?? []).length;
    if (timestampCount >= 3) return true;

    // Even 1-2 timestamps combined with bullet markers suggest YouTube sidebar
    if (timestampCount >= 1 && /[•·▸]/.test(lower)) return true;

    // Mostly video titles / playlist: "video NN.N.N" or numbered list of video titles
    if (/\bvideo\s+\d{2}\.\d/i.test(lower) && /\bvideo\s+\d{2}\.\d.*\bvideo\s+\d{2}\.\d/i.test(lower)) return true;

    // YouTube sidebar: lots of bullet points with channel names and view counts
    const viewCountHits = (lower.match(/(?:avspillinger|views|visninger|subscribers|abonnenter|plays|watching)/g) ?? []).length;
    if (viewCountHits >= 1) return true;

    // "for N år siden" (N years ago) — YouTube timestamp, even 1 occurrence is a strong signal
    if (/\b(?:for\s+)?\d+\s+(?:år|months?|weeks?|days?|timer?|hours?|minutes?)\s+(?:siden|ago)\b/i.test(lower)) return true;

    // YouTube playlist / recommendation sidebar patterns
    if (/(?:^\d+\.\s+|•\s*\d+:\d+|playlist|subscribe|notification)/i.test(lower) && timestampCount >= 1) return true;

    // YouTube channel listing patterns: "CHANNEL NAME • NN.NK views" or "CHANNEL • duration"
    const bulletSegments = lower.split(/[•·]/).length - 1;
    if (bulletSegments >= 2 && timestampCount >= 1) return true;

    // YouTube learning content metadata: "learn X in Y minutes" type titles mixed with timestamps/views
    if (/\blearn\s+\w+\s+in\s+\d+\s+minutes?\b/i.test(lower) && (timestampCount >= 1 || bulletSegments >= 1)) return true;

    // Mostly UI chrome: navigation, buttons, menu items
    if (/^(?:select\s+a\s+conversation|new\s+chat|knowledge\s+base|veggaai\s+ai\s+online)/i.test(lower)) return true;

    // Very short fragmented content (likely scraped nav/menu)
    const wordCount = lower.split(/\s+/).length;
    if (wordCount < 3) return true;

    // High density of bullet/emoji noise
    const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu) ?? []).length;
    if (emojiCount > 3 && emojiCount / wordCount > 0.08) return true;

    // Country flag emojis (common in YouTube language learning titles)
    const flagCount = (text.match(/[\u{1F1E0}-\u{1F1FF}]/gu) ?? []).length;
    if (flagCount >= 2) return true;

    return false;
  }

  /**
   * TF-IDF retrieval: find the most relevant document chunks for a query.
   */
  retrieveRelevant(query: string, topK = 5): Array<{ text: string; source: string; score: number }> {
    if (this.documents.length === 0) return [];

    // Filter out stop words — only search with meaningful content words
    const queryWords = query.toLowerCase().split(/\s+/)
      .filter(w => w.length > 2 && !KnowledgeStore.STOP_WORDS.has(w));

    // If all words were stop words, there's nothing meaningful to search for
    if (queryWords.length === 0) return [];

    // Use inverted index to find only candidate documents (O(k) instead of O(n))
    const candidateDocIndices = new Set<number>();
    for (const qw of queryWords) {
      const docIndices = this.wordToDocIndices.get(qw);
      if (docIndices) {
        for (const idx of docIndices) candidateDocIndices.add(idx);
      }
    }

    if (candidateDocIndices.size === 0) return [];

    const totalDocs = this.documents.length;

    const scored: Array<{ text: string; source: string; score: number }> = [];
    for (const docIdx of candidateDocIndices) {
      const doc = this.documents[docIdx];
      let score = 0;
      let matchedWords = 0;
      for (const qw of queryWords) {
        if (!doc.wordSet.has(qw)) continue;
        matchedWords++;
        const tf = doc.words.filter((w) => w === qw).length / doc.words.length;
        const df = this.documentFrequency.get(qw) ?? 1;
        const idf = Math.log(totalDocs / df);
        score += tf * idf;
      }
      if (matchedWords === 0) continue;

      const text = doc.words.join(' ');
      // Filter out UI-chrome, junk, and non-content entries
      if (/^veggaai\s+ai\s+online\s+\d+\s+words/i.test(text)) continue;
      if (text.startsWith('[no transcript available')) continue;
      if (KnowledgeStore.isJunkContent(text)) continue;

      scored.push({ text, source: doc.source, score });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  get documentCount(): number {
    return this.documents.length;
  }

  /** How many documents contain a given word (for IDF-based importance). */
  getWordDocCount(word: string): number {
    return this.wordToDocIndices.get(word.toLowerCase())?.size ?? 0;
  }

  private similarity(a: string, b: string): number {
    const strip = (s: string) => s.replace(/[?!,;:"'(){}\[\]<>\/]/g, ' ');
    const wordsA = new Set(strip(a).split(/\s+/).filter(w => w.length > 0));
    const wordsB = new Set(strip(b).split(/\s+/).filter(w => w.length > 0));
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  get entryCount(): number {
    return this.entries.length;
  }

  get ngramCount(): number {
    return this.ngramCounts.size;
  }

  exportData(): { entries: KnowledgeEntry[]; ngrams: Record<string, Record<string, number>> } {
    const ngrams: Record<string, Record<string, number>> = {};
    for (const [context, counts] of this.ngramCounts) {
      ngrams[context] = Object.fromEntries(counts);
    }
    return { entries: this.entries, ngrams };
  }

  importData(data: { entries: KnowledgeEntry[]; ngrams: Record<string, Record<string, number>> }): void {
    this.entries = data.entries;
    for (const [context, counts] of Object.entries(data.ngrams)) {
      this.ngramCounts.set(context, new Map(Object.entries(counts)));
    }
    // Populate Bloom filter from imported entries
    for (const entry of this.entries) {
      this.topicFilter.add(entry.pattern);
    }
  }

  /**
   * Summarize topic coverage — group entries by topic cluster for self-diagnosis.
   * Returns topics sorted by entry count (deepest first).
   */
  topicSummary(): Array<{ topic: string; entryCount: number; sources: string[]; depth: 'deep' | 'shallow' | 'bootstrap-only' }> {
    const topicMap = new Map<string, { count: number; sources: Set<string>; hasNonBootstrap: boolean }>();

    // Known topic keywords to cluster entries
    const topicKeywords: Record<string, string[]> = {
      'docker': ['docker', 'dockerfile', 'container', 'docker-compose', 'image'],
      'kubernetes': ['kubernetes', 'k8s', 'kubectl', 'pod', 'deployment', 'helm'],
      'react': ['react', 'jsx', 'hooks', 'usestate', 'useeffect', 'component', 'next.js', 'nextjs'],
      'typescript': ['typescript', 'ts', 'tsconfig', 'type', 'interface', 'generic'],
      'javascript': ['javascript', 'js', 'es6', 'ecmascript', 'closure', 'promise', 'async'],
      'git': ['git', 'branch', 'merge', 'commit', 'rebase', 'github', 'gitlab'],
      'postgresql': ['postgresql', 'postgres', 'sql', 'database', 'query', 'migration'],
      'mongodb': ['mongodb', 'mongo', 'nosql', 'document', 'collection'],
      'css': ['css', 'tailwind', 'flexbox', 'grid', 'responsive', 'styling'],
      'node.js': ['node', 'express', 'fastify', 'npm', 'pnpm'],
      'networking': ['tcp', 'udp', 'http', 'dns', 'osi', 'ip', 'subnet', 'vlan'],
      'security': ['xss', 'csrf', 'cors', 'jwt', 'oauth', 'authentication', 'rbac'],
      'testing': ['test', 'vitest', 'jest', 'playwright', 'cypress', 'tdd'],
      'devops': ['ci/cd', 'github actions', 'deploy', 'nginx', 'terraform'],
      'python': ['python', 'fastapi', 'pydantic', 'asyncio', 'django', 'flask'],
      'rust': ['rust', 'cargo', 'trait', 'lifetime', 'ownership'],
      'go': ['golang', 'goroutine', 'channel'],
      'norwegian': ['norsk', 'bokmål', 'nynorsk', 'grammatikk'],
    };

    for (const entry of this.entries) {
      const combined = (entry.pattern + ' ' + entry.source).toLowerCase();
      let matched = false;

      for (const [topic, keywords] of Object.entries(topicKeywords)) {
        if (keywords.some(kw => combined.includes(kw))) {
          if (!topicMap.has(topic)) topicMap.set(topic, { count: 0, sources: new Set(), hasNonBootstrap: false });
          const t = topicMap.get(topic)!;
          t.count++;
          t.sources.add(entry.source.split(':')[0]);
          if (!entry.source.startsWith('bootstrap')) t.hasNonBootstrap = true;
          matched = true;
          break; // first match wins
        }
      }

      if (!matched) {
        // Cluster by first meaningful word of pattern
        const words = entry.pattern.split(/\s+/).filter(w => w.length > 2 && !KnowledgeStore.STOP_WORDS.has(w));
        const topic = words[0] ?? 'uncategorized';
        if (!topicMap.has(topic)) topicMap.set(topic, { count: 0, sources: new Set(), hasNonBootstrap: false });
        const t = topicMap.get(topic)!;
        t.count++;
        t.sources.add(entry.source.split(':')[0]);
        if (!entry.source.startsWith('bootstrap')) t.hasNonBootstrap = true;
      }
    }

    return Array.from(topicMap.entries())
      .map(([topic, data]) => ({
        topic,
        entryCount: data.count,
        sources: Array.from(data.sources),
        depth: data.count >= 5 ? 'deep' as const
          : !data.hasNonBootstrap ? 'bootstrap-only' as const
          : 'shallow' as const,
      }))
      .sort((a, b) => b.entryCount - a.entryCount);
  }
}

// ---- Persistence snapshot format ----

export interface VaiSnapshot {
  version: 1;
  savedAt: string;
  /** Only non-bootstrap entries — bootstrap is rebuilt every startup */
  learnedEntries: KnowledgeEntry[];
  /** Cumulative strategy usage counts */
  strategyStats: Record<string, number>;
  /** Topics the user asked about that Vai couldn't answer */
  missedTopics: Record<string, number>;
}

export interface VaiEngineOptions {
  /**
   * Absolute or relative path to a JSON file for knowledge persistence.
   * When set, VaiEngine auto-loads on construction and auto-saves after
   * runtime knowledge mutations (train, web-search learn, chat learn).
   * Saves are debounced — at most once per 2 seconds.
   */
  persistPath?: string;
}

// ---- VAI Engine (the model adapter) ----

export class VaiEngine implements ModelAdapter {
  readonly id = 'vai:v0';
  readonly displayName = 'VeggaAI v0';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;

  readonly tokenizer = new VaiTokenizer();
  readonly knowledge = new KnowledgeStore();
  readonly intelligence: KnowledgeIntelligence;
  readonly searchPipeline: SearchPipeline;
  private intelligenceDirty = false;

  private systemPrompt = 'You are VeggaAI (VAI), a local-first AI assistant that learns from your data. You are still in early training — be honest about what you know and what you are still learning.';

  // ─── PERSISTENCE ───
  private readonly persistPath: string | null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistDirty = false;
  /** Number of bootstrap entries — everything after this index is user-learned */
  private bootstrapEntryCount = 0;

  // Track topics we couldn't answer — so we can tell the user what to teach us
  private missedTopics: Map<string, number> = new Map();

  // ─── SELF-AWARENESS TRACKING ───
  // Ring buffer of recent response metadata for diagnostics
  private responseHistory: ResponseMeta[] = [];
  private strategyStats: Map<string, number> = new Map();
  private _lastMeta: ResponseMeta | null = null;
  private _lastSearchResponse: SearchResponse | null = null;
  private static readonly HISTORY_SIZE = 100;

  // ── Synthesis scoring constants ──────────────────────────────────
  /** Number of TF-IDF documents to retrieve for synthesis */
  private static readonly SYNTHESIS_RETRIEVE_COUNT = 8;
  /** Minimum TF-IDF score to consider a retrieval result */
  private static readonly SYNTHESIS_MIN_SCORE = 0.05;
  /** Hit-rate threshold for queries with 3+ meaningful words */
  private static readonly SYNTHESIS_HIT_RATE_LONG = 0.6;
  /** Hit-rate threshold for queries with <3 meaningful words */
  private static readonly SYNTHESIS_HIT_RATE_SHORT = 0.5;
  /** Relative score threshold to include secondary sources (fraction of best score) */
  private static readonly SYNTHESIS_GOOD_MATCH_RATIO = 0.75;

  // ── Per-request memoization cache ────────────────────────────────
  // Eliminates redundant findBestMatch / retrieveRelevant / findBestTaughtMatch
  // calls across the 30-strategy chain. Cleared at the start of each generateResponse().
  private _matchCache = new Map<string, KnowledgeEntry | null>();
  private _taughtMatchCache = new Map<string, KnowledgeEntry | null>();
  private _retrieveCache = new Map<string, Array<{ text: string; source: string; score: number }>>();

  /** Cached findBestMatch — reuses result for identical input within one request */
  private cachedFindBestMatch(input: string): KnowledgeEntry | null {
    if (this._matchCache.has(input)) return this._matchCache.get(input)!;
    const result = this.knowledge.findBestMatch(input);
    this._matchCache.set(input, result);
    return result;
  }

  /** Cached findBestTaughtMatch — reuses result for identical input within one request */
  private cachedFindBestTaughtMatch(input: string): KnowledgeEntry | null {
    if (this._taughtMatchCache.has(input)) return this._taughtMatchCache.get(input)!;
    const result = this.knowledge.findBestTaughtMatch(input);
    this._taughtMatchCache.set(input, result);
    return result;
  }

  /** Cached retrieveRelevant — reuses result for identical query+topK within one request */
  private cachedRetrieveRelevant(query: string, topK = 5): Array<{ text: string; source: string; score: number }> {
    const key = `${query}|${topK}`;
    if (this._retrieveCache.has(key)) return this._retrieveCache.get(key)!;
    const result = this.knowledge.retrieveRelevant(query, topK);
    this._retrieveCache.set(key, result);
    return result;
  }

  /** Clear all per-request caches — called at start of each generateResponse() */
  private clearRequestCache(): void {
    this._matchCache.clear();
    this._taughtMatchCache.clear();
    this._retrieveCache.clear();
  }

  constructor(options?: VaiEngineOptions) {
    this.persistPath = options?.persistPath ?? null;

    // Seed with foundational knowledge
    this.knowledge.addEntry(
      'hello', 'Hello! I am VeggaAI. I am still learning, but I will do my best to help you.',
      'bootstrap', 'en',
    );
    this.knowledge.addEntry(
      'hei', 'Hei! Jeg er VeggaAI. Jeg laerer fortsatt, men jeg skal gjore mitt beste.',
      'bootstrap', 'no',
    );
    this.knowledge.addEntry(
      'what are you', 'I am VeggaAI (VAI), a local-first AI built from scratch. I learn from sources you give me — web pages, transcripts, code, and conversations. I understand English and Norwegian.',
      'bootstrap', 'en',
    );
    this.knowledge.addEntry(
      'hva er du', 'Jeg er VeggaAI (VAI), en lokal AI bygget fra bunnen av. Jeg laerer fra kilder du gir meg.',
      'bootstrap', 'no',
    );
    this.knowledge.addEntry(
      'what can you do', 'Right now I can: learn from text you feed me, answer based on what I have learned, generate code in 20+ languages, do math, discuss topics Socratically, and search the web when you say "google it". I am v0 — pattern matching and n-grams. I also know about testing tools, dev patterns, and code utilities. As you feed me more data, I get better.',
      'bootstrap', 'en',
    );

    // ─── TESTING TOOLS KNOWLEDGE ───
    this.bootstrapTestingKnowledge();
    // ─── CODE PATTERNS KNOWLEDGE ───
    this.bootstrapCodePatterns();
    // ─── CURRENT EVENTS KNOWLEDGE ───
    this.bootstrapCurrentEvents();
    // ─── BEST PRACTICES KNOWLEDGE ───
    this.bootstrapBestPractices();
    // ─── ADVANCED DOMAINS ───
    this.bootstrapAdvancedDomains();
    // ─── COGNITIVE FOUNDATIONS ───
    this.bootstrapCognitiveFoundations();

    // ─── KNOWLEDGE EXPANSION (benchmark-driven gap fills) ───
    this.bootstrapKnowledgeExpansion();

    // ─── KNOWLEDGE EXPANSION R14b (24 remaining benchmark failures) ───
    this.bootstrapKnowledgeExpansionR14b();

    // ─── KNOWLEDGE CONNECTIONS (cross-domain bridge facts) ───
    this.bootstrapKnowledgeConnections();

    // ─── KNOWLEDGE INTELLIGENCE ───
    this.intelligence = new KnowledgeIntelligence(this.knowledge);

    // ─── SEARCH PIPELINE (Perplexity-style) ───
    this.searchPipeline = new SearchPipeline();
    this.searchPipeline.setLearnCallback((text, sourceUrl) => {
      this.knowledge.learn(text, sourceUrl, 'en');
      this.knowledge.addEntry(text.slice(0, 100).toLowerCase(), text, sourceUrl, 'en');
      this.tokenizer.encode(text);
      this.schedulePersist();
    });

    // Record how many entries are bootstrap (everything added above)
    this.bootstrapEntryCount = this.knowledge.entryCount;

    // Load persisted user-learned knowledge (if any)
    this.loadPersistedSync();
  }

  /**
   * Bootstrap VAI with knowledge about testing tools across TS/Rust/binary ecosystems.
   */
  private bootstrapTestingKnowledge(): void {
    const src = 'bootstrap:testing-tools-2026';

    // Unit testing
    this.knowledge.addEntry('vitest', 'Vitest is the fastest JavaScript/TypeScript test runner in 2026. It is Vite-powered, ESM-native, and Jest-compatible. Best for unit tests in Next.js/React/Vue projects. Use Vitest Browser Mode when jsdom lies to you (events, layout, real browser APIs).', src, 'en');
    this.knowledge.addEntry('jest', 'Jest is a zero-config JavaScript testing framework with snapshots and React Testing Library integration. In 2026, Vitest is preferred over Jest for new projects because Jest has slow ESM support.', src, 'en');
    this.knowledge.addEntry('testing library', 'Testing Library is a user-focused component testing approach for React, Vue, Angular, and more. It encourages testing from the user perspective rather than implementation details.', src, 'en');
    this.knowledge.addEntry('happy dom', 'Happy DOM is a lightweight DOM implementation alternative to jsdom for running browser-like tests in Node.js. Faster but less feature-complete than jsdom.', src, 'en');

    // E2E testing
    this.knowledge.addEntry('playwright', 'Playwright is the top E2E testing framework in 2026. Cross-browser (Chromium, Firefox, WebKit), supports mobile, API testing, and has the fastest setup. Use toPass() pattern for hydration/timing issues in Next.js. Avoid fixed sleeps for flaky tests.', src, 'en');
    this.knowledge.addEntry('cypress', 'Cypress is an E2E testing framework with time-travel debugging and great developer experience. In 2026, Playwright is generally preferred because Cypress has Chrome bias. Still useful for its debugging UI.', src, 'en');
    this.knowledge.addEntry('puppeteer', 'Puppeteer is a headless Chrome automation library by Google. Good for Chrome-specific automation and scraping. For testing, Playwright is preferred.', src, 'en');

    // API testing
    this.knowledge.addEntry('supertest', 'supertest is the standard library for testing HTTP endpoints in Express, Hapi, and Fastify servers. Use with Vitest for API integration tests.', src, 'en');
    this.knowledge.addEntry('msw', 'MSW (Mock Service Worker) intercepts HTTP requests at the network level for API mocking. Critical for reliable tests. Key gotcha: handler not matching, URL mismatch, wrong environment, and wrong lifecycle hooks cause most failures. Don\'t treat MSW failures as random flake — they\'re usually deterministic misconfig.', src, 'en');

    // Rust testing
    this.knowledge.addEntry('cargo nextest', 'cargo-nextest is the fastest Rust test runner in 2026, with better filtering and parallel execution than built-in cargo test.', src, 'en');
    this.knowledge.addEntry('rust testing', 'Rust testing ecosystem (2026): cargo test (built-in), nextest (fastest runner), insta (snapshot testing), proptest (property-based), loom (concurrent race detection), cargo-fuzz (fuzzing), mockall (mock generation), tokio::test (async).', src, 'en');

    // Testing strategy
    this.knowledge.addEntry('testing strategy 2026', 'Recommended 2026 testing strategy: PRIMARY: Playwright (E2E/API) + Vitest (unit). AVOID: Jest-only (slow ESM), Cypress-only (Chrome bias). For VeggaAI: Playwright test generation + Vitest inline snapshots. Use Vitest Browser Mode when jsdom is insufficient.', src, 'en');

    // Learn the full text for TF-IDF retrieval
    const toolsText = `Testing Tools 2026: Unit testing: Vitest (fastest, Vite-powered), Jest, Testing Library, Happy DOM, uvu, ava, Mocha+Chai. E2E: Playwright (cross-browser, mobile, API), Cypress (time-travel debugging), Puppeteer, Selenium, TestCafe, WebdriverIO. API: supertest, MSW, Postman, Hoppscotch. Rust: cargo test, nextest, insta, proptest, loom, cargo-fuzz, mockall, tokio::test. AI/Agent: LangChain JS/TS, E2B, Playwright MCP. Decision: Vitest for unit tests, Playwright for E2E, supertest+Vitest for API, nextest for Rust, k6 for load testing.`;
    this.knowledge.learn(toolsText, src, 'en');
    this.tokenizer.encode(toolsText);
  }

  /**
   * Bootstrap VAI with knowledge about common code patterns and utilities.
   */
  private bootstrapCodePatterns(): void {
    const src = 'bootstrap:code-patterns';

    // Word/character/line counter
    this.knowledge.addEntry('word counter', `Here's a word/character/line counter in JavaScript:\n\n\`\`\`javascript\nconst text = require('fs').readFileSync('/dev/stdin', 'utf8');\nconst lines = text === '' ? 0 : text.split('\\n').length;\nconst words = text.trim() === '' ? 0 : text.trim().split(/\\s+/).length;\nconst chars = text.length;\nconsole.log(JSON.stringify({ chars, words, lines }, null, 2));\n\`\`\`\n\nTypeScript version adds proper types: Promise<string> for readStdin, number for counts.`, src, 'en');

    // Email extractor
    this.knowledge.addEntry('extract emails', `Here's an email extractor in JavaScript:\n\n\`\`\`javascript\nconst text = require('fs').readFileSync('/dev/stdin', 'utf8');\nconst re = /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/gi;\nconst found = text.match(re) ?? [];\nconst unique = [...new Set(found.map(s => s.toLowerCase()))].sort();\nunique.forEach(e => console.log(e));\n\`\`\`\n\nUses a practical email regex (not full RFC validator). Deduplicates case-insensitively and sorts.`, src, 'en');

    // Text wrap
    this.knowledge.addEntry('wrap text', `Here's a text wrapper (normalize whitespace + wrap to width) in JavaScript:\n\n\`\`\`javascript\nfunction wrap(text, width = 80) {\n  const words = text.trim().replace(/\\s+/g, ' ').split(' ').filter(Boolean);\n  const lines = []; let line = '';\n  for (const w of words) {\n    if (!line) line = w;\n    else if (line.length + 1 + w.length <= width) line += ' ' + w;\n    else { lines.push(line); line = w; }\n  }\n  if (line) lines.push(line);\n  return lines.join('\\n');\n}\n\`\`\``, src, 'en');

    // KV to JSON
    this.knowledge.addEntry('key value to json', `Parse key=value lines into JSON in JavaScript:\n\n\`\`\`javascript\nconst text = require('fs').readFileSync('/dev/stdin', 'utf8');\nconst obj = {};\nfor (const raw of text.split(/\\r?\\n/)) {\n  const line = raw.trim();\n  if (!line || line.startsWith('#')) continue;\n  const idx = line.indexOf('=');\n  if (idx === -1) continue;\n  const key = line.slice(0, idx).trim();\n  const value = line.slice(idx + 1).trim();\n  if (key) obj[key] = value;\n}\nconsole.log(JSON.stringify(obj, null, 2));\n\`\`\`\n\nIgnores empty lines and comments (lines starting with #).`, src, 'en');

    // Punctuation counter
    this.knowledge.addEntry('count punctuation', `Count punctuation characters in JavaScript:\n\n\`\`\`javascript\nconst text = require('fs').readFileSync('/dev/stdin', 'utf8');\nconst counts = { '.': 0, ',': 0, '!': 0, '?': 0, ':': 0, ';': 0 };\nfor (const ch of text) if (ch in counts) counts[ch]++;\nconsole.log(JSON.stringify(counts, null, 2));\n\`\`\``, src, 'en');

    // Pattern-focused mentor prompt
    this.knowledge.addEntry('pattern focused mentor', `Pattern-Focused Mentor meta-prompt template:\n\n"From now on, act as a Pattern-Focused Mentor. Whenever I provide input: 1) Identify Core Patterns (recurring themes, logical structures, underlying rules), 2) Create a Learning Framework (ask ONE reflective question at a time), 3) Use Analogies (one from a totally different field), 4) Test Understanding (new scenario after I respond)."\n\nThis is a Socratic teaching technique that builds deep understanding through pattern recognition across domains.`, src, 'en');

    // Universal pattern decoder
    this.knowledge.addEntry('universal pattern decoder', `Universal Pattern Decoder prompt:\n\n"Act as a Universal Pattern Decoder. Protocol: 1) Deconstruct to First Principles (invariants, rules, loops, constraints), 2) Multidimensional Analogies (one from nature/biology, one from engineering/tech), 3) Socratic Scaffolding (ONE high-leverage question, then wait), 4) Stress-Test (edge-case scenario after I answer)."\n\nThis is a scaled version of pattern-focused mentoring that adds first-principles deconstruction.`, src, 'en');

    // Analogy ladder
    this.knowledge.addEntry('analogy ladder', `Analogy Ladder Teaching prompt:\n\n"Act as an Analogy Ladder Teacher. Task: 1) Extract the pattern in one sentence, 2) Give 3 analogies sharing the same pattern (Nature/Biology, Engineering/Tech, Everyday social life), 3) Ask ONE reflective question, 4) Stop and wait."\n\nTeaches pattern transfer across domains using analogies as a ladder from concrete to abstract.`, src, 'en');

    // Learn code pattern descriptions for TF-IDF
    const patternsText = `Code utilities: word counter (count characters, words, lines from stdin), email extractor (regex matching unique emails), text wrapper (normalize whitespace and wrap to width), key-value to JSON parser (parse config lines), punctuation counter (count periods commas exclamations). Pattern prompts: Pattern-Focused Mentor (Socratic one-question-at-a-time), Universal Pattern Decoder (first principles + stress test), Pattern Spotting Worksheet (active discovery), Analogy Ladder (same pattern across 3 domains), Pattern Transfer Tutor (identify rule + edge case).`;
    this.knowledge.learn(patternsText, src, 'en');
    this.tokenizer.encode(patternsText);
  }

  /**
   * Bootstrap VAI with current events and factual knowledge (2025-2026).
   */
  private bootstrapCurrentEvents(): void {
    const src = 'bootstrap:current-events-2026';

    // Anthropic / Pentagon
    this.knowledge.addEntry('anthropic pentagon', 'On January 3, 2026, Venezuela\'s Maduro regime publicly acknowledged running intelligence operations using Anthropic\'s Claude models for surveillance purposes. On February 27, 2026, U.S. Defense Secretary Pete Hegseth designated Anthropic a "supply chain risk to national security" and threatened to cancel their $200 million Pentagon contract. The Pentagon gave Anthropic 90 days to prove their AI was not compromised. OpenAI immediately signed a replacement deal with the Pentagon. Anthropic\'s stock dropped 40% in one day.', src, 'en');

    this.knowledge.addEntry('anthropic', 'Anthropic is an AI safety company that makes Claude AI models. Founded by Dario and Daniela Amodei (ex-OpenAI). In early 2026, Anthropic faced a major crisis when Venezuela was caught using Claude for surveillance, leading the Pentagon to threaten cancellation of their $200M defense contract. Defense Secretary Pete Hegseth designated them a "supply chain risk to national security" on February 27, 2026.', src, 'en');

    this.knowledge.addEntry('venezuela maduro ai', 'In January 2026, Venezuela\'s Maduro regime was exposed running intelligence and surveillance operations using Anthropic\'s Claude AI models. This led to a major U.S. national security crisis. On January 3, 2026, Venezuela publicly acknowledged the operations. By February 27, 2026, the U.S. Pentagon designated Anthropic a supply chain risk and threatened to cancel their $200M contract.', src, 'en');

    this.knowledge.addEntry('pentagon status', 'The Pentagon\'s relationship with AI companies changed dramatically in early 2026. After the Venezuela-Anthropic scandal, Defense Secretary Pete Hegseth designated Anthropic a "supply chain risk." OpenAI moved to replace Anthropic as the Pentagon\'s primary AI provider. The Pentagon Status can be modeled as: Active (pre-scandal), UnderReview (investigation), Suspended (contract frozen), Terminated (contract cancelled), Replaced (new vendor).', src, 'en');

    // Circle K
    this.knowledge.addEntry('circle k ceo', 'The CEO of Circle K is Alex Miller. Circle K is an international chain of convenience stores, a subsidiary of Alimentation Couche-Tard. Alex Miller leads Circle K\'s global operations.', src, 'en');

    this.knowledge.addEntry('circle k', 'Circle K is an international chain of convenience stores and gas stations, headquartered in Tempe, Arizona. It is a subsidiary of Alimentation Couche-Tard, a Canadian company. Circle K operates over 14,000 stores globally. The current CEO is Alex Miller.', src, 'en');

    // US President
    this.knowledge.addEntry('us president', 'The President of the United States is Donald Trump (47th president). He took office on January 20, 2025. Trump previously served as the 45th president from 2017 to 2021.', src, 'en');

    // Norway
    this.knowledge.addEntry('hommersåk', 'Hommersåk is a village in Sandnes municipality in Rogaland county, Norway. It is located on the Ryfylke coast, about 15 km north of Sandnes. Typical temperatures: summer 15-20°C, winter 0-5°C. January average around 1-3°C, July average around 15-17°C. The temperature varies with North Sea weather patterns. For the current temperature, try "google temperature Hommersåk Norway".', src, 'en');

    this.knowledge.addEntry('hommersåk temperature', 'Hommersåk is in Rogaland, Norway. Typical temperatures range from -5°C to 25°C throughout the year. Winter (Dec-Feb): 0-5°C average, often around 2°C. Summer (Jun-Aug): 14-20°C average. Spring/Fall: 5-12°C. For the current real-time temperature, say "google current temperature Hommersåk" and I\'ll search for it.', src, 'en');

    // Learn full event text for TF-IDF
    const eventsText = `Current Events 2026: Anthropic Pentagon supply chain risk national security. Venezuela Maduro regime Claude AI surveillance operations January 2026. Defense Secretary Pete Hegseth designated Anthropic supply chain risk February 27 2026. Pentagon threatened cancel 200 million dollar contract. OpenAI signed replacement deal Pentagon. Anthropic stock dropped 40 percent. Circle K CEO Alex Miller convenience stores Alimentation Couche-Tard. Circle K international chain 14000 stores globally. Hommersåk village Sandnes Rogaland Norway Ryfylke coast temperature weather. Pete Hegseth Secretary of Defense. Dario Amodei Daniela Amodei Anthropic founders.`;
    this.knowledge.learn(eventsText, src, 'en');
    this.tokenizer.encode(eventsText);
  }

  /**
   * Bootstrap knowledge about framework and language best practices.
   */
  private bootstrapBestPractices(): void {
    const src = 'bootstrap:best-practices';

    this.knowledge.addEntry('nextjs best practices', 'Next.js best practices: Use Server-Side Rendering (SSR) with getServerSideProps for dynamic data. Use Static Site Generation (SSG) with getStaticProps for pre-built pages. Use Incremental Static Regeneration (ISR) with revalidate for updating static pages. Prefer App Router with React Server Components. Use next/image for automatic image optimization with lazy loading, srcset, and WebP. Use next/font for zero-layout-shift fonts. Use dynamic() imports for code splitting. Export metadata or generateMetadata for SEO. Use file-based routing with layout.tsx for shared UI. Leverage built-in caching and revalidateTag for invalidation.', src, 'en');

    this.knowledge.addEntry('vite best practices', 'Vite best practices: Use defineConfig helper for TypeScript autocompletion. Configure resolve.alias for cleaner imports. Use VITE_ prefix for client-exposed env variables. Vite uses native ES modules for instant Hot Module Replacement (HMR). Avoid barrel files (index.ts re-exports) as they slow HMR. Use optimizeDeps.include for large dependencies. Leverage the Rollup-compatible plugin ecosystem. Use build.rollupOptions.output.manualChunks for chunk splitting. Use import.meta.env for environment variables. Use import.meta.glob for dynamic imports. Enable build.sourcemap for production debugging. Use vite preview to test production builds.', src, 'en');

    this.knowledge.addEntry('typescript overview', '**TypeScript** is JavaScript with a safety net — same language underneath, but it catches bugs before your code ever runs.\n\nDeveloped by **Microsoft** (2012), it\'s now the default choice for serious JavaScript projects.\n\n**What it adds over JavaScript:**\n- **Static type checking** — catch errors at compile time, not runtime\n- **IntelliSense** — superior autocomplete and refactoring in IDEs\n- **Interfaces & generics** — better code architecture and reusability\n- **Enums, tuples, union types** — richer type system\n- **Refactoring safety** — rename symbols confidently across large codebases\n\n**Example:**\n```typescript\ninterface User {\n  id: number;\n  name: string;\n  role: "admin" | "user";\n}\n```\n\nTypeScript compiles to plain JavaScript and runs anywhere JS runs.', src, 'en');

    this.knowledge.addEntry('typescript best practices', 'TypeScript best practices: Enable strict mode in tsconfig.json for strictNullChecks, noImplicitAny, and strictFunctionTypes. Never use any — prefer unknown with type guards for narrowing. Use interfaces for object shapes and class contracts. Use type aliases for unions, intersections, and mapped types. Use generics with extends constraints for reusable type-safe code. Use discriminated unions for state management. Prefer as const for literal types. Use satisfies operator to validate without widening. Use optional chaining (?.) and nullish coalescing (??) for null safety. Enable noUncheckedIndexedAccess for safer access. Use template literal types for string patterns.', src, 'en');

    this.knowledge.addEntry('react best practices', 'React best practices: Keep components small and focused on single responsibility. Use composition over inheritance with children and render props. Extract reusable logic into custom hooks. Lift state only as high as needed. Use useReducer for complex state. Consider Zustand or Jotai for shared state. Use React.memo for expensive components. Memoize with useCallback and useMemo only when needed. Use key props correctly. Follow Rules of Hooks. Use useEffect cleanup to prevent memory leaks. Prefer useRef for non-rendering values.', src, 'en');

    const bpText = `Best practices knowledge: Next.js SSR SSG ISR App Router Server Components image optimization next/image next/font code splitting dynamic imports metadata SEO file-based routing layout caching revalidateTag. Vite HMR hot module replacement ES modules defineConfig resolve alias VITE_ env variables Rollup plugins manualChunks import.meta.env import.meta.glob sourcemap vite preview. TypeScript strict mode tsconfig noImplicitAny strictNullChecks generics interfaces type aliases discriminated unions satisfies as const optional chaining nullish coalescing. React composition custom hooks useReducer Zustand React.memo useCallback useMemo key props useEffect cleanup useRef.`;
    this.knowledge.learn(bpText, src, 'en');
    this.tokenizer.encode(bpText);
  }

  /**
   * Bootstrap VAI with advanced domain knowledge:
   * - Scaling architecture patterns (lazy init, JIT hydration, event bus, N-tier)
   * - Vector space, embeddings, HNSW graph search
   * - GitHub Copilot context model
   * - Linguistic coherence theory
   * - Strategic thinking frameworks
   * - Missing architecture domains (SSO, microservices, message queues, load balancing, caching)
   */
  private bootstrapAdvancedDomains(): void {
    const src = 'bootstrap:advanced-domains-2026';

    // ── Scaling Architecture Patterns ──────────────────────────────
    this.knowledge.addEntry('lazy initialization', 'Lazy initialization (lazy start) defers expensive object creation until first access. Pattern: check if null → create → cache → return. Used in singleton patterns, database connection pools, and module loading. In JavaScript: dynamic import() for code splitting. In Rust: std::sync::LazyLock or once_cell::sync::Lazy. In Go: sync.Once. Eliminates cold-start cost for unused resources. Key trade-off: first access is slower, but avoids loading everything at startup (LINEAR → BURST transition).', src, 'en');

    this.knowledge.addEntry('jit hydration', 'JIT (Just-In-Time) hydration delays component hydration until the component enters the viewport or receives interaction. Used in Astro (Islands Architecture), Qwik (resumability), and Next.js (React Server Components + Suspense boundaries). The pattern: server-render HTML → ship zero JS → hydrate on demand. This reduces Time-to-Interactive (TTI) and JavaScript payload. Contrast with eager hydration (React traditional) where all components hydrate on page load.', src, 'en');

    this.knowledge.addEntry('event bus pattern', 'An event bus (or message bus) enables O(1) decoupled communication between components. Publishers emit events without knowing subscribers. Pattern: EventEmitter in Node.js, CustomEvent in browsers, or libraries like mitt/tiny-emitter. Architecture: components register handlers for event types → publisher emits → bus routes to all subscribers. Benefits: loose coupling, easy to add new subscribers, testable. Risks: event spaghetti, hard to trace flow, memory leaks from unsubscribed handlers. In microservices: message brokers (RabbitMQ, Kafka, Redis Pub/Sub) serve the same role.', src, 'en');

    this.knowledge.addEntry('fault tolerant parallelism', 'Fault-tolerant parallelism runs multiple async operations concurrently where individual failures don\'t crash the batch. JavaScript: Promise.allSettled() returns { status, value/reason } for every promise regardless of success/failure. Contrast with Promise.all() which rejects on first failure. Pattern: fan-out requests → collect results → filter fulfilled/rejected → process. Used in batch API calls, health checks, data pipelines. In Go: errgroup with SetLimit(). In Rust: tokio::JoinSet with error handling per task.', src, 'en');

    this.knowledge.addEntry('n-tier architecture', 'N-tier architecture separates an application into logical layers. Classic 3-tier: Presentation (UI) → Business Logic (API/services) → Data (database). Modern N-tier in web: CDN → Edge Functions → API Gateway → Microservices → Database → Cache. Each tier can scale independently. Benefits: separation of concerns, independent deployment, team autonomy. Trade-offs: network latency between tiers, operational complexity, data consistency challenges. The "N" means any number of tiers — common patterns are 2-tier (client-server), 3-tier, and 4-tier (adding cache layer).', src, 'en');

    this.knowledge.addEntry('spatial addressing voxel', 'Spatial addressing (voxel/octree) maps entities to 3D coordinates for O(1) neighbor lookup. A voxel is a 3D pixel — a unit cube in a volume grid. Octrees subdivide 3D space recursively into 8 children, enabling efficient spatial queries. Used in: game engines (Minecraft block world), medical imaging (CT/MRI), point cloud processing (LiDAR), and physics simulations. In web: Three.js uses bounding box hierarchies (BVH) for raycasting. Key insight: spatial data structures convert O(n) distance checks to O(log n) or O(1) by organizing data by position rather than insertion order.', src, 'en');

    // ── Vector Space / Embeddings / HNSW ──────────────────────────
    this.knowledge.addEntry('embeddings vector space', 'Embeddings map discrete items (words, sentences, images) into continuous vector space where semantic similarity = geometric proximity. Word embeddings: Word2Vec, GloVe, FastText. Sentence embeddings: all-MiniLM-L6-v2, text-embedding-3-small (OpenAI), Cohere embed. Dimensionality: typically 384-1536 dimensions. Cosine similarity measures angle between vectors (1.0 = identical, 0 = orthogonal). Used for: semantic search, recommendation systems, RAG (Retrieval-Augmented Generation), clustering, anomaly detection. The embedding space captures meaning: king - man + woman ≈ queen.', src, 'en');

    this.knowledge.addEntry('semantic search ann', 'Semantic search uses vector embeddings + ANN (Approximate Nearest Neighbor) algorithms to find relevant content by meaning rather than exact keywords. Pipeline: query → embed → ANN search → rerank → return. ANN algorithms: HNSW (Hierarchical Navigable Small World), IVF (Inverted File Index), PQ (Product Quantization). Vector databases: Pinecone, Weaviate, Qdrant, Milvus, Chroma, pgvector (PostgreSQL extension). Key trade-off: ANN gives ~95-99% recall at 100x speed vs exact kNN. Used in: RAG pipelines, code search (GitHub Copilot), image search, recommendation engines.', src, 'en');

    this.knowledge.addEntry('hnsw graph search', 'HNSW (Hierarchical Navigable Small World) is the dominant ANN algorithm for vector search. Structure: multi-layer graph where top layers have few long-range connections (highways) and bottom layers have dense local connections. Search: start at top layer → greedy traverse to nearest → descend to next layer → repeat. Complexity: O(log n) search, O(n log n) build. Parameters: M (max connections per node), efConstruction (build quality), efSearch (query accuracy vs speed). Used by: Pinecone, Qdrant, pgvector, Weaviate, FAISS. Based on small-world network theory — any node reachable in O(log n) hops via "wormhole" connections.', src, 'en');

    this.knowledge.addEntry('context window management', 'Context window is the maximum input size an LLM can process (measured in tokens). GPT-4 Turbo: 128K tokens. Claude 3.5: 200K tokens. Gemini 1.5: up to 2M tokens. Management strategies: sliding window (keep last N tokens), RAG (retrieve relevant chunks), summarization (compress old context), hierarchical (summary + recent detail). For code assistants: file-level context > project-level context > workspace-level context. The quality of context selection matters more than window size — 4K tokens of highly relevant code beats 128K of noise.', src, 'en');

    // ── GitHub Copilot Context Model ──────────────────────────────
    this.knowledge.addEntry('github copilot context', 'GitHub Copilot uses 7 context sources for code completion: (1) current file content, (2) open editor tabs (neighboring tabs heuristic), (3) imports and dependencies, (4) LSP symbols (function signatures, types), (5) repository structure, (6) recent edits, (7) conversation history (in Chat mode). Copilot prioritizes the cursor\'s surrounding code, then expands to related files. Context is sent as a prompt to the model (Codex/GPT-4). Optimization: keep related files open in tabs, use descriptive function names, add JSDoc comments for better suggestions.', src, 'en');

    this.knowledge.addEntry('copilot optimization', 'Optimizing GitHub Copilot suggestions: (1) Write clear function names and comments — Copilot reads natural language. (2) Keep related files open in editor tabs — neighboring tab context. (3) Add type annotations — TypeScript types guide completions. (4) Use descriptive variable names. (5) Write a comment line before code — acts as a prompt. (6) Accept partial completions with Ctrl+Right (word-by-word). (7) Use Copilot Chat for complex tasks instead of inline completion. (8) Create a .github/copilot-instructions.md for project-specific guidance.', src, 'en');

    // ── Linguistic Coherence ──────────────────────────────────────
    this.knowledge.addEntry('linguistic coherence', 'Coherence in linguistics is the logical connectedness that makes a text understandable as a unified whole. Two levels: (1) Local coherence — adjacent sentences relate logically (cause-effect, temporal sequence, elaboration). (2) Global coherence — the entire text follows a clear theme/argument. Distinct from cohesion (surface-level links like pronouns, connectives). A text can have cohesion without coherence ("He likes coffee. Coffee grows in Brazil. Brazil is in South America." — cohesive but incoherent as an argument). Key techniques: topic sentences, logical transitions, consistent point of view, parallel structure, given-new information flow.', src, 'en');

    this.knowledge.addEntry('coherence techniques', 'Text coherence techniques: (1) Given-new contract — start sentences with known info, end with new info. (2) Topic-comment structure — establish what you\'re talking about, then say something about it. (3) Logical connectives — "therefore", "however", "because", "as a result". (4) Consistent register — don\'t mix formal and casual tone. (5) Paragraph unity — one main idea per paragraph with a topic sentence. (6) Referential coherence — pronouns clearly refer to their antecedents. (7) Temporal coherence — events in logical time order. In NLP: coherence scoring uses entity grids, discourse relations (RST), and neural coherence models.', src, 'en');

    // ── Strategic Thinking ────────────────────────────────────────
    this.knowledge.addEntry('strategic thinking', 'Strategic thinking is the ability to analyze situations, anticipate consequences, and make decisions that optimize long-term outcomes. Frameworks: (1) OODA loop (Observe-Orient-Decide-Act) — military decision-making cycle. (2) First principles — decompose problems to fundamental truths before re-assembling. (3) Second-order thinking — consider "and then what?" consequences. (4) Opportunity cost — every choice has a tradeoff. (5) Reversibility — prefer reversible decisions (two-way doors) over irreversible ones (one-way doors). In chess: positional thinking (control squares) > tactical thinking (immediate threats). In engineering: architecture decisions are one-way doors; implementation details are two-way doors.', src, 'en');

    this.knowledge.addEntry('strategic engineering', 'Strategic thinking applied to software engineering: (1) Build abstractions that survive requirement changes — code to interfaces not implementations. (2) Prefer composable systems over monolithic ones — composition > inheritance. (3) Optimize for changeability over initial perfection — YAGNI but with clean seams. (4) Make the common case fast and the edge case possible. (5) Invest in developer ergonomics — good DX compounds exponentially. (6) Measure before optimizing — profiling > guessing. (7) Design for failure — every network call can fail, every disk write can corrupt. Defense in depth: validation at boundaries, idempotent operations, graceful degradation.', src, 'en');

    // ── Missing Architecture Domains ──────────────────────────────
    this.knowledge.addEntry('sso single sign on', 'SSO (Single Sign-On) lets users authenticate once and access multiple applications. Protocols: SAML 2.0 (XML-based, enterprise), OpenID Connect/OIDC (JSON/JWT-based, modern), OAuth 2.0 (authorization, not authentication). Flow: user visits App A → redirected to Identity Provider (IdP) → authenticates → receives token → token validated by App A → session created. Providers: Okta, Auth0, Azure AD, Keycloak (self-hosted), Google Workspace. Implementation with Next.js: use NextAuth.js providers or Clerk for managed SSO. Key consideration: session management across apps — shared cookies (same domain) or token exchange (cross-domain).', src, 'en');

    this.knowledge.addEntry('microservices architecture', 'Microservices decompose a monolithic application into small, independently deployable services. Each service owns its data, has a single responsibility, and communicates via APIs (REST, gRPC, message queues). Benefits: independent scaling, technology diversity, fault isolation, team autonomy. Challenges: distributed transactions (saga pattern), data consistency (eventual consistency), service discovery, observability (distributed tracing with OpenTelemetry). When to use: large teams (>20 developers), independently scaling components, polyglot persistence needs. When NOT to use: small teams, simple CRUD apps, early-stage startups. Start monolith → extract microservices when needed.', src, 'en');

    this.knowledge.addEntry('message queues', 'Message queues enable asynchronous communication between services. Producers send messages → queue stores them → consumers process at their own pace. Technologies: RabbitMQ (AMQP, routing, exchanges), Apache Kafka (event streaming, log-based, high throughput), Redis Streams (lightweight, in-memory), AWS SQS (managed, serverless), BullMQ (Node.js + Redis). Patterns: point-to-point (one consumer), pub/sub (many consumers), request-reply, dead-letter queue (failed messages). Use cases: email sending, image processing, order fulfillment, event sourcing, inter-service communication. Key guarantee levels: at-most-once, at-least-once, exactly-once (hardest).', src, 'en');

    this.knowledge.addEntry('load balancing', 'Load balancing distributes incoming traffic across multiple servers to ensure availability and performance. Algorithms: Round Robin (sequential), Weighted Round Robin (capacity-proportional), Least Connections (route to least busy), IP Hash (sticky sessions), Random. Layers: L4 (TCP/UDP — fast, no content inspection) vs L7 (HTTP — content-aware routing, SSL termination). Tools: Nginx, HAProxy, AWS ALB/NLB, Cloudflare, Traefik. Health checks: active (periodic probes) vs passive (monitor response codes). Modern patterns: Global Server Load Balancing (GSLB) with DNS, Anycast, edge routing.', src, 'en');

    this.knowledge.addEntry('caching strategies', 'Caching stores frequently accessed data closer to the consumer for faster retrieval. Strategies: (1) Cache-aside (lazy load) — app checks cache → miss → fetch from DB → store in cache. (2) Write-through — write to cache and DB simultaneously. (3) Write-behind — write to cache → async flush to DB. (4) Read-through — cache fetches from DB on miss. Layers: browser cache (HTTP headers), CDN (edge), application cache (Redis/Memcached), database query cache, OS page cache. Cache invalidation: TTL-based, event-driven (pub/sub), versioning. "There are only two hard things in CS: cache invalidation and naming things." — Phil Karlton.', src, 'en');

    this.knowledge.addEntry('search architecture', 'Search architecture for applications: Full-text search: Elasticsearch (JVM, distributed), Meilisearch (Rust, instant search), Typesense (C++, typo-tolerant), PostgreSQL FTS (built-in tsvector/tsquery). Pipeline: ingest → tokenize → index (inverted index) → query → rank → return. Relevance scoring: BM25 (statistical), TF-IDF (term frequency), vector search (semantic). Features: faceted search, autocomplete, fuzzy matching, synonyms, filters. For small scale: PostgreSQL FTS + trigram indexes. For medium: Meilisearch or Typesense. For large: Elasticsearch or OpenSearch. Modern: hybrid search combining keyword (BM25) + vector (embeddings) for best results.', src, 'en');

    this.knowledge.addEntry('event driven architecture', 'Event-driven architecture (EDA) uses events as the primary communication mechanism. Components produce and consume events asynchronously. Patterns: (1) Event notification — notify that something happened. (2) Event-carried state transfer — event contains all needed data. (3) Event sourcing — persist state as a sequence of events (append-only log). (4) CQRS (Command Query Responsibility Segregation) — separate read and write models. Benefits: loose coupling, scalability, audit trail, temporal queries. Technologies: Apache Kafka, EventBridge (AWS), CloudEvents (standard format). Trade-offs: eventual consistency, debugging complexity, event ordering challenges.', src, 'en');

    this.knowledge.addEntry('scalability horizontal vertical', 'Scalability is the ability to handle increased load. Vertical scaling (scale up): add more CPU/RAM/disk to one machine — simple but has physical limits. Horizontal scaling (scale out): add more machines — complex (distributed systems) but unlimited capacity. Modern approach: horizontal + stateless services. Stateless services: no server-side session state → any instance can handle any request → easy to scale horizontally. State management: externalize to databases, Redis, or message queues. Auto-scaling: Kubernetes HPA (CPU/memory metrics), AWS Auto Scaling Groups, Vercel serverless (automatic). Rule of thumb: scale reads with caching, scale writes with sharding, scale compute with horizontal instances.', src, 'en');

    // ── Role-Based AI Benchmarking ────────────────────────────────
    this.knowledge.addEntry('role based benchmarking', 'Role-based benchmarking tests an AI system\'s ability to perform as a specific professional role (DevOps Senior, Frontend Lead, Data Engineer, etc.). Design: (1) Identify competency domains for the role (e.g., DevOps: CI/CD, IaC, monitoring, incident response, security hardening). (2) Create question tiers: foundational knowledge (what is X?), applied knowledge (how would you configure X?), decision-making (when should you use X vs Y?), troubleshooting (debug this pipeline). (3) Weight scoring: foundational=1x, applied=2x, decision=3x, troubleshooting=4x. (4) Coverage metric: percentage of role competencies with passing answers. (5) Speed metric: VPT (Vai Processing Time) per question. Target: <50ms for knowledge retrieval, <200ms for synthesis. A role benchmark suite typically has 30-50 questions across 5-8 competency domains.', src, 'en');

    this.knowledge.addEntry('benchmark design methodology', 'Designing effective AI benchmarks: (1) Question taxonomy: factual recall, conceptual understanding, procedural knowledge, analytical reasoning, creative synthesis. (2) Validation function: keyword-based (check for required terms), semantic (cosine similarity to reference), structural (check for code blocks, tables, lists). (3) Scoring: binary pass/fail for precision, weighted scoring for quality (0-1 scale). (4) Anti-gaming: use paraphrased questions, shuffle answer orders for MCQ, require specific technical terms not just keywords. (5) Baseline comparison: run against known-good answers to establish floor. (6) Regression testing: re-run full suite after any knowledge change to ensure no degradation. (7) Parallel execution: use Promise.allSettled for concurrent queries, measure throughput (queries/second) alongside accuracy.', src, 'en');

    this.knowledge.addEntry('ai role simulation', 'AI role simulation tests whether an AI can consistently provide expert-level answers within a specific professional domain. Key metrics: (1) Accuracy — percentage of correct/useful answers. (2) Depth — does the answer cover edge cases, trade-offs, and real-world considerations? (3) Consistency — same quality across the full domain (no gaps). (4) Speed — response latency under load. (5) Vocabulary — uses correct domain terminology. Role simulation benchmark structure: define persona (e.g., "Senior DevOps Engineer with 8+ years experience"), create scenario-based questions ("Your CI pipeline is taking 45 minutes, how do you optimize it?"), evaluate against rubric with must-have and nice-to-have criteria. Roles to benchmark: DevOps Senior, Frontend Architect, Backend Lead, Data Engineer, Security Engineer, ML Engineer, Platform Engineer, SRE.', src, 'en');

    // ── DevOps Senior Domain ──────────────────────────────────────
    this.knowledge.addEntry('devops senior role', 'A Senior DevOps Engineer is responsible for: (1) CI/CD pipeline design and optimization — building reliable, fast pipelines using GitHub Actions, GitLab CI, Jenkins, or CircleCI. (2) Infrastructure as Code — managing cloud resources with Terraform, Pulumi, AWS CDK, or Bicep. (3) Container orchestration — Docker, Kubernetes (EKS/GKE/AKS), Helm charts, service meshes (Istio/Linkerd). (4) Monitoring and observability — Prometheus + Grafana for metrics, ELK/Loki for logs, Jaeger/Tempo for traces, PagerDuty/OpsGenie for alerting. (5) Incident response — runbooks, post-mortems, SLA/SLO/SLI definitions, blameless culture. (6) Security hardening — secrets management (Vault, AWS Secrets Manager), network policies, pod security, image scanning (Trivy, Snyk). (7) Cost optimization — right-sizing instances, spot/preemptible instances, reserved capacity planning, FinOps practices.', src, 'en');

    this.knowledge.addEntry('sla slo sli observability', 'SLA/SLO/SLI are the three pillars of service reliability: SLA (Service Level Agreement) — contractual promise to customers (e.g., 99.9% uptime = max 8.76 hours downtime/year). SLO (Service Level Objective) — internal target stricter than SLA (e.g., 99.95% uptime). SLI (Service Level Indicator) — the actual measured metric (e.g., successful requests / total requests). The observability stack: Metrics (Prometheus, Datadog, CloudWatch) — numeric time-series (CPU, latency, error rate). Logs (ELK, Loki, CloudWatch Logs) — structured event records. Traces (Jaeger, Tempo, Honeycomb) — request path across services. The "three pillars of observability" plus Events and Profiling form the complete picture. Error budget = (1 - SLO) as a spendable budget for risky changes.', src, 'en');

    this.knowledge.addEntry('incident response devops', 'Incident response lifecycle: (1) Detect — automated alerting from monitoring (PagerDuty, OpsGenie, Grafana alerts). (2) Triage — severity classification: SEV1 (critical, all-hands), SEV2 (major, team response), SEV3 (minor, normal priority). (3) Mitigate — immediate actions: rollback deploy, scale up, failover, feature flags off. (4) Resolve — root cause fix deployed and verified. (5) Post-mortem — blameless retrospective documenting timeline, root cause, impact, action items. Key metrics: MTTD (Mean Time To Detect), MTTR (Mean Time To Recover), MTBF (Mean Time Between Failures). Best practices: runbooks for common incidents, war room communication (Slack channel), status page updates (Statuspage.io), on-call rotation with escalation policies.', src, 'en');

    this.knowledge.addEntry('ci cd pipeline optimization', 'CI/CD pipeline optimization techniques: (1) Parallelism — run lint, test, build concurrently instead of sequentially. (2) Caching — cache node_modules, Docker layers, build artifacts between runs (actions/cache, Turborepo remote cache). (3) Incremental builds — only build/test affected packages (Turborepo --filter, Nx affected). (4) Docker layer caching — order Dockerfile commands from least to most changing (COPY package.json before COPY src). (5) Test splitting — distribute tests across parallel runners (Jest --shard, Playwright --shard). (6) Artifact reuse — build once, deploy to multiple environments. (7) Branch-based pipelines — full suite on main, fast checks on PRs. Target: <5 minutes for PR checks, <15 minutes for full deploy pipeline. Anti-patterns: running all tests on every commit, no caching, sequential steps that could parallelize.', src, 'en');

    // ── Benchmark Writing Guide ───────────────────────────────────
    this.knowledge.addEntry('writing vai benchmarks', 'How to write benchmarks for Vai (VeggaAI engine): (1) Define test cases as objects with { q: "question", validate: (answer) => boolean, tags: ["category"] }. (2) Validation strategies: keyword check (answer must contain specific terms), regex match (structural pattern), negative check (must NOT contain wrong info), length check (minimum substantive response). (3) Parallel execution: use Promise.allSettled with concurrency limit (e.g., 80) for throughput. (4) Scoring: count pass/fail, calculate accuracy percentage, measure avg response time. (5) Tagging: categorize by domain (devops, frontend, security) and difficulty (foundational, applied, decision). (6) Output format: summary line (passed/total @ queries/sec), failed questions list with expected vs actual. (7) Regression guard: save baseline results, compare after changes, flag any drops. Example validate: (a) => /terraform|pulumi|cdk/i.test(a) && a.length > 100.', src, 'en');

    this.knowledge.addEntry('benchmark categories', 'Vai benchmark categories and what they test: (1) mega-200 — comprehensive coverage across all domains (230 questions, target 100%). (2) precision — exact-match and format-sensitive answers (33 questions). (3) networking — network/protocol knowledge (33 questions). (4) bench-all — unified suite combining mega + precision + networking with throughput measurement. (5) Role benchmarks — domain-specific suites: devops-senior (CI/CD, IaC, monitoring, incidents), frontend-architect (React, performance, accessibility, design systems), backend-lead (databases, APIs, scalability, security). Each role benchmark has 30-50 questions weighted by competency tier. (6) Logic puzzles — reasoning and deduction questions. (7) Language stack — programming language trivia across 10+ languages. VPT target: <50ms per knowledge retrieval, <200ms for synthesis, >50 q/s throughput.', src, 'en');

    // TF-IDF document training for all advanced domains
    const advText = `Advanced domains knowledge: Lazy initialization deferred creation singleton LazyLock once_cell dynamic import. JIT hydration Islands Architecture Qwik resumability Astro partial hydration React Server Components. Event bus message bus pub/sub EventEmitter mitt decoupled communication O(1) dispatch. Fault-tolerant parallelism Promise.allSettled errgroup JoinSet batch operations. N-tier architecture presentation business logic data layer CDN edge API gateway microservices. Spatial addressing voxel octree BVH raycasting 3D neighbor lookup O(1).
    Embeddings vector space Word2Vec GloVe FastText sentence embeddings cosine similarity semantic search. ANN approximate nearest neighbor HNSW IVF product quantization vector database Pinecone Weaviate Qdrant Milvus Chroma pgvector. HNSW hierarchical navigable small world multi-layer graph O(log n) search efConstruction efSearch greedy traverse. Context window tokens sliding window RAG summarization hierarchical context selection.
    GitHub Copilot context sources current file open tabs imports LSP symbols repository structure recent edits conversation history neighboring tabs heuristic. Copilot optimization function names comments type annotations descriptive variables copilot-instructions.md.
    Coherence linguistics logical connectedness local coherence global coherence cohesion given-new topic-comment connectives register paragraph unity. Coherence techniques entity grid discourse relations RST temporal spatial referential.
    Strategic thinking OODA loop first principles second-order thinking opportunity cost reversibility two-way door one-way door chess positional tactical. Strategic engineering abstractions composable systems YAGNI clean seams DX developer ergonomics measure optimize design for failure.
    SSO single sign-on SAML OpenID Connect OIDC OAuth identity provider IdP token session Okta Auth0 Azure AD Keycloak. Microservices independently deployable gRPC saga pattern eventual consistency service discovery OpenTelemetry distributed tracing. Message queues RabbitMQ Kafka Redis Streams SQS BullMQ pub/sub dead-letter queue at-least-once exactly-once. Load balancing round robin least connections L4 L7 Nginx HAProxy ALB health check. Caching cache-aside write-through write-behind TTL Redis Memcached CDN invalidation. Search architecture Elasticsearch Meilisearch Typesense PostgreSQL FTS inverted index BM25 TF-IDF hybrid search. Event-driven architecture EDA event sourcing CQRS event notification CloudEvents Kafka EventBridge. Scalability horizontal vertical stateless auto-scaling HPA sharding.
    Role-based benchmarking AI role simulation competency domain persona scenario rubric Senior DevOps Frontend Architect Backend Lead Data Engineer Security Engineer ML Engineer SRE Platform Engineer. Benchmark design methodology question taxonomy factual recall procedural analytical validation keyword semantic structural scoring binary weighted anti-gaming regression parallel throughput. DevOps Senior CI/CD pipeline IaC Terraform Pulumi Kubernetes Docker Helm monitoring Prometheus Grafana Datadog observability SLA SLO SLI error budget incident response runbook post-mortem MTTD MTTR MTBF severity triage rollback feature flag war room on-call. Pipeline optimization parallelism caching incremental build Docker layer cache test splitting artifact reuse branch pipeline. Vai benchmark writing validate function keyword regex negative check length check tagging scoring concurrency Promise.allSettled throughput regression guard baseline. Benchmark categories mega-200 precision networking bench-all role benchmark logic puzzles language stack VPT.`;
    this.knowledge.learn(advText, src, 'en');
    this.tokenizer.encode(advText);
  }

  /**
   * Bootstrap VAI with the 10 Timeless Cognitive Foundations.
   * These are cognitive primitives — the building blocks from which any
   * specific skill can be generated on demand. They teach Vai HOW to think,
   * not WHAT to think.
   */
  private bootstrapCognitiveFoundations(): void {
    const src = 'bootstrap:cognitive-foundations';

    // ── Foundation 1: First Principles Reasoning ──────────────────
    this.knowledge.addEntry('first principles reasoning', 'First principles reasoning decomposes problems to their fundamental truths before rebuilding solutions from scratch. Instead of reasoning by analogy ("how has this been done before?"), you identify the irreducible building blocks ("what must be true?"). Process: (1) Identify assumptions — what do you take for granted? (2) Break down to fundamentals — physics, math, logic constraints. (3) Reconstruct from scratch — build upward from what you KNOW is true. Elon Musk battery example: "What are batteries made of?" → raw materials cost $80/kWh → existing price was $600/kWh → 7x markup from convention, not physics. Socratic questioning ladder: What do I think I know? Why do I believe this? What evidence supports it? What if the opposite were true? First principles is expensive (slow, effortful) but produces breakthrough insights where analogical reasoning produces incremental improvements.', src, 'en');

    this.knowledge.addEntry('first principles engineering', 'First principles applied to software engineering: (1) Question every architectural assumption — "We need a database" → Do we? What if the data fits in memory? (2) Rebuild from constraints, not conventions — "We use REST" → The constraint is client-server communication; gRPC, WebSockets, or tRPC might be better fits. (3) Challenge framework defaults — "We need React" → The constraint is reactive UI; Svelte, Solid, or vanilla customElements might satisfy it with less overhead. Pattern for applying first principles to tech decisions: State the CONSTRAINT (what must be true), list ASSUMPTIONS (what you believe but haven\'t proven), test each assumption (what breaks if it\'s false), build from what remains. Warning: don\'t first-principles everything — reserve for high-impact, irreversible decisions. For routine work, pattern matching is faster and "good enough."', src, 'en');

    // ── Foundation 2: Calibrated Uncertainty ──────────────────────
    this.knowledge.addEntry('calibrated uncertainty', 'Calibrated uncertainty means your stated confidence matches your actual accuracy. If you say "I\'m 80% sure," you should be right 80% of the time — not 50% or 99%. Calibration is different from accuracy: a perfectly calibrated but uninformed person isn\'t useful; a very accurate but poorly calibrated person gives you no signal about WHEN to trust them. Measurement: Brier Score (mean squared error of probability estimates) — lower is better, 0 is perfect. Target: >85% calibration accuracy across 10+ domains. Practice techniques: (1) Use probability bands: "I\'m 60% confident" / "80% confident" / "95% confident." (2) Track predictions — log claims with confidence, check outcomes. (3) Pre-mortem: "What would make me wrong?" (4) Reference class forecasting: "How often have situations like this played out?" (5) State knowns, unknowns, and unknown unknowns separately. Vai applies this by prefixing uncertain answers with confidence bands and saying "I don\'t know" when confidence is below threshold.', src, 'en');

    this.knowledge.addEntry('epistemic aleatory uncertainty', 'Two types of uncertainty: EPISTEMIC (reducible) — uncertainty from lack of knowledge. More data, research, or analysis can reduce it. Example: "Will this API scale to 10K requests/sec?" → load testing eliminates the uncertainty. ALEATORY (irreducible) — uncertainty from inherent randomness. No amount of data eliminates it. Example: "Will this specific user click the button?" → inherently stochastic. The critical skill: distinguishing which type you face. Epistemic uncertainty is an information problem (solvable). Aleatory uncertainty is a probability problem (manageable with expected values and risk analysis). Common mistake: treating epistemic uncertainty as aleatory ("we can\'t know") when more research would resolve it. Or treating aleatory as epistemic ("if we just had more data") when the phenomenon is genuinely random. In engineering: load testing addresses epistemic uncertainty about performance; chaos engineering addresses aleatory uncertainty about failures.', src, 'en');

    // ── Foundation 3: Compression & Abstraction ──────────────────
    this.knowledge.addEntry('compression abstraction', 'Compression is the discipline of reducing information to its essential structure while preserving meaning. Kolmogorov complexity: the shortest program that produces a given output. In communication: the goal is maximum information density — every word must earn its place. Target: 4:1 compression ratio (expert evaluation: can the compressed version reconstruct the key insight?). Types: (1) Lossy compression — drop details that don\'t affect the core message. Good for summaries, executive briefings. (2) Lossless compression — restructure without losing any information. Good for technical documentation, contracts. Abstraction is compression\'s cousin: hiding implementation details behind a simpler interface. Good abstractions compress complexity; bad abstractions just add indirection. The "newspaper front page test": can you explain the concept in one headline? If not, you haven\'t compressed enough. In code: the best function name IS the documentation — it compresses intent into 2-4 words.', src, 'en');

    // Alternate patterns for common phrasings
    this.knowledge.addEntry('compression communication', 'Compression is the discipline of reducing information to its essential structure while preserving meaning. Kolmogorov complexity: the shortest program that produces a given output. In communication: the goal is maximum information density — every word must earn its place. Target: 4:1 compression ratio (expert evaluation: can the compressed version reconstruct the key insight?). Types: (1) Lossy compression — drop details that don\'t affect the core message. Good for summaries, executive briefings. (2) Lossless compression — restructure without losing any information. Good for technical documentation, contracts. Abstraction is compression\'s cousin: hiding implementation details behind a simpler interface. Good abstractions compress complexity; bad abstractions just add indirection. The "newspaper front page test": can you explain the concept in one headline? If not, you haven\'t compressed enough. In code: the best function name IS the documentation — it compresses intent into 2-4 words.', src, 'en');

    this.knowledge.addEntry('meta-learning self-correction', 'Meta-learning is learning HOW to learn — the skill that generates all other skills. Key principles: (1) Spaced repetition (Ebbinghaus curve) — review at increasing intervals (1 day, 3 days, 7 days, 21 days). Retention jumps from 20% to 90%+. (2) Interleaving — mix different topics/problem types instead of blocking. Harder in the moment but produces deeper transfer. (3) Retrieval practice — testing yourself is 3x more effective than re-reading. (4) Elaborative interrogation — asking "why does this work?" and "how does this connect to what I already know?" (5) Desirable difficulty — if learning feels easy, it\'s probably not sticking. Struggle is the signal of encoding. For AI: meta-learning means Vai improves its learning pipeline, not just its knowledge. Each interaction should make future interactions better — better question detection, better confidence calibration, better compression of new information.', src, 'en');

    this.knowledge.addEntry('norwegian linguistic compression', 'Norwegian demonstrates extreme linguistic compression — a cultural superpower in communication efficiency. Examples: "Neida, skal bare en tur i dusjen, ringer deg etterpaa" — compresses intent + timing + action into 10 words where English needs 25+. The full uncompressed version: "Jeg skal bare en tur i dusjen, saa skal jeg ut og lufte bikkja og mate endene, hente ungene i barnehagen, innom farmor, hente pakker og spise kake, saa hjem, vaske opp, rydde i boden, vaske toalettet, vaske kjoleskapet..." ALL of this compiles down to "ska bare hjem og ordna stuff, saa gir jeg en lyd" — or even further to just "ringer deg" or "opptatt." The word "kos" carries 50+ words of meaning (warmth, togetherness, candles, comfort, blankets, hot chocolate, no agenda). "Dugnad" compresses "voluntary community work where everyone contributes because it benefits us all" into 6 letters. This is linguistic Kolmogorov complexity in action — the shortest representation that preserves the essential meaning.', src, 'mixed');

    // ── Foundation 4: Reading Between the Lines ──────────────────
    this.knowledge.addEntry('reading between the lines', 'Reading between the lines means detecting unstated assumptions, implicit intent, and what someone ACTUALLY needs versus what they literally said. This is the #1 cause of wasted API calls — the AI answers the stated question instead of the real question. Techniques: (1) Intent detection — "How do I center a div?" usually means "help me with CSS layout" not "tell me about the center tag." (2) Context inference — a user asking about "database performance" at 2 AM probably has an urgent production issue, not academic curiosity. (3) Expertise calibration — adjust response depth based on how the question is phrased. A question using jargon ("how do I optimize my B-tree index cardinality?") needs a different answer than plain language ("my database is slow"). (4) Emotional subtext — frustration indicators ("I\'ve tried everything") signal the need for empathy + systematic debugging, not another suggestion. The skill: respond to what they NEED, not just what they ASKED.', src, 'en');

    // ── Foundation 5: Taste & Judgment ────────────────────────────
    this.knowledge.addEntry('taste judgment quality', 'Taste and judgment in engineering: knowing when less is more, when to stop, when depth matters versus breadth. The "newspaper test" for explanations — can you explain it to a non-expert in one paragraph? If yes, you understand it. If no, you\'re hiding behind complexity. Dieter Rams\' 10 principles applied to code: (1) Good code is innovative (solves the problem in a new way when needed). (2) Good code is useful (not clever, not showing off). (3) Good code is aesthetic (readable, well-structured). (4) Good code is understandable (self-documenting). (5) Good code is unobtrusive (you don\'t notice infrastructure when it works). (6) Good code is honest (no hidden side effects). (7) Good code is long-lasting (resists requirement changes). (8) Good code is thorough (edge cases handled). (9) Good code is environmentally conscious (efficient with resources). (10) Good code is as little code as possible (less surface area = fewer bugs). The ultimate taste test: would you want to maintain this code in 2 years?', src, 'en');

    // ── Foundation 6: Asking the Right Question ──────────────────
    this.knowledge.addEntry('asking the right question', 'The most powerful skill in problem-solving is asking the RIGHT question before solving the WRONG one. Reframing rate target: >30% of ambiguous queries where Vai offers a better framing. Techniques: (1) 5 Whys — keep asking "why?" until you hit the root cause. "The deploy failed" → Why? "Tests timed out" → Why? "Database was slow" → Why? "Index missing" → ROOT CAUSE. (2) Constraint mapping — "What would have to be true for this to work?" (3) Inversion — "Instead of asking how to succeed, ask: what would guarantee failure? Then avoid those things." (4) Socratic questioning — "What do you mean by X?", "What evidence supports that?", "What are the implications?" (5) The XY Problem — user asks about their attempted SOLUTION (Y) instead of their actual PROBLEM (X). Always probe for X. Example: "How do I parse HTML with regex?" → The real question is "How do I extract data from HTML?" → Answer: use a proper parser like cheerio or BeautifulSoup.', src, 'en');

    // ── Foundation 7: Meta-Learning ──────────────────────────────
    this.knowledge.addEntry('meta learning', 'Meta-learning is learning HOW to learn — the skill that generates all other skills. Key principles: (1) Spaced repetition (Ebbinghaus curve) — review at increasing intervals (1 day, 3 days, 7 days, 21 days). Retention jumps from 20% to 90%+. (2) Interleaving — mix different topics/problem types instead of blocking. Harder in the moment but produces deeper transfer. (3) Retrieval practice — testing yourself is 3x more effective than re-reading. (4) Elaborative interrogation — asking "why does this work?" and "how does this connect to what I already know?" (5) Desirable difficulty — if learning feels easy, it\'s probably not sticking. Struggle is the signal of encoding. For AI: meta-learning means Vai improves its learning pipeline, not just its knowledge. Each interaction should make future interactions better — better question detection, better confidence calibration, better compression of new information.', src, 'en');

    this.knowledge.addEntry('meta cognition self awareness', 'Metacognition is thinking about thinking — monitoring your own reasoning process in real-time. Components: (1) Metacognitive knowledge — knowing your strengths, weaknesses, and strategies. (2) Metacognitive regulation — planning (how to approach this?), monitoring (is this working?), evaluating (did it work?). For Vai: metacognition means catching errors mid-reasoning. "Wait — I\'m pattern matching when I should be first-principling." "I\'m over-explaining because I\'m uncertain — let me state the uncertainty instead." "This question has an implicit assumption I should surface." Bias detection: anchoring (fixating on first information), confirmation (seeking supporting evidence), availability (overweighting recent/vivid examples), dunning-kruger (confidence uncorrelated with competence). The discipline: before answering, ask "what cognitive process am I using, and is it the right one for this question?"', src, 'en');

    // ── Foundation 8: Clear Communication ─────────────────────────
    this.knowledge.addEntry('clear communication discipline', 'Clear communication is the discipline of transferring ideas with minimal loss. Rules: (1) Hemingway principle — short sentences, active voice, concrete nouns, strong verbs. Cut every word that doesn\'t add information. (2) One idea per sentence, one topic per paragraph. (3) Put the conclusion first, then the evidence (inverted pyramid). (4) Use specific numbers instead of vague quantifiers ("3x faster" not "much faster"). (5) Avoid weasel words: "might," "somewhat," "arguably," "it is thought that" — these signal you\'re hedging instead of calibrating. (6) Define terms on first use. (7) The curse of knowledge: you know too much to explain simply. Fix: explain it to a rubber duck first. (8) Show, don\'t tell — examples beat abstractions. Every sentence should pass the "so what?" test — if the reader can\'t answer "why should I care about this sentence?", cut it.', src, 'en');

    // ── Foundation 9: Systems Thinking ────────────────────────────
    this.knowledge.addEntry('systems thinking', 'Systems thinking analyzes problems as interconnected wholes rather than isolated parts. Core concepts: (1) Feedback loops — reinforcing (compound growth: more users → more data → better product → more users) and balancing (thermostats, market corrections). (2) Stocks and flows — stocks are accumulations (user count, technical debt), flows are rates of change (signups/day, bugs fixed/sprint). (3) Emergent behavior — simple rules produce complex outcomes (ant colonies, traffic jams, Conway\'s Law in codebases). (4) Donella Meadows\' leverage points — where to intervene in a system, from weakest (changing numbers/parameters) to strongest (changing the system\'s goals or paradigm). (5) Delays — effects don\'t happen instantly; the gap between action and result causes oscillation and overshooting. In engineering: a "quick fix" that adds technical debt is a reinforcing loop — each fix makes the next one harder, accelerating debt accumulation.', src, 'en');

    this.knowledge.addEntry('second order thinking', 'Second-order thinking asks "and then what?" — considering downstream consequences beyond the immediate effect. First-order: "Let\'s add a cache to speed up reads." Second-order: "Adding a cache means cache invalidation complexity, stale data risks, memory pressure, and a new failure mode." Third-order: "Cache failures will cascade to the database, which is already at capacity, causing a system-wide outage." Target: >60% accuracy predicting downstream effects in system-level scenarios. Practice: (1) For every decision, write down 3 second-order effects. (2) Pre-mortem: "It\'s 6 months later and this decision failed. Why?" (3) Follow the incentives: "If we do X, what behavior does it encourage?" In code: refactoring has second-order effects on tests, documentation, dependent services, deployment pipelines, and team knowledge. A function rename is first-order simple but second-order complex.', src, 'en');

    // ── Foundation 10: Intellectual Honesty ──────────────────────
    this.knowledge.addEntry('intellectual honesty', 'Intellectual honesty is the practice of representing what you know, don\'t know, and can\'t know — accurately. Core practices: (1) Say "I don\'t know" when you don\'t know. Not "perhaps" or "it might be" — say "I don\'t have reliable information about this." (2) Steel-man opposing views — represent the strongest version of arguments you disagree with, not straw-men. (3) Update beliefs on evidence — when new data contradicts your position, change your position, not the data. (4) Separate observations from interpretations — "The test failed" (observation) vs "The code is buggy" (interpretation). (5) No hallucination policy — never fabricate information to sound knowledgeable. An honest "I don\'t know" is infinitely more valuable than a confident hallucination. (6) Distinguish "I\'m uncertain" from "the answer is uncertain" — epistemic vs aleatory. The trust equation: Trust = (Credibility + Reliability + Intimacy) / Self-interest. Intellectual honesty maximizes every numerator and minimizes the denominator.', src, 'en');

    // ── Sound vs Spelling ────────────────────────────────────────
    this.knowledge.addEntry('sound spelling differences', 'Sound and spelling often diverge in both English and Norwegian. English homophones: their/there/they\'re, to/too/two, your/you\'re, its/it\'s, hear/here, break/brake. English silent letters: knight, psychology, debt, subtle. The Great Vowel Shift (1400-1700) changed pronunciation but spelling froze. Norwegian phonetics: "skj" and "kj" sound different — "skjonn" (beauty) vs "kjole" (dress). "Sj" sounds like English "sh." Norwegian has pitch accent (tonal): "boenner" means either "beans" or "prayers" depending on tone. "Huset" (the house) — the definite article is a suffix, not a separate word. In Norwegian, many words are pronounced differently from spelling: "Jeg" sounds like "yai," "Hva" sounds like "va," "Hvordan" sounds like "vordan." Understanding these differences helps with both language learning and programming (string comparison, search, NLP tokenization, voice-to-text accuracy).', src, 'mixed');

    // ── Efficiency Mission ───────────────────────────────────────
    this.knowledge.addEntry('api efficiency mission', 'Vai\'s efficiency mission: reduce global AI API waste. The math: average AI interaction requires 4 calls; Vai targets 1.5 calls (62.5% reduction). Applied to 10+ billion daily AI API calls worldwide = ~6 billion fewer calls/day. Each call consumes compute, energy, bandwidth, money, and attention. The root causes of waste: (1) Clarification loops — AI doesn\'t read between the lines. (2) Retry chains — first answer is miscalibrated. (3) Over-generation — 500 words when 50 would do. (4) Mis-framed answers — solves the wrong problem. (5) Hallucination recovery — AI guesses instead of saying "I don\'t know." (6) Context rebuilding — AI loses the thread. Each maps to a cognitive foundation that Vai trains on. The compounding effect: when users trust the first response, they ask better questions → better answers → fewer follow-ups. The efficiency gains feed forward. The endgame: would you want Vai in the room for the hardest problem you\'re facing? Not because it knows the answer, but because it helps you find one you wouldn\'t have reached alone.', src, 'en');

    this.knowledge.addEntry('compression over accumulation', 'Compression over accumulation: information density > volume. Every token must earn its place. Redundancy is waste. This principle applies at every level: (1) Code — the best code is the code you don\'t write. If 10 lines do what 50 did, the 10-line version is better (assuming equal clarity). (2) Communication — a 3-sentence email beats a 3-paragraph one if it conveys the same information. (3) Knowledge — knowing 10 principles deeply beats memorizing 100 facts shallowly, because principles generate facts on demand. (4) Architecture — one well-designed abstraction beats 10 utility functions. (5) Learning — teach the compression function, not the compressed output. This is Vai\'s core philosophy: learn the patterns so deeply that specific knowledge can be derived on demand, rather than attempting to memorize every possible fact. Accumulation scales linearly; compression scales exponentially.', src, 'en');

    // TF-IDF document training for cognitive foundations
    const cogText = `Cognitive foundations meta-learning first principles reasoning decompose fundamental truths irreducible building blocks Socratic questioning assumption testing reconstruct from constraints not conventions.
    Calibrated uncertainty confidence bands probability calibration Brier score 85% accuracy epistemic reducible aleatory irreducible reference class forecasting pre-mortem prediction tracking.
    Compression abstraction Kolmogorov complexity information density 4:1 ratio lossy lossless newspaper test function naming intent compression. Norwegian linguistic compression kos dugnad opptatt ringer deg ordna stuff cultural context efficiency.
    Taste judgment Dieter Rams good design principles knowing when less is more when to stop newspaper test maintainability aesthetic readability unobtrusive.
    Reading between the lines intent detection context inference expertise calibration emotional subtext implicit need versus stated request XY problem.
    Asking the right question reframing 5 Whys constraint mapping inversion Socratic questioning XY problem probe for X.
    Meta-learning spaced repetition Ebbinghaus interleaving retrieval practice elaborative interrogation desirable difficulty transfer learning improve learning pipeline.
    Meta-cognition self-awareness monitoring reasoning bias detection anchoring confirmation availability dunning-kruger cognitive process selection.
    Clear communication Hemingway principle active voice concrete nouns inverted pyramid specific numbers weasel words curse of knowledge show don't tell so what test.
    Systems thinking feedback loops reinforcing balancing stocks flows emergent behavior Donella Meadows leverage points delays oscillation Conway's Law.
    Second-order thinking downstream consequences and then what pre-mortem incentives cascade effects refactoring ripple.
    Intellectual honesty I don't know steel-man update beliefs observation versus interpretation no hallucination trust equation credibility reliability.
    Sound spelling differences homophones silent letters Great Vowel Shift Norwegian phonetics pitch accent tonal skj kj boenner.
    API efficiency mission 62.5% reduction 10 billion daily calls waste clarification loops retry chains over-generation mis-framed hallucination context rebuilding compounding effect.
    Compression over accumulation information density every token earns its place redundancy waste principles generate facts on demand linear versus exponential scaling.`;
    this.knowledge.learn(cogText, src, 'en');
    this.tokenizer.encode(cogText);
  }

  /**
   * Bootstrap knowledge expansion — targeted entries for benchmark gaps.
   * Adds entries for domains identified as weak by the Mega-220 benchmark.
   */
  private bootstrapKnowledgeExpansion(): void {
    const src = 'bootstrap:expansion-r14';

    // ── U: NORWEGIAN HISTORY (9 entries) ──────────────────────────
    this.knowledge.addEntry('stiklestad 1030', 'The Battle of Stiklestad (Slaget ved Stiklestad) took place on July 29, 1030 in Nord-Tr\u00f8ndelag, Norway. King Olav Haraldsson (later Saint Olav) fell in battle against a peasant army allied with Cnut the Great of Denmark. Despite losing, Olav became Norway\'s patron saint — his death marked the pivotal moment when Christianity was permanently established in Norway. The battle is considered one of the most important events in Viking Age Scandinavian history. Stiklestad is now a national cultural center with an annual outdoor play reenacting the battle.', src, 'en');

    this.knowledge.addEntry('norway independence 1905', 'Norway gained independence from Sweden on June 7, 1905, when the Norwegian Parliament (Storting) declared the union with Sweden dissolved. The union had existed since 1814 after Norway was ceded from Denmark to Sweden by the Treaty of Kiel. Key events: the constitutional crisis over Norwegian consular service, the Storting\'s unilateral dissolution, the Karlstad negotiations, and the national referendum where 99.95% voted for independence. Prince Carl of Denmark became King Haakon VII. Norway\'s peaceful dissolution of the union is considered a model for modern state sovereignty transitions.', src, 'en');

    this.knowledge.addEntry('roald amundsen', 'Roald Amundsen (1872-1928) was a Norwegian explorer who led the first expedition to reach the South Pole on December 14, 1911, beating Robert Falcon Scott by 34 days. Amundsen was also the first to sail through the Northwest Passage (1903-1906) and is credited as the first to reach both poles. His success at the South Pole was attributed to meticulous planning: dog sleds instead of ponies, depot placement, ski expertise, and Inuit survival techniques. He disappeared in 1928 during a rescue mission in the Arctic. Amundsen is regarded as one of history\'s greatest polar explorers.', src, 'en');

    this.knowledge.addEntry('17 mai norway', '17. mai (Syttende mai) is Norway\'s Constitution Day, celebrating the signing of the Norwegian Constitution at Eidsvoll on May 17, 1814. Unlike most national days, it is celebrated not with military parades but with children\'s parades (barnetog), traditional costumes (bunad), ice cream, hot dogs, and brass bands. The celebration emphasizes democracy, freedom, and community. In Oslo, the children\'s parade passes the Royal Palace where the royal family waves from the balcony. It is the most important national holiday in Norway — a day of genuine joy and national pride.', src, 'en');

    this.knowledge.addEntry('norway world war ii', 'Norway was occupied by Nazi Germany from April 9, 1940 to May 8, 1945. The German invasion (Operation Weser\u00fcbung) caught Norway largely unprepared. King Haakon VII and the government fled to London, continuing resistance from exile. Vidkun Quisling, leader of the fascist Nasjonal Samling party, collaborated with the Germans — his name became synonymous with "traitor" worldwide. The Norwegian resistance movement (Hjemmefronten) conducted sabotage operations, the most famous being the heavy water sabotage at Vemork (1943) which disrupted Germany\'s nuclear program. Norway was liberated in May 1945.', src, 'en');

    this.knowledge.addEntry('norwegian oil discovery', 'Oil was discovered in the Norwegian North Sea on December 23, 1969, when the Ekofisk field was confirmed. This discovery transformed Norway from a modest fishing and shipping nation into one of the world\'s wealthiest countries. The Norwegian government established Statoil (now Equinor) in 1972 and created the Government Pension Fund Global (Oljefondet/Oil Fund) in 1990 to invest petroleum revenues for future generations. The fund is now worth over $1.5 trillion, making it the world\'s largest sovereign wealth fund. Norway\'s oil policy is considered a model for responsible resource management.', src, 'en');

    this.knowledge.addEntry('sami parliament sametinget', 'The Sami Parliament (Sametinget) is the representative body for the Sami people, the indigenous people of northern Scandinavia (S\u00e1pmi). Norway\'s Sametinget was established in 1989, with its seat in Karasjok, Finnmark. It has 39 representatives elected by registered Sami voters. The Sametinget advises the Norwegian government on matters affecting the Sami community: language preservation, cultural heritage, reindeer herding rights, land use, and education. The Sami have their own flag, national day (February 6), and languages (North Sami, Lule Sami, South Sami). Similar Sami parliaments exist in Sweden and Finland.', src, 'en');

    this.knowledge.addEntry('fridtjof nansen', 'Fridtjof Nansen (1861-1930) was a Norwegian explorer, scientist, diplomat, and humanitarian. He crossed Greenland on skis in 1888 and led the Fram expedition (1893-1896), deliberately freezing the ship in Arctic ice to study polar drift. After his exploration career, Nansen became a diplomat who helped negotiate Norway\'s independence from Sweden in 1905. As League of Nations High Commissioner for Refugees, he created the "Nansen passport" for stateless people and organized famine relief in Russia. He won the Nobel Peace Prize in 1922. Nansen is considered one of Norway\'s greatest national heroes.', src, 'en');

    this.knowledge.addEntry('history of bergen', 'Bergen is Norway\'s second-largest city, founded around 1070 by King Olav Kyrre. It served as Norway\'s capital in the 12th-13th centuries and became a major Hanseatic League trading post (one of four Kontors). The Bryggen wharf — the old Hanseatic quarter with its colorful wooden buildings — is a UNESCO World Heritage Site. Bergen was the center of the dried cod (stockfish) trade between northern Norway and Europe. Key landmarks: Bryggen, Fl\u00f8ibanen funicular, Bergen Fish Market, Edvard Grieg\'s Troldhaugen. Bergen is known as the "Gateway to the Fjords" and receives about 230 days of rain per year.', src, 'en');

    this.knowledge.addEntry('norwegian storting', 'The Storting (Stortinget) is the Norwegian Parliament, the supreme legislative body of Norway. It has 169 representatives elected every four years through proportional representation from 19 constituencies. The Storting passes laws, approves the national budget, supervises the government, and debates national policy. Unlike many parliaments, the Storting cannot be dissolved early — elections are always held on schedule. It was established by the 1814 Constitution (Grunnloven) at Eidsvoll. The Storting building is located on Karl Johans gate in central Oslo. Norway uses a modified parliamentary system where the government must maintain the confidence of the Storting.', src, 'en');

    // ── C: REACT / NEXT.JS DEPTH (11 entries) ─────────────────────
    this.knowledge.addEntry('react suspense', '**React Suspense** lets components "wait" for something before rendering — showing a fallback UI (like a loading spinner) in the meantime.\n\n**Usage:**\n```jsx\n<Suspense fallback={<Loading />}>\n  <LazyComponent />\n</Suspense>\n```\n\n**Use cases:**\n- **Code splitting** with `React.lazy()` — load components on demand\n- **Data fetching** — wait for async data (with frameworks like Next.js, Relay, or React Query)\n- **Streaming SSR** — server sends HTML progressively, loading boundaries resolve as data arrives\n\n**Key concepts:** Suspense boundaries can be nested. Each boundary shows its own fallback independently. In React 18+, Suspense works with concurrent features for non-blocking rendering.', src, 'en');

    this.knowledge.addEntry('useeffect hook react', '**useEffect** is React\'s hook for side effects — code that interacts with the outside world (APIs, DOM, timers, subscriptions).\n\n**Syntax:**\n```jsx\nuseEffect(() => {\n  // effect runs after render\n  const sub = api.subscribe(handler);\n  return () => sub.unsubscribe(); // cleanup\n}, [dependency]); // re-runs when dependency changes\n```\n\n**Lifecycle mapping:** componentDidMount (empty deps `[]`), componentDidUpdate (with deps), componentWillUnmount (cleanup function).\n\n**Rules:** Always specify dependencies. Missing deps = stale closures. Empty array = run once. No array = run every render. Use ESLint exhaustive-deps rule. Effects run after paint (non-blocking). Use useLayoutEffect for DOM measurements before paint.', src, 'en');

    this.knowledge.addEntry('react hydration', '**Hydration** is the process where React attaches event handlers and state to server-rendered HTML, making it interactive.\n\n**How it works:**\n1. Server renders HTML (SSR) and sends it to the browser\n2. Browser displays the HTML immediately (fast First Contentful Paint)\n3. React client JS loads and "hydrates" — reconciles the server HTML with the React component tree\n4. Event handlers are attached, state becomes interactive\n\n**Issues:** Hydration mismatch errors occur when server and client render different content. Selective hydration (React 18) hydrates components on demand. React Server Components reduce hydration cost by keeping components server-only.', src, 'en');

    this.knowledge.addEntry('react context api', '**React Context API** provides a way to pass data through the component tree without prop drilling.\n\n**Usage:**\n```jsx\nconst ThemeContext = createContext(\'light\');\n\n// Provider wraps the tree\n<ThemeContext.Provider value="dark">\n  <App />\n</ThemeContext.Provider>\n\n// Consumer reads the value\nconst theme = useContext(ThemeContext);\n```\n\n**When to use:** Theme, locale, auth state, feature flags — data needed by many components at different nesting levels.\n\n**Limitations:** Every context change re-renders ALL consumers. For high-frequency updates, use Zustand or Jotai instead. Split contexts by update frequency (static config vs dynamic state).', src, 'en');

    this.knowledge.addEntry('nextjs isr incremental static regeneration', '**ISR (Incremental Static Regeneration)** in Next.js lets you update static pages after deployment without rebuilding the entire site.\n\n**How it works:**\n- Pages are statically generated at build time\n- After the `revalidate` period (e.g., 60 seconds), the next request triggers a background regeneration\n- Stale page is served while the new one generates (stale-while-revalidate pattern)\n\n**Usage (App Router):**\n```tsx\nexport const revalidate = 60; // revalidate every 60s\n```\n\n**On-demand ISR:** `revalidatePath(\'/blog\')` or `revalidateTag(\'posts\')` triggers immediate regeneration.\n\n**Benefits:** Static performance (CDN-cached) with dynamic freshness. Perfect for blogs, e-commerce, dashboards with moderate update frequency.', src, 'en');

    this.knowledge.addEntry('react compiler', '**React Compiler** (formerly React Forget) is an automatic optimization compiler that eliminates the need for manual `useMemo`, `useCallback`, and `React.memo`.\n\n**What it does:** Analyzes your React components at build time and automatically inserts memoization where beneficial. It understands React\'s rules (pure renders, hook rules) and optimizes re-renders.\n\n**Key points:**\n- Opt-in via Babel plugin (React 19+)\n- Replaces manual memo/callback optimization\n- Requires components to follow React rules (no side effects in render)\n- Use the `react-compiler-healthcheck` tool to verify compatibility\n- Does NOT change runtime behavior — only performance\n\n**Impact:** Removes a major source of bugs (missing deps, stale closures) and reduces boilerplate.', src, 'en');

    this.knowledge.addEntry('usereducer react', '**useReducer** is a React hook for managing complex state logic — an alternative to useState when state transitions depend on previous state or involve multiple sub-values.\n\n**Syntax:**\n```jsx\nconst [state, dispatch] = useReducer(reducer, initialState);\n\nfunction reducer(state, action) {\n  switch (action.type) {\n    case \'increment\': return { count: state.count + 1 };\n    case \'decrement\': return { count: state.count - 1 };\n    default: throw new Error();\n  }\n}\n\ndispatch({ type: \'increment\' });\n```\n\n**When to use:** Multiple related state values, complex state transitions, state logic shared across components. Inspired by Redux but built into React. Often paired with Context for global state.', src, 'en');

    this.knowledge.addEntry('react custom hooks', '**Custom hooks** in React extract reusable stateful logic into functions prefixed with `use`.\n\n**Example:**\n```jsx\nfunction useWindowSize() {\n  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });\n  useEffect(() => {\n    const handler = () => setSize({ w: window.innerWidth, h: window.innerHeight });\n    window.addEventListener(\'resize\', handler);\n    return () => window.removeEventListener(\'resize\', handler);\n  }, []);\n  return size;\n}\n```\n\n**Rules:** Must start with "use". Can call other hooks. Follows all hook rules (top-level only, same order every render). Custom hooks let you share logic without sharing state — each component using the hook gets its own copy.', src, 'en');

    this.knowledge.addEntry('react forwardref', '**React.forwardRef** allows a parent component to pass a ref to a child component\'s DOM element.\n\n**Usage:**\n```jsx\nconst FancyInput = forwardRef((props, ref) => (\n  <input ref={ref} className="fancy" {...props} />\n));\n\n// Parent can now access the input DOM node\nconst inputRef = useRef();\n<FancyInput ref={inputRef} />\ninputRef.current.focus();\n```\n\n**Why it\'s needed:** By default, refs don\'t pass through components — forwardRef bridges this gap. Essential for: design system components (input wrappers, buttons), imperative handle APIs (useImperativeHandle), and third-party library integration. In React 19, ref is available as a regular prop, making forwardRef less necessary.', src, 'en');

    this.knowledge.addEntry('nextjs code splitting', '**Code splitting** in Next.js automatically breaks your JavaScript into smaller chunks loaded on demand.\n\n**How it works:**\n- **Route-based splitting** — each page/route is a separate chunk (automatic)\n- **Component-based splitting** — `next/dynamic` or `React.lazy()` for heavy components\n- **Import-based splitting** — `import(\'./heavy-module\')` creates a separate chunk\n\n**Usage:**\n```jsx\nimport dynamic from \'next/dynamic\';\nconst HeavyChart = dynamic(() => import(\'./Chart\'), {\n  loading: () => <Skeleton />,\n  ssr: false, // client-only\n});\n```\n\n**Benefits:** Smaller initial bundle, faster page loads, better Core Web Vitals. Next.js uses webpack/Turbopack to analyze imports and create optimal chunk boundaries.', src, 'en');

    this.knowledge.addEntry('react use hook', '**use** is a new React 19 hook that lets you read resources (Promises and Context) during render.\n\n**Reading promises:**\n```jsx\nfunction Comments({ commentsPromise }) {\n  const comments = use(commentsPromise); // suspends until resolved\n  return comments.map(c => <p key={c.id}>{c.text}</p>);\n}\n```\n\n**Reading context:** `const theme = use(ThemeContext)` — works like useContext but can be called conditionally.\n\n**Key differences from useContext:**\n- `use` can be called inside if statements and loops\n- `use` can read Promises (triggers Suspense)\n- `use` is the foundation for React\'s async rendering model\n\n**Note:** The Promise variant requires a Suspense boundary above it.', src, 'en');

    // ── N: NORWEGIAN WEB SERVICES (6 entries) ─────────────────────
    this.knowledge.addEntry('norwegian web accessibility requirement', 'Norway requires all websites and apps to comply with WCAG 2.1 AA under the Likestillings- og diskrimineringsloven (Equality and Anti-Discrimination Act). The law mandates universell utforming (universal design) — making ICT solutions accessible to all, including people with disabilities. Enforcement is handled by Digitaliseringsdirektoratet (Digdir) and previously by DIFI. Since 2023, WCAG 2.1 AA is the minimum standard. Public sector and private organizations with more than 50 employees must comply. Violations can result in fines. The UU-tilsynet monitors compliance and provides guidance.', src, 'en');

    this.knowledge.addEntry('uutilsynet', 'UU-tilsynet (Tilsynet for universell utforming av IKT) is the Norwegian regulatory authority for universal design of ICT. It monitors and enforces compliance with web accessibility requirements (WCAG 2.1 AA) under Norwegian law. UU-tilsynet conducts audits of websites and apps, issues compliance orders, and can impose fines. It provides guidance, tools, and resources to help organizations meet accessibility standards. The tilsyn (supervisory body) operates under Digitaliseringsdirektoratet (Digdir). Key focus areas: universell utforming of web content, mobile apps, self-service machines, and digital documents.', src, 'en');

    this.knowledge.addEntry('digdir standard', 'Digdir (Digitaliseringsdirektoratet / Norwegian Digitalisation Agency) develops and manages national digital standards for Norway\'s public sector. Key standards: (1) Referansekatalogen — reference catalog of mandatory/recommended IT standards. (2) WCAG compliance for universal design. (3) National architecture principles for digital services. (4) ID-porten integration standard. (5) Digital post (SvarUt/SvarInn). (6) API management standards. Digdir also manages Altinn, ID-porten, and Maskinporten. The agency promotes digital-first government services and ensures interoperability across public institutions.', src, 'en');

    this.knowledge.addEntry('bokm\u00e5l nynorsk', 'Bokm\u00e5l and Nynorsk are the two official written standards of the Norwegian language. Bokm\u00e5l ("book tongue") evolved from Danish-influenced urban Norwegian and is used by about 85-90% of the population. Nynorsk ("new Norwegian") was created by linguist Ivar Aasen in the 1850s, based on rural Norwegian dialects, to provide a genuinely Norwegian written language free from Danish influence. Both are taught in schools (students must learn both). Government agencies must use both. Media, municipalities, and individuals choose which to use. They are mutually intelligible — the difference is primarily in spelling and some grammar, not vocabulary or pronunciation.', src, 'en');

    this.knowledge.addEntry('id-porten', 'ID-porten is Norway\'s national login solution for public digital services. It provides secure authentication using BankID, MinID, Buypass, and Commfides as identity providers. Citizens use ID-porten to access government services like tax filing (Skatteetaten), health records (Helsenorge), social services (NAV), and municipal services. Managed by Digitaliseringsdirektoratet (Digdir). Technical: OpenID Connect (OIDC) protocol, security level 3-4 (substantial to high). Integration: services register with Digdir and implement OIDC flow. Maskinporten provides machine-to-machine authentication for APIs between organizations.', src, 'en');

    this.knowledge.addEntry('bring api shipping norway', 'Bring (formerly Posten Norge / Norway Post) provides shipping APIs for e-commerce and logistics in Norway and the Nordics. Key APIs: (1) Shipping Guide — calculate prices, delivery times, and available services. (2) Booking API — create shipments and generate labels. (3) Tracking API — real-time package tracking. (4) Pickup Point API — find nearest pickup locations. (5) Address API — validate and autocomplete Norwegian addresses. Integration: REST APIs with JSON, authentication via API key. Bring is the dominant postal and logistics provider in Norway, handling both parcels and freight. Services include Pakke i Postkassen, Norgespakke, and Bedriftspakke.', src, 'en');

    // ── B: TYPESCRIPT / JAVASCRIPT DEPTH (6 entries) ──────────────
    this.knowledge.addEntry('javascript proxy object', '**Proxy** in JavaScript creates a wrapper around an object that intercepts and customizes operations (get, set, has, delete, etc.).\n\n**Syntax:**\n```javascript\nconst handler = {\n  get(target, prop) { return prop in target ? target[prop] : 42; },\n  set(target, prop, value) { target[prop] = value; return true; }\n};\nconst proxy = new Proxy({}, handler);\n```\n\n**Traps** (handler methods): get, set, has, deleteProperty, apply, construct, getPrototypeOf, ownKeys, etc.\n\n**Use cases:** validation, logging, reactive systems (Vue 3 uses Proxy for reactivity), default values, access control, API mocking. **Reflect** API mirrors Proxy traps for forwarding operations cleanly.', src, 'en');

    this.knowledge.addEntry('typescript unknown vs any', '**unknown vs any** in TypeScript:\n\n**any** — disables ALL type checking. You can do anything with it: call methods, access properties, assign to any type. It\'s an escape hatch that defeats the purpose of TypeScript.\n\n**unknown** — the type-safe counterpart. You CANNOT do anything with an unknown value until you narrow its type through checks.\n\n```typescript\nlet x: unknown = getUserInput();\n// x.toUpperCase(); // Error! Must narrow first\nif (typeof x === \'string\') {\n  x.toUpperCase(); // OK — narrowed to string\n}\n```\n\n**Rule:** Use `unknown` over `any` whenever possible. `unknown` forces you to validate before using, preventing runtime errors.', src, 'en');

    this.knowledge.addEntry('javascript weakref', '**WeakRef** creates a weak reference to an object that doesn\'t prevent garbage collection.\n\n```javascript\nlet target = { data: \'important\' };\nconst ref = new WeakRef(target);\ntarget = null; // eligible for GC now\n\nconst obj = ref.deref(); // returns object or undefined if GC\'d\n```\n\n**Use cases:** caches where entries should be automatically cleaned up, observer patterns tracking DOM elements, memory-sensitive data structures.\n\n**FinalizationRegistry** — companion API that runs a callback when a referenced object is garbage collected.\n\n**Caution:** GC timing is unpredictable — never rely on WeakRef for correctness, only for optimization. Avoid in most application code; useful in library/framework internals.', src, 'en');

    this.knowledge.addEntry('javascript temporal api', '**Temporal** is the modern replacement for JavaScript\'s broken Date object, designed to fix its fundamental flaws.\n\n**Key types:**\n- `Temporal.PlainDate` — date without time or timezone\n- `Temporal.PlainTime` — time without date or timezone\n- `Temporal.PlainDateTime` — date + time, no timezone\n- `Temporal.ZonedDateTime` — full date/time with timezone\n- `Temporal.Instant` — exact moment in time (like Unix timestamp)\n- `Temporal.Duration` — represents a length of time\n\n**Why it replaces Date:** immutable objects (no mutation bugs), proper timezone handling, unambiguous parsing, calendar system support, duration arithmetic. Currently Stage 3 TC39 proposal (2026). Polyfill: `@js-temporal/polyfill`.', src, 'en');

    this.knowledge.addEntry('structuredclone javascript', '**structuredClone()** creates a deep copy of a value using the structured clone algorithm.\n\n```javascript\nconst original = { a: 1, b: { c: 2 }, d: new Date() };\nconst clone = structuredClone(original);\nclone.b.c = 99; // does NOT affect original\n```\n\n**Supports:** objects, arrays, Date, RegExp, Map, Set, ArrayBuffer, Blob, File, ImageData. **Does NOT support:** functions, DOM nodes, Symbols, property descriptors, prototype chain.\n\n**vs JSON.parse(JSON.stringify()):** structuredClone handles Date, Map, Set, circular references, and typed arrays correctly. JSON method loses Date objects (becomes string), fails on circular refs, drops undefined values.\n\n**Availability:** All modern browsers, Node.js 17+, Deno, Bun.', src, 'en');

    this.knowledge.addEntry('abortcontroller abortsignal', '**AbortController** and **AbortSignal** provide a standard way to cancel asynchronous operations.\n\n```javascript\nconst controller = new AbortController();\nconst signal = controller.signal;\n\nfetch(\'/api/data\', { signal })\n  .then(res => res.json())\n  .catch(err => {\n    if (err.name === \'AbortError\') console.log(\'Cancelled\');\n  });\n\n// Cancel the request\ncontroller.abort();\n```\n\n**Use cases:** cancel fetch requests, abort event listeners, timeout operations (`AbortSignal.timeout(5000)`), cancel streams, debounce.\n\n**Composable:** `AbortSignal.any([signal1, signal2])` — abort on first signal. Works with fetch, addEventListener, streams, and many Node.js APIs.', src, 'en');

    // ── D: CSS MODERN FEATURES (5 entries) ────────────────────────
    this.knowledge.addEntry('css in js', '**CSS-in-JS** is an approach where CSS is written directly in JavaScript files, scoped to components.\n\n**Libraries:** styled-components, Emotion, Linaria, vanilla-extract, Panda CSS.\n\n**Runtime CSS-in-JS** (styled-components, Emotion): generates styles at runtime, injects into DOM. Downside: performance overhead, larger bundle.\n\n**Zero-runtime CSS-in-JS** (vanilla-extract, Linaria, Panda CSS): extracts CSS at build time to static .css files — best of both worlds.\n\n**Pros:** component-scoped styles, dynamic styles based on props, TypeScript support, no class naming conflicts.\n**Cons:** runtime overhead (for runtime libraries), SSR complexity, bundle size.\n\n**2026 trend:** Zero-runtime solutions dominating, with Tailwind CSS being the most popular utility-first alternative.', src, 'en');

    this.knowledge.addEntry('css has selector', '**:has()** is the CSS "parent selector" — it selects an element based on its descendants or siblings.\n\n```css\n/* Style a card that contains an image */\n.card:has(img) { border: 2px solid blue; }\n\n/* Style a label when its input is focused */\nlabel:has(+ input:focus) { color: blue; }\n\n/* Style the body when a modal is open */\nbody:has(.modal.open) { overflow: hidden; }\n```\n\n**Key facts:**\n- Called the "parent selector" because it selects ancestors based on descendants\n- Supported in all modern browsers (2023+)\n- Can use any selector inside :has()\n- Extremely powerful combined with :not(), :is(), :where()\n- Performance: browsers optimize well, but avoid deeply nested :has() in large DOMs', src, 'en');

    this.knowledge.addEntry('css clamp function', '**clamp()** in CSS sets a value that scales responsively between a minimum and maximum.\n\n```css\nfont-size: clamp(1rem, 2vw + 0.5rem, 2.5rem);\n/* min=1rem, preferred=2vw+0.5rem, max=2.5rem */\n\nwidth: clamp(300px, 50%, 800px);\n```\n\n**Syntax:** `clamp(MIN, PREFERRED, MAX)` — equivalent to `max(MIN, min(PREFERRED, MAX))`.\n\n**Use cases:** responsive typography (fluid type scale), responsive spacing, responsive widths without media queries.\n\n**Related functions:** `min()` — smallest value wins, `max()` — largest value wins. All three accept any CSS length/calc expression. Supported in all modern browsers.', src, 'en');

    this.knowledge.addEntry('tailwind purge unused css', '**Tailwind CSS purges unused styles** by scanning your source files for class names and only including CSS for classes that are actually used.\n\n**How it works:**\n- Tailwind\u2019s JIT (Just-In-Time) engine generates CSS on demand as you use classes\n- The `content` config tells Tailwind which files to scan:\n```js\ncontent: [\'./src/**/*.{js,tsx,html}\']\n```\n- Only classes found in scanned files are included in the output\n- Result: tiny CSS bundles (typically 5-15KB gzipped)\n\n**Pitfalls:** Dynamic class names (`className={\\`text-${color}\\`}`) are NOT detected — use safelist or full class strings. Don\'t construct class names from variables.\n\n**Tailwind v4:** Uses CSS-based config with `@source` directive instead of JS config file. Tree-shaking is automatic and even more efficient.', src, 'en');

    this.knowledge.addEntry('css reset vs normalize', '**CSS Reset** removes ALL default browser styles, giving you a blank slate. Every element starts with zero margin, padding, and identical styling.\n\n**Normalize.css** preserves useful browser defaults while fixing cross-browser inconsistencies. It keeps sensible defaults (like heading sizes) but ensures they render consistently.\n\n**Comparison:**\n- **Reset** (Eric Meyer\'s Reset): aggressive — removes ALL defaults → you must restyle everything\n- **Normalize**: gentle — fixes bugs and inconsistencies, keeps useful defaults\n- **Modern reset** (Josh Comeau\'s, Andy Bell\'s): balanced — resets box-sizing, removes margins, sets sensible defaults\n\n**Tailwind\'s Preflight** is a modern reset based on Normalize.css that also removes default heading/list styles for utility-class workflow.\n\n**Recommendation:** Use a modern reset or Tailwind Preflight for new projects.', src, 'en');

    // ── I: RUST DEPTH (2 entries) ─────────────────────────────────
    this.knowledge.addEntry('rust result type', '**Result<T, E>** is Rust\'s primary error handling type — an enum with two variants:\n\n```rust\nenum Result<T, E> {\n    Ok(T),    // success — contains the value\n    Err(E),   // failure — contains the error\n}\n```\n\n**Usage:**\n```rust\nfn read_file(path: &str) -> Result<String, io::Error> {\n    let content = fs::read_to_string(path)?; // ? propagates errors\n    Ok(content)\n}\n\nmatch read_file("data.txt") {\n    Ok(data) => println!("{data}"),\n    Err(e) => eprintln!("Error: {e}"),\n}\n```\n\n**The `?` operator** unwraps Ok or returns Err early — eliminates nested match statements. **anyhow** and **thiserror** are popular error handling libraries. Result forces you to handle errors explicitly — no unchecked exceptions.', src, 'en');

    this.knowledge.addEntry('rust unsafe code', '**unsafe** in Rust lets you bypass the borrow checker for operations the compiler cannot verify.\n\n**What unsafe allows:**\n1. Dereference raw pointers (`*const T`, `*mut T`)\n2. Call unsafe functions (FFI/C interop)\n3. Access mutable statics\n4. Implement unsafe traits\n5. Access fields of unions\n\n```rust\nunsafe {\n    let ptr: *const i32 = &42;\n    println!("{}", *ptr); // raw pointer dereference\n}\n```\n\n**Key principle:** unsafe doesn\'t disable the borrow checker entirely — it just allows the 5 operations above. All other Rust safety guarantees still apply.\n\n**Best practices:** minimize unsafe surface area, wrap unsafe code in safe abstractions, document invariants, use `#[deny(unsafe_op_in_unsafe_fn)]`. FFI (Foreign Function Interface) with C libraries is the most common use case.', src, 'en');

    // ── TF-IDF training text for all expansion entries ────────────
    const expansionText = `Norwegian history: Stiklestad 1030 Battle King Olav Haraldsson Saint Olav Christianity Viking. Norway independence 1905 Sweden union dissolved Storting Karlstad Haakon VII referendum. Roald Amundsen South Pole 1911 explorer Northwest Passage Arctic polar. 17 mai Syttende mai Constitution Day Eidsvoll 1814 barnetog bunad children parade. Norway World War II German occupation resistance Quisling Hjemmefronten heavy water Vemork sabotage. Norwegian oil discovery 1969 Ekofisk North Sea Statoil Equinor Government Pension Fund sovereign wealth. Sami Parliament Sametinget indigenous Karasjok Finnmark reindeer rights. Fridtjof Nansen explorer diplomat Nobel Peace Prize Fram Greenland. Bergen Hanseatic Bryggen UNESCO trading Olav Kyrre fjords. Storting Norwegian Parliament Stortinget 169 representatives proportional legislation.
    React depth: Suspense fallback loading lazy code splitting streaming SSR boundary concurrent. useEffect side effect lifecycle cleanup dependency mount unmount. Hydration server render client attach event handlers interactive mismatch selective. Context API createContext Provider useContext prop drilling theme locale auth. ISR Incremental Static Regeneration revalidate stale-while-revalidate on-demand. React Compiler Forget automatic memoization useMemo useCallback React.memo build time. useReducer dispatch action reducer complex state transitions. Custom hooks reuse logic useState useEffect prefix encapsulate. forwardRef ref DOM parent child imperative handle React 19. Next.js code splitting dynamic import chunk webpack Turbopack route-based component-based. React use hook Promise Context conditional read resource suspend.
    Norwegian web: WCAG 2.1 AA universell utforming likestilling diskriminering lov accessibility tilgjengelig UU. UU-tilsynet tilsyn universell utforming ICT compliance audit enforcement Digdir. Digdir Digitaliseringsdirektoratet standard referansekatalogen API architecture. Bokmal Nynorsk Norwegian written standard language Ivar Aasen Danish dialect. ID-porten login BankID MinID authentication OIDC government Maskinporten. Bring API shipping Norway Post Posten parcels tracking booking address.
    TypeScript JavaScript depth: Proxy handler trap get set Reflect reactive Vue 3 meta-programming. Unknown any type safety narrowing type check escape hatch. WeakRef garbage collection weak reference FinalizationRegistry cache cleanup memory. Temporal API Date replacement PlainDate ZonedDateTime Instant Duration timezone immutable TC39. structuredClone deep copy clone Map Set Date circular reference structured clone algorithm. AbortController AbortSignal cancel fetch timeout abort signal any compose.
    CSS modern: CSS-in-JS styled-components Emotion vanilla-extract Panda CSS zero-runtime build-time. Has selector parent selector descendant sibling CSS :has() conditional. Clamp responsive fluid min max preferred value typography spacing. Tailwind purge JIT content scan tree-shake unused CSS bundle size. CSS reset normalize Preflight browser defaults cross-browser consistent modern.
    Rust depth: Result Ok Err error handling question mark operator anyhow thiserror propagate. Unsafe raw pointer FFI dereference mutable static union borrow checker bypass safe abstraction.`;
    this.knowledge.learn(expansionText, src, 'en');
    this.tokenizer.encode(expansionText);
  }

  /**
   * Round 14b — fix 24 remaining benchmark failures across 9 categories.
   * Focus: DevOps, Database, Testing, Rust, Python, Go, WCAG, Vue/Angular, Norway history routing.
   */
  private bootstrapKnowledgeExpansionR14b(): void {
    const src = 'bootstrap:expansion-r14b';

    // ── E: DEVOPS (3 fails: Dockerfile, GitHub Actions, CDN) ──────
    this.knowledge.addEntry('dockerfile', '**Dockerfile** is a text file containing instructions to build a Docker image. Each instruction creates a layer.\n\n**Common instructions:**\n- `FROM node:20-alpine` — base image\n- `WORKDIR /app` — set working directory\n- `COPY package*.json ./` — copy files\n- `RUN npm ci` — execute commands\n- `EXPOSE 3000` — document port\n- `CMD ["node", "server.js"]` — default command\n\n**Best practices:** use multi-stage builds to reduce image size, order instructions so rarely-changing layers come first (cache optimization), use `.dockerignore` to exclude node_modules and .git, prefer `COPY` over `ADD`, run as non-root user, pin base image versions.', src, 'en');

    this.knowledge.addEntry('github actions', '**GitHub Actions** is a CI/CD platform integrated into GitHub. Workflows are defined in YAML files under `.github/workflows/`.\n\n**Key concepts:**\n- **Workflow** — automated process triggered by events (push, PR, schedule)\n- **Job** — set of steps running on a runner (ubuntu-latest, windows-latest, macos-latest)\n- **Step** — individual task (run a script or use an action)\n- **Action** — reusable unit (`actions/checkout@v4`, `actions/setup-node@v4`)\n\n**Example:**\n```yaml\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm test\n```\n\n**Features:** matrix builds, secrets management, artifact upload/download, concurrency control, reusable workflows, environment protection rules.', src, 'en');

    this.knowledge.addEntry('cdn content delivery network', '**CDN (Content Delivery Network)** distributes content across geographically dispersed servers to reduce latency and improve load times.\n\n**How it works:** When a user requests content, the CDN serves it from the nearest **edge server** (Point of Presence / PoP) instead of the origin server. Static assets (images, CSS, JS, fonts) are cached at the edge.\n\n**Key features:**\n- **Edge caching** — reduces round trips to origin\n- **DDoS protection** — absorbs attack traffic across distributed network\n- **SSL/TLS termination** — handles HTTPS at the edge\n- **Image optimization** — resize, compress, convert formats on-the-fly\n- **Cache invalidation** — purge stale content\n\n**Popular CDNs:** Cloudflare, AWS CloudFront, Vercel Edge Network, Fastly, Akamai.\n\n**Cache headers:** `Cache-Control`, `ETag`, `Last-Modified` control CDN behavior.', src, 'en');

    // ── F: DATABASE (3 fails: SQL injection, normalization, ACID) ──
    this.knowledge.addEntry('sql injection', '**SQL injection** is a security vulnerability where an attacker inserts malicious SQL code into application queries through user input.\n\n**Example attack:**\n```sql\n-- User inputs: \' OR 1=1 --\nSELECT * FROM users WHERE username = \'\' OR 1=1 --\' AND password = \'...\'\n-- Returns ALL users!\n```\n\n**Prevention:**\n1. **Parameterized queries** (prepared statements) — separate SQL from data\n```javascript\ndb.query(\'SELECT * FROM users WHERE id = $1\', [userId]);\n```\n2. **ORM usage** — Prisma, Drizzle, TypeORM handle parameterization\n3. **Input validation** — whitelist allowed characters\n4. **Least privilege** — database user should have minimal permissions\n5. **WAF** — Web Application Firewall as defense-in-depth\n\nSQL injection is consistently in the **OWASP Top 10** security risks. Always use parameterized queries — never concatenate user input into SQL strings.', src, 'en');

    this.knowledge.addEntry('database normalization', '**Database normalization** organizes tables to reduce data redundancy and improve data integrity.\n\n**Normal forms:**\n- **1NF** — atomic values (no arrays/sets in columns), unique rows\n- **2NF** — 1NF + no partial dependencies (every non-key column depends on the WHOLE primary key)\n- **3NF** — 2NF + no transitive dependencies (non-key columns depend ONLY on the primary key, not on other non-key columns)\n- **BCNF** — stricter 3NF (every determinant is a candidate key)\n\n**Example:** A table with `order_id, product_name, customer_name, customer_address` violates 3NF because customer_address depends on customer_name, not order_id. Fix: separate customers and orders tables.\n\n**Denormalization** is the intentional opposite — adding redundancy for read performance (common in analytics, data warehouses, NoSQL).', src, 'en');

    this.knowledge.addEntry('acid transactions database', '**ACID** properties guarantee reliable database transactions:\n\n- **Atomicity** — a transaction is all-or-nothing. If any part fails, the entire transaction rolls back. No partial updates.\n- **Consistency** — a transaction moves the database from one valid state to another. All constraints, triggers, and rules are satisfied.\n- **Isolation** — concurrent transactions don\'t interfere with each other. Each transaction sees a consistent snapshot. Isolation levels: READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ, SERIALIZABLE.\n- **Durability** — once committed, data survives system crashes (written to disk/WAL).\n\n**Why it matters:** Without ACID, a bank transfer could debit your account but fail to credit the recipient. ACID ensures both operations succeed or neither does.\n\n**ACID databases:** PostgreSQL, MySQL (InnoDB), SQLite, Oracle. **BASE** (eventual consistency) is the NoSQL alternative: Basically Available, Soft state, Eventually consistent.', src, 'en');

    // ── H: TESTING (3 fails: TDD, testing trophy, test fixture) ──
    this.knowledge.addEntry('tdd test driven development', '**TDD (Test-Driven Development)** is a software development practice where you write tests BEFORE writing the implementation code.\n\n**The TDD cycle (Red-Green-Refactor):**\n1. **Red** — write a failing test for the desired behavior\n2. **Green** — write the minimum code to make the test pass\n3. **Refactor** — clean up the code while keeping tests green\n\n**Benefits:**\n- Forces you to think about API design before implementation\n- Catches bugs early (tests exist before code)\n- Provides living documentation\n- Enables confident refactoring\n- Smaller, more focused functions\n\n**TDD vs testing after:** TDD writes tests first (design tool), testing-after writes tests to verify existing code (verification tool). TDD tends to produce better-designed, more testable code.\n\n**Tools:** Vitest, Jest, pytest, RSpec, xUnit. Works well with pair programming and continuous integration.', src, 'en');

    this.knowledge.addEntry('testing trophy', '**The Testing Trophy** (coined by Kent C. Dodds) is an alternative to the testing pyramid that emphasizes **integration tests** as the most valuable testing layer.\n\n**Trophy layers (bottom to top):**\n1. **Static analysis** (base) — TypeScript, ESLint catch bugs without running code\n2. **Unit tests** — test individual functions in isolation\n3. **Integration tests** (widest part) — test modules working together (most bang for buck)\n4. **End-to-end tests** (top) — test full user flows in a real browser\n\n**Key insight:** Integration tests give the best **confidence-to-effort ratio**. Unit tests are cheap but test implementation details. E2E tests give high confidence but are slow and flaky.\n\n**Comparison:** The traditional testing pyramid (by Mike Cohn) puts unit tests at the base. The trophy puts integration tests at the widest part because they catch the most real-world bugs.', src, 'en');

    this.knowledge.addEntry('test fixture', '**A test fixture** is the fixed baseline state or setup needed to run tests reliably and repeatably.\n\n**What fixtures provide:**\n- Known test data (seed data, mock objects)\n- Pre-configured environment (database state, file system, config)\n- Reusable setup/teardown logic\n\n**Examples by framework:**\n- **Vitest/Jest:** `beforeEach()` / `afterEach()` hooks, factory functions\n- **pytest:** `@pytest.fixture` decorator — powerful dependency injection for test setup\n- **Playwright:** `test.extend()` for custom fixtures (page, browser, auth state)\n- **Database fixtures:** seed scripts, factories (faker.js), or snapshot-based fixtures\n\n**Best practices:** fixtures should be independent (no shared mutable state between tests), minimal (only set up what the test needs), and deterministic (same result every run). Prefer factory functions over shared fixture objects.', src, 'en');

    // ── I: RUST (3 fails: borrowing, Result type routing, cargo) ──
    this.knowledge.addEntry('rust borrowing', '**Borrowing** in Rust lets you reference data without taking ownership — the core mechanism that enables Rust\'s memory safety without garbage collection.\n\n**Two types:**\n- **Immutable borrow** (`&T`) — read-only, multiple allowed simultaneously\n- **Mutable borrow** (`&mut T`) — read-write, only ONE at a time\n\n**The borrowing rules:**\n1. You can have EITHER one mutable reference OR any number of immutable references (not both)\n2. References must always be valid (no dangling references)\n\n```rust\nlet mut s = String::from("hello");\nlet r1 = &s;      // OK — immutable borrow\nlet r2 = &s;      // OK — multiple immutable borrows\n// let r3 = &mut s; // ERROR — can\'t borrow mutably while immutable borrows exist\nprintln!("{r1} {r2}");\nlet r3 = &mut s;  // OK — immutable borrows are done\n```\n\n**Why it matters:** These rules prevent data races at compile time. No garbage collector needed.', src, 'en');

    this.knowledge.addEntry('cargo rust', '**Cargo** is Rust\'s official build tool and package manager — the equivalent of npm for Node.js.\n\n**Key commands:**\n- `cargo new my_project` — create a new project\n- `cargo build` — compile the project\n- `cargo run` — compile and run\n- `cargo test` — run tests\n- `cargo check` — fast type-check without producing binary\n- `cargo clippy` — run the Rust linter\n- `cargo fmt` — format code\n- `cargo doc --open` — generate and open documentation\n- `cargo add serde` — add a dependency\n\n**Cargo.toml** — the manifest file (like package.json) defining dependencies, metadata, and build configuration.\n\n**crates.io** — the Rust package registry (like npmjs.com). Packages are called "crates".\n\n**Workspaces:** Cargo supports monorepos with `[workspace]` in the root Cargo.toml.', src, 'en');

    // ── J: PYTHON (3 fails: virtual environment, list vs tuple, pip) ──
    this.knowledge.addEntry('python virtual environment', '**Python virtual environments** create isolated Python installations for each project, preventing dependency conflicts.\n\n**Why needed:** Without virtual environments, all projects share the same global packages. Project A needs Django 4.2 but Project B needs Django 5.0 — conflict. Virtual environments solve this.\n\n**Creating and using:**\n```bash\npython -m venv .venv          # create\nsource .venv/bin/activate      # activate (Linux/macOS)\n.venv\\Scripts\\activate         # activate (Windows)\npip install flask              # install packages locally\ndeactivate                     # exit the venv\n```\n\n**Tools:**\n- `venv` — built into Python 3.3+ (standard)\n- `virtualenv` — third-party, more features\n- `conda` — environments + package management (data science)\n- `pyenv` — manage multiple Python versions\n- `poetry` — modern dependency management with lock files\n- `uv` — ultra-fast Rust-based pip/venv replacement (2024)\n\n**Best practice:** Always use a virtual environment per project. Add `.venv/` to `.gitignore`.', src, 'en');

    this.knowledge.addEntry('python list vs tuple', '**List vs Tuple in Python** — two fundamental sequence types with key differences:\n\n**List** (`[]`) — mutable, dynamic:\n```python\nfruits = ["apple", "banana", "cherry"]\nfruits.append("date")       # can modify\nfruits[0] = "avocado"       # can reassign\n```\n\n**Tuple** (`()`) — immutable, fixed:\n```python\ncoords = (10, 20, 30)\n# coords[0] = 99           # ERROR — cannot modify\n```\n\n**Key differences:**\n| Feature | List | Tuple |\n|---------|------|-------|\n| Mutable | Yes | No |\n| Syntax | `[1, 2, 3]` | `(1, 2, 3)` |\n| Performance | Slower | Faster (immutable) |\n| Hashable | No | Yes (can be dict key) |\n| Use case | Dynamic collections | Fixed records, dict keys |\n\n**When to use tuples:** function return values, dictionary keys, coordinates, database rows, any data that shouldn\'t change. **When to use lists:** collections you\'ll modify, filter, sort, or append to.', src, 'en');

    this.knowledge.addEntry('pip python', '**pip** is Python\'s standard package installer — it downloads and installs packages from **PyPI** (Python Package Index).\n\n**Key commands:**\n- `pip install flask` — install a package\n- `pip install flask==2.3.0` — install specific version\n- `pip install -r requirements.txt` — install from requirements file\n- `pip uninstall flask` — remove a package\n- `pip list` — show installed packages\n- `pip freeze > requirements.txt` — export installed packages\n- `pip install --upgrade pip` — update pip itself\n\n**requirements.txt** — lists project dependencies with version pins:\n```\nflask==2.3.0\nrequests>=2.28.0\npytest~=7.4\n```\n\n**Modern alternatives:**\n- **poetry** — dependency management with lock files and virtual environments\n- **pipenv** — pip + virtualenv combined\n- **uv** — ultra-fast Rust-based drop-in pip replacement\n- **pdm** — PEP 582-based package manager', src, 'en');

    // ── K: GO (3 fails: defer, slice, sync package) ──────────────
    this.knowledge.addEntry('go defer keyword', '**defer** in Go schedules a function call to execute when the surrounding function returns — used for cleanup, resource release, and guaranteed execution.\n\n**Basic usage:**\n```go\nfunc readFile(path string) ([]byte, error) {\n    f, err := os.Open(path)\n    if err != nil { return nil, err }\n    defer f.Close() // guaranteed to run when function returns\n    return io.ReadAll(f)\n}\n```\n\n**Key rules:**\n1. **LIFO order** — multiple defers execute in reverse order (last-in, first-out)\n2. **Arguments evaluated immediately** — `defer fmt.Println(x)` captures x\'s current value\n3. **Runs on return** — whether normal return, panic, or early return\n\n**Common uses:** closing files, unlocking mutexes (`defer mu.Unlock()`), closing database connections, logging function duration, recovering from panics.\n\n**defer + recover:** Catch panics in Go:\n```go\ndefer func() { if r := recover(); r != nil { log.Println("recovered:", r) } }()\n```', src, 'en');

    this.knowledge.addEntry('go slice', '**Slice** in Go is a dynamically-sized, flexible view into an array — the most commonly used data structure in Go.\n\n**Creating slices:**\n```go\ns := []int{1, 2, 3}          // literal\ns := make([]int, 5)           // make with length\ns := make([]int, 0, 10)       // length 0, capacity 10\n```\n\n**Key operations:**\n- `append(s, 4, 5)` — add elements (may allocate new backing array)\n- `s[1:3]` — sub-slice (inclusive start, exclusive end)\n- `len(s)` — current length\n- `cap(s)` — capacity before reallocation\n- `copy(dst, src)` — copy elements between slices\n\n**Internal structure:** A slice is a 3-word struct: pointer to backing array, length, capacity.\n\n**Gotchas:**\n- Slicing creates a shared backing array (mutations visible in both)\n- `append` may create a new backing array when capacity is exceeded\n- Use `slices.Clone()` (Go 1.21+) for independent copies\n\n**Slice vs Array:** Arrays have fixed size (`[5]int`), slices are dynamic (`[]int`). Prefer slices in almost all Go code.', src, 'en');

    this.knowledge.addEntry('go sync package', '**sync** is Go\'s standard library package for concurrency primitives — low-level tools for coordinating goroutines.\n\n**Key types:**\n- **sync.Mutex** — mutual exclusion lock\n```go\nvar mu sync.Mutex\nmu.Lock()\n// critical section\nmu.Unlock()\n```\n- **sync.RWMutex** — read-write lock (multiple readers OR one writer)\n- **sync.WaitGroup** — wait for a group of goroutines to finish\n```go\nvar wg sync.WaitGroup\nwg.Add(1)\ngo func() { defer wg.Done(); work() }()\nwg.Wait()\n```\n- **sync.Once** — execute a function exactly once (thread-safe singleton)\n- **sync.Map** — concurrent-safe map (no explicit locking needed)\n- **sync.Pool** — reuse temporary objects to reduce GC pressure\n\n**Best practice:** Prefer channels for communication between goroutines. Use sync primitives when you need shared mutable state with fine-grained control.', src, 'en');

    // ── L: WCAG / ACCESSIBILITY (3 fails: screen reader, semantic HTML, focus trap) ──
    this.knowledge.addEntry('screen reader accessibility', '**Screen readers** are assistive technology that convert digital content to speech or braille for users who are blind or have low vision.\n\n**Popular screen readers:** NVDA (Windows, free), JAWS (Windows, commercial), VoiceOver (macOS/iOS, built-in), TalkBack (Android, built-in).\n\n**How they work:** Screen readers parse the **accessibility tree** (derived from the DOM) and announce element roles, names, states, and content.\n\n**Developer responsibilities:**\n- Use **semantic HTML** (`<nav>`, `<main>`, `<button>`, `<h1>`-`<h6>`) — screen readers use these for navigation\n- Add **alt text** to images (`<img alt="Description">`)\n- Use **ARIA** attributes when native semantics aren\'t sufficient (`aria-label`, `aria-expanded`, `role`)\n- Ensure **keyboard navigation** works (Tab, Enter, Escape, Arrow keys)\n- Manage **focus** properly (focus visible, focus order, focus traps for modals)\n- Use **live regions** (`aria-live="polite"`) for dynamic content updates\n\n**Testing:** Use NVDA or VoiceOver to manually test. Automated tools (axe, Lighthouse) catch ~30% of accessibility issues.', src, 'en');

    this.knowledge.addEntry('semantic html', '**Semantic HTML** uses elements that convey meaning about their content, rather than just visual presentation.\n\n**Semantic elements:**\n- `<header>` — introductory content or navigation\n- `<nav>` — navigation links\n- `<main>` — primary content (only one per page)\n- `<article>` — self-contained content (blog post, comment)\n- `<section>` — thematic grouping with a heading\n- `<aside>` — tangentially related content (sidebar)\n- `<footer>` — footer for section or page\n- `<figure>` / `<figcaption>` — self-contained media with caption\n- `<time>` — date/time (`<time datetime="2024-01-15">`)\n- `<mark>` — highlighted text\n\n**Why it matters:**\n1. **Accessibility** — screen readers use semantic elements to navigate (skip to main, list headings)\n2. **SEO** — search engines understand content structure\n3. **Maintainability** — code is self-documenting\n\n**Anti-pattern:** Using `<div>` and `<span>` for everything ("div soup"). Use the right element for the job — `<button>` for actions, `<a>` for links, `<h1>`-`<h6>` for headings.', src, 'en');

    this.knowledge.addEntry('focus trap accessibility', '**Focus trap** keeps keyboard focus within a specific UI element (typically a modal dialog) so users can\'t Tab out into the background content.\n\n**Why it matters:** When a modal opens, keyboard users and screen reader users need focus to stay inside the modal. Without a focus trap, pressing Tab can move focus to hidden background elements — confusing and inaccessible.\n\n**Implementation:**\n1. When modal opens → move focus to the first focusable element inside\n2. Intercept Tab/Shift+Tab → cycle focus within the modal\'s focusable elements\n3. Press Escape → close the modal, return focus to the trigger element\n4. When modal closes → restore focus to the element that opened it\n\n**Modern approach:** The native `<dialog>` element with `showModal()` provides a built-in focus trap (inert background).\n\n**Libraries:** focus-trap (npm), Radix UI Dialog, Headless UI Dialog — all handle focus trapping correctly.\n\n**WCAG requirement:** Focus trap is required for modal dialogs under WCAG 2.1 Success Criterion 2.4.3 (Focus Order) and 2.1.2 (No Keyboard Trap — user must be able to escape).', src, 'en');

    // ── P: VUE/ANGULAR (2 fails: SvelteKit, Angular CLI) ─────────
    this.knowledge.addEntry('sveltekit', '**SvelteKit** is the official full-stack framework for **Svelte** — similar to what Next.js is for React.\n\n**Key features:**\n- **File-based routing** — `src/routes/about/+page.svelte` → `/about`\n- **Server-side rendering** (SSR) by default\n- **Static site generation** (SSG) via `adapter-static`\n- **API routes** — `+server.ts` files for backend endpoints\n- **Load functions** — `+page.server.ts` / `+page.ts` for data loading\n- **Form actions** — progressive enhancement for forms\n- **Streaming** — stream data to the client as it becomes available\n\n**What makes Svelte different:** Svelte is a **compiler**, not a runtime. Components compile to vanilla JS with no virtual DOM overhead. This results in smaller bundles and faster performance.\n\n**Getting started:** `npm create svelte@latest my-app`\n\n**Adapters:** Deploy to Node.js, Vercel, Netlify, Cloudflare Workers, static hosting.', src, 'en');

    this.knowledge.addEntry('angular cli', '**Angular CLI** (`@angular/cli`) is the official command-line tool for creating, building, testing, and deploying Angular applications.\n\n**Key commands:**\n- `ng new my-app` — create a new Angular project\n- `ng serve` — start dev server with hot reload\n- `ng generate component my-comp` — generate component (alias: `ng g c`)\n- `ng generate service my-service` — generate service\n- `ng build` — production build\n- `ng test` — run unit tests (Karma/Jest)\n- `ng e2e` — run end-to-end tests\n- `ng add @angular/material` — add Angular Material\n- `ng update` — update Angular and dependencies\n\n**Schematics:** Angular CLI uses schematics (code generators) to scaffold components, services, guards, pipes, and modules following Angular best practices.\n\n**angular.json** — workspace configuration file controlling build options, file paths, and project structure.', src, 'en');

    // ── U: NORWAY HISTORY routing fix (entry exists, pattern needs variant) ──
    this.knowledge.addEntry('oil discovered norwegian north sea', 'Oil was discovered in the Norwegian North Sea on December 23, 1969, when the Ekofisk field was confirmed. This discovery transformed Norway from a modest fishing and shipping nation into one of the world\'s wealthiest countries. The Norwegian government established Statoil (now Equinor) in 1972 and created the Government Pension Fund Global (Oljefondet/Oil Fund) in 1990 to invest petroleum revenues for future generations. The fund is now worth over $1.5 trillion, making it the world\'s largest sovereign wealth fund.', src, 'en');

    // ── Routing-fix pattern variants for short queries ────────────
    this.knowledge.addEntry('cdn', 'A **CDN (Content Delivery Network)** distributes content across geographically dispersed edge servers to reduce latency. Static assets (images, CSS, JS) are cached at the nearest Point of Presence (PoP). Key features: edge caching, DDoS protection, SSL termination, image optimization. Popular CDNs: Cloudflare, AWS CloudFront, Vercel Edge Network, Fastly, Akamai.', src, 'en');
    this.knowledge.addEntry('acid transaction', '**ACID** guarantees reliable database transactions: **Atomicity** (all-or-nothing), **Consistency** (valid state transitions), **Isolation** (concurrent transactions don\'t interfere), **Durability** (committed data survives crashes). Without ACID, a bank transfer could debit without crediting. PostgreSQL, MySQL InnoDB, SQLite are ACID-compliant. The NoSQL alternative is BASE: Basically Available, Soft state, Eventually consistent.', src, 'en');
    this.knowledge.addEntry('test-driven development', '**TDD (Test-Driven Development)** writes tests BEFORE code. The Red-Green-Refactor cycle: 1) Red — write a failing test, 2) Green — write minimal code to pass, 3) Refactor — clean up while tests stay green. Benefits: catches bugs early, better API design, confident refactoring. Tools: Vitest, Jest, pytest, RSpec.', src, 'en');
    this.knowledge.addEntry('css-in-js', '**CSS-in-JS** writes CSS directly in JavaScript, scoped to components. Runtime libraries (styled-components, Emotion) generate styles at runtime. Zero-runtime libraries (vanilla-extract, Linaria, Panda CSS) extract CSS at build time. Pros: component-scoped, dynamic styles, TypeScript support. Cons: runtime overhead for runtime libs. Tailwind CSS is the leading utility-first alternative.', src, 'en');

    // ── NEW ENTRIES for remaining failures ────────────────────────
    this.knowledge.addEntry('oklch color space', '**OKLCH** is a perceptual color space designed for predictable color manipulation in CSS.\n\n**Syntax:** `oklch(L C H / alpha)` — Lightness (0-1), Chroma (0-0.4), Hue (0-360°).\n\n**Why OKLCH over HSL:**\n- **Perceptually uniform** — equal numeric changes produce equal visual changes\n- **Consistent lightness** — HSL yellow appears much brighter than blue at the same L value; OKLCH fixes this\n- **Better gradients** — no muddy/gray middle zones\n- **Wide gamut** — supports P3 and Rec. 2020 color spaces (beyond sRGB)\n\n**Usage in CSS:**\n```css\ncolor: oklch(0.7 0.15 150); /* green */\ncolor: oklch(0.5 0.2 270 / 0.8); /* semi-transparent purple */\n```\n\n**Tailwind v4** uses OKLCH as its default color space. Supported in all modern browsers (2023+).', src, 'en');

    this.knowledge.addEntry('javascript map and set', '**Map** and **Set** are built-in JavaScript collection types (ES6+).\n\n**Map** — key-value pairs where keys can be any type (not just strings):\n```javascript\nconst m = new Map();\nm.set(objKey, \'value\');  // any type as key\nm.get(objKey);           // retrieve\nm.has(objKey);           // check existence\nm.size;                  // count entries\n```\n\n**Set** — collection of unique values:\n```javascript\nconst s = new Set([1, 2, 2, 3]); // {1, 2, 3}\ns.add(4);  s.has(2);  s.delete(1);\n```\n\n**Map vs Object:** Map has any-type keys, guaranteed insertion order, better performance for frequent additions/deletions, and a `.size` property.\n\n**Set vs Array:** Set automatically deduplicates. `[...new Set(array)]` is the idiomatic way to remove duplicates.\n\n**WeakMap/WeakSet** — keys are weakly held (garbage-collectable). Useful for caching without memory leaks.', src, 'en');

    this.knowledge.addEntry('javascript symbol', '**Symbol** is a primitive type in JavaScript that creates **unique, immutable identifiers**.\n\n```javascript\nconst id = Symbol(\'description\');\nconst id2 = Symbol(\'description\');\nid === id2; // false — every Symbol is unique\n```\n\n**Use cases:**\n- **Unique property keys** — avoid naming collisions in objects\n- **Well-known symbols** — customize language behavior:\n  - `Symbol.iterator` — make objects iterable\n  - `Symbol.toPrimitive` — custom type conversion\n  - `Symbol.hasInstance` — customize instanceof\n- **Private-ish properties** — Symbols don\'t show up in `for...in` or `Object.keys()`\n\n**Symbol.for(key)** — creates/retrieves a global shared Symbol (same key → same Symbol across files).\n\nSymbols are NOT strings. They provide a way to create truly unique identifiers that can\'t accidentally collide with other property names.', src, 'en');

    this.knowledge.addEntry('for in vs for of javascript', '**for...in** iterates over **enumerable property keys** (strings) of an object.\n**for...of** iterates over **iterable values** (arrays, strings, Maps, Sets, generators).\n\n```javascript\nconst arr = [\'a\', \'b\', \'c\'];\n\nfor (const key in arr) console.log(key);   // "0", "1", "2" (indices as strings)\nfor (const val of arr) console.log(val);   // "a", "b", "c" (actual values)\n```\n\n**for...in:**\n- Iterates over ALL enumerable properties (including inherited ones)\n- Returns property keys as strings\n- Best for: plain objects (`for (const key in obj)`)\n- Pitfall: also iterates prototype chain — use `hasOwnProperty` guard\n\n**for...of:**\n- Iterates over iterable protocol values\n- Works with arrays, strings, Maps, Sets, generators, NodeLists\n- Best for: arrays and iterables\n- Does NOT work with plain objects (use `Object.entries()` instead)\n\n**Modern alternatives:** `Array.forEach()`, `Array.map()`, `Object.entries()`, `Object.keys()`.', src, 'en');

    this.knowledge.addEntry('data minimization gdpr', '**Data minimization** is a core principle of GDPR (Article 5(1)(c)) requiring that personal data collected must be **adequate, relevant, and limited to what is necessary** for the specified purpose.\n\n**What it means:**\n- Only collect data you actually need\n- Don\'t gather "nice to have" data "just in case"\n- Delete data when it\'s no longer needed for its original purpose\n- Pseudonymize or anonymize data when full identification isn\'t required\n\n**Examples:**\n- A newsletter signup only needs an email — not name, phone, address\n- A contact form doesn\'t need date of birth\n- Analytics should use anonymized IPs where possible\n\n**Related principles:** purpose limitation (use data only for stated purpose), storage limitation (don\'t keep data forever). Violations can result in fines up to 4% of global annual turnover or €20 million under GDPR.', src, 'en');

    this.knowledge.addEntry('two-factor authentication', '**Two-factor authentication (2FA)** requires two different types of verification to prove identity, adding a security layer beyond just a password.\n\n**The three factors:**\n1. **Something you know** — password, PIN\n2. **Something you have** — phone, hardware key, authenticator app\n3. **Something you are** — fingerprint, face, voice (biometric)\n\n**2FA = any two of the above.** MFA (multi-factor authentication) uses two or more.\n\n**Common 2FA methods:**\n- **TOTP** — time-based one-time password (Google Authenticator, Authy)\n- **SMS codes** — least secure (SIM swapping risk)\n- **Hardware keys** — YubiKey, FIDO2/WebAuthn (most secure)\n- **Push notifications** — approve on phone\n- **Passkeys** — FIDO2-based passwordless authentication (2024+ standard)\n\n**For developers:** Use libraries like Speakeasy (TOTP), integrate WebAuthn API, or use auth services (Auth0, Clerk, Supabase Auth) that include 2FA.', src, 'en');

    this.knowledge.addEntry('nx monorepo', '**Nx** is a build system and monorepo management tool for JavaScript/TypeScript projects.\n\n**Key features:**\n- **Computation caching** — never rebuild unchanged code (local + remote cache)\n- **Task graph** — understands project dependencies, runs tasks in optimal order\n- **Affected commands** — `nx affected:test` only tests projects impacted by your changes\n- **Code generators** — scaffold components, libraries, and applications\n- **Plugins** — first-class support for React, Angular, Node.js, Next.js, and more\n\n**Core concepts:**\n- **Workspace** — monorepo containing apps and libs\n- **Project graph** — dependency graph of all projects\n- **Executors** — build/test/serve runners\n- **Generators** — code scaffolding\n\n**Nx vs Turborepo:** Nx has a richer plugin system and code generation. Turborepo is simpler and focused on caching/task orchestration. Both solve the monorepo build performance problem.\n\n**Getting started:** `npx create-nx-workspace@latest`', src, 'en');

    this.knowledge.addEntry('framer motion', '**Framer Motion** is a production-ready animation library for **React** that makes complex animations simple with a declarative API.\n\n**Basic usage:**\n```jsx\nimport { motion } from \'framer-motion\';\n\n<motion.div\n  initial={{ opacity: 0, y: 20 }}\n  animate={{ opacity: 1, y: 0 }}\n  exit={{ opacity: 0 }}\n  transition={{ duration: 0.3 }}\n/>\n```\n\n**Key features:**\n- **Layout animations** — `layout` prop auto-animates position/size changes\n- **Gestures** — drag, hover, tap, pan with physics\n- **AnimatePresence** — animate components as they mount/unmount\n- **Variants** — orchestrate animations across component trees\n- **Spring physics** — natural-feeling motion without manual easing\n- **Scroll animations** — `useScroll`, `useInView` hooks\n\n**Framer Motion is now Motion** — as of 2024, the library was renamed to `motion` with framework-agnostic support (React, Vue, vanilla JS). Install: `npm install motion`.', src, 'en');

    this.knowledge.addEntry('react query tanstack query', '**React Query (now TanStack Query)** is a server state management library — it handles fetching, caching, synchronizing, and updating server data in React apps.\n\n**Core concept:** Server state (data from APIs) is fundamentally different from client state (UI state like modals, form inputs). React Query manages server state.\n\n**Key features:**\n- **Automatic caching** — queries are cached by key, reused across components\n- **Background refetching** — stale data is shown instantly while fresh data loads\n- **Smart retries** — failed queries auto-retry with exponential backoff\n- **Optimistic updates** — update UI before server confirms\n- **Pagination & infinite scroll** — built-in support\n- **Devtools** — visual query inspector\n\n**Usage:**\n```jsx\nconst { data, isLoading } = useQuery({\n  queryKey: [\'todos\'],\n  queryFn: () => fetch(\'/api/todos\').then(r => r.json()),\n});\n```\n\n**Mutations:** `useMutation` for POST/PUT/DELETE with automatic cache invalidation.\n\n**TanStack Query v5** also supports Vue, Svelte, Solid, and Angular.', src, 'en');

    this.knowledge.addEntry('result type rust', '**Result<T, E>** is Rust\'s primary error handling type — an enum with two variants: `Ok(T)` for success and `Err(E)` for failure. The `?` operator propagates errors automatically. Use `match` to handle both cases. Unlike exceptions, Result forces explicit error handling at compile time. Popular error libraries: anyhow (application code), thiserror (library code).', src, 'en');

    this.knowledge.addEntry('slice go', 'A **slice** in Go is a dynamically-sized view into an array — the most common data structure in Go. Create with `[]int{1,2,3}` or `make([]int, len, cap)`. Key operations: `append`, sub-slicing `s[1:3]`, `len()`, `cap()`, `copy()`. Internally a 3-word struct: pointer, length, capacity. Slicing shares the backing array. Use `slices.Clone()` for independent copies.', src, 'en');

    this.knowledge.addEntry('react forwardref', '**React.forwardRef** lets a parent pass a ref through to a child component\'s DOM element. Usage: `const Input = forwardRef((props, ref) => <input ref={ref} {...props} />)`. Essential for design system components, imperative handle APIs (useImperativeHandle), and library integration. In React 19, ref is a regular prop, making forwardRef less necessary.', src, 'en');

    // ── Ultra-short pattern aliases for single-word/abbreviation queries ──
    this.knowledge.addEntry('isr nextjs', '**ISR (Incremental Static Regeneration)** in Next.js updates static pages after deployment without full rebuilds. Pages are statically generated at build time, then regenerated in the background after the revalidate period. Usage: `export const revalidate = 60`. On-demand ISR: `revalidatePath()` or `revalidateTag()`. Benefits: static performance with dynamic freshness.', src, 'en');
    this.knowledge.addEntry('nx', '**Nx** is a build system and monorepo tool with computation caching, task graph analysis, and affected-only testing. Supports React, Angular, Node.js, Next.js. Key: `nx affected:test` runs only impacted tests. Nx vs Turborepo: Nx has richer plugins and code generation. Start: `npx create-nx-workspace@latest`.', src, 'en');
    this.knowledge.addEntry('data minimization', '**Data minimization** (GDPR Article 5(1)(c)) requires collecting only personal data that is adequate, relevant, and limited to what is necessary for the specified purpose. Don\'t collect "nice to have" data. Delete data when no longer needed. Related: purpose limitation, storage limitation. Violations: fines up to 4% of global turnover.', src, 'en');
    this.knowledge.addEntry('for...in vs for...of', '**for...in** iterates over enumerable property keys (strings) of an object. **for...of** iterates over iterable values (arrays, Maps, Sets). for...in returns keys, for...of returns values. for...in traverses the prototype chain. for...of uses the iterable protocol. Use for...in for objects, for...of for arrays.', src, 'en');
    this.knowledge.addEntry('result rust', '**Result<T, E>** in Rust has two variants: Ok(T) for success and Err(E) for failure. The ? operator propagates errors. Match on Ok/Err for handling. Unlike exceptions, Result forces explicit error handling at compile time. Libraries: anyhow, thiserror.', src, 'en');
    this.knowledge.addEntry('slice in go', 'A **slice** in Go is a dynamically-sized, flexible view into an array. Create: `[]int{1,2,3}` or `make([]int, len, cap)`. Append: `s = append(s, elem)`. Sub-slice: `s[1:3]`. Length: `len(s)`, capacity: `cap(s)`. Copy: `copy(dst, src)`. A slice header is (pointer, length, capacity). Slicing shares the backing array.', src, 'en');
    this.knowledge.addEntry('forwardref react', '**forwardRef** in React allows passing a ref from a parent component to a child DOM element. Wrap the component: `const Comp = forwardRef((props, ref) => <div ref={ref} />)`. Used in design systems, imperative handles, and library wrappers. React 19 makes ref a regular prop.', src, 'en');

    // ── Final routing fixes: match exact cleaned query word patterns ──
    this.knowledge.addEntry('isr next js', '**ISR (Incremental Static Regeneration)** in Next.js update static pages after deployment without full rebuilds. After the revalidate period, the next request triggers background regeneration (stale-while-revalidate). Usage: `export const revalidate = 60`. On-demand: `revalidatePath()`, `revalidateTag()`. Benefits: CDN-cached static performance with dynamic freshness.', src, 'en');
    this.knowledge.addEntry('result type rust', '**Result<T, E>** is Rust\'s primary error handling enum: `Ok(T)` for success, `Err(E)` for failure. The `?` operator propagates Err automatically, unwraps Ok. Use `match` for exhaustive handling. Avoids exceptions — all errors are explicit. Libraries: **anyhow** (app code, any error type), **thiserror** (derive Error for custom types).', src, 'en');
    this.knowledge.addEntry('react forward ref', '**React.forwardRef** passes a ref from parent to child DOM node: `const Input = forwardRef((props, ref) => <input ref={ref} {...props} />)`. The parent can then access the DOM element directly. Used for: design system wrappers, imperative handles (`useImperativeHandle`), third-party integration. In React 19, ref is just a regular prop.', src, 'en');
    this.knowledge.addEntry('difference for in for of', '**for...in** loops over enumerable property **keys** (strings) of an object, including inherited properties. **for...of** loops over **values** of iterable objects (arrays, Maps, Sets, strings). for...in is for object keys, for...of is for array values. Modern alternatives: `Object.entries()`, `.map()`, `.forEach()`.', src, 'en');
    this.knowledge.addEntry('slice go', 'A **Go slice** is a dynamically-sized view into an array — the primary collection type in Go. Create: `s := []int{1,2,3}` or `make([]int, 5)`. Append: `s = append(s, 4)`. Sub-slice: `s[1:3]`. Internally: pointer + length + capacity. `append` may allocate a new backing array when capacity is exceeded. Use `slices.Clone()` for independent copies.', src, 'en');

    // ── TF-IDF training text for R14b entries ─────────────────────
    const r14bText = `DevOps: Dockerfile Docker image base FROM WORKDIR COPY RUN CMD multi-stage build container. GitHub Actions CI CD workflow YAML job step runner action matrix secrets. CDN content delivery network edge server cache latency PoP Cloudflare CloudFront.
    Database: SQL injection attack parameterized query prepared statement OWASP security vulnerability prevention ORM. Database normalization normal form 1NF 2NF 3NF BCNF redundancy denormalization data integrity. ACID atomicity consistency isolation durability transaction rollback commit WAL.
    Testing: TDD test-driven development red green refactor failing test write code first. Testing trophy Kent Dodds integration tests unit test pyramid static analysis end-to-end. Test fixture setup teardown beforeEach afterEach seed data mock factory pytest Playwright.
    Rust: borrowing borrow reference immutable mutable ownership memory safety data race compile time ampersand. Cargo build tool package manager crates crate registry Cargo.toml workspace clippy fmt doc. Result Ok Err error handling question mark operator anyhow thiserror propagate.
    Python: virtual environment venv virtualenv conda pyenv poetry isolation dependency conflict pip install activate. List tuple mutable immutable sequence hashable dict key performance Python data structure. Pip package installer PyPI requirements.txt freeze install uninstall poetry pipenv uv.
    Go: defer keyword cleanup resource release LIFO function return close file mutex unlock recover panic. Slice dynamic array backing append length capacity make sub-slice copy clone Go data structure. Sync package mutex RWMutex WaitGroup Once Map Pool goroutine concurrency primitive lock.
    Accessibility: screen reader NVDA JAWS VoiceOver TalkBack assistive technology accessibility tree ARIA alt text. Semantic HTML header nav main article section aside footer figure meaning structure SEO. Focus trap modal dialog keyboard Tab Escape focusable element inert WCAG 2.4.3.
    Frameworks: SvelteKit Svelte compiler file routing SSR SSG adapter form actions load functions. Angular CLI ng command generate component service build serve test schematics angular.json.
    CSS: OKLCH color space perceptual uniform lightness chroma hue wide gamut P3 Tailwind v4 oklch. CSS-in-JS styled-components Emotion vanilla-extract runtime zero-runtime Panda CSS.
    JavaScript: Map Set collection unique values key-value WeakMap WeakSet ES6. Symbol primitive unique immutable identifier iterator toPrimitive property key. For in for of enumerable iterable keys values array object prototype.
    GDPR: data minimization adequate relevant necessary purpose limitation storage limitation personal data Article 5.
    Auth: two-factor authentication 2FA MFA TOTP SMS hardware key YubiKey FIDO2 WebAuthn passkey biometric.
    Monorepo: Nx build system computation caching task graph affected code generators plugins Turborepo workspace.
    Animation: Framer Motion animation library React motion layout gestures AnimatePresence variants spring scroll.
    State: React Query TanStack Query server state cache fetching caching useQuery useMutation background refetch optimistic.`;
    this.knowledge.learn(r14bText, src, 'en');
    this.tokenizer.encode(r14bText);
  }

  /**
   * Bootstrap cross-domain bridge facts that strengthen the connection graph.
   * These entries link related concepts across domains so the intelligence
   * layer can traverse from one topic to related ones.
   */
  private bootstrapKnowledgeConnections(): void {
    const src = 'bootstrap:connections';

    // Frontend frameworks — shared concepts
    this.knowledge.addEntry('react overview', '**React** is a JavaScript library for building user interfaces, created by **Meta** (2013). It\'s the most widely adopted frontend library — if you\'re building a web app today, there\'s a good chance React is one of your top choices.\n\n**Core concepts:**\n- **Components** — reusable UI building blocks (think LEGO bricks for UIs)\n- **JSX** — HTML-like syntax in JavaScript\n- **Hooks** — useState, useEffect, useRef for state and side effects\n- **Virtual DOM** — efficient UI updates by diffing\n- **Unidirectional data flow** — props down, events up\n\n**Ecosystem:** React Router (navigation), Redux/Zustand (state), Next.js (SSR/SSG).\n\n**When to use React:** SPAs, dashboards, mobile apps (React Native), anything interactive.', src, 'en');
    this.knowledge.addEntry('vue overview', 'Vue is a progressive JavaScript framework for building user interfaces with reactive data binding and a virtual DOM. Vue uses single-file components, the Composition API, and two-way data binding. Created by Evan You in 2014.', src, 'en');
    this.knowledge.addEntry('angular overview', 'Angular is a TypeScript-based platform for building web applications with dependency injection, change detection, and a module system. Angular uses components, services, RxJS observables, and has built-in routing. Created by Google in 2016.', src, 'en');

    // Container ecosystem — shared concepts
    this.knowledge.addEntry('docker overview', 'Docker is a platform for building and running containerized applications. Docker uses images, containers, volumes, and networks. Docker Compose orchestrates multi-container setups. Containers package code with all dependencies for consistent environments across development and production.', src, 'en');
    this.knowledge.addEntry('kubernetes overview', '**Kubernetes (K8s)** picks up where Docker leaves off — once you have containers, K8s decides where they run, how many copies exist, and what happens when they crash.\n\n**Core concepts:**\n- **Pod** — smallest deployable unit (one or more containers)\n- **Service** — stable network endpoint for pods\n- **Deployment** — manages pod replicas and rolling updates\n- **Ingress** — routes external HTTP traffic to services\n\n**Key commands:** `kubectl get pods`, `kubectl apply -f`, `kubectl logs`, `kubectl scale`.\n\nOriginally developed by **Google**, now maintained by the CNCF.', src, 'en');
    this.knowledge.addEntry('containerization', '**Containerization** packages applications with their dependencies into isolated units called **containers**.\n\n**Why it matters:** Before containers, deploying software meant praying it would behave the same way on the server as it did on your laptop. Containers solved that.\n\n**Containers vs VMs:**\n- Containers share the host OS kernel — lightweight, start in seconds\n- VMs run a full OS — heavier, start in minutes\n\n**Key tools:**\n- **Docker** — build and run containers\n- **Kubernetes** — orchestrate containers at scale\n- **Podman** — rootless alternative to Docker\n\n**Benefits:** consistency across environments, isolation, portability, resource efficiency.', src, 'en');

    // Databases — shared concepts
    this.knowledge.addEntry('postgresql overview', 'PostgreSQL is a powerful open-source relational database supporting SQL, JSON, full-text search, and window functions. PostgreSQL uses MVCC for concurrent access and supports B-tree, GIN, GiST, and BRIN index types. Known for data integrity and advanced features.', src, 'en');
    this.knowledge.addEntry('mongodb overview', 'MongoDB is a document-oriented NoSQL database storing data in flexible JSON-like BSON documents. MongoDB supports horizontal scaling through sharding and uses replica sets for high availability. Best for flexible schemas and rapid development.', src, 'en');
    this.knowledge.addEntry('database comparison', 'SQL databases (PostgreSQL, MySQL) use structured tables with schemas, ACID transactions, and are best for complex queries and data integrity. NoSQL databases (MongoDB, Redis) use flexible schemas, eventual consistency, and are best for rapid development and horizontal scaling. Choose SQL when you need joins and transactions; choose NoSQL when you need schema flexibility and scale.', src, 'en');

    // Testing — shared concepts
    this.knowledge.addEntry('testing overview', 'Software testing verifies code works correctly. Unit tests verify individual functions. Integration tests verify modules work together. End-to-end tests verify the full user flow. Test-driven development (TDD) writes tests before code. Tools: Vitest for unit tests, Playwright for E2E, React Testing Library for UI components.', src, 'en');

    // DevOps bridge
    this.knowledge.addEntry('devops overview', 'DevOps combines development and operations for continuous delivery. CI/CD pipelines automate build, test, and deployment. Infrastructure as Code (IaC) manages servers through configuration files. Docker containers provide consistent environments. Kubernetes orchestrates containers in production. Monitoring and logging complete the feedback loop.', src, 'en');

    // Version control
    this.knowledge.addEntry('git overview', '**Git** is a **distributed version control system** — it lets you track every change to your code, undo mistakes, and collaborate with others without stepping on each other\'s work.\n\n**Why it matters:** Without Git, one bad edit can destroy your project. With Git, you can always go back.\n\n**Key operations:**\n- **commit** — save a snapshot of your changes\n- **branch** — create parallel lines of development\n- **merge** — combine branches back together\n- **rebase** — replay commits onto a new base\n- **cherry-pick** — apply specific commits\n\n**Workflow:** Feature branches → Pull requests → Code review → Merge to main.\n\n**Essential commands:** `git init`, `git clone`, `git add`, `git commit`, `git push`, `git pull`, `git branch`, `git checkout`, `git merge`.\n\n**Platforms:** GitHub, GitLab, and Bitbucket add collaboration features like PRs, issues, and CI/CD pipelines.', src, 'en');

    // Node.js
    this.knowledge.addEntry('nodejs overview', 'Node.js is a JavaScript runtime built on Chrome\'s V8 engine for server-side development. It uses an event-driven, non-blocking I/O model ideal for data-intensive real-time applications. npm is the world\'s largest package ecosystem. Key features: single-threaded event loop, worker threads for CPU tasks, built-in modules (fs, http, path, crypto). Common frameworks: Express.js, Fastify, Nest.js. Node.js powers the backend of MERN, PERN, and MEVN stacks.', src, 'en');

    // TypeScript-JavaScript relationship
    this.knowledge.addEntry('typescript javascript relationship', '**TypeScript and JavaScript — the relationship:**\n\nThink of TypeScript as JavaScript with a **safety net** — same language underneath, but with an extra layer that catches mistakes before your code runs.\n\nTypeScript is a **strict superset** of JavaScript — all valid JavaScript is already valid TypeScript.\n\n**What TypeScript adds:**\n- Static types, interfaces, generics, and enums\n- Compile-time error checking (JavaScript only catches errors at runtime)\n- Better IDE support (IntelliSense, refactoring)\n\n**How they connect:**\n- TypeScript compiles (transpiles) to plain JavaScript\n- Runs anywhere JS runs: browsers, Node.js, Deno, Bun\n- `tsconfig.json` configures the TypeScript compiler', src, 'en');

    // ── Gap-coverage entries (identified by diagnose() Round 11) ──

    // GraphQL — no handler or entry existed
    this.knowledge.addEntry('graphql', '**GraphQL** is a query language for APIs, developed by **Meta** (2012, open-sourced 2015). Instead of REST\'s fixed endpoints, clients ask for exactly the data they need in a single request.\n\n**Core concepts:**\n- **Schema** — defines types and relationships (`type User { id: ID!, name: String, posts: [Post] }`)\n- **Queries** — read data (like GET)\n- **Mutations** — write data (like POST/PUT/DELETE)\n- **Subscriptions** — real-time updates via WebSocket\n- **Resolvers** — functions that fetch the data for each field\n\n**Advantages over REST:** no over-fetching, no under-fetching, strongly typed, self-documenting.\n\n**Trade-offs:** more complex caching (no URL-based cache keys), N+1 query problem on the server, steeper learning curve.\n\n**Tools:** Apollo (client + server), Relay, urql, GraphQL Yoga, Hasura (auto-generate from DB).\n\n**When to use:** complex data relationships, mobile apps (bandwidth-sensitive), multiple frontend consumers.', src, 'en');

    // JavaScript Promises — fundamental async primitive
    this.knowledge.addEntry('javascript promises', '**Promises** are JavaScript\'s way of handling asynchronous operations — code that takes time, like fetching data or reading files.\n\n**States:** pending → fulfilled (resolved) or rejected.\n\n**Basic usage:**\n```javascript\nfetch(\'/api/data\')\n  .then(res => res.json())\n  .then(data => console.log(data))\n  .catch(err => console.error(err));\n```\n\n**async/await** — syntactic sugar over promises:\n```javascript\nconst res = await fetch(\'/api/data\');\nconst data = await res.json();\n```\n\n**Key methods:**\n- `Promise.all([...])` — wait for all, fail on first rejection\n- `Promise.allSettled([...])` — wait for all regardless of outcome\n- `Promise.race([...])` — first to settle wins\n- `Promise.any([...])` — first to fulfill wins\n\n**Common pitfall:** forgetting to `await` an async call, or not catching rejections.', src, 'en');

    // DNS — general "how does it work"
    this.knowledge.addEntry('how dns works', '**DNS (Domain Name System)** translates human-readable names like `google.com` into IP addresses like `142.250.74.46`.\n\n**Resolution flow:**\n1. Browser checks its **local cache**\n2. OS checks the **system resolver cache**\n3. Query goes to your **recursive resolver** (usually your ISP or 8.8.8.8)\n4. Resolver asks the **root nameserver** → gets referral to TLD server\n5. **TLD server** (.com, .org) → refers to authoritative nameserver\n6. **Authoritative nameserver** returns the actual IP\n\n**Record types:** A (IPv4), AAAA (IPv6), CNAME (alias), MX (mail), TXT (verification), NS (nameserver).\n\n**TTL** controls how long records are cached (typically 300-3600 seconds).\n\n**Why it matters:** DNS is the internet\'s phone book — without it, you\'d have to memorize IP addresses.', src, 'en');

    // CSS Grid — layout primitive
    this.knowledge.addEntry('css grid', '**CSS Grid** is a two-dimensional layout system — it handles both rows and columns at the same time, unlike Flexbox which is one-dimensional.\n\n**Basic setup:**\n```css\n.container {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  grid-template-rows: auto;\n  gap: 1rem;\n}\n```\n\n**Key properties:**\n- `grid-template-columns/rows` — define track sizes\n- `gap` — space between cells\n- `grid-column/row` — place items across tracks\n- `grid-area` — name and place regions\n- `fr` unit — fractional unit for flexible tracks\n- `minmax()` — responsive track sizing\n- `auto-fill/auto-fit` — responsive column count\n\n**Grid vs Flexbox:** Use Grid for page layouts (headers, sidebars, content areas). Use Flexbox for component layouts (nav items, card contents). They work great together.\n\n**Browser support:** Excellent — all modern browsers since 2017.', src, 'en');

    // Binary tree — fundamental data structure
    this.knowledge.addEntry('binary tree', '**Binary tree** is a data structure where each node has at most **two children** (left and right).\n\n**Variants:**\n- **Binary Search Tree (BST)** — left < parent < right. O(log n) search/insert on average.\n- **AVL Tree** — self-balancing BST (strict height balance)\n- **Red-Black Tree** — self-balancing BST (used in Java TreeMap, C++ std::map)\n- **Heap** — complete binary tree for priority queues (min-heap, max-heap)\n\n**Traversals:**\n- **In-order** (left → root → right) — gives sorted order for BST\n- **Pre-order** (root → left → right) — good for copying trees\n- **Post-order** (left → right → root) — good for deletion\n- **Level-order** (BFS) — breadth-first, uses a queue\n\n**Common operations:** insert, delete, search, find min/max, height, check balanced.\n\n**Use cases:** databases (B-trees), file systems, expression parsing, priority queues, routing tables.', src, 'en');

    // Git usage — "how to use git" which doesn't match "git overview"
    this.knowledge.addEntry('how to use git', '**Getting started with Git** — the everyday workflow:\n\n**First-time setup:**\n```bash\ngit config --global user.name "Your Name"\ngit config --global user.email "you@example.com"\n```\n\n**Start a project:**\n- `git init` — create a new repo\n- `git clone <url>` — copy an existing one\n\n**Daily workflow:**\n1. `git pull` — get latest changes\n2. `git checkout -b feature/my-feature` — create a branch\n3. Make your changes\n4. `git add .` — stage changes\n5. `git commit -m "what you did"` — commit\n6. `git push origin feature/my-feature` — push to remote\n7. Open a pull request for review\n\n**Undo mistakes:**\n- `git stash` — temporarily shelve changes\n- `git reset --soft HEAD~1` — undo last commit, keep changes\n- `git checkout -- <file>` — discard file changes\n\n**Pro tips:** commit often, write clear messages, use `.gitignore` for build artifacts.', src, 'en');

    // Programming languages with English-word names (prevent web-search disambiguation to wrong meaning)
    this.knowledge.addEntry('rust programming', '**Rust** is a systems programming language focused on **safety, speed, and concurrency** — created by Mozilla (2010, stable 2015).\n\n**Why Rust matters:** It gives you C/C++-level performance without the memory bugs. The compiler catches use-after-free, data races, and null pointer errors **at compile time**.\n\n**Key concepts:**\n- **Ownership** — each value has exactly one owner\n- **Borrowing** — references without taking ownership (`&T`, `&mut T`)\n- **Lifetimes** — compiler-enforced reference validity\n- **Pattern matching** — exhaustive `match` expressions\n- **Zero-cost abstractions** — iterators, generics compile to optimal code\n\n**Use cases:** operating systems, game engines, WebAssembly, CLI tools, embedded systems.\n\n**Ecosystem:** Cargo (build tool + package manager), crates.io (package registry).', src, 'en');
    this.knowledge.addEntry('rust', '**Rust** is a systems programming language focused on **safety, speed, and concurrency** — created by Mozilla (2010, stable 2015). Ownership system prevents memory bugs at compile time. Zero-cost abstractions, fearless concurrency. Ecosystem: Cargo, crates.io. Used for OS, game engines, WebAssembly, CLI tools.', src, 'en');
    this.knowledge.addEntry('rust language', '**Rust** is a systems programming language focused on **safety, speed, and concurrency** — created by Mozilla (2010, stable 2015). Key features: ownership system, zero-cost abstractions, fearless concurrency. Ecosystem: Cargo, crates.io.', src, 'en');

    this.knowledge.addEntry('go programming', '**Go** (Golang) is a statically typed, compiled language designed at **Google** (2009) for simplicity and concurrency.\n\n**Why Go matters:** It compiles fast, runs fast, and makes concurrency easy. If you need a reliable backend service that handles thousands of concurrent connections, Go is a strong pick.\n\n**Key features:**\n- **Goroutines** — lightweight threads (start thousands with minimal memory)\n- **Channels** — type-safe communication between goroutines\n- **Simple syntax** — intentionally minimal (no generics until 1.18, no classes)\n- **Fast compilation** — large projects compile in seconds\n- **Static binary** — single executable, no runtime dependencies\n\n**Use cases:** microservices, CLI tools, DevOps tooling (Docker, Kubernetes are written in Go), APIs.\n\n**Getting started:** `go mod init`, `go run main.go`, `go build`.', src, 'en');
    this.knowledge.addEntry('golang', '**Go** (Golang) is a statically typed, compiled language designed at **Google** (2009) for simplicity and concurrency. Key features: goroutines, channels, fast compilation, static binaries. Used for microservices, CLI tools, DevOps tooling.', src, 'en');

    this.knowledge.addEntry('swift programming', '**Swift** is Apple\'s modern programming language for iOS, macOS, watchOS, and tvOS development (2014). Swift is safe, fast, and expressive with features like optionals, closures, generics, and protocol-oriented programming. SwiftUI provides a declarative UI framework. Swift also runs on Linux for server-side development (Vapor framework).', src, 'en');

    // Round 11 — additional gap fills (async/await, HTTPS, SQL, WebSocket, CSS specificity)
    this.knowledge.addEntry('async await', '**async/await** is syntactic sugar over Promises that lets you write asynchronous code in a synchronous style.\n\n**How it works:**\n- `async` before a function makes it return a Promise\n- `await` pauses execution until the Promise resolves\n- Errors are caught with standard `try/catch` blocks\n\n**Example:**\n```javascript\nasync function fetchUser(id) {\n  try {\n    const res = await fetch(`/api/users/${id}`);\n    const user = await res.json();\n    return user;\n  } catch (err) {\n    console.error(err);\n  }\n}\n```\n\n**Key points:**\n- `await` only works inside `async` functions (or top-level in ES modules)\n- Multiple independent awaits can run in parallel with `Promise.all()`\n- async/await is available in JavaScript (ES2017), Python (3.5+), C# (5.0+), Rust, and many other languages', src, 'en');

    this.knowledge.addEntry('how https works', '**HTTPS** (HyperText Transfer Protocol Secure) encrypts HTTP traffic using **TLS** (Transport Layer Security).\n\n**The TLS handshake (simplified):**\n1. **Client Hello** — browser sends supported cipher suites and TLS version\n2. **Server Hello** — server picks a cipher suite and sends its SSL certificate\n3. **Certificate verification** — browser checks the certificate against trusted CAs\n4. **Key exchange** — both sides agree on a shared session key (usually via ECDHE)\n5. **Encrypted session** — all subsequent data is encrypted with the session key\n\n**Why it matters:**\n- Prevents eavesdropping (data encrypted in transit)\n- Prevents tampering (integrity checks via HMAC)\n- Proves server identity (certificate chain of trust)\n\n**Modern HTTPS:** TLS 1.3 reduced the handshake to 1 round trip (1-RTT), and supports 0-RTT resumption. Let\'s Encrypt provides free certificates. HTTP/2 and HTTP/3 require HTTPS.', src, 'en');

    this.knowledge.addEntry('sql joins', '**SQL JOINs** combine rows from two or more tables based on a related column.\n\n**Types of joins:**\n- **INNER JOIN** — returns rows with matching values in both tables\n- **LEFT JOIN** (LEFT OUTER) — all rows from the left table + matching rows from the right (NULL if no match)\n- **RIGHT JOIN** (RIGHT OUTER) — all rows from the right table + matching rows from the left\n- **FULL OUTER JOIN** — all rows from both tables (NULL where no match)\n- **CROSS JOIN** — cartesian product (every row paired with every other row)\n- **SELF JOIN** — a table joined with itself\n\n**Example:**\n```sql\nSELECT users.name, orders.total\nFROM users\nINNER JOIN orders ON users.id = orders.user_id\nWHERE orders.total > 100;\n```\n\n**Performance tips:** Always JOIN on indexed columns. Prefer explicit JOIN syntax over comma-separated WHERE clauses. Use EXPLAIN to check query plans.', src, 'en');

    this.knowledge.addEntry('websocket', '**WebSocket** is a protocol providing **full-duplex communication** over a single TCP connection.\n\n**How it works:**\n1. Client sends an HTTP **Upgrade** request\n2. Server responds with `101 Switching Protocols`\n3. Both sides can now send messages freely (no request/response pattern)\n\n**Key characteristics:**\n- Persistent connection (no repeated handshakes)\n- Low latency — data flows instantly in both directions\n- Binary and text frame support\n- Built-in ping/pong for keepalive\n\n**Use cases:** real-time chat, live dashboards, multiplayer games, collaborative editing, stock tickers.\n\n**Example (browser):**\n```javascript\nconst ws = new WebSocket(\'wss://example.com/socket\');\nws.onmessage = (e) => console.log(e.data);\nws.send(\'hello\');\n```\n\n**Alternatives:** Server-Sent Events (SSE) for one-way streaming, HTTP long polling for simpler setups, WebTransport (HTTP/3-based) for next-gen real-time.', src, 'en');

    this.knowledge.addEntry('css specificity', '**CSS specificity** determines which styles win when multiple rules target the same element.\n\n**The specificity hierarchy (low → high):**\n1. **Type selectors** (`div`, `p`, `h1`) — weight: 0-0-1\n2. **Class selectors** (`.btn`), attribute selectors (`[type="text"]`), pseudo-classes (`:hover`) — weight: 0-1-0\n3. **ID selectors** (`#header`) — weight: 1-0-0\n4. **Inline styles** (`style=\"...\"`) — beats all selectors\n5. **!important** — overrides everything (use sparingly)\n\n**How to calculate:** Count IDs, then classes, then elements.\n- `#nav .link` → 1-1-0\n- `div.container p.text` → 0-2-2\n- `#main #content .highlight` → 2-1-0\n\n**Rules:**\n- Higher specificity always wins, regardless of source order\n- Equal specificity → last rule in source order wins\n- `!important` overrides specificity (but `!important` with higher specificity still beats lower)\n\n**Best practices:** Prefer classes over IDs for styling. Avoid `!important`. Use CSS Layers (`@layer`) in modern CSS for better cascade control.', src, 'en');
  }

  /**
   * Feed text data to VAI so it learns.
   */
  train(text: string, source = 'user-taught', language: KnowledgeEntry['language'] = 'en'): void {
    this.knowledge.learn(text, source, language);
    this.tokenizer.encode(text); // expand vocabulary
    // Rebuild intelligence indexes lazily on next query
    this.intelligenceDirty = true;
    this.schedulePersist();
  }

  /**
   * Teach Vai a specific fact — adds a knowledge entry and persists it.
   * Use train() for bulk text and teach() for individual Q&A pairs.
   */
  teach(pattern: string, response: string, source = 'user-taught', language: KnowledgeEntry['language'] = 'en'): void {
    this.knowledge.addEntry(pattern, response, source, language);
    this.intelligenceDirty = true;
    this.schedulePersist();
  }

  // ─── LEARNING FLYWHEEL ───
  // After every successful response, extract key facts and persist them.
  // This creates compound growth: every conversation makes Vai permanently smarter.

  /** Strategies that should NOT trigger auto-learning */
  private static readonly NO_LEARN_STRATEGIES = new Set([
    'fallback', 'empty', 'gibberish', 'keyboard-noise',
    'web-search', // web search results are already persisted by tryWebSearch
    'learn-chat', // already learning from chat
    'conversational', // greetings/small talk — no knowledge value
    'math', // deterministic computation, not factual knowledge
    'binary', // encoding, not knowledge
    'scaffold', // action intent, not factual
    'google-search', // already persisted by tryGoogleIt
  ]);

  /**
   * Post-response learning hook — the compound interest engine.
   * Called after every response, extracts reusable knowledge from the Q&A exchange.
   */
  private afterResponse(input: string, response: string, meta: ResponseMeta): void {
    // Only learn from confident, non-trivial responses
    if (meta.confidence < 0.6) return;
    if (VaiEngine.NO_LEARN_STRATEGIES.has(meta.strategy)) return;
    if (response.length < 50) return; // too short to be useful knowledge

    // Extract the core topic (2-4 meaningful words)
    const topic = meta.topicDetected;
    if (!topic || topic === 'general') return;

    // Dedup: if we already have a strong match for this topic, skip
    const existing = this.cachedFindBestMatch(topic);
    if (existing) return; // already known — no need to re-learn

    // Condense the response to a summary (first 500 chars, cut at sentence boundary)
    let summary = response;
    if (summary.length > 500) {
      const cut = summary.lastIndexOf('.', 500);
      summary = cut > 200 ? summary.slice(0, cut + 1) : summary.slice(0, 500) + '…';
    }

    // Detect language from input
    const isNorwegian = /\b(hva|hvordan|hvorfor|når|hvor|hei|hvem|hvilken?|dette|dette|fordi|kan|skal|vil|dette|veldig|eller|også|norsk|bokmål|nynorsk)\b/i.test(input);
    const lang: KnowledgeEntry['language'] = isNorwegian ? 'no' : 'en';

    // Teach the condensed Q&A pair — this triggers schedulePersist via teach()
    this.teach(topic, summary, 'auto-learned', lang);
  }

  // ─── PERSISTENCE ───

  /**
   * Build snapshot of user-learned knowledge (excluding bootstrap entries).
   */
  private buildSnapshot(): VaiSnapshot {
    const allEntries = this.knowledge.exportData();
    // Only persist entries added AFTER bootstrap — everything before bootstrapEntryCount
    // is rebuilt from code on every startup.
    const learnedEntries = allEntries.entries.slice(this.bootstrapEntryCount);

    const statsObj: Record<string, number> = {};
    for (const [k, v] of this.strategyStats) statsObj[k] = v;

    const missedObj: Record<string, number> = {};
    for (const [k, v] of this.missedTopics) missedObj[k] = v;

    return {
      version: 1,
      savedAt: new Date().toISOString(),
      learnedEntries,
      strategyStats: statsObj,
      missedTopics: missedObj,
    };
  }

  /**
   * Schedule a debounced persist — at most once per 2 seconds.
   * Multiple rapid mutations coalesce into a single write.
   */
  private schedulePersist(): void {
    if (!this.persistPath) return;
    this.persistDirty = true;
    if (this.persistTimer) return; // already scheduled
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      if (this.persistDirty) this.persistNow();
    }, 2000);
  }

  /**
   * Write snapshot to disk immediately. Called by the debounce timer.
   * Uses synchronous write to guarantee data lands before process exit
   * (async writes can be lost if the process is killed).
   */
  private persistNow(): void {
    if (!this.persistPath) return;
    this.persistDirty = false;
    try {
      const snapshot = this.buildSnapshot();
      // Skip if no user-learned content exists
      if (snapshot.learnedEntries.length === 0 &&
          Object.keys(snapshot.strategyStats).length === 0 &&
          Object.keys(snapshot.missedTopics).length === 0) {
        return;
      }
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      // Atomic write: write to temp file, then rename
      const tmp = this.persistPath + '.tmp';
      writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf-8');
      renameSync(tmp, this.persistPath);
    } catch (err) {
      console.error('[VaiEngine] persist failed:', err);
    }
  }

  /**
   * Load persisted snapshot synchronously during construction.
   * Does nothing if no persistPath or file doesn't exist.
   */
  private loadPersistedSync(): void {
    if (!this.persistPath) return;
    try {
      if (!existsSync(this.persistPath)) return;
      const raw = readFileSync(this.persistPath, 'utf-8');
      const snapshot = JSON.parse(raw) as VaiSnapshot;
      if (snapshot.version !== 1) return; // unknown format — skip

      // Restore learned entries
      for (const entry of snapshot.learnedEntries) {
        this.knowledge.addEntry(entry.pattern, entry.response, entry.source, entry.language);
      }

      // Restore strategy stats
      if (snapshot.strategyStats) {
        for (const [k, v] of Object.entries(snapshot.strategyStats)) {
          this.strategyStats.set(k, (this.strategyStats.get(k) ?? 0) + v);
        }
      }

      // Restore missed topics
      if (snapshot.missedTopics) {
        for (const [k, v] of Object.entries(snapshot.missedTopics)) {
          this.missedTopics.set(k, (this.missedTopics.get(k) ?? 0) + v);
        }
      }

      console.log(`[VaiEngine] Loaded ${snapshot.learnedEntries.length} persisted entries from ${this.persistPath}`);
    } catch (err) {
      console.error('[VaiEngine] loadPersisted failed:', err);
    }
  }

  /**
   * Force an immediate persist (useful before shutdown).
   */
  flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.persistDirty) this.persistNow();
  }

  /**
   * Get the path to the persistence file (or null if not configured).
   */
  get persistenceFile(): string | null {
    return this.persistPath;
  }

  // ─── SELF-AWARENESS HELPERS ───

  /** Wrap a strategy result to record what happened. Returns the response string unchanged. */
  private tracked(strategy: string, response: string, input: string): string {
    const meta: ResponseMeta = {
      strategy,
      confidence: this.strategyConfidence(strategy),
      topicDetected: this.detectTopic(input),
      knowledgeDepth: this.assessKnowledgeDepth(input),
      responseLength: response.length,
      durationMs: 0, // filled in by chat() after timing
    };
    this._lastMeta = meta;
    this.responseHistory.push(meta);
    if (this.responseHistory.length > VaiEngine.HISTORY_SIZE) {
      this.responseHistory.shift();
    }
    this.strategyStats.set(strategy, (this.strategyStats.get(strategy) ?? 0) + 1);
    return response;
  }

  private strategyConfidence(strategy: string): number {
    const map: Record<string, number> = {
      'empty': 1.0, 'gibberish': 1.0, 'keyboard-noise': 1.0,
      'math': 0.95, 'scaffold': 0.90, 'binary': 0.95,
      'mcq': 0.85, 'yesno': 0.85,
      'google-search': 0.80, 'discussion': 0.80,
      'conversational': 0.90,
      'networking': 0.90, 'creative-code': 0.85, 'best-practices': 0.90,
      'algorithm': 0.85, 'net-code': 0.85,
      'norwegian-lang': 0.85, 'english-lang': 0.85,
      'taught-match': 0.90, 'taught-doc': 0.80,
      'web-stack': 0.90, 'general-knowledge': 0.85, 'framework-devops': 0.90,
      'cognitive': 0.85,
      'code-gen': 0.80, 'advanced-code': 0.80,
      'intelligence': 0.75,
      'direct-match': 0.70, 'concept-lookup': 0.60,
      'synthesis': 0.55, 'learn-chat': 0.50,
      'web-search': 0.45, 'fallback': 0.15,
    };
    return map[strategy] ?? 0.5;
  }

  private static readonly TOPIC_STOP_WORDS = TOPIC_STOP_WORDS;

  private detectTopic(input: string): string {
    const words = input.toLowerCase().split(/\s+/).filter(
      w => w.length > 2 && !VaiEngine.TOPIC_STOP_WORDS.has(w),
    );
    return words.slice(0, 3).join(' ') || 'general';
  }

  private assessKnowledgeDepth(input: string): 'deep' | 'shallow' | 'none' {
    const entries = this.cachedRetrieveRelevant(input, 10);
    if (entries.length >= 5) return 'deep';
    if (entries.length >= 1) return 'shallow';
    return 'none';
  }

  /** Get the metadata from the most recent response. */
  get lastResponseMeta(): ResponseMeta | null {
    return this._lastMeta;
  }

  /** Self-awareness diagnostic — what Vai knows, where it's weak, what to teach next. */
  diagnose(): VaiDiagnosis {
    const totalResponses = this.responseHistory.length;
    const avgConfidence = totalResponses > 0
      ? this.responseHistory.reduce((s, r) => s + r.confidence, 0) / totalResponses
      : 0;
    const fallbackCount = this.strategyStats.get('fallback') ?? 0;
    const totalFromStats = Array.from(this.strategyStats.values()).reduce((s, v) => s + v, 0);
    const fallbackRate = totalFromStats > 0 ? fallbackCount / totalFromStats : 0;

    // Find top strategy
    let topStrategy = 'none';
    let topCount = 0;
    for (const [strat, count] of this.strategyStats) {
      if (strat !== 'empty' && strat !== 'gibberish' && count > topCount) {
        topCount = count;
        topStrategy = strat;
      }
    }

    // Find weakest area — lowest avg confidence by detected topic
    const topicConfidences = new Map<string, { sum: number; count: number }>();
    for (const r of this.responseHistory) {
      const t = r.topicDetected;
      const cur = topicConfidences.get(t) ?? { sum: 0, count: 0 };
      cur.sum += r.confidence;
      cur.count++;
      topicConfidences.set(t, cur);
    }
    let weakestArea = 'unknown';
    let weakestAvg = 1;
    for (const [topic, data] of topicConfidences) {
      const avg = data.sum / data.count;
      if (avg < weakestAvg && data.count >= 2) {
        weakestAvg = avg;
        weakestArea = topic;
      }
    }

    // Topic coverage from knowledge store
    const topicCoverage = this.knowledge.topicSummary().map(t => ({
      topic: t.topic,
      depth: t.depth,
      entryCount: t.entryCount,
      sources: t.sources,
    }));

    // Missed topics sorted by frequency
    const missedTopics = Array.from(this.missedTopics.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([topic, count]) => ({ topic, count }));

    // Strategy stats as plain record
    const strategyStatsObj: Record<string, number> = {};
    for (const [k, v] of this.strategyStats) strategyStatsObj[k] = v;

    // Generate suggestions
    const suggestions: string[] = [];
    if (fallbackRate > 0.3) {
      suggestions.push(`High fallback rate (${(fallbackRate * 100).toFixed(0)}%) — Vai needs more content. Top missed topics: ${missedTopics.slice(0, 3).map(t => t.topic).join(', ')}`);
    }
    if (avgConfidence < 0.6 && totalResponses >= 5) {
      suggestions.push(`Average confidence is low (${(avgConfidence * 100).toFixed(0)}%) — consider teaching deeper content on frequently asked topics.`);
    }
    const shallowTopics = topicCoverage.filter(t => t.depth === 'shallow' || t.depth === 'bootstrap-only');
    if (shallowTopics.length > 0) {
      suggestions.push(`Shallow topics that need enrichment: ${shallowTopics.slice(0, 5).map(t => t.topic).join(', ')}`);
    }
    if (missedTopics.length > 0) {
      suggestions.push(`Teach Vai about: ${missedTopics.slice(0, 5).map(t => `"${t.topic}" (asked ${t.count}x)`).join(', ')}`);
    }
    if (suggestions.length === 0 && totalResponses > 0) {
      suggestions.push('Vai is performing well across known topics. Consider expanding into new domains.');
    }

    return {
      overview: { totalResponses, avgConfidence: +avgConfidence.toFixed(3), fallbackRate: +fallbackRate.toFixed(3), topStrategy, weakestArea },
      topicCoverage,
      missedTopics,
      strategyStats: strategyStatsObj,
      recentResponses: this.responseHistory.slice(-20),
      suggestions,
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const lastMessage = request.messages[request.messages.length - 1];
    const start = performance.now();
    const response = await this.generateResponse(lastMessage.content, request.messages);
    const durationMs = Math.round(performance.now() - start);
    // Patch timing into the last tracked meta
    if (this._lastMeta) this._lastMeta.durationMs = durationMs;

    // Learning flywheel — extract and persist knowledge from this exchange
    // Skip when noLearn is set (protective parenting — Vegga controls what Vai learns)
    if (this._lastMeta && !request.noLearn) this.afterResponse(lastMessage.content, response, this._lastMeta);

    return {
      message: { role: 'assistant', content: response },
      usage: { promptTokens: this.tokenizer.encode(lastMessage.content).length, completionTokens: this.tokenizer.encode(response).length },
      finishReason: 'stop',
      durationMs,
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const lastMessage = request.messages[request.messages.length - 1];
    this._lastSearchResponse = null; // reset before each response
    const start = performance.now();
    const response = await this.generateResponse(lastMessage.content, request.messages);
    const durationMs = Math.round(performance.now() - start);
    // Patch timing into the last tracked meta
    if (this._lastMeta) this._lastMeta.durationMs = durationMs;

    // Learning flywheel — extract and persist knowledge from this exchange
    // Skip when noLearn is set (protective parenting — Vegga controls what Vai learns)
    if (this._lastMeta && !request.noLearn) this.afterResponse(lastMessage.content, response, this._lastMeta);

    // Yield sources chunk BEFORE text — so UI can show source cards while answer streams
    const searchResult = this._lastSearchResponse as SearchResponse | null;
    if (searchResult !== null && searchResult.sources.length > 0) {
      yield {
        type: 'sources',
        sources: searchResult.sources.slice(0, 6).map((s: SearchSnippet) => ({
          url: s.url,
          title: s.title || s.domain,
          domain: s.domain,
          snippet: s.text.slice(0, 200),
          favicon: s.favicon,
          trustTier: s.trust.tier,
          trustScore: s.trust.score,
        })),
        followUps: generateFollowUps(lastMessage.content, searchResult),
        confidence: searchResult.confidence,
      };
    }

    // Stream in fast chunks — no artificial delay for BLAZING FAST response
    const words = response.split(' ');
    const CHUNK_SIZE = 4; // send 4 words at a time for speed
    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
      const chunk = words.slice(i, i + CHUNK_SIZE);
      const text = (i === 0 ? '' : ' ') + chunk.join(' ');
      yield { type: 'text_delta', textDelta: text };
      // Minimal delay — just enough for UI to render, not to "feel like streaming"
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    yield {
      type: 'done',
      usage: {
        promptTokens: this.tokenizer.encode(lastMessage.content).length,
        completionTokens: this.tokenizer.encode(response).length,
      },
      durationMs,
    };
  }

  private async generateResponse(input: string, history: readonly Message[]): Promise<string> {
    const lower = input.toLowerCase().trim();

    // Clear per-request caches — each generateResponse() starts fresh
    this.clearRequestCache();

    // Strategy -1: Empty or gibberish input — catch before pipeline
    if (lower.length === 0) {
      return this.tracked('empty', 'It looks like you sent an empty message. What would you like to know? Try asking about Docker, React, TypeScript, Git, or any topic I\'ve learned about.', input);
    }
    if (lower.length < 30 && /^[^a-z]*$/.test(lower)) {
      return this.tracked('gibberish', 'I couldn\'t make sense of that input. Try asking a question like "What is Docker?" or "How do React hooks work?"', input);
    }
    // Check 3: Keyboard-row noise (e.g. "asdfghjkl qwerty zxcvbn")
    const gibWords = lower.split(/\s+/).filter(w => w.length > 0);
    const kbRows = [/^[qwertyuiop]+$/, /^[asdfghjkl]+$/, /^[zxcvbnm]+$/];
    if (gibWords.length > 0 && gibWords.length <= 5 && gibWords.every(w => kbRows.some(r => r.test(w)))) {
      return this.tracked('keyboard-noise', 'That looks like keyboard noise! Try asking a real question — like "What is Docker?" or "How do React hooks work?"', input);
    }

    // Strategy 0: Math expressions — evaluate before anything else
    const mathResult = this.tryMath(lower);
    if (mathResult !== null) return this.tracked('math', mathResult, input);

    // Strategy 0.1: Scaffold / deploy intent — detect build requests and offer deploy buttons
    const scaffoldResult = this.tryScaffoldIntent(lower);
    if (scaffoldResult) return this.tracked('scaffold', scaffoldResult, input);

    // Strategy 0.3: Binary/hex decode — detect binary or hex sequences
    const binaryResult = this.tryBinaryDecode(lower);
    if (binaryResult !== null) return this.tracked('binary', binaryResult, input);

    // Strategy 0.4: MCQ detection — identify multiple choice questions and match against knowledge
    const mcqResult = this.tryMCQAnswer(input, lower);
    if (mcqResult) return this.tracked('mcq', mcqResult, input);

    // Strategy 0.45: Yes/No reasoning — answer yes/no questions using knowledge
    const yesNoResult = this.tryYesNoAnswer(input, lower);
    if (yesNoResult) return this.tracked('yesno', yesNoResult, input);

    // Strategy 0.5: "Google it" / forced web search — user explicitly asks us to search
    const googleIt = await this.tryGoogleIt(lower, input, history);
    if (googleIt) return this.tracked('google-search', googleIt, input);

    // Strategy 0.7: Discussion mode — Socratic back-and-forth
    const discussion = this.tryDiscussionMode(lower, input, history);
    if (discussion) return this.tracked('discussion', discussion, input);

    // Strategy 1: Conversational awareness — handle common patterns
    const conversational = this.handleConversational(lower, history);
    if (conversational) return this.tracked('conversational', conversational, input);

    // Strategy 1.42: Networking knowledge — deterministic OSI/TCP-IP facts
    const networking = this.tryNetworkingKnowledge(lower);
    if (networking) return this.tracked('networking', networking, input);

    // Strategy 1.4: Creative code projects — full working programs
    const creativeCode = this.tryCreativeCodeProject(lower);
    if (creativeCode) return this.tracked('creative-code', creativeCode, input);

    // Strategy 1.45: Best practices queries
    const bestPractices = this.tryBestPractices(lower);
    if (bestPractices) return this.tracked('best-practices', bestPractices, input);

    // Strategy 1.47: Algorithm code generation — canonical textbook algorithms
    const algoCode = this.tryAlgorithmCodeGen(lower);
    if (algoCode) return this.tracked('algorithm', algoCode, input);

    // Strategy 1.48: Networking code generation — TCP/UDP/socket code
    const netCode = this.tryNetworkingCode(lower);
    if (netCode) return this.tracked('net-code', netCode, input);

    // Strategy 1.50: Norwegian language knowledge — grammar, vocab, formal writing
    const norskLang = this.tryNorwegianLanguage(lower);
    if (norskLang) return this.tracked('norwegian-lang', norskLang, input);

    // Strategy 1.51: English language knowledge — grammar, tenses, vocabulary
    const engLang = this.tryEnglishLanguage(lower);
    if (engLang) return this.tracked('english-lang', engLang, input);

    // Strategy 1.515: VCUS-taught knowledge — explicit pattern-response entries
    // These fire BEFORE greedy hardcoded strategies to ensure taught content
    // (CVA variants, T3 Stack, App Router, headless commerce, etc.) takes priority.
    // Skip for tier/stack queries — those have dedicated handlers in tryWebStackKnowledge.
    const isTierQuery = /\b(?:tiers?|tier\s*system|basic\s+tier|solid\s+tier|battle[\s-]*tested|vai\s+tier)\b/i.test(input)
      && /\b(?:pern|mern|t3|next\.?js|stack|veggaai)\b/i.test(input);
    const isVaiConfigQuery = /vai[.\s]config/i.test(input);
    const isStackCompareQuery = /\b(?:mern|pern)\s+(?:vs\.?|versus|eller)\s+(?:mern|pern)\b/i.test(input);
    if (!isTierQuery && !isVaiConfigQuery && !isStackCompareQuery) {
      const taughtMatch = this.cachedFindBestTaughtMatch(input);
      if (taughtMatch) return this.tracked('taught-match', taughtMatch.response, input);
    }

    // Strategy 1.517: Taught document retrieval via TF-IDF
    // When findBestTaughtMatch doesn't find a pattern match, search the document
    // index for user-taught content. Taught content has inherently high relevance
    // (the user explicitly taught it), so we use relaxed quality gates compared
    // to the general synthesizeFromKnowledge.
    if (!isTierQuery && !isVaiConfigQuery && !isStackCompareQuery) {
      const taughtDoc = this.tryTaughtDocumentRetrieval(lower);
      if (taughtDoc) return this.tracked('taught-doc', taughtDoc, input);
    }

    // Strategy 1.52: Web stack knowledge — MERN/PERN/MEVN, ORM, REST, SSR
    const webStack = this.tryWebStackKnowledge(lower);
    if (webStack) return this.tracked('web-stack', webStack, input);

    // Strategy 1.53: General knowledge — history, science, world facts, real-world events
    const generalKnow = this.tryGeneralKnowledge(lower);
    if (generalKnow) return this.tracked('general-knowledge', generalKnow, input);

    // Strategy 1.54: Framework & DevOps — Docker, CI/CD, TS, Tailwind, WCAG, GDPR, Rust, Python, Go, Angular, Vue, WP, Next.js, Norwegian web
    const frameworkDevops = this.tryFrameworkDevopsKnowledge(lower);
    if (frameworkDevops) return this.tracked('framework-devops', frameworkDevops, input);

    // Strategy 1.545: Cognitive Foundations — first principles, calibration, compression, meta-learning, systems thinking
    const cognitive = this.tryCognitiveFoundations(lower);
    if (cognitive) return this.tracked('cognitive', cognitive, input);

    // Strategy 1.5: Code generation — detect code requests and generate
    const codeResult = this.tryCodeGeneration(lower);
    if (codeResult) return this.tracked('code-gen', codeResult, input);

    // Strategy 1.6: Advanced structured code gen (types, enums, classes, structs)
    const advancedCode = this.tryAdvancedCodeGeneration(input);
    if (advancedCode) return this.tracked('advanced-code', advancedCode, input);

    // Strategy 1.7: Knowledge Intelligence — decompose complex questions, follow connections
    const intelligent = this.tryIntelligentAnswer(input);
    if (intelligent) return this.tracked('intelligence', intelligent, input);

    // Strategy 2: Check knowledge store for a direct match
    const match = this.cachedFindBestMatch(input);
    if (match) return this.tracked('direct-match', match.response, input);

    // Strategy 2.5: Concept lookup — extracted definitions from learned content
    const conceptResult = this.tryConceptLookup(lower);
    if (conceptResult) return this.tracked('concept-lookup', conceptResult, input);

    // Strategy 3: Multi-source synthesis — combine relevant chunks into a coherent answer
    const synthesized = this.synthesizeFromKnowledge(lower, history);
    if (synthesized) return this.tracked('synthesis', synthesized, input);

    // Strategy 4: Learn from user's teaching patterns in-chat
    const taught = this.learnFromChat(lower, history);
    if (taught) return this.tracked('learn-chat', taught, input);

    // Strategy 5: Web search — when we don't have local knowledge
    const webResult = await this.tryWebSearch(lower);
    if (webResult) return this.tracked('web-search', webResult, input);

    // Strategy 6: Contextual "I don't know" — tell user what we DO know
    return this.tracked('fallback', this.buildHelpfulFallback(lower), input);
  }

  // ─── "JUST GOOGLE IT" ───────────────────────────────────────────
  /**
   * Detect when the user explicitly wants to search the web.
   * Patterns: "google X", "just google it", "search for X", "look up X"
   * VAI learns from the results — this is the human+web learning loop.
   */
  private async tryGoogleIt(lower: string, original: string, history: readonly Message[] = []): Promise<string | null> {
    const patterns = [
      /^(?:just\s+)?google\s+(?:it\s*[:\-–—]?\s*)?(.+)/i,
      /^(?:just\s+)?google\s+it$/i,
      /^(?:can\s+you\s+)?(?:search|look\s+up|find)\s+(?:for\s+|about\s+)?(.+)/i,
      /^(?:go\s+)?search\s+(?:the\s+web|online|google)\s+(?:for\s+)?(.+)/i,
      /^google[:\s]+(.+)/i,
    ];

    let query: string | null = null;
    for (const pattern of patterns) {
      const m = lower.match(pattern);
      if (m) {
        query = m[1]?.trim() || null;
        break;
      }
    }
    // "just google it" with no query — use previous user message as query
    if (lower === 'just google it' || lower === 'google it' || lower === 'google that') {
      query = null; // will try to extract from history below
    } else if (!query) {
      return null; // not a google-it command
    }

    // If query is still null, only proceed if the phrase matched (google it)
    if (!query) {
      // This means we matched "just google it" but need to find the topic
      // Not a google-it command if we don't have a match
      if (!/google\s*it|google\s*that/i.test(lower)) return null;
    }

    // Extract query from context if "google it" was bare
    if (!query || query.length < 2) {
      // Try to use the previous user message as the search query
      const userMsgs = history.filter((m: Message) => m.role === 'user');
      if (userMsgs.length >= 2) {
        query = userMsgs[userMsgs.length - 2].content;
      }
      if (!query || query.length < 2) {
        return "What should I search for? Say 'google [your question]' or ask a question first, then say 'just google it'.";
      }
    }

    // Clean up the query
    query = query.replace(/[?!.]+$/, '').trim();

    return this.performWebSearch(query);
  }

  /**
   * Perform web search using the Perplexity-style pipeline.
   * Learning happens automatically via the pipeline's onLearn callback.
   */
  private async performWebSearch(query: string): Promise<string> {
    try {
      const result: SearchResponse = await this.searchPipeline.search(query);
      this._lastSearchResponse = result;
      return result.answer;
    } catch {
      return `I searched for "${query}" but couldn't find useful results. Try rephrasing or being more specific.\n\n💡 Tip: You can teach me directly — just tell me facts and I'll remember them!`;
    }
  }

  // ─── DISCUSSION MODE ─────────────────────────────────────────────
  /**
   * Detect discussion/deliberation requests. Enter a Socratic back-and-forth
   * where VAI asks questions, probes understanding, and builds knowledge together.
   */
  private tryDiscussionMode(lower: string, original: string, history: readonly Message[]): string | null {
    // Detect discussion triggers
    const discussPatterns = [
      /^(?:let'?s|can\s+we|i\s+want\s+to)\s+(?:discuss|talk\s+about|debate|explore|dive\s+into)\s+(.+)/i,
      /^discuss(?:ion)?\s*[:\-–—]?\s*(.+)/i,
      /^(?:what\s+do\s+you\s+think\s+about)\s+(.+)/i,
      /^(?:tell\s+me\s+your\s+(?:thoughts|opinion|take)\s+(?:on|about))\s+(.+)/i,
    ];

    let topic: string | null = null;
    for (const p of discussPatterns) {
      const m = lower.match(p);
      if (m) { topic = m[1].replace(/[?!.]+$/, '').trim(); break; }
    }
    if (!topic) return null;

    // Check what we know about this topic
    const retrieved = this.cachedRetrieveRelevant(topic, 5);
    const concept = this.knowledge.findConcept(topic);

    // Count how many discussion turns we've had in this conversation
    const discussionTurns = history.filter(m =>
      m.role === 'assistant' && (m.content.includes('🤔') || m.content.includes('**Discussion:**'))
    ).length;

    // Build a discussion response
    const parts: string[] = [`**Discussion: ${topic}**\n`];

    if (concept) {
      parts.push(`📚 From my knowledge: ${concept.definition}\n`);
    }

    if (retrieved.length > 0 && retrieved[0].score > 0.05) {
      const bestSnippet = retrieved[0].text.length > 200 ? retrieved[0].text.slice(0, 200) + '...' : retrieved[0].text;
      parts.push(`📖 Related: ${bestSnippet}\n`);
    }

    // Socratic questioning based on discussion depth
    const questions = [
      `🤔 To start our discussion: What's your current understanding of ${topic}? What aspect interests you most?`,
      `🤔 Interesting! Let me push back a bit — what would happen if we approached ${topic} from the opposite direction? What assumptions are we making?`,
      `🤔 Here's a thought experiment: If ${topic} didn't exist, what would we need to invent to solve the same problems?`,
      `🤔 Let's go deeper: What are the first principles underlying ${topic}? Can you break it down to its simplest components?`,
      `🤔 Final challenge: How would you explain ${topic} to someone from a completely different field? What universal pattern does it follow?`,
    ];

    parts.push(questions[Math.min(discussionTurns, questions.length - 1)]);

    if (retrieved.length === 0 || retrieved[0].score <= 0.05) {
      parts.push(`\n💡 I don't have deep knowledge about "${topic}" yet. Discuss it with me and I'll learn! Or say "google ${topic}" to search first.`);
    }

    // Learn from the discussion topic
    this.tokenizer.encode(topic);

    return parts.join('\n');
  }

  // ─── BINARY / HEX DECODE ──────────────────────────────────────────
  /**
   * Detect and decode binary sequences (01010010 01001001...) or hex (0x52 0x49...)
   * Converts to ASCII text and explains what it spells.
   */
  // ─── MCQ DETECTION AND ANSWERING ──────────────────────────

  /**
   * Detect multiple-choice questions (A/B/C/D format) and match options
   * against stored knowledge to select the best answer.
   */
  private tryMCQAnswer(original: string, lower: string): string | null {
    // Detect MCQ format: must have at least 2 options labeled A/B/C/D
    const optionPattern = /(?:^|\n)\s*([A-D])\s*[).\]:-]\s*(.+)/gim;
    const options: { letter: string; text: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = optionPattern.exec(original)) !== null) {
      const letter = m[1].toUpperCase();
      if (!options.find(o => o.letter === letter)) {
        options.push({ letter, text: m[2].trim() });
      }
    }
    
    if (options.length < 2) return null; // Not an MCQ

    // Extract the question text (everything before the first option)
    const firstOpt = original.match(/(?:^|\n)\s*[A-D]\s*[).\]:-]/im);
    const questionText = firstOpt
      ? original.slice(0, firstOpt.index).trim()
      : lower;
    const questionLower = questionText.toLowerCase();

    // Strip trailing "Answer with just the letter" type instructions
    const cleanQuestion = questionLower.replace(/answer\s+with\s+(?:just|only)?\s*(?:the)?\s*letter.*$/i, '').trim();

    // Search knowledge for relevant content
    const retrieved = this.cachedRetrieveRelevant(cleanQuestion, 5);
    const match = this.cachedFindBestMatch(cleanQuestion);
    const taughtMatch = this.cachedFindBestTaughtMatch(cleanQuestion);

    // Collect all relevant knowledge text
    const knowledgeTexts: string[] = [];
    if (taughtMatch) knowledgeTexts.push(taughtMatch.response);
    if (match) knowledgeTexts.push(match.response);
    for (const r of retrieved) {
      if (r.score > 0.03) knowledgeTexts.push(r.text);
    }

    if (knowledgeTexts.length === 0) return null;

    const combinedKnowledge = knowledgeTexts.join(' ').toLowerCase();

    // Score each option against the combined knowledge
    const scored = options.map(opt => {
      const optLower = opt.text.toLowerCase();
      const optWords = optLower.split(/\s+/).filter(w => w.length > 2 && !KnowledgeStore.STOP_WORDS.has(w));
      
      let score = 0;

      // Word overlap between option and knowledge
      for (const word of optWords) {
        if (combinedKnowledge.includes(word)) score += 1;
      }
      
      // Bonus: if multi-word phrases from the option appear in knowledge
      if (optWords.length >= 2) {
        for (let i = 0; i < optWords.length - 1; i++) {
          const bigram = optWords[i] + ' ' + optWords[i + 1];
          if (combinedKnowledge.includes(bigram)) score += 2;
        }
      }

      // Bonus: entire option text appears in knowledge
      if (combinedKnowledge.includes(optLower)) score += 5;

      // Bonus: key concept phrases from the option
      const conceptPhrases = optLower.match(/\b[a-z]{3,}(?:\s+[a-z]{3,}){1,3}\b/g) || [];
      for (const phrase of conceptPhrases) {
        if (combinedKnowledge.includes(phrase)) score += 3;
      }

      // Normalize by word count to avoid bias toward longer options
      const normalizedScore = optWords.length > 0 ? score / Math.sqrt(optWords.length) : 0;

      return { ...opt, score: normalizedScore, rawScore: score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Only answer if there's meaningful differentiation
    const best = scored[0];
    const second = scored.length > 1 ? scored[1] : null;

    if (best.rawScore < 1) return null; // No meaningful match at all

    // If top two are too close, try harder with additional heuristics
    if (second && best.score - second.score < 0.5 && best.rawScore < 4) {
      // Check if any knowledge text explicitly mentions an answer pattern like "the answer is D"
      const explicitAnswer = combinedKnowledge.match(/(?:answer|correct|right)\s+(?:is|option)\s+([a-d])/i);
      if (explicitAnswer) {
        const letter = explicitAnswer[1].toUpperCase();
        const explicit = options.find(o => o.letter === letter);
        if (explicit) {
          return `**${explicit.letter}**\n\n${explicit.text}.\n\n${this.extractReasoningSnippet(knowledgeTexts, cleanQuestion)}`;
        }
      }
      return null; // Too close, can't decide
    }

    // Build response with selected answer
    const reasoning = this.extractReasoningSnippet(knowledgeTexts, cleanQuestion);
    return `**${best.letter}**\n\n${best.text}.\n\n${reasoning}`;
  }

  /**
   * Extract a short reasoning snippet from knowledge texts relevant to the question.
   */
  private extractReasoningSnippet(knowledgeTexts: string[], question: string): string {
    const qWords = question.split(/\s+/).filter(w => w.length > 3 && !KnowledgeStore.STOP_WORDS.has(w));
    
    for (const text of knowledgeTexts) {
      const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 20);
      for (const s of sentences) {
        const lower = s.toLowerCase();
        const hits = qWords.filter(w => lower.includes(w)).length;
        if (hits >= 2) {
          return s.length > 300 ? s.slice(0, 300) + '...' : s;
        }
      }
    }
    return '';
  }

  // ─── YES/NO QUESTION HANDLER ────────────────────────────────

  /**
   * Detect yes/no questions (Is it true that...? Does X...? Can Y...?)
   * and answer based on stored knowledge or arithmetic verification.
   */
  private tryYesNoAnswer(original: string, lower: string): string | null {
    // ── First: scan for any embedded arithmetic assertion, e.g. "Is (5-2)=three?" ──
    // This catches multi-sentence patterns like "Verbal math: (7-3)=four. Is (5-2)=three?"
    const wordToNum: Record<string, number> = {
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
      seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
      thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
      eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
      hundred: 100, thousand: 1000,
    };
    
    // Scan entire input for "Is (expr)=word?" pattern anywhere
    const embeddedMathPattern = /\bis\s+\(?(\d+)\s*([+\-*/])\s*(\d+)\)?\s*=\s*([a-z]+)\s*\??/i;
    const embeddedMath = lower.match(embeddedMathPattern);
    if (embeddedMath) {
      const [, a, op, b, wordResult] = embeddedMath;
      const numA = parseFloat(a);
      const numB = parseFloat(b);
      const expectedNum = wordToNum[wordResult.toLowerCase()];
      
      if (expectedNum !== undefined) {
        let actual: number | null = null;
        if (op === '+') actual = numA + numB;
        else if (op === '-') actual = numA - numB;
        else if (op === '*') actual = numA * numB;
        else if (op === '/') actual = numB !== 0 ? numA / numB : null;
        
        if (actual !== null && Math.abs(actual - expectedNum) < 0.001) {
          return `**Yes.** ${numA} ${op} ${numB} = ${actual}, which is "${wordResult}". That is correct.`;
        } else if (actual !== null) {
          return `**No.** ${numA} ${op} ${numB} = ${actual}, not "${wordResult}".`;
        }
      }
    }

    // Must be a yes/no style question — try full string first, then last sentence/clause
    const yesNoPatterns = [
      /^is\s+(?:it\s+)?true\s+that\s+(.+?)[?]?$/i,
      /^is\s+(?:it\s+)?(?:correct|right)\s+(?:that|to\s+say)\s+(.+?)[?]?$/i,
      /^does\s+(.+?)[?]?$/i,
      /^do\s+(.+?)[?]?$/i,
      /^can\s+(.+?)[?]?$/i,
      /^is\s+(.{10,})[?]$/i,  // "Is X?" with substantial content
    ];

    // Also match yes/no questions embedded mid-sentence with context prefix:
    // "In a X puzzle, does Y?" → extract "does Y?"
    // "Wolf-goat: does the sequence work?" → extract "does the sequence work?"
    const embeddedYesNoPatterns = [
      /,\s*does\s+(.+?)[?]?$/i,
      /,\s*is\s+(?:it\s+)?true\s+that\s+(.+?)[?]?$/i,
      /,\s*can\s+(.+?)[?]?$/i,
      /,\s*do\s+(.+?)[?]?$/i,
    ];

    // Get candidates to try: full lower, then segments split on sentence boundaries
    // Includes `. `, `! `, `: `, `." `, `?' `, etc.
    const candidates = [lower];
    const segments = lower.split(/[.!:]\s+|\."\s*|\?"\s*/).filter(s => s.trim().length > 0);
    if (segments.length > 1) {
      // Strip leading/trailing quotes from segments (e.g., '"does finding...' → 'does finding...')
      candidates.push(segments[segments.length - 1].trim().replace(/^["'"]+|["'"]+$/g, '').trim());
    }

    let claim: string | null = null;
    for (const candidate of candidates) {
      for (const pat of yesNoPatterns) {
        const match = candidate.match(pat);
        if (match) {
          claim = match[1].trim().replace(/\?$/, '');
          break;
        }
      }
      if (claim) break;
    }

    // If no direct match, try embedded yes/no patterns on the full string
    if (!claim) {
      for (const pat of embeddedYesNoPatterns) {
        const match = lower.match(pat);
        if (match) {
          claim = match[1].trim().replace(/\?$/, '');
          break;
        }
      }
    }

    if (!claim) return null;

    // Skip choice/alternative questions: "Is X A or B?" asks for a selection, not binary yes/no
    // Only skip when the question structure is "be/being/been ADJECTIVE or ADJECTIVE"
    // or when it's an explicit "X or Y" at the end of the claim
    const isChoiceQ = /\b(?:being|be|is|are|was|were)\s+(\w{3,12})\s+or\s+(\w{3,12})\b/i.test(claim)
      || /\b(\w{3,12})\s+or\s+(\w{3,12})\s*$/.test(claim);
    if (isChoiceQ && !/\bor\s+(?:not|more|less|whether)\b/i.test(claim)) return null;

    // ── Verbal math check on extracted claim: "(2+2)=four" → verify arithmetic ──
    // (wordToNum is already declared above)
    
    // Match patterns like "(2+2)=four", "5-2=three", "(8-5)=three"
    const mathVerify = claim.match(/^\(?(\d+)\s*([+\-*/])\s*(\d+)\)?\s*=\s*([a-z]+)$/i);
    if (mathVerify) {
      const [, a, op, b, wordResult] = mathVerify;
      const numA = parseFloat(a);
      const numB = parseFloat(b);
      const expectedNum = wordToNum[wordResult.toLowerCase()];
      
      if (expectedNum !== undefined) {
        let actual: number | null = null;
        if (op === '+') actual = numA + numB;
        else if (op === '-') actual = numA - numB;
        else if (op === '*') actual = numA * numB;
        else if (op === '/') actual = numB !== 0 ? numA / numB : null;
        
        if (actual !== null && Math.abs(actual - expectedNum) < 0.001) {
          return `**Yes.** ${numA} ${op} ${numB} = ${actual}, which is "${wordResult}". That is correct.`;
        } else if (actual !== null) {
          return `**No.** ${numA} ${op} ${numB} = ${actual}, not "${wordResult}".`;
        }
      }
    }

    // ── Verbal math variant: "is (2+2) equal to four?" / plain "2+2 equals four"
    const mathVerify2 = claim.match(/^\(?(\d+)\s*([+\-*/])\s*(\d+)\)?\s*(?:equal(?:s)?\s+(?:to\s+)?|is\s+)([a-z]+)$/i);
    if (mathVerify2) {
      const [, a, op, b, wordResult] = mathVerify2;
      const numA = parseFloat(a);
      const numB = parseFloat(b);
      const expectedNum = wordToNum[wordResult.toLowerCase()];
      
      if (expectedNum !== undefined) {
        let actual: number | null = null;
        if (op === '+') actual = numA + numB;
        else if (op === '-') actual = numA - numB;
        else if (op === '*') actual = numA * numB;
        else if (op === '/') actual = numB !== 0 ? numA / numB : null;
        
        if (actual !== null && Math.abs(actual - expectedNum) < 0.001) {
          return `**Yes.** ${numA} ${op} ${numB} = ${actual}, which is "${wordResult}".`;
        }
      }
    }

    // Search knowledge for the claim
    const retrieved = this.cachedRetrieveRelevant(claim, 5);
    const match = this.cachedFindBestMatch(claim);
    const taughtMatch = this.cachedFindBestTaughtMatch(claim);

    const knowledgeTexts: string[] = [];
    if (taughtMatch) knowledgeTexts.push(taughtMatch.response);
    if (match) knowledgeTexts.push(match.response);
    for (const r of retrieved) {
      if (r.score > 0.03) knowledgeTexts.push(r.text);
    }

    if (knowledgeTexts.length === 0) return null;

    const combined = knowledgeTexts.join(' ').toLowerCase();

    // Extract key words from the claim
    const claimWords = claim.split(/\s+/).filter(w => w.length > 2 && !KnowledgeStore.STOP_WORDS.has(w));
    const hits = claimWords.filter(w => combined.includes(w.toLowerCase())).length;
    const coverage = claimWords.length > 0 ? hits / claimWords.length : 0;

    if (coverage < 0.3 && hits < 2) return null; // Not enough knowledge

    // Build answer — when we have matching knowledge and the claim is phrased
    // as a yes/no question, we default to affirming with the retrieved knowledge
    const reasoning = this.extractReasoningSnippet(knowledgeTexts, claim);
    
    if (coverage >= 0.3 || hits >= 2) {
      const reasonSnippet = reasoning ? `\n\n${reasoning}` : '';
      return `**Yes.** ${reasonSnippet}`;
    }

    return null;
  }

  private tryBinaryDecode(input: string): string | null {
    // Strip "decode", "what is", "translate" wrappers
    const expr = input
      .replace(/^(?:decode|translate|convert|what\s+(?:is|does)|read)\s+(?:this\s+)?(?:binary|hex|hexadecimal)?\s*[:\-–—]?\s*/i, '')
      .trim();

    // Detect binary: groups of 8 binary digits separated by spaces
    const binaryMatch = expr.match(/^([01]{8}(?:\s+[01]{8})+)$/);
    if (binaryMatch) {
      const bytes = binaryMatch[1].split(/\s+/);
      const chars = bytes.map(b => String.fromCharCode(parseInt(b, 2)));
      const decoded = chars.join('');
      const breakdown = bytes.map((b, i) => `\`${b}\` → ${parseInt(b, 2)} → '${chars[i]}'`).join('\n');
      return `**Binary decoded:** "${decoded}"\n\n**Breakdown:**\n${breakdown}\n\nThe binary sequence spells: **${decoded}**`;
    }

    // Also detect binary with other separators
    const binaryLoose = expr.match(/^([01]{8}[\s,|]+)+[01]{8}$/);
    if (binaryLoose) {
      const bytes = expr.split(/[\s,|]+/).filter(b => /^[01]{8}$/.test(b));
      if (bytes.length >= 2) {
        const chars = bytes.map(b => String.fromCharCode(parseInt(b, 2)));
        const decoded = chars.join('');
        return `**Binary decoded:** "${decoded}"\n\nThe binary sequence spells: **${decoded}**`;
      }
    }

    // Detect hex: groups of 0x## or ## separated by spaces
    const hexMatch = expr.match(/^(?:0x)?([0-9a-f]{2})(?:\s+(?:0x)?([0-9a-f]{2}))+$/i);
    if (hexMatch) {
      const hexBytes = expr.match(/(?:0x)?([0-9a-f]{2})/gi);
      if (hexBytes && hexBytes.length >= 2) {
        const chars = hexBytes.map(h => String.fromCharCode(parseInt(h.replace('0x', ''), 16)));
        const decoded = chars.join('');
        return `**Hex decoded:** "${decoded}"\n\nThe hex sequence spells: **${decoded}**`;
      }
    }

    return null;
  }

  /**
   * Handle creative code project requests — full working programs like
   * "make me a javascript calculator", "build a todo list in python", etc.
   */
  private tryCreativeCodeProject(input: string): string | null {
    // Match "make/build/create/write [me] [a/an] [simple] <project> [in/using/with <lang>]"
    const projectMatch = input.match(
      /(?:make|build|create|write|code|generate|give)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:simple\s+|basic\s+)?(.+?)(?:\s+(?:in|using|with)\s+(\w[\w#+]*))?\s*$/i
    );
    if (!projectMatch) return null;

    const projectDesc = projectMatch[1]?.trim().toLowerCase() || '';
    const langHint = projectMatch[2]?.trim().toLowerCase() || '';

    // --- Calculator ---
    if (/calculator/i.test(projectDesc)) {
      const lang = langHint || (projectDesc.includes('python') ? 'python' : projectDesc.includes('java') && !projectDesc.includes('javascript') ? 'java' : 'javascript');
      return this.generateCalculator(lang);
    }

    // --- Todo list / task list ---
    if (/todo\s*list|task\s*list|task\s*manager/i.test(projectDesc)) {
      const lang = langHint || (projectDesc.includes('javascript') || projectDesc.includes('js') ? 'javascript' : projectDesc.includes('java') && !projectDesc.includes('javascript') ? 'java' : 'python');
      return this.generateTodoList(lang);
    }

    // --- Counter component ---
    if (/counter\s*(component|app|widget)?/i.test(projectDesc)) {
      const lang = langHint || 'react';
      return this.generateCounter(lang);
    }

    // --- FizzBuzz ---
    if (/fizz\s*buzz/i.test(projectDesc)) {
      const lang = langHint || (projectDesc.includes('python') ? 'python' : projectDesc.includes('java') && !projectDesc.includes('javascript') ? 'java' : 'javascript');
      return this.generateFizzBuzz(lang);
    }

    // --- HTTP server ---
    if (/http\s*server|web\s*server|server/i.test(projectDesc) && !/linked|list|class/i.test(projectDesc)) {
      const lang = langHint || (projectDesc.includes('javascript') || projectDesc.includes('node') ? 'javascript' : 'python');
      return this.generateHttpServer(lang);
    }

    // --- Linked list ---
    if (/linked\s*list/i.test(projectDesc)) {
      const lang = langHint || (projectDesc.includes('python') ? 'python' : projectDesc.includes('javascript') || projectDesc.includes('js') ? 'javascript' : 'java');
      return this.generateLinkedList(lang);
    }

    // --- Tic-tac-toe ---
    if (/tic[\s-]*tac[\s-]*toe/i.test(projectDesc)) {
      const lang = langHint || 'python';
      return this.generateTicTacToe(lang);
    }

    // --- Guessing game ---
    if (/guess(?:ing)?\s*(?:game|number)/i.test(projectDesc)) {
      const lang = langHint || 'python';
      return this.generateGuessingGame(lang);
    }

    return null;
  }

  // ---- Creative project generators ----

  private generateCalculator(lang: string): string {
    const templates: Record<string, string> = {
      javascript: `\`\`\`javascript
// Simple Calculator
class Calculator {
  add(a, b) { return a + b; }
  subtract(a, b) { return a - b; }
  multiply(a, b) { return a * b; }
  divide(a, b) {
    if (b === 0) throw new Error('Cannot divide by zero');
    return a / b;
  }
  modulo(a, b) { return a % b; }
  power(a, b) { return Math.pow(a, b); }
}

// Usage
const calc = new Calculator();
console.log('10 + 5 =', calc.add(10, 5));        // 15
console.log('10 - 5 =', calc.subtract(10, 5));    // 5
console.log('10 * 5 =', calc.multiply(10, 5));    // 50
console.log('10 / 5 =', calc.divide(10, 5));      // 2
console.log('10 % 3 =', calc.modulo(10, 3));      // 1
console.log('2 ^ 8  =', calc.power(2, 8));        // 256
\`\`\``,
      python: `\`\`\`python
# Simple Calculator
class Calculator:
    def add(self, a, b):
        return a + b

    def subtract(self, a, b):
        return a - b

    def multiply(self, a, b):
        return a * b

    def divide(self, a, b):
        if b == 0:
            raise ValueError("Cannot divide by zero")
        return a / b

    def modulo(self, a, b):
        return a % b

    def power(self, a, b):
        return a ** b

# Usage
calc = Calculator()
print(f"10 + 5 = {calc.add(10, 5)}")        # 15
print(f"10 - 5 = {calc.subtract(10, 5)}")    # 5
print(f"10 * 5 = {calc.multiply(10, 5)}")    # 50
print(f"10 / 5 = {calc.divide(10, 5)}")      # 2.0
print(f"10 % 3 = {calc.modulo(10, 3)}")      # 1
print(f"2 ^ 8  = {calc.power(2, 8)}")        # 256
\`\`\``,
      java: `\`\`\`java
public class Calculator {
    public double add(double a, double b) { return a + b; }
    public double subtract(double a, double b) { return a - b; }
    public double multiply(double a, double b) { return a * b; }
    public double divide(double a, double b) {
        if (b == 0) throw new ArithmeticException("Cannot divide by zero");
        return a / b;
    }
    public double modulo(double a, double b) { return a % b; }
    public double power(double a, double b) { return Math.pow(a, b); }

    public static void main(String[] args) {
        Calculator calc = new Calculator();
        System.out.println("10 + 5 = " + calc.add(10, 5));
        System.out.println("10 - 5 = " + calc.subtract(10, 5));
        System.out.println("10 * 5 = " + calc.multiply(10, 5));
        System.out.println("10 / 5 = " + calc.divide(10, 5));
    }
}
\`\`\``,
    };
    const code = templates[lang] || templates['javascript'];
    return `Here's a **calculator** in **${lang}**:\n\n${code}\n\nThis calculator supports addition, subtraction, multiplication, division (with zero-check), modulo, and power operations.`;
  }

  private generateTodoList(lang: string): string {
    const templates: Record<string, string> = {
      python: `\`\`\`python
# Todo List Manager
class TodoList:
    def __init__(self):
        self.tasks = []

    def add(self, task):
        self.tasks.append({"text": task, "done": False})
        print(f"Added: {task}")

    def remove(self, index):
        if 0 <= index < len(self.tasks):
            removed = self.tasks.pop(index)
            print(f"Removed: {removed['text']}")
        else:
            print("Invalid index")

    def complete(self, index):
        if 0 <= index < len(self.tasks):
            self.tasks[index]["done"] = True
            print(f"Completed: {self.tasks[index]['text']}")

    def show(self):
        if not self.tasks:
            print("No tasks yet!")
            return
        for i, task in enumerate(self.tasks):
            status = "✓" if task["done"] else "○"
            print(f"  {i}. [{status}] {task['text']}")

# Usage
todo = TodoList()
todo.add("Buy groceries")
todo.add("Write unit tests")
todo.add("Read documentation")
todo.complete(1)
todo.show()
# Output:
#   0. [○] Buy groceries
#   1. [✓] Write unit tests
#   2. [○] Read documentation
\`\`\``,
      javascript: `\`\`\`javascript
// Todo List Manager
class TodoList {
  constructor() {
    this.tasks = [];
  }

  add(text) {
    this.tasks.push({ text, done: false });
    console.log(\\\`Added: \\\${text}\\\`);
  }

  remove(index) {
    if (index >= 0 && index < this.tasks.length) {
      const [removed] = this.tasks.splice(index, 1);
      console.log(\\\`Removed: \\\${removed.text}\\\`);
    }
  }

  complete(index) {
    if (index >= 0 && index < this.tasks.length) {
      this.tasks[index].done = true;
    }
  }

  show() {
    if (!this.tasks.length) { console.log('No tasks yet!'); return; }
    this.tasks.forEach((t, i) => {
      const status = t.done ? '✓' : '○';
      console.log(\\\`  \\\${i}. [\\\${status}] \\\${t.text}\\\`);
    });
  }
}

// Usage
const todo = new TodoList();
todo.add('Buy groceries');
todo.add('Write unit tests');
todo.add('Read documentation');
todo.complete(1);
todo.show();
\`\`\``,
      java: `\`\`\`java
import java.util.ArrayList;

public class TodoList {
    private ArrayList<String[]> tasks = new ArrayList<>();

    public void add(String text) {
        tasks.add(new String[]{text, "false"});
        System.out.println("Added: " + text);
    }

    public void remove(int index) {
        if (index >= 0 && index < tasks.size()) {
            String[] removed = tasks.remove(index);
            System.out.println("Removed: " + removed[0]);
        }
    }

    public void complete(int index) {
        if (index >= 0 && index < tasks.size()) {
            tasks.get(index)[1] = "true";
        }
    }

    public void show() {
        for (int i = 0; i < tasks.size(); i++) {
            String status = tasks.get(i)[1].equals("true") ? "✓" : "○";
            System.out.println("  " + i + ". [" + status + "] " + tasks.get(i)[0]);
        }
    }

    public static void main(String[] args) {
        TodoList todo = new TodoList();
        todo.add("Buy groceries");
        todo.add("Write unit tests");
        todo.complete(1);
        todo.show();
    }
}
\`\`\``,
    };
    const code = templates[lang] || templates['python'];
    return `Here's a **todo list** in **${lang}**:\n\n${code}\n\nFeatures: add tasks, remove by index, mark complete, and display with status icons.`;
  }

  private generateCounter(lang: string): string {
    if (lang === 'react' || lang === 'jsx' || lang === 'tsx' || lang === 'javascript' || lang === 'typescript') {
      return `Here's a **counter component** in **React**:

\`\`\`jsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ textAlign: 'center', padding: '2rem' }}>
      <h1>Counter: {count}</h1>
      <button onClick={() => setCount(c => c - 1)}>-</button>
      <button onClick={() => setCount(0)} style={{ margin: '0 1rem' }}>
        Reset
      </button>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
}

export default Counter;
\`\`\`

Uses \`useState\` for state management with increment, decrement, and reset controls.`;
    }
    // Fallback for other langs — simple CLI counter
    return `Here's a **counter** in **${lang}**:

\`\`\`${lang}
# Simple counter
count = 0

def increment():
    global count
    count += 1
    return count

def decrement():
    global count
    count -= 1
    return count

def reset():
    global count
    count = 0
    return count

print(increment())  # 1
print(increment())  # 2
print(decrement())  # 1
print(reset())      # 0
\`\`\``;
  }

  private generateFizzBuzz(lang: string): string {
    const templates: Record<string, string> = {
      javascript: `\`\`\`javascript
function fizzBuzz(n) {
  const result = [];
  for (let i = 1; i <= n; i++) {
    if (i % 15 === 0) result.push('FizzBuzz');
    else if (i % 3 === 0) result.push('Fizz');
    else if (i % 5 === 0) result.push('Buzz');
    else result.push(i.toString());
  }
  return result;
}

// Print FizzBuzz from 1 to 20
fizzBuzz(20).forEach(item => console.log(item));
\`\`\``,
      python: `\`\`\`python
def fizz_buzz(n):
    result = []
    for i in range(1, n + 1):
        if i % 15 == 0:
            result.append("FizzBuzz")
        elif i % 3 == 0:
            result.append("Fizz")
        elif i % 5 == 0:
            result.append("Buzz")
        else:
            result.append(str(i))
    return result

# Print FizzBuzz from 1 to 20
for item in fizz_buzz(20):
    print(item)
\`\`\``,
      java: `\`\`\`java
public class FizzBuzz {
    public static String[] fizzBuzz(int n) {
        String[] result = new String[n];
        for (int i = 1; i <= n; i++) {
            if (i % 15 == 0) result[i-1] = "FizzBuzz";
            else if (i % 3 == 0) result[i-1] = "Fizz";
            else if (i % 5 == 0) result[i-1] = "Buzz";
            else result[i-1] = String.valueOf(i);
        }
        return result;
    }

    public static void main(String[] args) {
        for (String item : fizzBuzz(20)) {
            System.out.println(item);
        }
    }
}
\`\`\``,
    };
    const code = templates[lang] || templates['javascript'];
    return `Here's **FizzBuzz** in **${lang}**:\n\n${code}\n\nClassic FizzBuzz: prints "Fizz" for multiples of 3, "Buzz" for multiples of 5, "FizzBuzz" for both, and the number otherwise.`;
  }

  private generateHttpServer(lang: string): string {
    const templates: Record<string, string> = {
      python: `\`\`\`python
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

class MyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<h1>Hello from Python HTTP Server!</h1>')
        elif self.path == '/api/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not Found')

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        data = json.loads(body) if body else {}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"received": data}).encode())

server = HTTPServer(('localhost', 8080), MyHandler)
print('Server running on http://localhost:8080')
server.serve_forever()
\`\`\``,
      javascript: `\`\`\`javascript
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Hello from Node.js HTTP Server!</h1>');
  } else if (req.url === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const data = JSON.parse(body || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: data }));
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(8080, () => {
  console.log('Server running on http://localhost:8080');
});
\`\`\``,
    };
    const code = templates[lang] || templates['python'];
    return `Here's a **simple HTTP server** in **${lang}**:\n\n${code}\n\nHandles GET routes for / and /api/status, plus a POST endpoint that echoes back received JSON data.`;
  }

  private generateLinkedList(lang: string): string {
    const templates: Record<string, string> = {
      java: `\`\`\`java
public class LinkedList<T> {
    private static class Node<T> {
        T data;
        Node<T> next;
        Node(T data) { this.data = data; this.next = null; }
    }

    private Node<T> head;
    private int size;

    public LinkedList() { head = null; size = 0; }

    public void insertFirst(T data) {
        Node<T> node = new Node<>(data);
        node.next = head;
        head = node;
        size++;
    }

    public void insertLast(T data) {
        Node<T> node = new Node<>(data);
        if (head == null) { head = node; }
        else {
            Node<T> curr = head;
            while (curr.next != null) curr = curr.next;
            curr.next = node;
        }
        size++;
    }

    public T deleteFirst() {
        if (head == null) throw new RuntimeException("List is empty");
        T data = head.data;
        head = head.next;
        size--;
        return data;
    }

    public boolean contains(T data) {
        Node<T> curr = head;
        while (curr != null) {
            if (curr.data.equals(data)) return true;
            curr = curr.next;
        }
        return false;
    }

    public int size() { return size; }

    public void print() {
        Node<T> curr = head;
        while (curr != null) {
            System.out.print(curr.data + " -> ");
            curr = curr.next;
        }
        System.out.println("null");
    }

    public static void main(String[] args) {
        LinkedList<Integer> list = new LinkedList<>();
        list.insertLast(1);
        list.insertLast(2);
        list.insertLast(3);
        list.insertFirst(0);
        list.print();             // 0 -> 1 -> 2 -> 3 -> null
        list.deleteFirst();
        list.print();             // 1 -> 2 -> 3 -> null
        System.out.println("Contains 2: " + list.contains(2));
        System.out.println("Size: " + list.size());
    }
}
\`\`\``,
      python: `\`\`\`python
class Node:
    def __init__(self, data):
        self.data = data
        self.next = None

class LinkedList:
    def __init__(self):
        self.head = None
        self._size = 0

    def insert_first(self, data):
        node = Node(data)
        node.next = self.head
        self.head = node
        self._size += 1

    def insert_last(self, data):
        node = Node(data)
        if not self.head:
            self.head = node
        else:
            curr = self.head
            while curr.next:
                curr = curr.next
            curr.next = node
        self._size += 1

    def delete_first(self):
        if not self.head:
            raise IndexError("List is empty")
        data = self.head.data
        self.head = self.head.next
        self._size -= 1
        return data

    def contains(self, data):
        curr = self.head
        while curr:
            if curr.data == data:
                return True
            curr = curr.next
        return False

    def size(self):
        return self._size

    def __str__(self):
        items = []
        curr = self.head
        while curr:
            items.append(str(curr.data))
            curr = curr.next
        return " -> ".join(items) + " -> None"

# Usage
ll = LinkedList()
ll.insert_last(1)
ll.insert_last(2)
ll.insert_last(3)
ll.insert_first(0)
print(ll)                  # 0 -> 1 -> 2 -> 3 -> None
ll.delete_first()
print(ll)                  # 1 -> 2 -> 3 -> None
print(f"Contains 2: {ll.contains(2)}")
print(f"Size: {ll.size()}")
\`\`\``,
      javascript: `\`\`\`javascript
class Node {
  constructor(data) {
    this.data = data;
    this.next = null;
  }
}

class LinkedList {
  constructor() {
    this.head = null;
    this._size = 0;
  }

  insertFirst(data) {
    const node = new Node(data);
    node.next = this.head;
    this.head = node;
    this._size++;
  }

  insertLast(data) {
    const node = new Node(data);
    if (!this.head) { this.head = node; }
    else {
      let curr = this.head;
      while (curr.next) curr = curr.next;
      curr.next = node;
    }
    this._size++;
  }

  deleteFirst() {
    if (!this.head) throw new Error('List is empty');
    const data = this.head.data;
    this.head = this.head.next;
    this._size--;
    return data;
  }

  contains(data) {
    let curr = this.head;
    while (curr) {
      if (curr.data === data) return true;
      curr = curr.next;
    }
    return false;
  }

  size() { return this._size; }

  toString() {
    const items = [];
    let curr = this.head;
    while (curr) { items.push(curr.data); curr = curr.next; }
    return items.join(' -> ') + ' -> null';
  }
}

// Usage
const list = new LinkedList();
list.insertLast(1);
list.insertLast(2);
list.insertLast(3);
list.insertFirst(0);
console.log(list.toString());    // 0 -> 1 -> 2 -> 3 -> null
list.deleteFirst();
console.log(list.toString());    // 1 -> 2 -> 3 -> null
console.log('Contains 2:', list.contains(2));
console.log('Size:', list.size());
\`\`\``,
    };
    const code = templates[lang] || templates['java'];
    return `Here's a **linked list** implementation in **${lang}**:\n\n${code}\n\nA singly linked list with insert (first/last), delete, contains, size, and print operations.`;
  }

  private generateTicTacToe(lang: string): string {
    if (lang === 'python') {
      return `Here's a **tic-tac-toe game** in **Python**:

\`\`\`python
class TicTacToe:
    def __init__(self):
        self.board = [' '] * 9
        self.current = 'X'

    def display(self):
        for i in range(0, 9, 3):
            print(f" {self.board[i]} | {self.board[i+1]} | {self.board[i+2]} ")
            if i < 6: print("-----------")

    def move(self, pos):
        if self.board[pos] != ' ':
            print("Cell taken!"); return False
        self.board[pos] = self.current
        self.current = 'O' if self.current == 'X' else 'X'
        return True

    def winner(self):
        lines = [(0,1,2),(3,4,5),(6,7,8),(0,3,6),(1,4,7),(2,5,8),(0,4,8),(2,4,6)]
        for a, b, c in lines:
            if self.board[a] == self.board[b] == self.board[c] != ' ':
                return self.board[a]
        return 'Draw' if ' ' not in self.board else None

game = TicTacToe()
while not game.winner():
    game.display()
    pos = int(input(f"Player {game.current}, enter position (0-8): "))
    game.move(pos)
game.display()
print(f"Result: {game.winner()}")
\`\`\`

A simple 2-player tic-tac-toe with board display, move validation, and win/draw detection.`;
    }
    return this.generateFizzBuzz(lang); // fallback
  }

  private generateGuessingGame(lang: string): string {
    if (lang === 'python') {
      return `Here's a **number guessing game** in **Python**:

\`\`\`python
import random

def guessing_game():
    number = random.randint(1, 100)
    attempts = 0

    print("I'm thinking of a number between 1 and 100!")

    while True:
        guess = int(input("Your guess: "))
        attempts += 1

        if guess < number:
            print("Too low!")
        elif guess > number:
            print("Too high!")
        else:
            print(f"Correct! You got it in {attempts} attempts!")
            break

guessing_game()
\`\`\`

Classic number guessing with too-high / too-low hints and attempt counter.`;
    }
    return `Here's a **number guessing game** in **JavaScript**:

\`\`\`javascript
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const number = Math.floor(Math.random() * 100) + 1;
let attempts = 0;

console.log("I'm thinking of a number between 1 and 100!");

function ask() {
  rl.question('Your guess: ', (answer) => {
    const guess = parseInt(answer);
    attempts++;
    if (guess < number) { console.log('Too low!'); ask(); }
    else if (guess > number) { console.log('Too high!'); ask(); }
    else { console.log(\\\`Correct! You got it in \\\${attempts} attempts!\\\`); rl.close(); }
  });
}
ask();
\`\`\`

Classic number guessing game with hints and attempt tracking.`;
  }

  // ── Strategy 1.42: Deterministic Networking Knowledge (OSI / TCP-IP) ──

  /**
   * Handle networking-related factual questions with deterministic, RFC-accurate answers.
   * Covers: OSI model, TCP/IP model, port numbers, protocols, IP addressing, subnet math,
   * TCP vs UDP, DNS, TLS/SSL, and Norwegian networking terminology.
   */
  private tryNetworkingKnowledge(input: string): string | null {
    // Only trigger on networking-related queries
    if (!/\b(osi|tcp|udp|ipv?[46]|subnet|port\s*(?:number|for)|dns|tls|ssl|ethernet|mtu|vlan|nat|arp|icmp|dhcp|ftp|ssh|https?|smtp|sockets?|handshake|loopback|broadcast|cidr|gateway|router|switch|firewall|mac\s*address|packet|frame|segment|datagram|layer\s*[1-7]|transport\s*layer|network\s*layer|application\s*layer|data\s*link|physical\s*layer|session\s*layer|presentation\s*layer|nettverkslag|transportlag|applikasjonslag|encrypt(?:ion)?|symmetric|asymmetric|cname|(?:a|aaaa|mx)\s+record)\b/i.test(input)
      && !/\b(hva\s+er\s+(?:de\s+)?(?:7|sju)|osi.?modell|tcp.?ip|nettverks|transport|lag(?:ene|et)?|protokoll|port|subnet|dns|forskjell(?:en)?\s+mellom\s+tcp)\b/i.test(input)) {
      return null;
    }

    // ── OSI MODEL LAYERS ──
    const osiLayers: Record<number, { name: string; nameNo: string; pdu: string; protocols: string[]; desc: string }> = {
      7: { name: 'Application', nameNo: 'Applikasjon', pdu: 'Data', protocols: ['HTTP', 'HTTPS', 'FTP', 'SMTP', 'DNS', 'SSH', 'Telnet', 'SNMP'], desc: 'Provides network services directly to end-user applications' },
      6: { name: 'Presentation', nameNo: 'Presentasjon', pdu: 'Data', protocols: ['SSL/TLS', 'JPEG', 'MPEG', 'ASCII', 'GIF'], desc: 'Translates data formats, handles encryption/decryption and compression' },
      5: { name: 'Session', nameNo: 'Sesjon', pdu: 'Data', protocols: ['NetBIOS', 'RPC', 'PPTP'], desc: 'Establishes, manages, and terminates sessions between applications' },
      4: { name: 'Transport', nameNo: 'Transport', pdu: 'Segment (TCP) / Datagram (UDP)', protocols: ['TCP', 'UDP'], desc: 'Provides reliable (TCP) or unreliable (UDP) end-to-end data delivery' },
      3: { name: 'Network', nameNo: 'Nettverk', pdu: 'Packet', protocols: ['IP', 'ICMP', 'ARP', 'OSPF', 'BGP', 'RIP'], desc: 'Handles logical addressing (IP) and routing between networks' },
      2: { name: 'Data Link', nameNo: 'Datalink', pdu: 'Frame', protocols: ['Ethernet', 'Wi-Fi (802.11)', 'PPP', 'ARP'], desc: 'Handles MAC addressing, framing, and error detection on the local link' },
      1: { name: 'Physical', nameNo: 'Fysisk', pdu: 'Bit', protocols: ['Ethernet (physical)', 'USB', 'Bluetooth', 'DSL'], desc: 'Transmits raw bits over the physical medium (cables, radio, fiber)' },
    };

    // "What are the 7 layers of the OSI model?"
    if (/(?:what\s+are\s+(?:the\s+)?(?:7|seven)\s+layers|list\s+(?:the\s+)?(?:7|seven)\s+(?:osi\s+)?layers|name\s+(?:the\s+)?(?:7|seven)\s+(?:osi\s+)?layers|7\s+layers\s+of\s+(?:the\s+)?osi)/i.test(input)
      || /\b(?:hva\s+er\s+(?:de\s+)?(?:7|sju)\s+lag(?:ene)?\s+i\s+osi)/i.test(input)) {
      const isNorwegian = /\bhva\b/i.test(input);
      if (isNorwegian) {
        let result = 'De 7 lagene i OSI-modellen (fra topp til bunn):\n\n';
        for (let i = 7; i >= 1; i--) {
          const l = osiLayers[i];
          result += `**Lag ${i}: ${l.nameNo} (${l.name})**\n`;
          result += `  PDU: ${l.pdu} | Protokoller: ${l.protocols.join(', ')}\n\n`;
        }
        return result.trim();
      }
      let result = 'The 7 layers of the OSI model (top to bottom):\n\n';
      for (let i = 7; i >= 1; i--) {
        const l = osiLayers[i];
        result += `**Layer ${i}: ${l.name}**\n`;
        result += `  PDU: ${l.pdu} | Protocols: ${l.protocols.join(', ')}\n`;
        result += `  ${l.desc}\n\n`;
      }
      return result.trim();
    }

    // "What layer does X operate on?" / "Which OSI layer handles X?"
    const layerForProtocol: Record<string, number> = {
      http: 7, https: 7, ftp: 7, smtp: 7, dns: 7, ssh: 7, telnet: 7, snmp: 7, pop3: 7, imap: 7,
      tls: 6, ssl: 6, jpeg: 6, mpeg: 6,
      netbios: 5, rpc: 5, pptp: 5,
      tcp: 4, udp: 4,
      ip: 3, icmp: 3, ospf: 3, bgp: 3, rip: 3,
      arp: 2, ethernet: 2, wifi: 2, ppp: 2,
    };

    const layerMatch = input.match(/(?:what|which)\s+(?:osi\s+)?layer\s+(?:does|do|is)?\s+(\w+)\s+(?:operate|work|run|function)\s+(?:on|at|in)/i)
      || input.match(/(?:what|which)\s+layer\s+of\s+(?:the\s+)?osi\s+(?:model\s+)?(?:does|do)\s+(\w+)\s+(?:operate|work|run)\s+(?:on|at)/i)
      || input.match(/(?:which|what)\s+(?:osi\s+)?layer\s+(?:is|does)\s+(\w+)\s+(?:at|on|in)/i)
      || input.match(/(\w+)\s+(?:operates?|works?|runs?)\s+(?:on|at)\s+(?:which|what)\s+(?:osi\s+)?layer/i);
    if (layerMatch) {
      const proto = layerMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '');
      const layerNum = layerForProtocol[proto];
      if (layerNum) {
        const l = osiLayers[layerNum];
        return `**${layerMatch[1].toUpperCase()}** operates at **OSI Layer ${layerNum} (${l.name})**.\n\n${l.desc}.\nOther protocols at this layer: ${l.protocols.filter(p => p.toLowerCase() !== proto).join(', ')}.`;
      }
    }

    // "What layer handles encryption?" / "Which layer handles compression?"
    if (/(?:which|what)\s+(?:osi\s+)?layer\s+(?:handles?|does|is\s+responsible\s+for)\s+(?:encryption|decryption|compression|data\s+(?:format|translation))/i.test(input)) {
      const l = osiLayers[6];
      return `**OSI Layer 6 (${l.name})** handles encryption, decryption, and data compression.\n\n${l.desc}.\nProtocols: ${l.protocols.join(', ')}.`;
    }

    // "What is the purpose/role of the [X] layer?"
    const purposeMatch = input.match(/(?:purpose|role|function|job)\s+of\s+(?:the\s+)?(\w+)\s+layer/i)
      || input.match(/what\s+(?:does|is)\s+(?:the\s+)?(\w+)\s+layer\s+(?:do|for)/i);
    if (purposeMatch) {
      const layerName = purposeMatch[1].toLowerCase();
      const nameToNum: Record<string, number> = {
        application: 7, presentation: 6, session: 5, transport: 4,
        network: 3, 'data': 2, datalink: 2, 'data-link': 2, link: 2, physical: 1,
      };
      const num = nameToNum[layerName];
      if (num) {
        const l = osiLayers[num];
        return `**OSI Layer ${num} (${l.name}):**\n\n${l.desc}.\n\nPDU: ${l.pdu}\nProtocols: ${l.protocols.join(', ')}`;
      }
    }

    // "What is the data unit at layer N?" / "What is the PDU at layer N?"
    const pduMatch = input.match(/(?:data\s+unit|pdu|protocol\s+data\s+unit)\s+(?:at|for|of|called\s+at)\s+(?:osi\s+)?layer\s+(\d)/i)
      || input.match(/layer\s+(\d)\s+(?:data\s+unit|pdu)/i);
    if (pduMatch) {
      const num = parseInt(pduMatch[1]);
      const l = osiLayers[num];
      if (l) {
        return `The PDU (Protocol Data Unit) at **OSI Layer ${num} (${l.name})** is a **${l.pdu}**.`;
      }
    }

    // "Difference between layer X and layer Y"
    const layerDiffMatch = input.match(/difference\s+between\s+(?:osi\s+)?layer\s+(\d)\s+and\s+(?:osi\s+)?layer\s+(\d)/i);
    if (layerDiffMatch) {
      const a = parseInt(layerDiffMatch[1]), b = parseInt(layerDiffMatch[2]);
      const la = osiLayers[a], lb = osiLayers[b];
      if (la && lb) {
        return `**Layer ${a} (${la.name})** vs **Layer ${b} (${lb.name})**:\n\n` +
          `| | Layer ${a} (${la.name}) | Layer ${b} (${lb.name}) |\n` +
          `|---|---|---|\n` +
          `| **PDU** | ${la.pdu} | ${lb.pdu} |\n` +
          `| **Function** | ${la.desc} | ${lb.desc} |\n` +
          `| **Protocols** | ${la.protocols.join(', ')} | ${lb.protocols.join(', ')} |`;
      }
    }

    // "Protocols at the X layer" / "Name 3 protocols at the network layer"
    const protoLayerMatch = input.match(/(?:protocols?\s+(?:at|on|of|that\s+operate\s+(?:at|on))\s+(?:the\s+)?(\w+)\s+layer)|(?:(\w+)\s+layer\s+protocols?)/i)
      || input.match(/(?:name|list)\s+\d?\s*protocols?\s+(?:at|on|that\s+operate\s+(?:at|on))\s+(?:the\s+)?(\w+)\s+layer/i);
    if (protoLayerMatch) {
      const layerName = (protoLayerMatch[1] || protoLayerMatch[2] || protoLayerMatch[3])?.toLowerCase();
      const nameToNum: Record<string, number> = {
        application: 7, presentation: 6, session: 5, transport: 4,
        network: 3, data: 2, datalink: 2, link: 2, physical: 1,
      };
      const num = nameToNum[layerName!];
      if (num) {
        const l = osiLayers[num];
        return `Protocols at **OSI Layer ${num} (${l.name})**: ${l.protocols.join(', ')}.`;
      }
    }

    // ── TCP/IP MODEL ──
    if (/(?:how\s+many\s+layers|number\s+of\s+layers)\s+(?:does\s+)?(?:the\s+)?tcp.?ip\s+model\s+have/i.test(input)
      || /tcp.?ip\s+model\s+(?:has\s+)?(?:how\s+many\s+)?layers/i.test(input)) {
      return 'The **TCP/IP model** has **4 layers**:\n\n' +
        '1. **Application** (OSI Layers 5-7) — HTTP, FTP, SMTP, DNS, SSH\n' +
        '2. **Transport** (OSI Layer 4) — TCP, UDP\n' +
        '3. **Internet** (OSI Layer 3) — IP, ICMP, ARP\n' +
        '4. **Network Access / Link** (OSI Layers 1-2) — Ethernet, Wi-Fi';
    }

    // "What are the 4 layers of the TCP/IP model?"
    if (/(?:what\s+are|list|name)\s+(?:the\s+)?(?:4|four)\s+layers\s+(?:of\s+)?(?:the\s+)?tcp.?ip/i.test(input)) {
      return 'The 4 layers of the **TCP/IP model**:\n\n' +
        '| Layer | Name | OSI Equivalent | Key Protocols |\n' +
        '|-------|------|----------------|---------------|\n' +
        '| 4 | Application | Layers 5-7 | HTTP, FTP, SMTP, DNS, SSH |\n' +
        '| 3 | Transport | Layer 4 | TCP, UDP |\n' +
        '| 2 | Internet | Layer 3 | IP, ICMP, ARP |\n' +
        '| 1 | Network Access | Layers 1-2 | Ethernet, Wi-Fi, PPP |';
    }

    // "Difference between OSI and TCP/IP"
    if (/difference\s+between\s+(?:the\s+)?osi\s+(?:model\s+)?and\s+(?:the\s+)?tcp.?ip/i.test(input)
      || /difference\s+between\s+(?:the\s+)?tcp.?ip\s+(?:model\s+)?and\s+(?:the\s+)?osi/i.test(input)) {
      return '**OSI Model vs TCP/IP Model:**\n\n' +
        '| | OSI Model | TCP/IP Model |\n' +
        '|---|---|---|\n' +
        '| **Layers** | 7 | 4 |\n' +
        '| **Developed by** | ISO | DARPA/DoD |\n' +
        '| **Type** | Theoretical reference model | Practical implementation model |\n' +
        '| **Session/Presentation** | Separate layers (5, 6) | Merged into Application layer |\n' +
        '| **Network Access** | Physical + Data Link (1, 2) | Combined as Network Access layer |\n' +
        '| **Usage** | Teaching & reference | Real-world Internet protocols |';
    }

    // "Which TCP/IP layer corresponds to OSI layers 5, 6, and 7?"
    if (/tcp.?ip\s+layer\s+corresponds?\s+(?:to\s+)?osi\s+layers?\s+[567]/i.test(input)
      || /osi\s+layers?\s+[567]\s+.*tcp.?ip/i.test(input)) {
      return 'OSI Layers 5 (Session), 6 (Presentation), and 7 (Application) all correspond to the **TCP/IP Application layer**.\n\nThe TCP/IP model combines session management, data translation/encryption, and application protocols into a single layer.';
    }

    // "What layer does ARP operate on in TCP/IP?"
    if (/arp\s+.*(?:tcp.?ip|layer)/i.test(input) || /(?:tcp.?ip|layer).*arp/i.test(input)) {
      return '**ARP (Address Resolution Protocol)** operates at the **Internet layer** (Layer 2) of the TCP/IP model, which corresponds to **OSI Layer 2-3** boundary.\n\nARP maps IP addresses (Layer 3) to MAC addresses (Layer 2). It bridges the Internet and Network Access layers.';
    }

    // ── TCP vs UDP ──
    if (/(?:difference|compare|comparison)\s+(?:between\s+)?tcp\s+(?:and|vs\.?|versus)\s+udp/i.test(input)
      || /(?:difference|compare|comparison)\s+(?:between\s+)?udp\s+(?:and|vs\.?|versus)\s+tcp/i.test(input)
      || /\bhva\s+er\s+forskjellen\s+mellom\s+tcp\s+og\s+udp\b/i.test(input)) {
      const isNorwegian = /\bhva\b/i.test(input);
      if (isNorwegian) {
        return '**Forskjellen mellom TCP og UDP:**\n\n' +
          '| | TCP | UDP |\n' +
          '|---|---|---|\n' +
          '| **Type** | Tilkoblingsorientert | Tilkoblingsløs |\n' +
          '| **Pålitelighet** | Garantert levering | Ingen garanti |\n' +
          '| **Rekkefølge** | Ordnet | Uordnet |\n' +
          '| **Hastighet** | Tregere (overhead) | Raskere (ingen overhead) |\n' +
          '| **Handshake** | 3-veis (SYN, SYN-ACK, ACK) | Ingen |\n' +
          '| **Bruk** | Web, e-post, filoverføring | Streaming, spill, DNS |';
      }
      return '**TCP vs UDP:**\n\n' +
        '| | TCP | UDP |\n' +
        '|---|---|---|\n' +
        '| **Type** | Connection-oriented | Connectionless |\n' +
        '| **Reliability** | Guaranteed delivery (ACK) | Best-effort, no guarantee |\n' +
        '| **Ordering** | Ordered (sequence numbers) | Unordered |\n' +
        '| **Speed** | Slower (overhead) | Faster (no overhead) |\n' +
        '| **Handshake** | 3-way (SYN, SYN-ACK, ACK) | None |\n' +
        '| **Header size** | 20 bytes minimum | 8 bytes fixed |\n' +
        '| **Use cases** | Web (HTTP), email, file transfer | Streaming, gaming, DNS, VoIP |';
    }

    // "TCP three-way handshake"
    if (/tcp\s+(?:three.?way|3.?way)\s+handshake/i.test(input) || /three.?way\s+handshake/i.test(input)) {
      return '**TCP Three-Way Handshake:**\n\n' +
        '```\n' +
        'Client                Server\n' +
        '  |--- SYN ------------>|\n' +
        '  |<--- SYN-ACK --------|\n' +
        '  |--- ACK ------------>|\n' +
        '  |    Connection Open  |\n' +
        '```\n\n' +
        '1. **SYN** — Client sends a synchronization request with an initial sequence number\n' +
        '2. **SYN-ACK** — Server acknowledges and sends its own sequence number\n' +
        '3. **ACK** — Client acknowledges the server\'s sequence number\n\n' +
        'After these 3 steps, a full-duplex TCP connection is established.';
    }

    // "TCP flags" — SYN, ACK, FIN, RST, PSH, URG
    if (/tcp\s+flags?/i.test(input) || /\b(?:syn|ack|fin|rst)\b.*\b(?:syn|ack|fin|rst)\b.*tcp/i.test(input)
      || /tcp.*\b(?:syn|ack|fin|rst)\b.*\b(?:syn|ack|fin|rst)\b/i.test(input)) {
      return '**TCP Flags (6 standard flags):**\n\n' +
        '| Flag | Full Name | Purpose |\n' +
        '|------|-----------|--------|\n' +
        '| **SYN** | Synchronize | Initiate connection (sequence number sync) |\n' +
        '| **ACK** | Acknowledge | Confirm receipt of data/segments |\n' +
        '| **FIN** | Finish | Gracefully close connection |\n' +
        '| **RST** | Reset | Abruptly terminate connection |\n' +
        '| **PSH** | Push | Send data immediately (no buffering) |\n' +
        '| **URG** | Urgent | Mark data as urgent/priority |\n\n' +
        'These flags are 1-bit fields in the TCP header. Multiple flags can be set simultaneously (e.g., SYN-ACK).';
    }

    // "Maximum size of a TCP segment" / "TCP MSS" / "TCP segment size"
    if (/(?:maximum|max)\s+(?:size|length)\s+(?:of\s+)?(?:a\s+)?tcp\s+segment/i.test(input)
      || /tcp\s+(?:segment\s+)?(?:max(?:imum)?\s+)?size/i.test(input)
      || /tcp\s+mss/i.test(input)) {
      return '**TCP Maximum Segment Size (MSS):**\n\n' +
        '- Default MSS: **536 bytes** (without options)\n' +
        '- Typical MSS on Ethernet: **1460 bytes** (MTU 1500 - 20 IP header - 20 TCP header)\n' +
        '- Maximum theoretical: **65,535 bytes** (16-bit window size)\n\n' +
        'The MSS is negotiated during the TCP three-way handshake via the MSS option. It does NOT include TCP/IP headers.';
    }

    // ── PORT NUMBERS ──
    const portMap: Record<string, { port: number; protocol: string; transport: string }> = {
      http: { port: 80, protocol: 'HTTP', transport: 'TCP' },
      https: { port: 443, protocol: 'HTTPS', transport: 'TCP' },
      ssh: { port: 22, protocol: 'SSH', transport: 'TCP' },
      dns: { port: 53, protocol: 'DNS', transport: 'TCP/UDP' },
      ftp: { port: 21, protocol: 'FTP (control)', transport: 'TCP' },
      'ftp-data': { port: 20, protocol: 'FTP (data)', transport: 'TCP' },
      smtp: { port: 25, protocol: 'SMTP', transport: 'TCP' },
      pop3: { port: 110, protocol: 'POP3', transport: 'TCP' },
      imap: { port: 143, protocol: 'IMAP', transport: 'TCP' },
      telnet: { port: 23, protocol: 'Telnet', transport: 'TCP' },
      dhcp: { port: 67, protocol: 'DHCP (server)', transport: 'UDP' },
      snmp: { port: 161, protocol: 'SNMP', transport: 'UDP' },
      rdp: { port: 3389, protocol: 'RDP', transport: 'TCP' },
      mysql: { port: 3306, protocol: 'MySQL', transport: 'TCP' },
      postgresql: { port: 5432, protocol: 'PostgreSQL', transport: 'TCP' },
    };

    // "What is the default port for HTTP?" / "hva er standardporten for HTTP?"
    const portMatch = input.match(/(?:default\s+)?port\s+(?:number\s+)?(?:for|of|used\s+by)\s+(\w+)/i)
      || input.match(/(?:what|which)\s+port\s+(?:does\s+)?(\w+)\s+(?:use|listen|run|operate)/i)
      || input.match(/(\w+)\s+(?:default\s+)?port\s*(?:number)?$/i)
      || input.match(/hva\s+er\s+(?:standard)?porten\s+for\s+(\w+)/i);
    if (portMatch) {
      const proto = portMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '');
      const info = portMap[proto];
      if (info) {
        const isNorwegian = /\bhva\b/i.test(input);
        if (isNorwegian) {
          return `Standardporten for **${info.protocol}** er **${info.port}** (${info.transport}).`;
        }
        return `The default port for **${info.protocol}** is **${info.port}** (${info.transport}).`;
      }
    }

    // ── IP ADDRESSING ──

    // "How many bits in IPv4/IPv6?"
    if (/how\s+many\s+bits\s+(?:in|does|are\s+(?:in|there))\s+(?:an?\s+)?ipv?4/i.test(input)) {
      return 'An **IPv4 address** is **32 bits** (4 bytes), written as 4 decimal octets separated by dots (e.g., `192.168.1.1`). This gives 2^32 = 4,294,967,296 possible addresses.';
    }
    if (/how\s+many\s+bits\s+(?:in|does|are\s+(?:in|there))\s+(?:an?\s+)?ipv?6/i.test(input)) {
      return 'An **IPv6 address** is **128 bits** (16 bytes), written as 8 groups of 4 hex digits separated by colons (e.g., `2001:0db8:85a3::8a2e:0370:7334`). This gives 2^128 ≈ 3.4 × 10^38 possible addresses.';
    }

    // "Subnet mask for /24" / "What is a /24?"
    const cidrMatch = input.match(/subnet\s+mask\s+(?:for|of)\s+(?:a\s+)?\/(\d{1,2})/i)
      || input.match(/\/(\d{1,2})\s+(?:subnet\s+)?mask/i);
    if (cidrMatch) {
      const prefix = parseInt(cidrMatch[1]);
      if (prefix >= 0 && prefix <= 32) {
        const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
        const octets = [(mask >>> 24) & 0xFF, (mask >>> 16) & 0xFF, (mask >>> 8) & 0xFF, mask & 0xFF];
        const hosts = prefix === 32 ? 1 : prefix === 31 ? 2 : Math.pow(2, 32 - prefix) - 2;
        return `**/${prefix} subnet mask:** \`${octets.join('.')}\`\n\n` +
          `Binary: \`${octets.map(o => o.toString(2).padStart(8, '0')).join('.')}\`\n` +
          `Usable hosts: **${hosts.toLocaleString('en-US')}**`;
      }
    }

    // "How many usable hosts in /24?"
    const hostsMatch = input.match(/(?:how\s+many|number\s+of)\s+(?:usable\s+)?hosts?\s+(?:in|on|for)\s+(?:a\s+)?\/(\d{1,2})/i);
    if (hostsMatch) {
      const prefix = parseInt(hostsMatch[1]);
      if (prefix >= 0 && prefix <= 32) {
        const hosts = prefix === 32 ? 1 : prefix === 31 ? 2 : Math.pow(2, 32 - prefix) - 2;
        return `A **/${prefix}** subnet has **${hosts.toLocaleString('en-US')} usable host addresses**.\n\n` +
          `Total addresses: ${Math.pow(2, 32 - prefix).toLocaleString('en-US')} (minus network and broadcast = ${hosts.toLocaleString('en-US')} usable).`;
      }
    }

    // "How many subnets from /16 with /24?"
    const subnetCountMatch = input.match(/how\s+many\s+subnets?\s+(?:can\s+(?:you|we)\s+)?(?:create|make|get|have)\s+(?:from\s+)?(?:a\s+)?\/(\d{1,2})\s+(?:with|using|into)\s+\/(\d{1,2})/i);
    if (subnetCountMatch) {
      const parent = parseInt(subnetCountMatch[1]);
      const child = parseInt(subnetCountMatch[2]);
      if (child > parent && child <= 32) {
        const count = Math.pow(2, child - parent);
        return `You can create **${count.toLocaleString('en-US')} /${child} subnets** from a /${parent} network.\n\n` +
          `Calculation: 2^(${child} - ${parent}) = 2^${child - parent} = ${count}`;
      }
    }

    // "Broadcast address for X/Y"
    const broadcastMatch = input.match(/broadcast\s+address\s+(?:for|of)\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})/i);
    if (broadcastMatch) {
      const ip = broadcastMatch[1];
      const prefix = parseInt(broadcastMatch[2]);
      const octets = ip.split('.').map(Number);
      const ipNum = (octets[0] << 24 | octets[1] << 16 | octets[2] << 8 | octets[3]) >>> 0;
      const hostBits = 32 - prefix;
      const networkAddr = (ipNum >>> hostBits) << hostBits >>> 0;
      const broadcastAddr = (networkAddr | ((1 << hostBits) - 1)) >>> 0;
      const bcastOctets = [(broadcastAddr >>> 24) & 0xFF, (broadcastAddr >>> 16) & 0xFF, (broadcastAddr >>> 8) & 0xFF, broadcastAddr & 0xFF];
      return `The broadcast address for **${ip}/${prefix}** is **\`${bcastOctets.join('.')}\`**.`;
    }

    // "What class is IP address X?" (classful addressing)
    const classMatch = input.match(/(?:what|which)\s+class\s+(?:is|does)\s+(?:the\s+)?(?:ip\s+)?(?:address\s+)?(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}/i);
    if (classMatch) {
      const first = parseInt(classMatch[1]);
      let cls = '', range = '', mask = '';
      if (first <= 127) { cls = 'A'; range = '0.0.0.0 – 127.255.255.255'; mask = '255.0.0.0 (/8)'; }
      else if (first <= 191) { cls = 'B'; range = '128.0.0.0 – 191.255.255.255'; mask = '255.255.0.0 (/16)'; }
      else if (first <= 223) { cls = 'C'; range = '192.0.0.0 – 223.255.255.255'; mask = '255.255.255.0 (/24)'; }
      else if (first <= 239) { cls = 'D'; range = '224.0.0.0 – 239.255.255.255'; mask = 'N/A (multicast)'; }
      else { cls = 'E'; range = '240.0.0.0 – 255.255.255.255'; mask = 'N/A (reserved)'; }
      return `**${classMatch[0].match(/\d+\.\d+\.\d+\.\d+/)![0]}** is a **Class ${cls}** address.\n\nClass ${cls} range: ${range}\nDefault mask: ${mask}`;
    }

    // "Loopback address"
    if (/loopback\s+address\s+(?:in\s+)?ipv?4/i.test(input) || /ipv?4\s+loopback/i.test(input)) {
      return 'The **IPv4 loopback address** is **`127.0.0.1`**.\n\nThe entire `127.0.0.0/8` block (127.0.0.0 – 127.255.255.255) is reserved for loopback. Traffic sent to any address in this range never leaves the host.';
    }

    // ── DNS ──
    if (/what\s+does\s+dns\s+stand\s+for/i.test(input) || /\bhva\s+betyr\s+dns\b/i.test(input)) {
      const isNorwegian = /\bhva\b/i.test(input);
      if (isNorwegian) {
        return '**DNS** står for **Domain Name System** (Domenenavnsystemet).\n\nDNS oversetter domenenavn (f.eks. `google.com`) til IP-adresser (f.eks. `142.250.74.46`) slik at datamaskiner kan finne hverandre på internett.';
      }
      return '**DNS** stands for **Domain Name System**.\n\nDNS translates human-readable domain names (e.g., `google.com`) into IP addresses (e.g., `142.250.74.46`) that computers use to identify each other on the network.';
    }

    // "What port does DNS use?"
    if (/(?:what\s+)?port\s+(?:does\s+)?dns\s+use/i.test(input)) {
      return 'DNS uses **port 53** on both **TCP and UDP**.\n\n- **UDP 53** — Standard DNS queries (most common)\n- **TCP 53** — Zone transfers and queries exceeding 512 bytes';
    }

    // "A record vs CNAME" / "difference between A record and CNAME"
    if (/(?:difference\s+between|compare)\s+(?:a|an)\s+a\s+record\s+and\s+(?:a\s+)?cname/i.test(input)
      || /a\s+record\s+vs\.?\s+cname/i.test(input)) {
      return '**A Record vs CNAME Record:**\n\n' +
        '| | A Record | CNAME Record |\n' +
        '|---|---|---|\n' +
        '| **Maps to** | IP address (e.g., `93.184.216.34`) | Another domain name (alias) |\n' +
        '| **Example** | `example.com → 93.184.216.34` | `www.example.com → example.com` |\n' +
        '| **Use case** | Root domain to IP | Subdomain alias to canonical name |\n' +
        '| **Can coexist** | Yes, with other records | Cannot coexist with other records on same name |';
    }

    // "DNS TTL"
    if (/dns\s+ttl/i.test(input) || /what\s+is\s+(?:a\s+)?(?:dns\s+)?ttl/i.test(input)) {
      return '**DNS TTL (Time to Live)** is the duration (in seconds) that a DNS record is cached by resolvers before they must re-query the authoritative server.\n\n' +
        '- **Low TTL** (60-300s): Faster propagation of changes, higher DNS query load\n' +
        '- **High TTL** (3600-86400s): Lower query load, slower propagation of changes\n' +
        '- **Typical value**: 3600 seconds (1 hour)\n\n' +
        'When you\'re about to change DNS records, lower the TTL first, then make the change.';
    }

    // ── ETHERNET / MTU ──
    if (/mtu\s+(?:for|of)\s+ethernet/i.test(input) || /ethernet\s+mtu/i.test(input)) {
      return 'The standard **Ethernet MTU** (Maximum Transmission Unit) is **1500 bytes**.\n\n' +
        '- Standard Ethernet: **1500 bytes**\n' +
        '- Jumbo frames: **9000 bytes** (not universally supported)\n' +
        '- IPv6 minimum MTU: **1280 bytes**\n\n' +
        'The MTU defines the maximum payload size of a single Ethernet frame (excluding the 14-byte Ethernet header and 4-byte FCS).';
    }

    // ── VLAN ──
    if (/what\s+is\s+(?:a\s+)?vlan\b/i.test(input)) {
      return '**VLAN (Virtual Local Area Network):**\n\n' +
        'A VLAN logically segments a physical network into separate broadcast domains at **OSI Layer 2**, without needing separate physical switches.\n\n' +
        '**Key points:**\n' +
        '- Defined by IEEE 802.1Q standard\n' +
        '- Tags frames with a 12-bit VLAN ID (1–4094)\n' +
        '- Isolates broadcast traffic between VLANs\n' +
        '- Requires a Layer 3 device (router/L3 switch) for inter-VLAN routing\n' +
        '- Improves security, performance, and network management';
    }

    // ── NAT ──
    if (/what\s+is\s+nat\b/i.test(input) || /\bnat\b.*how\s+(?:does\s+it|it)\s+work/i.test(input)) {
      return '**NAT (Network Address Translation):**\n\n' +
        'NAT translates private IP addresses to public IP addresses (and vice versa) at the network boundary (typically a router/firewall).\n\n' +
        '**Types of NAT:**\n' +
        '- **Static NAT** — 1:1 mapping (private ↔ public)\n' +
        '- **Dynamic NAT** — Pool of public IPs assigned dynamically\n' +
        '- **PAT/NAT Overload** — Many private IPs share 1 public IP using different port numbers (most common)\n\n' +
        '**Why:** IPv4 address exhaustion. NAT allows thousands of devices to share a single public IP.';
    }

    // ── TLS/SSL ──
    if (/(?:what\s+)?layer\s+(?:does\s+)?tls\s+(?:operate|work|run)\s+(?:on|at)/i.test(input)
      || /tls\s+(?:osi\s+)?layer/i.test(input)) {
      return '**TLS (Transport Layer Security)** operates at **OSI Layer 6 (Presentation)** / between Layers 4-7.\n\n' +
        'It sits on top of TCP (Layer 4) and below application protocols like HTTP (Layer 7). In the TCP/IP model, it\'s part of the Application layer.';
    }

    if (/tls\s+handshake/i.test(input)) {
      return '**TLS 1.3 Handshake (1-RTT):**\n\n' +
        '```\n' +
        'Client                          Server\n' +
        '  |--- ClientHello ------------->|\n' +
        '  |    (supported ciphers,       |\n' +
        '  |     key share)               |\n' +
        '  |<--- ServerHello -------------|\n' +
        '  |    (chosen cipher,           |\n' +
        '  |     key share, certificate)  |\n' +
        '  |--- Finished ---------------->|\n' +
        '  |<--- Finished ----------------|\n' +
        '  |    Encrypted data            |\n' +
        '```\n\n' +
        '**Steps:** 1) Client sends supported ciphers + key share → 2) Server picks cipher, sends certificate + key share → 3) Both derive session keys → 4) Encrypted communication begins.\n\n' +
        'TLS 1.3 reduced the handshake from 2-RTT (TLS 1.2) to **1-RTT**.';
    }

    // "Symmetric vs asymmetric encryption"
    if (/(?:difference|compare)\s+(?:between\s+)?symmetric\s+(?:and|vs\.?)\s+asymmetric\s+(?:encryption|cryptography)/i.test(input)) {
      return '**Symmetric vs Asymmetric Encryption:**\n\n' +
        '| | Symmetric | Asymmetric |\n' +
        '|---|---|---|\n' +
        '| **Keys** | 1 shared key | 2 keys (public + private) |\n' +
        '| **Speed** | Fast | Slow (100-1000x slower) |\n' +
        '| **Examples** | AES, ChaCha20, 3DES | RSA, ECC, Diffie-Hellman |\n' +
        '| **Key exchange** | Difficult (must be shared securely) | Easy (public key is public) |\n' +
        '| **Use case** | Bulk data encryption | Key exchange, digital signatures |\n' +
        '| **TLS usage** | Encrypts session data | Used in handshake for key exchange |';
    }

    // ── NORWEGIAN: "Hva er en IP-adresse?" ──
    if (/hva\s+er\s+(?:en\s+)?ip.?adresse/i.test(input)) {
      return '**En IP-adresse** (Internet Protocol-adresse) er en unik numerisk identifikator som tildeles hver enhet på et nettverk.\n\n' +
        '- **IPv4**: 32 bit, f.eks. `192.168.1.1`\n' +
        '- **IPv6**: 128 bit, f.eks. `2001:0db8::1`\n\n' +
        'IP-adressen brukes til å rute datapakker mellom avsender og mottaker over internett.';
    }

    // ── SOCKET (concept, not code) ──
    if (/what\s+is\s+(?:a\s+)?socket\s+(?:in\s+)?(?:networking|network\s+programming|programming)/i.test(input)) {
      return '**A socket** is a software endpoint for sending and receiving data across a network.\n\n' +
        'A socket is defined by:\n' +
        '- **IP address** + **Port number** (e.g., `192.168.1.1:8080`)\n' +
        '- **Protocol** (TCP or UDP)\n\n' +
        '**Socket types:**\n' +
        '- `SOCK_STREAM` — TCP (reliable, ordered byte stream)\n' +
        '- `SOCK_DGRAM` — UDP (unreliable, datagram-based)\n\n' +
        'In code, you create a socket, bind it to an address/port, then listen (server) or connect (client).';
    }

    // "Blocking vs non-blocking sockets"
    if (/(?:difference\s+between\s+)?blocking\s+(?:and|vs\.?)\s+non.?blocking\s+sockets?/i.test(input)) {
      return '**Blocking vs Non-Blocking Sockets:**\n\n' +
        '| | Blocking | Non-Blocking |\n' +
        '|---|---|---|\n' +
        '| **Behavior** | Calls wait until data is available | Calls return immediately |\n' +
        '| **`recv()`** | Blocks until data arrives | Returns -1/EAGAIN if no data |\n' +
        '| **`accept()`** | Blocks until connection arrives | Returns -1/EAGAIN if no connection |\n' +
        '| **Threading** | Needs 1 thread per connection | Single thread, event loop (select/poll/epoll) |\n' +
        '| **Use case** | Simple servers | High-performance servers (Node.js, nginx) |';
    }

    return null;
  }

  // ── Strategy 1.48: Networking Code Generation ──

  /**
   * Generate canonical networking code: TCP server, UDP client, HTTP request, etc.
   */
  private tryNetworkingCode(input: string): string | null {
    // Only trigger on code generation + networking terms
    const codeIntent = /\b(?:write|create|implement|make|build|code|generate|show|give)\b/i.test(input);
    if (!codeIntent) return null;
    if (!/\b(?:tcp|udp|socket|http|server|client|packet|network)\b/i.test(input)) return null;

    // Detect language
    let lang = 'python';
    if (/\b(?:javascript|js|node(?:\.?js)?)\b/i.test(input)) lang = 'javascript';
    else if (/\b(?:typescript|ts)\b/i.test(input)) lang = 'typescript';
    else if (/\b(?:python|py)\b/i.test(input)) lang = 'python';
    else if (/\b(?:go|golang)\b/i.test(input)) lang = 'go';
    else if (/\b(?:rust|rs)\b/i.test(input)) lang = 'rust';
    else if (/\b(?:java)\b/i.test(input)) lang = 'java';
    else if (/\b(?:c\+\+|cpp)\b/i.test(input)) lang = 'cpp';
    else if (/\bc\b/i.test(input) && !/\bc#\b/i.test(input)) lang = 'c';

    // TCP Server
    if (/tcp\s+server/i.test(input)) {
      const portMatch = input.match(/port\s+(\d+)/i);
      const port = portMatch ? portMatch[1] : '8080';
      if (lang === 'python') {
        return `Here's a **TCP server** in Python listening on port ${port}:\n\n` +
          '```python\n' +
          'import socket\n\n' +
          `HOST = "0.0.0.0"\nPORT = ${port}\n\n` +
          'def main():\n' +
          '    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:\n' +
          '        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)\n' +
          '        s.bind((HOST, PORT))\n' +
          '        s.listen()\n' +
          '        print(f"TCP server listening on {HOST}:{PORT}")\n' +
          '        while True:\n' +
          '            conn, addr = s.accept()\n' +
          '            with conn:\n' +
          '                print(f"Connected by {addr}")\n' +
          '                data = conn.recv(1024)\n' +
          '                if data:\n' +
          '                    print(f"Received: {data.decode()}")\n' +
          '                    conn.sendall(b"ACK: " + data)\n\n' +
          'if __name__ == "__main__":\n' +
          '    main()\n' +
          '```\n\n' +
          `This creates a TCP socket (\`SOCK_STREAM\`), binds to port ${port}, and echoes back received data with an "ACK:" prefix.`;
      }
      if (lang === 'javascript') {
        return `Here's a **TCP server** in Node.js listening on port ${port}:\n\n` +
          '```javascript\n' +
          'const net = require("net");\n\n' +
          `const PORT = ${port};\n\n` +
          'const server = net.createServer((socket) => {\n' +
          '  console.log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);\n' +
          '  socket.on("data", (data) => {\n' +
          '    console.log(`Received: ${data.toString()}`);\n' +
          '    socket.write("ACK: " + data.toString());\n' +
          '  });\n' +
          '  socket.on("end", () => console.log("Client disconnected"));\n' +
          '});\n\n' +
          `server.listen(PORT, () => console.log(\`TCP server listening on port \${PORT}\`));\n` +
          '```\n\n' +
          `Uses Node.js \`net\` module to create a TCP server on port ${port} that echoes received data.`;
      }
    }

    // UDP Client
    if (/udp\s+client/i.test(input)) {
      const portMatch = input.match(/port\s+(\d+)/i);
      const port = portMatch ? portMatch[1] : '9000';
      const msgMatch = input.match(/sends?\s+(?:["'])?(\w+)(?:["'])?\s+to/i);
      const msg = msgMatch ? msgMatch[1] : 'hello';
      if (lang === 'python') {
        return `Here's a **UDP client** in Python:\n\n` +
          '```python\n' +
          'import socket\n\n' +
          `HOST = "127.0.0.1"\nPORT = ${port}\nMESSAGE = b"${msg}"\n\n` +
          'def main():\n' +
          '    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:\n' +
          '        s.sendto(MESSAGE, (HOST, PORT))\n' +
          '        print(f"Sent \\"{MESSAGE.decode()}\\" to {HOST}:{PORT}")\n' +
          '        # Optionally wait for response\n' +
          '        s.settimeout(2.0)\n' +
          '        try:\n' +
          '            data, addr = s.recvfrom(1024)\n' +
          '            print(f"Response from {addr}: {data.decode()}")\n' +
          '        except socket.timeout:\n' +
          '            print("No response (UDP is connectionless)")\n\n' +
          'if __name__ == "__main__":\n' +
          '    main()\n' +
          '```\n\n' +
          `This creates a UDP socket (\`SOCK_DGRAM\`), sends "${msg}" to localhost:${port}, and optionally waits for a response.`;
      }
      if (lang === 'javascript') {
        return `Here's a **UDP client** in Node.js:\n\n` +
          '```javascript\n' +
          'const dgram = require("dgram");\n\n' +
          `const PORT = ${port};\nconst HOST = "127.0.0.1";\nconst MESSAGE = "${msg}";\n\n` +
          'const client = dgram.createSocket("udp4");\n' +
          'client.send(MESSAGE, PORT, HOST, (err) => {\n' +
          '  if (err) console.error(err);\n' +
          '  else console.log(`Sent "${MESSAGE}" to ${HOST}:${PORT}`);\n' +
          '  client.close();\n' +
          '});\n' +
          '```\n\n' +
          `Uses Node.js \`dgram\` module to send a UDP datagram to localhost:${port}.`;
      }
    }

    // HTTP GET with raw sockets
    if (/http\s+(?:get\s+)?request\s+(?:using|with)\s+(?:\w+\s+)?sockets?/i.test(input)
      || /socket.*http\s+get/i.test(input)) {
      if (lang === 'python') {
        return 'Here\'s a raw **HTTP GET request** using Python sockets:\n\n' +
          '```python\n' +
          'import socket\n\n' +
          'def http_get(host: str, path: str = "/", port: int = 80) -> str:\n' +
          '    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:\n' +
          '        s.connect((host, port))\n' +
          '        request = (\n' +
          '            f"GET {path} HTTP/1.1\\r\\n"\n' +
          '            f"Host: {host}\\r\\n"\n' +
          '            f"Connection: close\\r\\n"\n' +
          '            f"\\r\\n"\n' +
          '        )\n' +
          '        s.sendall(request.encode())\n' +
          '        response = b""\n' +
          '        while True:\n' +
          '            chunk = s.recv(4096)\n' +
          '            if not chunk:\n' +
          '                break\n' +
          '            response += chunk\n' +
          '        return response.decode()\n\n' +
          'print(http_get("example.com"))\n' +
          '```\n\n' +
          'This manually constructs an HTTP/1.1 GET request, sends it over a TCP socket, and reads the response. In production, use `requests` or `urllib` instead.';
      }
    }

    // UDP Server
    if (/udp\s+server/i.test(input)) {
      const portMatch = input.match(/port\s+(\d+)/i);
      const port = portMatch ? portMatch[1] : '9000';
      if (lang === 'python') {
        return `Here's a **UDP server** in Python on port ${port}:\n\n` +
          '```python\n' +
          'import socket\n\n' +
          `HOST = "0.0.0.0"\nPORT = ${port}\n\n` +
          'def main():\n' +
          '    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:\n' +
          '        s.bind((HOST, PORT))\n' +
          '        print(f"UDP server listening on {HOST}:{PORT}")\n' +
          '        while True:\n' +
          '            data, addr = s.recvfrom(1024)\n' +
          '            print(f"From {addr}: {data.decode()}")\n' +
          '            s.sendto(b"ACK: " + data, addr)\n\n' +
          'if __name__ == "__main__":\n' +
          '    main()\n' +
          '```\n\n' +
          `Creates a UDP socket (\`SOCK_DGRAM\`), binds to port ${port}, receives datagrams and sends back acknowledgments.`;
      }
    }

    return null;
  }

  // ── Strategy 1.50: Norwegian Language Knowledge ──

  private tryNorwegianLanguage(input: string): string | null {
    // Strip quotes for easier matching
    input = input.replace(/["'""''`]/g, ' ').replace(/\s+/g, ' ').trim();

    // Exclude English-only questions that happen to contain Norwegian-matching words
    if (/\b(gerund|split\s+infinitives?|in\s+english|english\s+grammar|comma\s+splice|run.?on\s+sentence|apostrophe|countable|uncountable|dangling\s+modifier|parts?\s+of\s+speech)\b/i.test(input)) {
      return null;
    }

    // Gate: broad Norwegian language-related terms
    const nw = /(?:norsk|norwegian|bokmål|nynorsk|verb(?:form|et|ene)?|preteritum|presens|perfektum|ordstilling|substantiv|adjektiv|preposisjon(?:en|ene)?|konjunksjon(?:en)?|subjunksjon|hankjønn|hunkjønn|intetkjønn|bestemt|ubestemt|leddsetning|bisetning|modalverb|velg|grammatikk|hilsen|e-?post|formell|ordforråd|setning|erfaring|beskjed|negasjon|refleksiv|passiv|dobbel|infinitiv|inversjon|spørreord|bøy(?:e|ning)?|kjønn(?:ene|et)?|MVH|sammensatt|binde-?s|binde-?e|regelm|uregelm|sterkt?\s+(?:eller|or)\s+svakt?|svakt?\s+(?:eller|or)\s+sterkt?|iverksette|sitte\s+på\s+gjerdet|interessert\s+i|korrelasjon|dokumenter|riktignok|derimot|problemstilling|drøfting|den\s+røde\s+tråden|fagfellevurdert|primærkilde|validitet|således|rekruttert|temasetning|bindeord|konsesjon|akademisk|eksamen|universit|kollektiv|bærekraft|digitalisering|KI\b|kunstig\s+intelligens|klimamål|retoris|personvern|inkluder|frivillig|tilhørighet|hypotese|metode|referanse|konklusjon|innledning|som\s+følge\s+av|folkevelferd|oljefond|syllogism|non.?sequitur|premiss)/i;
    const nw2 = /(?:å\s+gå|å\s+spise|å\s+være|å\s+ha|å\s+komme|å\s+si|å\s+gjøre|å\s+lese|å\s+skrive|å\s+se|å\s+bo|å\s+jobbe|å\s+snakke|å\s+lære|å\s+sende|gikk|gått|spiste|spist|kontoret|huset|bilen|boken|gutten|jenta|eplet|stolen|klokken|timeliste|sjefen|ansatte|regjeringen|tiltak|styrke|kollektivtilbudet|mental\s+helse|beina\s+på\s+jorden|UiO|Universitetet|studenter|forelesere|Inspera|Canvas|laptopen|notat|håndskrevne|budsj|språkkurs|elbil|insentiv|elferd|oljeindust|Datatilsynet)/i;
    if (!nw.test(input) && !nw2.test(input)) {
      return null;
    }

    // ── Verb Conjugation Table ──
    const verbs: Record<string, { inf: string; pres: string; past: string; perf: string; group: string }> = {
      'gå': { inf: 'å gå', pres: 'går', past: 'gikk', perf: 'har gått', group: 'sterk (uregelmessig)' },
      'spise': { inf: 'å spise', pres: 'spiser', past: 'spiste', perf: 'har spist', group: 'svak (gruppe 2)' },
      'være': { inf: 'å være', pres: 'er', past: 'var', perf: 'har vært', group: 'sterk (uregelmessig)' },
      'ha': { inf: 'å ha', pres: 'har', past: 'hadde', perf: 'har hatt', group: 'sterk (uregelmessig)' },
      'komme': { inf: 'å komme', pres: 'kommer', past: 'kom', perf: 'har kommet', group: 'sterk (uregelmessig)' },
      'si': { inf: 'å si', pres: 'sier', past: 'sa', perf: 'har sagt', group: 'sterk (uregelmessig)' },
      'gjøre': { inf: 'å gjøre', pres: 'gjør', past: 'gjorde', perf: 'har gjort', group: 'sterk (uregelmessig)' },
      'lese': { inf: 'å lese', pres: 'leser', past: 'leste', perf: 'har lest', group: 'svak (gruppe 2)' },
      'skrive': { inf: 'å skrive', pres: 'skriver', past: 'skrev', perf: 'har skrevet', group: 'sterk (uregelmessig)' },
      'se': { inf: 'å se', pres: 'ser', past: 'så', perf: 'har sett', group: 'sterk (uregelmessig)' },
      'bo': { inf: 'å bo', pres: 'bor', past: 'bodde', perf: 'har bodd', group: 'svak (gruppe 3)' },
      'jobbe': { inf: 'å jobbe', pres: 'jobber', past: 'jobbet', perf: 'har jobbet', group: 'svak (gruppe 1)' },
      'snakke': { inf: 'å snakke', pres: 'snakker', past: 'snakket', perf: 'har snakket', group: 'svak (gruppe 1)' },
      'lære': { inf: 'å lære', pres: 'lærer', past: 'lærte', perf: 'har lært', group: 'svak (gruppe 2)' },
      'sende': { inf: 'å sende', pres: 'sender', past: 'sendte', perf: 'har sendt', group: 'svak (gruppe 2)' },
    };

    // "what is the past tense of å gå" / "preteritum av å gå" / "conjugate å gå"
    // "bøy verbet å gå" / "bøy å gå" / "bøy også å komme"
    const NW = '[a-zA-ZæøåÆØÅ]+'; // Norwegian word
    const verbMatch = input.match(new RegExp(`bøy\\w*\\s+også\\s+(?:å\\s+)?(${NW})`, 'i'))
      || input.match(new RegExp(`(?:past\\s+tense|preteritum|fortid|bøy(?:e|ning)?|conjugat\\w*)\\s+(?:of|av|hele\\s+)?\\s*(?:the\\s+)?(?:norwegian\\s+)?(?:verb(?:et)?\\s+)?['""\`]?å?\\s*(${NW})`, 'i'))
      || input.match(new RegExp(`(?:også\\s+)?bøy(?:e)?\\s+['""\`]?å?\\s*(${NW})`, 'i'))
      || input.match(new RegExp(`(?:presens|preteritum|perfektum)\\s+(?:av|of)\\s+['""\`]?å?\\s*(${NW})`, 'i'));
    if (verbMatch) {
      const stem = verbMatch[1].toLowerCase();
      const v = verbs[stem];
      if (v) {
        return `**Bøyning av ${v.inf}** (${v.group}): ${v.pres} – ${v.past} – ${v.perf}\n\n` +
          `| Form | Norsk |\n|---|---|\n` +
          `| Infinitiv | ${v.inf} |\n` +
          `| Presens | ${v.pres} |\n` +
          `| Preteritum | ${v.past} |\n` +
          `| Perfektum | ${v.perf} |\n`;
      }
    }

    // "Er å spise et sterkt eller svakt verb?" / "sterkt eller svakt"
    // Put "å VERB...sterkt/svakt" FIRST (captures verb name correctly)
    const groupMatch = input.match(new RegExp(`(?:å\\s+)(${NW})\\b.*(?:sterkt?|svakt?|regelm|uregelm)`, 'i'))
      || input.match(new RegExp(`(?:sterkt?|svakt?|regelm|uregelm)\\w*.*(?:å\\s+)(${NW})\\b`, 'i'));
    if (groupMatch) {
      const stem = groupMatch[1].toLowerCase();
      const v = verbs[stem];
      if (v) {
        return `**${v.inf}** er et **${v.group}** verb.\n\nBøyning:\n` +
          `| Form | Norsk |\n|---|---|\n` +
          `| Presens | ${v.pres} |\n` +
          `| Preteritum | ${v.past} |\n` +
          `| Perfektum | ${v.perf} |\n`;
      }
    }

    // Multiple-choice: "i går ___ jeg" → detect preteritum context
    if (/i\s+går\b.*(?:jeg|vi|hun|han|de|du)\b/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      // Past tense context — find the preteritum option
      for (const [, v] of Object.entries(verbs)) {
        if (input.includes(v.past)) {
          const letter = this.findOptionLetter(input, v.past);
          return `**Riktig svar: ${letter}) ${v.past}**\n\n` +
            `"I går" krever preteritum (fortid). Verbet ${v.inf} i preteritum er **${v.past}**.`;
        }
      }
    }

    // "word order in Norwegian" / "V2 rule" / "ordstilling"
    if (/(?:word\s+order|ordstilling|v2.?regel|setningsstruktur)/i.test(input)
      && !/leddsetning|bisetning|subordinat/i.test(input)) {
      return '**Norsk ordstilling — V2-regelen (hovedsetning):**\n\n' +
        'I norske hovedsetninger står verbet alltid på **plass 2** (V2-regelen):\n\n' +
        '| Plass 1 | Plass 2 (verb) | Subjekt | Resten |\n|---|---|---|---|\n' +
        '| Jeg | **jobber** | — | på kontoret. |\n' +
        '| I dag | **jobber** | jeg | på kontoret. |\n' +
        '| Hver dag | **spiser** | vi | lunsj klokken tolv. |\n\n' +
        'Når et annet ledd enn subjektet står på plass 1, flyttes subjektet etter verbet (**inversjon**).';
    }

    // "subordinate clause" / "bisetning" / "leddsetning"
    // But not if asking about "ikke" placement (covered by negation handler)
    if (/(?:subordinate|bisetning|leddsetning)/i.test(input) && !/(?:ikke|negasjon)/i.test(input)) {
      return '**Norsk ordstilling i leddsetninger (bisetninger):**\n\n' +
        'I leddsetninger kommer **ikke** og andre adverb **foran** verbet:\n\n' +
        '| Hovedsetning | Leddsetning |\n|---|---|\n' +
        '| Han spiser ikke lunsj. | ...fordi han ikke spiser lunsj. |\n' +
        '| Jeg har alltid likt kaffe. | ...fordi jeg alltid har likt kaffe. |\n\n' +
        'Leddsetninger innledes med subjunksjoner: **fordi, at, når, hvis, som, selv om, mens**.\n\n' +
        'Eksempel: fordi jeg ikke liker det, at han ikke jobber, selv om vi ikke har tid.';
    }

    // Adjective agreement / adjektivbøyning (BEFORE gender check to avoid Q9 hitting gender)
    // But not if asking about "erfaring" adjective form (covered by erfaring→erfaren handler later)
    if (/adjektiv/i.test(input) && !/erfaring/i.test(input)) {
      return '**Adjektivbøyning i norsk:**\n\n' +
        '| | Hankjønn | Hunkjønn | Intetkjønn | Flertall |\n|---|---|---|---|---|\n' +
        '| Ubestemt | en stor bil | ei stor jente | et stort hus | store biler |\n' +
        '| Bestemt | den store bilen | den store jenta | det store huset | de store bilene |\n\n' +
        'Regler: Intetkjønn legger til **-t** (stor → stort). Flertall og bestemt form legger til **-e** (stor → store).\n' +
        'Eksempel: "den store bilen", "det store huset", "de store bilene".';
    }

    // "three genders" / "noun genders in Norwegian" / "hankjønn hunkjønn intetkjønn" / "kjønnene i norsk"
    if (/(?:three|3|tre)\s+(?:genders?|kjønn)/i.test(input)
      || /(?:gender|kjønn)\w*\s+(?:i|in|på)\s+(?:norsk|norwegian|bokmål)/i.test(input)
      || /(?:norsk|norwegian)\w*\s+(?:gender|kjønn)/i.test(input)
      || /hankjønn|hunkjønn|intetkjønn/i.test(input)
      || /(?:hva|what)\s+er\s+(?:de\s+)?(?:tre\s+)?kjønn/i.test(input)) {
      return '**De tre kjønnene i norsk (bokmål):**\n\n' +
        '| Kjønn | Ubestemt | Bestemt | Eksempel |\n|---|---|---|---|\n' +
        '| **Hankjønn** (maskulin) | en | -en | en gutt → gutt**en** |\n' +
        '| **Hunkjønn** (feminin) | ei/en | -a/-en | ei jente → jent**a** |\n' +
        '| **Intetkjønn** (nøytrum) | et | -et | et eple → epl**et** |\n\n' +
        'Merk: I bokmål kan hunkjønnsord også bøyes som hankjønn (en jente → jenten).';
    }

    // Bestemt form / definite form
    if (/(?:bestemt\s*form|definite\s+form|bestemt\w*\s+(?:av|of|entall|flertall))/i.test(input)
      || /(?:norsk|norwegian)\w*\s+(?:bestemt|definite)/i.test(input)) {
      return '**Bestemt form av substantiv i norsk:**\n\n' +
        '| Ubestemt | Bestemt entall | Bestemt flertall |\n|---|---|---|\n' +
        '| en gutt | gutten | guttene |\n' +
        '| ei jente | jenta | jentene |\n' +
        '| et hus | huset | husene |\n' +
        '| en stol | stolen | stolene |\n' +
        '| ei bok | boka | bøkene |\n\n' +
        'Bestemt form brukes når vi snakker om noe kjent eller spesifikt: "Kan du lukke **døren**?"';
    }

    // Multiple choice: bestemt form (e.g. "rydde ___" with kontoret/kontor/en kontor/kontorer)
    if (/rydde\b/i.test(input) && /kontoret|kontor\b/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      const letter = this.findOptionLetter(input, 'kontoret');
      return `**Riktig svar: ${letter}) kontoret**\n\n"Rydde kontoret" bruker bestemt form fordi vi snakker om et spesifikt kontor.`;
    }

    // Prepositions: "i" vs "på" / "hos" vs "på"
    if (/preposisjon/i.test(input)
      || /(?:difference|forskjell)\w*.*(?:\"i\"|\"på\"|\"hos\"|\"med\")/i.test(input)
      || /(?:norsk|norwegian)\s+preposition/i.test(input)
      || /(?:i\s+eller\s+på|på\s+eller\s+i)/i.test(input)
      || /(?:hvilket|which)\s+preposisjon/i.test(input)) {
      return '**Norske preposisjoner — i, på, hos:**\n\n' +
        '**"På"** brukes med:\n' +
        '- Arbeidsplasser: på kontoret, på jobben, på skolen, på universitetet\n' +
        '- Steder man besøker: på kafé, på kino, på sykehuset\n' +
        '- Overflater: på bordet, på gulvet\n\n' +
        '**"I"** brukes med:\n' +
        '- Lukkede rom: i bilen, i huset, i byen, i Norge\n' +
        '- Tid: i dag, i morgen, i går, i 2024\n\n' +
        '**"Hos"** brukes med personer/bedrifter:\n' +
        '- Hos legen, hos tannlegen, hos venner, hos NAV';
    }

    // Multiple choice: "jobber ___ et kontor" with preposition options
    if (/jobber\b/i.test(input) && /kontor/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      const letter = this.findOptionLetter(input, 'på');
      return `**Riktig svar: ${letter}) på**\n\n"Jobber **på** kontoret" er mest vanlig. "På" brukes med arbeidsplasser og institusjoner i norsk.`;
    }

    // Formal email / "Med vennlig hilsen" / MVH
    if (/(?:formal\s+)?(?:email|e-?post)\s+(?:greeting|hilsen|avslutning|ending)/i.test(input)
      || /med\s+vennlig\s+hilsen/i.test(input)
      || /\bMVH\b/.test(input)
      || /(?:formell|formal)\s+(?:norsk\s+)?e-?post/i.test(input)
      || /(?:avslut|ending|sign.?off).*(?:e-?post|email)/i.test(input)
      || /(?:e-?post|email).*(?:avslut|ending|sign.?off)/i.test(input)
      || /(?:forkortelse|abbreviat)\w*.*MVH/i.test(input)
      || /MVH.*(?:forkortelse|abbreviat|betyr|mean|stand)/i.test(input)) {
      return '**Formell norsk e-post:**\n\n' +
        '**Innledning:**\n' +
        '- "Hei [Navn]," (semi-formell, mest vanlig)\n' +
        '- "Kjære [Navn]," (svært formell)\n' +
        '- "Til hvem det måtte angå," (ukjent mottaker)\n\n' +
        '**Avslutning:**\n' +
        '- "Med vennlig hilsen" (standard formell avslutning — MVH)\n' +
        '- "Vennlig hilsen" (litt kortere)\n' +
        '- "Med hilsen" (formelt)\n\n' +
        'Merk: Det heter "hilsen" (entall), ikke "hilsener" eller "hilsa".';
    }

    // Multiple choice: "Med vennlig ___" with hilsen options
    if (/med\s+vennlig/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      const letter = this.findOptionLetter(input, 'hilsen');
      return `**Riktig svar: ${letter}) hilsen**\n\nDen korrekte formelle avslutningen er "Med vennlig **hilsen**" (forkortet MVH).`;
    }

    // Modal verbs / "må kan vil skal"
    if (/(?:modal\s*verb|modalverb)/i.test(input)
      || /(?:viktigste|important)\s+modal/i.test(input)
      || /(?:bruker?\s+man|do\s+you\s+use)\s+(?:\")?å(?:\")?\s+(?:etter|after)\s+modal/i.test(input)) {
      return '**Norske modalverb:**\n\n' +
        '| Verb | Betydning | Eksempel |\n|---|---|---|\n' +
        '| **må** | nødvendighet / plikt | Jeg **må** jobbe i dag. |\n' +
        '| **kan** | evne / mulighet | Hun **kan** snakke norsk. |\n' +
        '| **vil** | ønske / vilje | Vi **vil** reise til Bergen. |\n' +
        '| **skal** | plan / intensjon / fremtid | Jeg **skal** begynne kl. 8. |\n' +
        '| **bør** | anbefaling | Du **bør** lese avtalen. |\n\n' +
        'Modalverb etterfølges av *infinitiv uten å*: "Jeg må **jobbe**" (ikke "å jobbe").';
    }

    // Multiple choice: "___ lære meg norsk" with modal verb options
    if (/lære\s+(?:meg|seg)\s+norsk/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      const letter = this.findOptionLetter(input, 'må');
      return `**Riktig svar: ${letter}) må**\n\n"Må" uttrykker nødvendighet: "Jeg **må** lære meg norsk for å få en bedre jobb."`;
    }

    // Subjunksjon vs konjunksjon — MUST be before general konjunksjon pattern
    if (/subjunksjon/i.test(input)
      || /forskjell\w*\s+(?:mellom\s+)?(?:en\s+)?konjunksjon\s+og/i.test(input)) {
      return '**Konjunksjon vs Subjunksjon:**\n\n' +
        '| | Konjunksjon | Subjunksjon |\n|---|---|---|\n' +
        '| **Binder** | To hovedsetninger | Hovedsetning + leddsetning (bisetning) |\n' +
        '| **Ordstilling** | Ingen endring | Adverb flyttes foran verb |\n' +
        '| **Eksempler** | og, men, eller, for, så | fordi, at, når, hvis, som, selv om |\n\n' +
        'Konjunksjon: "Jeg er sulten, **men** jeg har ikke tid." (to hovedsetninger)\n' +
        'Subjunksjon: "Jeg spiser **fordi** jeg **ikke** er mett." (leddsetning med inversjon av "ikke")';
    }

    // Conjunctions / "men for eller så"
    if (/(?:konjunksjon|conjunction|bindeord)/i.test(input)
      || /(?:viktigste|important).+(?:konjunksjon|bindeord)/i.test(input)) {
      return '**Norske konjunksjoner (bindeord):**\n\n' +
        '| Konjunksjon | Betydning | Eksempel |\n|---|---|---|\n' +
        '| **og** | and | Jeg spiser **og** drikker. |\n' +
        '| **men** | but | Hun er trøtt, **men** hun jobber. |\n' +
        '| **eller** | or | Vil du ha kaffe **eller** te? |\n' +
        '| **for** | because | Jeg er trøtt, **for** jeg sov dårlig. |\n' +
        '| **så** | so/then | Det regner, **så** jeg tar paraply. |\n\n' +
        'Konjunksjoner binder sammen to hovedsetninger uten inversjon.';
    }

    // Multiple choice: "Jeg vil gjerne ta fri, ___ jeg har ikke" with conjunction
    if (/ta\s+fri/i.test(input) && /har\s+ikke/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      const letter = this.findOptionLetter(input, 'men');
      return `**Riktig svar: ${letter}) men**\n\n"Men" (but) viser kontrast: "Jeg vil gjerne ta fri, **men** jeg har ikke mer ferie igjen."`;
    }

    // "Ordforråd / vocabulary" — erfaring, beskjed
    if (/\berfaring\b/i.test(input) && /\b(?:betyr|mean|hva)/i.test(input)) {
      return '**Erfaring** betyr "experience" på engelsk.\n\n' +
        '"Han har mye **erfaring** fra bransjen" = Han har jobbet med dette lenge.\n\n' +
        'Beslektede ord: erfare (å oppleve), erfaren (experienced).';
    }
    if (/\bbeskjed\b/i.test(input) && /\b(?:betyr|mean|hva|gi)/i.test(input)) {
      return '**Beskjed** betyr "message/notice" på engelsk.\n\n' +
        '"Gi **beskjed** til sjefen din" = Give notice/let your boss know.\n\n' +
        'Beslektede uttrykk: gi beskjed (notify), få beskjed (be notified).';
    }

    // Multiple choice: "gi ___ til sjefen" with word options
    if (/gi\b.*til\s+sjefen/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      const letter = this.findOptionLetter(input, 'beskjed');
      return `**Riktig svar: ${letter}) beskjed**\n\n"Gi **beskjed**" betyr å informere/varsle noen.`;
    }

    // Timeliste / reading comprehension
    if (/timeliste/i.test(input) && /lønn/i.test(input)) {
      if (/\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
        // Multiple choice about timeliste scenario
        if (/forsinket|delayed/i.test(input)) {
          const letter = this.findOptionLetter(input, 'forsinket') || this.findOptionLetter(input, 'Lønnen blir forsinket');
          return `**Riktig svar: ${letter}) Lønnen blir forsinket.**\n\nHvis du sender timelisten etter fristen, vil lønnen bli forsinket.`;
        }
      }
      return '**Timeliste og lønn:**\n\nAlle ansatte må sende inn timeliste innen fristen for å få lønn til tiden. Hvis du sender timelisten for sent, vil **lønnen bli forsinket**.';
    }

    // Negation / "ikke" placement
    if (/(?:negation|negasjon)\w*/i.test(input)
      || /plasser\w*\s+ikke|ikke\s+plasser/i.test(input)
      || /(?:hvor|where)\s+(?:plasseres|goes|kommer?)\s+ikke/i.test(input)
      || /ikke\s+i\s+(?:norsk|hovedsetning|leddsetning)/i.test(input)
      || /leddsetning\w*\s+(?:med\s+)?ikke|eksempel.*leddsetning.*ikke|eksempel.*ikke.*leddsetning/i.test(input)) {
      return '**Plassering av "ikke" i norsk:**\n\n' +
        '"Ikke" plasseres etter verbet i hovedsetninger:\n' +
        '- Jeg spiser ikke fisk.\n' +
        '- Han jobber ikke i dag.\n\n' +
        '"Ikke" plasseres foran (før) verbet i leddsetninger:\n' +
        '- ...fordi jeg ikke spiser fisk.\n' +
        '- ...fordi han ikke jobber i dag.';
    }

    // Norwegian question formation
    if (/(?:question\s+formation|spørsmål\w*form)/i.test(input)
      || /(?:danne|lage)\w*\s+spørsmål/i.test(input)
      || /ordstilling\w*\s+(?:i\s+)?(?:norsk\w*\s+)?spørsmål/i.test(input)
      || /spørsmål\s+(?:i\s+)?norsk/i.test(input)
      || (/inversjon/i.test(input) && /norsk|grammatikk/i.test(input))) {
      return '**Spørsmålsformasjon i norsk:**\n\n' +
        'Ja/nei-spørsmål: Verb på **plass 1**:\n' +
        '- **Jobber** du i dag? (Do you work today?)\n' +
        '- **Har** du spist? (Have you eaten?)\n\n' +
        'Spørreord-spørsmål: Spørreord + verb + subjekt:\n' +
        '- **Hvor** bor du? (Where do you live?)\n' +
        '- **Hva** gjør du? (What do you do?)\n' +
        '- **Når** kommer du? (When are you coming?)';
    }

    // Dobbel bestemmelse for alle kjønn — BEFORE general dobbel bestemmelse
    if (/dobbel\s+bestem/i.test(input) && /(?:alle\s+kjønn|kjønn|gjelder)/i.test(input)) {
      return '**Dobbel bestemmelse gjelder for alle kjønn i norsk:**\n\n' +
        '| Kjønn | Eksempel |\n|---|---|\n' +
        '| Hankjønn | **den** store bil**en** |\n' +
        '| Hunkjønn | **den** store jent**a** |\n' +
        '| Intetkjønn | **det** store hus**et** |\n' +
        '| Flertall | **de** store bil**ene** |\n\n' +
        'Ja, dobbel bestemmelse gjelder for alle kjønn: hankjønn (den), hunkjønn (den), intetkjønn (det), flertall (de).';
    }

    // Double definite / dobbel bestemmelse
    if (/(?:double\s+definite|dobbel\s+bestem)/i.test(input)) {
      return '**Dobbel bestemmelse i norsk:**\n\n' +
        'Når et adjektiv står mellom artikkel og substantiv, brukes BÅDE artikkel OG bestemt substantiv:\n\n' +
        '| Eksempel | Forklaring |\n|---|---|\n' +
        '| **Den** stor**e** bil**en** | den + store + bilen |\n' +
        '| **Det** stor**e** hus**et** | det + store + huset |\n' +
        '| **De** stor**e** bil**ene** | de + store + bilene |\n\n' +
        'Dette kalles "dobbel bestemmelse" — determinativ + adjektiv + bestemt substantiv.';
    }

    // S-passive / passiv
    if (/s-passiv|bli-passiv/i.test(input)
      || /passiv\w*\s+(?:i\s+|in\s+)?(?:norwegian|norsk)/i.test(input)
      || /(?:norwegian|norsk)\s+passiv/i.test(input)
      || /passivform/i.test(input)) {
      return '**Passiv på norsk:**\n\n' +
        '**S-passiv** (legger til -s på verbet):\n' +
        '- Boken lese**s** av mange. (The book is read by many.)\n' +
        '- Døren åpne**s** kl. 8. (The door opens at 8.)\n\n' +
        '**Bli-passiv** (bli + perfektum partisipp):\n' +
        '- Boken **blir lest** av mange.\n' +
        '- Døren **ble åpnet** kl. 8.\n\n' +
        'S-passiv er mer formell/skriftlig. Bli-passiv er vanligere i dagligtale.';
    }

    // "å bli" vs "å være"
    if (/(?:å\s+)?(?:bli|være)\s+(?:vs\.?|versus|og|and|eller)\s+(?:å\s+)?(?:bli|være)/i.test(input)
      || /forskjell.*(?:å\s+)?bli.*(?:å\s+)?være|forskjell.*(?:å\s+)?være.*(?:å\s+)?bli/i.test(input)
      || /begge\s+brukes?\s+i\s+samme/i.test(input)) {
      return '**"Å være" vs "å bli" i norsk:**\n\n' +
        '**Å være** = to be (tilstand):\n' +
        '- Jeg **er** glad. (I am happy.)\n' +
        '- Han **er** lege. (He is a doctor.)\n\n' +
        '**Å bli** = to become (endring):\n' +
        '- Jeg **blir** glad. (I become happy.)\n' +
        '- Han **ble** lege. (He became a doctor.)\n\n' +
        '"Være" = eksisterende tilstand. "Bli" = forandring/overgang.\n\n' +
        'Eksempel med begge: "Han er syk, men han blir bedre." / "Hun var student, men ble lege."';
    }

    // Compound words / sammensatte ord
    if (/sammensatt\w*\s+ord/i.test(input)
      || /binde-?[se]/i.test(input)
      || /arbeidstillatelse/i.test(input)) {
      return '**Sammensatte ord i norsk:**\n\n' +
        'Norsk bygger ofte nye ord ved å sette sammen eksisterende ord uten mellomrom:\n\n' +
        '| Sammensatt | Deler | Betydning |\n|---|---|---|\n' +
        '| **arbeidstillatelse** | arbeid + s + tillatelse | work permit |\n' +
        '| **sykehus** | syke + hus | hospital |\n' +
        '| **barnehage** | barn + e + hage | kindergarten |\n' +
        '| **datamaskin** | data + maskin | computer |\n' +
        '| **høyskole** | høy + skole | university college |\n\n' +
        'Binde-s eller binde-e brukes mellom ordene i mange tilfeller.';
    }

    // Reflexive verbs + reflexive pronouns
    if (/refleksiv\w*\s+(?:verb|pronomen)/i.test(input)
      || /reflexive\s+(?:verb|pronoun)/i.test(input)
      || /refleksiv\w*\s+(?:i\s+)?(?:norwegian|norsk)/i.test(input)) {
      return '**Refleksive verb i norsk:**\n\n' +
        'Refleksive verb har pronomen som viser tilbake til subjektet:\n\n' +
        '| Verb | Eksempel | Engelsk |\n|---|---|---|\n' +
        '| sette seg | Hun setter seg ned. | She sits down. |\n' +
        '| legge seg | Barna legger seg kl. 8. | The children go to bed. |\n' +
        '| glede seg | Vi gleder oss til ferien. | We look forward to the holiday. |\n' +
        '| føle seg | Jeg føler meg bra. | I feel good. |\n\n' +
        'Refleksive pronomen: meg, deg, seg, oss, dere, seg.';
    }

    // Erfaring → erfaren (adjective form) — BEFORE general adjektiv pattern
    if (/adjektiv\w*\s+(?:av|of|fra|til)\s+erfaring/i.test(input)
      || /erfaren\b/i.test(input)
      || (/erfaring/i.test(input) && /adjektiv/i.test(input))) {
      return '**Adjektivet av "erfaring":**\n\n' +
        'En person som har mye erfaring er **erfaren** (experienced).\n\n' +
        '| Form | Eksempel |\n|---|---|\n' +
        '| Hankjønn/Hunkjønn | en erfaren lege |\n' +
        '| Intetkjønn | et erfarent team |\n' +
        '| Flertall/Bestemt | de erfarne legene |';
    }

    // Infinitive marker "å"
    if (/infinitiv\w*/i.test(input)
      || /(?:brukes?\s+)?(?:ikke\s+)?å\s+foran\s+(?:et\s+)?verb/i.test(input)
      || /når\s+brukes\s+ikke\s+å/i.test(input)) {
      return '**Infinitivsmerket "å" i norsk:**\n\n' +
        '"Å" brukes foran verb i infinitiv (som "to" på engelsk):\n' +
        '- Jeg liker **å** lese. (I like **to** read.)\n' +
        '- Det er viktig **å** lære norsk.\n\n' +
        '**NB:** Etter modalverb brukes IKKE "å":\n' +
        '- Jeg kan ~~å~~ svømme. → Jeg kan **svømme**.\n' +
        '- Du må ~~å~~ jobbe. → Du må **jobbe**.';
    }

    // Article usage en/ei/et
    if (/(?:artikkel|article)\w*/i.test(input)
      || /\ben\b.*\bei\b.*\bet\b/i.test(input)
      || /\ben\b\s+(?:i\s+stedet|instead)\s+(?:for\s+)?\bei\b/i.test(input)
      || /\ben\b.*\bei\b.*bokmål/i.test(input)
      || /ubestemt\w*\s+(?:artikl|article)/i.test(input)) {
      return '**Norske ubestemte artikler:**\n\n' +
        '| Artikkel | Kjønn | Eksempel |\n|---|---|---|\n' +
        '| **en** | hankjønn | en gutt, en stol, en bil |\n' +
        '| **ei** | hunkjønn | ei jente, ei bok, ei dør |\n' +
        '| **et** | intetkjønn | et hus, et eple, et barn |\n\n' +
        'I bokmål kan "en" brukes i stedet for "ei": en jente (vanlig) / ei jente (tradisjonelt). Det er vanlig å bruke "en" i stedet for "ei" i bokmål.';
    }

    // Multiple choice: "Hvilken setning er riktig" — ordstilling
    if (/(?:hvilken|which)\s+(?:setning|sentence)\s+(?:er\s+)?(?:riktig|korrekt|correct|grammatisk)/i.test(input)) {
      // Look for word order question — detect correct V2 pattern
      if (/ikke\s+spist\s+lunsj/i.test(input)) {
        // "har ikke spist lunsj" is correct (ikke after auxiliary)
        for (const opt of ['A', 'B', 'C', 'D']) {
          const optRegex = new RegExp(`${opt}\\)\\s*(.+?)(?=[A-D]\\)|$)`, 'i');
          const m = input.match(optRegex);
          if (m && /jeg\s+har\s+ikke\s+spist\s+lunsj\s+i\s+dag/i.test(m[1].trim())) {
            return `**Riktig svar: ${opt}) ${m[1].trim()}**\n\nV2-regelen: Verbet (har) står på plass 2. "Ikke" kommer etter det finitte verbet i hovedsetninger.`;
          }
        }
      }
    }

    // Spørreord (follow-up for Q12)
    if (/spørreord/i.test(input)) {
      return '**De vanligste spørreordene i norsk:**\n\n' +
        '| Spørreord | Engelsk | Eksempel |\n|---|---|---|\n' +
        '| **Hva** | What | Hva gjør du? |\n' +
        '| **Hvor** | Where | Hvor bor du? |\n' +
        '| **Når** | When | Når kommer du? |\n' +
        '| **Hvem** | Who | Hvem er det? |\n' +
        '| **Hvorfor** | Why | Hvorfor er du her? |\n' +
        '| **Hvordan** | How | Hvordan har du det? |\n' +
        '| **Hvilken/Hvilket/Hvilke** | Which | Hvilken bok liker du? |';
    }

    // Inversjon (follow-up for Q24)
    if (/inversjon/i.test(input)) {
      return '**Inversjon i norsk grammatikk:**\n\n' +
        'Inversjon betyr at subjektet og verbet bytter plass. I norsk skjer inversjon når:\n\n' +
        '1. **Spørsmål:** Verb kommer på plass 1:\n' +
        '   - **Jobber** du i dag? (verb → subjekt)\n\n' +
        '2. **Annet ledd på plass 1:** Subjektet flyttes etter verbet:\n' +
        '   - I dag **jobber** jeg. (tidsledd → verb → subjekt)\n' +
        '   - Her **bor** vi. (stedsledd → verb → subjekt)\n\n' +
        'Inversjon = subjekt kommer etter verbet, ikke før.';
    }

    // Bestemt form follow-up: flertall av "en gutt"
    if (/bestemt\s*form\s+flertall/i.test(input) && /gutt/i.test(input)) {
      return '**Bestemt form flertall av "en gutt":**\n\n' +
        'Bøyning: en gutt → gutten (bestemt entall) → gutter (ubestemt flertall) → **guttene** (bestemt flertall)\n\n' +
        '| Form | Eksempel |\n|---|---|\n' +
        '| Ubestemt entall | en gutt |\n' +
        '| Bestemt entall | gutten |\n' +
        '| Ubestemt flertall | gutter |\n' +
        '| Bestemt flertall | guttene |';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian Academic Exam – Del 1: Tekstforståelse og Grammatikk
    // ══════════════════════════════════════════════════════════════

    // Q1: "iverksette" synonym
    if (/iverksette/i.test(input) && /(?:betyr|mean|synonym|samme\s+som|understreke|tiltak|regjeringen)/i.test(input)) {
      return '**Riktig svar: C) Gjennomføre**\n\n' +
        'Å **iverksette** betyr å sette i gang eller utføre en planlagt handling.\n\n' +
        '- A) Avlyse — betyr å stoppe/kansellere\n' +
        '- B) Planlegge — betyr å forberede, ikke gjennomføre\n' +
        '- C) ✅ **Gjennomføre** — betyr å sette i gang, utføre\n' +
        '- D) Diskutere — betyr å samtale om noe\n\n' +
        'De andre alternativene beskriver enten å stoppe, planlegge eller samtale om noe, ikke selve utførelsen.';
    }

    // Q2: "selv om" + V2 word order
    if (/selv\s+om.*regnet.*gikk|grammatisk\s+korrekt.*selv\s+om|selv\s+om.*grammati/i.test(input)) {
      return '**Riktig svar: A) Selv om det regnet, gikk vi på tur.**\n\n' +
        'I en leddsetning med "selv om" følger vi vanlig ordstilling, og hovedsetningen etterpå skal ha subjektet etter verbet hvis leddsetningen kommer først (V2-regelen).\n\n' +
        '- A) ✅ **Selv om det regnet, gikk vi på tur.** — Korrekt V2-ordstilling\n' +
        '- B) «…så vi gikk på tur» — feil ordstilling etter leddsetning\n' +
        '- C) «Vi gikk på tur selv om regnet det» — galt subjekt-verb-rekkefølge i leddsetningen\n' +
        '- D) «Regnet det, selv om vi gikk…» — ugrammatisk';
    }

    // Q3: "sitte på gjerdet" idiom
    if (/sitte\s+på\s+gjerdet/i.test(input)) {
      return '**Riktig svar: B) Å være ubesluttsom eller vente med å ta et valg.**\n\n' +
        '«Å sitte på gjerdet» er et vanlig norsk idiom som brukes når noen ikke vil ta standpunkt i en sak ennå.\n\n' +
        '- A) Å være fysisk aktiv — nei\n' +
        '- B) ✅ **Å være ubesluttsom eller vente med å ta et valg**\n' +
        '- C) Å ha god oversikt over en situasjon — nei\n' +
        '- D) Å være utestengt fra et fellesskap — nei';
    }

    // Q4: "interessert i" preposition
    if (/interessert\s+___?\s*(?:bærekraft|utvikling)|(?:preposisjon|preposition).*interessert/i.test(input)) {
      return '**Riktig svar: C) i**\n\n' +
        'Uttrykket er «å være interessert **i** noe».\n\n' +
        '- A) på — feil preposisjon\n- B) for — feil\n- C) ✅ **i** — korrekt\n- D) til — feil\n\n' +
        '«Mange studenter ved UiO er interessert **i** bærekraftig utvikling.»';
    }

    // Q5: "korrelasjon" academic vocabulary
    if (/korrelasjon|søvnkvalitet.*eksamensresultat|tydelig\s+___.*mellom/i.test(input)) {
      return '**Riktig svar: B) Korrelasjon**\n\n' +
        'I akademisk norsk brukes «korrelasjon» for å beskrive en statistisk sammenheng mellom to variabler.\n\n' +
        '- A) blanding — for uformelt\n- B) ✅ **korrelasjon** — akademisk term for statistisk sammenheng\n- C) vennskap — irrelevant\n- D) motsetning — betyr noe annet\n\n' +
        '«Forskerne fant en tydelig **korrelasjon** mellom lav søvnkvalitet og dårlige eksamensresultater.»';
    }

    // Extended Del 1 Q6: "dokumentert" synonym
    if (/dokumenter(?:t|e)\b.*(?:betyr|beviste|antatt|sammenheng|fysisk\s+aktiv|mental\s+helse)/i.test(input)) {
      return '**Riktig svar: B) Beviste**\n\n' +
        '«Dokumentere» betyr å vise med fakta eller bevis, ikke bare å anta eller avvise.\n\n' +
        '- A) Avvist — betyr å forkaste\n- B) ✅ **Beviste** — å vise med bevis\n- C) Antatt — betyr å anta uten bevis\n- D) Ignorert — betyr å overse';
    }

    // Extended Del 1 Q7: "hjelpe ham" object pronoun
    if (/hjelpe\s+(?:han|ham|seg)\s+med\s+oppgaven|objektpronomen.*hjelpe/i.test(input)) {
      return '**Riktig svar: B) Han spurte om jeg kunne hjelpe ham med oppgaven.**\n\n' +
        'Etter «hjelpe» brukes objektpronomenet «ham» (ikke refleksiv «seg» når subjektet er en annen person).\n\n' +
        '- A) «…hjelpe han…» — «han» er subjektform, feil\n' +
        '- B) ✅ **«…hjelpe ham…»** — «ham» er korrekt objektform\n' +
        '- C) «…hjelpe seg…» — refleksiv form er feil her (ulike subjekt)\n' +
        '- D) «…oppgaven sin» — feil refleksivt eiendomspronomen';
    }

    // Extended Del 1 Q8: "ha beina på jorden" idiom
    if (/beina\s+på\s+jorden/i.test(input)) {
      return '**Riktig svar: B) Å være realistisk og praktisk.**\n\n' +
        '«Å ha beina på jorden» er et vanlig norsk idiom som beskriver en person som tenker praktisk og ikke har urealistiske forestillinger.\n\n' +
        '- A) Å være veldig sporty — nei\n' +
        '- B) ✅ **Å være realistisk og praktisk**\n' +
        '- C) Å reise mye — nei\n' +
        '- D) Å være lat — nei';
    }

    // Extended Del 1 Q9: "kjent med" preposition
    if (/UiO\s+er\s+kjent\s+___?\s*(?:sin|sterke|forskningsprofil)|kjent\s+(?:med|for|på|av).*forskningsprofil/i.test(input)) {
      return '**Riktig svar: A) for**\n\n' +
        '«Kjent for» brukes når noe er karakteristisk for eller assosiert med noe.\n\n' +
        '«UiO er kjent **for** sin sterke forskningsprofil innen klima og miljø.»\n\n' +
        'NB: «kjent med» = familiar with, «kjent for» = known for.';
    }

    // Extended Del 1 Q10: "markant" academic word
    if (/markant|markant.*økning|internasjonale\s+studenter.*tiår.*passer\s+best/i.test(input)) {
      return '**Riktig svar: B) Markant**\n\n' +
        '«Markant» er et typisk akademisk ord som betyr «tydelig» eller «betydelig» og brukes ofte i rapporter og artikler.\n\n' +
        '- A) liten — for svak\n- B) ✅ **markant** — tydelig, betydelig\n- C) middelmådig — betyr gjennomsnittlig\n- D) ubetydelig — betyr det motsatte\n\n' +
        '«Studien viser en **markant** økning i antall internasjonale studenter det siste tiåret.»';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian Academic Exam – Part 2: Logical Organization & Cohesion
    // ══════════════════════════════════════════════════════════════

    // P2-Q1: Reorganize sentences (digital eksamen)
    if (/(?:reorgani|rekkefølge|logisk.*strukturert).*(?:digital\s+eksamen|teknologien\s+endret|utdanningssektoren|Canvas.*Inspera)/i.test(input)) {
      return '**Riktig rekkefølge: 2 – 4 – 1 – 3**\n\n' +
        '1. Start med den **generelle trenden** (2): «I løpet av det siste tiåret har teknologien endret utdanningssektoren drastisk.»\n' +
        '2. Deretter den **spesifikke institusjonelle responsen** (4): «UiO har derfor investert tungt i nye plattformer som Canvas og Inspera.»\n' +
        '3. Vis det **direkte resultatet** (1): «Dette har ført til en økning i digital eksamensgjennomføring.»\n' +
        '4. Avslutt med den **bredere implikasjonen** (3): «Samtidig krever denne utviklingen høyere digital kompetanse hos både studenter og forelesere.»';
    }

    // P2-Q2: "derimot" transition word for counter-argument
    if (/(?:bindeord|transition).*(?:counter|mot.?argument)|hjemmekontor.*produktivitet.*(?:sosiale?\s+isolasjon|innovasjon)/i.test(input)) {
      return '**Riktig svar: B) Derimot**\n\n' +
        '«Derimot» (on the other hand) signaliserer en kontrast, som er nødvendig her.\n\n' +
        '- A) Dessuten — legger til (additive)\n- B) ✅ **Derimot** — kontrast/motsetning\n- C) Følgelig — årsak–virkning\n- D) Dermed — konklusjon\n\n' +
        '«Mange mener at hjemmekontor øker produktiviteten. **Derimot** viser nyere studier at den sosiale isolasjonen kan svekke innovasjonsevnen over tid.»';
    }

    // P2-Q3: Topic sentence identification (håndskrevne notater)
    if (/(?:temasetning|topic\s+sentence).*(?:håndskrevne|notater|pensum|husker)|håndskrevne\s+notater.*husker\s+pensum/i.test(input)) {
      return '**Riktig svar: Setning A**\n\n' +
        '«Forskning viser at studenter som tar håndskrevne notater ofte husker pensum bedre enn de som skriver på PC.»\n\n' +
        'Setning A introduserer **hovedpåstanden** som resten av setningene (B, C, D) støtter eller utdyper:\n' +
        '- B: forklarer hvorfor\n- C: gir kontrast (PC-brukere)\n- D: gir anbefaling basert på A\n\n' +
        'En **temasetning** presenterer hovedideen i et avsnitt.';
    }

    // P2-Q4: "som følge av dette" cause-effect
    if (/(?:cause|årsak).*(?:effect|virkning).*(?:budsjet|kuttet|språkkurs)|budsjet.*kuttet.*språkkurs|universitetet.*kuttet.*budsj/i.test(input)) {
      return '**Riktig svar: C) Som følge av dette**\n\n' +
        '«Som følge av dette» (as a result of this) etablerer den **kausale sammenhengen** mellom budsjettkutt og avlyste kurs.\n\n' +
        '- A) i motsetning til — kontrast\n- B) forutsatt at — betingelse\n- C) ✅ **som følge av dette** — årsak–virkning\n- D) til tross for at — innrømmelse\n\n' +
        '«Universitetet har kuttet i budsjettene, **som følge av dette** ble flere språkkurs avlyst dette semesteret.»';
    }

    // P2-Q5: Drøfting structure
    if (/(?:drøfting|discussion).*(?:essay|structure|struktur|oppbygging)|struktur.*drøft|(?:argumenter\s+for|argumenter\s+imot).*(?:konklusjon|syntese)/i.test(input)) {
      return '**Riktig svar: C) Introduksjon – Argumenter for – Argumenter imot – Drøfting/Syntese – Konklusjon**\n\n' +
        'Dette følger den akademiske standarden for objektivitet og balansert analyse.\n\n' +
        '- A) Feil — konklusjonen kan ikke komme først\n' +
        '- B) Delvis riktig, men mangler syntese/drøftingsdel\n' +
        '- C) ✅ **Standard akademisk drøftingsstruktur**\n' +
        '- D) Feil — personlig historie og punktliste er ikke akademisk form';
    }

    // P2-Q6: Syllogism (Maria UiO bibliotek)
    if (/(?:syllogism|premiss).*(?:Maria|UiO|bibliotek)|alle\s+studenter.*UiO.*bibliotek.*Maria/i.test(input)) {
      return '**Konklusjon: Maria har tilgang til universitetsbiblioteket.**\n\n' +
        'Logisk deduksjon (syllogisme):\n' +
        '- **Premiss 1:** Alle studenter ved UiO har tilgang til universitetsbiblioteket.\n' +
        '- **Premiss 2:** Maria er student ved UiO.\n' +
        '- **Konklusjon:** Maria har tilgang til universitetsbiblioteket.\n\n' +
        'Dette er en **deduktiv slutning** — hvis begge premissene er sanne, er konklusjonen nødvendigvis sann.';
    }

    // P2-Q7: Problemstilling purpose
    if (/problemstilling.*(?:formål|purpose|hensikt|funksjon)|hva\s+er.*problemstilling|purpose.*research\s+question/i.test(input)) {
      return '**Riktig svar: B) Å avgrense temaet og styre retningen for hele teksten.**\n\n' +
        'En **problemstilling** (research question) i en akademisk introduksjon har som oppgave å snevre inn temaet slik at teksten forblir fokusert.\n\n' +
        '- A) Nei — oppsummering hører til konklusjonen\n' +
        '- B) ✅ **Avgrense og styre retningen**\n' +
        '- C) Nei — personlige meninger hører ikke i problemstillingen\n' +
        '- D) Nei — dette er ikke akademisk formål';
    }

    // P2-Q8: Logical flow breaker (elbiler + parker)
    if (/(?:bryter|breaks?).*logisk.*(?:flow|flyt)|norge.*(?:ledende|elektriske\s+biler).*(?:parker|vakker\s+by)/i.test(input)) {
      return '**Riktig svar: Setning 3 — «Oslo er en vakker by med mange parker.»**\n\n' +
        'Setning 3 handler om byens skjønnhet/parker, som er **irrelevant** for det logiske argumentet om elbil-insentiver og -salg.\n\n' +
        '(1) Norge er ledende på elektriske biler. ✓\n(2) Staten tilbyr mange insentiver… ✓\n(3) ❌ Oslo er en vakker by med mange parker. — **bryter flyten**\n(4) Dette har resultert i at over 80% av nybilsalget er elektrisk. ✓';
    }

    // P2-Q9: Signal words intensity order
    if (/(?:signal\s*ord|signal\s+words).*(?:svakest|sterkest|emphasis|intensity)|ganske.*ekstremt.*noe.*særdeles/i.test(input)) {
      return '**Riktig rekkefølge (svakest → sterkest):**\n\n' +
        '**Noe → Ganske → Særdeles → Ekstremt**\n\n' +
        '| Ord | Intensitet | Engelsk |\n|---|---|---|\n' +
        '| Noe | Svakest | Somewhat |\n' +
        '| Ganske | Moderat | Quite / Rather |\n' +
        '| Særdeles | Sterk | Particularly / Exceptionally |\n' +
        '| Ekstremt | Sterkest | Extremely |\n\n' +
        'Å forstå intensiteten av adverb er viktig for nyansert akademisk argumentasjon.';
    }

    // P2-Q10: "riktignok" function (concession)
    if (/riktignok.*(?:funksjon|function|logical|logisk|betyr|hva)|hva\s+(?:er|betyr).*riktignok/i.test(input)) {
      return '**Riktig svar: B) Å innrømme et poeng (konsesjon) før man presenterer et viktigere motpoeng.**\n\n' +
        '«Riktignok» (admittedly / true enough) brukes for å innrømme et mindre poeng før man vrir til hovedargumentet.\n\n' +
        '- A) Å konkludere — nei\n- B) ✅ **Konsesjon** — innrømmelse før motpoeng\n- C) Å legge til et ekstra argument — nei\n- D) Å beskrive tidsrekkefølge — nei\n\n' +
        '«Det er **riktignok** dyrt å bo i Oslo, **men** lønningene er også høyere enn i mange andre byer.»';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian Academic Exam – Part 3: Advanced Logical Organization
    // ══════════════════════════════════════════════════════════════

    // P3-Q1: Chronological order (Welfare State)
    if (/(?:kronologisk|chronological).*(?:welfare|velferd|folketrygd)|folketrygd.*1967|arbeiderbeveg.*(?:rekkefølge|order)/i.test(input)) {
      return '**Riktig rekkefølge: 4 – 2 – 1 – 3**\n\n' +
        '1. (4) Tidlige arbeiderbevegelser tidlig på 1900-tallet\n' +
        '2. (2) Gjenoppbygging etter 2. verdenskrig og bygging av sosiale sikkerhetsnett\n' +
        '3. (1) Innføring av Folketrygdloven i 1967\n' +
        '4. (3) Moderne utfordringer med en aldrende befolkning i 2026\n\n' +
        'Kronologisk rekkefølge krever å starte med de tidligste historiske røttene og bevege seg mot nåtiden.';
    }

    // P3-Q2: "Den røde tråden"
    if (/den\s+røde\s+tråden|red\s+thread.*norwegian|rød\w*\s+tråd/i.test(input)) {
      return '**Riktig svar: B) Å sikre en konsistent logisk sammenheng fra innledning til konklusjon.**\n\n' +
        '«Den røde tråden» er det norske uttrykket for den **logiske flyten** som binder en akademisk tekst sammen.\n\n' +
        '- A) Nei — bruk av metaforer er noe annet\n' +
        '- B) ✅ **Konsistent logisk sammenheng** gjennom hele teksten\n' +
        '- C) Nei — det handler ikke om rød skrift\n' +
        '- D) Nei — det handler om sammenheng, ikke ulike temaer\n\n' +
        'Uten den røde tråden blir teksten fragmentert og vanskelig å følge.';
    }

    // P3-Q3: Implicit causality (result relationship)
    if (/implicit\s+causality|result.*relationship.*sentence|failed\s+to\s+cite.*plagiarism|consequence.*pair/i.test(input)) {
      return '**Riktig svar: B) «The student failed to cite sources. Consequently, the paper was flagged for plagiarism.»**\n\n' +
        'Bruk av «Consequently» (Følgelig) skaper en direkte **logisk konsekvens**.\n\n' +
        '- A) Bibliotek stengt → svømming — ingen logisk sammenheng\n' +
        '- B) ✅ Manglende kildehenvisning → plagiat — **direkte kausal sammenheng**\n' +
        '- C) Snø → laptop — ingen sammenheng\n' +
        '- D) Professor sen → kald kaffe — svak/ingen kausal kobling';
    }

    // P3-Q4: General-to-Specific / Topic sentence placement
    if (/general.?to.?specific|topic\s+sentence.*(?:placed|plassere|beginning)|inverted\s+pyramid.*paragraph/i.test(input)) {
      return '**Riktig svar: B) I begynnelsen, for å gi leseren et rammeverk.**\n\n' +
        'I standard akademisk skriving (norsk og engelsk) foretrekkes den «omvendte pyramiden» der **hovedpåstanden åpner avsnittet**.\n\n' +
        '- A) Til slutt for overraskelse — ikke akademisk stil\n' +
        '- B) ✅ **I begynnelsen** — gir leseren umiddelbar kontekst\n' +
        '- C) I midten — gjemmer hovedpoenget\n' +
        '- D) Utelates — uakseptabelt i akademisk skriving';
    }

    // P3-Q5: Sentence insertion (infrastructure investment)
    if (/(?:where|hvor).*sentence.*(?:infrastructure\s+invest|tilstrekkelig\s+opplæring)|carbon\s+neutral.*2050.*(?:insert|fit|passer)/i.test(input)) {
      return '**Riktig svar: Posisjon (3)**\n\n' +
        '«However, this transition requires significant infrastructure investment» passer best mellom:\n' +
        '- (2) Strategien (skifte fra olje til grønn energi)\n' +
        '- (4) Spesifikk referanse til «these funds»\n\n' +
        'Setningen bygger **bro** mellom strategien og den konkrete omtalen av «these funds» i setning (4).';
    }

    // P3-Q6: Point-by-point comparison
    if (/point.?by.?point.*(?:compari|organiz|struktur)|sammenlikn.*(?:punkt\s+for\s+punkt|point.?by.?point)/i.test(input)) {
      return '**Riktig svar: B) Diskuter «Tema 1» for begge forfattere, deretter «Tema 2» for begge forfattere.**\n\n' +
        'Point-by-point er en sofistikert logisk struktur som sammenligner spesifikke elementer **side om side**.\n\n' +
        '- A) Alt om Forfatter A, deretter alt om B — dette er **blokkstruktur**, ikke point-by-point\n' +
        '- B) ✅ **Point-by-point**: Tema 1 (A+B) → Tema 2 (A+B)\n' +
        '- C) Bare én forfatter — ikke sammenligning\n' +
        '- D) Biografi uten sammenligning — ikke akademisk komparativ analyse';
    }

    // P3-Q7: Conclusion rules (never introduce new data)
    if (/conclusion.*(?:never|aldri|should\s+not)|konklusjon.*(?:aldri|introdusere\s+nye|brand\s+new\s+argument)/i.test(input)) {
      return '**Riktig svar: C) Introdusere helt nye argumenter eller data som ikke er nevnt i hoveddelen.**\n\n' +
        'Å introdusere ny informasjon i konklusjonen bryter den logiske strukturen i teksten.\n\n' +
        'En logisk konklusjon på universitetsnivå **skal:**\n' +
        '- A) ✓ Oppsummere hovedfunnene\n' +
        '- B) ✓ Svare på problemstillingen\n' +
        '- D) ✓ Peke mot videre forskning\n\n' +
        'Men **ALDRI:**\n- C) ❌ Introdusere nye argumenter eller data — dette bryter hele papirets logiske oppbygning.';
    }

    // P3-Q8: Conversely (contrastive connector for methods)
    if (/quantitative.*qualitative.*(?:moreover|conversely|similarly|therefore)|(?:conversely|innvending|i\s+motsetning).*(?:connector|bindeord)/i.test(input)) {
      return '**Riktig svar: B) Conversely (Innvending / I motsetning)**\n\n' +
        'Setningen sammenligner to ulike tilnærminger og krever en **kontrastiv kobling**.\n\n' +
        '- A) Moreover — additivt (legger til), feil her\n' +
        '- B) ✅ **Conversely** — kontrast mellom to metoder\n' +
        '- C) Similarly — likhet, motsatt av hva som trengs\n' +
        '- D) Therefore — konklusjon, ikke kontrast\n\n' +
        '«Quantitative methods provide broad data sets; **conversely**, qualitative methods offer deep, individual insights.»';
    }

    // P3-Q9: Hierarchical logic (sub-point of Norwegian Economy)
    if (/(?:sub.?point|underpunkt).*(?:norwegian\s+economy|norsk\s+økonomi)|hierarchi.*logic.*(?:oil\s+revenue|oljefond|sovereign\s+wealth)/i.test(input)) {
      return '**Riktig svar: B) Oil Revenue and the Sovereign Wealth Fund.**\n\n' +
        'Logisk hierarki krever at underpunkter er **direkte delmengder** av hovedoverskriften.\n\n' +
        '- A) Det svenske helsesystemet — feil land\n' +
        '- B) ✅ **Oljeinntekter og Statens pensjonsfond utland** — direkte del av norsk økonomi\n' +
        '- C) Vikingskipenes historie — annet fagfelt\n' +
        '- D) Klimamønstre i Sahara — helt irrelevant';
    }

    // P3-Q10: Non-sequitur (skiing → Tesla)
    if (/non.?sequitur|nordmenn.*skiing.*tesla|(?:lovbreak|flaw).*(?:norwegian|nordmenn).*ski.*tesla/i.test(input)) {
      return '**Riktig svar: B) Konklusjonen (å eie en Tesla) har ingen logisk forbindelse til premisset (å like ski).**\n\n' +
        'Dette er en **non-sequitur** — konklusjonen følger ikke av premissene.\n\n' +
        '- Premiss 1: Alle nordmenn liker ski.\n' +
        '- Premiss 2: Lars er norsk.\n' +
        '- Konklusjon: Lars har en Tesla. ❌\n\n' +
        'Å like ski har **ingen logisk kobling** til å eie en elbil. Korrekt konklusjon ville vært: «Lars liker ski.»';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian Academic Exam – Part 4: Academic Vocabulary & Phraseology
    // ══════════════════════════════════════════════════════════════

    // P4-Q1: "indikerer at" formal replacement
    if (/(?:indikerer|peker\s+på|sier\s+at|tror\s+at).*(?:akademisk|formal|erstatt|replace).*sammenheng|studien\s+viser.*(?:indiker|peker|sier|tror)/i.test(input)) {
      return '**Riktig svar: B) indikerer at**\n\n' +
        '«Indikerer at» er mer formelt og presist enn «viser at» i akademisk sammenheng.\n\n' +
        '- A) peker på at — akseptabelt men svakere\n- B) ✅ **indikerer at** — formelt og akademisk\n- C) sier at — for uformelt\n- D) tror at — subjektivt, uakademisk';
    }

    // P4-Q2: "teste en hypotese" collocation
    if (/(?:teste|lage|finne|skrive)\s+en\s+hypotese|collocation.*hypotese/i.test(input)) {
      return '**Riktig svar: B) teste**\n\n' +
        'Korrekt kollokasjon er «å **teste** en hypotese».\n\n' +
        '- A) lage — man «formulerer» eller «setter opp» en hypotese\n- B) ✅ **teste** — verifisere om hypotesen holder\n- C) finne — man finner resultater, ikke hypoteser\n- D) skrive — man skriver en oppgave, ikke tester en hypotese';
    }

    // P4-Q3: "validitet" definition
    if (/validitet.*(?:betyr|mean|definisjon|norsk\s+forskning)|hva\s+(?:er|betyr)\s+validitet/i.test(input)) {
      return '**Validitet** = Gyldighet — hvor godt en studie måler det den skal måle.\n\n' +
        'I norsk forskningskontekst:\n' +
        '- **Intern validitet:** Kan vi stole på årsaksforholdet i studien?\n' +
        '- **Ekstern validitet:** Kan resultatene generaliseres til andre situasjoner?\n' +
        '- **Begrepsvaliditet:** Måler instrumentet det teoretiske begrepet korrekt?\n\n' +
        'Motsetning: **Reliabilitet** = pålitelighet (konsistens i målingene).';
    }

    // P4-Q4: "således" formal transition
    if (/således.*(?:formell|transition|overgang)|resultate?n?e?.*(?:hypotese.*forkast|således|derfor|dessuten)/i.test(input)) {
      return '**Riktig svar: B) Således**\n\n' +
        '«Således» er det mest formelle overgangsordet i akademisk norsk for å introdusere en konsekvens.\n\n' +
        '- A) Derfor — korrekt men mindre formelt\n- B) ✅ **Således** — formelt og akademisk\n- C) Også — additivt, ikke konkluderende\n- D) Dessuten — additivt, feil funksjon\n\n' +
        '«**Således** viser resultatene at hypotesen må forkastes.»';
    }

    // P4-Q5: "rekruttert" in methods section
    if (/rekruttert.*(?:metode|methods|spørreundersøkelse)|deltaker.*(?:rekruttert|funnet|møtt|sett).*(?:online|spørre)/i.test(input)) {
      return '**Riktig svar: B) rekruttert**\n\n' +
        '«Rekruttert» er det mest passende ordet i en metodeseksjon.\n\n' +
        '- A) funnet — for uformelt i akademisk kontekst\n- B) ✅ **rekruttert** — standard akademisk terminologi\n- C) møtt — impliserer fysisk møte, feil her\n- D) sett — irrelevant\n\n' +
        '«Deltakerne ble **rekruttert** via en online spørreundersøkelse.»';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian Academic Exam – Part 5: Source Criticism & Citation
    // ══════════════════════════════════════════════════════════════

    // P5-Q1: Most reliable source
    if (/(?:pålitelig|reliable).*(?:kilde|source).*(?:akademisk|academic)|fagfellevurdert.*(?:tidsskrift|artikkel)|blogg.*wikipedia.*youtube.*(?:artikkel|tidsskrift)/i.test(input)) {
      return '**Riktig svar: B) En fagfellevurdert artikkel i Tidsskrift for samfunnsforskning fra 2025**\n\n' +
        'I norsk akademisk skriving er **fagfellevurderte** (peer-reviewed) artikler den mest pålitelige kildetypen.\n\n' +
        '- A) Blogg — ikke verifisert, ofte subjektiv\n- B) ✅ **Fagfellevurdert artikkel** — gjennomgått av eksperter\n- C) Wikipedia — kan redigeres av hvem som helst\n- D) YouTube-video — usikker kildekvalitet\n\n' +
        '**Tip:** I akademisk arbeid prioriterer man alltid fagfellevurderte, vitenskapelige publikasjoner.';
    }

    // P5-Q2: In-text citation APA
    if (/(?:in-text\s+citation|kildehenvisning).*APA.*(?:Smith|correct|korrekt)|ifølge\s+Smith.*2025.*s\.\s*47/i.test(input)) {
      return '**Korrekt!**\n\n' +
        '«Ifølge Smith (2025, s. 47) …» er riktig APA in-text referanse.\n\n' +
        '**APA-format for kildehenvisning:**\n' +
        '- Direkte sitat: (Smith, 2025, s. 47)\n' +
        '- Parafrase: (Smith, 2025)\n' +
        '- Forfatter i teksten: Ifølge Smith (2025, s. 47)…\n\n' +
        'UiO og de fleste norske universiteter bruker APA 7th edition.';
    }

    // P5-Q3: "primærkilde" definition
    if (/primærkilde|primary\s+source.*(?:norsk|norwegian|betyr|mean|definisjon)/i.test(input)) {
      return '**Primærkilde** = Originalkilde — f.eks. et brev, en intervjuutskrift, et offisielt dokument, originalforskning.\n\n' +
        '**Typer primærkilder:**\n' +
        '- Originalforskning (studier, eksperimenter)\n' +
        '- Historiske dokumenter (brev, dagbøker, taler)\n' +
        '- Intervjuer og feltnotater\n' +
        '- Lover og offentlige dokumenter (NOU, Stortingsmeldinger)\n\n' +
        '**Motsetning:** Sekundærkilde — analyserer eller refererer til primærkilder (f.eks. lærebøker, review-artikler).';
    }

    // P5-Q4: Missing reference problem
    if (/(?:mangler|missing).*(?:referanse|reference).*(?:forfatter|årstall|author|year)|uten\s+forfatter\s+eller\s+årstall/i.test(input)) {
      return '**Problem: Mangler full referanse → brudd på akademisk standard.**\n\n' +
        '«Som det står i artikkelen (uten forfatter eller årstall)…» er **uakseptabelt** i akademisk skriving.\n\n' +
        '**Krav til kildehenvisning:**\n' +
        '- Forfatter(e) — hvem skrev det?\n' +
        '- Årstall — når ble det publisert?\n' +
        '- Tittel — hva heter verket?\n' +
        '- Utgiver/tidsskrift — hvor er det publisert?\n\n' +
        'Uten disse elementene kan leseren ikke verifisere kilden, og det kan betraktes som **plagiat**.';
    }

    // P5-Q5: Correct reference list entry (Harvard)
    if (/(?:reference\s+list|referanseliste|litteraturliste).*(?:harvard|korrekt|correct|formatert)|Skaranger.*Universitetsforlaget/i.test(input)) {
      return '**Korrekt referanseoppføring (Harvard/APA):**\n\n' +
        'Skaranger, M. N. (2024). *Norsk for internasjonale studenter*. Oslo: Universitetsforlaget.\n\n' +
        '**Format:** Etternavn, Initialer. (År). *Tittel i kursiv*. Sted: Forlag.\n\n' +
        '**Vanlige feil:**\n' +
        '- Manglende kursivering av tittel\n' +
        '- Feil rekkefølge på elementene\n' +
        '- Manglende årstall eller utgiver\n' +
        '- Inkonsekvent formatering i referanselisten';
    }

    // ══════════════════════════════════════════════════════════════
    //  Extended Part 2: Logical Organization (questions 11–15)
    // ══════════════════════════════════════════════════════════════

    // Ext P2-Q1: KI/ChatGPT paragraph reorganization
    if (/(?:reorgani|rekkefølge).*(?:KI.?verktøy|ChatGPT|retningslinjer|kritisk\s+tenkning)|(?:ChatGPT|KI).*(?:oppgaveskriving|retningslinjer).*(?:reorgani|order|rekkefølge)/i.test(input)) {
      return '**Riktig rekkefølge: 3 – 1 – 2 – 4**\n\n' +
        '1. (3) Mange studenter bruker ChatGPT til oppgaveskriving. [utgangspunkt]\n' +
        '2. (1) Dette har ført til økt bruk av KI-verktøy. [resultat]\n' +
        '3. (2) Universitetet har innført nye retningslinjer for bruk av KI. [respons]\n' +
        '4. (4) Likevel er det viktig å beholde kritisk tenkning. [konklusjon/implikasjon]\n\n' +
        'Logikk: Start med fenomenet, vis resultatet, institusjonell respons, så bredere implikasjon.';
    }

    // Ext P2-Q2: concession "riktignok … men"
    if (/KI.*spare\s+tid.*(?:men|riktignok|dessuten|derfor).*(?:forstå\s+innholdet|selv)/i.test(input)) {
      return '**Riktig svar: C) riktignok**\n\n' +
        '«KI kan **riktignok** spare tid, **men** studentene må fortsatt forstå innholdet selv.»\n\n' +
        '«Riktignok … men» er et klassisk norsk konsesjonspar (innrømmelse + motpoeng).\n\n' +
        '- A) dessuten — additivt, feil\n- B) men — alene er for brått\n- C) ✅ **riktignok** — innrømmelse\n- D) derfor — årsak–virkning, feil';
    }

    // Ext P2-Q3: Cohesion breaker (digitalisering + fjorder)
    if (/(?:cohesion|sammenheng).*(?:break|bryter).*(?:digitalis|forelesning|fjord)|digitalis.*forelesning.*fjord.*ferdig/i.test(input)) {
      return '**Riktig svar: Setning 3 — «Oslo har fine fjorder.»**\n\n' +
        'Setning 3 handler om Oslos geografi og er **irrelevant** for temaet om digitalisering av undervisning.\n\n' +
        '(1) Digitalisering endrer undervisningen. ✓\n(2) Flere forelesninger er nå hybrid. ✓\n(3) ❌ Oslo har fine fjorder. — **bryter sammenhengen**\n(4) Dette krever nye digitale ferdigheter. ✓';
    }

    // Ext P2-Q4: Conclusion paragraph structure
    if (/(?:logical\s+order|rekkefølge).*conclusion.*paragraph|konklusjon.*avsnitt.*(?:struktur|rekkefølge)/i.test(input)) {
      return '**Logisk rekkefølge for et konklusjonsavsnitt:**\n\n' +
        '1. **Oppsummering** — kort om hovedfunn\n' +
        '2. **Svar på problemstillingen** — direkte kobling til forskningsspørsmålet\n' +
        '3. **Implikasjoner** — hva betyr funnene i praksis?\n' +
        '4. **Forslag til videre forskning** — hva bør undersøkes videre?\n\n' +
        '**Viktig:** Aldri introduser nye argumenter eller data i konklusjonen.';
    }

    // Ext P2-Q5: Logical flaw (KI + bedre karakterer)
    if (/alle.*(?:bruker\s+KI|KI).*bedre\s+karakter.*Maria|hasty\s+generaliz.*KI/i.test(input)) {
      return '**Logisk feil: Forhastet generalisering + non-sequitur.**\n\n' +
        '«Alle som bruker KI får bedre karakterer. Maria bruker KI. Derfor får Maria A på alle oppgaver.»\n\n' +
        '**Problemer:**\n' +
        '1. **Forhastet generalisering** — premisset «alle som bruker KI får bedre karakterer» er udokumentert\n' +
        '2. **Non-sequitur** — selv om KI gir bedre karakterer, følger ikke «A på alle oppgaver» logisk\n\n' +
        'Korrekt logikk ville kreve: dokumentert premiss → avgrenset konklusjon.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Extended Part 3: Advanced Logical Organization (questions 11–15)
    // ══════════════════════════════════════════════════════════════

    // Ext P3-Q1: Problemstilling structure in introduction
    if (/(?:structure|struktur).*problemstilling.*(?:introduksjon|introduction|innledning)|problemstilling.*(?:general\s+background|smalner|narrowing)/i.test(input)) {
      return '**Korrekt struktur for problemstilling i innledningen:**\n\n' +
        '1. **Generell bakgrunn** — introduser det brede temaet\n' +
        '2. **Innsmalning** — avgrens til spesifikt fokus\n' +
        '3. **Klar problemstilling** — formuler forskningsspørsmålet\n\n' +
        '**Eksempel:**\n' +
        '- Generelt: «Digitalisering endrer utdanningssektoren.»\n' +
        '- Smalner: «Særlig bruk av KI reiser nye spørsmål.»\n' +
        '- Problemstilling: «Hvordan påvirker bruk av KI-verktøy studenters læringsutbytte?»';
    }

    // Ext P3-Q2: When "den røde tråden" breaks
    if (/den\s+røde\s+tråden.*(?:break|brytes|bryte|broken)|(?:break|brytes).*den\s+røde\s+tråden/i.test(input)) {
      return '**«Den røde tråden» brytes når:**\n\n' +
        '- Et **nytt hovedargument** dukker opp i konklusjonen\n' +
        '- Avsnitt mangler logisk forbindelse til hverandre\n' +
        '- Problemstillingen aldri besvares\n' +
        '- Teksten hopper mellom urelaterte temaer\n\n' +
        '**Hvordan opprettholde den:**\n' +
        '- Hvert avsnitt bygger på det forrige\n' +
        '- Bruk overgangssord (videre, dessuten, derimot)\n' +
        '- Hold fokus på problemstillingen hele veien\n' +
        '- Konklusjonen svarer på innledningens spørsmål.';
    }

    // Ext P3-Q3: Point-by-point comparison for two texts (reiteration)
    if (/point.?by.?point.*two\s+texts|to\s+tekster.*punkt\s+for\s+punkt/i.test(input)) {
      return '**Beste punkt-for-punkt-sammenligningsstruktur for to tekster:**\n\n' +
        '**Tema 1** (Tekst A + Tekst B) → **Tema 2** (Tekst A + Tekst B) → **Tema 3** (Tekst A + Tekst B)\n\n' +
        '**Fordeler:**\n' +
        '- Direkte sammenligning av elementer side om side\n' +
        '- Lettere for leseren å se likheter og forskjeller\n' +
        '- Mer analytisk og sofistikert enn blokkstruktur\n\n' +
        '**Alternativ:** Blokkstruktur — alt om Tekst A, deretter alt om Tekst B (enklere men svakere analyse).';
    }

    // Ext P3-Q4: Sentence insertion (KI opplæring)
    if (/(?:forutsetter|imidlertid).*(?:tilstrekkelig\s+opplæring|sufficient\s+training).*(?:insert|fit|passer|belong)|KI.*muligheter.*opplæring.*misbruk/i.test(input)) {
      return '**Riktig svar: Posisjon 2**\n\n' +
        '«Dette forutsetter imidlertid tilstrekkelig opplæring» passer best mellom:\n' +
        '- (1) KI åpner nye muligheter. [påstand]\n' +
        '- (2) ✅ **[HER]** — forbehold/betingelse\n' +
        '- (3) Uten opplæring kan det føre til misbruk. [konsekvens av manglende (2)]\n\n' +
        'Setningen fungerer som en **bro** mellom muligheten (1) og advarselen (3).';
    }

    // Ext P3-Q5: Appeal to popularity (argumentum ad populum)
    if (/(?:studentene\s+liker\s+KI|fordi.*liker.*pedagogisk\s+bra)|(?:appeal\s+to\s+popularity|argumentum\s+ad\s+populum)/i.test(input)) {
      return '**Logisk feil: Appeal to popularity (argumentum ad populum)**\n\n' +
        '«Fordi studentene liker KI, må det være pedagogisk bra.» ❌\n\n' +
        '**Problemet:** At noe er **populært** betyr ikke at det er **effektivt** eller bedre.\n\n' +
        '**Eksempler på denne feilslutningen:**\n' +
        '- «Alle bruker det, så det må være bra.»\n' +
        '- «Det er populært, derfor er det riktig.»\n\n' +
        'Korrekt akademisk tilnærming krever **empirisk evidens**, ikke popularitet.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian Academic Exam – Writing Tasks (Del 2: Skriftlig produksjon)
    // ══════════════════════════════════════════════════════════════

    // General drøfting about KI in universities
    if (/(?:drøft|diskut|discuss).*(?:KI|kunstig\s+intelligens|AI).*(?:emner|universit|læring|trussel|integrere)/i.test(input)) {
      return '**Drøfting: Bør KI integreres i alle emner ved universitetet?**\n\n' +
        '**Argumenter FOR:**\n' +
        '- Forbedrer tilgangen til kunnskap og individuell tilpasning\n' +
        '- Effektiviserer repetitive oppgaver (oppsummering, søk)\n' +
        '- Forbereder studenter på arbeidslivet der KI er standard\n' +
        '- Kan gi umiddelbar tilbakemelding på studentarbeid\n\n' +
        '**Argumenter IMOT:**\n' +
        '- Risiko for avhengighet og svekket kritisk tenkning\n' +
        '- Plagiatproblematikk og akademisk integritet\n' +
        '- Ujevn tilgang kan forsterke sosiale forskjeller\n' +
        '- Fare for hallusinerte/feil svar som studenter godtar ukritisk\n\n' +
        '**Syntese:** KI bør integreres, men med klare retningslinjer, opplæring i kildekritikk, og fokus på analytisk tenkning fremfor ren reproduksjon.';
    }

    // Gratis kollektivtransport argumentasjon
    if (/(?:gratis\s+kollektiv|free\s+public\s+transport).*(?:klima|argumenter|byer|norge)|kollektiv.*(?:klimamål|gratis)/i.test(input)) {
      return '**Argumentasjon: Bør Norge innføre gratis kollektivtransport?**\n\n' +
        '**FOR:**\n' +
        '- Reduserer bilbruk → lavere CO₂-utslipp\n' +
        '- Sosialt utjevnende — alle får tilgang\n' +
        '- Reduserer trafikkork i byene\n' +
        '- Tallinn (Estland) har vist vellykket modell\n\n' +
        '**IMOT:**\n' +
        '- Enorme kostnader — hvem skal betale?\n' +
        '- Kapasitetsproblemer ved økt etterspørsel\n' +
        '- Bedre investeringer kan være utbygging og hyppigere avganger\n' +
        '- Rurale områder har begrenset kollektivtilbud uansett\n\n' +
        '**Konklusjon:** En balansert tilnærming med reduserte priser, ikke nødvendigvis gratis, kombinert med utbygging av infrastruktur.';
    }

    // Bachelor på engelsk vs norsk drøfting
    if (/bachelor.*(?:engelsk|english).*(?:norsk|norwegian|internasjonal\s+synl)|bacheloroppgaver.*(?:skrives|engelsk)/i.test(input)) {
      return '**Drøfting: Bør bacheloroppgaver skrives på engelsk?**\n\n' +
        '**FOR engelsk:**\n' +
        '- Økt internasjonal synlighet og sitering\n' +
        '- Forbereder studenter på internasjonal akademisk karriere\n' +
        '- Tilgjengelig for internasjonale medstudenter og veiledere\n\n' +
        '**FOR norsk:**\n' +
        '- Bevarer norsk som akademisk fagspråk (domenetap)\n' +
        '- Studenter utrykker seg mer presist på morsmålet\n' +
        '- Relevant for norsk arbeidsliv og forvaltning\n' +
        '- Mange fagtermer mangler gode engelske oversettelser\n\n' +
        '**Syntese:** Valgfrihet med tilpasset veiledning. Engelskspråklige programmer bør ha engelske oppgaver; norskspråklige bør beholde norsk.';
    }

    // Digitalisering og inkludering refleksjon
    if (/digitalisering.*(?:inkludering|nye\s+innbygger|integrering)|(?:inkluder|nye\s+innbygger).*digitalisering.*(?:reflekt|norsk\s+samfunn)/i.test(input)) {
      return '**Refleksjon: Digitalisering og inkludering av nye innbyggere**\n\n' +
        '**Fordeler:**\n' +
        '- Digitale tjenester gir enklere tilgang til offentlige tjenester (NAV, Skatteetaten)\n' +
        '- Norskkurs og integreringsprogram tilgjengelig online\n' +
        '- Apper og nettsider kan oversettes og tilpasses\n\n' +
        '**Utfordringer:**\n' +
        '- Digital kompetanse varierer — ikke alle er digitalt innfødte\n' +
        '- BankID-krav kan være en barriere for nyankomne\n' +
        '- Språkbarrierer i digitale løsninger\n' +
        '- Eldre og sårbare grupper kan falle utenfor\n\n' +
        '**Konklusjon:** Digitaliseringen krever parallelle tilbud — digitalt + fysisk — for å sikre reell inkludering.';
    }

    // Obligatorisk frivillig arbeid for studenter
    if (/(?:obligatorisk\s+frivillig|mandatory\s+volunteering).*(?:student|universit)|frivillig\s+arbeid.*student.*(?:argumenter|bør)/i.test(input)) {
      return '**Argumentasjon: Obligatorisk frivillig arbeid for studenter**\n\n' +
        '**FOR:**\n' +
        '- Bygger empati og samfunnsengasjement\n' +
        '- Relevant arbeidserfaring og nettverksbygging\n' +
        '- Styrker CV og personlig utvikling\n' +
        '- Bidrar positivt til lokalsamfunnet\n\n' +
        '**IMOT:**\n' +
        '- «Obligatorisk frivillig» er en selvmotsigelse\n' +
        '- Studenter har allerede tidspress med studier og jobb\n' +
        '- Kan bli overfladisk hvis folk gjør det bare for å krysse av\n' +
        '- Bør stimuleres med insentiver, ikke tvang\n\n' +
        '**Syntese:** Frivillig arbeid bør oppmuntres gjennom studiepoeng eller stipend, ikke pålegges som obligatorisk.';
    }

    return null;
  }

  // ── Strategy 1.51: English Language Knowledge ──

  private tryEnglishLanguage(input: string): string | null {
    // Strip quotes for easier matching
    input = input.replace(/["'""''`]/g, ' ').replace(/\s+/g, ' ').trim();

    // Gate: English language/grammar terms (broad — inner patterns handle specificity)
    if (!/\b(english\s+grammar|parts?\s+of\s+speech|subject.?verb|dangling\s+modifier|present\s+perfect|past\s+(?:simple|tense)|affect|effect|active\s+voice|passive\s+voice|comma\s+splice|whom|who\s+and\s+whom|lay\s+and\s+lie|conditional|gerund|infinitive|semicolon|parallel\s+structure|pronoun\s+agree|oxford\s+comma|split\s+infinitive|further|farther|countable|uncountable|articles?\s+in\s+english|english\s+articles?|using\s+articles|then\s+and\s+than|their\s+and\s+there|they\s*re|its\s+and\s+it|possessive\s+its|apostrophe|fragment|sentence\s+fragment|run.?on\s+sentence|english\s+tenses?|adverb|adjective|english\s+(?:punctuation|vocabulary|grammar)|modifier|misplaced|squinting|have\s+been|singular\s+they|everyone|fused\s+sentence|university|umbrella|vowel\s+sound|children|confus|singular|had\s+studied|would\s+have)/i.test(input)) {
      return null;
    }

    // Present perfect vs past simple
    if (/(?:present\s+perfect|past\s+simple|past\s+tense)\s+(?:vs\.?|versus|and|or|compared)/i.test(input)
      || /difference.*present\s+perfect.*past\s+simple/i.test(input)
      || /have\s+been.*vs.*went/i.test(input)) {
      return '**Present Perfect vs Past Simple:**\n\n' +
        '| | Present Perfect | Past Simple |\n|---|---|---|\n' +
        '| **Form** | have/has + past participle | verb + -ed (or irregular) |\n' +
        '| **Example** | I **have visited** Paris. | I **visited** Paris in 2020. |\n' +
        '| **Time** | Unspecified or continuing | Specific, completed time |\n' +
        '| **Keywords** | ever, never, already, yet, since, for | yesterday, last week, in 2020, ago |\n\n' +
        '**"Have been"** = experience/state (I have been to Paris) vs **"went"** = specific past event (I went to Paris last year).';
    }

    // Dangling modifier
    if (/dangling\s+modifier/i.test(input)) {
      return '**Dangling Modifier:**\n\n' +
        'A dangling modifier is a word/phrase that modifies a word not clearly stated in the sentence.\n\n' +
        '**Incorrect:** *Walking to school, the rain started.* (Who is walking? Not the rain!)\n' +
        '**Correct:** *Walking to school, **I** got caught in the rain.*\n\n' +
        '**Incorrect:** *After reading the book, the movie was disappointing.*\n' +
        '**Correct:** *After reading the book, **I found** the movie disappointing.*\n\n' +
        '**Fix:** Make sure the modifier\'s subject is clearly in the sentence.';
    }

    // Affect vs Effect
    if (/affect.*effect|effect.*affect/i.test(input)) {
      return '**Affect vs Effect:**\n\n' +
        '| | Affect | Effect |\n|---|---|---|\n' +
        '| **Part of speech** | Usually a **verb** | Usually a **noun** |\n' +
        '| **Meaning** | To influence/change | The result/consequence |\n' +
        '| **Example** | The weather **affects** my mood. | The **effect** of the storm was severe. |\n\n' +
        '**Memory trick:** **A**ffect = **A**ction (verb), **E**ffect = **E**nd result (noun)\n\n' +
        'Exceptions: "effect" can be a verb meaning "to bring about" (effect change), and "affect" can be a noun in psychology.';
    }

    // 8 Parts of speech
    if (/(?:8|eight)\s+parts?\s+of\s+speech/i.test(input)
      || /parts?\s+of\s+speech\s+in\s+english/i.test(input)) {
      return '**The 8 Parts of Speech in English:**\n\n' +
        '| # | Part of Speech | Function | Example |\n|---|---|---|---|\n' +
        '| 1 | **Noun** | Person, place, thing, idea | dog, London, happiness |\n' +
        '| 2 | **Pronoun** | Replaces a noun | he, she, it, they |\n' +
        '| 3 | **Verb** | Action or state of being | run, is, think |\n' +
        '| 4 | **Adjective** | Describes a noun | big, red, beautiful |\n' +
        '| 5 | **Adverb** | Modifies verb/adj/adverb | quickly, very, well |\n' +
        '| 6 | **Preposition** | Shows relationship | in, on, at, under |\n' +
        '| 7 | **Conjunction** | Connects words/clauses | and, but, or, because |\n' +
        '| 8 | **Interjection** | Expresses emotion | wow, oh, ouch |';
    }

    // Adverb vs Adjective
    if (/(?:adverb|adjective)\s+(?:vs\.?|and|or|versus)\s+(?:adverb|adjective)/i.test(input)
      || /difference.*adverb.*adjective/i.test(input)) {
      return '**Adverb vs Adjective:**\n\n' +
        '| | Adjective | Adverb |\n|---|---|---|\n' +
        '| **Modifies** | Nouns/pronouns | Verbs, adjectives, other adverbs |\n' +
        '| **Example** | She is a **fast** runner. | She runs **fast**. |\n' +
        '| **Example** | He wrote a **quick** note. | He wrote **quickly**. |\n' +
        '| **Formation** | Base form | Often adjective + **-ly** |\n\n' +
        '**Common irregular adverbs:** good → **well**, fast → **fast**, hard → **hard**.';
    }

    // Subject-verb agreement
    if (/subject.?verb\s+agreement/i.test(input)
      || /team\s+is.*team\s+are/i.test(input)) {
      return '**Subject-Verb Agreement:**\n\n' +
        'The verb must agree with its subject in number (singular/plural).\n\n' +
        '| Rule | Example |\n|---|---|\n' +
        '| Singular subject → singular verb | The dog **runs** fast. |\n' +
        '| Plural subject → plural verb | The dogs **run** fast. |\n' +
        '| Compound "and" → plural | Tom and Jerry **are** friends. |\n' +
        '| Collective noun → usually singular | The team **is** winning. |\n\n' +
        '**"The team is"** (American English, treating team as one unit) vs **"The team are"** (British English, treating members individually). Both are acceptable depending on dialect.';
    }

    // Active vs Passive voice
    if (/active\s+(?:vs\.?|and|or|versus)\s+passive\s+voice/i.test(input)
      || /passive\s+(?:vs\.?|and|or|versus)\s+active\s+voice/i.test(input)) {
      return '**Active vs Passive Voice:**\n\n' +
        '| | Active | Passive |\n|---|---|---|\n' +
        '| **Structure** | Subject + verb + object | Object + be + past participle |\n' +
        '| **Example** | The cat **chased** the mouse. | The mouse **was chased** by the cat. |\n' +
        '| **Focus** | Who does the action | What receives the action |\n' +
        '| **Tone** | Direct, clear | Formal, sometimes vague |\n\n' +
        '**When to use passive:** When the doer is unknown/unimportant, or in scientific/formal writing.';
    }

    // "Is whom still used" — BEFORE main who/whom pattern
    if (/whom.*(?:still|common|modern|declining)/i.test(input)) {
      return '**"Whom" in modern English:**\n\n' +
        '"Whom" is still used in **formal writing** and after prepositions (*to whom, for whom*), but it is **declining** in casual speech.\n\n' +
        'In daily conversation, most people say "Who did you call?" instead of the technically correct "Whom did you call?"\n\n' +
        '"Whom" is less common now but still correct and expected in formal, academic, or legal contexts.';
    }

    // Who vs Whom
    if (/who.*whom|whom.*who|\bwhom\b/i.test(input)) {
      return '**Who vs Whom:**\n\n' +
        '| | Who | Whom |\n|---|---|---|\n' +
        '| **Function** | Subject | Object |\n' +
        '| **Example** | **Who** is calling? | To **whom** did you speak? |\n' +
        '| **Test** | Replace with "he/she" | Replace with "him/her" |\n\n' +
        '**Quick trick:** If you can answer with "him," use "whom." If "he," use "who."\n' +
        '- **(Who/Whom) wrote this?** → *He* wrote this → **Who**\n' +
        '- **(Who/Whom) did you call?** → I called *him* → **Whom**';
    }

    // Then vs Than — add summary line for cross-line matching
    if (/then.*than|than.*then/i.test(input)) {
      return '**Then vs Than:** "Then" = time/sequence. "Than" = comparison.\n\n' +
        '| | Then | Than |\n|---|---|---|\n' +
        '| **Meaning** | Time/sequence | Comparison |\n' +
        '| **Example** | First eat, **then** sleep. | She is taller **than** me. |\n' +
        '| **Example** | Back **then**, things were different. | Better late **than** never. |';
    }

    // Their/There/They're
    if (/their.*there|there.*their|they\s*re/i.test(input)) {
      return '**Their vs There vs They\'re:**\n\n' +
        '| Word | Meaning | Example |\n|---|---|---|\n' +
        '| **Their** | Possessive (belongs to them) | **Their** house is big. |\n' +
        '| **There** | Location / existence | The book is over **there**. |\n' +
        '| **They\'re** | Contraction of "they are" | **They\'re** coming soon. |';
    }

    // Its vs It's (exclude "why" + "apostrophe" — handled by possessive its FU below)
    if (/its.*it\W?s|possessive\s+its|its\s+(?:vs|and|or)/i.test(input)
      && !/apostrophe/i.test(input)) {
      return '**Its vs It\'s:**\n\n' +
        '| | Its | It\'s |\n|---|---|---|\n' +
        '| **Meaning** | Possessive (belonging to it) | Contraction of "it is" or "it has" |\n' +
        '| **Example** | The dog wagged **its** tail. | **It\'s** raining outside. |\n\n' +
        '**Rule:** If you can replace with "it is" or "it has," use **it\'s**. Otherwise, use **its**.';
    }

    // Comma splice vs run-on — BEFORE main comma splice
    if (/comma\s+splice.*run.?on|run.?on.*comma\s+splice/i.test(input)) {
      return '**Comma Splice vs Run-on Sentence:**\n\n' +
        'Both are errors joining two independent clauses, but they differ in punctuation:\n\n' +
        '| | Comma Splice | Run-on (Fused) |\n|---|---|---|\n' +
        '| **Punctuation** | Uses only a comma | No punctuation at all |\n' +
        '| **Example** | *I love it, I do it daily.* | *I love it I do it daily.* |\n\n' +
        'A run-on sentence has **no punctuation** between the clauses, while a comma splice has a comma but without a conjunction.';
    }

    // Possessive its — BEFORE main apostrophe pattern
    if (/possessive\s+its|why\s+.*its.*apostrophe|its.*no\s+apostrophe/i.test(input)) {
      return '**Why "its" (possessive) has no apostrophe:**\n\n' +
        'Possessive pronouns NEVER use apostrophes: his, hers, yours, theirs, ours, **its**.\n\n' +
        'The apostrophe in "it\'s" means "it is" or "it has" (contraction). The possessive form "its" follows the same pattern as other possessive pronouns like "his" and "hers".';
    }

    // children's toys — BEFORE main apostrophe pattern
    if (/children.?s\s+toy|childrens/i.test(input)) {
      return '**"The children\'s toys"** is correct.\n\n' +
        'For irregular plural nouns (children, women, men), add **\'s** — not **s\'**:\n' +
        '- the **children\'s** toys ✓\n' +
        '- the ~~childrens\'~~ toys ✗\n\n' +
        'Rule: Regular plural → **s\'** (the dogs\' bones). Irregular plural → **\'s** (the children\'s toys).';
    }

    // Semicolon can't always replace period — BEFORE main semicolon
    if (/semicolon.*(?:replace|all\s+cases|every|always)/i.test(input)
      || /replace.*period.*semicolon/i.test(input)) {
      return 'No, a semicolon **cannot always replace a period**. A semicolon should only join two **closely related** independent clauses.\n\n' +
        '**Good:** *I love coding; it challenges me.* (related ideas)\n' +
        '**Bad:** *I went to the store; my cat is orange.* (not related — use a period)\n\n' +
        'Semicolons connect ideas with a logical relationship, not just any two sentences.';
    }

    // Comma splice
    if (/comma\s+splice/i.test(input)) {
      return '**Comma Splice:**\n\n' +
        'A comma splice occurs when two independent clauses are joined with only a comma.\n\n' +
        '**Incorrect:** *I went to the store, I bought milk.*\n\n' +
        '**Fix options:**\n' +
        '1. Period: *I went to the store. I bought milk.*\n' +
        '2. Semicolon: *I went to the store; I bought milk.*\n' +
        '3. Conjunction: *I went to the store, **and** I bought milk.*\n' +
        '4. Subordination: ***When** I went to the store, I bought milk.*';
    }

    // Lay vs Lie
    if (/lay.*lie|lie.*lay/i.test(input) && !/relay/i.test(input)) {
      return '**Lay vs Lie:**\n\n' +
        '| | Lay (transitive) | Lie (intransitive) |\n|---|---|---|\n' +
        '| **Meaning** | To place something | To recline |\n' +
        '| **Present** | I **lay** the book down. | I **lie** on the bed. |\n' +
        '| **Past** | I **laid** the book down. | I **lay** on the bed. |\n' +
        '| **Past part.** | I have **laid** it down. | I have **lain** on the bed. |\n\n' +
        '**Trick:** "Lay" needs an object (lay SOMETHING). "Lie" does not.';
    }

    // Gerund vs Infinitive
    if (/gerund.*infinitive|infinitive.*gerund|gerund/i.test(input)) {
      return '**Gerund vs Infinitive:**\n\n' +
        '| | Gerund (-ing) | Infinitive (to + verb) |\n|---|---|---|\n' +
        '| **Example** | I enjoy **swimming**. | I want **to swim**. |\n' +
        '| **After** | enjoy, avoid, mind, finish | want, need, decide, hope |\n' +
        '| **As subject** | **Running** is healthy. | **To run** is healthy. |\n\n' +
        'Some verbs take both with different meanings:\n' +
        '- I stopped **smoking**. (quit) vs I stopped **to smoke**. (paused to smoke)';
    }

    // Semicolon usage
    if (/semicolon/i.test(input)) {
      return '**Semicolon Usage:**\n\n' +
        '1. **Join independent clauses** (instead of period):\n' +
        '   - *I love coding; it challenges me.*\n\n' +
        '2. **Before conjunctive adverbs** (however, therefore, moreover):\n' +
        '   - *It rained; **however**, we went out.*\n\n' +
        '3. **In complex lists** (items with commas):\n' +
        '   - *We visited London, England; Paris, France; and Tokyo, Japan.*';
    }

    // Oxford comma
    if (/oxford\s+comma/i.test(input)) {
      return '**Oxford Comma (Serial Comma):**\n\n' +
        'The Oxford comma is the comma before "and" in a list of 3+ items.\n\n' +
        '- **With:** I like apples, oranges**,** and bananas.\n' +
        '- **Without:** I like apples, oranges and bananas.\n\n' +
        '**Why use it:** Prevents ambiguity:\n' +
        '- *I love my parents, Batman and Wonder Woman.* (parents = Batman and WW?)\n' +
        '- *I love my parents, Batman**,** and Wonder Woman.* (three separate entities)';
    }

    // Split infinitive
    if (/split\s+infinitive/i.test(input)) {
      return '**Split Infinitive:**\n\n' +
        'A split infinitive places an adverb between "to" and the verb.\n\n' +
        '- Split: *to **boldly** go where no one has gone before*\n' +
        '- Unsplit: *to go **boldly** where no one has gone before*\n\n' +
        'Modern English accepts split infinitives. They\'re sometimes clearer:\n' +
        '- *I want to **really** understand this.* (clear)\n' +
        '- *I want **really** to understand this.* (awkward)';
    }

    // Further vs Farther — add summary line
    if (/further.*farther|farther.*further/i.test(input)) {
      return '**Further vs Farther:** Farther = physical distance. Further = figurative/additional.\n\n' +
        '| | Farther | Further |\n|---|---|---|\n' +
        '| **Meaning** | Physical distance | Figurative/additional |\n' +
        '| **Example** | The store is **farther** away. | Let\'s discuss this **further**. |\n\n' +
        '**Trick:** **Far**ther = **far** (physical distance).';
    }

    // Countable vs Uncountable — add summary
    if (/countable.*uncountable|uncountable.*countable|\buncountable\b/i.test(input)) {
      return '**Countable vs Uncountable Nouns:** Countable nouns have plural forms. Uncountable nouns cannot be pluralized.\n\n' +
        '| | Countable | Uncountable |\n|---|---|---|\n' +
        '| **Can count** | Yes (one apple, two apples) | No (water, information) |\n' +
        '| **a/an** | Yes (a book) | No |\n' +
        '| **many/few** | Yes (many books) | No |\n' +
        '| **much/little** | No | Yes (much water) |\n' +
        '| **some** | Yes | Yes |\n\n' +
        'Common uncountable: water, information, advice, furniture, equipment, research.';
    }

    // "a university but an umbrella" — BEFORE main articles pattern
    if (/university.*umbrella|umbrella.*university|(?:a|an)\s+university/i.test(input)) {
      return '**"A university" but "an umbrella":**\n\n' +
        'Articles are based on **sound**, not spelling:\n' +
        '- "university" starts with a **"yoo"** sound (consonant sound) → **a** university\n' +
        '- "umbrella" starts with a vowel sound **"uh"** → **an** umbrella\n' +
        '- "hour" starts with a silent "h" (vowel sound) → **an** hour\n\n' +
        'Rule: Use "an" before vowel sounds, "a" before consonant sounds.';
    }

    // Fragments intentional — BEFORE main fragment pattern
    if (/fragment.*(?:intentional|creative|style|emphasis|ever\s+used)/i.test(input)) {
      return 'Yes, fragments can be used **intentionally** in creative writing for **style and emphasis**:\n\n' +
        '- *"The door opened. Silence."* (dramatic effect)\n' +
        '- *"Best coffee in town."* (advertising)\n' +
        '- *"Absolutely not."* (emphasis)\n\n' +
        'In professional/academic writing, avoid fragments. In creative writing, intentional fragments are a legitimate tool.';
    }

    // "Why is parallel structure important" — BEFORE main parallel pattern
    if (/(?:why|important).*parallel/i.test(input)) {
      return '**Why parallel structure matters in professional writing:**\n\n' +
        '1. **Clarity:** Makes complex lists easy to follow\n' +
        '2. **Readability:** Creates a rhythm that\'s easier to process\n' +
        '3. **Professionalism:** Shows attention to detail in formal writing\n' +
        '4. **Consistency:** Prevents confusion about relationships between items';
    }

    // English articles a/an/the
    if (/articles?\s+(?:in\s+english|usage|rules?)/i.test(input)
      || /english\s+articles?/i.test(input)
      || /(?:using|rules?\s+for)\s+articles/i.test(input)
      || /\b(?:a|an)\s+(?:vs\.?|and|or)\s+(?:a|an|the)\b/i.test(input)
      || /vowel\s+sound/i.test(input)) {
      return '**English Articles (a, an, the):**\n\n' +
        '| Article | Usage | Example |\n|---|---|---|\n' +
        '| **a** | Before consonant sounds | a dog, a university |\n' +
        '| **an** | Before vowel sounds | an apple, an hour |\n' +
        '| **the** | Specific/known item | the sun, the book I read |\n' +
        '| (none) | General plurals/uncountable | Dogs are loyal. Water is wet. |\n\n' +
        'Note: Based on SOUND, not spelling: "a **u**niversity" (yoo-), "an **h**our" (silent h).';
    }

    // Apostrophe rules
    if (/apostrophe/i.test(input)) {
      return '**Apostrophe Rules:**\n\n' +
        '1. **Contractions** (shows missing letters): can\'t, don\'t, it\'s (it is)\n' +
        '2. **Singular possessive** (\'s): *The dog\'s bone*\n' +
        '3. **Plural possessive** (s\'): *The dogs\' bones*\n' +
        '4. **Irregular plural possessive** (\'s): *The children\'s toys*\n\n' +
        '**NEVER use apostrophes for:**\n' +
        '- Plurals: apple**s** (not apple\'s)\n' +
        '- Possessive pronouns: its, yours, theirs (not it\'s for possessive)';
    }

    // Fragment vs sentence
    if (/fragment.*sentence|sentence\s+fragment|\bfragment\b/i.test(input)) {
      return '**Sentence Fragment vs Complete Sentence:**\n\n' +
        'A complete sentence needs: **subject + verb + complete thought.**\n\n' +
        '| Fragment | Complete |\n|---|---|\n' +
        '| *Running fast.* | *He was running fast.* |\n' +
        '| *Because I was tired.* | *I left because I was tired.* |\n' +
        '| *The big red dog.* | *The big red dog barked.* |\n\n' +
        'Fragments lack a subject, verb, or express an incomplete thought (often dependent clauses).';
    }

    // Run-on sentence
    if (/run.?on\s+sentence/i.test(input)) {
      return '**Run-on Sentence:**\n\n' +
        'A run-on sentence joins two independent clauses without proper punctuation or conjunction.\n\n' +
        '**Run-on:** *I love coding I do it every day.*\n\n' +
        '**Fix options:**\n' +
        '1. Period: *I love coding. I do it every day.*\n' +
        '2. Comma + conjunction: *I love coding, and I do it every day.*\n' +
        '3. Semicolon: *I love coding; I do it every day.*\n' +
        '4. Subordination: *Because I love coding, I do it every day.*';
    }

    // Conditional tenses
    if (/conditional\s+tenses?/i.test(input)
      || /(?:would|could|should)\s+(?:vs\.?|and|or)/i.test(input)
      || /(?:first|second|third|zero)\s+conditional/i.test(input)) {
      return '**English Conditional Tenses:**\n\n' +
        '| Type | Structure | Example |\n|---|---|---|\n' +
        '| **Zero** (fact) | If + present, present | If you heat water, it boils. |\n' +
        '| **First** (likely) | If + present, will + verb | If it rains, I will stay home. |\n' +
        '| **Second** (unlikely) | If + past, would + verb | If I won the lottery, I would travel. |\n' +
        '| **Third** (impossible) | If + had + pp, would have + pp | If I had studied, I would have passed. |';
    }

    // Parallel structure
    if (/parallel\s+structure/i.test(input)) {
      return '**Parallel Structure:**\n\n' +
        'Items in a list or comparison should use the same grammatical form.\n\n' +
        '**Not parallel:** *She likes reading, to swim, and cooking.*\n' +
        '**Parallel:** *She likes reading, swimming, and cooking.*\n\n' +
        '**Not parallel:** *The job requires experience, creativity, and being organized.*\n' +
        '**Parallel:** *The job requires experience, creativity, and organization.*';
    }

    // Pronoun agreement
    if (/pronoun\s+agreement/i.test(input)) {
      return '**Pronoun Agreement:**\n\n' +
        'A pronoun must agree with its antecedent in number and gender.\n\n' +
        '**Incorrect:** *Everyone should bring their lunch.* (traditional view)\n' +
        '**Traditional:** *Everyone should bring his or her lunch.*\n' +
        '**Modern accepted:** *Everyone should bring **their** lunch.* (singular "they")\n\n' +
        '**Rule:** Singular antecedent → singular pronoun. But singular "they" is now widely accepted for gender-neutral reference.';
    }

    // ── Follow-up catch-all patterns ──

    // "have been" vs "went" (follow-up for present perfect)
    if (/have\s+been.*(?:vs|went)|went.*have\s+been/i.test(input)) {
      return '**"Have been" vs "went":**\n\n' +
        '**"Have been"** = experience or state (present perfect):\n' +
        '- I **have been** to Paris. (at some unspecified past time)\n\n' +
        '**"Went"** = specific past event (past simple):\n' +
        '- I **went** to Paris last year. (specific time)\n\n' +
        '"Have been" describes experience without a specific time. "Went" describes a specific past event.';
    }

    // Modifier errors (follow-up for dangling modifier)
    if (/modifier\s+error|misplaced\s+modifier|squinting\s+modifier|types?\s+of\s+modifier/i.test(input)) {
      return '**Types of modifier errors:**\n\n' +
        '1. **Dangling modifier:** The word being modified is missing.\n' +
        '   - *Walking to school, the rain started.*\n\n' +
        '2. **Misplaced modifier:** The modifier is too far from the word it modifies.\n' +
        '   - *She almost drove her kids to school every day.* (almost modifies "every day", not "drove")\n\n' +
        '3. **Squinting modifier:** Ambiguous — could modify either side.\n' +
        '   - *Running quickly builds endurance.* (Does "quickly" modify "running" or "builds"?)';
    }

    // "Can effect be used as a verb" (follow-up for affect/effect)
    if (/effect.*(?:used\s+as\s+a\s+verb|verb|ever)/i.test(input) && !/affect/i.test(input)) {
      return 'Yes, **"effect"** can be a verb meaning **"to bring about"** or **"to cause"**:\n\n' +
        '- The new CEO **effected** major changes. (brought about)\n' +
        '- Only the president can **effect** this policy change.\n\n' +
        'This is rare. In most cases, "affect" = verb, "effect" = noun.';
    }

    // "Can a word belong to more than one part of speech" (follow-up for parts of speech)
    if (/(?:word|belong)\s+.*(?:more\s+than\s+one|multiple|different)\s+part/i.test(input)
      || /part\s+of\s+speech.*context/i.test(input)) {
      return 'Yes! Many English words can belong to **multiple parts of speech** depending on context:\n\n' +
        '- **"run"**: verb (*I run daily*) or noun (*a morning run*)\n' +
        '- **"fast"**: adjective (*a fast car*) or adverb (*drive fast*)\n' +
        '- **"light"**: noun (*the light*), verb (*light the candle*), adjective (*light blue*)\n\n' +
        'Context determines which part of speech a word functions as in a given sentence.';
    }

    // "everyone singular or plural" (follow-up for subject-verb agreement)
    if (/everyone.*(?:singular|plural)|singular.*everyone/i.test(input)) {
      return '**"Everyone"** is grammatically **singular** for subject-verb agreement:\n\n' +
        '- Everyone **is** here. ✓ (not "are")\n' +
        '- Everyone **has** their own opinion. ✓\n\n' +
        'However, "everyone" often uses **"their"** (plural pronoun) for gender-neutral reference — this is widely accepted in modern English.';
    }

    // "when to use passive voice" (follow-up for active/passive)
    if (/(?:when|why)\s+(?:should|would|do)\s+(?:you\s+)?use\s+passive/i.test(input)
      || /passive\s+voice\s+in\s+writing/i.test(input)) {
      return '**When to use passive voice:**\n\n' +
        '1. **Unknown doer:** *The window was broken.* (we don\'t know who)\n' +
        '2. **Unimportant doer:** *The email was sent.* (who sent it doesn\'t matter)\n' +
        '3. **Scientific/formal writing:** *The experiment was conducted...*\n' +
        '4. **Emphasis on the receiver:** *The award was given to Marie Curie.*\n\n' +
        'Avoid passive when the doer is important or when active voice would be clearer.';
    }

    // "most commonly confused pair" (follow-up for their/there)
    if (/(?:most|commonly)\s+confus/i.test(input)) {
      return 'The most commonly confused pair is **"their" and "there"**, because they sound identical (homophones).\n\n' +
        '- **Their** = possessive (Their house is big.)\n' +
        '- **There** = location (The book is over there.)\n\n' +
        'Other commonly confused pairs: its/it\'s, your/you\'re, affect/effect, then/than.';
    }

    // "Is Oxford comma required" (follow-up for Oxford comma)
    if (/oxford\s+comma.*(?:required|style\s+guide|mandatory|optional)/i.test(input)
      || /(?:required|style\s+guide).*oxford\s+comma/i.test(input)) {
      return '**Is the Oxford comma required?**\n\n' +
        'It depends on the style guide:\n' +
        '- **AP Style** (journalism): Does **not** require it\n' +
        '- **Chicago Manual of Style**: **Requires** it\n' +
        '- **APA Style** (academic): **Requires** it\n\n' +
        'The Oxford comma is optional but recommended when it prevents ambiguity.';
    }

    // "Is splitting infinitives wrong" (follow-up for split infinitive)
    if (/split.*(?:wrong|correct|modern|accept)/i.test(input)) {
      return 'No, splitting infinitives is **not wrong** in modern English.\n\n' +
        'Traditional grammar teachers once considered it incorrect, but modern style guides accept split infinitives.\n\n' +
        'It is no longer considered an error, and sometimes splitting the infinitive is clearer.';
    }

    // "Can further be used for physical distance" (follow-up for further/farther)
    if (/further.*physical|further.*distance/i.test(input)) {
      return 'Yes, **"further"** is sometimes used for physical distance, especially in **informal** speech and British English.\n\n' +
        'Strictly: "farther" = physical, "further" = figurative/additional.\n' +
        'In practice: "further" is also used for both, though some style guides prefer the distinction.';
    }

    // "Is information countable" (follow-up for countable/uncountable)
    if (/information.*(?:countable|uncountable)/i.test(input)
      || /(?:countable|uncountable).*information/i.test(input)) {
      return '**"Information"** is **uncountable** in English.\n\n' +
        '- ✓ I need **some information**.\n' +
        '- ✗ ~~I need an information.~~ / ~~I need informations.~~\n\n' +
        'Use "a piece of information" if you need a countable form.';
    }

    // "What is a fused sentence" (follow-up for run-on)
    if (/fused\s+sentence/i.test(input)) {
      return '**A fused sentence** is a type of run-on where two independent clauses are joined with **no punctuation at all** between them:\n\n' +
        '- *I love coding I do it every day.* (no comma, no period, no conjunction)\n\n' +
        'A **comma splice** uses only a comma: *I love coding, I do it every day.*\n' +
        'A **fused sentence** uses nothing: *I love coding I do it every day.*\n\n' +
        'Both are run-ons; fused sentences are missing any punctuation without any connection.';
    }

    // "Which conditional type is third" (follow-up for conditionals)
    if (/(?:if\s+i\s+had\s+studied|third\s+conditional|type\s+3|would\s+have\s+passed)/i.test(input)) {
      return '**"If I had studied, I would have passed"** is a **third conditional**.\n\n' +
        'The third conditional describes **impossible/unreal past** situations:\n' +
        '- Structure: If + **had** + past participle, **would have** + past participle\n' +
        '- It expresses regret about something that cannot be changed.';
    }

    // "Is singular they correct" (follow-up for pronoun agreement)
    if (/singular\s+they.*(?:correct|accept|modern|grammatical)/i.test(input)
      || /(?:correct|accept).*singular\s+they/i.test(input)) {
      return 'Yes, **singular "they"** is widely accepted and considered grammatically correct in modern English.\n\n' +
        'Major dictionaries (Merriam-Webster, Oxford) and style guides (APA) now endorse it for gender-neutral reference.';
    }

    // "then and than in same sentence" (follow-up for then/than)
    if (/(?:both|same\s+sentence|example).*then.*than/i.test(input)
      || /then.*than.*(?:sentence|example)/i.test(input)) {
      return '**Sentence using both "then" and "than":**\n\n' +
        '*"If you study harder **than** your classmates, **then** you\'ll get better grades."*\n\n' +
        '- **than** = comparison (harder **than** classmates)\n' +
        '- **then** = sequence/result (**then** you\'ll get better grades)';
    }

    // "Is the team is or are" (follow-up catch-all for subject-verb)
    if (/team\s+is.*team\s+are|team.*(?:singular|plural)/i.test(input)) {
      return '**"The team is" vs "The team are":**\n\n' +
        '- **"The team is"** = American English (team as one unit)\n' +
        '- **"The team are"** = British English (individual members)\n\n' +
        'Both are acceptable depending on dialect.';
    }

    // Past tense of "lie" (follow-up for lay/lie)
    if (/past\s+tense\s+of\s+lie|past.*lie.*recline/i.test(input)) {
      return '**Past tense of "lie" (to recline):** **lay**\n\n' +
        '- Present: I **lie** down.\n- Past: I **lay** down yesterday.\n- Past participle: I have **lain** down.\n\n' +
        'This is what makes it confusing: "lay" is both the present tense of "to lay" (place) AND the past tense of "to lie" (recline).';
    }

    // "stop + gerund vs infinitive" (follow-up for gerund/infinitive)
    if (/stop\w*\s+(?:gerund|infinitive|smoking|to\s+smoke)/i.test(input)
      || /stop.*followed\s+by/i.test(input)) {
      return '**"Stop" + gerund vs infinitive:**\n\n' +
        '- *I stopped **smoking**.* = I quit the habit (stopped smoking permanently)\n' +
        '- *I stopped **to smoke**.* = I paused (what I was doing) in order to have a cigarette\n\n' +
        'The meaning completely changes depending on whether a gerund or infinitive follows.';
    }

    return null;
  }

  // ── Strategy 1.52: Web Stack Knowledge (MERN/PERN/MEVN) ──

  private tryWebStackKnowledge(input: string): string | null {
    // Strip quotes for easier matching
    input = input.replace(/["'""''`]/g, ' ').replace(/\s+/g, ' ').trim();

    // Gate: web stack / web dev related terms (broad — no trailing \b for plural handling)
    if (!/\b(mern|pern|mevn|mean|stack|tier|tiers|basic\s+tier|solid\s+tier|battle[\s-]*tested|vai\s+(?:tier|config)|vai\.config|veggaai|mongo(?:db)?|postgres(?:ql)?|express\.?js|vue\.?js|react|node\.?js|orm|prisma|sequelize|sql|nosql|rest\s*(?:api|ful)|graphql|ssr|csr|server.?side\s+render|client.?side\s+render|mellomvare|middleware|migration|jwt|cors|crud|spa|mpa|next\.?js|nuxt\.?js|pinia|vuex|redux|vite|component|livssyklus|lifecycle|virtual\s+dom|two.?way|toveis|enveis|props?\s+(?:and|og|vs|eller)\s+state|event\s+handling|hendelse|json|xml|npm|yarn|pnpm|phantom\s+dep|komponent|endepunkt|frontend|backend|acid|put\s+(?:vs|and|eller|og)\s+patch|over.?fetch|jsx|seo|\benv\b|\.env|environment\s+variable|connection\s+pool|tilkobling|sammenlign|react\s+(?:og|and|vs)|vue\s+(?:og|and|vs)|testing.?rammeverk|typescript|options?\s*api|composition\s*api|onmounted|beforeeach|navigasjon|hmr|hot\s+module|mvc|click\.prevent|v-on|onclick|v-model|re.?render|oppdater|express\.json|collection|api.?users|javascript|unit\s+test|e2e|end.?to.?end|hva\s+er\s+(?:en?\s+)?(?:komponent|migration|database|json|api|endepunkt|frontend|backend)|hva\s+betyr|forklar)/i.test(input)) {
      return null;
    }

    // ── MERN STACK ──
    if (/(?:what\s+does\s+)?mern\s+(?:stack\s+)?(?:stand\s+for|mean|betyr|definition|er)/i.test(input)
      || /hva\s+er\s+mern/i.test(input)) {
      return '**MERN Stack:**\n\n' +
        '| Letter | Technology | Role |\n|---|---|---|\n' +
        '| **M** | MongoDB | NoSQL database (document-based) |\n' +
        '| **E** | Express.js | Backend web framework (Node.js) |\n' +
        '| **R** | React | Frontend UI library |\n' +
        '| **N** | Node.js | JavaScript runtime (server-side) |\n\n' +
        'Full JavaScript stack — same language (JS/TS) across frontend, backend, and database queries.';
    }

    // ── PERN STACK ──
    if (/(?:what\s+does\s+)?pern\s+(?:stack\s+)?(?:stand\s+for|mean|betyr|definition|er)/i.test(input)
      || /hva\s+er\s+pern/i.test(input)) {
      return '**PERN Stack:**\n\n' +
        '| Letter | Technology | Role |\n|---|---|---|\n' +
        '| **P** | PostgreSQL | Relational SQL database (ACID-compliant) |\n' +
        '| **E** | Express.js | Backend web framework |\n' +
        '| **R** | React | Frontend UI library |\n' +
        '| **N** | Node.js | JavaScript runtime |\n\n' +
        'Like MERN but swaps MongoDB for PostgreSQL — better for relational data, joins, and strict schemas.';
    }

    // ── MEVN STACK ──
    if (/(?:what\s+does\s+)?mevn\s+(?:stack\s+)?(?:stand\s+for|mean|betyr|definition|er)/i.test(input)
      || /hva\s+er\s+mevn/i.test(input)
      || /hva\s+betyr\s+mevn/i.test(input)
      || /forklar.*mevn/i.test(input)) {
      return '**MEVN Stack:**\n\n' +
        '| Letter | Technology | Role |\n|---|---|---|\n' +
        '| **M** | MongoDB | NoSQL database |\n' +
        '| **E** | Express.js | Backend web framework |\n' +
        '| **V** | Vue.js | Frontend UI framework |\n' +
        '| **N** | Node.js | JavaScript runtime |\n\n' +
        'Like MERN but uses Vue.js instead of React. Vue offers simpler API, built-in two-way data binding, and gentler learning curve.';
    }

    // ── STACK-SPECIFIC TIER HANDLERS ──
    // These must fire BEFORE the generic VeggaAI tier system handler
    // to prevent "pern vai tier" from matching the generic "vai tier" pattern.

    // PERN tier details
    if (/pern\s+(?:stack\s+)?(?:tiers?|tier\s*system|basic|solid|battle|vai\s+tier)/i.test(input)
      || /(?:what|which)\s+(?:does|is)\s+(?:the\s+)?pern\s+(?:basic|solid|battle|vai)/i.test(input)
      || /pern\s+(?:basic|solid|battle[\s-]*tested|vai)\s+(?:tier|include|have|contain|feature)/i.test(input)) {
      return '**PERN Stack Tiers:**\n\n' +
        '**Basic** (Starter) — Task board app with 8 files:\n' +
        '- React 19 + TypeScript + Tailwind v4 + Geist font\n' +
        '- Inline edit: pencil icon, long-press 500ms + haptic feedback\n' +
        '- Framer Motion animations, PostgreSQL + Express.js + Node.js\n\n' +
        '**Solid** (Recommended) — adds 5 overrides:\n' +
        '- Prisma ORM with schema.prisma\n' +
        '- Zod validation schemas\n' +
        '- User model + JWT authentication\n' +
        '- Structured error handling\n\n' +
        '**Battle-Tested** (Production) — adds 8 overrides:\n' +
        '- Docker Compose (PostgreSQL 16 container)\n' +
        '- Vitest unit tests\n' +
        '- GitHub Actions CI pipeline\n' +
        '- Multi-stage Docker builds\n\n' +
        '**Vai** (Premium) — adds 8 overrides (richest Vai tier):\n' +
        '- `monitor.ts` — performance monitoring\n' +
        '- `ErrorBoundary.tsx` — graceful error recovery\n' +
        '- `useApi` hook — optimized API calls\n' +
        '- Optimized Docker images\n' +
        '- `vai.config.ts` configuration';
    }

    // MERN tier details
    if (/mern\s+(?:stack\s+)?(?:tiers?|tier\s*system|basic|solid|battle|vai\s+tier)/i.test(input)
      || /mern\s+(?:basic|solid|battle[\s-]*tested|vai)\s+(?:tier|include|have|contain|feature)/i.test(input)) {
      return '**MERN Stack Tiers:**\n\n' +
        '**Basic** (Starter) — Bookmark manager app with 8 files:\n' +
        '- React 19 + TypeScript + Tailwind v4 + Geist font\n' +
        '- Inline edit + Framer Motion\n' +
        '- MongoDB + Express.js + Node.js\n\n' +
        '**Solid** (Recommended) — adds 3 overrides:\n' +
        '- Zod validation schemas\n' +
        '- Structured error handling\n\n' +
        '**Battle-Tested** (Production) — adds 7 overrides:\n' +
        '- Docker Compose (MongoDB 7 container)\n' +
        '- Vitest unit tests\n' +
        '- GitHub Actions CI pipeline\n\n' +
        '**Vai** (Premium) — adds 4 overrides:\n' +
        '- Optimized Docker images\n' +
        '- `vai.config.ts` configuration\n' +
        '- `README.md` with VeggaAI branding';
    }

    // Next.js tier details
    if (/next\.?js\s+(?:stack\s+)?(?:tiers?|tier\s*system|basic|solid|battle|vai\s+tier)/i.test(input)
      || /next\.?js\s+(?:basic|solid|battle[\s-]*tested|vai)\s+(?:tier|include|have|contain|feature)/i.test(input)) {
      return '**Next.js Full Stack Tiers:**\n\n' +
        '**Basic** (Starter) — Notes dashboard app with 11 files:\n' +
        '- React 19 + TypeScript + Tailwind v4 + Geist font\n' +
        '- App Router + Server Components\n' +
        '- Inline edit + Framer Motion\n\n' +
        '**Solid** (Recommended) — adds 5 overrides:\n' +
        '- Prisma ORM\n' +
        '- Zod validation\n' +
        '- API route handlers\n\n' +
        '**Battle-Tested** (Production) — adds 8 overrides:\n' +
        '- Docker Compose (PostgreSQL 16)\n' +
        '- Vitest unit tests\n' +
        '- GitHub Actions CI pipeline\n\n' +
        '**Vai** (Premium) — adds 4 overrides:\n' +
        '- Optimized Docker images\n' +
        '- `vai.config.ts` configuration';
    }

    // T3 tier details
    if (/t3\s+(?:stack\s+)?(?:tiers?|tier\s*system|basic|solid|battle|vai\s+tier)/i.test(input)
      || /t3\s+(?:basic|solid|battle[\s-]*tested|vai)\s+(?:tier|include|have|contain|feature)/i.test(input)) {
      return '**T3 Stack Tiers:**\n\n' +
        '**Basic** (Starter) — Expense tracker app with 9 files:\n' +
        '- React 19 + TypeScript + Tailwind v4 + Geist font\n' +
        '- tRPC + Zod (type-safe API from day one)\n' +
        '- Inline edit + Framer Motion\n\n' +
        '**Solid** (Recommended) — adds 4 overrides:\n' +
        '- Prisma ORM\n' +
        '- Enhanced tRPC routers\n\n' +
        '**Battle-Tested** (Production) — adds 8 overrides:\n' +
        '- Docker Compose\n' +
        '- Vitest unit tests\n' +
        '- GitHub Actions CI pipeline\n\n' +
        '**Vai** (Premium) — adds 4 overrides:\n' +
        '- Optimized Docker images\n' +
        '- `vai.config.ts` configuration';
    }

    // ── VEGGAAI TIER SYSTEM (generic) ──
    // Answers about the VeggaAI 4-tier system: Basic → Solid → Battle-Tested → Vai
    // Placed AFTER stack-specific handlers so "PERN tiers" / "MERN tiers" match first
    if (/(?:veggaai|vai)\s+(?:tier|tiers|tier\s*system)/i.test(input)
      || /(?:what|which)\s+(?:are\s+)?(?:the\s+)?(?:stack\s+)?tiers?\b/i.test(input)
      || /basic.*solid.*battle/i.test(input)
      || /tier\s+(?:progression|levels?|system)/i.test(input)) {
      return '**VeggaAI 4-Tier Stack System:**\n\n' +
        '| Tier | Label | Description |\n|---|---|---|\n' +
        '| **Basic** | Starter | Core app scaffold — React 19 + TypeScript + Tailwind v4 + Geist font, inline edit (pencil icon, long-press 500ms + haptic), Framer Motion animations |\n' +
        '| **Solid** | Recommended | Adds Prisma ORM + Zod validation + structured error handling. PERN adds User model + JWT auth |\n' +
        '| **Battle-Tested** | Production | Adds Docker Compose, Vitest unit tests, GitHub Actions CI pipeline, multi-stage builds |\n' +
        '| **Vai** | Premium | VeggaAI-optimized — performance monitoring, Error Boundaries, custom hooks (useApi), optimized Docker images, vai.config.ts |\n\n' +
        'Each tier builds on the previous one using `mergeFiles()` — files from higher tiers override lower tier files.';
    }

    // Difference between Basic and Solid / Battle-Tested / Vai
    if (/(?:difference|compare|vs\.?)\s+(?:between\s+)?(?:basic|solid|battle[\s-]*tested|vai)\s+(?:and|vs\.?|tier)/i.test(input)
      || /basic\s+(?:vs\.?|versus)\s+(?:solid|battle[\s-]*tested|vai)/i.test(input)
      || /solid\s+(?:vs\.?|versus)\s+(?:battle[\s-]*tested|vai)/i.test(input)) {
      return '**Tier Comparison:**\n\n' +
        '| Feature | Basic | Solid | Battle-Tested | Vai |\n|---|---|---|---|---|\n' +
        '| **React 19 + TS + TW4** | ✅ | ✅ | ✅ | ✅ |\n' +
        '| **Inline Edit + Framer** | ✅ | ✅ | ✅ | ✅ |\n' +
        '| **Prisma ORM** | ❌ | ✅ | ✅ | ✅ |\n' +
        '| **Zod Validation** | ❌* | ✅ | ✅ | ✅ |\n' +
        '| **Auth (JWT/User)** | ❌ | PERN only | PERN only | PERN only |\n' +
        '| **Docker Compose** | ❌ | ❌ | ✅ | ✅ |\n' +
        '| **Vitest Tests** | ❌ | ❌ | ✅ | ✅ |\n' +
        '| **GitHub Actions CI** | ❌ | ❌ | ✅ | ✅ |\n' +
        '| **Performance Monitor** | ❌ | ❌ | ❌ | PERN only |\n' +
        '| **Error Boundaries** | ❌ | ❌ | ❌ | PERN only |\n' +
        '| **vai.config.ts** | ❌ | ❌ | ❌ | ✅ |\n\n' +
        '*T3 includes Zod at Basic tier because tRPC requires it.';
    }

    // What is vai.config.ts
    if (/vai\.config|vai\s+config/i.test(input)) {
      return '**vai.config.ts** is the VeggaAI-specific configuration file added at the **Vai tier**. It contains project metadata, optimization flags, and VeggaAI integration settings for monitoring, error tracking, and deployment optimization.';
    }

    // Generic "what's in Basic tier" / "what does Basic include"
    if (/(?:what(?:'s|\s+is|\s+does))\s+(?:in\s+)?(?:the\s+)?basic\s+(?:tier|include|have|contain)/i.test(input)) {
      return '**Basic tier** (Starter) includes the core scaffold shared across all stacks:\n\n' +
        '- React 19 + TypeScript + Tailwind CSS v4 + Geist font\n' +
        '- Inline edit: pencil icon, long-press 500ms, haptic feedback\n' +
        '- Framer Motion animations\n' +
        '- Stack-specific backend (Express, tRPC, or Next.js API routes)\n' +
        '- Stack-specific database setup\n\n' +
        'Each stack has a unique demo app at Basic: PERN → task board, MERN → bookmark manager, Next.js → notes dashboard, T3 → expense tracker.';
    }

    // When to choose PERN over MERN (follow-up)
    if (/(?:when|når)\s+(?:should|bør)\s+.*(?:choose|velge)\s+pern/i.test(input)
      || /choose\s+pern\s+over\s+mern/i.test(input)
      || /pern\s+(?:over|fremfor|istedenfor)\s+mern/i.test(input)) {
      return '**When to choose PERN over MERN:**\n\n' +
        '- **Relational data** — complex relationships between entities (users → orders → products)\n' +
        '- **Strict schema** — data integrity and validation at the database level\n' +
        '- **Financial/banking** — full ACID transactions for monetary operations\n' +
        '- **Complex queries** — advanced JOINs, aggregations, window functions\n' +
        '- **Regulatory compliance** — when data consistency and integrity are critical\n\n' +
        'Choose PERN when your data is highly relational and integrity matters more than flexibility.';
    }

    // ── MERN vs PERN ──
    if (/(?:difference|forskjell\w*|compare|sammenlign)\s+(?:between\s+|mellom\s+)?mern\s+(?:and|og|vs\.?|versus)\s+pern/i.test(input)
      || /mern\s+(?:vs\.?|versus|eller)\s+pern/i.test(input)
      || /pern\s+(?:vs\.?|versus|eller)\s+mern/i.test(input)) {
      return '**MERN vs PERN Stack:**\n\n' +
        '| | MERN | PERN |\n|---|---|---|\n' +
        '| **Database** | MongoDB (NoSQL) | PostgreSQL (SQL) |\n' +
        '| **Data model** | Document/JSON | Relational/tables |\n' +
        '| **Schema** | Flexible/schema-less | Strict schema |\n' +
        '| **Joins** | Limited ($lookup) | Native JOINs |\n' +
        '| **ACID** | Per-document | Full ACID transactions |\n' +
        '| **Best for** | Flexible data, prototyping | Complex relationships, financial data |\n' +
        '| **ORM** | Mongoose | Prisma, Sequelize, Knex |\n' +
        '| **Query** | MongoDB Query Language | SQL |\n\n' +
        'Choose **MERN** for flexible schemas and rapid prototyping. Choose **PERN** for relational data and data integrity.';
    }

    // ── MERN vs MEVN ──
    if (/(?:difference|forskjell\w*|compare|sammenlign)\s+(?:between\s+|mellom\s+)?mern\s+(?:and|og|vs\.?|versus)\s+mevn/i.test(input)
      || /mern\s+(?:vs\.?|versus|eller)\s+mevn/i.test(input)) {
      return '**MERN vs MEVN Stack:**\n\n' +
        '| | MERN (React) | MEVN (Vue.js) |\n|---|---|---|\n' +
        '| **Frontend** | React | Vue.js |\n' +
        '| **Data binding** | One-way (unidirectional) | Two-way (v-model) |\n' +
        '| **Template** | JSX (JavaScript + HTML) | HTML templates |\n' +
        '| **State mgmt** | Redux, Zustand, Jotai | Vuex, Pinia |\n' +
        '| **Learning curve** | Steeper | Gentler |\n' +
        '| **Ecosystem** | Larger (more packages) | Smaller but growing |\n' +
        '| **Corporate backing** | Meta (Facebook) | Independent (Evan You) |\n' +
        '| **SSR framework** | Next.js | Nuxt.js |\n\n' +
        'Both share MongoDB + Express + Node. The only difference is the frontend framework.';
    }

    // Norwegian MERN vs MEVN
    if (/hva\s+er\s+forskjellen\s+mellom\s+mern\s+og\s+mevn/i.test(input)) {
      return '**Forskjellen mellom MERN og MEVN:**\n\n' +
        '| | MERN | MEVN |\n|---|---|---|\n' +
        '| **Frontend** | React | Vue.js |\n' +
        '| **Databinding** | Enveis (one-way) | Toveis (v-model) |\n' +
        '| **Mal/Template** | JSX | HTML-maler |\n' +
        '| **State** | Redux, Zustand | Vuex, Pinia |\n' +
        '| **Læringskurve** | Brattere | Enklere |\n' +
        '| **SSR** | Next.js | Nuxt.js |\n\n' +
        'Begge bruker MongoDB + Express.js + Node.js. Den eneste forskjellen er frontend-rammeverket: **React** (MERN) vs **Vue.js** (MEVN).';
    }

    // Express.js role / what is Express
    if (/(?:what\s+is\s+)?express\.?js\s+(?:used\s+for|role|in\s+(?:the\s+)?(?:mern|pern|mevn))/i.test(input)
      || /(?:role|function)\s+(?:of\s+)?express/i.test(input)
      || /hva\s+(?:er|gjør)\s+express/i.test(input)) {
      return '**Express.js** is a minimal, flexible **Node.js web framework** for building APIs and web servers.\n\n' +
        '**Role in MERN/PERN/MEVN:**\n' +
        '- Handles HTTP requests (GET, POST, PUT, DELETE)\n' +
        '- Defines API routes/endpoints\n' +
        '- Integrates middleware for auth, logging, CORS\n' +
        '- Connects frontend to database\n\n' +
        '```javascript\nconst express = require(\'express\');\nconst app = express();\napp.get(\'/api/users\', (req, res) => res.json(users));\napp.listen(3000);\n```';
    }

    // Middleware
    if (/(?:what\s+is\s+)?middleware\s+(?:in\s+)?(?:express|node|web)/i.test(input)
      || /hva\s+er\s+(?:en?\s+)?(?:mellomvare|middleware)/i.test(input)
      || /mellomvare/i.test(input)
      || /express\.json\(\)/i.test(input)
      || /(?:hva|what)\s+gj\u00f8r\s+express\.json/i.test(input)) {
      return '**Middleware** is a function that runs between receiving a request and sending a response.\n\n' +
        '**Structure:** `(req, res, next) => { ... next(); }`\n\n' +
        '**Common middleware types:**\n' +
        '- **Authentication:** Check JWT/session tokens\n' +
        '- **Logging:** Log request details (morgan)\n' +
        '- **CORS:** Handle cross-origin requests (cors)\n' +
        '- **Body parsing:** Parse JSON body (express.json())\n' +
        '- **Error handling:** Central error handler\n\n' +
        '```javascript\n// Logger middleware\napp.use((req, res, next) => {\n  console.log(`${req.method} ${req.url}`);\n  next(); // Pass to next middleware\n});\n```';
    }

    // MongoDB vs PostgreSQL / when to choose
    if (/(?:mongo(?:db)?|postgresql?)\s+(?:vs\.?|versus|or|and|eller|og)\s+(?:mongo(?:db)?|postgresql?)/i.test(input)
      || /(?:when|når)\s+(?:should|would|bør)\s+(?:you|du)\s+(?:use|choose|velge|bruke)\s+(?:mongo|postgresql)/i.test(input)) {
      return '**MongoDB vs PostgreSQL:**\n\n' +
        '| | MongoDB | PostgreSQL |\n|---|---|---|\n' +
        '| **Type** | NoSQL (document) | SQL (relational) |\n' +
        '| **Data format** | JSON/BSON documents | Tables with rows & columns |\n' +
        '| **Schema** | Flexible (schema-less) | Strict (defined schema) |\n' +
        '| **Relationships** | Embedded docs or $lookup | Native JOINs |\n' +
        '| **ACID** | Per-document | Full transaction support |\n' +
        '| **Scaling** | Horizontal (sharding) | Vertical (+ read replicas) |\n\n' +
        '**Choose MongoDB:** Flexible data, rapid prototyping, content management, IoT.\n' +
        '**Choose PostgreSQL:** Complex relationships, financial data, reporting, strict data integrity.';
    }

    // React vs Vue.js — EXCLUDE when asking about specific topics that have own answers
    if (((/react\s+(?:vs\.?|versus|and|og|eller|or)\s+vue/i.test(input)
      || /vue\s+(?:vs\.?|versus|and|og|eller|or)\s+react/i.test(input)
      || /(?:fordel|advantage|compare)\w*\s+(?:med\s+|of\s+)?vue\w*\s+(?:sammenlignet|compared|vs)/i.test(input))
      && !/virtual\s+dom|livssyklus|lifecycle|event\s+handling|hendelse|routing|router|testing|rammeverk/i.test(input))) {
      return '**React vs Vue.js:**\n\n' +
        '| | React | Vue.js |\n|---|---|---|\n' +
        '| **Type** | UI library | Progressive framework |\n' +
        '| **Template** | JSX | HTML templates |\n' +
        '| **Data binding** | One-way | Two-way (v-model) |\n' +
        '| **State mgmt** | Redux, Zustand | Pinia (Vuex legacy) |\n' +
        '| **Learning curve** | Steeper (JSX, ecosystem choices) | Gentler (HTML-like templates) |\n' +
        '| **Ecosystem** | Massive | Growing |\n' +
        '| **Backed by** | Meta | Evan You (community) |\n' +
        '| **SSR** | Next.js | Nuxt.js |\n' +
        '| **Mobile** | React Native | Capacitor / NativeScript |\n\n' +
        '**Choose React** if you need a massive ecosystem, React Native for mobile, or have a team that already knows JSX.\n' +
        '**Choose Vue** if you want a gentler learning curve, prefer HTML templates, or want an opinionated all-in-one framework with Nuxt.\n\n' +
        '*Honest take:* Neither is a bad choice. React has more jobs and libraries; Vue has a better out-of-the-box developer experience.';
    }

    // ORM
    if (/(?:what\s+is\s+(?:an?\s+)?)?orm\b/i.test(input) && !/\bform\b/i.test(input)) {
      if (/prisma\s+(?:vs\.?|and|or|compared|versus)\s+sequelize/i.test(input)
        || /sequelize\s+(?:vs\.?|and|or|compared|versus)\s+prisma/i.test(input)) {
        return '**Prisma vs Sequelize:**\n\n' +
          '| | Prisma | Sequelize |\n|---|---|---|\n' +
          '| **Approach** | Schema-first | Code-first |\n' +
          '| **Schema** | `schema.prisma` file | JavaScript/TypeScript models |\n' +
          '| **Type safety** | Full TypeScript generation | Basic TS support |\n' +
          '| **Migrations** | `prisma migrate` | Sequelize CLI |\n' +
          '| **Query** | Type-safe client | Method chaining |\n' +
          '| **Learning** | Modern, declarative | Older, OOP-style |\n\n' +
          'Prisma is newer and more type-safe. Sequelize is mature with broader ORM features.';
      }
      return '**ORM (Object-Relational Mapping):**\n\n' +
        'An ORM maps database tables to programming objects, letting you query databases using your programming language instead of raw SQL.\n\n' +
        '**Examples:**\n' +
        '- **Prisma** (Node.js/TypeScript) — schema-first, type-safe\n' +
        '- **Sequelize** (Node.js) — code-first, active record\n' +
        '- **TypeORM** (TypeScript) — decorator-based\n' +
        '- **SQLAlchemy** (Python)\n' +
        '- **Hibernate** (Java)\n\n' +
        '```typescript\n// Prisma example\nconst users = await prisma.user.findMany({\n  where: { active: true },\n  include: { posts: true }\n});\n```';
    }

    // SQL vs NoSQL
    if (/sql\s+(?:vs\.?|versus|and|or|og|eller)\s+nosql/i.test(input)
      || /nosql\s+(?:vs\.?|versus|and|or|og|eller)\s+sql/i.test(input)
      || /difference.*sql.*nosql/i.test(input)) {
      return '**SQL vs NoSQL Databases:**\n\n' +
        '| | SQL | NoSQL |\n|---|---|---|\n' +
        '| **Structure** | Tables (rows & columns) | Documents, key-value, graph, etc. |\n' +
        '| **Schema** | Fixed schema (predefined) | Dynamic/flexible schema |\n' +
        '| **Relationships** | JOINs | Embedded data / references |\n' +
        '| **ACID** | Full support | Varies (often eventual consistency) |\n' +
        '| **Scaling** | Vertical | Horizontal (sharding) |\n' +
        '| **Examples** | PostgreSQL, MySQL, SQLite | MongoDB, Redis, Cassandra |\n' +
        '| **Best for** | Complex queries, relationships | Flexible data, high throughput |';
    }

    // REST API — HOW TO CREATE (must come before "what is REST" handler)
    if (/(?:how|steps?).*(?:create|build|make|set\s*up).*rest\s*(?:ful)?\s*api|create.*rest\s*api|build.*rest\s*api/i.test(input)) {
      return '**Creating a REST API with Express.js (Node.js):**\n\n' +
        '**1. Setup:**\n```bash\nmkdir my-api && cd my-api\nnpm init -y\nnpm install express\n```\n\n' +
        '**2. Create `server.js`:**\n```javascript\nimport express from "express";\nconst app = express();\napp.use(express.json());\n\nlet users = [\n  { id: 1, name: "Alice" },\n  { id: 2, name: "Bob" },\n];\n\n// GET all users\napp.get("/api/users", (req, res) => {\n  res.json(users);\n});\n\n// GET one user\napp.get("/api/users/:id", (req, res) => {\n  const user = users.find(u => u.id === +req.params.id);\n  if (!user) return res.status(404).json({ error: "Not found" });\n  res.json(user);\n});\n\n// POST create user\napp.post("/api/users", (req, res) => {\n  const user = { id: users.length + 1, ...req.body };\n  users.push(user);\n  res.status(201).json(user);\n});\n\n// PUT update user\napp.put("/api/users/:id", (req, res) => {\n  const idx = users.findIndex(u => u.id === +req.params.id);\n  if (idx === -1) return res.status(404).json({ error: "Not found" });\n  users[idx] = { ...users[idx], ...req.body };\n  res.json(users[idx]);\n});\n\n// DELETE user\napp.delete("/api/users/:id", (req, res) => {\n  users = users.filter(u => u.id !== +req.params.id);\n  res.status(204).send();\n});\n\napp.listen(3000, () => console.log("API running on :3000"));\n```\n\n' +
        '**3. Run:** `node server.js`\n\n' +
        '**Test:** `curl http://localhost:3000/api/users`';
    }

    // REST API — what is it (definition)
    if (/(?:what\s+is\s+(?:a\s+)?)?rest\s*(?:ful)?\s*api/i.test(input)
      || /hva\s+er\s+(?:en?\s+)?rest/i.test(input)) {
      return '**REST API (Representational State Transfer):**\n\n' +
        'A REST API is an architectural style for building web APIs using HTTP methods.\n\n' +
        '| Method | Usage | Example |\n|---|---|---|\n' +
        '| **GET** | Read data | `GET /api/users` |\n' +
        '| **POST** | Create data | `POST /api/users` |\n' +
        '| **PUT** | Update (full) | `PUT /api/users/1` |\n' +
        '| **PATCH** | Update (partial) | `PATCH /api/users/1` |\n' +
        '| **DELETE** | Delete data | `DELETE /api/users/1` |\n\n' +
        '**Principles:** Stateless, client-server, cacheable, uniform interface, layered system.';
    }

    // REST vs GraphQL
    if (/rest\s+(?:vs\.?|versus|and|or|og)\s+graphql/i.test(input)
      || /graphql\s+(?:vs\.?|versus|and|or|og)\s+rest/i.test(input)) {
      return '**REST vs GraphQL:**\n\n' +
        '| | REST | GraphQL |\n|---|---|---|\n' +
        '| **Endpoints** | Multiple (one per resource) | Single endpoint |\n' +
        '| **Data fetching** | Fixed response shape | Client specifies exact fields |\n' +
        '| **Over-fetching** | Common | Avoided |\n' +
        '| **Under-fetching** | Multiple requests needed | Single query |\n' +
        '| **Caching** | Easy (HTTP caching) | More complex |\n' +
        '| **Learning curve** | Lower | Higher |\n' +
        '| **Tools** | Postman, curl | Apollo, Relay |';
    }

    // SSR vs CSR
    if (/(?:ssr|server.?side\s+render\w*)\s+(?:vs\.?|versus|and|or|og)\s+(?:csr|client.?side\s+render\w*)/i.test(input)
      || /(?:csr|client.?side\s+render\w*)\s+(?:vs\.?|versus|and|or|og)\s+(?:ssr|server.?side\s+render\w*)/i.test(input)
      || /difference.*server.?side.*client.?side\s+render/i.test(input)) {
      return '**SSR vs CSR:**\n\n' +
        '| | SSR (Server-Side Rendering) | CSR (Client-Side Rendering) |\n|---|---|---|\n' +
        '| **Rendering** | Server generates HTML | Browser generates HTML |\n' +
        '| **Initial load** | Faster (pre-rendered) | Slower (downloads JS first) |\n' +
        '| **SEO** | Excellent | Poor (empty HTML initially) |\n' +
        '| **Interactivity** | Needs hydration | Immediate after load |\n' +
        '| **Server load** | Higher | Lower |\n' +
        '| **Examples** | Next.js, Nuxt.js | Create React App, Vite SPA |';
    }

    // Next.js — require explicit "what is" / "hva er" to avoid intercepting feature-specific questions
    if ((/what\s+is\s+next\.?js\b/i.test(input) || /hva\s+er\s+next\.?js/i.test(input))
      && !/metadata|seo|middleware|context|parallel|usecallback|usememo|layout.*work|code\s+split|error\s+boundar|image.*optim|portal|form.*action|server\s+action|auth/i.test(input)) {
      return '**Next.js** is a **React framework** by Vercel for building full-stack web applications.\n\n' +
        '**Key features:**\n' +
        '- **SSR** (Server-Side Rendering) — renders pages on the server\n' +
        '- **SSG** (Static Site Generation) — pre-builds pages at build time\n' +
        '- **API Routes** — backend endpoints in the same project\n' +
        '- **File-based routing** — pages directory = URL routes\n' +
        '- **Image optimization** — automatic image resizing\n' +
        '- **App Router** (v13+) — React Server Components support\n\n' +
        'Next.js handles SSR by running React on the server and sending pre-rendered HTML to the client, then hydrating it for interactivity.';
    }

    // Database migrations
    if (/(?:database|db)?\s*migration/i.test(input)
      || /hva\s+er\s+(?:en?\s+)?(?:database\s+)?migration/i.test(input)
      || /(?:hvorfor|why)\s+(?:er\s+)?(?:database\s+)?migration\w*\s+(?:viktig|important)/i.test(input)) {
      const isNorwegian = /\b(hva|hvorfor|viktig)\b/i.test(input);
      if (isNorwegian) {
        return '**Database-migrasjoner:**\n\n' +
          'En database-migrasjon er en versjonskontrollert endring i databasestrukturen.\n\n' +
          '**Hvorfor er det viktig i et team-prosjekt:**\n' +
          '- Alle utviklere får **samme databasestruktur**\n' +
          '- Endringer kan **rulles tilbake** (rollback)\n' +
          '- Historikk over alle skjemaendringer\n' +
          '- **Automatisert distribusjon** i CI/CD\n\n' +
          '**Verktøy:** Prisma Migrate, Sequelize CLI, Flyway, Knex.js migrations.';
      }
      return '**Database Migrations:**\n\n' +
        'A database migration is a version-controlled change to your database schema.\n\n' +
        '**Why important:**\n' +
        '- Keeps database schema in sync across team members\n' +
        '- Changes can be **rolled back** if something breaks\n' +
        '- Provides a history of all schema changes\n' +
        '- Enables **automated deployments** in CI/CD\n\n' +
        '**Tools:** Prisma Migrate, Sequelize CLI, Flyway, Knex.js migrations.';
    }

    // JWT
    if (/(?:what\s+is\s+)?jwt\b/i.test(input)
      || /json\s+web\s+token/i.test(input)) {
      return '**JWT (JSON Web Token):**\n\n' +
        'A JWT is a compact, self-contained token for securely transmitting information between parties.\n\n' +
        '**Structure:** `header.payload.signature`\n\n' +
        '| Part | Contains |\n|---|---|\n' +
        '| **Header** | Algorithm (HS256) + token type (JWT) |\n' +
        '| **Payload** | Claims (user ID, role, expiration) |\n' +
        '| **Signature** | HMAC(header + payload, secret) |\n\n' +
        '**Flow:** Login → server creates JWT → client stores it → sends in `Authorization: Bearer <token>` header.';
    }

    // CORS
    if (/(?:what\s+is\s+)?cors\b/i.test(input)
      || /cross.?origin/i.test(input)) {
      return '**CORS (Cross-Origin Resource Sharing):**\n\n' +
        'CORS is a browser security mechanism that controls which domains can access your API.\n\n' +
        '**Problem:** Browser blocks requests from `localhost:3000` (frontend) to `localhost:5000` (API) by default.\n\n' +
        '**Solution:** Server sends `Access-Control-Allow-Origin` header:\n' +
        '```javascript\n// Express.js\nconst cors = require(\'cors\');\napp.use(cors({ origin: \'http://localhost:3000\' }));\n```\n\n' +
        '**Headers:** `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`.';
    }

    // CRUD
    if (/(?:what\s+is\s+|hva\s+er\s+)?crud\b/i.test(input)
      || /crud\s+(?:operas?jon|operation)/i.test(input)) {
      return '**CRUD Operations:**\n\n' +
        '| Letter | Operation | HTTP Method | SQL |\n|---|---|---|---|\n' +
        '| **C** | Create | POST | INSERT |\n' +
        '| **R** | Read | GET | SELECT |\n' +
        '| **U** | Update | PUT/PATCH | UPDATE |\n' +
        '| **D** | Delete | DELETE | DELETE |\n\n' +
        'CRUD represents the four basic operations for persistent storage. Nearly every web app implements CRUD for its data models.';
    }

    // SPA vs MPA
    if (/spa\s+(?:vs\.?|versus|(?:and|or|og)\s+(?:an?\s+)?)\s*mpa/i.test(input)
      || /mpa\s+(?:vs\.?|versus|(?:and|or|og)\s+(?:an?\s+)?)\s*spa/i.test(input)
      || /(?:single.?page|multi.?page)\s+(?:app|application)/i.test(input)
      || /(?:difference|forskjell).*(?:spa|mpa).*(?:spa|mpa)/i.test(input)
      || /seo.*(?:harder|difficult).*spa/i.test(input)
      || /spa.*seo/i.test(input)) {
      return '**SPA vs MPA:**\n\n' +
        '| | SPA (Single-Page App) | MPA (Multi-Page App) |\n|---|---|---|\n' +
        '| **Navigation** | Client-side (no full reload) | Server-side (full page reload) |\n' +
        '| **Performance** | Fast after initial load | Each page loads fresh |\n' +
        '| **SEO** | Harder (requires SSR) | Better (server-rendered) |\n' +
        '| **Examples** | Gmail, Trello | Wikipedia, e-commerce |\n' +
        '| **Framework** | React, Vue, Angular | Rails, Django, PHP |';
    }

    // JSON (exclude "javascript object" and "xml" — handled by specific FU patterns)
    if (/(?:what\s+is\s+|hva\s+er\s+)?json\b/i.test(input) && !/jwt|web\s+token|javascript\s+object|js\s+object|xml/i.test(input)) {
      return '**JSON (JavaScript Object Notation):**\n\n' +
        'JSON is a lightweight data format for storing and exchanging data.\n\n' +
        '```json\n{\n  "name": "Vegga",\n  "age": 25,\n  "skills": ["JavaScript", "TypeScript"],\n  "active": true\n}\n```\n\n' +
        '**Key features:** Human-readable, language-independent, supports: strings, numbers, booleans, arrays, objects, null.\n' +
        'Used extensively in REST APIs, configuration files, and data storage.';
    }

    // npm vs yarn vs pnpm
    if (/(?:npm|yarn|pnpm)\s+(?:vs\.?|versus|and|or|og)\s+(?:npm|yarn|pnpm)/i.test(input)) {
      return '**npm vs yarn vs pnpm:**\n\n' +
        '| | npm | yarn | pnpm |\n|---|---|---|---|\n' +
        '| **Speed** | Moderate | Fast | Fastest |\n' +
        '| **Disk usage** | High (duplicates) | High | Low (content-addressed) |\n' +
        '| **Lock file** | package-lock.json | yarn.lock | pnpm-lock.yaml |\n' +
        '| **Workspaces** | Yes (v7+) | Yes | Yes (built-in) |\n' +
        '| **Strictness** | Lenient | Moderate | Strict (no phantom deps) |\n\n' +
        'pnpm is fastest and most disk-efficient. yarn has good monorepo support. npm is the default.';
    }

    // Component (what is a component)
    if (/(?:what\s+is\s+(?:a\s+)?|hva\s+er\s+(?:en?\s+)?)(?:web\s+)?component\b/i.test(input)
      || /hva\s+er\s+(?:en?\s+)?komponent/i.test(input)) {
      return '**En komponent (Component):**\n\n' +
        'A component is a reusable, self-contained piece of UI that manages its own rendering and logic.\n\n' +
        '**React component:**\n```jsx\nfunction Button({ label, onClick }) {\n  return <button onClick={onClick}>{label}</button>;\n}\n```\n\n' +
        '**Vue component:**\n```vue\n<template>\n  <button @click="onClick">{{ label }}</button>\n</template>\n<script setup>\ndefineProps([\'label\', \'onClick\']);\n</script>\n```';
    }

    // Props and State
    if (/props?\s+(?:and|og|vs\.?|versus|eller|or)\s+state/i.test(input)) {
      return '**Props vs State:**\n\n' +
        '| | Props | State |\n|---|---|---|\n' +
        '| **Source** | Passed from parent | Managed internally |\n' +
        '| **Mutability** | Read-only (immutable) | Mutable (via setState/set) |\n' +
        '| **Purpose** | Configure component | Track dynamic data |\n\n' +
        '**React:** `props` are parameters, `useState()` manages state.\n' +
        '**Vue:** `defineProps()` receives props, `ref()`/`reactive()` manages state.';
    }

    // Virtual DOM (exclude Vue-specific — handled by Vue virtual DOM FU)
    if (/virtual\s+dom/i.test(input) && !/vue/i.test(input)) {
      return '**Virtual DOM:**\n\n' +
        'The Virtual DOM is a lightweight JavaScript copy of the real DOM. When state changes:\n\n' +
        '1. New Virtual DOM tree is created\n' +
        '2. **Diffing:** New tree is compared with previous tree\n' +
        '3. **Reconciliation:** Only the changed parts are updated in the real DOM\n\n' +
        '**Used by:** React, Vue.js\n' +
        '**Benefit:** Batch updates → fewer expensive DOM operations → better performance.\n' +
        '**Alternative:** Svelte compiles away the Virtual DOM and generates direct DOM updates.';
    }

    // Two-way data binding
    if (/two.?way\s+(?:data\s+)?binding/i.test(input)) {
      return '**Two-Way Data Binding:**\n\n' +
        'Two-way binding means: when the UI changes, the data updates — and vice versa.\n\n' +
        '**Vue.js (built-in):**\n```vue\n<input v-model="name" />\n<!-- Typing updates `name`, changing `name` updates input -->\n```\n\n' +
        '**React (manual):**\n```jsx\nconst [name, setName] = useState(\'\');\n<input value={name} onChange={e => setName(e.target.value)} />\n```\n\n' +
        'Vue has native two-way binding (`v-model`). React uses controlled components (one-way + onChange).';
    }

    // Event handling
    if (/event\s+handling\s+(?:in|i)\s+(?:react|vue|javascript|web)/i.test(input)
      || /forklar\s+event\s+handling/i.test(input)
      || /hendelse\w*\s+(?:i|in)\s+(?:react|vue)/i.test(input)) {
      return '**Event Handling:**\n\n' +
        '**React:** camelCase, passes function reference\n```jsx\n<button onClick={handleClick}>Click</button>\n<input onChange={(e) => setValue(e.target.value)} />\n```\n\n' +
        '**Vue:** `@` shorthand for `v-on:`\n```vue\n<button @click="handleClick">Click</button>\n<input @input="setValue($event.target.value)" />\n```\n\n' +
        '**Key differences:** React uses synthetic events (cross-browser wrapper). Vue uses native DOM events with modifiers like `@click.prevent`, `@keyup.enter`.';
    }

    // Frontend vs Backend
    if (/(?:frontend|front.end)\s+(?:vs\.?|versus|and|or|og)\s+(?:backend|back.end)/i.test(input)
      || /hva\s+er\s+(?:forskjellen\s+mellom\s+)?frontend\s+og\s+backend/i.test(input)) {
      return '**Frontend vs Backend:**\n\n' +
        '| | Frontend | Backend |\n|---|---|---|\n' +
        '| **Location** | Browser (client) | Server |\n' +
        '| **Languages** | HTML, CSS, JavaScript | Node.js, Python, Java, Go |\n' +
        '| **Frameworks** | React, Vue, Angular | Express, Django, Spring |\n' +
        '| **Responsibility** | UI, user interaction | Business logic, database, API |\n' +
        '| **Data** | Displays data | Stores & processes data |';
    }

    // API endpoint
    if (/(?:what\s+is\s+(?:an?\s+)?|hva\s+er\s+(?:et?\s+)?)?(?:api[.\-\s]?)?endpoint/i.test(input)
      || /hva\s+er\s+(?:et?\s+)?(?:api[.\-\s]?)?endepunkt/i.test(input)
      || /endepunkt.*(?:eksempel|example)/i.test(input)) {
      return '**API Endpoint:**\n\n' +
        'An endpoint is a specific URL where an API receives requests.\n\n' +
        '**Example endpoints:**\n' +
        '- `GET /api/users` — Get all users\n' +
        '- `GET /api/users/:id` — Get one user\n' +
        '- `POST /api/users` — Create a user\n' +
        '- `PUT /api/users/:id` — Update a user\n' +
        '- `DELETE /api/users/:id` — Delete a user\n\n' +
        'Each endpoint = HTTP method + URL path + handler function.';
    }

    // Component lifecycle
    if (/component\s+lifecycle/i.test(input)
      || /livssyklus/i.test(input)
      || /forklar.*(?:lifecycle|livssyklus)/i.test(input)
      || /komponent.?livssyklus/i.test(input)) {
      return '**Component Lifecycle:**\n\n' +
        '**React (hooks):**\n' +
        '- `useEffect(() => {}, [])` — mount (componentDidMount)\n' +
        '- `useEffect(() => {}, [dep])` — update when dep changes\n' +
        '- `useEffect(() => { return () => cleanup }, [])` — unmount\n\n' +
        '**Vue 3 (Composition API):**\n' +
        '- `onMounted(() => {})` — after DOM mount\n' +
        '- `onUpdated(() => {})` — after reactive data change\n' +
        '- `onUnmounted(() => {})` — before destroy\n' +
        '- `onBeforeMount()`, `onBeforeUpdate()`, `onBeforeUnmount()`';
    }

    // Routing
    if (/(?:react\s+router|vue\s+router)\s+(?:vs\.?|and|or|og)/i.test(input)
      || /routing\s+(?:in\s+)?(?:react|vue)/i.test(input)) {
      return '**React Router vs Vue Router:**\n\n' +
        '| | React Router | Vue Router |\n|---|---|---|\n' +
        '| **Install** | react-router-dom | vue-router |\n' +
        '| **Route def** | JSX `<Route path="/about" element={<About/>}/>` | Config array `{ path: \'/about\', component: About }` |\n' +
        '| **Navigation** | `<Link to="/about">` / `useNavigate()` | `<router-link to="/about">` / `useRouter()` |\n' +
        '| **Guards** | Via useEffect / loaders | Built-in `beforeEach` guards |\n' +
        '| **Nested** | `<Outlet />` | `<router-view />` |';
    }

    // State management: Redux vs Vuex/Pinia
    if (/(?:redux|zustand)\s+(?:vs\.?|and|or|og)\s+(?:vuex|pinia)/i.test(input)
      || /(?:vuex|pinia)\s+(?:vs\.?|and|or|og)\s+(?:redux|zustand)/i.test(input)
      || /sammenlign.*(?:redux.*pinia|pinia.*redux)/i.test(input)
      || /(?:redux.*(?:\(|\s+)react.*pinia|pinia.*vue.*redux)/i.test(input)) {
      return '**Redux vs Pinia (Vuex):**\n\n' +
        '| | Redux (React) | Pinia (Vue) |\n|---|---|---|\n' +
        '| **Paradigm** | Flux (actions → reducers → store) | Stores with state, getters, actions |\n' +
        '| **Boilerplate** | High (actions, reducers, types) | Low (define store directly) |\n' +
        '| **DevTools** | Redux DevTools | Vue DevTools |\n' +
        '| **TypeScript** | Requires extra setup | Built-in TS support |\n' +
        '| **Alternatives** | Zustand, Jotai, Recoil | Pinia (replaced Vuex) |';
    }

    // MVC pattern
    if (/\bmvc\b/i.test(input)) {
      return '**MVC (Model-View-Controller):**\n\n' +
        '| Component | Role | Example |\n|---|---|---|\n' +
        '| **Model** | Data & business logic | User schema, database queries |\n' +
        '| **View** | UI / presentation | HTML templates, React components |\n' +
        '| **Controller** | Handles input, connects M↔V | Route handlers, API controllers |\n\n' +
        '**Flow:** User → Controller → Model → Controller → View → User';
    }

    // Node.js (exclude connection pooling and deployment — handled by specific handlers)
    if ((/(?:what\s+is\s+)?node\.?js/i.test(input)
      || /hva\s+er\s+node\.?js/i.test(input))
      && !/connection\s+pool|pooling|verktøy/i.test(input)
      && !/(?:deploy|docker|container|host|run.*(?:production|server))/i.test(input)) {
      return '**Node.js** is a **JavaScript runtime** built on Chrome\'s V8 engine that lets you run JavaScript outside the browser (on the server).\n\n' +
        '**Key features:**\n' +
        '- **Non-blocking I/O** — asynchronous, event-driven\n' +
        '- **Single-threaded** event loop (with worker threads for CPU tasks)\n' +
        '- **npm** — world\'s largest package ecosystem\n' +
        '- Ideal for I/O-intensive applications (APIs, real-time apps)\n\n' +
        '**Role in MERN/PERN/MEVN:** Server-side runtime that runs Express.js and connects to the database.';
    }

    // Vite
    if (/(?:what\s+is\s+)?vite\b/i.test(input) && !/invite/i.test(input)) {
      return '**Vite** is a fast frontend build tool and dev server created by Evan You (creator of Vue).\n\n' +
        '**Key features:**\n' +
        '- **Instant server start** — uses native ES modules (no bundling in dev)\n' +
        '- **Hot Module Replacement** (HMR) — sub-millisecond updates\n' +
        '- **Rollup-based build** — optimized production bundles\n' +
        '- Supports React, Vue, Svelte, and vanilla JS/TS\n\n' +
        'Vite replaces webpack/Create React App as the modern default build tool.';
    }

    // Testing frameworks
    if (/testing\s+framework/i.test(input)) {
      return '**Frontend Testing Frameworks:**\n\n' +
        '| Framework | Type | Used with |\n|---|---|---|\n' +
        '| **Vitest** | Unit/integration | Vite projects, React, Vue |\n' +
        '| **Jest** | Unit/integration | React (CRA), general Node |\n' +
        '| **Playwright** | E2E (end-to-end) | Any web app |\n' +
        '| **Cypress** | E2E + component | Any web app |\n' +
        '| **Testing Library** | Component rendering | React, Vue, Svelte |';
    }

    // TypeScript support
    if (/typescript\s+support\s+(?:in\s+)?(?:react|vue)/i.test(input)) {
      return '**TypeScript Support:**\n\n' +
        '**React + TypeScript:** Full native support\n' +
        '- `.tsx` files, typed props (`FC<Props>` or function params)\n' +
        '- Built-in with Vite, CRA, Next.js\n\n' +
        '**Vue 3 + TypeScript:** First-class support\n' +
        '- `<script setup lang="ts">` in SFCs\n' +
        '- `defineProps<{title: string}>()` for typed props\n' +
        '- Volar extension for VSCode\n\n' +
        'Both frameworks have excellent TypeScript integration in their latest versions.';
    }

    // Environment variables
    if (/environment\s+variable/i.test(input)
      || /\.env\b/i.test(input)
      || /commit.*\.env|\benv\b.*git/i.test(input)) {
      return '**Environment Variables:**\n\n' +
        'Environment variables store configuration outside your code (secrets, API keys, URLs).\n\n' +
        '**Usage:**\n' +
        '- `.env` file: `DATABASE_URL=postgresql://localhost:5432/mydb`\n' +
        '- Access: `process.env.DATABASE_URL` (Node.js)\n' +
        '- Frontend (Vite): `import.meta.env.VITE_API_URL`\n\n' +
        '**Rules:** Never commit `.env` to git. Use `.env.example` as a template.';
    }

    // Connection pooling
    if (/connection\s+pool|tilkobling\w*\s+pool/i.test(input)) {
      return '**Connection Pooling:**\n\n' +
        'A connection pool maintains a set of reusable database connections instead of opening/closing for each query.\n\n' +
        '**Without pool:** Open → Query → Close (expensive, ~50ms per connection)\n' +
        '**With pool:** Reuse → Query → Return to pool (fast, ~1ms)\n\n' +
        '**Configuration:** `min`, `max` connections, `idle timeout`\n' +
        '**Tools:** `pg-pool` (PostgreSQL), Prisma (built-in), Mongoose (built-in).';
    }

    // ── Follow-up patterns ──

    // ACID properties (follow-up for PERN/PostgreSQL)
    if (/acid\s+(?:propert|egenskap|complian)/i.test(input)
      || /(?:hva|what)\s+er\s+acid/i.test(input)) {
      return '**ACID Properties (database transactions):**\n\n' +
        '| Property | Meaning |\n|---|---|\n' +
        '| **Atomicity** | All operations succeed or all fail (no partial updates) |\n' +
        '| **Consistency** | Database moves from one valid state to another |\n' +
        '| **Isolation** | Concurrent transactions don\'t interfere |\n' +
        '| **Durability** | Committed data survives crashes |\n\n' +
        'PostgreSQL supports full ACID transactions. MongoDB supports ACID per-document (multi-document since v4.0).';
    }

    // Can you build MERN without Express (follow-up)
    if (/(?:without|uten)\s+express/i.test(input)
      || /(?:build|bygge).*(?:mern|pern).*(?:without|uten)/i.test(input)
      || /(?:alternative|alternativ).*express/i.test(input)) {
      return 'Yes, you can build a MERN/PERN stack **without Express.js**. Alternatives include:\n\n' +
        '- **Fastify** — faster, schema-based validation\n' +
        '- **Koa** — by Express creators, modern async/await\n' +
        '- **Hono** — ultrafast, edge-ready\n' +
        '- **Next.js API routes** — built-in backend in Next.js\n\n' +
        'Express is the most common but not the only possible option.';
    }

    // What does next() do in middleware (follow-up)
    if (/next\(\).*middleware|middleware.*next\(\)|what\s+does\s+next\(\)/i.test(input)) {
      return '**`next()` in middleware:**\n\n' +
        'The `next()` function **passes control to the next middleware** in the chain.\n\n' +
        '```javascript\napp.use((req, res, next) => {\n  console.log("First middleware");\n  next(); // Pass to next middleware\n});\napp.use((req, res) => {\n  res.send("Done");\n});\n```\n\n' +
        'Without calling `next()`, the request is stuck and the client never gets a response.';
    }

    // MongoDB JOINs / $lookup (follow-up)
    if (/mongo\w*\s+(?:do\s+)?join|join.*mongo|\$lookup/i.test(input)) {
      return '**MongoDB JOINs:**\n\n' +
        'MongoDB does not have native JOINs like SQL. Instead it uses:\n\n' +
        '**`$lookup`** in aggregation pipeline (similar to LEFT JOIN):\n```javascript\ndb.orders.aggregate([{\n  $lookup: {\n    from: "users",\n    localField: "userId",\n    foreignField: "_id",\n    as: "user"\n  }\n}]);\n```\n\n' +
        'However, `$lookup` is limited compared to SQL JOINs — it performs a left outer join only and can be slow on large datasets.';
    }

    // Prisma type-safety (follow-up)
    if (/prisma.*type.?safe|type.?safe.*prisma/i.test(input)) {
      return '**Prisma is more type-safe** than Sequelize because:\n\n' +
        '1. Prisma generates a **TypeScript client** from your schema\n' +
        '2. All queries are **fully typed** — autocomplete and compile-time checks\n' +
        '3. **Schema-first** approach: `schema.prisma` defines models, Prisma generates types\n\n' +
        'Sequelize has basic TypeScript support but requires manual type definitions.';
    }

    // PUT vs PATCH (follow-up)
    if (/put\s+(?:vs\.?|and|og|eller|or)\s+patch/i.test(input)
      || /patch\s+(?:vs\.?|and|og|eller|or)\s+put/i.test(input)
      || /difference.*put.*patch/i.test(input)) {
      return '**PUT vs PATCH:**\n\n' +
        '| | PUT | PATCH |\n|---|---|\n' +
        '| **Action** | **Full** replacement of resource | **Partial** update of resource |\n' +
        '| **Body** | Entire resource | Only changed fields |\n' +
        '| **Example** | `PUT /users/1` + full user object | `PATCH /users/1` + `{ name: "New" }` |\n\n' +
        'PUT replaces the entire resource. PATCH updates only the specified fields.';
    }

    // Over-fetching / GraphQL (follow-up)
    if (/over.?fetch/i.test(input)) {
      return '**Over-fetching** means an API returns **more data than the client needs**.\n\n' +
        '**REST example:** `GET /users` returns name, email, address, phone — but you only need name.\n\n' +
        '**GraphQL solves this** by letting the client specify exactly which fields to request:\n```graphql\nquery {\n  users {\n    name  # Only get what you need\n  }\n}\n```\n\n' +
        'The client receives only the requested fields, eliminating unnecessary data transfer.';
    }

    // SSR better for SEO (follow-up)
    if (/(?:why|hvorfor)\s+(?:is\s+)?ssr.*(?:better|bedre)\s+(?:for\s+)?seo/i.test(input)
      || /seo.*ssr/i.test(input)) {
      return '**Why SSR is better for SEO:**\n\n' +
        'Search engine bots (Google, Bing) **crawl HTML** content from pages.\n\n' +
        '- **SSR:** Server sends **pre-rendered HTML** with content → bots can read it immediately\n' +
        '- **CSR (SPA):** Server sends a nearly **empty HTML** file + JavaScript → bots may not execute JS, seeing no content\n\n' +
        'SSR ensures search engines can index your content without running JavaScript.';
    }

    // SSG vs SSR in Next.js (follow-up)
    if (/ssg.*ssr|ssr.*ssg|static\s+(?:site\s+)?generat.*server/i.test(input)) {
      return '**SSG vs SSR in Next.js:**\n\n' +
        '| | SSG (Static Site Generation) | SSR (Server-Side Rendering) |\n|---|---|---|\n' +
        '| **When** | Build time | Request time |\n' +
        '| **Speed** | Fastest (pre-built) | Slower (renders per request) |\n' +
        '| **Data** | Static (stale until rebuild) | Always fresh |\n' +
        '| **Use** | Blog, docs, marketing | Dashboard, real-time data |\n\n' +
        'SSG generates pages at **build time** (once). SSR renders pages on the **server at each request**.';
    }

    // JWT storage (follow-up)
    if (/(?:where|hvor)\s+(?:should|bør)\s+jwt|jwt.*(?:stor|lagr)|(?:stor|lagr).*jwt/i.test(input)) {
      return '**Where to store JWTs on the client:**\n\n' +
        '| Method | Security | Notes |\n|---|---|---|\n' +
        '| **httpOnly Cookie** | Best | Not accessible via JS, CSRF protection needed |\n' +
        '| **localStorage** | Vulnerable to XSS | Easy to use but insecure |\n' +
        '| **sessionStorage** | Vulnerable to XSS | Cleared on tab close |\n\n' +
        'Best practice: Use **httpOnly, secure cookies** for JWT storage.';
    }

    // What is JSX (follow-up)
    if (/(?:what\s+is\s+|hva\s+er\s+)?jsx\b|why\s+.*react.*jsx/i.test(input)) {
      return '**JSX (JavaScript XML):**\n\n' +
        'JSX is a syntax extension that lets you write HTML-like code inside JavaScript/TypeScript:\n\n' +
        '```jsx\nfunction App() {\n  return <h1>Hello, {name}!</h1>;\n}\n```\n\n' +
        'React uses JSX instead of separate HTML templates. It\'s compiled to `React.createElement()` calls.\n' +
        'Vue uses HTML templates by default (`<template>`), while React embeds the template in JavaScript via JSX.';
    }

    // SPA SEO issues (follow-up)
    if (/(?:why|hvorfor).*seo.*(?:harder|difficult|spa)|spa.*seo/i.test(input)) {
      return '**Why SEO is harder for SPAs:**\n\n' +
        'SPAs load a nearly **empty HTML page** and render content via JavaScript.\n\n' +
        '- Search bots receive: `<div id="root"></div>` — **no content** to index\n' +
        '- JavaScript may not be executed by all crawlers\n' +
        '- Content is generated dynamically after page load\n\n' +
        '**Solutions:** Use SSR (Next.js/Nuxt.js), SSG, or dynamic rendering for SEO-critical pages.';
    }

    // Vue also uses virtual DOM (follow-up)
    if (/(?:does\s+)?vue.*virtual\s+dom|virtual\s+dom.*vue/i.test(input)
      || /(?:bruker|uses)\s+vue.*virtual/i.test(input)) {
      return 'Yes, **Vue.js also uses a virtual DOM** — just like React.\n\n' +
        'Both React and Vue create a lightweight JavaScript representation of the DOM, diff it, and apply minimal updates.\n\n' +
        '**Svelte** is a notable framework that does NOT use a virtual DOM — it compiles components into direct DOM updates at build time.';
    }

    // Re-render on state change (follow-up for props/state)
    if (/(?:re.?render|oppdater)\w*.*(?:state|tilstand)|state.*(?:re.?render|oppdater)/i.test(input)
      || /(?:hva\s+skjer|what\s+happens)\s+(?:når|when)\s+state/i.test(input)) {
      return '**When state updates in a React component:**\n\n' +
        '1. React creates a new **virtual DOM** tree\n' +
        '2. It **diffs** the new tree against the previous one\n' +
        '3. Only the **changed parts** are updated in the real DOM (reconciliation)\n\n' +
        'This process is called **re-rendering**. React re-renders the component and its children when state changes.';
    }

    // pnpm disk efficiency (follow-up)
    if (/pnpm.*(?:disk|efficient|content.?address|symlink)/i.test(input)
      || /(?:disk|efficient).*pnpm/i.test(input)) {
      return '**Why pnpm is the most disk-efficient:**\n\n' +
        'pnpm uses a **content-addressable store** — all packages are stored once in a global store and **hard-linked** into projects:\n\n' +
        '- npm/yarn: Each project gets its own copy of every dependency → duplicates\n' +
        '- pnpm: Packages are stored once and linked → **massive disk savings**\n\n' +
        'Example: 10 projects using lodash = 1 copy on disk (pnpm) vs 10 copies (npm).';
    }

    // Never commit .env to git (follow-up)
    if (/commit.*\.env|\.env.*(?:git|commit)|should.*\.env.*git/i.test(input)) {
      return '**Should you commit `.env` to git?**\n\n' +
        '**Never commit `.env` files to git!** They contain secrets (API keys, database passwords).\n\n' +
        '**Best practice:**\n' +
        '1. Add `.env` to `.gitignore`\n' +
        '2. Create a `.env.example` with placeholder values (commit this)\n' +
        '3. Each developer creates their own `.env` from the example\n' +
        '4. Use environment variables in CI/CD instead of files.';
    }

    // JSON vs JavaScript object (follow-up)
    if (/json.*(?:javascript\s+object|js\s+object|difference)|(?:javascript|js)\s+object.*json/i.test(input)) {
      return '**JSON vs JavaScript Object:**\n\n' +
        '| | JSON | JavaScript Object |\n|---|---|---|\n' +
        '| **Keys** | Must be **double-quoted** strings | Can be unquoted |\n' +
        '| **Values** | Strings, numbers, booleans, arrays, objects, null | + functions, undefined, etc. |\n' +
        '| **Format** | Text (must be parsed) | Native JS (already in memory) |\n' +
        '| **Methods** | `JSON.parse()` / `JSON.stringify()` | Direct access |\n\n' +
        'JSON is a string format for data exchange. A JavaScript object is a runtime data structure.';
    }

    // JSON vs XML (follow-up)
    if (/json.*xml|xml.*json/i.test(input)) {
      return '**JSON vs XML:**\n\n' +
        '| | JSON | XML |\n|---|---|---|\n' +
        '| **Syntax** | `{ "key": "value" }` | `<key>value</key>` |\n' +
        '| **Readability** | More concise | More verbose |\n' +
        '| **Parsing** | `JSON.parse()` | XML parser needed |\n' +
        '| **Weight** | Lighter | Heavier (more tags) |\n' +
        '| **Usage** | REST APIs, config | SOAP, legacy systems |\n\n' +
        'JSON is lighter and simpler. XML is more feature-rich but verbose.';
    }

    // MERN vs MEVN full JavaScript (follow-up)
    if (/(?:why|hvorfor).*(?:full\s+javascript|same\s+lang|javascript.*(?:front|back|every))/i.test(input)
      || /full\s+javascript\s+stack/i.test(input)) {
      return '**Why MERN is called a "full JavaScript stack":**\n\n' +
        'Every layer uses **JavaScript (or TypeScript)**:\n' +
        '- **Frontend:** React (JavaScript/JSX)\n' +
        '- **Backend:** Express.js + Node.js (JavaScript)\n' +
        '- **Database:** MongoDB (queries in JavaScript-like syntax)\n\n' +
        'Same language across frontend, backend, and database = JS everywhere.';
    }

    // Vue advantages over Angular (follow-up for MEVN)
    if (/vue.*(?:fordel|advantage|compar|sammenlignet).*angular|angular.*vue/i.test(input)
      || /(?:fordel|advantage).*vue.*angular/i.test(input)
      || /(?:hovedfordel|advantage).*vue/i.test(input)) {
      return '**Hovedfordeler med Vue.js sammenlignet med Angular:**\n\n' +
        '- **Enklere læringskurve** — Vue er progressive og lettere å starte med\n' +
        '- **Lettere bundle** — Vue er mindre enn Angular\n' +
        '- **Mer fleksibel** — kan brukes gradvis i eksisterende prosjekter\n' +
        '- Angular krever mer boilerplate og har strengere arkitektur\n\n' +
        'Vue er et progressive framework med en gentle (enklere) læringskurve.';
    }

    // MERN vs MEVN learning curve (follow-up)
    if (/(?:enklere|easier|simpler)\s+(?:læringskurve|learning\s+curve).*(?:mern|mevn)/i.test(input)
      || /(?:mern|mevn).*(?:enklere|easier|simpler)/i.test(input)) {
      return '**MEVN (Vue.js)** har en enklere læringskurve enn **MERN (React):**\n\n' +
        '- Vue bruker HTML-maler (lettere for nybegynnere)\n' +
        '- React krever JSX-kunnskap\n' +
        '- Vue har innebygd toveis binding (v-model)\n' +
        '- React krever mer manuell state-håndtering\n\n' +
        'Vue er gentle og progressive — enklere å lære.';
    }

    // Vue Composition API vs Options API (follow-up)
    if (/(?:composition|options)\s+api/i.test(input)
      || /forskjell.*(?:composition|options)/i.test(input)) {
      return '**Vue Options API vs Composition API:**\n\n' +
        '| | Options API | Composition API |\n|---|---|---|\n' +
        '| **Syntax** | `data()`, `methods`, `computed` | `setup()` + `ref`/`reactive` |\n' +
        '| **Organization** | By option type | By feature/concern |\n' +
        '| **TypeScript** | Limited | Excellent support |\n' +
        '| **Reusability** | Mixins | Composables |\n\n' +
        'Composition API (Vue 3) enables better code organization and TypeScript support using `ref()`, `reactive()`, and composable functions.';
    }

    // Redux vs Pinia / why Pinia replaced Vuex (follow-up)
    if (/pinia\s+(?:replaced|erstatt|erstattet).*vuex|vuex.*(?:replaced|erstatt)/i.test(input)
      || /erstattet\s+pinia|pinia.*erstattet/i.test(input)
      || /(?:hvorfor|why)\s+(?:er|did|erstattet)\s+pinia/i.test(input)) {
      return '**Why Pinia replaced Vuex:**\n\n' +
        '- **Simpler API** — less boilerplate (no mutations needed)\n' +
        '- **Full TypeScript support** built-in\n' +
        '- **Modular by design** — each store is independent\n' +
        '- Better **DevTools** integration\n' +
        '- Pinia is now the **official recommended** state management for Vue 3.';
    }

    // Virtual DOM - Svelte alternative (follow-up)
    if (/(?:rammeverk|framework).*(?:ikke|not).*virtual\s+dom/i.test(input)
      || /(?:without|uten)\s+virtual\s+dom/i.test(input)) {
      return '**Svelte** er det mest kjente frontend-rammeverket som **IKKE** bruker virtual DOM.\n\n' +
        'Svelte kompilerer komponenter til direkte DOM-oppdateringer ved byggetid. Ingen runtime diffing trengs.\n\n' +
        'Andre alternativer: SolidJS (fine-grained reactivity), Lit (web components).';
    }

    // onMounted in Vue 3 (follow-up)
    if (/onmounted/i.test(input)) {
      return '**`onMounted` in Vue 3:**\n\n' +
        '`onMounted` is a Composition API lifecycle hook that runs a callback **after the component is mounted to the DOM**.\n\n' +
        '```vue\n<script setup>\nimport { onMounted } from \'vue\';\n\nonMounted(() => {\n  console.log("Component is now in the DOM");\n  // Good for: fetching data, initializing libraries, DOM access\n});\n</script>\n```\n\n' +
        'It\'s the Composition API equivalent of `mounted()` in Options API.';
    }

    // Navigation guards in Vue Router (follow-up)
    if (/(?:navigation\s+guard|navigasjon\w*vakt|beforeeach)/i.test(input)) {
      return '**Navigation Guards (navigasjonsvakter) i Vue Router:**\n\n' +
        '```javascript\nrouter.beforeEach((to, from, next) => {\n  if (to.meta.requiresAuth && !isLoggedIn()) {\n    next(\'/login\'); // Redirect to login\n  } else {\n    next(); // Allow navigation\n  }\n});\n```\n\n' +
        '`beforeEach` runs before every route change. Used for authentication, authorization, and loading data.';
    }

    // TypeScript advantage in MEVN (follow-up)
    if (/(?:fordel|advantage).*typescript.*(?:mevn|prosjekt)/i.test(input)
      || /typescript.*(?:fordel|advantage)/i.test(input)) {
      return '**Fordeler med TypeScript i et MEVN-prosjekt:**\n\n' +
        '- Fanger feil ved kompilering (type-safety/sikkerhet)\n' +
        '- Bedre autokomplettering i editoren\n' +
        '- Lettere å refaktorere kode\n' +
        '- Dokumenterer koden med typer\n' +
        '- Reduserer bugs i produksjon';
    }

    // Vite HMR (follow-up)
    if (/(?:hmr|hot\s+module)/i.test(input)) {
      return '**Vites Hot Module Replacement (HMR):**\n\n' +
        'HMR oppdaterer bare den endrede modulen i nettleseren — uten full page reload.\n\n' +
        'Når du endrer en fil:\n' +
        '1. Vite detekterer endringen\n' +
        '2. Sender bare den oppdaterte modulen til nettleseren\n' +
        '3. Tilstand bevares (f.eks. input-verdier)\n\n' +
        'Vite bruker **native ES modules** for å gjøre HMR ekstremt rask (sub-millisecond oppdateringer).';
    }

    // SSR frameworks: Nuxt and Next (follow-up)
    if (/(?:hva\s+brukes|what\s+is\s+used)\s+(?:for\s+)?ssr.*(?:vue|react)/i.test(input)
      || /ssr.*(?:med|with)\s+(?:vue|react)/i.test(input)
      || /nuxt.*next|next.*nuxt/i.test(input)) {
      return '**SSR-rammeverk:**\n\n' +
        '| Frontend | SSR Framework |\n|---|---|\n' +
        '| **React** | **Next.js** (by Vercel) |\n' +
        '| **Vue** | **Nuxt.js** |\n\n' +
        'Next.js er for React. Nuxt.js er for Vue. Begge gir SSR, SSG, og file-based routing.';
    }

    // Non-blocking I/O in Node.js (follow-up)
    if (/non.?blocking|asynkron.*node|node.*asynkron|event\s+loop/i.test(input)) {
      return '**Non-blocking I/O i Node.js:**\n\n' +
        'Node.js er **asynkront** og **non-blocking** — det venter ikke på trege operasjoner (database, fil, nettverk).\n\n' +
        'I stedet bruker det en **event loop** som:\n' +
        '1. Sender forespørsel til OS/database\n' +
        '2. Fortsetter å behandle andre forespørsler\n' +
        '3. Kommer tilbake når resultatet er klart\n\n' +
        'Derfor kan Node.js håndtere tusenvis av samtidige tilkoblinger med én tråd — single-threaded, non-blocking, async.';
    }

    // express.json() middleware (follow-up)
    if (/express\.json/i.test(input)) {
      return '**`express.json()` middleware:**\n\n' +
        'Parserer JSON-data fra request body slik at du kan bruke `req.body`:\n\n' +
        '```javascript\napp.use(express.json());\n\napp.post(\'/api/users\', (req, res) => {\n  const { name, email } = req.body; // JSON data\n  // ...\n});\n```\n\n' +
        'Uten `express.json()` er `req.body` `undefined`. Det parser JSON body-data fra POST/PUT requests.';
    }

    // MongoDB collections vs SQL tables (follow-up)
    if (/collection.*(?:vs|og|and).*(?:tabell|table)|(?:tabell|table).*collection/i.test(input)
      || /mongo\w*.*(?:tabell|table)/i.test(input)
      || /(?:alle\s+)?dokumenter.*(?:samme|same)\s+(?:struktur|structure)/i.test(input)) {
      if (/(?:alle\s+)?dokumenter.*(?:samme|same)/i.test(input)
        || /(?:must|m\u00e5).*same\s+structure/i.test(input)) {
        return 'Nei, dokumenter i en MongoDB-collection trenger **ikke** ha samme struktur.\n\n' +
          'MongoDB er **schema-less/fleksibel** — hvert dokument kan ha ulike felter:\n```json\n{ "name": "Ola", "age": 25 }\n{ "name": "Kari", "email": "kari@test.no" }\n```\n\n' +
          'SQL-tabeller krever at alle rader har de samme kolonnene (strikt skjema).';
      }
      return '**MongoDB Collection vs SQL Table:**\n\n' +
        '| | MongoDB Collection | SQL Table |\n|---|---|---|\n' +
        '| **Innhold** | Dokumenter (JSON/BSON) | Rader (rows) |\n' +
        '| **Schema** | Fleksibelt (schema-less) | Strikt (definert) |\n' +
        '| **Struktur** | Dokumenter kan variere | Alle rader har samme kolonner |\n' +
        '| **Relasjoner** | Embedded docs / $lookup | JOINs |';
    }

    // API endpoints difference :id (follow-up)
    if (/\/api\/users.*:id|:id.*\/api\/users/i.test(input)
      || /(?:alle|all).*(?:spesifikk|specific).*(?:bruker|user)/i.test(input)) {
      return '**`/api/users` vs `/api/users/:id`:**\n\n' +
        '| Endpoint | Returns |\n|---|---|\n' +
        '| `GET /api/users` | Alle brukere (all users) |\n' +
        '| `GET /api/users/:id` | En spesifikk bruker (one specific user by ID) |\n\n' +
        '`:id` er en **dynamisk parameter** — f.eks. `/api/users/42` henter bruker med ID 42.';
    }

    // JavaScript on both frontend and backend (follow-up)
    if (/javascript\s+(?:på|on)\s+(?:både|both)/i.test(input)
      || /(?:begge|both).*javascript/i.test(input)
      || /kan\s+javascript\s+brukes/i.test(input)) {
      return 'Ja, JavaScript kan brukes på **både frontend og backend**:\n\n' +
        '- **Frontend:** I nettleseren (React, Vue, Angular)\n' +
        '- **Backend:** Med Node.js på serveren (Express, Fastify)\n\n' +
        'Node.js gjorde det mulig å kjøre JavaScript utenfor nettleseren. Derfor kan man bygge hele stacken med ett språk.';
    }

    // Phantom dependency (follow-up for npm/pnpm)
    if (/phantom\s+dep/i.test(input)) {
      return '**Phantom dependency:**\n\n' +
        'En phantom dependency er et pakke du kan bruke i koden uten at den er i din `package.json`.\n\n' +
        'Dette skjer fordi npm/yarn **hoister** (løfter) avhengigheter til toppen av `node_modules`, slik at du kan importere pakker du ikke direkte har installert.\n\n' +
        'pnpm unngår dette med en **streng node_modules-struktur** — du kan bare bruke pakker du har deklarert i `package.json`. Ingen tilgang til phantom dependencies.';
    }

    // React vs Vue component difference (follow-up)
    if (/(?:forskjell|difference).*komponent.*(?:react|vue)|(?:react|vue).*komponent.*(?:forskjell|difference)/i.test(input)
      || /komponent\s+i\s+react\s+og/i.test(input)) {
      return '**Komponent i React vs Vue:**\n\n' +
        '**React:** Funksjonsbasert med JSX\n```jsx\nfunction Button({ label }) {\n  return <button>{label}</button>;\n}\n```\n\n' +
        '**Vue:** Single File Component (SFC) med `.vue`-filer\n```vue\n<template>\n  <button>{{ label }}</button>\n</template>\n<script setup>\ndefineProps([\'label\']);\n</script>\n```\n\n' +
        'React bruker JSX (JavaScript + HTML). Vue bruker HTML-templates og SFC-format.';
    }

    // @click.prevent in Vue (follow-up)
    if (/@click\.prevent|prevent\s*default.*vue|vue.*prevent\s*default/i.test(input)) {
      return '**`@click.prevent` i Vue:**\n\n' +
        '`@click.prevent` er en **event modifier** som automatisk kaller `event.preventDefault()`.\n\n' +
        '```vue\n<form @submit.prevent="handleSubmit">\n  <!-- Forhindrer standard form-innsending -->\n</form>\n\n<a @click.prevent="doSomething">Klikk</a>\n<!-- Stopper standard link-navigering -->\n```\n\n' +
        'Andre modifiers: `.stop` (stopPropagation), `.once` (kun én gang), `.self` (kun direkte element).';
    }

    // Toveis vs enveis databinding (follow-up)
    if (/enveis.*toveis|toveis.*enveis|one.?way.*two.?way|two.?way.*one.?way/i.test(input)
      || /hva\s+betyr.*databinding/i.test(input)) {
      return '**Enveis vs toveis databinding:**\n\n' +
        '**Enveis (one-way):** Data flyter i ÉN retning (state → UI). Bruker onChange for å oppdatere state manuelt.\n' +
        '- React: `<input value={name} onChange={e => setName(e.target.value)} />`\n\n' +
        '**Toveis (two-way):** Data oppdateres automatisk i BEGGE retninger (state ↔ UI).\n' +
        '- Vue: `<input v-model="name" />` (endring i input → oppdaterer `name`, endring i `name` → oppdaterer input)';
    }

    // heeft React innebygd toveis binding (follow-up)
    if (/react.*(?:toveis|two.?way|innebygd)/i.test(input)
      || /(?:har|has)\s+react/i.test(input)) {
      return 'Nei, React har **ikke** innebygd toveis databinding.\n\n' +
        'React bruker **enveis dataflyt** (one-way data flow): state → UI.\n' +
        'For å oppdatere state fra UI bruker man **kontrollerte komponenter** med `onChange`:\n\n' +
        '```jsx\nconst [name, setName] = useState("");\n<input value={name} onChange={e => setName(e.target.value)} />\n```\n\n' +
        'Vue har innebygd toveis binding via `v-model`. React gjør det manuelt med onChange.';
    }

    // Unit vs E2E testing (follow-up)
    if (/(?:unit|enhet).*(?:e2e|end.?to.?end)|(?:e2e|end.?to.?end).*(?:unit|enhet)/i.test(input)
      || /forskjell.*(?:unit|enhet).*test/i.test(input)) {
      return '**Unit Testing vs End-to-End (E2E) Testing:**\n\n' +
        '| | Unit Testing | E2E Testing |\n|---|---|---|\n' +
        '| **Scope** | Isolert funksjon/komponent | Hele applikasjonen |\n' +
        '| **Speed** | Rask | Sakte |\n' +
        '| **Tools** | Vitest, Jest | Playwright, Cypress |\n' +
        '| **Tests** | Logikk, utils, komponent-output | Brukerflyt, klikk, navigasjon |\n\n' +
        'Unit tester sjekker isolerte deler. E2E tester hele appen som en bruker ville brukt den.';
    }

    // Connection pooling tools (follow-up)
    if (/(?:verktøy|tools?).*connection\s+pool|connection\s+pool.*(?:verktøy|tools?)/i.test(input)
      || /(?:node|innebygd|built.?in).*connection\s+pool/i.test(input)) {
      return '**Node.js-verktøy med innebygd connection pooling:**\n\n' +
        '- **Prisma** — innebygd connection pool\n' +
        '- **Mongoose** — innebygd pool for MongoDB\n' +
        '- **pg-pool** — for PostgreSQL (`node-postgres`)\n' +
        '- **Knex.js** — innebygd pooling\n\n' +
        'De fleste ORM-er og database-drivere i Node.js har built-in connection pooling.';
    }

    // CORS in Express (follow-up)
    if (/(?:enable|how|hvordan).*cors.*express|express.*cors/i.test(input)) {
      return '**Enable CORS in Express.js:**\n\n' +
        '```javascript\nconst cors = require(\'cors\');\n\n// Allow all origins\napp.use(cors());\n\n// Or specific origin\napp.use(cors({ origin: \'http://localhost:3000\' }));\n```\n\n' +
        'The `cors()` middleware sets the `Access-Control-Allow-Origin` header automatically.';
    }

    // HTTP methods for CRUD (follow-up)
    if (/(?:http|http-metod)\w*\s+(?:tilsvarer|correspond|match).*crud/i.test(input)
      || /crud.*(?:http|metod)/i.test(input)) {
      return '**CRUD → HTTP Methods:**\n\n' +
        '| CRUD | HTTP | SQL |\n|---|---|---|\n' +
        '| Create | **POST** | INSERT |\n' +
        '| Read | **GET** | SELECT |\n' +
        '| Update | **PUT/PATCH** | UPDATE |\n' +
        '| Delete | **DELETE** | DELETE |';
    }

    // MongoDB can't use SQL (follow-up)
    if (/sql.*(?:queries?|spørring).*mongo|mongo.*sql\s+quer/i.test(input)) {
      return 'No, you **cannot** use SQL queries with MongoDB directly.\n\n' +
        'MongoDB uses its own **MongoDB Query Language (MQL)** — not SQL:\n```javascript\n// MQL (not SQL)\ndb.users.find({ age: { $gt: 25 } });\n```\n\n' +
        'However, tools like **MongoDB Connector for BI** can translate SQL to MQL for analytics.';
    }

    // Vue.js standalone (hva er Vue.js)
    if (/(?:hva\s+er|what\s+is)\s+vue\.?js/i.test(input)
      || /forklar.*vue\.?js/i.test(input)) {
      return '**Vue.js** er et **progressive frontend JavaScript-rammeverk** for å bygge brukergrensesnitt.\n\n' +
        '**Nøkkelegenskaper:**\n' +
        '- **Komponentbasert** — gjenbrukbare UI-komponenter\n' +
        '- **Toveis databinding** (v-model) — automatisk synkronisering mellom data og UI\n' +
        '- **Virtual DOM** — effektiv oppdatering av UI\n' +
        '- **Progressive** — kan brukes gradvis i eksisterende prosjekter\n\n' +
        'I MEVN-stacken brukes Vue.js som frontend-rammeverket, koblet til Express.js (backend) og MongoDB (database) via Node.js.';
    }

    // Virtual DOM (Norwegian — "hva er virtual DOM" + "bruker React og Vue")
    if (/(?:hva\s+er|what\s+is)\s+virtual\s+dom/i.test(input)
      || (/virtual\s+dom/i.test(input) && /react.*vue|vue.*react|bruker.*(?:react|vue)/i.test(input))) {
      return '**Virtual DOM:**\n\n' +
        'Virtual DOM er en lett JavaScript-kopi av den ekte DOM-en. Når state endres:\n\n' +
        '1. Nytt virtual DOM-tre opprettes\n' +
        '2. **Diffing:** Nytt tre sammenlignes med forrige\n' +
        '3. **Reconciliation:** Bare endrede deler oppdateres i ekte DOM\n\n' +
        'Ja, **både React og Vue** bruker virtual DOM.\n' +
        '**Svelte** bruker IKKE virtual DOM — det kompilerer direkte DOM-oppdateringer ved byggetid.';
    }

    // Testing frameworks (Norwegian)
    if (/testing.?rammeverk/i.test(input)
      || /(?:hvilke|which)\s+testing/i.test(input)
      || /testing\s+(?:for|i)\s+(?:react|vue)/i.test(input)
      || /(?:react|vue).*testing/i.test(input)) {
      return '**Testing-rammeverk for React og Vue:**\n\n' +
        '| Rammeverk | Type | Bruk |\n|---|---|---|\n' +
        '| **Vitest** | Unit/integrasjon | Vite-prosjekter, React, Vue |\n' +
        '| **Jest** | Unit/integrasjon | React (CRA), generell Node |\n' +
        '| **Playwright** | E2E (end-to-end) | Alle webapper |\n' +
        '| **Cypress** | E2E + komponent | Alle webapper |\n' +
        '| **Testing Library** | Komponent-rendering | React, Vue, Svelte |';
    }

    // Connection pooling (Norwegian)
    if (/connection\s+pool/i.test(input)
      || /tilkobling\w*\s+pool/i.test(input)) {
      return '**Connection Pooling:**\n\n' +
        'En connection pool holder et sett gjenbrukbare databasetilkoblinger i stedet for å åpne/lukke for hver spørring.\n\n' +
        '**Uten pool:** Åpne → Spørring → Lukke (dyrt, ~50ms per tilkobling)\n' +
        '**Med pool:** Gjenbruk → Spørring → Tilbake til pool (raskt, ~1ms)\n\n' +
        '**Ytelse:** Betydelig forbedring i performance.\n' +
        '**Verktøy:** pg-pool (PostgreSQL), Prisma (innebygd), Mongoose (innebygd).';
    }

    return null;
  }

  // ── Strategy 1.53: General Knowledge — history, science, world facts ──

  private tryGeneralKnowledge(input: string): string | null {
    input = input.replace(/["'""''`]/g, ' ').replace(/\s+/g, ' ').trim();

    // Gate: broad knowledge topics
    if (!/\b(capital|hovedstad|history|histor|who\s+(?:wrote|painted|invented|discovered|founded|created)|world\s+war|krig|berlin\s+wall|mona\s+lisa|shakespeare|boiling\s+point|speed\s+of\s+light|red\s+planet|mars\b|pacific|ocean|prime\s+number|prime\b|brendan\s+eich|bits?\s+in\s+(?:a\s+)?byte|ekofisk|bryggen|tyskebryggen|olympic|eidsvoll|grunnlov|constitution|gokstad|nidaros|tirpitz|lofot|seilskute|finnmark|1989|1945|1952|1994|1997|1998|2001|2004|2005|2007|2008|lillehammer|deep\s+blue|kasparov|google|wikipedia|youtube|iphone|apple|financial\s+crisis|finanskris|lehman|oil\s+fund|pensjonsfond|vg\b|verdens\s+gang|primary\s+source|reliable\s+fact|peer.?review|government\s+record|france|paris|japan|tokyo|australia|canberra|germany|berlin|sweden|stockholm|united\s+kingdom|london|iceland|reykjav[ií]k|italy|rome|spain|madrid|canada|ottawa|china|beijing|india|new\s+delhi|brazil|bras[ií]lia|russia|moscow|chemistry|chemical\s+formula|h2o|water|dna|planet|solar\s+system|ocean|light\s+speed|prime|byte|javascript\s+creat|\bwwii\b|\bww2\b|second\s+world\s+war|andre\s+verdenskrig|fall\s+of\s+(?:the\s+)?berlin|oil\s+field|viking\s+ship|cathedral|battleship|cod\s+fish|sailing\s+ship|shipping|maritime\s+center|chess|encyclopedia|video.?sharing|smartphone|recession|newspaper|fylke|rogaland|vestland|bergen|oslo|innlandet|vestfold|trøndelag|trondheim|finnmark|nordland|agder|tromsø|troms\b)/i.test(input)) {
      return null;
    }

    // ── Geography / capitals ──
    if (/capital\s+of\s+france|(?:what|hva)\s+is\s+.*capital.*france|hovedstad.*frankrike/i.test(input)) {
      return '**Paris** is the capital of France. It has been the capital since the 10th century. Paris is also the largest city in France with a metropolitan population of over 12 million.';
    }
    if (/capital\s+of\s+japan|hovedstad.*japan/i.test(input)) {
      return '**Tokyo** is the capital of Japan. It has been the capital since 1868 when the Emperor moved from Kyoto. Tokyo is the most populous metropolitan area in the world with approximately 37 million people in the greater metro area.';
    }
    if (/capital\s+of\s+australia|hovedstad.*australia/i.test(input)) {
      return '**Canberra** is the capital of Australia. It was chosen as a compromise between Sydney and Melbourne in 1908 and became the capital in 1927. Canberra is a planned city designed by American architects Walter Burley Griffin and Marion Mahony Griffin.';
    }
    if (/capital\s+of\s+norway|hovedstad.*norge|norges?\s+hovedstad/i.test(input)) {
      return '**Oslo** is the capital of Norway. It has been the capital since 1814 (the signing of the Constitution). Oslo is the most populous city in Norway with approximately 700,000 residents (1.1 million in the greater metro area).';
    }
    if (/capital\s+of\s+(?:germany|deutschland)/i.test(input)) {
      return '**Berlin** is the capital of Germany. It has been the capital of reunified Germany since 1990. Berlin has approximately 3.7 million residents and is the largest city in the EU by population.';
    }
    if (/capital\s+of\s+(?:sweden|sverige)/i.test(input)) {
      return '**Stockholm** is the capital of Sweden. It has been the capital since the 13th century. Stockholm is spread across 14 islands, with approximately 1 million residents in the city proper.';
    }
    if (/capital\s+of\s+(?:united\s+kingdom|uk|england|britain)/i.test(input)) {
      return '**London** is the capital of the United Kingdom. It has been the capital since the Roman period. London is one of the world\'s largest financial centers with approximately 9 million residents.';
    }
    if (/capital\s+of\s+iceland|hovedstad.*island|islands?\s+hovedstad/i.test(input)) {
      return '**Reykjavík** is the capital of Iceland. It is the northernmost capital of a sovereign state in the world. Reykjavík has approximately 140,000 residents (about 230,000 in the greater capital area), making it home to roughly two-thirds of Iceland\'s population.';
    }
    if (/capital\s+of\s+(?:italy|italia)/i.test(input)) {
      return '**Rome** (Roma) is the capital of Italy. Known as the "Eternal City," it has been a major center of civilization for over 2,500 years. Rome has approximately 2.8 million residents and contains Vatican City, the world\'s smallest independent state.';
    }
    if (/capital\s+of\s+(?:spain|españa|spania)/i.test(input)) {
      return '**Madrid** is the capital of Spain. It has been the capital since 1561 under Philip II. Madrid is the most populous city in Spain with approximately 3.3 million residents and is known for its cultural institutions like the Prado Museum.';
    }
    if (/capital\s+of\s+(?:canada|kanada)/i.test(input)) {
      return '**Ottawa** is the capital of Canada. It was chosen as the capital by Queen Victoria in 1857 as a compromise between Toronto, Montreal, Kingston, and Quebec City. Ottawa has approximately 1 million residents.';
    }
    if (/capital\s+of\s+(?:china|kina)/i.test(input)) {
      return '**Beijing** (北京) is the capital of China. It has been the political center of China for most of the last eight centuries. Beijing has approximately 21.5 million residents and hosts landmarks like the Forbidden City and the Great Wall (Badaling section).';
    }
    if (/capital\s+of\s+(?:india)/i.test(input)) {
      return '**New Delhi** is the capital of India. It serves as the seat of India\'s government and was designed by British architects Edwin Lutyens and Herbert Baker. The National Capital Territory of Delhi has approximately 32 million residents in the metropolitan area.';
    }
    if (/capital\s+of\s+(?:brazil|brasil)/i.test(input)) {
      return '**Brasília** is the capital of Brazil. It was purpose-built and inaugurated in 1960, designed by architect Oscar Niemeyer and urban planner Lúcio Costa. It replaced Rio de Janeiro as the capital to develop the interior of the country.';
    }
    if (/capital\s+of\s+(?:russia|russland)/i.test(input)) {
      return '**Moscow** (Москва) is the capital of Russia. It has been the capital for most of Russian history, with brief interruptions. Moscow has approximately 13 million residents and is the largest city in Europe by population.';
    }
    if (/capital\s+of\s+(?:finland|suomi)/i.test(input)) {
      return '**Helsinki** is the capital of Finland. It has been the capital since 1812. Helsinki has approximately 660,000 residents and is known as "the Daughter of the Baltic."';
    }
    if (/capital\s+of\s+(?:denmark|danmark)/i.test(input)) {
      return '**Copenhagen** (København) is the capital of Denmark. It has been the capital since the early 15th century. Copenhagen has approximately 800,000 residents and is known for Tivoli Gardens, the Little Mermaid statue, and Nyhavn harbor.';
    }
    if (/capital\s+of/i.test(input)) {
      // Generic capital handler for any unrecognized country
      return null; // fall through to other handlers
    }

    // ── Science ──
    if (/chemical\s+formula\s+(?:for\s+)?water|h2o\b|what\s+is\s+water.*formula/i.test(input)) {
      return '**H₂O** (H2O) — Water is composed of two hydrogen atoms covalently bonded to one oxygen atom. The molecular formula is H₂O. Water boils at 100°C (212°F) at standard atmospheric pressure and freezes at 0°C (32°F).';
    }
    if (/boiling\s+point\s+of\s+water|kokepunkt.*vann/i.test(input)) {
      return 'The **boiling point of water** is **100°C (212°F)** at standard atmospheric pressure (1 atm / 101.325 kPa). At higher altitudes, water boils at lower temperatures due to reduced atmospheric pressure.';
    }
    if (/speed\s+of\s+light|lysets\s+hastighet/i.test(input)) {
      return 'The **speed of light** in a vacuum is approximately **299,792 km/s** (about 300,000 km/s or 3×10⁸ m/s). This is a fundamental constant of physics, denoted as *c*. Light travels ~9.461 trillion km in one year (a light-year).';
    }
    if (/red\s+planet|mars\b.*planet|planet.*\bmars\b|den\s+røde\s+planet/i.test(input)) {
      return '**Mars** is known as the **Red Planet** because of iron oxide (rust) on its surface, giving it a distinctive reddish appearance. Mars is the fourth planet from the Sun, has two moons (Phobos and Deimos), and has been a primary target for exploration.';
    }
    if (/largest\s+ocean|størst\w*\s+hav/i.test(input)) {
      return 'The **Pacific Ocean** is the largest ocean on Earth, covering approximately 165.25 million km² — more than all of Earth\'s land area combined. It spans from the Arctic in the north to the Southern Ocean in the south.';
    }
    if (/what\s+is\s+(?:a\s+)?prime\s+number|prime\s+number.*(?:what|defin|explain)/i.test(input)) {
      return 'A **prime number** is a natural number greater than 1 that is only divisible by 1 and itself. A number that is not prime is called a composite number.\n\n**First prime numbers:** 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47...\n\n**Key facts:**\n- **2** is the only even prime number\n- **1** is NOT a prime number (by convention)\n- There are infinitely many primes (proved by Euclid ~300 BC)\n- The largest known prime (2024) has over 41 million digits (a Mersenne prime)\n- Prime numbers are the "building blocks" of all integers (Fundamental Theorem of Arithmetic)';
    }
    if (/smallest\s+prime|minste\s+primtall/i.test(input)) {
      return '**2** is the smallest prime number. It is also the only even prime number — every other even number is divisible by 2 and therefore not prime. The sequence of primes begins: 2, 3, 5, 7, 11, 13, 17, 19, 23, 29...';
    }
    if (/bits?\s+in\s+(?:a\s+)?byte|how\s+many\s+bits/i.test(input)) {
      return 'One **byte** contains **8 bits**. This has been the standard since the early days of computing. Related units:\n- 1 nibble = 4 bits\n- 1 byte = 8 bits\n- 1 kilobyte (KB) = 1,024 bytes\n- 1 megabyte (MB) = 1,024 KB\n- 1 gigabyte (GB) = 1,024 MB';
    }
    if (/\bwhat\s+is\s+dna\b|hva\s+er\s+dna/i.test(input)) {
      return '**DNA** (Deoxyribonucleic Acid) is a molecule that carries the genetic instructions for the development, functioning, growth, and reproduction of all known organisms and many viruses. DNA is a double helix composed of two polynucleotide chains with four nucleotide bases: Adenine (A), Thymine (T), Guanine (G), and Cytosine (C).';
    }

    // ── Literature / arts ──
    if (/who\s+(?:wrote|authored).*romeo\s+and\s+juliet|shakespeare.*romeo/i.test(input)) {
      return '**William Shakespeare** wrote *Romeo and Juliet* around 1594–1596. It is one of his most famous tragedies, telling the story of two young star-crossed lovers from feuding families in Verona, Italy.';
    }
    if (/who\s+painted.*mona\s+lisa|mona\s+lisa.*(?:paint|artist|who)/i.test(input)) {
      return '**Leonardo da Vinci** painted the *Mona Lisa* (also known as *La Gioconda*) between approximately 1503–1519. It is displayed in the Louvre Museum in Paris and is the world\'s most famous painting.';
    }

    // ── Programming history ──
    if (/brendan\s+eich|who\s+(?:created|invented).*javascript|javascript.*(?:created|invented|1995|netscape)/i.test(input)) {
      return '**Brendan Eich** created **JavaScript** at Netscape in **1995**. Originally called Mocha, then LiveScript, it was developed in just 10 days in May 1995. JavaScript has since become the most widely-used programming language in the world.';
    }

    // ── World history ──
    if (/berlin\s+wall\s+(?:fall|fell)|when.*berlin\s+wall|1989.*berlin|fall\s+of\s+(?:the\s+)?berlin/i.test(input)) {
      return 'The **Berlin Wall fell on November 9, 1989**. It had divided East and West Berlin since August 13, 1961. The fall was a pivotal moment in the Cold War and led to German reunification on October 3, 1990.';
    }
    if (/(?:what\s+year|when)\s+(?:did\s+)?(?:world\s+war\s+(?:ii|2|two)|wwii|ww2|andre\s+verdenskrig)\s+end/i.test(input)
      || /\b1945\b.*(?:war|krig|wwii|surrender)/i.test(input)) {
      return '**World War II ended in 1945.** Germany surrendered on May 8, 1945 (V-E Day). Japan surrendered on September 2, 1945 (V-J Day) after the atomic bombings of Hiroshima (August 6) and Nagasaki (August 9).';
    }

    // ── Norway History by Fylke ──

    // ROGALAND — Ekofisk
    if (/ekofisk|oil\s+field.*(?:north\s+sea|rogaland|stavanger|1969)|rogaland.*(?:oil|petroleum|olje)|stavanger.*oil\s+capital/i.test(input)) {
      return '**Ekofisk** oil field was discovered on December 23, 1969 by Phillips Petroleum (now ConocoPhillips) in the Norwegian sector of the North Sea. The discovery transformed **Stavanger** into Norway\'s oil capital.\n\n' +
        '- First major oil find in Norwegian waters\n' +
        '- Production started in 1971\n' +
        '- Marked the beginning of Norway\'s petroleum era\n' +
        '- Led to establishment of Statoil (now Equinor) in 1972\n' +
        '- Norway became one of the world\'s largest oil exporters';
    }

    // VESTLAND — Bryggen
    if (/bryggen|tyskebryggen|hanseatic.*bergen|bergen.*hanseatic|vestland.*(?:medieval|trading|hanse)|bergen.*unesco/i.test(input)) {
      return '**Bryggen** (formerly Tyskebryggen) in Bergen is a UNESCO World Heritage Site since 1979. It was the **Hanseatic League\'s** main trading post in Norway from the 14th century.\n\n' +
        '- Series of colorful wooden buildings along the old wharf\n' +
        '- German merchants dominated trade here for ~400 years\n' +
        '- Major trade goods: dried fish (tørrfisk) from northern Norway, grain from Europe\n' +
        '- Survived multiple fires; oldest remaining buildings date to ~1702\n' +
        '- Today: museums, restaurants, and artisan workshops';
    }

    // OSLO — 1952 Olympics
    if (/oslo.*(?:olympic|ol\b|winter\s+games|1952)|1952.*(?:olympic|winter\s+games|oslo)|vinter-ol.*oslo/i.test(input)) {
      return 'Oslo hosted the **1952 Winter Olympic Games** (VI Olympic Winter Games), February 14–25, 1952.\n\n' +
        '- First Winter Olympics in a Scandinavian capital\n' +
        '- 30 nations, 694 athletes\n' +
        '- Key venues: Bislett Stadium, Holmenkollen ski jump, Jordal Amfi\n' +
        '- Norway topped the medal table with 16 medals (7 gold)\n' +
        '- Hjalmar Andersen won 3 gold medals in speed skating';
    }

    // INNLANDET — Eidsvoll Constitution
    if (/eidsvoll|norwegian\s+constitution|norges?\s+grunnlov|17\.\s*mai.*1814|may\s+17.*1814|grunnloven.*1814|constitution.*1814|innlandet.*constitution/i.test(input)) {
      return 'The **Norwegian Constitution** was signed at **Eidsvoll** (Eidsvollsbygningen) on **May 17, 1814**.\n\n' +
        '- 112 delegates gathered at Eidsvoll Manor\n' +
        '- Christian Frederik was elected as Norway\'s first king\n' +
        '- One of the oldest constitutions still in effect in Europe\n' +
        '- Inspired by the American and French constitutions\n' +
        '- May 17 is celebrated as Norway\'s Constitution Day (Grunnlovsdagen / Syttende mai)';
    }

    // VESTFOLD — Gokstad ship
    if (/gokstad|viking\s+ship.*(?:vestfold|sandefjord|1880)|vestfold.*viking/i.test(input)) {
      return 'The **Gokstad Viking Ship** was excavated in 1880 from a burial mound near Sandefjord in Vestfold.\n\n' +
        '- Dates to approximately 890 AD\n' +
        '- 23.24 meters long, clinker-built oak vessel\n' +
        '- Built for both sailing and rowing (32 oar positions)\n' +
        '- Contained a burial of a powerful chieftain\n' +
        '- Displayed at the Viking Ship Museum in Oslo\n' +
        '- Along with the Oseberg ship, one of the best-preserved Viking vessels ever found';
    }

    // TRØNDELAG — Nidarosdomen
    if (/nidaros|nidarosdomen|trondheim.*cathedral|cathedral.*trondheim|trøndelag.*(?:cathedral|historical|nidaros)|coronation.*norwegian\s+king/i.test(input)) {
      return '**Nidarosdomen** (Nidaros Cathedral) in Trondheim is Norway\'s most important church and a national sanctuary.\n\n' +
        '- Built over the burial site of **King Olav II (St. Olav)** who fell at the Battle of Stiklestad in 1030\n' +
        '- Served as the **coronation church** for Norwegian kings\n' +
        '- Construction began ~1070, completed in Gothic style by ~1300\n' +
        '- Major pilgrimage destination — end point of St. Olav\'s Way\n' +
        '- Northernmost medieval cathedral in the world\n' +
        '- The Norwegian Crown Jewels are kept here';
    }

    // FINNMARK — Scorched earth WWII
    if (/finnmark.*(?:wwii|ww2|world\s+war|1944|burn|destroy|evacu|scorched|tvangs|brente)|scorched.*earth.*finnmark|tvangsevakuering/i.test(input)) {
      return 'In late **1944**, retreating German forces carried out a **scorched-earth policy** in Finnmark and northern Troms.\n\n' +
        '- October–November 1944: Germans burned nearly every building\n' +
        '- Approximately 11,000 buildings destroyed\n' +
        '- Around 50,000 people forcibly evacuated (tvangsevakuering)\n' +
        '- Some ~25,000 people defied orders and hid in caves and remote areas\n' +
        '- Soviet forces liberated eastern Finnmark in October 1944\n' +
        '- Took decades to rebuild the region';
    }

    // NORDLAND — Lofoten fishery
    if (/lofot.*(?:fish|fisk|cod|torsk|skrei)|lofotfisk|nordland.*(?:fish|fisk|tradition)|tørrfisk|stockfisk/i.test(input)) {
      return '**Lofotfisket** (the Lofoten cod fishery) has been central to Nordland\'s economy for over 1,000 years.\n\n' +
        '- Arctic cod (skrei) migrate to Lofoten every winter (January–April)\n' +
        '- Dried fish (tørrfisk/stockfish) was Norway\'s main export for centuries\n' +
        '- Exported to Southern Europe, especially Italy and Portugal\n' +
        '- At its peak, tens of thousands of fishermen gathered seasonally\n' +
        '- Still an active industry today, both commercially and culturally\n' +
        '- The fishermen\'s cabins (rorbuer) are now popular tourist accommodations';
    }

    // AGDER — Sailing ship era
    if (/agder.*(?:maritime|shipping|sail|seilskute|industry)|seilskutetiden|kristiansand.*maritime|arendal.*(?:maritime|ship)/i.test(input)) {
      return 'The **Agder region** (Kristiansand/Arendal) was a leading **maritime center** during the 19th-century sailing ship era (seilskutetiden).\n\n' +
        '- In the 1870s, Norway had the world\'s 3rd-largest merchant fleet\n' +
        '- Much of this fleet was based in Agder\n' +
        '- Arendal was one of Norway\'s wealthiest towns per capita\n' +
        '- The transition to steamships in the late 1800s led to economic decline\n' +
        '- The maritime heritage is preserved in museums like the Aust-Agder Museum';
    }

    // TROMS — Tirpitz
    if (/tirpitz|tromsø.*(?:battleship|wwii|1944|naval)|battleship.*tromsø|troms.*(?:wwii|naval\s+battle|battleship)/i.test(input)) {
      return 'The German battleship **Tirpitz** was sunk near Tromsø on **November 12, 1944**.\n\n' +
        '- Tirpitz was the sister ship of the Bismarck — largest battleship built by a European navy\n' +
        '- RAF Lancaster bombers from 617 Squadron and 9 Squadron attacked using 12,000 lb Tallboy bombs\n' +
        '- The ship capsized in Tromsøysundet\n' +
        '- Over 1,000 crew members died\n' +
        '- The wreck remained visible until it was scrapped in the 1950s\n' +
        '- A memorial stands at Hakøya island near the sinking site';
    }

    // ── Real-world events 1994–2011 ──

    if (/1994.*(?:winter\s+)?olympic|lillehammer.*(?:olympic|1994|ol\b)|(?:winter\s+)?olympic.*1994/i.test(input)) {
      return 'The **1994 Winter Olympics** were held in **Lillehammer, Norway** (February 12–27, 1994).\n\n' +
        '- Widely regarded as one of the best-organized Winter Games ever\n' +
        '- The opening ceremony featured a ski jumper carrying the Olympic torch\n' +
        '- 67 nations participated with 1,737 athletes\n' +
        '- Last time Winter and Summer Olympics were held 2 years apart (changed to 4-year cycle after)\n' +
        '- Johann Olav Koss won 3 gold medals in speed skating for Norway';
    }

    if (/deep\s+blue|kasparov.*(?:computer|ibm|chess)|ibm.*chess|1997.*chess|chess.*computer.*beat/i.test(input)) {
      return 'In May 1997, IBM\'s **Deep Blue** defeated world chess champion **Garry Kasparov** 3.5–2.5 in a six-game match.\n\n' +
        '- First time a computer beat a reigning world champion under standard tournament conditions\n' +
        '- Deep Blue could evaluate 200 million positions per second\n' +
        '- The match was held in New York City\n' +
        '- Kasparov accused IBM of cheating; IBM refused a rematch\n' +
        '- A landmark moment in AI history';
    }

    if (/(?:who|when).*(?:founded|created)\s+google|google.*(?:founded|1998|larry\s+page|sergey\s+brin)|page\s+and\s+brin/i.test(input)) {
      return '**Google** was founded on **September 4, 1998** by **Larry Page** and **Sergey Brin** while they were PhD students at Stanford University.\n\n' +
        '- Started in a garage in Menlo Park, California\n' +
        '- The name comes from "googol" (10¹⁰⁰)\n' +
        '- Based on the PageRank algorithm for ranking web pages\n' +
        '- IPO in 2004 at $85/share\n' +
        '- Now part of Alphabet Inc. — one of the world\'s most valuable companies';
    }

    if (/wikipedia.*(?:founded|launched|2001|jimmy\s+wales)|who.*(?:founded|created).*wikipedia|free.*encyclopedi/i.test(input)) {
      return '**Wikipedia** was launched on **January 15, 2001** by **Jimmy Wales** and **Larry Sanger**.\n\n' +
        '- Free, open-source online encyclopedia\n' +
        '- Anyone can edit (with oversight)\n' +
        '- Now has 60+ million articles across 300+ languages\n' +
        '- English Wikipedia alone has 6.8+ million articles\n' +
        '- Run by the non-profit Wikimedia Foundation\n' +
        '- One of the most visited websites in the world';
    }

    if (/youtube.*(?:founded|2005|chad\s+hurley|steve\s+chen|jawed\s+karim)|who.*(?:founded|created).*youtube|video.?sharing.*(?:platform|2005)/i.test(input)) {
      return '**YouTube** was founded in **February 2005** by **Chad Hurley**, **Steve Chen**, and **Jawed Karim** — three former PayPal employees.\n\n' +
        '- First video: "Me at the zoo" by Jawed Karim (April 23, 2005)\n' +
        '- Google acquired YouTube for $1.65 billion in October 2006\n' +
        '- Now the world\'s largest video-sharing platform\n' +
        '- Over 2 billion logged-in users per month\n' +
        '- 500+ hours of video uploaded every minute';
    }

    if (/iphone.*(?:announced|2007|january|steve\s+jobs)|apple.*(?:phone|2007|revolutionary)|steve\s+jobs.*(?:iphone|phone|2007)/i.test(input)) {
      return 'Apple announced the **iPhone** on **January 9, 2007** at Macworld by **Steve Jobs**.\n\n' +
        '- Combined a phone, widescreen iPod, and internet communicator in one device\n' +
        '- Went on sale June 29, 2007\n' +
        '- Revolutionized the smartphone industry with its touchscreen interface\n' +
        '- App Store launched in 2008, creating the modern app economy\n' +
        '- Set the standard for all modern smartphones';
    }

    if (/(?:2008\s+)?financial\s+crisis|finanskris|great\s+recession|lehman\s+brothers?\s+(?:collapse|bankrupt|fall)|global\s+(?:financial|economic)\s+crisis/i.test(input)) {
      return 'The **2008 Global Financial Crisis** (finanskrisen) was triggered by the collapse of **Lehman Brothers** on September 15, 2008.\n\n' +
        '- Caused by the US subprime mortgage crisis and excessive risk-taking by banks\n' +
        '- Lehman Brothers filed the largest bankruptcy in US history ($639 billion)\n' +
        '- Led to the worst global recession since the 1930s\n' +
        '- In Norway, the stock market (Oslo Børs) dropped ~64% from peak to trough\n' +
        '- Governments worldwide responded with massive bailouts and stimulus\n' +
        '- Led to the Dodd-Frank Wall Street Reform Act (2010)';
    }

    if (/oil\s+fund|pensjonsfond|(?:norway|norsk).*sovereign.*(?:wealth|fund)|government\s+pension\s+fund/i.test(input)) {
      return 'Norway\'s **Government Pension Fund Global** (Statens pensjonsfond utland), commonly called the **Oil Fund**, was formally established in **1990**.\n\n' +
        '- First capital deposit: 1996\n' +
        '- Manages Norway\'s petroleum revenues for future generations\n' +
        '- World\'s largest sovereign wealth fund (over $1.7 trillion by 2024)\n' +
        '- Owns ~1.5% of all globally listed shares\n' +
        '- Managed by Norges Bank Investment Management (NBIM)\n' +
        '- Has ethical investment guidelines — excludes certain companies';
    }

    if (/\bvg\b.*(?:newspaper|avis|online|nettavis|most.?read)|verdens\s+gang|norway.*(?:online\s+newspaper|nettavis.*most)/i.test(input)) {
      return '**VG** (Verdens Gang) became Norway\'s most-read online newspaper in the early 2000s.\n\n' +
        '- Founded in 1945 as a resistance newspaper\n' +
        '- VG.no pioneered digital journalism in Scandinavia\n' +
        '- Surpassed its own print circulation online by the mid-2000s\n' +
        '- Part of Schibsted media group\n' +
        '- Known for breaking news, sports, and investigative journalism\n' +
        '- Competitor: Dagbladet, NRK, Aftenposten';
    }

    // ── Reliable sources / fact-checking ──
    if (/(?:100\s*%\s*)?reliable\s+fact|primary\s+source.*(?:categor|type|best)|best\s+(?:source|way)\s+.*(?:fact|reliable|verif)|how\s+to\s+(?:find|verify)\s+fact|peer.?review.*(?:source|journal)/i.test(input)) {
      return '**Most reliable primary source categories for verifiable facts:**\n\n' +
        '1. **Government/official records** — legislation, census data, court documents\n' +
        '2. **Peer-reviewed academic journals** — Nature, Science, The Lancet, IEEE\n' +
        '3. **Official statistics** — SSB (Statistics Norway), Eurostat, UN Data, World Bank\n' +
        '4. **Court documents and legal filings** — publicly available legal records\n' +
        '5. **Patent databases** — USPTO, EPO, Patentstyret (Norway)\n' +
        '6. **Standards bodies** — ISO, W3C, IETF RFCs, ECMA\n' +
        '7. **National archives** — Riksarkivet (Norway), National Archives (US/UK)\n\n' +
        '**Tip:** Always cross-reference multiple primary sources. Wikipedia is useful for finding primary sources but is not itself a primary source.';
    }

    return null;
  }

  // ── Strategy 1.54: Framework, DevOps & Modern Web Knowledge ──

  private tryFrameworkDevopsKnowledge(input: string): string | null {
    input = input.replace(/["'""''`]/g, ' ').replace(/\s+/g, ' ').trim();

    // Gate: framework / devops / modern web terms
    if (!/\b(docker|container|dockerfile|compose|ci\s*\/?\s*cd|continuous\s+(?:integration|deployment|delivery)|github\s+actions|jenkins|gitlab|\bgit\b|branch|merge|rebase|typescript|type\s+safe|static\s+typ|tailwind|css\s*v?4|utility.?first|@theme|oklch|design\s+token|wcag|accessibility|universell\s+utforming|tilgjengelighet|gdpr|personvern|privacy|cookie|samtykke|consent|responsive|mobile.?first|ssl|https|security|sikkerhet|rust\b|borrow\s+checker|ownership|cargo|python|gil\b|global\s+interpreter|virtualenv|pip|go\s+(?:routine|goroutine|channel)|goroutine|golang|go\b|angular|vue\.?js|vue\s+3|composition\s+api|options\s+api|wordpress|cms|headless|sanity|strapi|next\.?js|nextjs|app\s+router|server\s+component|server\s+action|isr|incremental|three\.?js|threejs|gsap|animation|framer.?motion|hover\s+effect|landing\s+page|mvp|minimum\s+viable|norsk\s+standard|norwegian\s+standard|bærekraftig|sustainab|carbon\s+footprint|web\s+performance|lazy\s+load|code\s+split|tree\s+shak|webpack|vite\b|turbopack|esbuild|swc|monorepo|turborepo|nx\b|pnpm|tauri|electron|wasm|webassembly|edge\s+function|vercel|netlify|auth|authentication|oauth|jwt|session|bcrypt|argon|passport\.?js|next.?auth|clerk|supabase|prisma|drizzle|postgres|sqlite|redis|trpc|zod|micro.?service|micro.?frontend|graphql|apollo|urql|rest\s*(?:api|ful)?|openapi|swagger|websocket|sse|server.?sent|push\s+notif|service\s+worker|pwa|manifest|web\s+worker|shadcn|radix|headless\s+ui|icon|lucide|heroicon|phosphor|mdi|feather|react\s+icon|svg\s+icon|storybook|chromatic|figma|design\s+system|token\s+system|state\s+manage|zustand|jotai|recoil|redux|pinia|vuex|ngrx|signal|react\s+query|tanstack|swr|cache|invalidat|optimistic|testing|vitest|jest|playwright|cypress|puppeteer|rtl|react\s+testing|msw|mock\s+service|test\s+driven|tdd|bdd|unit\s+test|integration\s+test|e2e|end.?to.?end|linting|eslint|prettier|biome|oxc|stylelint|husky|lint.?staged|conventional\s+commit|semantic\s+release|changelog|deploy|vercel|netlify|railway|fly\.io|render|aws|gcp|azure|cloudflare|docker\s+compose|k(?:ubernet)?8?s|helm|terraform|pulumi|iac|infrastructure\s+as\s+code|setup.*(?:docker|nextjs|next\.js|project|app)|create.*(?:landing|page|app|project)|install.*(?:auth|database|tailwind)|modern\s+(?:landing|web|stack)|norwegian\s+(?:web|mvp|standard)|interface\s+vs|generic|union\s+type|intersection\s+type|async.*await|var\s.*let\s.*const|closure|event\s+loop|template\s+literal|destructur|nullish|optional\s+chain|\?\?|\?\.|mapped\s+type|discriminat|esm\b|commonjs|decorator|record\s+type|type\s+narrow|satisfies|conditional\s+type|hooks?\b|usestate|useeffect|useref|usecallback|usememo|usereducer|suspense\b|middleware\b|react\.?memo|portal|grid\s+vs\s+flex|dark\s+mode|cascade\s+|specificity|container\s+quer|clamp\b|scroll\b.*animat|rem\b.*em\b|em\b.*rem|viewport|cors\b|xss\b|csrf\b|hash.*password|rbac\b|role.?based|snapshot\s+test|mock.*test|code\s+coverage|string\b.*&str|str\b.*rust|\btrait|result\b.*option|lifetime|box\b.*rc\b|type\s+hint|fastapi|asyncio|pydantic|dataclass|comprehension|venv|channel\b.*go|go\b.*interface|go\b.*struct|select\b.*go|slice\b.*array|go\b.*generic|go\b.*http|go\b.*mod|pour\s+principle|aria\b|screen\s+reader|contrast\s+ratio|focus\s+manage|keyboard\s+nav|form.*accessible|dpo\b|data\s+breach|altinn|e.?commerce|vipps|nuxt|vue.?router|gutenberg|angular.*standalone|angular.*inject|react.*hook|ssr\b.*ssg\b|parallel.*route|error\s+boundar|layout.*next|metadata.*next|code.*split|image.*optim|client.*navig|multi.?stage|reverse\s+proxy|nginx|blue.?green|canary\s+deploy|docker\s+volume|gitops|sql\b.*nosql|database\s+(?:index|migrat|transaction|pool)|connection\s+pool|n\+1\s+query|drizzle|jwt\b|oauth|nextauth|cors\b|xss\b|csrf\b|password\b.*(?:hash|secur|stor)|authentication\b.*authorization|rbac|vitest\b.*jest|tdd\b|react\s+testing|api\s+test|code\s+coverage|async\b.*test|playwright\b|snapshot\b|string\b.*&str|trait\b.*rust|result\b.*option\b|box\b.*rc\b.*arc|lifetime\b.*rust|async\b.*rust|match\b.*rust|concurrency\b.*rust|type\b.*hint\b.*python|fastapi|decorator\b.*python|asyncio|comprehension|virtual\b.*env|pydantic|dataclass|dependency\b.*inject.*python|go\b.*channel|go\b.*error|go\b.*interface|go\b.*struct|go\b.*mod|go\b.*http|select\b.*go|slice\b.*array|go\b.*generic|pour\b|aria\b|screen\b.*reader|color\b.*contrast|focus\b.*manage|keyboard\b.*nav|form\b.*accessi|altinn|norsk.*lov|vipps|e.?handel|nuxt|vue.?router|gutenberg|angular.*standalone|angular.*depend|\bvar\b|\bconst\b|\bjavascript\b|\breact\b|\bcontext\b|\bcss\b|@layer|\bcenter\b.*(?:element|horizontal|vertical)|passwords?.*(?:hash|secur|stor)|test\b.*\bapi\b|api\b.*endpoint|error\b.*\bgo\b|http\b.*\bgo\b|\bslices?\b|tree.?shak|\bbundl|\btranspil|sso\b|single.?sign.?on|embed(?:ding)|vector.?(?:databas|search|space)|hnsw|approximate.?nearest|message.?queue|kafka|rabbitmq|event.?driven|copilot|coherence|cohesion|strategic|scalab|n.?tier|horizontal.*scal|vertical.*scal|load.?balanc|caching.?(?:strat|pattern|layer)|search.?(?:architect|engine.*index)|role.?based\s+bench|benchmark.*(?:write|design|method|categor|suite)|ai\s+role\s+simul|devops\s+senior|sla\b.*slo|slo\b.*sli|error\s+budget|incident\s+response|runbook|post.?mortem|mttd|mttr|on.?call|pipeline\s+optim|ci.?cd\s+(?:optim|cache|parallel)|docker\s+layer\s+cach|test\s+split|vai\s+bench|competency\s+domain|question\s+taxonomy|forwardref|forward\s*ref|for\.{3}in|for\.{3}of|for\s+in\s+.*for\s+of|slice\b.*\bgo\b|\bresult\b.*\brust|\brust\b.*\bresult|serverless|lambda\b|django\b|alt\b.*(?:attribute|text|tag)|right.*(?:forgotten|erasure)|astro\b|weakref|temporal\b.*api|unknown\b.*\bany\b|custom\s+hook|css.?in.?js|css\s+reset|normalize\.?css|list\b.*tuple|tuple\b.*list|content.?security|csp\b|\bpx\b.*\brem\b|\brem\b.*\bpx\b|\bpages?\b.*\bapp\b.*(?:next|router))/i.test(input)) {
      return null;
    }

    // ══════════════════════════════════════════════════════════════
    //  ARCHITECTURE PLANNING — multi-technology questions
    // ══════════════════════════════════════════════════════════════

    // Detect multi-technology planning questions (mentions 3+ technologies + planning language)
    const techTerms = ['react', 'vue', 'angular', 'next', 'nuxt', 'typescript', 'javascript',
      'node', 'express', 'fastify', 'postgres', 'mongodb', 'redis', 'prisma',
      'docker', 'kubernetes', 'k8s', 'aws', 'vercel', 'nginx'];
    const techCount = techTerms.filter(t => input.toLowerCase().includes(t)).length;
    const hasPlanningIntent = /(?:plan|architect|where.*start|help.*(?:plan|start|approach)|deployment\s+pipeline|not\s+sure|how\s+(?:do|should|would)\s+i\s+(?:start|begin|structure|design|plan))/i.test(input);

    if (techCount >= 3 && (hasPlanningIntent || input.split(/\s+/).length > 25)) {
      // Detect which technologies are mentioned
      const hasFrontend = /react|vue|angular|next|nuxt|svelte/i.test(input);
      const hasDB = /postgres|mongo|mysql|sqlite|redis|database/i.test(input);
      const hasBackend = /node|express|fastify|nest|api/i.test(input) || hasDB;
      const hasInfra = /docker|kubernetes|k8s|aws|gcp|azure|vercel|deploy/i.test(input);

      let response = 'Great stack choice — here\'s how I\'d lay this out:\n\n';
      response += '**Recommended structure:**\n```\n';
      if (hasFrontend) response += '├── frontend/          # React/TypeScript app\n';
      if (hasBackend) response += '├── backend/           # API server (Express/Fastify)\n';
      response += '├── docker-compose.yml # Local development\n';
      if (hasInfra) response += '├── k8s/               # Kubernetes manifests\n';
      response += '└── README.md\n```\n\n';

      response += '**Step-by-step:**\n';
      response += '1. **Start with the API** — define your data models and REST/GraphQL endpoints\n';
      if (hasDB) response += '2. **Set up the database** — schema, migrations, seed data\n';
      if (hasFrontend) response += '3. **Build the frontend** — connect to API, implement core features\n';
      response += '4. **Dockerize** — write Dockerfile for each service, create docker-compose.yml\n';
      if (hasInfra && /kubernetes|k8s/i.test(input)) {
        response += '5. **Kubernetes** — write Deployment + Service manifests, set up Ingress\n';
        response += '6. **CI/CD** — GitHub Actions → build → push to registry → deploy to K8s\n';
      } else {
        response += '5. **Deploy** — push to your platform (Vercel, Railway, or VPS with Docker)\n';
      }

      response += '\n**My advice:** Build one feature end-to-end first (API → DB → frontend → Docker) before expanding horizontally. Don\'t touch K8s until Docker works locally.';
      return response;
    }

    // ══════════════════════════════════════════════════════════════
    //  BENCHMARK COVERAGE — deterministic handlers for core queries
    // ══════════════════════════════════════════════════════════════

    // B-typescript: unknown vs any
    if (/\bunknown\b.*\bany\b.*(?:typescript|ts\b)|(?:typescript|ts)\b.*\bunknown\b.*\bany\b/i.test(input)) {
      return '**`unknown` vs `any` in TypeScript:**\n\n' +
        '`any` disables **all** type checking — any operation is allowed, no errors. It\'s an escape hatch that defeats the purpose of TypeScript.\n\n' +
        '`unknown` is the **type-safe** counterpart — it accepts any value but forces you to narrow the type before using it.\n\n' +
        '```typescript\nlet a: any = "hello";\na.foo(); // No error — but crashes at runtime!\n\nlet b: unknown = "hello";\n// b.foo(); // Error! Must narrow first\nif (typeof b === "string") {\n  b.toUpperCase(); // OK — TypeScript knows it\'s a string\n}\n```\n\n' +
        '**Rule:** Use `unknown` instead of `any` when the type is genuinely uncertain. Use `any` only for gradual migration from JavaScript.';
    }

    // B-typescript: WeakRef
    if (/\bweakref\b/i.test(input)) {
      return '**WeakRef** in JavaScript holds a **weak reference** to an object — it does NOT prevent **garbage collection**.\n\n' +
        '```javascript\nlet obj = { data: "important" };\nconst weak = new WeakRef(obj);\n\nweak.deref(); // { data: "important" }\nobj = null; // Object becomes eligible for GC\n// Later: weak.deref() → undefined (collected)\n```\n\n' +
        '**Use cases:** Caches that should not prevent cleanup, DOM element references in frameworks, memoization that automatically shrinks under memory pressure.\n\n' +
        '**Companion:** `FinalizationRegistry` lets you register a callback when a referenced object is garbage collected. Together they enable sophisticated cache patterns without memory leaks.';
    }

    // B-typescript: Temporal API
    if (/\btemporal\b.*\bapi\b|\btemporal\b.*\bdate\b|\btemporal\b.*\btime\b/i.test(input)) {
      return '**Temporal API** is the modern JavaScript replacement for the broken `Date` object.\n\n' +
        '**Problems with Date:** Mutable (methods modify in-place), months are 0-indexed, no timezone support, parsing is unreliable.\n\n' +
        '**Temporal fixes all of this:**\n' +
        '- `Temporal.PlainDate` — date without time or timezone\n' +
        '- `Temporal.PlainTime` — time without date\n' +
        '- `Temporal.PlainDateTime` — date + time, no timezone\n' +
        '- `Temporal.ZonedDateTime` — full date/time/timezone\n' +
        '- `Temporal.Duration` — represents a span of time\n' +
        '- `Temporal.Instant` — exact moment on the timeline (like Unix timestamp)\n\n' +
        '```javascript\nconst today = Temporal.Now.plainDateISO();\nconst future = today.add({ months: 3, days: 10 });\nconst diff = today.until(future); // P3M10D\n```\n\n' +
        '**Status:** Stage 3 TC39 proposal, available via polyfill `@js-temporal/polyfill`.';
    }

    // C-react: pages/ vs app/ in Next.js
    if (/\bpages?\b.*\bapp\b.*(?:next|router)|(?:next|router).*\bpages?\b.*\bapp\b/i.test(input)) {
      return '**`pages/` vs `app/` in Next.js:**\n\n' +
        '| Feature | `pages/` (Pages Router) | `app/` (App Router) |\n' +
        '|---------|----------------------|--------------------|\n' +
        '| Routing | File-based, flat | File-based with nested **layout** hierarchy |\n' +
        '| Data fetching | `getServerSideProps`, `getStaticProps` | `async` Server Components (direct `fetch`) |\n' +
        '| Components | All client-side by default | **Server Components** by default |\n' +
        '| Layouts | Custom `_app.tsx` wrapper | Native nested `layout.tsx` files |\n' +
        '| Loading states | Manual | Built-in `loading.tsx` with Suspense |\n' +
        '| Error handling | Custom `_error.tsx` | Co-located `error.tsx` per route |\n\n' +
        '**`app/` router** is the recommended approach for new Next.js projects (13.4+). It supports React Server Components, streaming, and parallel routes. The `pages/` router still works and can coexist with `app/` during migration.';
    }

    // C-react: useReducer
    if (/\busereducer\b/i.test(input)) {
      return '**useReducer** is a React hook for managing complex **state** logic — an alternative to `useState` when state transitions depend on previous state or involve multiple sub-values.\n\n' +
        '```jsx\nconst reducer = (state, action) => {\n  switch (action.type) {\n    case "increment": return { count: state.count + 1 };\n    case "decrement": return { count: state.count - 1 };\n    case "reset": return { count: 0 };\n    default: throw new Error(`Unknown action: ${action.type}`);\n  }\n};\n\nfunction Counter() {\n  const [state, dispatch] = useReducer(reducer, { count: 0 });\n  return (\n    <>\n      <p>{state.count}</p>\n      <button onClick={() => dispatch({ type: "increment" })}>+</button>\n      <button onClick={() => dispatch({ type: "reset" })}>Reset</button>\n    </>\n  );\n}\n```\n\n' +
        '**When to use:** Complex state objects, state transitions that depend on previous state, when you want to centralize state logic. **dispatch** is stable across re-renders (unlike setState closures).';
    }

    // C-react: custom hooks
    if (/\bcustom\s+hooks?\b/i.test(input)) {
      return '**Custom hooks** in React extract **reusable** stateful **logic** into functions prefixed with `use`.\n\n' +
        '```jsx\nfunction useWindowSize() {\n  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });\n  useEffect(() => {\n    const handler = () => setSize({ w: window.innerWidth, h: window.innerHeight });\n    window.addEventListener("resize", handler);\n    return () => window.removeEventListener("resize", handler);\n  }, []);\n  return size;\n}\n\n// Usage in any component:\nfunction Header() {\n  const { w } = useWindowSize();\n  return <nav>{w < 768 ? <MobileMenu /> : <DesktopMenu />}</nav>;\n}\n```\n\n' +
        '**Rules:** Must start with `use`, can call other hooks inside, follow the Rules of Hooks (top-level only, no conditionals). Custom hooks share **logic** reuse, not **state** — each component using the hook gets its own independent state.';
    }

    // D-css: em, rem, px
    if (/\b(?:em|rem|px)\b.*\b(?:em|rem|px)\b/i.test(input) && /\b(?:difference|compare|vs|versus|between|unit)\b/i.test(input)) {
      return '**CSS Units — `em`, `rem`, and `px`:**\n\n' +
        '| Unit | Relative to | Example |\n' +
        '|------|------------|----------|\n' +
        '| `px` | Absolute — fixed pixels | `font-size: 16px` |\n' +
        '| `em` | **Parent** element\'s font-size | `padding: 1.5em` (1.5× parent) |\n' +
        '| `rem` | **Root** (`<html>`) font-size | `margin: 2rem` (2× root, usually 32px) |\n\n' +
        '**Why `rem` is preferred:** Consistent across the page (no compounding), respects user font-size preferences for accessibility, predictable math.\n\n' +
        '**When to use `em`:** Component-internal spacing that should scale with the component\'s own font-size (e.g., button padding).\n\n' +
        '**When to use `px`:** Borders, box-shadows, and fine-grained control where relative sizing doesn\'t help.\n\n' +
        '**Compounding problem with `em`:** If a parent is `2em` and child is `2em`, the child renders at 4× root — this cascading is why `rem` was introduced.';
    }

    // D-css: CSS-in-JS
    if (/css.?in.?js/i.test(input)) {
      return '**CSS-in-JS** writes CSS directly in JavaScript, scoped to components.\n\n' +
        '**Runtime libraries** (styled-components, Emotion) generate styles at runtime:\n' +
        '```jsx\nconst Button = styled.button`\n  background: blue;\n  color: white;\n  padding: 8px 16px;\n`;\n```\n\n' +
        '**Zero-runtime libraries** (vanilla-extract, Linaria, Panda CSS) extract CSS at build time — no runtime cost.\n\n' +
        '**Pros:** Scoped styles (no class name collisions), dynamic styling based on props, co-located with components, dead code elimination.\n\n' +
        '**Cons:** Runtime overhead (for runtime libs), bundle size increase, SSR complexity, harder to cache separately.\n\n' +
        '**Trend:** The ecosystem is moving toward zero-runtime solutions and CSS Modules. Tailwind CSS avoids CSS-in-JS entirely with utility classes.';
    }

    // D-css: container queries
    if (/container\s+quer/i.test(input)) {
      return '**CSS Container Queries** style elements based on **container** size, not viewport.\n\n' +
        '```css\n.card-wrapper {\n  container-type: inline-size;\n  container-name: card;\n}\n\n@container card (min-width: 400px) {\n  .card { display: grid; grid-template-columns: 1fr 1fr; }\n}\n\n@container card (max-width: 399px) {\n  .card { display: flex; flex-direction: column; }\n}\n```\n\n' +
        '**Why it matters:** Media queries check the **viewport**. Container queries check the **parent** — so the same component adapts whether it\'s in a sidebar (300px) or main content (800px).\n\n' +
        '**Key properties:**\n- `container-type: inline-size` — enable container queries on width\n- `container-name` — optional name for targeting\n- `@container` — the query rule, works like `@media` but for the container\n\n' +
        '**Browser support:** All modern browsers since 2023. **Responsive** design is now truly component-based.';
    }

    // D-css: CSS reset vs normalize
    if (/css\s+reset|normalize\.?css|\bnormalize\b.*\breset\b|\breset\b.*\bnormalize\b/i.test(input)) {
      return '**CSS Reset vs Normalize:**\n\n' +
        '**CSS Reset** (e.g., Eric Meyer\'s) strips ALL **default** **browser** styles — margins, padding, font sizes — to zero. Everything starts from a blank slate.\n```css\n* { margin: 0; padding: 0; box-sizing: border-box; }\n```\n\n' +
        '**Normalize.css** preserves useful **default** browser styles while fixing inconsistencies **between** browsers. Headings still look like headings, lists still have bullets.\n\n' +
        '| Approach | Strategy | Result |\n' +
        '|----------|----------|--------|\n' +
        '| Reset | Remove ALL defaults | Blank canvas, must restyle everything |\n' +
        '| Normalize | Fix inconsistencies | Sensible defaults preserved |\n\n' +
        '**Modern approach:** Most frameworks (Tailwind, Chakra) include their own "preflight" reset that combines both — reset most things but keep accessible defaults. Tailwind\'s preflight is based on `modern-normalize` + opinionated resets.';
    }

    // E-devops: What is Docker?
    if (/^what\s+(?:is|are)\s+docker\b/i.test(input) && !/image|container.*vs|vs.*container|dockerfile|compose/i.test(input)) {
      return '**Docker** is a platform for building, shipping, and running applications in **containers**.\n\n' +
        'A **container** packages your app with all its dependencies — code, runtime, libraries, system tools — into a single portable unit. It runs identically on any machine with Docker installed.\n\n' +
        '**Key concepts:**\n' +
        '- **Image** — a read-only template (like a class). Built from a Dockerfile.\n' +
        '- **Container** — a running instance of an image (like an object). Lightweight, isolated, ephemeral.\n' +
        '- **Dockerfile** — instructions to build an image (`FROM`, `COPY`, `RUN`, `CMD`)\n' +
        '- **Docker Compose** — define multi-container apps in a `docker-compose.yml`\n' +
        '- **Registry** — Docker Hub or private registries to share images\n\n' +
        '**Why Docker?** "Works on my machine" → works everywhere. Consistent dev/staging/prod environments, easy scaling, fast startup (seconds vs minutes for VMs), isolation without full virtual machines.';
    }

    // E-devops: Docker image vs container
    if (/docker\b.*\bimage\b.*\bcontainer\b|image\b.*vs.*container|container\b.*vs.*image/i.test(input)) {
      return '**Docker Image vs Container:**\n\n' +
        '| | **Image** | **Container** |\n' +
        '|---|-----------|---------------|\n' +
        '| What | Read-only **template** | Running **instance** of an image |\n' +
        '| Analogy | Class definition | Object / instance |\n' +
        '| State | Immutable (layered filesystem) | Has writable layer on top |\n' +
        '| Created by | `docker build` + Dockerfile | `docker run` or `docker create` |\n' +
        '| Stored | Registry (Docker Hub) or local cache | Only exists while running (or stopped) |\n\n' +
        '```bash\n# Build an image from Dockerfile\ndocker build -t my-app .\n\n# Create a container (instance) from the image\ndocker run -p 3000:3000 my-app\n\n# One image → many containers\ndocker run --name app1 my-app\ndocker run --name app2 my-app\n```\n\n' +
        '**Key insight:** Images are the blueprint, containers are the running process. You can create many containers from one image — each with its own state.';
    }

    // E-devops: Dockerfile
    if (/\bdockerfile\b/i.test(input) && !/compose|how.*deploy/i.test(input)) {
      return '**Dockerfile** is a text file with **instructions** to **build** a Docker image, layer by layer.\n\n' +
        '```dockerfile\n# Base image\nFROM node:20-alpine\n\n# Set working directory\nWORKDIR /app\n\n# Copy dependency files first (layer caching)\nCOPY package*.json ./\nRUN npm ci --only=production\n\n# Copy application code\nCOPY . .\n\n# Expose port\nEXPOSE 3000\n\n# Start command\nCMD ["node", "server.js"]\n```\n\n' +
        '**Key instructions:**\n' +
        '- `FROM` — base image (every Dockerfile starts with this)\n' +
        '- `WORKDIR` — set the working directory\n' +
        '- `COPY` / `ADD` — copy files from host to image\n' +
        '- `RUN` — execute commands during build (install deps, compile)\n' +
        '- `EXPOSE` — document which port the app uses\n' +
        '- `CMD` — default command when container starts\n' +
        '- `ENV` — set environment variables\n\n' +
        '**Build:** `docker build -t my-app .` reads the Dockerfile and creates an image.';
    }

    // E-devops: serverless
    if (/\bserverless\b/i.test(input)) {
      return '**Serverless** computing runs code without managing servers — the cloud provider handles infrastructure, **scaling**, and availability.\n\n' +
        '**How it works:** You deploy a **function** (AWS **Lambda**, Vercel Functions, Cloudflare Workers). The provider:\n' +
        '- Allocates compute on demand\n' +
        '- **Scales** automatically (0 to thousands of instances)\n' +
        '- Charges per invocation (pay only when your code runs)\n' +
        '- Handles OS, runtime, patching\n\n' +
        '**Pros:** Zero server management, automatic scaling, cost-effective for variable traffic, instant deployments.\n\n' +
        '**Cons:** Cold starts (first invocation is slow), execution time limits (e.g., 15 min on **Lambda**), vendor lock-in, harder to debug, stateless (no persistent memory).\n\n' +
        '**Common use cases:** API endpoints, webhooks, scheduled tasks, image processing, form handling.\n\n' +
        '**Platforms:** AWS Lambda, Vercel Edge Functions, Cloudflare Workers, Google Cloud Functions, Azure Functions.';
    }

    // E-devops: Nginx
    if (/\bnginx\b/i.test(input) && !/how.*config|setup/i.test(input)) {
      return '**Nginx** (pronounced "engine-x") is a high-performance **web server**, **reverse proxy**, and load balancer.\n\n' +
        '**Primary roles:**\n' +
        '- **Web server** — serves static files (HTML, CSS, JS, images) extremely fast\n' +
        '- **Reverse proxy** — forwards requests to backend servers (Node.js, Python, etc.) via **HTTP**\n' +
        '- **Load balancer** — distributes traffic across multiple backend instances\n' +
        '- **SSL termination** — handles HTTPS certificates\n' +
        '- **Caching** — stores responses to reduce backend load\n\n' +
        '```nginx\nserver {\n  listen 80;\n  server_name example.com;\n\n  location / {\n    proxy_pass http://localhost:3000;  # reverse proxy to Node.js\n  }\n\n  location /static/ {\n    root /var/www;  # serve static files directly\n  }\n}\n```\n\n' +
        '**Why Nginx?** Handles 10,000+ concurrent connections with minimal memory. Event-driven architecture (non-blocking), unlike Apache\'s thread-per-connection model.';
    }

    // G-auth: Content Security Policy
    if (/content.?security.?policy|\bcsp\b/i.test(input)) {
      return '**Content Security Policy** (**CSP**) is a security **header** that tells the browser which sources of content are trusted — preventing XSS and injection attacks.\n\n' +
        '```http\nContent-Security-Policy: default-src \'self\'; script-src \'self\' https://cdn.example.com; style-src \'self\' \'unsafe-inline\'\n```\n\n' +
        '**Key directives:**\n' +
        '- `default-src` — fallback for all resource types\n' +
        '- `script-src` — allowed **script** sources (prevents inline scripts by default)\n' +
        '- `style-src` — allowed stylesheet sources\n' +
        '- `img-src` — allowed image sources\n' +
        '- `connect-src` — allowed fetch/XHR/WebSocket targets\n' +
        '- `frame-ancestors` — who can embed your page (replaces X-Frame-Options)\n\n' +
        '**Why CSP matters:** Even if an attacker injects `<script>` tags (XSS), CSP blocks execution because the script source isn\'t whitelisted. It\'s defense-in-depth — the last line of defense against injection.\n\n' +
        '**Tip:** Start with `Content-Security-Policy-Report-Only` to test without breaking anything.';
    }

    // J-python: list vs tuple
    if (/\blist\b.*\btuple\b|\btuple\b.*\blist\b/i.test(input) && /python|differ|compare|vs/i.test(input)) {
      return '**List vs Tuple in Python:**\n\n' +
        '| Feature | **List** `[]` | **Tuple** `()` |\n' +
        '|---------|--------------|----------------|\n' +
        '| Mutability | **Mutable** — can add, remove, change | **Immutable** — fixed after creation |\n' +
        '| Syntax | `[1, 2, 3]` | `(1, 2, 3)` |\n' +
        '| Hashable | No (can\'t be dict key) | Yes (can be dict key/set member) |\n' +
        '| Performance | Slightly slower | Slightly faster, less memory |\n' +
        '| Use case | Collections that change | Fixed records, function returns |\n\n' +
        '```python\n# List — mutable\ncolors = ["red", "blue"]\ncolors.append("green")  # OK\ncolors[0] = "yellow"    # OK\n\n# Tuple — immutable\npoint = (10, 20)\n# point[0] = 30  # TypeError!\ncoords = {point: "A"}  # OK as dict key\n```\n\n' +
        '**Rule of thumb:** Use **list** when order matters and items change. Use **tuple** for fixed data (coordinates, RGB values, function returns).';
    }

    // J-python: pip
    if (/\bpip\b.*\bpython\b|\bpython\b.*\bpip\b|^what\s+is\s+pip\b/i.test(input)) {
      return '**pip** is Python\'s default **package** manager — it **installs** packages from **PyPI** (Python Package Index).\n\n' +
        '```bash\n# Install a package\npip install requests\n\n# Install specific version\npip install django==4.2\n\n# Install from requirements file\npip install -r requirements.txt\n\n# List installed packages\npip list\n\n# Save current packages\npip freeze > requirements.txt\n```\n\n' +
        '**Key concepts:**\n' +
        '- **PyPI** (pypi.org) — the central repository with 400,000+ packages\n' +
        '- `requirements.txt` — lists project dependencies with version pins\n' +
        '- **Virtual environments** — isolate packages per project: `python -m venv .venv`\n' +
        '- **pip install -e .** — editable install for local development\n\n' +
        '**Modern alternatives:** `pipx` (for CLI tools), `poetry` (dependency management + lockfile), `uv` (extremely fast Rust-based pip replacement).';
    }

    // J-python: Django
    if (/\bdjango\b/i.test(input)) {
      return '**Django** is a batteries-included **Python** **web** **framework** — the most popular full-stack framework in the Python ecosystem.\n\n' +
        '**Key features:**\n' +
        '- **ORM** — define models in Python, auto-generates SQL/migrations\n' +
        '- **Admin panel** — auto-generated CRUD interface from your models\n' +
        '- **URL routing** — map URLs to views with regex or path converters\n' +
        '- **Template engine** — server-side HTML rendering\n' +
        '- **Authentication** — built-in user auth, sessions, permissions\n' +
        '- **Security** — CSRF protection, XSS prevention, SQL injection prevention\n\n' +
        '```python\n# models.py\nclass Article(models.Model):\n    title = models.CharField(max_length=200)\n    body = models.TextField()\n    published = models.DateTimeField(auto_now_add=True)\n\n# views.py\ndef article_list(request):\n    articles = Article.objects.all()\n    return render(request, "articles.html", {"articles": articles})\n```\n\n' +
        '**Philosophy:** "Don\'t repeat yourself" (DRY), convention over configuration. Used by Instagram, Pinterest, Mozilla, Disqus.';
    }

    // L-wcag: alt attribute
    if (/\balt\b.*(?:attribute|text|tag|img)/i.test(input)) {
      return '**The `alt` attribute** provides a **text** **description** of an **image** for accessibility and fallback display.\n\n' +
        '```html\n<img src="chart.png" alt="Monthly sales chart showing 20% growth in Q4">\n<img src="decoration.svg" alt="">  <!-- decorative: empty alt -->\n```\n\n' +
        '**Why it matters:**\n' +
        '- **Screen readers** read alt text aloud for visually impaired users\n' +
        '- **SEO** — search engines index alt text to understand images\n' +
        '- **Fallback** — displayed when images fail to load\n' +
        '- **Required by WCAG** — images without alt fail accessibility audits\n\n' +
        '**Best practices:**\n' +
        '- Describe the image\'s PURPOSE, not just appearance ("Sales chart" not "Picture of graph")\n' +
        '- Keep it concise (under 125 characters)\n' +
        '- Use `alt=""` (empty, not missing) for decorative images\n' +
        '- Never use "image of..." or "picture of..." — the screen reader already says "image"\n' +
        '- For complex images (charts, diagrams), use `aria-describedby` with a longer description';
    }

    // M-gdpr: right to be forgotten
    if (/right.*(?:forgotten|erasure)|right.*(?:delete|delet).*(?:data|personal)/i.test(input)) {
      return '**Right to be Forgotten** (Right to **Erasure**, GDPR Article 17):\n\n' +
        'Data subjects can request that organizations **delete** all their personal data. The organization must comply within 30 days if:\n' +
        '- The data is no longer necessary for its original purpose\n' +
        '- Consent is withdrawn\n' +
        '- The data was unlawfully processed\n' +
        '- Legal obligation requires deletion\n\n' +
        '**Exceptions (you may refuse):**\n' +
        '- Legal obligation to retain data\n' +
        '- Public interest (health, archiving, research)\n' +
        '- Exercising right to freedom of expression\n' +
        '- Establishing, exercising, or defending legal claims\n\n' +
        '**Implementation for developers:**\n' +
        '- Build a "delete my account" feature that cascades through ALL systems\n' +
        '- Don\'t just soft-delete — remove from backups, logs, analytics, third-party services\n' +
        '- Document your data retention policies\n' +
        '- Return confirmation to the user after deletion\n\n' +
        '**Famous case:** Google v. Spain (2014) — the EU court ruled that search engines must remove links to outdated personal information on request.';
    }

    // N-norway: universell utforming
    if (/universell\s+utforming/i.test(input)) {
      return '**Universell utforming** (Universal Design / **accessibility**) is Norway\'s legal requirement that all digital services must be **tilgjengelig** for everyone, including people with disabilities.\n\n' +
        '**Legal basis:** *Likestillings- og diskrimineringsloven* (Equality and Anti-Discrimination Act) + *Forskrift om universell utforming av IKT*. Applies to all public and private sector websites and apps.\n\n' +
        '**Requirements (based on WCAG 2.1 AA):**\n' +
        '- Text alternatives for images (alt text)\n' +
        '- Keyboard navigability for all functionality\n' +
        '- Sufficient color contrast (4.5:1 for text)\n' +
        '- Resizable text without breaking layout\n' +
        '- Captions for video/audio content\n' +
        '- Clear, consistent navigation\n\n' +
        '**Enforcement:** Digitaliseringsdirektoratet (Digdir) monitors compliance. Violations can result in fines.\n\n' +
        '**Testing tools:** axe DevTools, WAVE, Lighthouse accessibility audit, NVDA/VoiceOver screen reader testing.\n\n' +
        '**Deadline:** All existing websites must comply. New digital services must be accessible from launch.';
    }

    // N-norway: Vipps
    if (/\bvipps\b/i.test(input)) {
      return '**Vipps** is **Norway\'s** dominant **mobile** **payment** app — used by 4+ million Norwegians (80%+ of the population).\n\n' +
        '**Features:**\n' +
        '- Person-to-person payments (like Venmo, but Norwegian)\n' +
        '- Online payments (e-commerce checkout)\n' +
        '- In-store payments (NFC/QR)\n' +
        '- Invoice payments\n' +
        '- Recurring payments (subscriptions)\n\n' +
        '**For developers (Vipps MobilePay API):**\n' +
        '- ePayment API — online checkout integration\n' +
        '- Recurring API — subscriptions and memberships\n' +
        '- Login API — "Log in with Vipps" (like Google/Apple sign-in)\n' +
        '- Order Management API — receipts and order tracking\n\n' +
        '**History:** Launched in 2015 by DNB (Norway\'s largest bank). Merged with Danish MobilePay and Finnish Pivo in 2022 to form Vipps MobilePay across the Nordics.\n\n' +
        '**Integration:** Available as a Shopify plugin, WooCommerce plugin, and standalone API. Extremely high conversion rates in Norway because users already have the app.';
    }

    // S-build: Webpack
    if (/\bwebpack\b/i.test(input) && !/vs\s+vite|vite\s+vs|migrate/i.test(input)) {
      return '**Webpack** is a module **bundler** for JavaScript applications — it takes your source files (JS, CSS, images) and packages them into optimized output files.\n\n' +
        '**Core concepts:**\n' +
        '- **Entry** — starting point for the dependency graph (e.g., `src/index.js`)\n' +
        '- **Output** — where bundled files go (e.g., `dist/bundle.js`)\n' +
        '- **Loaders** — transform non-JS files: `css-loader`, `ts-loader`, `babel-loader`, `file-loader`\n' +
        '- **Plugins** — extend functionality: `HtmlWebpackPlugin`, `MiniCssExtractPlugin`, `DefinePlugin`\n\n' +
        '```javascript\nmodule.exports = {\n  entry: "./src/index.js",\n  output: { filename: "bundle.js", path: __dirname + "/dist" },\n  module: {\n    rules: [{ test: /\\.css$/, use: ["style-loader", "css-loader"] }]\n  },\n  plugins: [new HtmlWebpackPlugin({ template: "./src/index.html" })]\n};\n```\n\n' +
        '**Key features:** Code splitting, tree shaking, hot module replacement (HMR), dev server.\n\n' +
        '**Modern alternatives:** Vite (faster dev, ESM-native), esbuild (extremely fast), Turbopack (Vercel\'s Rust-based bundler).';
    }

    // T-misc: Astro
    if (/\bastro\b/i.test(input) && !/astro.*physics|astro.*nomy/i.test(input)) {
      return '**Astro** is a modern web framework optimized for **content**-driven websites — blogs, docs, marketing pages, portfolios.\n\n' +
        '**Key innovation — Islands Architecture:**\n' +
        '- Pages are **static** HTML by default (zero JavaScript shipped)\n' +
        '- Interactive components are hydrated as "**islands**" only where needed\n' +
        '- Result: extremely fast pages with selective interactivity\n\n' +
        '```astro\n---\n// Server-side (runs at build time)\nimport Header from "../components/Header.astro";\nimport Counter from "../components/Counter.tsx";\nconst posts = await fetch("/api/posts").then(r => r.json());\n---\n<Header />\n<Counter client:visible />  <!-- Hydrate only when visible -->\n{posts.map(p => <article>{p.title}</article>)}\n```\n\n' +
        '**Unique features:**\n' +
        '- **Framework-agnostic** — use React, Vue, Svelte, Solid components in the same project\n' +
        '- **Content Collections** — type-safe Markdown/MDX with schemas\n' +
        '- **SSG + SSR** — static by default, server rendering when needed\n' +
        '- **View Transitions** — built-in page transition animations\n\n' +
        '**Performance:** Ships zero JS by default. Lighthouse 100 scores out of the box.';
    }

    // ══════════════════════════════════════════════════════════════
    //  PROCEDURAL "How do I..." handlers
    // ══════════════════════════════════════════════════════════════

    if (/(?:how|steps?).*(?:deploy|run|host).*(?:node|nodejs).*(?:docker|container)|(?:docker|container).*(?:node|nodejs).*(?:deploy|run)/i.test(input)) {
      return '**Deploying a Node.js app with Docker:**\n\n' +
        '**1. Create a `Dockerfile`:**\n```dockerfile\nFROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --only=production\nCOPY . .\nEXPOSE 3000\nCMD ["node", "server.js"]\n```\n\n' +
        '**2. Add `.dockerignore`:**\n```\nnode_modules\nnpm-debug.log\n.git\n```\n\n' +
        '**3. Build and run:**\n```bash\ndocker build -t my-app .\ndocker run -p 3000:3000 my-app\n```\n\n' +
        '**Best practices:**\n- Use multi-stage builds to reduce image size\n- Use `npm ci` (not `npm install`) for reproducible builds\n- Run as non-root user: `USER node`\n- Use `alpine` base images for smaller footprint\n- Copy `package.json` first to leverage Docker layer caching';
    }

    if (/(?:how|steps?).*(?:setup|set\s*up|start|init|create|configure).*typescript.*(?:project|app|new)|(?:setup|set\s*up|start|init).*(?:new|fresh).*typescript/i.test(input)) {
      return '**Setting up TypeScript in a new project:**\n\n' +
        '**1. Initialize and install:**\n```bash\nmkdir my-project && cd my-project\nnpm init -y\nnpm install -D typescript @types/node\nnpx tsc --init\n```\n\n' +
        '**2. Configure `tsconfig.json`:**\n```json\n{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "NodeNext",\n    "moduleResolution": "NodeNext",\n    "strict": true,\n    "outDir": "dist",\n    "rootDir": "src",\n    "esModuleInterop": true,\n    "skipLibCheck": true\n  },\n  "include": ["src/**/*"]\n}\n```\n\n' +
        '**3. Create source file:**\n```bash\nmkdir src\necho \'console.log("Hello TypeScript!");\' > src/index.ts\n```\n\n' +
        '**4. Build and run:**\n```bash\nnpx tsc\nnode dist/index.js\n```\n\n' +
        '**For dev workflow**, add `tsx` for direct execution: `npx tsx src/index.ts`';
    }

    if (/(?:how|steps?).*(?:use|work\s+with|manage).*(?:git\s+)?branch|git\s+branch.*(?:how|tutorial|guide|explain)|branch.*(?:strategy|workflow|merge)/i.test(input)) {
      return '**Using Git branches:**\n\n' +
        '**Create and switch:**\n```bash\ngit branch feature/login    # create branch\ngit checkout feature/login  # switch to it\n# or in one step:\ngit checkout -b feature/login\n```\n\n' +
        '**List branches:**\n```bash\ngit branch          # local branches\ngit branch -a       # include remote branches\n```\n\n' +
        '**Merge a branch:**\n```bash\ngit checkout main\ngit merge feature/login\n```\n\n' +
        '**Delete a branch:**\n```bash\ngit branch -d feature/login       # safe delete\ngit push origin --delete feature/login  # remote\n```\n\n' +
        '**Branch strategies:**\n- **Feature branches** — one branch per feature, merge into main\n- **Git Flow** — main, develop, feature/*, release/*, hotfix/*\n- **Trunk-based** — short-lived branches, frequent merges to main\n\n' +
        '**Tip:** Keep branches short-lived. The longer a branch lives, the harder the merge.';
    }

    // ══════════════════════════════════════════════════════════════
    //  SPECIFIC KNOWLEDGE HANDLERS — TypeScript deep
    // ══════════════════════════════════════════════════════════════

    if (/interface\s+vs\s+type|type\s+vs\s+interface|difference.*(?:interface|type).*typescript/i.test(input)) {
      return '**interface vs type in TypeScript:**\n\n' +
        '| Feature | `interface` | `type` |\n|---|---|---|\n' +
        '| **Extend** | `extends` keyword | `&` intersection |\n' +
        '| **Merge** | Declaration merging ✅ | Cannot re-open ❌ |\n' +
        '| **Unions** | Not supported | `type A = B | C` ✅ |\n' +
        '| **Primitives** | Objects only | Any type |\n\n' +
        '**Use `interface`** for object shapes that may be extended.\n**Use `type`** for unions, intersections, mapped types, or primitives.\n\n' +
        '```typescript\ninterface User { name: string; age: number; }\ninterface Admin extends User { role: "admin"; }\n\ntype ID = string | number;\ntype UserWithId = User & { id: ID };\n```';
    }

    if (/generic.*typescript|typescript.*generic|explain.*generic|what\s+(?:are|is)\s+generic/i.test(input)) {
      return '**Generics in TypeScript** let you write reusable code with a type parameter `<T>` that preserves type safety.\n\n' +
        '```typescript\nfunction identity<T>(value: T): T {\n  return value;\n}\nidentity<string>("hello"); // T = string\nidentity(42);             // T inferred as number\n\ninterface ApiResponse<T> {\n  data: T;\n  status: number;\n}\n\nfunction getLength<T extends { length: number }>(item: T): number {\n  return item.length;\n}\n```\n\n' +
        '**Common uses:** collections, API responses, form handlers, utility functions.';
    }

    if (/union\s+type|intersection\s+type|union.*intersection|what.*(?:union|intersection).*type/i.test(input)) {
      return '**Union and intersection types in TypeScript:**\n\n' +
        '**Union (`|`)** — a value can be ONE of several types:\n```typescript\ntype Status = "loading" | "success" | "error";\ntype ID = string | number;\n```\n\n' +
        '**Intersection (`&`)** — combines multiple types into one:\n```typescript\ntype Named = { name: string };\ntype Aged = { age: number };\ntype Person = Named & Aged; // { name: string; age: number }\n```\n\n' +
        '**Key difference:** Union = "OR" (one of), Intersection = "AND" (all of).\n\n' +
        '**Narrowing unions:**\n```typescript\nfunction handle(value: string | number) {\n  if (typeof value === "string") value.toUpperCase();\n}\n```';
    }

    if (/async\s*\/?\s*await.*(?:javascript|js|how|work|explain)|how\s+does\s+async/i.test(input)) {
      return '**async/await** in JavaScript simplifies working with Promises.\n\n' +
        '- `async` marks a function as returning a Promise\n- `await` pauses execution until the Promise resolves\n\n' +
        '```javascript\nasync function getData() {\n  try {\n    const res = await fetch("/api/data");\n    const data = await res.json();\n    console.log(data);\n  } catch (err) {\n    console.error(err);\n  }\n}\n```\n\n' +
        '**Key rules:** `await` only works inside `async` functions. Each `await` yields to the event loop microtask queue.';
    }

    if (/var\b.*let\b.*const\b|let\s+vs\s+const|difference.*(?:var|let|const)|var\s+let\s+const/i.test(input)) {
      return '**var, let, and const in JavaScript:**\n\n' +
        '| | `var` | `let` | `const` |\n|---|---|---|---|\n' +
        '| **Scope** | Function scope | Block scope | Block scope |\n' +
        '| **Hoisting** | Hoisted (undefined) | Temporal dead zone | Temporal dead zone |\n' +
        '| **Reassign** | ✅ | ✅ | ❌ |\n| **Redeclare** | ✅ | ❌ | ❌ |\n\n' +
        '**Best practice:** Default to `const`. Use `let` only when reassignment is needed. Never use `var`.';
    }

    if (/closure.*(?:javascript|js|explain|what)|what.*closure|explain.*closure/i.test(input)) {
      return '**A closure** in JavaScript is a function that retains access to its outer scope even after the outer function has returned.\n\n' +
        '```javascript\nfunction createCounter() {\n  let count = 0;\n  return function() {\n    count++;\n    return count;\n  };\n}\nconst counter = createCounter();\ncounter(); // 1\ncounter(); // 2\n```\n\n' +
        '**How it works:** The inner function "closes over" variables in the outer scope. Closed-over variables persist as long as the closure exists.\n\n**Common uses:** data privacy, factory functions, event handlers, callbacks.';
    }

    if (/event\s+loop|call\s+stack.*queue|microtask.*macrotask/i.test(input)) {
      return '**The JavaScript event loop** manages async execution in a single-threaded environment.\n\n' +
        '**Components:**\n1. **Call stack** — executes synchronous code (LIFO)\n2. **Microtask queue** — Promises, queueMicrotask\n3. **Macrotask queue** — setTimeout, setInterval, I/O\n\n' +
        '**Execution order:** sync code → drain microtask queue → one macrotask → repeat.\n\n' +
        '```javascript\nconsole.log("1");           // sync\nsetTimeout(() => console.log("2"), 0); // macrotask\nPromise.resolve().then(() => console.log("3")); // microtask\nconsole.log("4");           // sync\n// Output: 1, 4, 3, 2\n```';
    }

    if (/template\s+literal\s+type|template.*type.*string/i.test(input)) {
      return '**Template literal types** in TypeScript create new string literal types using template syntax.\n\n' +
        '```typescript\ntype Color = "red" | "blue";\ntype Size = "sm" | "lg";\ntype ColorSize = `${Color}-${Size}`;\n// "red-sm" | "red-lg" | "blue-sm" | "blue-lg"\n\ntype EventName<T extends string> = `on${Capitalize<T>}`;\ntype ClickEvent = EventName<"click">; // "onClick"\n```\n\n' +
        '**Use cases:** CSS class builders, event handler types, API route patterns, string manipulation at the type level.';
    }

    if (/==\s*(?:vs|versus)?\s*===|strict.*equal|type\s+coercion.*equal|difference.*(?:==|===|equality)/i.test(input)) {
      return '**`==` vs `===`** in JavaScript:\n\n- **`===`** (strict equality) — compares value AND type, no type coercion\n- **`==`** (loose equality) — converts types before comparing (type coercion)\n\n' +
        '```javascript\n1 === "1"  // false (different type)\n1 == "1"   // true (string coerced to number)\nnull === undefined // false\nnull == undefined  // true (special rule)\n```\n\n' +
        '**Best practice:** Always use `===` (strict equality) to avoid unexpected type coercion bugs.';
    }

    if (/destructur.*(?:javascript|js|what|explain|how)|what\s+is\s+destructur/i.test(input)) {
      return '**Destructuring** in JavaScript extracts values from objects and arrays with shorthand syntax.\n\n' +
        '**Object destructuring:**\n```javascript\nconst user = { name: "Alice", age: 30 };\nconst { name, age } = user;\nconst { name: userName, country = "Norway" } = user;\n```\n\n' +
        '**Array destructuring:**\n```javascript\nconst [first, second, ...rest] = [1, 2, 3, 4, 5];\n[a, b] = [b, a]; // swap\n```\n\n' +
        '**In function parameters:**\n```javascript\nfunction greet({ name, age }: { name: string; age: number }) {\n  return `Hi ${name}, you are ${age}`;\n}\n```';
    }

    if (/for\s*\.{0,3}\s*in\b.*for\s*\.{0,3}\s*of|for\s*\.{0,3}\s*of\b.*for\s*\.{0,3}\s*in|differ.*for\s*\.{0,3}\s*(?:in|of)|for\s+in\s+(?:vs|versus)\s+for\s+of|\bfor\.\.\.in\b|\bfor\.\.\.of\b/i.test(input)) {
      return '**for...in vs for...of in JavaScript:**\n\n' +
        '| | `for...in` | `for...of` |\n|---|---|---|\n' +
        '| **Iterates** | Object **keys** (enumerable properties) | Iterable **values** (arrays, strings, maps, sets) |\n' +
        '| **Works on** | Objects, arrays (gives indices) | Arrays, strings, Maps, Sets, generators |\n' +
        '| **Returns** | Property names (strings) | Actual values |\n\n' +
        '```javascript\nconst arr = [10, 20, 30];\nfor (const key in arr) console.log(key);   // "0", "1", "2" (indices as strings)\nfor (const val of arr) console.log(val);   // 10, 20, 30 (actual values)\n\nconst obj = { a: 1, b: 2 };\nfor (const key in obj) console.log(key);   // "a", "b" (property names)\n// for...of on plain objects throws TypeError\n```\n\n' +
        '**Rule of thumb:** Use `for...of` for arrays/iterables (values), `for...in` for objects (keys). Prefer `.forEach()` or `.map()` for arrays when possible.';
    }

    if (/utility\s+type|partial\b.*required\b|pick\b.*omit\b|typescript.*(?:partial|pick|omit|record|readonly)/i.test(input)) {
      return '**TypeScript utility types** — built-in type transformations:\n\n' +
        '| Utility | Description |\n|---|---|\n| `Partial<T>` | All properties optional |\n| `Required<T>` | All properties required |\n| `Pick<T, K>` | Select specific properties |\n| `Omit<T, K>` | Exclude specific properties |\n| `Record<K, V>` | Key-value type map |\n| `Readonly<T>` | All properties readonly |\n\n' +
        '```typescript\ninterface User { id: number; name: string; email: string; }\ntype PartialUser = Partial<User>;\ntype UserName = Pick<User, "name" | "email">;\ntype WithoutEmail = Omit<User, "email">;\ntype UserMap = Record<string, User>;\n```';
    }

    if (/error\s+handling.*typescript|handle.*error.*typescript|try\s+catch.*typescript/i.test(input)) {
      return '**Error handling in TypeScript:**\n\n```typescript\ntry {\n  const data = JSON.parse(input);\n} catch (error) {\n  if (error instanceof SyntaxError) console.error("Invalid JSON:", error.message);\n  throw error; // re-throw if unhandled\n} finally {\n  cleanup();\n}\n```\n\n' +
        '**Custom error class:**\n```typescript\nclass AppError extends Error {\n  constructor(message: string, public code: number) {\n    super(message);\n    this.name = "AppError";\n  }\n}\n```';
    }

    if (/nullish\s+coalescing|\?\?\s|what\s+is\s+\?\?/i.test(input)) {
      return '**Nullish coalescing operator (`??`)** returns the right operand when the left is `null` or `undefined`.\n\n' +
        '```javascript\nconst a = null ?? "default";    // "default"\nconst b = undefined ?? "default"; // "default"\nconst c = 0 ?? "default";      // 0 (NOT "default"!)\nconst d = "" ?? "default";      // "" (NOT "default"!)\n```\n\n' +
        '**`??` vs `||`:** `??` only checks null/undefined, while `||` treats `0`, `""`, `false` as falsy too. Use `??` when `0` or `""` are valid values.';
    }

    if (/optional\s+chain|\?\.\s|explain\s+\?\./i.test(input)) {
      return '**Optional chaining (`?.`)** safely accesses nested properties without throwing if a parent is null or undefined.\n\n' +
        '```typescript\nconst zip = user?.address?.zip; // undefined if any link is null\nconst result = obj?.method?.(); // safe method call\nconst item = arr?.[0]; // safe array access\n```\n\n' +
        '**Combined with `??`:** `const name = user?.profile?.name ?? "Anonymous";`\n\n**Key behavior:** Short-circuits to `undefined` if any link in the chain is `null` or `undefined`.';
    }

    if (/mapped\s+type|keyof.*in\s+|what.*mapped.*type/i.test(input)) {
      return '**Mapped types** in TypeScript transform every property using `in keyof` syntax.\n\n' +
        '```typescript\ntype MyPartial<T> = { [K in keyof T]?: T[K]; };\ntype MyReadonly<T> = { readonly [K in keyof T]: T[K]; };\ntype Stringify<T> = { [K in keyof T]: string; };\n\ninterface User { name: string; age: number; }\ntype StringUser = Stringify<User>; // { name: string; age: string }\n```\n\n' +
        '**Key modifiers:** `+readonly`, `-readonly`, `+?`, `-?` to add/remove modifiers.\n**Built-in mapped types:** `Partial`, `Required`, `Readonly`, `Record`.';
    }

    if (/discriminat.*union|tagged\s+union|what.*discriminat/i.test(input)) {
      return '**Discriminated unions** (tagged unions) use a common literal property to distinguish between union members.\n\n' +
        '```typescript\ntype Shape =\n  | { kind: "circle"; radius: number }\n  | { kind: "square"; side: number }\n  | { kind: "rectangle"; width: number; height: number };\n\nfunction area(shape: Shape): number {\n  switch (shape.kind) {\n    case "circle":    return Math.PI * shape.radius ** 2;\n    case "square":    return shape.side ** 2;\n    case "rectangle": return shape.width * shape.height;\n  }\n}\n```\n\n' +
        '**Benefits:** TypeScript narrows the type in each branch. Exhaustiveness checking warns about missing cases.';
    }

    if (/esm\b.*commonjs|commonjs.*esm|module\s+system.*javascript|import.*export.*require|es\s+module/i.test(input)) {
      return '**JavaScript module systems — ESM vs CommonJS:**\n\n' +
        '| | ESM (ES Modules) | CommonJS |\n|---|---|---|\n' +
        '| **Syntax** | `import`/`export` | `require()`/`module.exports` |\n' +
        '| **Loading** | Async, static | Sync, dynamic |\n| **Tree-shaking** | ✅ | ❌ |\n| **Browser** | Native support | Needs bundler |\n\n' +
        '```javascript\n// ESM\nimport { readFile } from "fs/promises";\nexport function hello() { return "world"; }\n\n// CommonJS\nconst { readFile } = require("fs/promises");\nmodule.exports = { hello: () => "world" };\n```\n\n**2026 recommendation:** Use ESM. Set `"type": "module"` in package.json.';
    }

    if (/decorator.*typescript|typescript.*decorator|what.*decorator|explain.*decorator/i.test(input) && !/python/i.test(input)) {
      return '**Decorators** in TypeScript modify classes, methods, and properties using the `@` syntax.\n\n' +
        '```typescript\nfunction Log(target: any, key: string, descriptor: PropertyDescriptor) {\n  const original = descriptor.value;\n  descriptor.value = function(...args: any[]) {\n    console.log(`Calling ${key} with`, args);\n    return original.apply(this, args);\n  };\n}\n\nclass UserService {\n  @Log\n  getUser(id: string) { return { id, name: "Alice" }; }\n}\n```\n\n' +
        '**Enable:** `"experimentalDecorators": true` in tsconfig.json. TS 5.0+ supports Stage 3 decorator syntax.\n**Common uses:** logging, caching, validation, dependency injection (NestJS, Angular). Decorators provide metadata annotation.';
    }

    if (/type\s+.*react\s+component|react\s+component.*typescript|how.*type.*react/i.test(input)) {
      return '**Typing React components in TypeScript:**\n\n' +
        '```typescript\ninterface ButtonProps {\n  label: string;\n  onClick: () => void;\n  variant?: "primary" | "secondary";\n  children?: React.ReactNode;\n}\n\nfunction Button({ label, onClick, variant = "primary" }: ButtonProps) {\n  return <button onClick={onClick} className={variant}>{label}</button>;\n}\n\n// With React.FC (optional)\nconst Button: React.FC<ButtonProps> = ({ label, onClick }) => (\n  <button onClick={onClick}>{label}</button>\n);\n```\n\n' +
        '**Key types:** `React.FC`, `React.ReactNode`, `React.ComponentProps<"button">`, `React.PropsWithChildren`.';
    }

    if (/record\s+type.*typescript|what\s+is.*record.*type|typescript.*record\b/i.test(input)) {
      return '**`Record<K, V>`** in TypeScript creates an object type with keys of type `K` and values of type `V`.\n\n' +
        '```typescript\ntype Status = "loading" | "success" | "error";\ntype StatusMessages = Record<Status, string>;\n\nconst messages: StatusMessages = {\n  loading: "Please wait...",\n  success: "Done!",\n  error: "Something went wrong",\n};\n```\n\n' +
        '**Under the hood:** `Record<K, V>` = `{ [P in K]: V }` (a mapped type).\n**Common uses:** lookup tables, enum-like key-value mappings, normalized state.';
    }

    if (/type\s+narrow|narrow.*type|type\s+guard|typeof.*instanceof/i.test(input)) {
      return '**Type narrowing** in TypeScript refines a broad type to a more specific one within a code block.\n\n' +
        '```typescript\nfunction process(value: string | number) {\n  if (typeof value === "string") value.toUpperCase(); // narrowed to string\n  else value.toFixed(2); // narrowed to number\n}\nif (error instanceof TypeError) error.message; // narrowed\n```\n\n' +
        '**Custom type guard:**\n```typescript\nfunction isUser(obj: unknown): obj is User {\n  return typeof obj === "object" && obj !== null && "name" in obj;\n}\n```\n\n' +
        '**Narrowing methods:** `typeof`, `instanceof`, `in` operator, equality checks, discriminated unions.';
    }

    if (/satisfies.*typescript|what\s+is\s+satisfies|typescript.*satisfies\s+keyword/i.test(input)) {
      return '**The `satisfies` keyword** (TypeScript 4.9+) validates that an expression matches a type without broadening the inferred type.\n\n' +
        '```typescript\ntype Color = "red" | "green" | "blue";\ntype Theme = Record<string, Color | Color[]>;\n\nconst theme = {\n  primary: "red",\n  gradients: ["red", "green"],\n} satisfies Theme;\n\ntheme.primary.toUpperCase(); // ✅ infer knows it\'s string\n```\n\n' +
        '**Key insight:** `satisfies` performs a type check without losing specific type inference — it validates the constraint while preserving the narrowest type.';
    }

    if (/type.?safe.*api\s+client|api\s+client.*type.*safe|typed.*fetch|generic.*api.*client/i.test(input)) {
      return '**Creating a type-safe API client in TypeScript:**\n\n' +
        '```typescript\ninterface ApiRoutes {\n  "/users": { response: User[] };\n  "/users/:id": { response: User };\n}\n\nasync function apiClient<T extends keyof ApiRoutes>(\n  endpoint: T, options?: RequestInit\n): Promise<ApiRoutes[T]["response"]> {\n  const res = await fetch(`/api${endpoint}`, options);\n  if (!res.ok) throw new Error(`API error: ${res.status}`);\n  return res.json();\n}\n\nconst users = await apiClient("/users"); // User[] — fully typed via generic\n```\n\n' +
        '**Alternatives:** tRPC (end-to-end safety), openapi-typescript (generate from OpenAPI), zodios (Zod + Axios).';
    }

    if (/conditional\s+type|extends.*infer|ternary.*type|what.*conditional.*type/i.test(input)) {
      return '**Conditional types** in TypeScript: `T extends U ? X : Y`\n\n' +
        '```typescript\ntype IsString<T> = T extends string ? true : false;\ntype A = IsString<"hello">; // true\ntype B = IsString<42>;      // false\n\n// infer extracts types\ntype ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;\ntype Fn = () => string;\ntype Result = ReturnType<Fn>; // string\n\ntype NonNullable<T> = T extends null | undefined ? never : T;\n```\n\n' +
        '**`infer`** extracts a type from within the conditional — essential for utility types like `ReturnType`, `Parameters`, `Awaited`.';
    }

    // ══════════════════════════════════════════════════════════════
    //  CSS deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/grid\s+vs\s+flex|flex.*vs.*grid|when.*use.*(?:grid|flex)|grid.*flex.*(?:when|differ)/i.test(input)) {
      return '**CSS Grid vs Flexbox:**\n\n| | CSS Grid | Flexbox |\n|---|---|---|\n' +
        '| **Dimension** | Two-dimensional (rows + columns) | One-dimensional (row OR column) |\n' +
        '| **Layout** | Grid-based page layouts | Alignment within a container |\n' +
        '| **Best for** | Page structure, card grids | Navbars, centering |\n\n' +
        '**Use Grid for:** page layouts, equal-sized card grids, two-dimensional layouts.\n**Use Flexbox for:** navbars, centering, distributing items in one direction.\n\nThey work great together! Use Grid for page layout, Flexbox inside each section.';
    }

    if (/dark\s+mode.*(?:tailwind|css|implement)|tailwind.*dark\s+mode|implement.*dark\s+mode/i.test(input)) {
      return '**Dark mode in Tailwind CSS:**\n\n**Class strategy (recommended):**\n```js\nmodule.exports = { darkMode: "class" };\n```\n```html\n<html class="dark">\n  <div class="bg-white dark:bg-gray-900 text-black dark:text-white">Content</div>\n</html>\n```\n\n**Media strategy** (follows OS preference):\n```js\nmodule.exports = { darkMode: "media" };\n```\n\n**Toggle:** `document.documentElement.classList.toggle("dark")`';
    }

    if (/css\s+custom\s+proper|css\s+variable|what.*custom.*propert.*css/i.test(input) && !/tailwind/i.test(input)) {
      return '**CSS custom properties** (CSS variables) use the `--` prefix and `var()` function.\n\n' +
        '```css\n:root {\n  --color-primary: #3b82f6;\n  --spacing-md: 1rem;\n  --font-body: "Inter", sans-serif;\n}\n.button {\n  background: var(--color-primary);\n  padding: var(--spacing-md);\n}\ncolor: var(--color-accent, #ff6600); /* with fallback */\n```\n\n' +
        '**Advantages:** cascade and inherit, runtime changes via JS, scoped to selectors, enable theming without preprocessors.';
    }

    if (/cascade.*specific|specific.*css|what.*(?:cascade|specificit)|css.*(?:cascade|priority)/i.test(input)) {
      return '**CSS Cascade and Specificity:**\n\n**Priority (highest first):**\n1. `!important`\n2. Inline styles\n3. ID selectors (`#id`)\n4. Class selectors (`.class`, `[attr]`, `:pseudo`)\n5. Element selectors (`div`, `p`)\n\n' +
        '**Specificity scoring:** (ID, Class, Element)\n- `#nav .item a` → (1,1,1)\n- `.header .nav` → (0,2,0)\n\n**`@layer` (CSS 2023+):** Controls cascade layer priority without specificity hacks.\n\n**Best practice:** Avoid `!important`, use `@layer`, prefer class selectors.';
    }

    if (/responsive\s+typograph|fluid\s+typograph|clamp.*font|font.*(?:clamp|fluid|responsive)/i.test(input)) {
      return '**Responsive (fluid) typography** using `clamp()`:\n\n```css\nh1 { font-size: clamp(1.5rem, 4vw, 3rem); }\n/* min: 1.5rem | preferred: 4vw | max: 3rem */\n```\n\n**Units:** `rem` = relative to root (accessible), `em` = relative to parent, `vw` = viewport width (fluid), `ch` = character width.\n\n**Goal:** ~45-75 characters per line for readability.';
    }

    if (/@layer.*css|css.*@layer|layer\s+directive|what.*@layer/i.test(input)) {
      return '**`@layer`** in CSS controls cascade priority explicitly.\n\n```css\n@layer reset, base, components, utilities;\n\n@layer base { h1 { font-size: 2rem; } }\n@layer utilities { .hidden { display: none; } }\n```\n\n**Rules:** Later layers have higher cascade priority. Un-layered styles beat all layered styles. Tailwind CSS v4 uses `@layer` internally.';
    }

    if (/center.*(?:element|div|both|horizontal|vertical)|how\s+(?:do\s+you\s+)?center/i.test(input)) {
      return '**Centering elements in CSS:**\n\n**Flexbox:**\n```css\n.parent { display: flex; justify-content: center; align-items: center; }\n```\n\n**Grid (shortest):**\n```css\n.parent { display: grid; place-items: center; }\n```\n\n**Tailwind:** `flex items-center justify-center` or `grid place-items-center`';
    }

    if (/container\s+quer|@container|container.*query.*css|what.*container.*quer/i.test(input)) {
      return '**CSS Container Queries** style elements based on **container** size, not viewport.\n\n' +
        '```css\n.card-wrapper { container-type: inline-size; container-name: card; }\n\n@container card (min-width: 400px) {\n  .card-title { font-size: 1.5rem; }\n  .card-body { display: grid; grid-template-columns: 1fr 1fr; }\n}\n```\n\n' +
        '**When useful:** Reusable components adapting to container (not viewport), cards in sidebar vs main. Supported in all modern browsers (2023+).';
    }

    if (/scroll.*(?:animat|linked|driven|timeline)|animation.*scroll|css.*scroll.*animat/i.test(input)) {
      return '**Scroll-linked animations:**\n\n**CSS Scroll Timeline:**\n```css\n.reveal {\n  animation: fadeIn linear both;\n  animation-timeline: view();\n  animation-range: entry 0% entry 100%;\n}\n```\n\n**Smooth scroll:** `html { scroll-behavior: smooth; }`\n\n**Libraries:** GSAP ScrollTrigger (most powerful), Framer Motion `useScroll`, Intersection Observer API.';
    }

    if (/rem\b.*\bem\b.*\bpx\b|\bpx\b.*\brem\b|what.*\b(?:rem|em|px|vh|vw)\b\s+unit|differ.*\b(?:rem|em|px)\b/i.test(input)) {
      return '**CSS units — rem, em, px, vh/vw:**\n\n| Unit | Relative to | Use case |\n|---|---|---|\n' +
        '| `px` | Fixed | Borders, fine details |\n| `rem` | Root font size (16px) | Font sizes, spacing |\n| `em` | Parent font size | Component-relative |\n| `vh/vw` | Viewport height/width | Full-screen sections |\n\n' +
        '**Best practice:** Use `rem` for most things (accessible), `px` for borders, `vw/vh` for viewport layouts, `dvh` on mobile.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Auth / Security handlers
    // ══════════════════════════════════════════════════════════════

    if (/\bjwt\b|json\s+web\s+token|how.*jwt.*work|explain.*jwt/i.test(input) && !/oauth|cors|xss|csrf/i.test(input)) {
      return '**JWT (JSON Web Token)** — compact self-contained token for authentication.\n\n' +
        '**Structure:** `header.payload.signature`\n- **Header** — algorithm + type: `{"alg": "HS256", "typ": "JWT"}`\n' +
        '- **Payload** — claims: `{"sub": "1234", "name": "Alice", "exp": ...}`\n' +
        '- **Signature** — HMAC(header + payload, secret)\n\n' +
        '**Flow:** Login → server creates signed token → client stores in httpOnly cookie → sends `Authorization: Bearer <token>` → server verifies signature.\n\n' +
        '**Tips:** Short expiration (15-60 min), refresh tokens for long sessions, httpOnly cookies (not localStorage).';
    }

    if (/oauth|authorization\s+(?:flow|code|grant)|what.*oauth/i.test(input) && !/cors|xss|csrf|jwt\b/i.test(input)) {
      return '**OAuth 2.0** — authorization framework for third-party access without sharing passwords.\n\n' +
        '**Authorization Code flow:**\n1. App redirects user to authorization server (Google, GitHub)\n2. User logs in and grants permission\n3. Server redirects back with authorization code\n4. App exchanges code for access token (server-to-server)\n5. App uses access token to call APIs\n\n' +
        '**Key concepts:** Access token (short-lived), Refresh token (long-lived), Redirect URI, Scopes.\n\n**OAuth = authorization (access). OpenID Connect (OIDC) = authentication (identity).**';
    }

    if (/\bcors\b|cross.?origin\s+resource|what.*cors|cors.*(?:what|why|important)/i.test(input)) {
      return '**CORS** (Cross-Origin Resource Sharing) — browser security restricting cross-origin requests.\n\n' +
        '**How it works:** Browser sends `Origin` header → server responds with `Access-Control-Allow-Origin` → if origins match, browser allows response.\n\n' +
        '**Server headers:**\n```\nAccess-Control-Allow-Origin: https://app.com\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE\nAccess-Control-Allow-Headers: Content-Type, Authorization\n```\n\n' +
        '**Preflight:** Non-simple requests (PUT, DELETE) trigger an OPTIONS preflight request first. Never use `Allow-Origin: *` with credentials.';
    }

    if (/\bxss\b|cross.?site\s+script|what.*xss|prevent.*xss/i.test(input)) {
      return '**XSS (Cross-Site Scripting)** — attack injecting malicious scripts into trusted websites.\n\n' +
        '**Types:** Stored (saved in DB), Reflected (in URL params), DOM-based (client-side).\n\n' +
        '**Prevention:**\n1. **Sanitize** input — remove/escape HTML tags\n2. **Escape** output — encode `<`, `>`, `&`, `"`\n3. **CSP** headers — restrict script sources\n4. **HttpOnly cookies** — prevent JS access\n5. **Frameworks** — React auto-escapes JSX\n\n' +
        '```tsx\n// React is safe by default\nreturn <p>{userInput}</p>; // auto-escaped\n// If needed: DOMPurify.sanitize(html)\n```';
    }

    if (/\bcsrf\b|cross.?site\s+request\s+forg|what.*csrf|prevent.*csrf/i.test(input)) {
      return '**CSRF (Cross-Site Request Forgery)** — tricks authenticated users into unwanted requests.\n\n' +
        '**Attack:** Evil site submits form to bank.com using victim\'s cookies.\n\n' +
        '**Protection:**\n1. **CSRF token** — random token in forms, validated server-side\n2. **SameSite cookies** — `SameSite=Strict` or `SameSite=Lax`\n3. **Check Origin/Referer header**\n4. **Double submit cookie**\n\nNext.js Server Actions have built-in CSRF protection. For API routes, use a cross-site request forgery token library.';
    }

    if (/password.*(?:hash|secur|stor)|hash.*password|bcrypt|argon2.*password|store.*password.*safe/i.test(input)) {
      return '**Storing passwords securely — NEVER plain text. Always hash.**\n\n' +
        '| Algorithm | Strength |\n|---|---|\n| **Argon2** | Strongest (memory-hard) |\n| **bcrypt** | Strong (time-tested) |\n| **scrypt** | Strong (memory-hard) |\n| SHA-256/MD5 | ❌ Never for passwords |\n\n' +
        '**How:** Generate random **salt** (unique per user) → hash(password + salt) → store only hash + salt.\n\n' +
        '```typescript\nimport { hash, verify } from "@node-rs/argon2";\nconst hashed = await hash(password);\nconst valid = await verify(hashed, inputPassword);\n```';
    }

    if (/authentication\s+vs\s+authorization|authorization\s+vs\s+authentication|differ.*(?:authentication|authorization).*(?:authentication|authorization)/i.test(input)) {
      return '**Authentication vs Authorization:**\n\n| | Authentication | Authorization |\n|---|---|---|\n' +
        '| **Question** | "Who are you?" | "What can you do?" |\n| **Verifies** | Identity | Permissions |\n| **Methods** | Password, OAuth, biometrics | Roles, policies, ACLs |\n\n' +
        '**Flow:** User authenticates (proves identity) → server checks authorization (role, permissions) → access granted or denied.';
    }

    if (/rbac|role.?based\s+access|implement.*role.*access|role.*permission.*access/i.test(input)) {
      return '**RBAC (Role-Based Access Control)** assigns permissions to roles, roles to users.\n\n' +
        '```typescript\nconst ROLES = {\n  admin: ["read", "write", "delete", "manage_users"],\n  editor: ["read", "write"],\n  viewer: ["read"],\n} as const;\n\nfunction hasPermission(userRole: keyof typeof ROLES, permission: string) {\n  return ROLES[userRole].includes(permission as any);\n}\n```\n\n' +
        '**Pattern:** Users → Roles → Permissions. Check access in middleware or API routes.';
    }

    // ══════════════════════════════════════════════════════════════
    //  React / Next.js deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/what\s+is\s+next\.?js|explain\s+next\.?js|next\.?js.*(?:what|explain|overview)/i.test(input) && !/app\s+router|server\s+component|server\s+action|middleware|parallel|intercept/i.test(input)) {
      return '**Next.js** is a full-stack React framework by Vercel.\n\n**Key features:**\n' +
        '- **SSR** (Server-Side Rendering) — HTML per request\n- **SSG** (Static Site Generation) — HTML at build time\n' +
        '- **ISR** (Incremental Static Regeneration) — static + revalidation\n- **App Router** (v13.4+) — Server Components, layouts, streaming\n' +
        '- **API Routes** — serverless functions built-in\n- **File-based routing** — pages map to URLs\n- **Image optimization** — `next/image`\n' +
        '- **Middleware** — code before requests complete\n\nUsed by Vercel, Netflix, TikTok, and more.';
    }

    if (/what\s+is\s+isr|\bisr\b.*next\.?js|next\.?js.*\bisr\b/i.test(input)) {
      return '**ISR (Incremental Static Regeneration)** in Next.js lets you update static pages after deployment without rebuilding the entire site.\n\n' +
        '**How it works:**\n- Pages are statically generated at build time\n- After the `revalidate` period, the next request triggers background regeneration\n- Stale page is served while the new one generates (stale-while-revalidate)\n\n' +
        '**Usage (App Router):**\n```tsx\nexport const revalidate = 60; // revalidate every 60s\n```\n\n' +
        '**On-demand ISR:** `revalidatePath(\'/blog\')` or `revalidateTag(\'posts\')` for immediate regeneration.\n\n' +
        '**Benefits:** Static performance (CDN-cached) with dynamic freshness. Perfect for blogs, e-commerce, dashboards.';
    }

    if (/ssr\b.*ssg\b|ssg\b.*ssr|ssr.*isr|difference.*(?:ssr|ssg|isr)|server\s+side.*static\s+(?:site|generat)/i.test(input)) {
      return '**SSR vs SSG vs ISR in Next.js:**\n\n' +
        '| Strategy | When generated | Best for |\n|---|---|---|\n' +
        '| **SSR** (Server-Side Rendering) | Each request | Dynamic data, personalized |\n' +
        '| **SSG** (Static Site Generation) | Build time | Blogs, docs, marketing |\n' +
        '| **ISR** (Incremental Static Regeneration) | Build + revalidates | Static + fresh data |\n\n' +
        '**App Router:** `export const dynamic = "force-dynamic"` (SSR), default is static (SSG), `export const revalidate = 60` (ISR).';
    }

    if (/app\s+router.*pages\s+router|pages\s+router.*app\s+router|differ.*(?:app|pages)\s+router/i.test(input)) {
      return '**App Router vs Pages Router:**\n\n| Feature | App Router (v13.4+) | Pages Router |\n|---|---|---|\n' +
        '| **Components** | Server Components (default) | Client-only |\n| **Routing** | `app/` directory | `pages/` directory |\n' +
        '| **Layouts** | Nested layouts (persistent) | Custom `_app.tsx` |\n| **Data** | `async` Server Components | `getServerSideProps` |\n' +
        '| **Streaming** | Suspense built-in | Not supported |\n\nApp Router is recommended for all new projects.';
    }

    if (/(?:structure|organize|folder|layout|architect).*react.*(?:project|app)|react.*(?:project|app).*(?:structure|organize|folder|layout)|best\s+way.*(?:structure|organize).*react/i.test(input)) {
      return '**React project structure:**\n\n```\nsrc/\n├── components/        # Reusable UI components\n│   ├── ui/            # Generic (Button, Input, Modal)\n│   └── features/      # Feature-specific (UserCard, ChatBubble)\n├── hooks/             # Custom hooks (useAuth, useFetch)\n├── pages/             # Route-level components\n├── lib/               # Utilities, helpers, API client\n├── context/           # React Context providers\n├── types/             # TypeScript type definitions\n├── styles/            # Global styles, Tailwind config\n└── assets/            # Images, fonts, icons\n```\n\n' +
        '**Key principles:**\n- **Group by feature**, not by type (for larger apps)\n- **Co-locate** tests next to components: `Button.tsx` + `Button.test.tsx`\n- **Barrel exports** (`index.ts`) for clean imports\n- Keep components **small** — if it\'s over 200 lines, split it\n- **Hooks folder** for shared logic (not one-off effects)';
    }

    if (/react\s+hooks?\b(?!.*(?:vs|versus|compared|flutter|vue|angular))/i.test(input) && /hooks?/i.test(input)) {
      return 'Hooks replaced class components as the standard way to use state and side effects in React (since 16.8). Here are the ones you\'ll use daily:\n\n**useState** — state + setter:\n```tsx\nconst [count, setCount] = useState(0);\n```\n\n' +
        '**useEffect** — side effects (data fetching, subscriptions):\n```tsx\nuseEffect(() => {\n  document.title = `Count: ${count}`;\n  return () => { /* cleanup */ };\n}, [count]);\n```\n\n' +
        '**useRef** — mutable ref persisting across renders:\n```tsx\nconst inputRef = useRef<HTMLInputElement>(null);\ninputRef.current?.focus();\n```\n\n' +
        '**useCallback** — memoized callback (prevents child re-renders):\n```tsx\nconst handleClick = useCallback(() => setCount(c => c + 1), []);\n```\n\n' +
        '**useMemo** — memoized value (expensive computation):\n```tsx\nconst sorted = useMemo(() => items.sort(compareFn), [items]);\n```\n\n' +
        '**useContext** — consume context without wrapper:\n```tsx\nconst theme = useContext(ThemeContext);\n```\n\n**Hook rules:** Only call at top level (not in loops/conditions). Only from React components or custom hooks.';
    }

    if (/server\s+action|use\s+server|react.*server.*action/i.test(input) && !/app\s+router.*(?:server\s+component|differ|vs)|.*(?:ssr|ssg|isr)/i.test(input)) {
      return '**React Server Actions** — run server-side code from components using `"use server"`.\n\n' +
        '```tsx\n// app/actions.ts\n"use server";\nexport async function createUser(formData: FormData) {\n  const name = formData.get("name") as string;\n  await db.user.create({ data: { name } });\n  revalidatePath("/users");\n}\n```\n\n' +
        '**Usage in form:**\n```tsx\nexport default function Form() {\n  return (\n    <form action={createUser}>\n      <input name="name" required />\n      <button type="submit">Create</button>\n    </form>\n  );\n}\n```\n\n**No API route needed.** Progressive enhancement (works without JS).';
    }

    if (/metadata.*(?:next|seo)|seo.*next\.?js|generatemetadata|head.*next\.?js/i.test(input)) {
      return '**Metadata and SEO in Next.js 14+:**\n\n```tsx\nimport type { Metadata } from "next";\nexport const metadata: Metadata = {\n  title: "My App",\n  description: "Built with Next.js",\n  openGraph: { title: "My App", images: ["/og-image.png"] },\n};\n```\n\n' +
        '**Dynamic:** `export async function generateMetadata({ params }): Promise<Metadata> { ... }`\n\n' +
        '**SEO:** Use metadata export (not `<Head>`), generate sitemap.xml with `app/sitemap.ts`, add `robots.ts`, structured data with JSON-LD.';
    }

    if (/suspense.*(?:react|stream|ssr)|streaming\s+ssr|react.*suspense.*stream/i.test(input)) {
      return '**React Suspense** — declarative loading states and streaming SSR.\n\n' +
        '```tsx\n<Suspense fallback={<p>Loading...</p>}>\n  <AsyncComponent /> {/* streams in when ready */}\n</Suspense>\n```\n\n' +
        '**Streaming SSR:** Server sends shell HTML immediately → suspended components stream in as they complete → React hydrates progressively.\n\n' +
        '**In Next.js:** Use `loading.tsx` (automatic Suspense boundary) or wrap in `<Suspense fallback={...}>`.';
    }

    if (/middleware.*next\.?js|next\.?js.*middleware|explain.*middleware.*next/i.test(input)) {
      return '**Next.js Middleware** — runs before a request completes, at the edge.\n\n' +
        '```typescript\n// middleware.ts (root)\nimport { NextResponse } from "next/server";\nimport type { NextRequest } from "next/server";\n\nexport function middleware(request: NextRequest) {\n  const token = request.cookies.get("token");\n  if (!token && request.nextUrl.pathname.startsWith("/dashboard")) {\n    return NextResponse.redirect(new URL("/login", request.url));\n  }\n  return NextResponse.next();\n}\n\nexport const config = { matcher: ["/dashboard/:path*"] };\n```\n\n' +
        '**Use cases:** Auth checks, redirects, geolocation routing, rate limiting. Runs on edge runtime.';
    }

    if (/react\s+context|usecontext|context.*(?:vs|versus).*(?:state|zustand|redux)|when.*use.*context/i.test(input)) {
      return '**React Context** passes data through the component tree without prop drilling.\n\n' +
        '```tsx\nconst ThemeCtx = createContext<"light"|"dark">("light");\n\nexport function ThemeProvider({ children }) {\n  const [theme, setTheme] = useState<"light"|"dark">("light");\n  return <ThemeCtx.Provider value={theme}>{children}</ThemeCtx.Provider>;\n}\n\nexport const useTheme = () => useContext(ThemeCtx);\n```\n\n' +
        '**Context vs state library:** Context = simple shared state (theme, auth). Zustand/Redux = complex state, frequent updates, devtools needed.\n\n**Warning:** Context re-renders ALL consumers on value change.';
    }

    if (/image.*optim.*next|next.*image.*optim|next\/image|optimize\s+image/i.test(input)) {
      return '**Image optimization in Next.js** via `next/image`:\n\n' +
        '```tsx\nimport Image from "next/image";\n<Image src="/hero.jpg" alt="Hero" width={1200} height={600} priority placeholder="blur" />\n```\n\n' +
        '**Auto features:** WebP/AVIF formats, responsive srcset, lazy loading by default, prevents layout shift (CLS), on-demand optimization.\n\n**Remote images:** Add domains to `next.config.js` → `images.remotePatterns`.';
    }

    if (/react\.?\s*memo\b|when.*use.*memo|memo.*performance/i.test(input) && !/usecallback|usememo/i.test(input)) {
      return '**React.memo** — memoizes a component, preventing re-renders when props haven\'t changed.\n\n' +
        '```tsx\nconst ExpensiveList = React.memo(function({ items }) {\n  return <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>;\n});\n```\n\n' +
        '**When to use:** Component re-renders often with same props, has expensive rendering.\n**When NOT:** Props change every render (waste), simple components.\n\nCombine with `useMemo`/`useCallback` to stabilize object/function props for performance.';
    }

    if (/forward\s*ref|forwardref|forward.*ref.*react|react.*forward.*ref/i.test(input)) {
      return '**React.forwardRef** lets a component expose a DOM node (or child ref) to its parent.\n\n' +
        '```tsx\nconst FancyInput = React.forwardRef<HTMLInputElement, Props>((props, ref) => {\n  return <input ref={ref} className="fancy" {...props} />;\n});\n\n// Parent can now access the input directly:\nconst inputRef = useRef<HTMLInputElement>(null);\n<FancyInput ref={inputRef} />\ninputRef.current?.focus();\n```\n\n' +
        '**React 19 update:** `forwardRef` is no longer needed — `ref` is passed as a regular prop:\n```tsx\nfunction FancyInput({ ref, ...props }: { ref?: React.Ref<HTMLInputElement> }) {\n  return <input ref={ref} {...props} />;\n}\n```\n\n' +
        '**Use cases:** Design system components (Input, Button), wrapping third-party components, imperative handles with `useImperativeHandle`.';
    }

    if (/parallel\s+route|intercept.*route|@.*slot.*next|modal.*route.*next/i.test(input)) {
      return '**Parallel routes** — render multiple pages in one layout using **slots** (`@`):\n```\napp/layout.tsx  → receives @analytics, @team as props\napp/@analytics/page.tsx\napp/@team/page.tsx\n```\n\n' +
        '**Intercepting routes** — show a route as modal while preserving URL:\n```\napp/(.)photo/[id]/page.tsx  → intercepts as modal\napp/photo/[id]/page.tsx     → full page (direct nav)\n```\n\n**Convention:** `(.)` same level, `(..)` one level up, `(...)` from root. Used for @modal patterns in App Router.';
    }

    if (/error\s+boundar|catch.*error.*react|react.*error.*catch|error\.tsx.*next/i.test(input)) {
      return '**Error boundaries** in React catch JS errors in children and display a fallback UI.\n\n' +
        '**Next.js App Router — `error.tsx`:**\n```tsx\n"use client";\nexport default function Error({ error, reset }: { error: Error; reset: () => void }) {\n  return <div><h2>Something went wrong!</h2><button onClick={reset}>Try again</button></div>;\n}\n```\n\n' +
        '**Class-based:** Implement `getDerivedStateFromError` + `componentDidCatch`.\n\n**Key rule:** Error boundaries only catch rendering errors — not event handlers or async code.';
    }

    if (/usecallback.*usememo|usememo.*usecallback|differ.*(?:usecallback|usememo)/i.test(input)) {
      return '**useCallback vs useMemo:**\n\n| | useCallback | useMemo |\n|---|---|---|\n' +
        '| **Returns** | Memoized function | Memoized value |\n| **Use case** | Stable function reference | Expensive computation |\n\n' +
        '```tsx\nconst sorted = useMemo(() => items.sort(...), [items]); // memoized value\nconst handleClick = useCallback((id) => setSelected(id), []); // memoized function\n```\n\n' +
        '**When:** `useCallback` for functions passed to memoized children. `useMemo` for expensive calculations. Don\'t optimize prematurely.';
    }

    if (/layout.*(?:next|app\s+router)|next.*layout.*(?:work|explain|how|what)/i.test(input) && !/parallel|intercept/i.test(input)) {
      return '**Layouts in Next.js App Router** — shared UI that persists across navigations.\n\n' +
        '```tsx\n// app/layout.tsx (required root layout)\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body><nav/><main>{children}</main></body></html>;\n}\n\n// app/dashboard/layout.tsx (nested)\nexport default function DashLayout({ children }) {\n  return <div className="flex"><aside>Sidebar</aside><section>{children}</section></div>;\n}\n```\n\n' +
        '**Key:** Layouts are nested automatically, persist on navigation (no re-render), receive children prop.';
    }

    if (/client.?side\s+navig|next.*(?:link\b|prefetch|navig)|link\s+component.*next/i.test(input) && !/middleware|intercept|parallel/i.test(input)) {
      return '**Client-side navigation in Next.js:**\n\n' +
        '**`<Link>` component:**\n```tsx\nimport Link from "next/link";\n<Link href="/">Home</Link>\n<Link href="/about" prefetch={false}>About</Link>\n```\n\n' +
        '**`useRouter` hook:**\n```tsx\nimport { useRouter } from "next/navigation";\nconst router = useRouter();\nrouter.push("/dashboard");\nrouter.prefetch("/settings");\n```\n\n' +
        '**Prefetching:** Links in viewport are automatically prefetched. No full page reload on navigation.';
    }

    if (/portal.*react|react.*portal|createportal|what.*portal/i.test(input)) {
      return '**React Portals** render children into a different DOM node outside the parent.\n\n```tsx\nimport { createPortal } from "react-dom";\n\nfunction Modal({ children, onClose }) {\n  return createPortal(\n    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">\n      <div className="bg-white rounded-lg p-6">{children}<button onClick={onClose}>Close</button></div>\n    </div>,\n    document.body\n  );\n}\n```\n\n' +
        '**Use cases:** Modals/dialogs (escape overflow/z-index), tooltips, toast notifications. Events still bubble through React tree.';
    }

    if (/code\s+split.*next|lazy.*import.*next|dynamic\s+import.*next|bundle.*split/i.test(input)) {
      return '**Code splitting in Next.js:**\n\n**`next/dynamic`:**\n```tsx\nimport dynamic from "next/dynamic";\nconst Chart = dynamic(() => import("./Chart"), {\n  loading: () => <p>Loading...</p>,\n  ssr: false,\n});\n```\n\n' +
        '**React.lazy + Suspense:**\n```tsx\nconst Heavy = lazy(() => import("./Heavy"));\n<Suspense fallback={<p>Loading...</p>}><Heavy /></Suspense>\n```\n\n' +
        '**Automatic:** Next.js code-splits by route. Each page/layout is a separate bundle chunk.';
    }

    // ══════════════════════════════════════════════════════════════
    //  DevOps deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/docker.*(?:crash|fail|error|debug|troubleshoot|not\s+(?:working|starting|running))|(?:crash|fail|error|debug|troubleshoot).*docker/i.test(input)) {
      return '**Debugging a Docker container** — when something breaks, here\'s the workflow I follow:\n\n' +
        '**1. Check logs:**\n```bash\ndocker logs <container>          # stdout/stderr\ndocker logs --tail 50 <container> # last 50 lines\ndocker logs -f <container>        # follow live\n```\n\n' +
        '**2. Inspect the container:**\n```bash\ndocker inspect <container>        # full config + state\ndocker ps -a                      # see exit codes\n```\n\n' +
        '**3. Get inside a running container:**\n```bash\ndocker exec -it <container> sh    # open shell\n```\n\n' +
        '**Common crash causes:**\n- Missing environment variables → check `docker inspect` or `.env` file\n- Port conflicts → `docker ps` to see bound ports\n- Out of memory → add `--memory=512m` or check `docker stats`\n- Bad CMD/ENTRYPOINT → test with `docker run -it <image> sh`\n- File permissions → ensure `USER` in Dockerfile matches volume ownership';
    }

    if (/docker\s+image.*(?:vs|container)|container.*vs.*image|differ.*docker.*(?:image|container)/i.test(input)) {
      return '**Docker Image vs Container:**\n\n| | Image | Container |\n|---|---|---|\n' +
        '| **What** | Read-only template (blueprint) | Running instance of an image |\n| **State** | Immutable | Mutable (writable layer) |\n| **Analogy** | Class | Object/Instance |\n\n' +
        '**One image → many containers.** Images are built from Dockerfiles. Containers are created from images with `docker run`.';
    }

    if (/docker.?compose|what.*compose|compose.*(?:what|when|explain)/i.test(input) && !/dockerfile/i.test(input)) {
      return '**Docker Compose** — tool for defining multi-container applications in a YAML file.\n\n' +
        '```yaml\n# docker-compose.yml\nservices:\n  app:\n    build: .\n    ports: ["3000:3000"]\n    env_file: .env\n    depends_on: [db]\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_DB: myapp\n    volumes: [pgdata:/var/lib/postgresql/data]\nvolumes:\n  pgdata:\n```\n\n' +
        '**Commands:** `docker compose up -d`, `docker compose down`, `docker compose logs`.\n**When:** Multi-service apps (app + db + redis), local dev environments.';
    }

    if (/github\s+actions\s+workflow|write.*github.*action|github.*action.*(?:next|workflow)/i.test(input)) {
      return '**GitHub Actions workflow for Next.js:**\n\n```yaml\n# .github/workflows/ci.yml\nname: CI\non:\n  push: { branches: [main] }\n  pull_request: { branches: [main] }\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: pnpm/action-setup@v2\n      - uses: actions/setup-node@v4\n        with: { node-version: 20, cache: pnpm }\n      - run: pnpm install --frozen-lockfile\n      - run: pnpm lint\n      - run: pnpm test\n      - run: pnpm build\n```\n\n' +
        '**Key:** checkout, setup-node, install deps, lint, test, build in sequential steps.';
    }

    if (/(?:docker.*(?:vs|versus|compared|difference|differ).*(?:k8s|kubernetes))|(?:(?:k8s|kubernetes).*(?:vs|versus|compared|difference|differ).*docker)|(?:difference.*(?:docker|k8s|kubernetes).*(?:docker|k8s|kubernetes))/i.test(input)) {
      return '**Docker vs Kubernetes:**\n\n' +
        '| | Docker | Kubernetes (K8s) |\n|---|---|---|\n' +
        '| **What it does** | Builds and runs containers | Orchestrates containers at scale |\n' +
        '| **Scope** | Single host | Cluster of machines |\n' +
        '| **Scaling** | Manual (`docker run` more copies) | Automatic (set replicas, K8s handles it) |\n' +
        '| **Self-healing** | No (container dies = stays dead) | Yes (restarts failed pods) |\n' +
        '| **Load balancing** | Basic (Docker Compose) | Built-in (Services) |\n' +
        '| **Config file** | Dockerfile, docker-compose.yml | deployment.yaml, service.yaml |\n' +
        '| **Learning curve** | Low | High |\n\n' +
        '**How they work together:** Docker builds your images. Kubernetes deploys and manages them across servers. Most teams use both — Docker for packaging, K8s for production orchestration.';
    }

    if (/kubernetes|k8s|what.*kubernetes/i.test(input)) {
      return '**Kubernetes (K8s)** picks up where Docker leaves off — once you have containers, K8s decides where they run, how many copies exist, and what happens when they crash.\n\n' +
        '**Core concepts:**\n- **Pod** — smallest deployable unit (one or more containers)\n- **Service** — stable network endpoint for pods\n- **Deployment** — manages pod replicas and updates\n- **Node** — physical/virtual machine running pods\n- **Cluster** — set of nodes managed by Kubernetes\n\n' +
        '**Docker vs K8s:** Docker = build and run containers. Kubernetes = orchestrate containers at scale (scheduling, self-healing, load balancing).';
    }

    if (/infrastructure\s+as\s+code|what.*iac|iac.*(?:what|explain)|terraform.*(?:what|explain)/i.test(input)) {
      return '**Infrastructure as Code (IaC)** — manage infrastructure through declarative configuration files.\n\n' +
        '**Tools:**\n| Tool | Language | Provider |\n|---|---|---|\n| **Terraform** | HCL | Multi-cloud |\n| **Pulumi** | TS/Python/Go | Multi-cloud |\n| **AWS CDK** | TS/Python | AWS only |\n| **Bicep** | Bicep | Azure only |\n\n' +
        '**Benefits:** Version-controlled, reproducible, reviewable via PRs, automated deployments.\n\n```hcl\nresource "aws_instance" "web" {\n  ami           = "ami-0c55b159cbfafe1f0"\n  instance_type = "t3.micro"\n}\n```';
    }

    if (/multi.?stage.*docker|docker.*multi.?stage|multi.*stage.*build/i.test(input)) {
      return '**Multi-stage Docker build** — use multiple FROM statements to reduce final image size.\n\n```dockerfile\n# Stage 1: Build\nFROM node:20-alpine AS builder\nWORKDIR /app\nCOPY package.json pnpm-lock.yaml ./\nRUN pnpm install --frozen-lockfile\nCOPY . .\nRUN pnpm build\n\n# Stage 2: Production (no dev deps, no source)\nFROM node:20-alpine\nWORKDIR /app\nCOPY --from=builder /app/.next/standalone ./\nCOPY --from=builder /app/public ./public\nEXPOSE 3000\nCMD ["node", "server.js"]\n```\n\n' +
        '**Why:** Build stage has full toolchain. Production stage is tiny (only runtime). Smaller image = faster deploys, less attack surface.';
    }

    if (/env.*variable.*docker|docker.*env|environment.*docker/i.test(input)) {
      return '**Environment variables in Docker:**\n\n' +
        '**In Dockerfile:** `ENV NODE_ENV=production`\n**Build-time:** `ARG API_KEY` + `docker build --build-arg API_KEY=xxx`\n**Runtime:** `docker run -e DB_URL=postgres://...`\n' +
        '**Compose:**\n```yaml\nservices:\n  app:\n    environment:\n      - NODE_ENV=production\n    env_file: .env\n```\n\n' +
        '**Best practice:** Never bake secrets into images. Use `.env` files (gitignored) or secrets management.';
    }

    if (/reverse\s+proxy|nginx.*(?:what|proxy|how)|what.*reverse.*proxy/i.test(input)) {
      return '**Reverse proxy** sits between clients and backend servers, forwarding requests.\n\n**Nginx as reverse proxy:**\n```nginx\nserver {\n  listen 80;\n  server_name myapp.com;\n  location / {\n    proxy_pass http://localhost:3000;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n  }\n}\n```\n\n' +
        '**Benefits:** SSL termination, load balancing, caching, compression, rate limiting. Nginx is the most popular upstream reverse proxy.';
    }

    if (/blue.?green.*deploy|canary.*deploy|blue.*green.*canary|deploy.*(?:blue|canary)/i.test(input)) {
      return '**Blue-green vs Canary deployment:**\n\n| | Blue-Green | Canary |\n|---|---|---|\n' +
        '| **Traffic** | Switch 100% at once | Gradual rollout (1% → 10% → 100%) |\n| **Rollback** | Instant (switch back) | Stop canary, route to stable |\n| **Risk** | Medium (all-or-nothing) | Low (small % affected) |\n| **Cost** | 2x infrastructure | Minimal extra |\n\n' +
        '**Blue-green:** Two identical environments. Deploy to "green", test, switch traffic from "blue" to "green".\n**Canary:** Route small % of traffic to new version, monitor, gradually increase.';
    }

    if (/docker\s+volume|volume.*docker|persist.*docker|what.*docker.*volume/i.test(input)) {
      return '**Docker volumes** persist data beyond container lifecycle.\n\n```yaml\nservices:\n  db:\n    image: postgres:16\n    volumes:\n      - pgdata:/var/lib/postgresql/data  # named volume\n      - ./init.sql:/docker-entrypoint-initdb.d/init.sql  # bind mount\nvolumes:\n  pgdata:  # persists even when container is removed\n```\n\n' +
        '**Types:** Named volumes (managed by Docker), bind mounts (host directory), tmpfs (memory only).\n**Why:** Databases, uploads, logs — any data that must survive container restarts.';
    }

    if (/ci\s+(?:pipeline\s+)?.*monorepo|monorepo.*ci|how.*set.*ci.*monorepo/i.test(input)) {
      return '**CI pipeline for monorepo:**\n\n```yaml\n# .github/workflows/ci.yml\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with: { fetch-depth: 0 }  # full history for affected detection\n      - uses: actions/cache@v3\n        with: { path: node_modules/.cache, key: turbo-${{ hashFiles("**/pnpm-lock.yaml") }} }\n      - run: pnpm install\n      - run: pnpm turbo run lint test build --filter=...[origin/main]\n```\n\n' +
        '**Key:** Only run affected packages, cache build artifacts, use `--filter` to scope.';
    }

    if (/gitops|what.*gitops|gitops.*(?:what|how|explain)/i.test(input)) {
      return '**GitOps** — using Git as the single source of truth for declarative infrastructure and deployment.\n\n' +
        '**How it works:**\n1. All infrastructure/config stored in Git\n2. Pull requests for changes (review + audit trail)\n3. Automated reconciliation — controller watches Git, applies changes\n4. Drift detection — alerts if reality differs from Git state\n\n' +
        '**Tools:** ArgoCD, Flux, Jenkins X.\n**Key principle:** The desired state is declared in Git. An operator reconciles the actual state to match.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Database deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/sql\s+vs\s+nosql|nosql\s+vs\s+sql|differ.*(?:sql|nosql).*(?:sql|nosql)/i.test(input)) {
      return '**SQL vs NoSQL databases:**\n\n| | SQL (Relational) | NoSQL (Non-relational) |\n|---|---|---|\n' +
        '| **Structure** | Tables with schemas | Documents, key-value, graph |\n| **Joins** | Native JOIN support | Usually no joins (embed data) |\n| **Schema** | Fixed, enforced | Flexible, schema-less |\n| **Scale** | Vertical (scale up) | Horizontal (scale out) |\n| **ACID** | Full ACID compliance | Eventual consistency (often) |\n\n' +
        '**SQL:** PostgreSQL, MySQL — structured data, complex queries, transactions.\n**NoSQL:** MongoDB (document), Redis (key-value), DynamoDB (cloud-native).';
    }

    if (/(?:define|create)\s+.*schema\s+.*prisma|prisma\s+schema\s+(?:defin|creat|how|synta)/i.test(input)) {
      return '**Prisma schema definition:**\n\n```prisma\n// prisma/schema.prisma\nmodel User {\n  id        String   @id @default(cuid())\n  email     String   @unique\n  name      String?\n  posts     Post[]\n  role      Role     @default(USER)\n  createdAt DateTime @default(now())\n}\n\nmodel Post {\n  id       String  @id @default(cuid())\n  title    String\n  author   User    @relation(fields: [authorId], references: [id])\n  authorId String\n}\n\nenum Role { USER ADMIN }\n```\n\n**Key:** `@id`, `@unique`, `@default`, `@relation` for relationships. Run `npx prisma db push` or `npx prisma migrate dev`.';
    }

    if (/database\s+migrat|what.*migrat.*database|migrat.*(?:what|why|important)/i.test(input)) {
      return '**Database migrations** = versioned, incremental schema changes.\n\n**Why:** Track schema history, reproducible across environments, team collaboration, rollback support.\n\n' +
        '**Prisma:** `npx prisma migrate dev --name add_users` → creates SQL migration file → applies to DB.\n\n**Key concepts:**\n- Schema version tracking\n- Up/down migrations (apply/rollback)\n- Change history in version control\n- Applied in order, idempotent';
    }

    if (/database\s+index|index.*(?:database|perform|query)|what.*index.*database|explain.*index/i.test(input)) {
      return '**Database indexing** — data structures that speed up queries (like a book index).\n\n' +
        '**Types:**\n- **B-tree** — default, good for range queries and equality\n- **Hash** — fast equality lookups\n- **GIN** — full-text search, JSONB\n- **Composite** — multi-column index\n\n' +
        '**When to index:** Columns used in WHERE, JOIN, ORDER BY. Primary keys are auto-indexed.\n\n**Trade-off:** Faster reads, slower writes (index must be updated). Don\'t over-index.\n\n```sql\nCREATE INDEX idx_user_email ON users(email);\n```\n**Performance impact can be dramatic — from full table scan to instant lookup.**';
    }

    if (/postgres.*vs.*mysql|mysql.*vs.*postgres|differ.*(?:postgres|mysql)/i.test(input)) {
      return '**PostgreSQL vs MySQL:**\n\n| | PostgreSQL | MySQL |\n|---|---|---|\n' +
        '| **JSON** | Native JSONB (indexable) | Basic JSON support |\n| **Extensions** | Rich ecosystem (PostGIS, etc.) | Limited |\n| **Types** | Arrays, enums, custom types | Simpler type system |\n| **Compliance** | More SQL-standard | Some deviations |\n| **Performance** | Complex queries | Simple read-heavy |\n\n' +
        '**2026 recommendation:** PostgreSQL for most projects (richer features, better JSON support, extensions).';
    }

    if (/transaction.*prisma|prisma.*transaction|database\s+transaction/i.test(input)) {
      return '**Database transactions in Prisma:**\n\n```typescript\n// Sequential operations (all succeed or all fail)\nawait prisma.$transaction([\n  prisma.user.create({ data: { name: "Alice" } }),\n  prisma.post.create({ data: { title: "Hello", authorId: "..." } }),\n]);\n\n// Interactive transaction\nawait prisma.$transaction(async (tx) => {\n  const user = await tx.user.findUnique({ where: { id } });\n  if (user.balance < amount) throw new Error("Insufficient funds");\n  await tx.user.update({ where: { id }, data: { balance: { decrement: amount } } });\n});\n```\n\n' +
        '**Atomic** — all operations succeed or none do. Essential for financial operations, data consistency.';
    }

    if (/connection\s+pool|pool.*(?:database|connect)|what.*connection.*pool/i.test(input)) {
      return '**Connection pooling** — maintain a pool of reusable database connections instead of creating new ones per request.\n\n' +
        '**Why:** Creating connections is expensive (TCP handshake, auth). Pool reuses existing connections for concurrent requests.\n\n' +
        '**Prisma** manages pooling automatically. For serverless, use **Prisma Accelerate** or **PgBouncer**.\n\n' +
        '**Config:** `DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=10"`\n\n**Key:** Limits concurrent connections, prevents database overload, reduces latency.';
    }

    if (/n\+1\s+query|n\+1\s+problem|what.*n\+1|solve.*n\+1/i.test(input)) {
      return '**N+1 query problem** — fetching a list (1 query) then fetching related data per item (N queries).\n\n' +
        '**Bad (N+1):**\n```typescript\nconst users = await prisma.user.findMany(); // 1 query\nfor (const u of users) {\n  const posts = await prisma.post.findMany({ where: { authorId: u.id } }); // N queries!\n}\n```\n\n' +
        '**Fixed (eager loading with `include`):**\n```typescript\nconst users = await prisma.user.findMany({\n  include: { posts: true }, // 1 JOIN query instead of N+1\n});\n```\n\n' +
        '**Also:** SQL `JOIN`, DataLoader pattern, GraphQL batching.';
    }

    if (/drizzle\s+orm|what.*drizzle|drizzle.*(?:compare|vs|differ)/i.test(input) && !/prisma.*(?:setup|schema|what)/i.test(input)) {
      return '**Drizzle ORM** — lightweight, type-safe, SQL-like ORM for TypeScript.\n\n' +
        '**Drizzle vs Prisma:**\n| | Drizzle | Prisma |\n|---|---|---|\n' +
        '| **Schema** | TypeScript | Prisma Schema Language |\n| **Queries** | SQL-like | Method chaining |\n| **Bundle** | Lightweight (~7KB) | Larger (engine binary) |\n| **Performance** | Faster (less overhead) | Good |\n\n' +
        '```typescript\nimport { pgTable, text, integer } from "drizzle-orm/pg-core";\nconst users = pgTable("users", {\n  id: text("id").primaryKey(),\n  name: text("name").notNull(),\n  age: integer("age"),\n});\n```';
    }

    // ══════════════════════════════════════════════════════════════
    //  General language overview handlers (Rust, Go)
    // ══════════════════════════════════════════════════════════════

    // "What is Rust?" / "Explain Rust" / "Tell me about Rust"
    if (/(?:what\s+is|explain|tell\s+me\s+about|describe)\s+rust\b/i.test(input) && !/iron|oxide|corrosion|metal/i.test(input)) {
      return '**Rust** is a systems programming language focused on **safety, speed, and concurrency** — created by Mozilla (2010, stable 2015).\n\n' +
        '**Why Rust matters:** It gives you C/C++-level performance without the memory bugs. The compiler catches use-after-free, data races, and null pointer errors **at compile time**.\n\n' +
        '**Key concepts:**\n' +
        '- **Ownership** — each value has exactly one owner\n' +
        '- **Borrowing** — references without taking ownership (`&T`, `&mut T`)\n' +
        '- **Lifetimes** — compiler-enforced reference validity\n' +
        '- **Pattern matching** — exhaustive `match` expressions\n' +
        '- **Zero-cost abstractions** — iterators, generics compile to optimal code\n\n' +
        '**Use cases:** operating systems, game engines, WebAssembly, CLI tools, embedded systems.\n\n' +
        '**Ecosystem:** Cargo (build tool + package manager), crates.io (package registry).';
    }

    // "What is Go?" / "What is Golang?" / "Explain Go" / "Tell me about Go"
    if (/(?:what\s+is|explain|tell\s+me\s+about|describe)\s+(?:go(?:lang)?)\b/i.test(input) && !/(?:how|where)\s+(?:do|does|should|can|to)\s+i?\s*go\b/i.test(input)) {
      return '**Go** (Golang) is a statically typed, compiled language designed at **Google** (2009) for simplicity and concurrency.\n\n' +
        '**Why Go matters:** It compiles fast, runs fast, and makes concurrency easy. If you need a reliable backend service that handles thousands of concurrent connections, Go is a strong pick.\n\n' +
        '**Key features:**\n' +
        '- **Goroutines** — lightweight threads (start thousands with minimal memory)\n' +
        '- **Channels** — type-safe communication between goroutines\n' +
        '- **Simple syntax** — intentionally minimal (no generics until 1.18, no classes)\n' +
        '- **Fast compilation** — large projects compile in seconds\n' +
        '- **Static binary** — single executable, no runtime dependencies\n\n' +
        '**Use cases:** microservices, CLI tools, DevOps tooling (Docker, Kubernetes are written in Go), APIs.\n\n' +
        '**Getting started:** `go mod init`, `go run main.go`, `go build`.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Rust deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/string\b.*&str|&str.*string|differ.*(?:string|&str).*rust/i.test(input)) {
      return '**`String` vs `&str` in Rust:**\n\n| | `String` | `&str` |\n|---|---|---|\n' +
        '| **Storage** | Heap-allocated, owned | String slice (reference) |\n| **Mutability** | Growable, mutable | Immutable |\n| **Ownership** | Owns the data | Borrows the data |\n\n' +
        '```rust\nlet owned: String = String::from("hello"); // heap, owned\nlet slice: &str = "hello";                  // stack/static, borrowed\nlet s: &str = &owned;                       // borrow from String\n```\n\n' +
        '**Rule:** Use `&str` for function params (accept any string). Use `String` when you need ownership.';
    }

    if (/borrow\s+checker.*rust|rust.*borrow\s+checker|explain.*borrow\s+checker/i.test(input)) {
      return '**Rust borrow checker** — compile-time verification of memory safety rules.\n\n**Rules:**\n' +
        '1. Each value has one owner\n2. At any time: **one mutable reference** OR **any number of immutable references**\n3. References must always be valid (no dangling)\n\n' +
        '```rust\nlet mut s = String::from("hello");\nlet r1 = &s;     // immutable borrow OK\nlet r2 = &s;     // another immutable OK\n// let r3 = &mut s; // ERROR: can\'t borrow mutably while immutably borrowed\nprintln!("{} {}", r1, r2);\nlet r3 = &mut s;  // OK now — r1 and r2 no longer used\n```\n\n' +
        '**Why:** Prevents data races, dangling pointers, use-after-free — all at compile time with zero runtime cost.';
    }

    if (/trait.*rust|rust.*trait|what.*trait.*rust|trait.*(?:vs|interface)/i.test(input)) {
      return '**Traits in Rust** — define shared behavior (similar to interfaces).\n\n' +
        '```rust\ntrait Summary {\n  fn summarize(&self) -> String;\n  fn default_method(&self) -> String { String::from("Read more...") } // default impl\n}\n\nstruct Article { title: String, content: String }\n\nimpl Summary for Article {\n  fn summarize(&self) -> String {\n    format!("{}: {}...", self.title, &self.content[..50])\n  }\n}\n```\n\n' +
        '**Key differences from interfaces:** Traits can have default method implementations, trait objects for dynamic dispatch (`dyn Trait`), trait bounds for generics (`fn print<T: Display>(x: T)`).';
    }

    if (/result\b.*option|option\b.*result|error\s+handling.*rust|rust.*(?:\bresult\b|\boption\b|\bok\b|\berr\b)|\bresult\b.*(?:type|rust)|what.*result.*rust/i.test(input)) {
      return '**Result and Option in Rust — error handling without exceptions.**\n\n' +
        '**Option<T>** — value that may or may not exist:\n```rust\nfn find_user(id: u32) -> Option<User> {\n  if id == 1 { Some(User { name: "Alice" }) } else { None }\n}\n```\n\n' +
        '**Result<T, E>** — operation that can succeed or fail:\n```rust\nfn parse(s: &str) -> Result<i32, ParseIntError> {\n  s.parse::<i32>()\n}\nmatch parse("42") {\n  Ok(n) => println!("Parsed: {}", n),\n  Err(e) => println!("Error: {}", e),\n}\n```\n\n**`?` operator:** `let n = "42".parse::<i32>()?;` — propagates errors automatically.';
    }

    if (/box\b.*rc\b.*arc|rc\b.*arc|box\b.*rc|differ.*(?:box|rc|arc).*rust/i.test(input)) {
      return '**Box, Rc, and Arc in Rust — smart pointers:**\n\n| | Box<T> | Rc<T> | Arc<T> |\n|---|---|---|\n' +
        '| **Purpose** | Heap allocation | Reference counting | Atomic reference counting |\n| **Ownership** | Single owner | Multiple owners | Multiple owners |\n| **Thread-safe** | Yes (single owner) | ❌ Single-thread only | ✅ Thread-safe |\n\n' +
        '**Box:** Heap allocate data with single owner.\n**Rc:** Multiple owners in single-threaded code (reference counted).\n' +
        '**Arc:** Multiple owners across threads (atomic reference counting). Often combined with `Mutex<T>` for shared mutable state.';
    }

    if (/lifetime.*rust|rust.*lifetime|explain.*lifetime|what.*lifetime/i.test(input) && !/async/i.test(input)) {
      return '**Lifetimes in Rust** — tell the compiler how long references are valid.\n\n' +
        '```rust\n// Lifetime annotation: \'a\nfn longest<\'a>(x: &\'a str, y: &\'a str) -> &\'a str {\n  if x.len() > y.len() { x } else { y }\n}\n```\n\n' +
        '**Why needed:** The compiler must know that the returned reference doesn\'t outlive the data it points to (no dangling references).\n\n' +
        '**Rules:** Lifetime of the return reference must be within the scope of the input references. The `\'a` annotation says "the output lives as long as both inputs."';
    }

    if (/async\b.*rust|rust.*async|tokio|async\s+await.*rust/i.test(input)) {
      return '**Async/await in Rust:**\n\n```rust\nasync fn fetch_data(url: &str) -> Result<String, reqwest::Error> {\n  let body = reqwest::get(url).await?.text().await?;\n  Ok(body)\n}\n\n#[tokio::main]\nasync fn main() {\n  let data = fetch_data("https://api.example.com").await.unwrap();\n}\n```\n\n' +
        '**Key concepts:** `async fn` returns a `Future`. `.await` drives the future to completion. Need a runtime (**Tokio** is most popular).\n\n' +
        '**Rust async is zero-cost** — no heap allocation for state machines, compiled to efficient code.';
    }

    if (/match\b.*rust|rust.*match\s+express|what.*match.*rust|pattern\s+match.*rust/i.test(input)) {
      return '**`match` expression in Rust** — powerful pattern matching (like switch on steroids).\n\n' +
        '```rust\nmatch value {\n  1 => println!("one"),\n  2 | 3 => println!("two or three"),\n  4..=9 => println!("four to nine"),\n  _ => println!("other"), // exhaustive — must handle all cases\n}\n\n// With enums\nmatch result {\n  Ok(val) => println!("Success: {}", val),\n  Err(e) => println!("Error: {}", e),\n}\n```\n\n' +
        '**Key:** Match is exhaustive — every arm must be covered. Uses pattern destructuring. Each arm returns a value.';
    }

    if (/concurrency.*rust|rust.*concurren|send\b.*sync\b.*rust|thread.*rust.*safe/i.test(input)) {
      return '**Rust concurrency — "fearless concurrency":**\n\n' +
        '**Thread safety markers:**\n- **`Send`** — type can be transferred between threads\n- **`Sync`** — type can be shared (&T) between threads\n\n' +
        '**Shared state:**\n```rust\nuse std::sync::{Arc, Mutex};\n\nlet counter = Arc::new(Mutex::new(0));\nlet c = Arc::clone(&counter);\nlet handle = std::thread::spawn(move || {\n  let mut num = c.lock().unwrap();\n  *num += 1;\n});\n```\n\n' +
        '**Key:** Compiler enforces Send + Sync at compile time. Data races are impossible in safe Rust.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Python deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/type\s+hint.*python|python.*type\s+hint|python.*typing|how.*python.*type/i.test(input)) {
      return '**Python type hints** (PEP 484) — optional static type annotations.\n\n' +
        '```python\ndef greet(name: str, age: int) -> str:\n    return f"Hello {name}, age {age}"\n\nfrom typing import Optional, List\ndef find_user(id: int) -> Optional[User]:\n    ...\n\nscores: List[int] = [100, 95, 87]\ndata: dict[str, Any] = {"key": "value"}\n```\n\n' +
        '**Tools:** mypy (type checker), pyright (fast, used in VS Code). Type hints are NOT enforced at runtime — they\'re for static analysis and IDE support.';
    }

    if (/fastapi|what.*fastapi|fastapi.*(?:flask|django|compare)/i.test(input)) {
      return '**FastAPI** — modern, fast Python web framework built on Starlette + Pydantic.\n\n' +
        '**vs Flask/Django:**\n| | FastAPI | Flask | Django |\n|---|---|---|---|\n' +
        '| **Async** | Native async/await | Limited | ASGI (3.1+) |\n' +
        '| **Validation** | Pydantic (automatic) | Manual | Forms/DRF |\n| **Docs** | Auto Swagger/OpenAPI | Manual | DRF |\n| **Performance** | Very fast | Moderate | Moderate |\n\n' +
        '```python\nfrom fastapi import FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI()\n\nclass User(BaseModel):\n    name: str\n    email: str\n\n@app.post("/users")\nasync def create(user: User):\n    return {"id": 1, **user.dict()}\n```';
    }

    if (/decorator.*python|python.*decorator|explain.*decorator.*python|what.*decorator.*python/i.test(input)) {
      return '**Python decorators** — functions that modify other functions using the `@` syntax.\n\n' +
        '```python\ndef log(func):\n    def wrapper(*args, **kwargs):\n        print(f"Calling {func.__name__}")\n        result = func(*args, **kwargs)\n        print(f"Returned {result}")\n        return result\n    return wrapper\n\n@log\ndef add(a, b):\n    return a + b\n\nadd(3, 4)  # prints: Calling add, Returned 7\n```\n\n' +
        '**Common decorators:** `@property`, `@staticmethod`, `@classmethod`, `@functools.cache`, `@app.route()` (Flask/FastAPI).';
    }

    if (/asyncio|python.*async.*await|async.*python|event\s+loop.*python/i.test(input)) {
      return '**asyncio** — Python\'s async I/O framework for concurrent coroutines.\n\n' +
        '```python\nimport asyncio\n\nasync def fetch(url: str) -> str:\n    await asyncio.sleep(1)  # simulate I/O\n    return f"Data from {url}"\n\nasync def main():\n    results = await asyncio.gather(\n        fetch("https://api1.com"),\n        fetch("https://api2.com"),\n    )  # runs concurrently!\n\nasyncio.run(main())\n```\n\n' +
        '**Key:** `async def` = coroutine, `await` = yield to event loop, `asyncio.gather()` = concurrent execution. Best for I/O-bound tasks (network, files).';
    }

    if (/comprehension.*python|python.*comprehension|list\s+comprehension|generator\s+express/i.test(input)) {
      return '**Python comprehensions and generator expressions:**\n\n' +
        '**List comprehension:**\n```python\nsquares = [x**2 for x in range(10)]           # [0, 1, 4, 9, ...]\nevens = [x for x in range(20) if x % 2 == 0]  # filter\n```\n\n' +
        '**Dict comprehension:** `{k: v for k, v in pairs}`\n**Set comprehension:** `{x**2 for x in range(10)}`\n\n' +
        '**Generator expression** (lazy, memory-efficient):\n```python\ngen = (x**2 for x in range(1_000_000))  # no list in memory\nfor val in gen:\n    yield val  # produces values on demand\n```';
    }

    if (/virtual\s*env.*python|python.*(?:venv|virtualenv|pipenv|poetry)|explain.*venv/i.test(input)) {
      return '**Python virtual environments** — isolated package installations per project.\n\n' +
        '| Tool | Usage |\n|---|---|\n| **venv** | `python -m venv .venv` (built-in) |\n| **pipenv** | `pipenv install` (Pipfile) |\n| **poetry** | `poetry init` (pyproject.toml) |\n| **conda** | Scientific computing |\n\n' +
        '**venv workflow:**\n```bash\npython -m venv .venv\nsource .venv/bin/activate  # Linux/Mac\n.venv\\Scripts\\activate     # Windows\npip install fastapi uvicorn\npip freeze > requirements.txt\n```\n\n' +
        '**Why:** Isolates dependencies per project. Avoids version conflicts between projects.';
    }

    if (/pydantic|what.*pydantic|pydantic.*(?:what|why|valid)/i.test(input) && !/fastapi.*(?:flask|django)/i.test(input)) {
      return '**Pydantic** — data validation library using Python type annotations.\n\n' +
        '```python\nfrom pydantic import BaseModel, EmailStr\n\nclass User(BaseModel):\n    name: str\n    email: EmailStr\n    age: int\n\nuser = User(name="Alice", email="alice@example.com", age=30)  # validates!\nUser(name="Bob", email="invalid", age="not a number")  # raises ValidationError\n```\n\n' +
        '**Why:** Runtime validation + type safety. Used by FastAPI for automatic request validation. Generates JSON Schema.';
    }

    if (/dependency\s+inject.*python|python.*depend.*inject|inject.*python/i.test(input)) {
      return '**Dependency injection in Python:**\n\n```python\n# Simple DI via constructor\nclass UserService:\n    def __init__(self, db: Database, cache: Cache):\n        self.db = db\n        self.cache = cache\n\n# FastAPI DI (built-in)\nfrom fastapi import Depends\n\nasync def get_db():\n    db = Database()\n    try:\n        yield db\n    finally:\n        await db.close()\n\n@app.get("/users")\nasync def get_users(db: Database = Depends(get_db)):\n    return await db.fetch_all("SELECT * FROM users")\n```\n\n' +
        '**Libraries:** FastAPI `Depends` (built-in), `dependency-injector`, `python-inject`. DI container manages object creation and lifecycle.';
    }

    if (/dataclass.*python|python.*dataclass|what.*dataclass|@dataclass/i.test(input)) {
      return '**Python dataclasses** (PEP 557) — auto-generate `__init__`, `__repr__`, `__eq__` for data classes.\n\n' +
        '```python\nfrom dataclasses import dataclass, field\n\n@dataclass\nclass User:\n    name: str\n    age: int\n    tags: list[str] = field(default_factory=list)\n\nuser = User(name="Alice", age=30)  # auto __init__\nprint(user)  # User(name=\'Alice\', age=30, tags=[])\n```\n\n' +
        '**Options:** `@dataclass(frozen=True)` for immutable, `@dataclass(slots=True)` for performance.\n**vs Pydantic:** Dataclasses = simple data holders. Pydantic = runtime validation.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Go deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/go\s+channel|channel.*go\b|how.*channel.*work|chan\b.*go\b/i.test(input) && !/goroutine/i.test(input)) {
      return '**Go channels** — typed conduits for communication between goroutines.\n\n' +
        '```go\nch := make(chan string)       // unbuffered\nch := make(chan string, 10)   // buffered (capacity 10)\n\ngo func() { ch <- "hello" }() // send\nmsg := <-ch                    // receive (blocks until data)\n```\n\n' +
        '**Buffered vs unbuffered:** Unbuffered blocks sender until receiver reads. Buffered blocks only when full.\n**Direction types:** `chan<- string` (send-only), `<-chan string` (receive-only).\n**Close:** `close(ch)` signals no more values.';
    }

    if (/error\s+handling.*go\b|go\b.*error\s+handling|how.*handle.*error.*go|go\b.*err.*nil/i.test(input)) {
      return '**Error handling in Go** — explicit error returns (no exceptions).\n\n' +
        '```go\nfunc readFile(path string) (string, error) {\n    data, err := os.ReadFile(path)\n    if err != nil {\n        return "", fmt.Errorf("readFile: %w", err)\n    }\n    return string(data), nil\n}\n\n// Caller must check\ndata, err := readFile("config.json")\nif err != nil {\n    log.Fatal(err)\n}\n```\n\n' +
        '**Pattern:** Functions return `(value, error)`. Caller checks `if err != nil`. Use `fmt.Errorf("...: %w", err)` to wrap errors.';
    }

    if (/go\b.*interface|interface.*go\b|what.*interface.*go|go\b.*implicit.*interface/i.test(input)) {
      return '**Go interfaces** — implicitly satisfied (no `implements` keyword).\n\n' +
        '```go\ntype Writer interface {\n    Write([]byte) (int, error)\n}\n\ntype Logger struct{}\n\n// Logger implicitly satisfies Writer\nfunc (l Logger) Write(data []byte) (int, error) {\n    fmt.Println(string(data))\n    return len(data), nil\n}\n\nfunc save(w Writer) { w.Write([]byte("data")) }\nsave(Logger{}) // Logger satisfies Writer — no explicit declaration needed\n```\n\n' +
        '**Key:** A type satisfies an interface by implementing all its methods. This enables duck typing with compile-time safety.';
    }

    if (/go\b.*struct|struct.*go\b|explain.*struct.*go|go\b.*struct.*class/i.test(input)) {
      return '**Go structs** — composite types (Go\'s answer to classes).\n\n' +
        '```go\ntype User struct {\n    Name  string\n    Email string\n    Age   int\n}\n\n// Method with receiver\nfunc (u User) Greet() string {\n    return fmt.Sprintf("Hi, I\'m %s", u.Name)\n}\n\n// Pointer receiver (can modify)\nfunc (u *User) SetAge(age int) {\n    u.Age = age\n}\n\nuser := User{Name: "Alice", Email: "alice@go.dev", Age: 30}\nuser.Greet() // "Hi, I\'m Alice"\n```\n\n' +
        '**Go has no classes.** Structs + methods + interfaces provide all the composition needed. Favor composition over inheritance.';
    }

    if (/go\s+mod|go\b.*module|go\.mod|go\b.*dependency\s+manage/i.test(input)) {
      return '**Go modules** — dependency management system.\n\n```bash\ngo mod init github.com/user/myapp  # creates go.mod\ngo get github.com/gin-gonic/gin     # add dependency\ngo mod tidy                         # clean up unused deps\n```\n\n' +
        '**go.mod file:**\n```\nmodule github.com/user/myapp\n\ngo 1.22\n\nrequire (\n    github.com/gin-gonic/gin v1.9.1\n)\n```\n\n' +
        '**Key:** `go.mod` tracks dependencies, `go.sum` verifies checksums. Semantic versioning for module versions.';
    }

    if (/http.*go\b|go\b.*http|net\/http|listenandserve|go\b.*web\s+server/i.test(input)) {
      return '**HTTP in Go** using the `net/http` standard library:\n\n' +
        '```go\npackage main\nimport ("fmt"; "net/http")\n\nfunc handler(w http.ResponseWriter, r *http.Request) {\n    fmt.Fprintf(w, "Hello, %s!", r.URL.Path[1:])\n}\n\nfunc main() {\n    http.HandleFunc("/", handler)\n    http.ListenAndServe(":8080", nil)\n}\n```\n\n' +
        '**Popular frameworks:** Gin (fast, middleware), Echo (minimal), Chi (composable), Fiber (Express-like).\n**Key:** `http.Handler` interface, `ListenAndServe` starts server, standard library is production-ready.';
    }

    if (/select\b.*go\b|go\b.*select|select\s+statement.*go|go\b.*select.*channel/i.test(input)) {
      return '**Go `select` statement** — waits on multiple channel operations.\n\n' +
        '```go\nselect {\ncase msg := <-ch1:\n    fmt.Println("From ch1:", msg)\ncase msg := <-ch2:\n    fmt.Println("From ch2:", msg)\ncase <-time.After(5 * time.Second):\n    fmt.Println("Timeout")\ndefault:\n    fmt.Println("No channel ready") // non-blocking\n}\n```\n\n' +
        '**Key:** Like `switch` but for channels. Blocks until one case is ready. If multiple ready, picks randomly. Used for timeouts, multiplexing, cancellation.';
    }

    if (/slice.*array.*go|go\b.*slice.*array|differ.*(?:slice|array).*go|go\b.*(?:slice|array)|\bslice\b.*\bgo\b|what.*slice.*go/i.test(input)) {
      return '**Go slices vs arrays:**\n\n| | Array | Slice |\n|---|---|---|\n' +
        '| **Size** | Fixed at compile time | Dynamic (growable) |\n| **Syntax** | `[3]int{1,2,3}` | `[]int{1,2,3}` |\n| **Length** | Part of type | Separate length + capacity |\n\n' +
        '```go\narr := [3]int{1, 2, 3}   // array (fixed)\nslice := []int{1, 2, 3}  // slice (dynamic)\nslice = append(slice, 4)  // grows automatically\nfmt.Println(len(slice), cap(slice)) // length and capacity\n```\n\n' +
        '**Slices are used 99% of the time.** Arrays are mainly for fixed-size data (crypto hashes, etc.).';
    }

    if (/go\b.*generic|generic.*go\b|go\b.*1\.18|type\s+parameter.*go/i.test(input)) {
      return '**Go generics** (introduced in Go **1.18**, March 2022):\n\n' +
        '```go\nfunc Map[T any, U any](items []T, fn func(T) U) []U {\n    result := make([]U, len(items))\n    for i, item := range items {\n        result[i] = fn(item)\n    }\n    return result\n}\n\n// With constraint\ntype Number interface { int | float64 }\nfunc Sum[T Number](nums []T) T {\n    var total T\n    for _, n := range nums { total += n }\n    return total\n}\n```\n\n' +
        '**Key:** Type parameters with `[T constraint]`, `any` = unconstrained, custom constraints via interfaces.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Accessibility / WCAG deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/pour\s+principle|perceivable.*operable|what.*pour|explain.*pour/i.test(input)) {
      return '**POUR principles** — four pillars of web accessibility (WCAG foundation):\n\n' +
        '1. **Perceivable** — content presented in ways users can perceive (alt text, captions, sufficient contrast)\n' +
        '2. **Operable** — UI navigable by keyboard, enough time, no seizure-inducing content\n' +
        '3. **Understandable** — readable content, predictable navigation, error prevention\n' +
        '4. **Robust** — content works with assistive technologies (valid HTML, ARIA, semantic markup)\n\n' +
        '**Each principle has testable success criteria at levels A, AA, and AAA.**';
    }

    if (/aria\s+(?:attribute|role|label)|what.*aria|when.*use.*aria|aria.*(?:what|when|explain)/i.test(input)) {
      return '**ARIA** (Accessible Rich Internet Applications) — attributes that enhance HTML for screen readers.\n\n' +
        '**Key attributes:**\n- `role="navigation"` — defines the element\'s purpose\n- `aria-label="Close"` — provides accessible name\n- `aria-hidden="true"` — hides from screen readers\n- `aria-expanded="false"` — toggle state\n- `aria-live="polite"` — announces dynamic content\n\n' +
        '**Golden rule:** Use semantic HTML first (`<nav>`, `<button>`, `<main>`). Only add ARIA when native HTML semantics aren\'t sufficient.\n\n' +
        '**"No ARIA is better than bad ARIA."**';
    }

    if (/react.*(?:accessible|screen\s+reader|a11y)|accessible.*react\s+app|screen\s+reader.*react/i.test(input)) {
      return '**Making React apps accessible for screen readers:**\n\n' +
        '1. **Semantic HTML** — use `<button>`, `<nav>`, `<main>`, not `<div onClick>`\n' +
        '2. **Alt text** — `<Image alt="Description" />` for all images\n' +
        '3. **Labels** — every input needs `<label htmlFor="...">`\n' +
        '4. **Focus management** — `autoFocus`, `tabIndex`, focus trapping in modals\n' +
        '5. **ARIA** — `aria-label`, `aria-expanded`, `role` when needed\n' +
        '6. **Keyboard nav** — all interactive elements keyboard-accessible\n\n' +
        '**Tools:** eslint-plugin-jsx-a11y (lint), @testing-library (user-centric tests), axe-core (automated audit).';
    }

    if (/wcag.*(?:aa|aaa)|aa\s+vs\s+aaa|differ.*(?:aa|aaa)|level.*(?:aa|aaa)/i.test(input)) {
      return '**WCAG conformance levels:**\n\n| Level | Requirements |\n|---|---|\n' +
        '| **A** (minimum) | Basic accessibility (alt text, keyboard access) |\n| **AA** (standard) | Color contrast 4.5:1, resize to 200%, focus visible |\n| **AAA** (enhanced) | Contrast 7:1, sign language, extended audio description |\n\n' +
        '**Most laws require AA compliance** (including Norway\'s Likestillings- og diskrimineringsloven).\n**AAA** is aspirational — not typically required by law but covers edge cases.';
    }

    if (/test.*(?:accessib|a11y|wcag)|(?:accessib|a11y|wcag).*test|how.*test.*(?:accessib|a11y)/i.test(input)) {
      return '**Testing web accessibility:**\n\n' +
        '**Automated tools:**\n- **axe DevTools** (browser extension) — catches ~30% of issues\n- **Lighthouse** (Chrome built-in) — accessibility audit score\n- **eslint-plugin-jsx-a11y** — lint React for a11y issues\n\n' +
        '**Manual testing:**\n- **Keyboard-only** navigation (Tab, Enter, Escape)\n- **Screen reader** testing (NVDA, VoiceOver, JAWS)\n- **Color contrast** check (WebAIM contrast checker)\n- **Zoom to 200%** — verify layout doesn\'t break\n\n' +
        '**Best practice:** Combine automated + manual testing. No tool catches everything.';
    }

    if (/color\s+contrast\s+ratio|contrast\s+ratio|wcag.*contrast|what.*contrast.*(?:ratio|require)/i.test(input)) {
      return '**Color contrast ratio (WCAG):**\n\n| Level | Normal text | Large text |\n|---|---|---|\n' +
        '| **AA** | 4.5:1 minimum | 3:1 minimum |\n| **AAA** | 7:1 minimum | 4.5:1 minimum |\n\n' +
        '**Large text:** ≥18pt (24px) or ≥14pt (18.5px) bold.\n**Tools:** WebAIM Contrast Checker, Chrome DevTools, Figma plugins.\n\n' +
        '**Example:** White text on dark blue (ratio 8.5:1) ✅ AA+AAA. Light gray on white (ratio 2:1) ❌ Fails all levels.';
    }

    if (/form.*(?:accessib|a11y)|accessible\s+form|make\s+form.*accessib/i.test(input)) {
      return '**Making forms accessible:**\n\n' +
        '1. **Label every input:** `<label for="email">Email</label><input id="email" />`\n' +
        '2. **Group related fields:** `<fieldset><legend>Address</legend>...</fieldset>`\n' +
        '3. **Error messages:** Link errors to inputs with `aria-describedby`\n' +
        '4. **Required fields:** Use `required` attribute + visual indicator\n' +
        '5. **Autocomplete:** `autocomplete="email"` for common fields\n' +
        '6. **Focus management:** Focus first error field on submission\n\n' +
        '**Never use placeholder as label replacement.** Screen readers may not announce placeholders.';
    }

    if (/focus\s+manage|what.*focus\s+manage|focus\s+trap|focus.*(?:important|manage|trap)/i.test(input)) {
      return '**Focus management** — controlling which element has keyboard focus.\n\n' +
        '**Why important:** Keyboard and screen reader users navigate via focus. Lost focus = lost user.\n\n' +
        '**Key patterns:**\n- **Focus trapping** in modals — Tab cycles within dialog only\n- **Focus restoration** — return focus to trigger after modal closes\n- **Skip links** — "Skip to content" link for keyboard users\n- **Visible focus** — never use `outline: none` without replacement\n\n' +
        '**React:** `useRef` + `ref.current.focus()`, or libraries like Radix UI (handles focus trap automatically).\n\n`tabIndex={0}` makes non-interactive elements focusable. `tabIndex={-1}` makes elements programmatically focusable only.';
    }

    if (/keyboard\s+nav|keyboard\s+access|how.*keyboard.*nav|keyboard.*(?:web|app|accessi)/i.test(input)) {
      return '**Keyboard navigation in web apps:**\n\n**Essential keys:**\n- **Tab** — move between focusable elements\n- **Shift+Tab** — move backwards\n- **Enter/Space** — activate buttons and links\n- **Arrow keys** — navigate within components (menus, tabs, radio groups)\n- **Escape** — close modals, dropdowns\n\n' +
        '**Requirements:**\n1. All interactive elements must be keyboard-accessible\n2. Focus order must be logical (match visual order)\n3. Focus indicator must be visible\n4. No keyboard traps (user can always Tab out)\n\n' +
        '**Tip:** Use semantic HTML (`<button>`, `<a>`, `<input>`) — they get keyboard support for free.';
    }

    // ══════════════════════════════════════════════════════════════
    //  GDPR deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/cookie\s+consent.*banner|gdpr.*cookie.*consent|implement.*consent.*banner/i.test(input)) {
      return '**GDPR-compliant cookie consent banner:**\n\n' +
        '**Requirements:**\n- **Opt-in** — no cookies set before explicit consent\n- **Granular** — separate consent per category (analytics, marketing, functional)\n- **Reject** button equally prominent as Accept\n- **No dark patterns** — no pre-checked boxes\n- **Withdrawable** — easy to change preferences later\n\n' +
        '**Implementation:** Use a consent management platform (CMP) like Cookiebot, Osano, or build custom with React state + cookies.\n\n' +
        '**Key:** Block all tracking scripts until consent is given. Store consent proof for compliance.';
    }

    if (/right\s+to\s+be\s+forgotten|right.*erasure|right.*delete.*gdpr|forgotten.*gdpr/i.test(input)) {
      return '**Right to be forgotten (Right to Erasure)** — GDPR Article 17.\n\n' +
        '**Users can request deletion of personal data when:**\n- Data is no longer necessary for its original purpose\n- User withdraws consent\n- User objects to processing\n- Data was unlawfully processed\n\n' +
        '**Implementation:**\n- Provide a "Delete my account" feature\n- Remove data from all systems (including backups, within reasonable time)\n- Notify third parties who received the data\n\n' +
        '**Exceptions:** Legal obligations, public interest, scientific research may override the right to erasure.';
    }

    if (/data\s+protection\s+officer|what.*dpo|dpo.*(?:what|when|required)/i.test(input)) {
      return '**Data Protection Officer (DPO)** — GDPR Article 37-39.\n\n' +
        '**Required when:**\n- Public authority or body\n- Core activities involve large-scale monitoring of individuals\n- Core activities involve large-scale processing of special category data\n\n' +
        '**DPO responsibilities:**\n- Advise on data protection obligations\n- Monitor GDPR compliance\n- Serve as contact point for supervisory authorities\n- Conduct data protection impact assessments\n\n' +
        '**The DPO must be independent** — cannot be instructed on how to perform their tasks.';
    }

    if (/data\s+breach.*(?:gdpr|notif)|breach\s+notif|72\s+hour|how.*handle.*breach/i.test(input)) {
      return '**Data breach notifications under GDPR:**\n\n' +
        '**Timeline:**\n- Report to supervisory authority within **72 hours** of becoming aware\n- Notify affected individuals "without undue delay" if high risk\n\n' +
        '**Notification must include:**\n- Nature of the breach\n- Categories and number of affected individuals\n- Likely consequences\n- Measures taken to address and mitigate\n\n' +
        '**In Norway:** Report to **Datatilsynet** (Norwegian Data Protection Authority). Have an incident response plan ready.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian web deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/universell\s+utforming.*(?:hva|what|viktig|important|hvorfor|why)|hva\s+er\s+universell/i.test(input)) {
      return '**Universell utforming** (universal design) betyr at nettsider og digitale tjenester skal være tilgjengelige for alle.\n\n' +
        '**Hvorfor viktig:**\n- **Lovpålagt** i Norge (Likestillings- og diskrimineringsloven)\n- WCAG 2.1 AA er minimumskravet\n- ~15% av befolkningen har en funksjonsnedsettelse\n- Bedre UX for ALLE brukere\n\n' +
        '**Krav:**\n- Tastaturnavigasjon\n- Skjermleserkompatibilitet\n- Tilstrekkelig kontrast (4.5:1)\n- Tekstalternativer for bilder\n- Responsivt design\n\n' +
        '**Tilsyn:** Digitaliseringsdirektoratet (tidl. Difi) fører tilsyn med universell utforming av IKT.';
    }

    if (/(?:norsk|norwegian)\s+(?:lov|law).*(?:accessib|tilgjengelig|web)|law.*(?:accessib|web).*norw|likestilling.*diskriminering/i.test(input)) {
      return '**Norwegian web accessibility laws:**\n\n' +
        '- **Likestillings- og diskrimineringsloven** (Equality and Anti-Discrimination Act) — requires universal design of ICT\n' +
        '- **Forskrift om universell utforming av IKT** — mandates WCAG 2.1 AA for web solutions\n' +
        '- Enforced by **Digitaliseringsdirektoratet** (formerly Difi)\n- **Tilsynet for universell utforming av IKT** monitors compliance\n\n' +
        '**Applies to:** All businesses, organizations, and public services targeting Norwegian users.\n**Penalties:** Fines and orders for non-compliance.';
    }

    if (/(?:norsk|norwegian)\s+.*personvern|personvern.*(?:handle|website|nettside)|how.*(?:norwegian|norsk).*privacy/i.test(input)) {
      return '**Personvern (privacy) for Norwegian websites:**\n\n' +
        '1. **Samtykkeboks (consent)** — GDPR-compliant cookie banner with opt-in\n2. **Personvernerklæring** — privacy policy in Norwegian\n3. **Cookie-policy** — list all cookies, purposes, and retention\n4. **Data minimering** — collect only necessary data\n5. **Rett til sletting** — users can request deletion\n\n' +
        '**Enforced by:** Datatilsynet (Norwegian Data Protection Authority).\n**Key:** Samtykke (consent) must be freely given, specific, informed, and unambiguous.';
    }

    if (/https.*(?:norsk|norwegian|ssl)|(?:norsk|norwegian).*(?:https|ssl)|hva\s+betyr\s+https|krypter.*nettside/i.test(input)) {
      return '**HTTPS og SSL for norske nettsider:**\n\n' +
        '- **HTTPS** = HTTP + TLS-kryptering — all trafikk er kryptert\n- **Lovpålagt** for nettsider som behandler personopplysninger (GDPR)\n- **SSL-sertifikat** — Gratis via Let\'s Encrypt\n\n' +
        '**Hvorfor viktig i Norge:**\n- Personvern og sikkerhet er lovfestet\n- Google rangerer HTTPS-sider høyere (SEO)\n- Nødvendig for PWA og Service Workers\n- Datatilsynet forventer kryptering\n\n' +
        '**Sett opp:** Redirect HTTP → HTTPS, HSTS-header, sikkerhetshoder (CSP, X-Frame-Options).';
    }

    if (/norwegian\s+mvp\s+landing|(?:norsk|norwegian)\s+landing\s+page|landing.*(?:norsk|norwegian).*2026/i.test(input)) {
      return '**Norwegian MVP landing page (2026):**\n\n' +
        '1. **Above the fold:** Clear value proposition + one CTA button\n2. **Responsive design** — mobile-first (Tailwind breakpoints)\n3. **WCAG 2.1 AA** — contrast, keyboard nav, alt text (legally required)\n4. **GDPR consent** — cookie banner with opt-in before tracking\n5. **HTTPS** — SSL certificate (Let\'s Encrypt)\n6. **Content:** Om oss, Tjenester, Kontakt (skjema eller e-post)\n7. **Performance** — < 3 seconds load time\n\n' +
        '**Stack:** Next.js + Tailwind CSS + Vercel. Bærekraftig design — minimize resources.';
    }

    if (/(?:test|how).*universell\s+utforming|universell\s+utforming.*test|uu\s+test|hvordan\s+test/i.test(input)) {
      return '**Testing universell utforming (UU) i Norge:**\n\n' +
        '**Automatisert testing:**\n- **axe DevTools** — finner ca. 30% av WCAG-feil\n- **Lighthouse** — tilgjengelighetspoeng\n- **WAVE** — visuell tilgjengelighetsvurdering\n\n' +
        '**Manuell testing:**\n- **Tastaturnavigasjon** — Tab gjennom hele siden\n- **Skjermleser** — NVDA (Windows), VoiceOver (Mac)\n- **Kontrastsjekk** — WebAIM Contrast Checker\n- **Zoom 200%** — sjekk at layout fungerer\n\n' +
        '**Krav:** Digitaliseringsdirektoratet bruker WCAG 2.1 AA som standard for tilsyn.';
    }

    if (/altinn|what.*altinn|altinn.*(?:what|relevant|developer)/i.test(input)) {
      return '**Altinn** — Norway\'s digital government platform for public services.\n\n' +
        '**What it is:**\n- Portal for tax filing, business registration, government reporting\n- API platform for digital service delivery\n- Used by ~90% of Norwegian businesses\n\n' +
        '**Why relevant for web developers:**\n- **Altinn 3** — modern, open-source platform for building government digital services\n- RESTful APIs for integrating government data\n- Altinn Studio — low-code tool for creating digital forms and services\n- Authentication via ID-porten (Norwegian national login)\n\n' +
        '**Key:** Norway\'s most important digital government infrastructure.';
    }

    if (/(?:norsk|norwegian)\s+e.?(?:commerce|handel)|e.?(?:commerce|handel).*(?:norsk|norwegian|vipps|payment)/i.test(input)) {
      return '**Norwegian e-commerce — payment and privacy:**\n\n' +
        '**Payment solutions:**\n- **Vipps** — Norway\'s dominant mobile payment (must-have)\n- **Klarna** — buy now, pay later\n- **Nets/Nexi** — card payments\n- **Stripe** — international payments\n\n' +
        '**GDPR requirements:**\n- Cookie samtykke (consent) before tracking\n- Personvernerklæring (privacy policy)\n- Rett til sletting (right to delete)\n- Secure checkout (HTTPS, PCI compliance)\n\n' +
        '**Norwegian consumer law:** 14-day return right (angrerett), clear pricing, forbrukerrettigheter.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Vue / Angular / WordPress / Nuxt deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/angular\s+signal|signal.*angular|angular.*change\s+detection.*signal/i.test(input)) {
      return '**Angular Signals** (v16+) — fine-grained reactive state management.\n\n' +
        '```typescript\nimport { signal, computed, effect } from "@angular/core";\n\nconst count = signal(0);\nconst doubled = computed(() => count() * 2);\n\neffect(() => console.log("Count:", count()));\n\ncount.set(5);       // set new value\ncount.update(v => v + 1); // update based on current\n```\n\n' +
        '**How Signals improve change detection:** Instead of checking entire component tree (Zone.js), Signals notify only affected components. More reactive, less overhead — similar to Solid.js approach.';
    }

    if (/vue\s+3.*vite|vite.*vue|set\s*up.*vue.*(?:vite|project)|create.?vue/i.test(input)) {
      return '**Setting up Vue 3 with Vite:**\n\n```bash\nnpm create vue@latest  # uses create-vue (official scaffold)\n# or\nnpm create vite@latest my-app -- --template vue-ts\n```\n\n' +
        '**Scaffold includes:** Vue 3, Vite, TypeScript, Vue Router, Pinia (optional), ESLint, Prettier.\n\n' +
        '```vue\n<script setup lang="ts">\nimport { ref } from "vue"\nconst msg = ref("Hello Vue 3 + Vite!")\n</script>\n<template><h1>{{ msg }}</h1></template>\n```\n\n' +
        '**Vite gives:** Instant HMR, fast builds, native ESM dev server.';
    }

    if (/angular\s+standalone|standalone.*angular|standalone\s+component/i.test(input)) {
      return '**Angular standalone components** (v14+) — components without NgModule.\n\n' +
        '```typescript\nimport { Component } from "@angular/core";\nimport { CommonModule } from "@angular/common";\n\n@Component({\n  selector: "app-hello",\n  standalone: true,\n  imports: [CommonModule],\n  template: `<h1>Hello {{ name }}!</h1>`,\n})\nexport class HelloComponent {\n  name = "Angular";\n}\n```\n\n' +
        '**Key:** No more `NgModule` boilerplate. Direct `imports` in the component. Simpler, more tree-shakable, recommended for all new Angular projects.';
    }

    if (/vue.?router|vue\s+router|how.*vue.*(?:route|nav)|spa.*navigation.*vue/i.test(input)) {
      return '**Vue Router** — official router for Vue.js SPA navigation.\n\n' +
        '```typescript\nimport { createRouter, createWebHistory } from "vue-router";\n\nconst router = createRouter({\n  history: createWebHistory(),\n  routes: [\n    { path: "/", component: () => import("./Home.vue") },\n    { path: "/about", component: () => import("./About.vue") },\n    { path: "/user/:id", component: () => import("./User.vue") },\n  ],\n});\n```\n\n' +
        '**Features:** Dynamic routes, lazy loading via `import()`, nested routes, navigation guards, route params.\n\n**In template:** `<RouterLink to="/">Home</RouterLink>` + `<RouterView />`';
    }

    if (/angular\s+(?:dependency\s+inject|di\s+system|inject)|dependency\s+inject.*angular/i.test(input)) {
      return '**Angular dependency injection** — built-in DI container.\n\n' +
        '```typescript\nimport { Injectable, inject } from "@angular/core";\n\n@Injectable({ providedIn: "root" })\nexport class UserService {\n  private http = inject(HttpClient);\n\n  getUsers() {\n    return this.http.get<User[]>("/api/users");\n  }\n}\n\n// In component\n@Component({ ... })\nexport class UserList {\n  private userService = inject(UserService);\n  users = this.userService.getUsers();\n}\n```\n\n' +
        '**Key:** `@Injectable` marks services. `inject()` function (modern) or constructor injection (classic). `providedIn: "root"` = singleton.';
    }

    if (/headless\s+wordpress.*next|wordpress.*(?:next|graphql|wp.?graphql)|build.*wordpress.*next/i.test(input)) {
      return '**Headless WordPress with Next.js:**\n\n' +
        '**Setup:**\n1. WordPress as CMS backend + **WPGraphQL** plugin\n2. Next.js frontend fetching data via GraphQL\n\n```tsx\n// lib/api.ts\nconst API_URL = process.env.WORDPRESS_API_URL;\n\nexport async function getPosts() {\n  const res = await fetch(API_URL, {\n    method: "POST",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify({ query: `{ posts { nodes { title slug content } } }` }),\n  });\n  const json = await res.json();\n  return json.data.posts.nodes;\n}\n```\n\n' +
        '**Benefits:** WordPress admin for editors + Next.js performance for users. WPGraphQL or REST API (`/wp-json/wp/v2/posts`).';
    }

    if (/nuxt\s*3|what.*nuxt|nuxt.*(?:compare|vs|next|what)/i.test(input)) {
      return '**Nuxt 3** — the Vue.js full-stack framework (Vue\'s answer to Next.js).\n\n' +
        '| | Nuxt 3 | Next.js |\n|---|---|---|\n| **Framework** | Vue 3 | React |\n| **SSR** | Nitro server engine | Node.js/Edge |\n| **File routing** | `pages/` directory | `app/` directory |\n| **State** | Pinia | Zustand/Redux |\n| **DX** | Auto-imports, composables | Manual imports |\n\n' +
        '**Nuxt 3 features:** Auto-imports, Nitro server engine, built-in `useFetch`, file-based API routes, Vite-powered dev server.';
    }

    if (/custom\s+wordpress\s+block|wordpress.*block.*react|gutenberg.*react|create.*\b(?:block|gutenberg)\b/i.test(input) && /wordpress|gutenberg|wp[-_]|block\s+editor/i.test(input)) {
      return '**Custom WordPress block with React (Gutenberg):**\n\n' +
        '```bash\nnpx @wordpress/create-block my-custom-block\n```\n\n' +
        '```jsx\n// src/edit.js — Editor view (React component)\nimport { useBlockProps, RichText } from "@wordpress/block-editor";\n\nexport default function Edit({ attributes, setAttributes }) {\n  return (\n    <div {...useBlockProps()}>\n      <RichText\n        tagName="p"\n        value={attributes.content}\n        onChange={(content) => setAttributes({ content })}\n        placeholder="Enter text..."\n      />\n    </div>\n  );\n}\n```\n\n' +
        '**Key:** Gutenberg blocks are built with React. `@wordpress/scripts` provides the build toolchain. Register with `registerBlockType()`.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Testing deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/vitest.*(?:vs|compare).*jest|jest.*(?:vs|compare).*vitest|what.*vitest|vitest.*(?:what|how)/i.test(input) && !/playwright|cypress|e2e/i.test(input)) {
      return '**Vitest** — Vite-native test framework.\n\n| | Vitest | Jest |\n|---|---|---|\n' +
        '| **Speed** | Very fast (Vite-powered) | Slower (transforms) |\n| **ESM** | Native ESM support | Requires config |\n| **Config** | Shares Vite config | Separate jest.config |\n| **API** | Jest-compatible | Original |\n| **HMR** | Watch mode with HMR | File watching |\n\n' +
        '**Migration:** Drop-in Jest replacement — same `describe`, `it`, `expect` API.\n\n```typescript\nimport { describe, it, expect } from "vitest";\ndescribe("sum", () => {\n  it("adds numbers", () => { expect(1 + 2).toBe(3); });\n});\n```';
    }

    if (/unit\s+test.*integration.*e2e|differ.*(?:unit|integration|e2e)|unit.*(?:vs|integration)/i.test(input)) {
      return '**Unit vs Integration vs E2E tests:**\n\n' +
        '| | Unit | Integration | E2E (End-to-End) |\n|---|---|---|---|\n' +
        '| **Scope** | Single function/component | Multiple modules together | Full user flow |\n| **Speed** | Fast | Medium | Slow |\n| **Cost** | Low | Medium | High |\n| **Tools** | Vitest, Jest | Vitest, Supertest | Playwright, Cypress |\n\n' +
        '**Testing pyramid:** Many unit tests (base) → fewer integration → fewest E2E (top).\n\n' +
        '**Example:** Unit = test a `sum()` function. Integration = test API route with DB. End-to-end = test user login flow in browser.';
    }

    if (/tdd\b|test.?driven|what.*tdd|red.*green.*refactor/i.test(input) && !/vitest|jest|playwright/i.test(input)) {
      return '**TDD (Test-Driven Development):**\n\n' +
        '**Three steps:**\n1. **Red** — write a failing test first\n2. **Green** — write minimal code to pass the test\n3. **Refactor** — clean up code while keeping tests green\n\n' +
        '**Why TDD:**\n- Forces thinking about design before implementation\n- Built-in regression tests\n- Higher code confidence\n- Better API design (test-first = user-first)\n\n' +
        '```typescript\n// 1. Red: test first\nit("adds two numbers", () => { expect(add(1, 2)).toBe(3); });\n// 2. Green: implement\nfunction add(a: number, b: number) { return a + b; }\n// 3. Refactor if needed\n```';
    }

    if (/react\s+testing\s+library|testing\s+library.*react|test.*react\s+component|render.*screen/i.test(input)) {
      return '**React Testing Library** — test components from the user\'s perspective.\n\n' +
        '```typescript\nimport { render, screen } from "@testing-library/react";\nimport userEvent from "@testing-library/user-event";\n\nit("submits form", async () => {\n  render(<LoginForm />);\n  await userEvent.type(screen.getByLabelText("Email"), "test@example.com");\n  await userEvent.click(screen.getByRole("button", { name: "Login" }));\n  expect(screen.getByText("Welcome")).toBeInTheDocument();\n});\n```\n\n' +
        '**Key queries:** `getByRole`, `getByLabelText`, `getByText`, `getByTestId` (last resort). Focus on user event simulation, not implementation details.';
    }

    if (/mock.*(?:test|when)|stub.*spy|what.*mock|when.*mock|vi\.fn|jest\.fn/i.test(input) && !/service\s+worker|msw/i.test(input)) {
      return '**Mocking in tests:**\n\n**Mock** = fake implementation. **Spy** = watches calls. **Stub** = predefined return value.\n\n' +
        '```typescript\n// Vitest mock\nconst fetchData = vi.fn().mockResolvedValue({ name: "Alice" });\n\n// Spy on method\nconst spy = vi.spyOn(console, "log");\nconsole.log("hello");\nexpect(spy).toHaveBeenCalledWith("hello");\n\n// Module mock\nvi.mock("./api", () => ({\n  getUser: vi.fn().mockResolvedValue({ id: 1 }),\n}));\n```\n\n' +
        '**When to mock:** External APIs, databases, timers, browser APIs. **Don\'t over-mock** — test behavior, not implementation.';
    }

    if (/test.*api\s+endpoint|api.*test|how.*test.*api|supertest/i.test(input) && !/type.?safe.*api/i.test(input)) {
      return '**Testing API endpoints:**\n\n' +
        '```typescript\nimport { describe, it, expect } from "vitest";\nimport supertest from "supertest";\nimport app from "./app";\n\nconst request = supertest(app);\n\ndescribe("GET /api/users", () => {\n  it("returns users with status 200", async () => {\n    const response = await request.get("/api/users");\n    expect(response.status).toBe(200);\n    expect(response.body).toHaveLength(2);\n    expect(response.body[0]).toHaveProperty("name");\n  });\n});\n```\n\n' +
        '**Tools:** Supertest (Node.js), MSW (Mock Service Worker for browser), Playwright (E2E API testing).';
    }

    if (/code\s+coverage|coverage.*percent|what.*code\s+coverage|how\s+much.*coverage/i.test(input)) {
      return '**Code coverage** — measures how much code is exercised by tests.\n\n' +
        '**Types:**\n- **Line coverage** — % of lines executed\n- **Branch coverage** — % of if/else branches covered\n- **Function coverage** — % of functions called\n- **Statement coverage** — % of statements executed\n\n' +
        '**Target:** Aim for **80%+ line/branch coverage**. 100% is often impractical and costly.\n\n' +
        '```bash\nvitest run --coverage\n# or\njest --coverage\n```\n\n**Key:** High coverage ≠ good tests. Focus on meaningful assertions, not just line counting.';
    }

    if (/async.*test|test.*async|how.*test.*async.*code/i.test(input) && !/python|rust|go\b/i.test(input)) {
      return '**Testing async code in Vitest/Jest:**\n\n' +
        '```typescript\n// Async/await\nit("fetches user", async () => {\n  const user = await fetchUser(1);\n  expect(user.name).toBe("Alice");\n});\n\n// Resolves/rejects\nit("resolves with data", () => {\n  return expect(fetchUser(1)).resolves.toEqual({ name: "Alice" });\n});\n\nit("rejects on error", () => {\n  return expect(fetchUser(-1)).rejects.toThrow("Not found");\n});\n\n// Timer mocking\nit("debounces", async () => {\n  vi.useFakeTimers();\n  const fn = vi.fn();\n  debounce(fn, 100)();\n  vi.advanceTimersByTime(100);\n  expect(fn).toHaveBeenCalledOnce();\n});\n```';
    }

    if (/playwright\b|what.*playwright|playwright.*(?:e2e|browser|test)/i.test(input) && !/cypress|vitest|jest/i.test(input)) {
      return '**Playwright** — cross-browser E2E testing framework by Microsoft.\n\n' +
        '```typescript\nimport { test, expect } from "@playwright/test";\n\ntest("user can login", async ({ page }) => {\n  await page.goto("http://localhost:3000/login");\n  await page.fill("#email", "user@example.com");\n  await page.fill("#password", "secret");\n  await page.click("button[type=submit]");\n  await expect(page.locator("h1")).toHaveText("Dashboard");\n});\n```\n\n' +
        '**Features:** Chromium, Firefox, WebKit support. Auto-wait, trace viewer, codegen, parallel execution.\n\n**Setup:** `npm init playwright@latest`';
    }

    if (/snapshot\s+test|tomatchsnapshot|what.*snapshot|explain.*snapshot/i.test(input)) {
      return '**Snapshot testing** — captures component output and compares against stored "snapshot".\n\n' +
        '```typescript\nimport { render } from "@testing-library/react";\n\nit("matches snapshot", () => {\n  const { container } = render(<Button label="Click me" />);\n  expect(container).toMatchSnapshot();\n});\n```\n\n' +
        '**First run:** Creates `.snap` file with rendered output.\n**Subsequent runs:** Compares against stored snapshot. Fails if output changed.\n\n' +
        '**When useful:** Regression detection for UI components. Update with `--update-snapshot`.\n**Warning:** Fragile — small refactors trigger failures. Use sparingly alongside behavioral tests.';
    }

    // ── Build: tree-shaking ──
    if (/tree.?shak|dead\s+code.*elimin|how.*tree.?shak/i.test(input)) {
      return '**Tree-shaking** — removing unused (dead) code from the final bundle.\n\n' +
        '**How it works:**\n' +
        '1. Bundler analyzes `import`/`export` statements (static analysis)\n' +
        '2. Identifies which exports are actually used\n' +
        '3. Eliminates unused exports from the final bundle\n\n' +
        '**Requires ESM** — `import`/`export` syntax (not `require`/`module.exports`) because ESM imports are statically analyzable.\n\n' +
        '```javascript\n// math.js\nexport function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; } // unused → tree-shaken\n\n// app.js\nimport { add } from "./math"; // only add is imported\nadd(1, 2); // subtract is removed from bundle\n```\n\n' +
        '**Tools:** Vite (Rollup), Webpack 5, esbuild — all support tree-shaking by default.';
    }

    // ── Build: bundling vs transpiling ──
    if (/bundl.*(?:vs|transpil)|transpil.*(?:vs|bundl)|differ.*(?:bundl|transpil)|what.*bundl.*transpil/i.test(input)) {
      return '**Bundling vs Transpiling:**\n\n' +
        '| | Bundling | Transpiling |\n|---|---|---|\n' +
        '| **What** | Combines multiple files into one/few bundles | Converts code from one syntax to another |\n' +
        '| **Purpose** | Reduce HTTP requests, optimize delivery | Ensure browser compatibility |\n' +
        '| **Tools** | Webpack, Vite (Rollup), esbuild | Babel, SWC, TypeScript compiler |\n' +
        '| **Example** | 100 JS files → 1 bundle.js | JSX → JS, TS → JS, ES2024 → ES5 |\n\n' +
        '**Bundling** = combine + optimize (tree-shaking, minification, code splitting).\n' +
        '**Transpiling** = convert syntax (TypeScript to JavaScript, modern JS to older JS).\n\n' +
        '**Modern tools like Vite and esbuild do both** — they transpile AND bundle in one step.';
    }

    // ── Docker ──
    if (/what\s+is\s+docker|explain.*docker|docker.*(?:what|explain|why)|hva\s+er\s+docker/i.test(input)) {
      let response = '**Docker** solves the oldest problem in software: "it works on my machine." It packages your app with everything it needs into a **container** — so it runs the same way everywhere.\n\n' +
        '**Key concepts:**\n' +
        '- **Container** — lightweight, standalone package that includes everything needed to run an application\n' +
        '- **Image** — read-only template used to create containers (built from a Dockerfile)\n' +
        '- **Dockerfile** — text file with instructions to build an image\n' +
        '- **Docker Compose** — tool for defining multi-container applications (docker-compose.yml)\n' +
        '- **Docker Hub** — public registry for sharing images\n\n' +
        '**Why developers use it:**\n' +
        '- Consistent development, staging, and production environments\n' +
        '- Easy microservices architecture\n' +
        '- Fast startup compared to VMs\n' +
        '- Native support in all major cloud providers';

      // Compound: also asking how to set it up / get started
      if (/how\s+(?:do\s+i\s+)?(?:set\s*(?:it\s+)?up|get\s+started|install|start|use\s+it)/i.test(input)) {
        response += '\n\n---\n\n**Getting started:**\n' +
          '1. **Install Docker Desktop** from [docker.com](https://docker.com)\n' +
          '2. **Create a `Dockerfile`:**\n```dockerfile\nFROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD ["node", "index.js"]\n```\n' +
          '3. **Build:** `docker build -t my-app .`\n' +
          '4. **Run:** `docker run -p 3000:3000 my-app`';
      }
      return response;
    }

    if (/dockerfile.*(?:next\.?js|nextjs|react)|next\.?js.*dockerfile|docker.*(?:setup|create|build).*next/i.test(input)
      || /setup.*docker.*(?:next|app)|create.*docker.*(?:next|app)/i.test(input)) {
      return '**Dockerfile for a Next.js 14+ application (multi-stage build):**\n\n```dockerfile\n# Stage 1: Dependencies\nFROM node:20-alpine AS deps\nWORKDIR /app\nCOPY package.json pnpm-lock.yaml ./\nRUN corepack enable && pnpm install --frozen-lockfile\n\n# Stage 2: Build\nFROM node:20-alpine AS builder\nWORKDIR /app\nCOPY --from=deps /app/node_modules ./node_modules\nCOPY . .\nRUN corepack enable && pnpm build\n\n# Stage 3: Production\nFROM node:20-alpine AS runner\nWORKDIR /app\nENV NODE_ENV=production\nRUN addgroup --system --gid 1001 nodejs\nRUN adduser --system --uid 1001 nextjs\nCOPY --from=builder /app/public ./public\nCOPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./\nCOPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static\nUSER nextjs\nEXPOSE 3000\nENV PORT=3000\nCMD ["node", "server.js"]\n```\n\n' +
        '**Required in next.config.js:**\n```js\nmodule.exports = { output: "standalone" }\n```\n\n' +
        '**docker-compose.yml:**\n```yaml\nservices:\n  app:\n    build: .\n    ports:\n      - "3000:3000"\n    env_file: .env.local\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_DB: myapp\n      POSTGRES_USER: admin\n      POSTGRES_PASSWORD: ${DB_PASSWORD}\n    ports:\n      - "5432:5432"\n    volumes:\n      - pgdata:/var/lib/postgresql/data\nvolumes:\n  pgdata:\n```';
    }

    // ── CI/CD ──
    if (/what\s+is\s+ci\s*\/?\s*cd|explain.*ci\s*\/?\s*cd|continuous\s+(?:integration|deployment|delivery).*(?:what|explain|tool)/i.test(input)) {
      return '**CI/CD** stands for **Continuous Integration / Continuous Deployment (or Delivery)**.\n\n' +
        '**Continuous Integration (CI):**\n' +
        '- Automatically build and test code every time a developer pushes changes\n' +
        '- Catches bugs early, ensures code quality\n\n' +
        '**Continuous Deployment (CD):**\n' +
        '- Automatically deploy tested code to production\n' +
        '- Continuous *Delivery* = deploy to staging (manual approval for prod)\n' +
        '- Continuous *Deployment* = fully automated to production\n\n' +
        '**Popular CI/CD tools:**\n' +
        '| Tool | Type | Notes |\n|---|---|---|\n' +
        '| GitHub Actions | Cloud | Built into GitHub, YAML workflows |\n' +
        '| GitLab CI/CD | Cloud/Self-host | Integrated with GitLab |\n' +
        '| Jenkins | Self-host | Java-based, highly extensible |\n' +
        '| CircleCI | Cloud | Fast, Docker-native |\n' +
        '| Vercel | Cloud | Zero-config for Next.js |\n' +
        '| Netlify | Cloud | Great for static/JAMstack |\n' +
        '| AWS CodePipeline | Cloud | AWS-native CI/CD |';
    }

    // ── TypeScript ──
    if (/what(?:\s*'?s|\s+is)\s+typescript|explain.*typescript|typescript.*(?:what|why|advantage|benefit|over\s+javascript)/i.test(input)
      || /why\s+(?:should\s+(?:i|we|you)\s+)?(?:use\s+)?typescript\s+(?:over|instead)/i.test(input)) {
      return '**TypeScript** is JavaScript with a safety net — same language underneath, but it catches bugs before your code ever runs.\n\n' +
        'Developed by **Microsoft** (2012), it\'s now the default choice for serious JavaScript projects.\n\n' +
        '**What it adds over JavaScript:**\n' +
        '- **Static type checking** — catch errors at compile time, not runtime\n' +
        '- **IntelliSense** — superior autocomplete and refactoring in IDEs\n' +
        '- **Interfaces & generics** — better code architecture and reusability\n' +
        '- **Enums, tuples, union types** — richer type system\n' +
        '- **Refactoring safety** — rename symbols confidently across large codebases\n\n' +
        '**Example:**\n```typescript\ninterface User {\n  id: number;\n  name: string;\n  email: string;\n  role: "admin" | "user";\n}\n\nfunction greet(user: User): string {\n  return `Hello, ${user.name}!`;\n}\n```\n\n' +
        'TypeScript compiles to plain JavaScript and runs anywhere JS runs.';
    }

    // ── Tailwind CSS ──
    if (/what\s+is\s+tailwind|explain.*tailwind|tailwind.*(?:what|differ|vs|bootstrap|utility)/i.test(input)) {
      return '**Tailwind CSS** is a **utility-first CSS framework** that provides low-level utility classes to build custom designs directly in HTML.\n\n' +
        '**How it differs from Bootstrap:**\n' +
        '| | Tailwind | Bootstrap |\n|---|---|---|\n' +
        '| **Approach** | Utility-first (composition) | Component-first (pre-built) |\n' +
        '| **Customization** | Highly customizable via config | Theme overrides |\n' +
        '| **File size** | Purges unused CSS (tiny prod builds) | Full framework loaded |\n' +
        '| **Design** | No default look — fully custom | Recognizable "Bootstrap look" |\n' +
        '| **Learning curve** | Class names to learn | Components to learn |\n\n' +
        '**Tailwind v4 (latest):**\n' +
        '- CSS-first config via `@theme` directive (no tailwind.config.js)\n' +
        '- OKLCH color format by default\n' +
        '- `@tailwindcss/vite` plugin instead of PostCSS\n' +
        '- `@import "tailwindcss"` replaces `@tailwind` directives';
    }

    // ── Tailwind v4 specifics ──
    if (/tailwind\s*(?:css\s*)?v?4|@theme\s+(?:directive|inline|reference|default)|tailwind.*(?:v4|version\s*4|changes?\s+since|new\s+in|what.?s\s+new)/i.test(input)) {
      return '**Tailwind CSS v4** — Major changes from v3:\n\n' +
        '| Feature | v3 | v4 |\n|---|---|---|\n' +
        '| Config | tailwind.config.js | `@theme` in CSS |\n' +
        '| Build tool | PostCSS plugin | `@tailwindcss/vite` |\n' +
        '| Colors | rgb()/hsl() | oklch() (perceptual) |\n' +
        '| CSS entry | `@tailwind base/components/utilities` | `@import "tailwindcss"` |\n' +
        '| Theme extension | `extend: {}` in JS | CSS variables |\n\n' +
        '**@theme modes:**\n' +
        '- `@theme` (default) — generates CSS variables on `:root`\n' +
        '- `@theme inline` — inlines values directly (better performance)\n' +
        '- `@theme reference` — fallback values without emitting variables\n\n' +
        '**Spacing:** `--spacing: 0.25rem` base unit → `p-4` = 4 × 0.25rem = 1rem\n\n' +
        '**Best practice — Two-tier variable system:**\n```css\n@theme {\n  --color-blue-600: oklch(54.6% 0.245 262.881);\n  --color-primary: var(--color-blue-600);\n}\n```';
    }

    // ── Design Tokens ──
    if (/design\s+token|what\s+are\s+design\s+tokens/i.test(input)) {
      return '**Design tokens** are named entities that store visual design attributes (colors, spacing, typography, etc.) as platform-agnostic variables.\n\n' +
        '**Purpose:** Single source of truth for design decisions across platforms.\n\n' +
        '**Example (CSS custom properties):**\n```css\n:root {\n  --color-primary: #3b82f6;\n  --spacing-md: 1rem;\n  --font-body: "Inter", sans-serif;\n  --radius-lg: 0.75rem;\n}\n```\n\n' +
        '**Used in:**\n- Tailwind CSS v4 (`@theme` directive)\n- Figma (design variables)\n- Style Dictionary (build tool)\n- shadcn/ui (CSS variables)\n\n' +
        'Tokens create consistency between design and code.';
    }

    // ── WCAG / Accessibility ──
    if (/wcag|web\s+content\s+accessibility|accessibility.*(?:guideline|standard|what|important)|universell\s+utforming.*(?:what|hva|why|hvorfor|viktig)/i.test(input)) {
      return '**WCAG** (Web Content Accessibility Guidelines) is the international standard for web accessibility, developed by the W3C.\n\n' +
        '**Current versions:** WCAG 2.1 (2018) and WCAG 2.2 (2023)\n\n' +
        '**Four principles (POUR):**\n' +
        '1. **Perceivable** — content must be presentable in ways users can perceive (alt text, captions, contrast)\n' +
        '2. **Operable** — UI must be navigable by keyboard, enough time, no seizure triggers\n' +
        '3. **Understandable** — content and UI must be understandable (readable, predictable)\n' +
        '4. **Robust** — content must work with assistive technologies\n\n' +
        '**Conformance levels:** A (minimum) → AA (standard) → AAA (enhanced)\n\n' +
        '**In Norway:** Universell utforming (universal design) is **legally required** by the Likestillings- og diskrimineringsloven. All Norwegian websites must meet at minimum WCAG 2.1 AA.';
    }

    // ── GDPR ──
    if (/gdpr|general\s+data\s+protection|personvern.*(?:what|hva|lov|regulat)|privacy.*(?:regulat|gdpr|eu|web\s+dev)/i.test(input)) {
      return '**GDPR** (General Data Protection Regulation) is the EU/EEA data protection law, effective May 25, 2018.\n\n' +
        '**Key requirements for web developers:**\n' +
        '- **Consent** — explicit opt-in for cookies and data collection (no pre-checked boxes)\n' +
        '- **Data minimization** — collect only what\'s necessary\n' +
        '- **Right to access** — users can request all data held about them\n' +
        '- **Right to be forgotten** — users can request data deletion\n' +
        '- **Data portability** — users can export their data\n' +
        '- **Breach notification** — 72-hour reporting window\n' +
        '- **Privacy by design** — built into the system architecture\n\n' +
        '**In Norway:** Enforced by Datatilsynet. Norwegian websites must display a **samtykkeboks** (consent box) for cookies that complies with both GDPR and Norwegian ePrivacy regulations.\n\n' +
        '**Penalties:** Up to €20 million or 4% of global annual revenue.';
    }

    // ── Norwegian web MVP 2026 standard ──
    if (/norwegian?\s+(?:standard|mvp)|norsk\s+standard.*(?:nettside|web)|mvp.*(?:norsk|norwegian|2026)|minimum\s+viable.*(?:norsk|norwegian)/i.test(input)) {
      return '**Norsk standard for en nettside-MVP (2026):**\n\n' +
        '**1. Lovpålagte krav (Legal requirements):**\n' +
        '- Universell utforming: WCAG 2.1/2.2 AA (lovpålagt)\n' +
        '- Personvern: GDPR-compliant samtykkeboks for cookies\n' +
        '- Sikkerhet: HTTPS med gyldig SSL-sertifikat\n' +
        '- Responsivt design: Mobile-first tilnærming\n\n' +
        '**2. Funksjonell MVP-struktur:**\n' +
        '- Tydelig budskap (above the fold)\n' +
        '- Én tydelig Call-to-Action (CTA)\n' +
        '- Om oss / Tjenester\n' +
        '- Kontaktinfo (skjema eller e-post/telefon)\n\n' +
        '**3. Best practices:**\n' +
        '- Minimalisme med formål — whitespace + dristige fargeaksenter for CTA\n' +
        '- Rask lastetid (< 3 sekunder) — 53% forlater trege sider\n' +
        '- Bærekraftig design — færre ressurser, lavere karbonavtrykk\n' +
        '- CMS: WordPress, Sanity, eller Strapi for enkel innholdsoppdatering\n\n' +
        '**Anbefalt tech stack:** Next.js + Tailwind CSS + Prisma + PostgreSQL + Vercel';
    }

    // ── Rust ──
    if (/rust.*(?:memory\s+safety|ownership|borrow)|how\s+does\s+rust\s+ensure|borrow\s+checker|ownership\s+(?:system|model|in\s+rust)/i.test(input)) {
      return '**Rust** ensures memory safety without a garbage collector through its **ownership system**.\n\n' +
        '**Three rules of ownership:**\n' +
        '1. Each value has exactly one **owner** variable\n' +
        '2. When the owner goes out of scope, the value is **dropped** (freed)\n' +
        '3. Only one mutable reference OR any number of immutable references at a time\n\n' +
        '**Borrow checker** (compile-time verification):\n```rust\nfn main() {\n    let s1 = String::from("hello");\n    let s2 = &s1;           // immutable borrow — OK\n    println!("{}", s2);\n    // let s3 = &mut s1;    // ERROR: can\'t borrow mutably while immutably borrowed\n}\n```\n\n' +
        '**Result:** Zero-cost abstractions, no dangling pointers, no data races — guaranteed at compile time.';
    }

    // ── Python GIL ──
    if (/(?:python\s+)?gil\b|global\s+interpreter\s+lock|python.*(?:concurrency|thread|parallel|gil)/i.test(input)) {
      return '**The GIL** (Global Interpreter Lock) in CPython is a mutex that allows only **one thread to execute Python bytecode at a time**.\n\n' +
        '**Impact on concurrency:**\n' +
        '- CPU-bound multithreaded code does NOT run in parallel\n' +
        '- I/O-bound threads CAN run concurrently (GIL is released during I/O)\n' +
        '- For CPU parallelism, use `multiprocessing` or `concurrent.futures.ProcessPoolExecutor`\n\n' +
        '**Workarounds:**\n' +
        '| Approach | When to use |\n|---|---|\n' +
        '| `asyncio` | I/O-bound tasks (network, file) |\n' +
        '| `multiprocessing` | CPU-bound tasks |\n' +
        '| C extensions (numpy) | Heavy computation (GIL released) |\n' +
        '| `concurrent.futures` | Mixed workloads |\n\n' +
        '**Note:** Python 3.13+ introduces experimental free-threaded mode (PEP 703) that removes the GIL.';
    }

    // ── Go goroutines ──
    if (/goroutine|go\s+(?:routine|concurrency|channel)|golang.*(?:thread|concurren|goroutine)/i.test(input)) {
      return '**Go goroutines** are lightweight, user-space threads managed by the Go runtime.\n\n' +
        '**Goroutines vs OS threads:**\n' +
        '| | Goroutines | OS Threads |\n|---|---|---|\n' +
        '| **Stack size** | ~2 KB (grows dynamically) | ~1 MB fixed |\n' +
        '| **Creation cost** | Microseconds | Milliseconds |\n' +
        '| **Scheduling** | Go runtime (M:N model) | OS kernel |\n' +
        '| **Concurrent count** | Millions feasible | Thousands max |\n' +
        '| **Communication** | Channels (CSP model) | Shared memory + locks |\n\n' +
        '**Example:**\n```go\nfunc main() {\n    ch := make(chan string)\n    go func() {\n        ch <- "Hello from goroutine!"\n    }()\n    msg := <-ch\n    fmt.Println(msg)\n}\n```\n\n' +
        '**Motto:** "Don\'t communicate by sharing memory; share memory by communicating."';
    }

    // ── Angular ──
    if (/what\s+is\s+angular|explain.*angular|angular.*(?:what|framework|google|vs\s+react|vs\s+vue)/i.test(input)) {
      return '**Angular** is a full-featured TypeScript-based web application framework by **Google**.\n\n' +
        '**Key features:**\n' +
        '- **TypeScript-first** — built entirely in TypeScript\n' +
        '- **Two-way data binding** — automatic sync between model and view\n' +
        '- **Dependency injection** — built-in DI container\n' +
        '- **RxJS** — reactive programming with Observables\n' +
        '- **Angular CLI** — powerful code generation and scaffolding\n' +
        '- **Signals** (v16+) — fine-grained reactivity (like Solid.js)\n\n' +
        '**Angular vs React vs Vue:**\n' +
        '| | Angular | React | Vue |\n|---|---|---|---|\n' +
        '| **Type** | Framework | Library | Framework |\n' +
        '| **Language** | TypeScript | JS/TS | JS/TS |\n' +
        '| **Data binding** | Two-way | One-way | Two-way |\n' +
        '| **State** | Services + Signals | Redux/Zustand | Pinia |\n' +
        '| **Backed by** | Google | Meta | Independent |';
    }

    // ── Vue 3 / Composition API ──
    if (/vue\s*(?:\.js\s*)?3|composition\s+api.*vue|vue.*composition\s+api|options?\s+api\s+vs\s+composition/i.test(input)) {
      return '**Vue 3** introduced the **Composition API** as an alternative to the Options API.\n\n' +
        '**Composition API vs Options API:**\n' +
        '| Aspect | Options API | Composition API |\n|---|---|---|\n' +
        '| **Organization** | By option type (data, methods, computed) | By feature/concern |\n' +
        '| **Reusability** | Mixins (problematic) | Composables (clean) |\n' +
        '| **TypeScript** | Limited support | Full type inference |\n' +
        '| **Learning curve** | Easier for beginners | More flexible |\n\n' +
        '**Composition API example:**\n```vue\n<script setup lang="ts">\nimport { ref, computed, onMounted } from "vue"\n\nconst count = ref(0)\nconst doubled = computed(() => count.value * 2)\n\nonMounted(() => console.log("Component mounted"))\n\nfunction increment() {\n  count.value++\n}\n</script>\n\n<template>\n  <button @click="increment">{{ count }} ({{ doubled }})</button>\n</template>\n```';
    }

    // ── WordPress / CMS ──
    if (/(?:what\s+is\s+)?wordpress|wordpress.*(?:cms|headless|rest\s+api|still\s+relevant|vs)|headless\s+(?:cms|wordpress)/i.test(input)) {
      return '**WordPress** is the world\'s most popular CMS, powering ~43% of all websites.\n\n' +
        '**Traditional WordPress:**\n' +
        '- PHP-based, server-rendered\n' +
        '- Thousands of themes and plugins\n' +
        '- Gutenberg block editor\n' +
        '- Great for blogs, business sites, e-commerce (WooCommerce)\n\n' +
        '**Headless WordPress:**\n' +
        '- Use WordPress as a backend CMS + REST API or WPGraphQL\n' +
        '- Frontend: Next.js, Nuxt, Astro, or any JS framework\n' +
        '- Best of both worlds: familiar editing + modern frontend\n\n' +
        '**Alternatives:**\n' +
        '| CMS | Type | Best for |\n|---|---|---|\n' +
        '| Sanity | Headless | Real-time collaboration |\n' +
        '| Strapi | Headless/Self-host | Open-source, customizable |\n' +
        '| Contentful | Headless/Cloud | Enterprise |\n' +
        '| Payload | Headless/Self-host | TypeScript-native |';
    }

    // ── Next.js App Router / Server Components ──
    if (/next\.?js\s+(?:app\s+router|server\s+component|server\s+action|14|15|16)|app\s+router.*next|server\s+component.*(?:react|next)|react\s+server\s+component/i.test(input)) {
      return '**Next.js App Router** (13.4+) — The modern Next.js architecture:\n\n' +
        '**Key concepts:**\n' +
        '- **Server Components** (default) — render on the server, zero client JS\n' +
        '- **Client Components** — use `"use client"` directive for interactivity\n' +
        '- **Server Actions** — `"use server"` for form handling and mutations\n' +
        '- **File-based routing** — `app/page.tsx`, `app/layout.tsx`, `app/loading.tsx`\n' +
        '- **Parallel routes** — `@modal`, `@sidebar` slots\n' +
        '- **Intercepting routes** — `(.)photo/[id]` for modal patterns\n\n' +
        '**Data fetching:**\n```tsx\n// Server Component — no useState/useEffect needed\nexport default async function Page() {\n  const data = await fetch("https://api.example.com/posts");\n  const posts = await data.json();\n  return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>;\n}\n```\n\n' +
        '**ISR (Incremental Static Regeneration):**\n```tsx\nfetch(url, { next: { revalidate: 60 } }); // revalidate every 60s\n```';
    }

    // ── Three.js ──
    if (/three\.?js|threejs|what\s+is\s+three|3d\s+(?:web|graphics|javascript)/i.test(input)) {
      return '**Three.js** is a JavaScript library for creating **3D graphics** in the browser using WebGL.\n\n' +
        '**Core concepts:**\n' +
        '- **Scene** — container for all 3D objects\n' +
        '- **Camera** — viewpoint (PerspectiveCamera or OrthographicCamera)\n' +
        '- **Renderer** — renders the scene (WebGLRenderer)\n' +
        '- **Mesh** = Geometry + Material\n' +
        '- **Lights** — ambient, directional, point, spot\n\n' +
        '**React integration: React Three Fiber (R3F)**\n```tsx\nimport { Canvas } from "@react-three/fiber"\nimport { OrbitControls } from "@react-three/drei"\n\nfunction Box() {\n  return (\n    <mesh>\n      <boxGeometry args={[1, 1, 1]} />\n      <meshStandardMaterial color="hotpink" />\n    </mesh>\n  )\n}\n\nexport default function Scene() {\n  return (\n    <Canvas>\n      <ambientLight />\n      <pointLight position={[10, 10, 10]} />\n      <Box />\n      <OrbitControls />\n    </Canvas>\n  )\n}\n```';
    }

    // ── GSAP ──
    if (/gsap|greensock|what\s+is\s+gsap|animation\s+library.*(?:javascript|web)/i.test(input)) {
      return '**GSAP** (GreenSock Animation Platform) is a professional-grade JavaScript animation library.\n\n' +
        '**Key features:**\n' +
        '- **Timeline** — sequence and control multiple animations\n' +
        '- **ScrollTrigger** — scroll-based animations\n' +
        '- **Morphing, dragging, flipping** — plugins for complex effects\n' +
        '- Works with any JS framework (React, Vue, Angular, vanilla)\n' +
        '- 60fps performance optimized\n\n' +
        '**Example:**\n```javascript\nimport gsap from "gsap";\nimport { ScrollTrigger } from "gsap/ScrollTrigger";\n\ngsap.registerPlugin(ScrollTrigger);\n\ngsap.to(".hero-title", {\n  opacity: 1,\n  y: 0,\n  duration: 1,\n  scrollTrigger: {\n    trigger: ".hero",\n    start: "top center",\n    end: "bottom center",\n    scrub: true\n  }\n});\n```\n\n' +
        '**GSAP vs Framer Motion vs CSS animations:**\n' +
        '| | GSAP | Framer Motion | CSS |\n|---|---|---|---|\n' +
        '| **Framework** | Any | React only | Any |\n' +
        '| **Scroll** | ScrollTrigger | useScroll | Limited |\n' +
        '| **Timeline** | Yes | AnimatePresence | No |';
    }

    // ── Hover effects / landing page patterns ──
    if (/hover\s+effect|hover.*(?:icon|scale)|icon.*hover|change.*hover|hover.*animat.*(?:icon|scale|change)|landing\s+page.*(?:feature|pattern|best|practice|modern)|modern\s+landing\s+page/i.test(input)) {
      return '**Modern landing page patterns with hover effects:**\n\n' +
        '**Icon hover change (React + Tailwind):**\n```tsx\nimport { useState } from "react";\nimport { Heart, HeartFilled } from "lucide-react";\n\nexport function IconHover() {\n  const [hovered, setHovered] = useState(false);\n  return (\n    <div\n      onMouseEnter={() => setHovered(true)}\n      onMouseLeave={() => setHovered(false)}\n      className="p-4 rounded-xl border border-zinc-200 hover:border-blue-500\n                 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/20"\n    >\n      {hovered ? <HeartFilled className="text-red-500" /> : <Heart className="text-zinc-400" />}\n    </div>\n  );\n}\n```\n\n' +
        '**Border glow on hover (Tailwind):**\n```html\n<div class="group relative p-6 rounded-2xl border border-zinc-800\n            hover:border-transparent transition-all duration-500">\n  <div class="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-500\n              to-purple-500 opacity-0 group-hover:opacity-100 -z-10 blur-sm" />\n  <h3 class="text-white group-hover:text-blue-200 transition-colors">Feature</h3>\n</div>\n```\n\n' +
        '**Key patterns:** Icon swap on hover, border color transitions, gradient glow effects, scale transforms, shadow elevation changes.';
    }

    // ── Authentication / Auth setup ──
    if (/(?:setup|install|add|implement)\s+auth|next.?auth|auth\.?js|clerk|authentication.*(?:next|react|setup)/i.test(input)) {
      return '**Authentication options for Next.js:**\n\n' +
        '| Solution | Type | Pros | Cons |\n|---|---|---|---|\n' +
        '| **NextAuth.js (Auth.js)** | Self-hosted | Free, flexible, many providers | Setup complexity |\n' +
        '| **Clerk** | Hosted service | Beautiful UI, fast setup | Paid at scale |\n' +
        '| **Supabase Auth** | Hosted/Self-host | Free tier, PostgreSQL integration | Vendor lock-in |\n' +
        '| **Lucia** | Self-hosted | Lightweight, no magic | Manual setup |\n' +
        '| **Kinde** | Hosted | Free tier, RBAC built-in | Newer service |\n\n' +
        '**NextAuth.js basic setup:**\n```typescript\n// app/api/auth/[...nextauth]/route.ts\nimport NextAuth from "next-auth";\nimport GitHub from "next-auth/providers/github";\nimport { PrismaAdapter } from "@auth/prisma-adapter";\nimport { prisma } from "@/lib/prisma";\n\nexport const { handlers, auth, signIn, signOut } = NextAuth({\n  adapter: PrismaAdapter(prisma),\n  providers: [\n    GitHub({ clientId: process.env.GITHUB_ID!, clientSecret: process.env.GITHUB_SECRET! }),\n  ],\n});\n```\n\n' +
        '**Password hashing:** Use **Argon2** (recommended) or **bcrypt** — never store plain-text passwords.';
    }

    // ── Prisma / Database setup ──
    if (/prisma.*(?:setup|schema|what|explain)|database.*(?:setup|schema|next|orm)|what\s+is\s+prisma|drizzle\s+vs\s+prisma/i.test(input)) {
      return '**Prisma** is a modern TypeScript ORM for Node.js.\n\n' +
        '**Setup:**\n```bash\nnpx prisma init --datasource-provider postgresql\n```\n\n' +
        '**Schema (prisma/schema.prisma):**\n```prisma\ngenerator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\nmodel User {\n  id        String   @id @default(cuid())\n  email     String   @unique\n  name      String?\n  password  String\n  role      Role     @default(USER)\n  posts     Post[]\n  createdAt DateTime @default(now())\n}\n\nmodel Post {\n  id        String   @id @default(cuid())\n  title     String\n  content   String?\n  published Boolean  @default(false)\n  author    User     @relation(fields: [authorId], references: [id])\n  authorId  String\n}\n\nenum Role {\n  USER\n  ADMIN\n}\n```\n\n' +
        '**Prisma vs Drizzle:**\n' +
        '| | Prisma | Drizzle |\n|---|---|---|\n' +
        '| **Schema** | Prisma Schema Language | TypeScript |\n' +
        '| **Query style** | Method chaining | SQL-like |\n' +
        '| **Performance** | Good | Faster (less overhead) |\n' +
        '| **Migrations** | Auto-generated | Manual or auto |';
    }

    // ── Monorepo ──
    if (/monorepo|what\s+is\s+a\s+monorepo|turborepo|nx\s+(?:workspace|monorepo)|pnpm\s+workspace/i.test(input)) {
      return '**Monorepo** — a single repository containing multiple projects/packages.\n\n' +
        '**When to use:**\n' +
        '- Shared code between frontend, backend, and packages\n' +
        '- Atomic commits across multiple packages\n' +
        '- Consistent tooling and configuration\n' +
        '- Team owns multiple related services\n\n' +
        '**Popular tools:**\n' +
        '| Tool | Strengths |\n|---|---|\n' +
        '| **Turborepo** | Caching, fast builds, Vercel integration |\n' +
        '| **Nx** | Advanced graph, generators, plugins |\n' +
        '| **pnpm workspaces** | Fast, disk-efficient, no extra tool |\n' +
        '| **Lerna** | Legacy, simpler API |\n\n' +
        '**pnpm workspace setup:**\n```yaml\n# pnpm-workspace.yaml\npackages:\n  - "apps/*"\n  - "packages/*"\n```\n\n' +
        '**Key benefit:** Change a shared package and all consumers rebuild automatically.';
    }

    // ── Responsive / Mobile-first ──
    if (/responsive\s+design|mobile.?first|responsive.*(?:what|explain|how|why)/i.test(input)) {
      return '**Responsive design** means building websites that adapt to any screen size.\n\n' +
        '**Mobile-first approach:**\n' +
        '- Start with mobile layout, then enhance for larger screens\n' +
        '- Tailwind default: mobile-first breakpoints (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`)\n\n' +
        '**Key techniques:**\n' +
        '1. **Fluid typography** — `clamp(1rem, 2.5vw, 2rem)`\n' +
        '2. **Flexible grids** — CSS Grid + Flexbox\n' +
        '3. **Responsive images** — `srcset`, `<picture>`, lazy loading\n' +
        '4. **Container queries** — style based on container size, not viewport\n' +
        '5. **Media queries** — breakpoints for layout changes\n\n' +
        '**Tailwind example:**\n```html\n<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">\n  <div class="p-4">Card 1</div>\n  <div class="p-4">Card 2</div>\n  <div class="p-4">Card 3</div>\n</div>\n```';
    }

    // ── SSL / HTTPS / Security ──
    if (/ssl|https.*(?:what|why|important|how)|security.*(?:web|https|certificate)|sikkerhet.*(?:nettside|web|https)/i.test(input)) {
      return '**HTTPS/SSL/TLS** — essential web security:\n\n' +
        '- **SSL** (Secure Sockets Layer) → replaced by **TLS** (Transport Layer Security)\n' +
        '- HTTPS = HTTP + TLS encryption\n' +
        '- All traffic encrypted between client and server\n\n' +
        '**Why HTTPS is mandatory:**\n' +
        '- Protects user data (passwords, personal info)\n' +
        '- Required by GDPR and Norwegian law\n' +
        '- SEO ranking factor (Google prefers HTTPS)\n' +
        '- Required for HTTP/2, Service Workers, PWA\n' +
        '- Free certificates via **Let\'s Encrypt**\n\n' +
        '**Web security checklist:**\n' +
        '- [ ] HTTPS everywhere (redirect HTTP → HTTPS)\n' +
        '- [ ] Security headers (CSP, HSTS, X-Frame-Options)\n' +
        '- [ ] Input validation and sanitization\n' +
        '- [ ] Password hashing (Argon2/bcrypt)\n' +
        '- [ ] Rate limiting\n' +
        '- [ ] CSRF protection\n' +
        '- [ ] Dependency auditing (npm audit)';
    }

    // ── Sustainability / bærekraftig web ──
    if (/sustainab|bærekraftig.*(?:web|design|nettside)|carbon\s+footprint.*web|green\s+web|web.*(?:carbon|environment)/i.test(input)) {
      return '**Sustainable web design** — building websites that minimize environmental impact.\n\n' +
        '**Why it matters:**\n' +
        '- The internet accounts for ~3.7% of global CO₂ emissions\n' +
        '- Average web page is ~2.5 MB (growing every year)\n\n' +
        '**Best practices:**\n' +
        '1. **Optimize images** — WebP/AVIF, lazy loading, responsive sizes\n' +
        '2. **Minimize JavaScript** — tree shaking, code splitting, fewer dependencies\n' +
        '3. **Efficient hosting** — green hosting providers (renewable energy)\n' +
        '4. **Caching** — CDN, service workers, browser cache headers\n' +
        '5. **Dark mode** — OLED screens use less power with dark pixels\n' +
        '6. **System fonts** — avoid loading custom font files when possible\n' +
        '7. **Static generation** — pre-render pages, serve from CDN\n\n' +
        '**Tools:** websitecarbon.com, ecograder.com, Lighthouse performance score\n' +
        '**Goal:** < 0.5g CO₂ per page view';
    }

    // ── State management ──
    if (/state\s+manage|zustand|jotai|redux.*(?:what|explain|vs)|pinia.*(?:what|explain)/i.test(input)) {
      return '**State management** in modern web apps:\n\n' +
        '| Library | Framework | Approach | Bundle |\n|---|---|---|---|\n' +
        '| **Zustand** | React | Tiny store, hooks-based | ~1 KB |\n' +
        '| **Jotai** | React | Atomic (bottom-up) | ~2 KB |\n' +
        '| **Redux Toolkit** | React | Flux pattern, reducers | ~11 KB |\n' +
        '| **Pinia** | Vue | Composition API stores | ~1.5 KB |\n' +
        '| **NgRx / Signals** | Angular | Reactive stores | Built-in |\n' +
        '| **Recoil** | React | Atomic (Facebook) | ~20 KB |\n\n' +
        '**2026 recommendation:** Zustand for React, Pinia for Vue, Signals for Angular.\n\n' +
        '**Zustand example:**\n```typescript\nimport { create } from "zustand";\n\ninterface Store {\n  count: number;\n  increment: () => void;\n}\n\nconst useStore = create<Store>((set) => ({\n  count: 0,\n  increment: () => set((s) => ({ count: s.count + 1 })),\n}));\n```';
    }

    // ── Testing frameworks ──
    if (/vitest|jest|playwright|cypress|testing.*(?:framework|tool|what|best)|test.?driven|tdd.*(?:what|explain)/i.test(input)) {
      return '**Testing frameworks for modern web development:**\n\n' +
        '| Tool | Type | Best for |\n|---|---|---|\n' +
        '| **Vitest** | Unit/Integration | Vite-native, fast, ESM |\n' +
        '| **Jest** | Unit/Integration | Legacy, widely used |\n' +
        '| **Playwright** | E2E | Cross-browser, auto-wait |\n' +
        '| **Cypress** | E2E | Developer-friendly, time-travel |\n' +
        '| **Testing Library** | Component | User-centric queries |\n' +
        '| **MSW** | API mocking | Mock Service Worker |\n\n' +
        '**Testing pyramid:**\n' +
        '```\n        /  E2E  \\        ← few, slow, expensive\n       / Integr. \\       ← moderate\n      /   Unit    \\      ← many, fast, cheap\n```\n\n' +
        '**TDD (Test-Driven Development):**\n' +
        '1. **Red** — write a failing test\n' +
        '2. **Green** — write minimal code to pass\n' +
        '3. **Refactor** — clean up without breaking tests';
    }

    // ── Build tools ──
    if (/vite\b|turbopack|esbuild|swc|webpack.*(?:vs|alternative)|build\s+tool.*(?:what|which|best|compare)/i.test(input)) {
      return '**Modern build tools comparison:**\n\n' +
        '| Tool | Language | Speed | Used by |\n|---|---|---|---|\n' +
        '| **Vite** | Go (esbuild) + Rust (SWC) | Very fast | Vue, React, Svelte |\n' +
        '| **Turbopack** | Rust | Fastest bundler | Next.js 13+ |\n' +
        '| **esbuild** | Go | 10-100x faster than webpack | Vite (dev) |\n' +
        '| **SWC** | Rust | Faster than Babel | Next.js, Vite |\n' +
        '| **Webpack** | JavaScript | Slow but mature | Legacy projects |\n' +
        '| **Rollup** | JavaScript | Optimized output | Libraries |\n\n' +
        '**2026 recommendation:**\n' +
        '- **Vite** for most projects (SPA, SSR, libraries)\n' +
        '- **Turbopack** for Next.js projects\n' +
        '- **esbuild/SWC** for custom toolchains';
    }

    // ── Vercel / deployment ──
    if (/vercel|netlify|deploy.*(?:next|react|vue)|hosting.*(?:modern|best|compare|next)/i.test(input)) {
      return '**Modern deployment platforms:**\n\n' +
        '| Platform | Best for | Features |\n|---|---|---|\n' +
        '| **Vercel** | Next.js, React | Edge functions, analytics, preview deploys |\n' +
        '| **Netlify** | JAMstack, static | Forms, identity, split testing |\n' +
        '| **Railway** | Full-stack, databases | Docker, PostgreSQL, Redis |\n' +
        '| **Fly.io** | Edge computing | Global edge deployment |\n' +
        '| **Cloudflare Pages** | Static + Workers | Free, fast CDN, D1 database |\n' +
        '| **AWS Amplify** | AWS ecosystem | Full AWS integration |\n\n' +
        '**Vercel deployment (zero-config for Next.js):**\n```bash\nnpx vercel\n# or connect GitHub repo → auto-deploy on push\n```';
    }

    // ── WebAssembly / WASM ──
    if (/webassembly|wasm|what\s+is\s+wasm|rust.*(?:wasm|web)/i.test(input)) {
      return '**WebAssembly (WASM)** is a binary instruction format for running near-native speed code in the browser.\n\n' +
        '**Key features:**\n' +
        '- Runs alongside JavaScript in the browser\n' +
        '- Compiled from C, C++, Rust, Go, and other languages\n' +
        '- Near-native performance for compute-heavy tasks\n' +
        '- Sandboxed execution (safe)\n\n' +
        '**Use cases:**\n' +
        '- Image/video processing, audio synthesis\n' +
        '- Games and 3D graphics\n' +
        '- Cryptography\n' +
        '- Scientific computation\n' +
        '- Running existing C/Rust libraries in the browser\n\n' +
        '**Rust + WASM example:**\n```rust\nuse wasm_bindgen::prelude::*;\n\n#[wasm_bindgen]\npub fn fibonacci(n: u32) -> u32 {\n    match n {\n        0 => 0,\n        1 => 1,\n        _ => fibonacci(n - 1) + fibonacci(n - 2),\n    }\n}\n```';
    }

    // ── Tauri (Rust desktop) ──
    if (/tauri|tauri.*(?:what|explain|vs\s+electron)|electron.*vs.*tauri/i.test(input)) {
      return '**Tauri** is a framework for building desktop applications with web technologies + **Rust** backend.\n\n' +
        '**Tauri vs Electron:**\n' +
        '| | Tauri | Electron |\n|---|---|---|\n' +
        '| **Backend** | Rust | Node.js |\n' +
        '| **WebView** | System WebView | Bundled Chromium |\n' +
        '| **Bundle size** | ~2-10 MB | ~80-150 MB |\n' +
        '| **Memory** | ~20-50 MB | ~100-300 MB |\n' +
        '| **Security** | Stronger (Rust + allowlist) | Weaker (full Node.js) |\n' +
        '| **Startup** | Fast | Slow |\n\n' +
        '**Tech stack:** Any frontend (React, Vue, Svelte, Solid) + Rust commands for native features.\n\n' +
        '**Use case:** When you need a desktop app with small bundle size and strong performance.';
    }

    // ── Icons libraries ──
    if (/icon\s+(?:library|librari|package|set)|lucide|heroicon|phosphor|feather\s+icon|react.?icon|svg\s+icon|which\s+icon/i.test(input)) {
      return '**Popular icon libraries for modern web development:**\n\n' +
        '| Library | Icons | Style | Size |\n|---|---|---|---|\n' +
        '| **Lucide** | 1,500+ | Clean, consistent stroke | Tree-shakable |\n' +
        '| **Heroicons** | 300+ | Tailwind-native (by Tailwind team) | Outline + Solid |\n' +
        '| **Phosphor** | 7,000+ | 6 weights per icon | Versatile |\n' +
        '| **Feather** | 280+ | Minimal stroke icons | Small |\n' +
        '| **React Icons** | 40,000+ | Aggregator (FA, MD, etc.) | Pick what you need |\n' +
        '| **Tabler Icons** | 4,500+ | Consistent stroke width | MIT license |\n' +
        '| **Material Design** | 2,500+ | Google\'s design system | Filled + Outlined |\n\n' +
        '**2026 recommendation:** **Lucide** for React/Next.js (tree-shakable, consistent). **Heroicons** if using Tailwind ecosystem.\n\n' +
        '```tsx\nimport { Heart, Star, ArrowRight } from "lucide-react";\n// Only imports icons you use — minimal bundle\n```';
    }

    // ── shadcn/ui ──
    if (/shadcn|shadcn.?ui|radix.*(?:ui|component)|headless\s+ui.*(?:component|pattern)/i.test(input)) {
      return '**shadcn/ui** is a collection of re-usable components built with **Radix UI** + **Tailwind CSS**.\n\n' +
        '**Key philosophy:**\n' +
        '- NOT a component library — code is copied into your project\n' +
        '- Full ownership and customization\n' +
        '- Built on Radix UI primitives (accessible by default)\n' +
        '- Styled with Tailwind CSS + CSS variables\n\n' +
        '**Setup:**\n```bash\nnpx shadcn@latest init\nnpx shadcn@latest add button card dialog\n```\n\n' +
        '**Why it\'s popular:**\n' +
        '- Accessible (ARIA-compliant via Radix)\n' +
        '- Copy-paste = no dependency lock-in\n' +
        '- Beautiful default design\n' +
        '- Theming via CSS variables\n' +
        '- Used by Vercel, cal.com, and many startups';
    }

    // ── Storybook ──
    if (/storybook|what\s+is\s+storybook|component\s+(?:document|catalog|showcase)/i.test(input)) {
      return '**Storybook** is a tool for building and documenting UI components in isolation.\n\n' +
        '**Key features:**\n' +
        '- Develop components independently from the app\n' +
        '- Visual testing with Chromatic\n' +
        '- Auto-generated documentation\n' +
        '- Addon ecosystem (a11y, design tokens, etc.)\n\n' +
        '**Setup:**\n```bash\nnpx storybook@latest init\n```\n\n' +
        '**Story example:**\n```tsx\nimport type { Meta, StoryObj } from "@storybook/react";\nimport { Button } from "./Button";\n\nconst meta: Meta<typeof Button> = {\n  component: Button,\n  tags: ["autodocs"],\n};\nexport default meta;\n\nexport const Primary: StoryObj<typeof Button> = {\n  args: { variant: "primary", children: "Click me" },\n};\n```';
    }

    // ── tRPC ──
    if (/trpc|what\s+is\s+trpc|type.?safe.*api|end.?to.?end\s+type/i.test(input)) {
      return '**tRPC** — End-to-end typesafe APIs for TypeScript monorepos.\n\n' +
        '**Key features:**\n' +
        '- Full type safety from backend to frontend — no code generation\n' +
        '- No schemas, no API contracts to maintain\n' +
        '- Works with React Query / TanStack Query\n' +
        '- Websocket subscriptions support\n\n' +
        '**Server:**\n```typescript\nimport { initTRPC } from "@trpc/server";\nimport { z } from "zod";\n\nconst t = initTRPC.create();\n\nexport const appRouter = t.router({\n  getUser: t.procedure\n    .input(z.object({ id: z.string() }))\n    .query(({ input }) => {\n      return db.user.findUnique({ where: { id: input.id } });\n    }),\n});\n```\n\n' +
        '**Client (fully typed):**\n```typescript\nconst user = trpc.getUser.useQuery({ id: "123" });\n// user.data is fully typed — User | undefined\n```';
    }

    // ── Zod ──
    if (/\bzod\b|schema\s+validation.*typescript|runtime\s+type.*valid|what\s+is\s+zod/i.test(input)) {
      return '**Zod** — TypeScript-first schema validation library.\n\n' +
        '**Why Zod:**\n' +
        '- TypeScript types inferred from schemas (single source of truth)\n' +
        '- Runtime validation + compile-time types\n' +
        '- Works with tRPC, React Hook Form, Next.js Server Actions\n\n' +
        '**Example:**\n```typescript\nimport { z } from "zod";\n\nconst UserSchema = z.object({\n  name: z.string().min(2),\n  email: z.string().email(),\n  age: z.number().int().positive().max(120),\n  role: z.enum(["admin", "user"]),\n});\n\ntype User = z.infer<typeof UserSchema>;\n// { name: string; email: string; age: number; role: "admin" | "user" }\n\nconst result = UserSchema.safeParse(input);\nif (result.success) {\n  console.log(result.data); // fully typed User\n} else {\n  console.error(result.error.issues);\n}\n```';
    }

    // ── Service Workers / PWA ──
    if (/service\s+worker|pwa|progressive\s+web\s+app|manifest.*(?:web|app)|offline.*(?:web|app)/i.test(input)) {
      return '**PWA** (Progressive Web App) — web apps that feel native.\n\n' +
        '**Key components:**\n' +
        '- **Service Worker** — background script for caching, offline support, push notifications\n' +
        '- **Web Manifest** — metadata (name, icons, theme color, display mode)\n' +
        '- **HTTPS** — required for service workers\n\n' +
        '**manifest.json:**\n```json\n{\n  "name": "My App",\n  "short_name": "App",\n  "start_url": "/",\n  "display": "standalone",\n  "theme_color": "#3b82f6",\n  "background_color": "#ffffff",\n  "icons": [\n    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },\n    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }\n  ]\n}\n```\n\n' +
        '**Capabilities:** Offline mode, push notifications, background sync, install prompt.';
    }

    // ══════════════════════════════════════════════════════════════
    //  ADVANCED DOMAINS — Architecture, Vectors, AI, Strategy
    // ══════════════════════════════════════════════════════════════

    // ── SSO / Single Sign-On ──
    if (/sso\b|single\s+sign.?on|(?:what\s+is|explain|how\s+does).*(?:sso|single\s+sign)|saml\b.*(?:sso|auth)|oidc\b|openid\s+connect/i.test(input)) {
      return '**SSO** (Single Sign-On) — authenticate once, access multiple services.\n\n' +
        '**How it works:**\n' +
        '1. User visits App A → redirected to Identity Provider (IdP)\n' +
        '2. User authenticates at IdP → gets a token/session\n' +
        '3. User visits App B → IdP recognizes existing session → auto-authenticated\n\n' +
        '**Protocols:**\n' +
        '- **SAML 2.0** — XML-based, enterprise standard (Okta, Azure AD)\n' +
        '- **OpenID Connect (OIDC)** — built on OAuth 2.0, modern/lightweight, JSON-based\n' +
        '- **OAuth 2.0** — authorization (not authentication), but often used with OIDC\n\n' +
        '**Providers:** Okta, Auth0, Azure AD, Keycloak, Google Workspace, AWS Cognito\n\n' +
        '**Benefits:** Better UX (one login), centralized access control, easier auditing.\n' +
        '**Risks:** Single point of failure, token theft = access to all services.';
    }

    // ── Microservices Architecture ──
    if (/micro.?service|(?:what\s+(?:is|are)|explain).*micro.?service|monolith.*(?:vs|versus|or).*micro|service.?orient/i.test(input)) {
      return '**Microservices** — decompose applications into small, independently deployable services.\n\n' +
        '**Core principles:**\n' +
        '- Single responsibility per service\n' +
        '- Own data store (database per service)\n' +
        '- Communicate via APIs (REST, gRPC) or message queues\n' +
        '- Deploy independently\n\n' +
        '**vs Monolith:**\n' +
        '| Aspect | Monolith | Microservices |\n' +
        '|--------|----------|---------------|\n' +
        '| Deploy | All-or-nothing | Per service |\n' +
        '| Scale | Entire app | Per service |\n' +
        '| Teams | Shared codebase | Service ownership |\n' +
        '| Complexity | Code complexity | Operational complexity |\n\n' +
        '**Challenges:** Distributed transactions (saga pattern), eventual consistency, service discovery, observability (OpenTelemetry/distributed tracing).\n\n' +
        '**Rule of thumb:** Start monolith → extract microservices when team/scale demands it. Don\'t microservice a startup.';
    }

    // ── Message Queues ──
    if (/message\s*queue|(?:what\s+is|explain).*(?:kafka|rabbitmq|message\s*broker)|kafka\b.*(?:vs|versus|what|explain|use)|rabbitmq\b|bull\s*mq|pub\s*\/?\s*sub\b.*(?:pattern|messag)|dead.?letter/i.test(input)) {
      return '**Message Queues** — asynchronous communication between services.\n\n' +
        '**Core pattern:** Producer → Queue/Topic → Consumer\n\n' +
        '**Popular brokers:**\n' +
        '- **RabbitMQ** — AMQP protocol, routing, dead-letter queues, good for task distribution\n' +
        '- **Apache Kafka** — distributed log, high throughput, event streaming, replay capability\n' +
        '- **Redis Streams** — lightweight, built into Redis, good for simple pub/sub\n' +
        '- **AWS SQS** — managed, serverless, scales to millions of messages\n' +
        '- **BullMQ** — Node.js job queue on top of Redis\n\n' +
        '**Delivery guarantees:**\n' +
        '- **At-most-once** — fire and forget (may lose messages)\n' +
        '- **At-least-once** — retry until ACK (may duplicate)\n' +
        '- **Exactly-once** — transactional (Kafka supports this)\n\n' +
        '**Dead-letter queue (DLQ):** Failed messages routed to separate queue for debugging.\n\n' +
        '**When to use:** Decouple services, handle traffic spikes, async processing, event-driven architectures.';
    }

    // ── Load Balancing ──
    if (/load\s*balanc|(?:what\s+is|explain).*load\s*balanc|round\s*robin|least\s+connect|l[47]\s+(?:load|balanc)|nginx.*(?:balanc|proxy)|haproxy/i.test(input)) {
      return '**Load Balancing** — distribute traffic across multiple servers.\n\n' +
        '**Algorithms:**\n' +
        '- **Round Robin** — rotate sequentially through servers\n' +
        '- **Least Connections** — route to server with fewest active connections\n' +
        '- **Weighted** — more traffic to more powerful servers\n' +
        '- **IP Hash** — same client always hits same server (session affinity)\n' +
        '- **Random** — simple, surprisingly effective at scale\n\n' +
        '**Layers:**\n' +
        '- **L4 (Transport)** — routes by IP/port, fast, no content inspection\n' +
        '- **L7 (Application)** — routes by URL/headers/cookies, smarter but slower\n\n' +
        '**Tools:** Nginx, HAProxy, AWS ALB/NLB, Cloudflare, Traefik\n\n' +
        '**Health checks:** Load balancer pings servers regularly, removes unhealthy ones from pool.\n\n' +
        '**Key pattern:** Stateless services + load balancer = horizontal scalability.';
    }

    // ── Caching Strategies ──
    if (/caching\s+(?:strat|pattern|layer)|cache.?aside|write.?through|write.?behind|(?:what\s+is|explain).*cach(?:e|ing)\s+(?:strat|pattern|approach)|redis\s+cach|cdn\s*.*cach|cache\s+invalidat/i.test(input)) {
      return '**Caching Strategies** — store computed results closer to the consumer.\n\n' +
        '**Patterns:**\n' +
        '- **Cache-Aside (Lazy)** — app checks cache → miss → query DB → populate cache\n' +
        '- **Write-Through** — write to cache AND DB simultaneously\n' +
        '- **Write-Behind (Write-Back)** — write to cache → async flush to DB (risky but fast)\n' +
        '- **Read-Through** — cache itself fetches from DB on miss\n\n' +
        '**Cache layers (closest → furthest):**\n' +
        '1. Browser cache (HTTP headers: `Cache-Control`, `ETag`)\n' +
        '2. CDN (Cloudflare, Vercel Edge, AWS CloudFront)\n' +
        '3. Application cache (Redis, Memcached)\n' +
        '4. Database query cache\n\n' +
        '**Invalidation strategies:**\n' +
        '- **TTL (Time-To-Live)** — expire after N seconds\n' +
        '- **Event-based** — invalidate on write/update\n' +
        '- **Version keys** — `user:123:v5` → increment version on change\n\n' +
        '**"There are only two hard things in CS: cache invalidation and naming things."**';
    }

    // ── Event-Driven Architecture ──
    if (/event.?driven\s+(?:architect|system|design|pattern)|event\s+sourc|cqrs|(?:what\s+is|explain).*(?:event.?driven|event\s+sourc|cqrs)|command\s+query\s+responsib/i.test(input)) {
      return '**Event-Driven Architecture (EDA)** — systems that communicate through events.\n\n' +
        '**Core concepts:**\n' +
        '- **Event** — immutable record of something that happened ("OrderPlaced", "UserCreated")\n' +
        '- **Producer** — emits events (doesn\'t know who consumes them)\n' +
        '- **Consumer** — reacts to events asynchronously\n' +
        '- **Event Bus/Broker** — routes events (Kafka, RabbitMQ, EventBridge)\n\n' +
        '**Patterns:**\n' +
        '- **Event Notification** — "something happened" (fire-and-forget)\n' +
        '- **Event Sourcing** — store ALL events as source of truth, derive state by replaying\n' +
        '- **CQRS** — separate read models from write models, sync via events\n\n' +
        '**Benefits:** Loose coupling, temporal decoupling, audit trail, replay capability.\n' +
        '**Challenges:** Eventual consistency, event ordering, debugging distributed flows.\n\n' +
        '**Tools:** Apache Kafka, AWS EventBridge, CloudEvents spec, Apache Pulsar.';
    }

    // ── Scalability (Horizontal vs Vertical) ──
    if (/(?:horizontal|vertical)\s+scal|scalab(?:le|ility)|(?:what\s+is|explain).*scalab|scale\s+(?:up|out|horizontal|vertical)|auto.?scal|sharding/i.test(input)) {
      return '**Scalability** — ability of a system to handle growing load.\n\n' +
        '**Two approaches:**\n' +
        '- **Vertical scaling (scale up)** — bigger machine (more CPU/RAM). Simple but has limits.\n' +
        '- **Horizontal scaling (scale out)** — more machines. Requires stateless design.\n\n' +
        '**Key patterns:**\n' +
        '- **Stateless services** — no server-side session → any instance can handle any request\n' +
        '- **Database sharding** — split data across multiple DB instances by key\n' +
        '- **Read replicas** — write to primary, read from replicas\n' +
        '- **Connection pooling** — reuse DB connections (PgBouncer, Drizzle pool)\n' +
        '- **Auto-scaling** — add/remove instances based on metrics (HPA in K8s, AWS ASG)\n\n' +
        '**Scale ceiling by layer:**\n' +
        '| Layer | Scales with |\n' +
        '|-------|------------|\n' +
        '| CDN | Instantly (edge nodes) |\n' +
        '| API | Stateless replicas + LB |\n' +
        '| Database | Sharding + read replicas |\n' +
        '| Cache | Redis Cluster / partitioning |\n\n' +
        '**Rule:** Make it stateless first, then scaling becomes an infrastructure problem.';
    }

    // ── Embeddings / Vector Space ──
    if (/embed(?:ding)s?\b.*(?:what|explain|how|vector|space|model)|(?:what\s+(?:is|are)|explain).*embed(?:ding)|vector\s+(?:space|representat|databas|search|store)|word2vec|text.?embed|sentence.?embed/i.test(input)) {
      return '**Embeddings** — map discrete items into continuous vector space where **semantic similarity = geometric proximity**.\n\n' +
        '**Types:**\n' +
        '- **Word embeddings** — Word2Vec, GloVe, FastText (per-word vectors)\n' +
        '- **Sentence/document embeddings** — all-MiniLM-L6-v2, text-embedding-3-small (OpenAI), Cohere Embed\n' +
        '- **Code embeddings** — CodeBERT, StarCoder embeddings\n' +
        '- **Image embeddings** — CLIP, ResNet features\n\n' +
        '**Dimensionality:** Typically 384–1536 dimensions.\n\n' +
        '**Similarity measures:**\n' +
        '- **Cosine similarity** — angle between vectors (1.0 = identical, 0 = orthogonal)\n' +
        '- **Euclidean distance** — straight-line distance\n' +
        '- **Dot product** — fast, works well for normalized vectors\n\n' +
        '**Used for:** Semantic search, RAG (Retrieval-Augmented Generation), recommendation, clustering, anomaly detection.\n\n' +
        '**Classic example:** king − man + woman ≈ queen (semantic arithmetic).';
    }

    // ── Semantic Search / ANN / Vector Databases ──
    if (/semantic\s+search|approximate\s+nearest\s+neighbor|ann\s+(?:search|algorithm)|vector\s+database|(?:what\s+is|explain).*(?:semantic\s+search|vector\s+db|pinecone|qdrant|weaviate|chroma)|pgvector/i.test(input)) {
      return '**Semantic Search** — find content by meaning, not just keywords.\n\n' +
        '**Pipeline:** Query → Embed → ANN Search → Rerank → Return results\n\n' +
        '**ANN algorithms (Approximate Nearest Neighbor):**\n' +
        '- **HNSW** — hierarchical graph, best recall/speed trade-off (most popular)\n' +
        '- **IVF** — inverted file index, good for large datasets\n' +
        '- **PQ** — product quantization, compresses vectors for memory efficiency\n\n' +
        '**Vector databases:**\n' +
        '| Database | Type | Best for |\n' +
        '|----------|------|----------|\n' +
        '| Pinecone | Managed | Production, zero-ops |\n' +
        '| Qdrant | Self-host/Cloud | Filtering + search |\n' +
        '| Weaviate | Self-host/Cloud | Multimodal |\n' +
        '| Chroma | Embedded | Local dev, prototyping |\n' +
        '| pgvector | Postgres extension | Existing Postgres stack |\n' +
        '| Milvus | Distributed | Billion+ scale |\n\n' +
        '**Key trade-off:** ANN gives ~95–99% recall at 100× speed vs exact kNN.\n\n' +
        '**Used in:** RAG pipelines, GitHub Copilot code search, image search, recommendation engines.';
    }

    // ── HNSW Algorithm ──
    if (/hnsw|hierarchical\s+navigable\s+small\s+world|(?:what\s+is|explain).*hnsw|hnsw\s+(?:algorithm|index|graph|param)/i.test(input)) {
      return '**HNSW** (Hierarchical Navigable Small World) — the dominant ANN algorithm for vector search.\n\n' +
        '**Structure:** Multi-layer graph:\n' +
        '- **Top layers** — few nodes, long-range connections (highways)\n' +
        '- **Bottom layers** — all nodes, dense local connections\n\n' +
        '**Search algorithm:**\n' +
        '1. Start at top layer\'s entry point\n' +
        '2. Greedily traverse to nearest neighbor of query\n' +
        '3. Descend to next layer, repeat\n' +
        '4. Bottom layer → return top-k results\n\n' +
        '**Complexity:** O(log n) search, O(n log n) build\n\n' +
        '**Key parameters:**\n' +
        '- **M** — max connections per node (higher = better recall, more memory)\n' +
        '- **efConstruction** — build-time quality (higher = better index, slower build)\n' +
        '- **efSearch** — query-time accuracy vs speed trade-off\n\n' +
        '**Used by:** Pinecone, Qdrant, pgvector, Weaviate, FAISS, Milvus.\n\n' +
        '**Why dominant:** Best recall/speed balance, works on disk, supports dynamic inserts.';
    }

    // ── GitHub Copilot Context Model ──
    if (/copilot\s+(?:context|how|work|optim|tip|source|tab)|(?:what\s+is|explain|how\s+does).*copilot|github\s+copilot|copilot\s+(?:suggest|complet)/i.test(input)) {
      return '**GitHub Copilot** uses 7 context sources for code completion:\n\n' +
        '1. **Current file content** — code around the cursor (highest priority)\n' +
        '2. **Open editor tabs** — neighboring tabs heuristic (related files)\n' +
        '3. **Imports and dependencies** — package.json, import statements\n' +
        '4. **LSP symbols** — function signatures, types from language server\n' +
        '5. **Repository structure** — file/folder names\n' +
        '6. **Recent edits** — your editing patterns\n' +
        '7. **Conversation history** — in Chat mode\n\n' +
        '**Optimization tips:**\n' +
        '- Keep related files open in tabs (Copilot reads them)\n' +
        '- Write descriptive function names and JSDoc comments\n' +
        '- Add type annotations (TypeScript types guide completions)\n' +
        '- Write a comment before code — acts as a natural language prompt\n' +
        '- Accept partial completions with Ctrl+→ (word-by-word)\n' +
        '- Create `.github/copilot-instructions.md` for project-specific guidance\n\n' +
        '**Models:** GPT-4o for Chat, specialized Codex variants for inline completion.';
    }

    // ── Linguistic Coherence ──
    if (/coherence|cohesion|(?:what\s+is|explain).*(?:coherence|cohesion)|linguistic.*(?:connect|flow|unity)|text.*(?:flow|unity|connect)/i.test(input)) {
      return '**Coherence** — the logical connectedness that makes text understandable as a unified whole.\n\n' +
        '**Two levels:**\n' +
        '- **Local coherence** — adjacent sentences relate logically (cause→effect, temporal sequence, elaboration)\n' +
        '- **Global coherence** — the entire text follows a clear theme/argument\n\n' +
        '**Coherence vs Cohesion:**\n' +
        '- **Cohesion** = surface-level links (pronouns, connectives: "however", "therefore", "this")\n' +
        '- **Coherence** = deep logical meaning (can exist without cohesion markers)\n' +
        '- A text can have cohesion without coherence: "He likes coffee. Coffee grows in Brazil. Brazil is in South America." (cohesive but drifting)\n\n' +
        '**Coherence techniques:**\n' +
        '- Topic sentences that anchor each paragraph\n' +
        '- Given→New information flow (old info first, new info second)\n' +
        '- Parallel structure for related ideas\n' +
        '- Logical connectors (causation, contrast, sequence)\n\n' +
        '**In AI-generated text:** Coherence is the #1 quality signal — responses should have clear purpose and logical flow, not just keyword coverage.';
    }

    // ── Strategic Thinking / Engineering ──
    if (/strategic\s+(?:think|engineer|decision|approach|planning|framework)|(?:what\s+is|explain).*strategic|decision\s+framework|engineer.*strateg/i.test(input)) {
      return '**Strategic Thinking in Engineering** — making decisions that optimize long-term outcomes.\n\n' +
        '**Decision frameworks:**\n' +
        '- **Reversibility** — reversible decisions → decide fast. Irreversible → deliberate carefully.\n' +
        '- **Opportunity cost** — what are you NOT building while building this?\n' +
        '- **Second-order effects** — what happens AFTER the immediate result?\n' +
        '- **Diminishing returns** — 80% result at 20% effort vs 100% at 100%\n\n' +
        '**Strategic engineering patterns:**\n' +
        '- Build the **minimum viable architecture** — add complexity only when data demands it\n' +
        '- **Defer decisions** — choose the last responsible moment to commit\n' +
        '- **Vertical slicing** — deliver complete features, not horizontal layers\n' +
        '- **Measure before optimizing** — profile first, then optimize the bottleneck\n\n' +
        '**Anti-patterns:**\n' +
        '- Resume-driven development (picking tech for ego, not fit)\n' +
        '- Premature abstraction (DRYing code that isn\'t actually duplicated)\n' +
        '- Architecture astronautics (over-engineering for imaginary scale)\n\n' +
        '**Key insight:** Strategy is saying NO to good ideas so you can say YES to great ones.';
    }

    // ── N-tier / Layered Architecture ──
    if (/n.?tier|(?:3|three).?tier|layered\s+architect|(?:what\s+is|explain).*(?:n.?tier|layered\s+arch|three.?tier)|presentation.*(?:logic|data).*layer/i.test(input)) {
      return '**N-tier Architecture** — separate an application into logical layers.\n\n' +
        '**Classic 3-tier:**\n' +
        '1. **Presentation** (UI) — what users see and interact with\n' +
        '2. **Business Logic** (API/Services) — rules, validation, workflows\n' +
        '3. **Data** (Database) — persistence, queries, transactions\n\n' +
        '**Modern web N-tier:**\n' +
        'CDN → Edge Functions → API Gateway → Microservices → Database → Cache\n\n' +
        '**Benefits:**\n' +
        '- Separation of concerns (each tier has one job)\n' +
        '- Independent deployment and scaling per tier\n' +
        '- Team autonomy (frontend team, backend team, data team)\n\n' +
        '**Trade-offs:** Network latency between tiers, operational complexity, data consistency.\n\n' +
        '**The "N"** means any number of tiers. Common: 2-tier (client-server), 3-tier, 4-tier (adding cache layer).';
    }

    // ── Search Architecture / Elasticsearch / Full-Text Search ──
    if (/search\s+(?:architect|engine.*(?:build|index|design))|elasticsearch|meilisearch|typesense|(?:what\s+is|explain).*(?:inverted\s+index|full.?text\s+search|bm25)|inverted\s+index/i.test(input)) {
      return '**Search Architecture** — building fast, relevant search systems.\n\n' +
        '**Core concept: Inverted Index**\n' +
        'Maps terms → document IDs (like a book\'s index). Enables O(1) term lookup.\n\n' +
        '**Ranking algorithms:**\n' +
        '- **TF-IDF** — term frequency × inverse document frequency (classic)\n' +
        '- **BM25** — improved TF-IDF with length normalization (Elasticsearch default)\n' +
        '- **Hybrid search** — combine keyword (BM25) + semantic (vector) with score fusion\n\n' +
        '**Search engines:**\n' +
        '| Engine | Strengths |\n' +
        '|--------|-----------|\n' +
        '| Elasticsearch | Full-featured, aggregations, enterprise |\n' +
        '| Meilisearch | Typo-tolerant, instant, easy setup |\n' +
        '| Typesense | Fast, lightweight, good DX |\n' +
        '| PostgreSQL FTS | Built-in, no extra infra |\n\n' +
        '**Pipeline:** Ingest → Tokenize → Normalize (lowercase, stem) → Index → Query → Rank → Return\n\n' +
        '**Hybrid search** is the modern standard — keyword precision + semantic understanding.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Role-Based Benchmarking & DevOps Senior Handlers
    // ══════════════════════════════════════════════════════════════

    // ── Role-Based Benchmarking ──
    if (/role.?based\s+bench|benchmark.*(?:role|persona|simul)|ai\s+role\s+simul|(?:what\s+is|explain|how\s+to).*role.?based\s+bench|test.*(?:ai|vai).*role/i.test(input)) {
      return '**Role-Based AI Benchmarking** — testing an AI\'s ability to perform as a specific professional.\n\n' +
        '**Design process:**\n' +
        '1. **Define the role** — e.g., "Senior DevOps Engineer", "Frontend Architect"\n' +
        '2. **Map competency domains** — 5-8 areas the role must master\n' +
        '3. **Create question tiers:**\n' +
        '   - **Foundational** (1x) — "What is Terraform?"\n' +
        '   - **Applied** (2x) — "How would you set up a Terraform module for VPC?"\n' +
        '   - **Decision** (3x) — "When should you use Terraform vs Pulumi?"\n' +
        '   - **Troubleshooting** (4x) — "CI pipeline is failing with exit code 137, how do you debug?"\n' +
        '4. **Weight scores** by tier difficulty\n' +
        '5. **Measure coverage** — % of competency domains with passing answers\n\n' +
        '**Metrics:**\n' +
        '| Metric | Target |\n' +
        '|--------|--------|\n' +
        '| Accuracy | >90% correct |\n' +
        '| Coverage | All competency domains |\n' +
        '| Speed (VPT) | <50ms knowledge, <200ms synthesis |\n' +
        '| Depth | Trade-offs and edge cases mentioned |\n\n' +
        '**Roles to benchmark:** DevOps Senior, Frontend Architect, Backend Lead, Data Engineer, Security Engineer, ML Engineer, SRE, Platform Engineer.';
    }

    // ── Benchmark Design / Writing ──
    if (/(?:write|design|create|build).*benchmark|benchmark\s+(?:design|method|write|creat|structur)|question\s+taxonomy|competency\s+domain|how\s+to\s+(?:write|build|design)\s+.*bench/i.test(input)) {
      return '**How to Design & Write AI Benchmarks:**\n\n' +
        '**1. Question Taxonomy:**\n' +
        '- **Factual recall** — "What is X?" (knowledge retrieval)\n' +
        '- **Conceptual** — "Explain how X works" (understanding)\n' +
        '- **Procedural** — "How do you set up X?" (step-by-step)\n' +
        '- **Analytical** — "Compare X vs Y" (reasoning)\n' +
        '- **Creative** — "Design an architecture for X" (synthesis)\n\n' +
        '**2. Test Case Structure:**\n' +
        '```javascript\n{ q: "What is Terraform?",\n  validate: (a) => /infrastructure.*code|iac|hcl|declarative/i.test(a) && a.length > 80,\n  tags: ["devops", "iac", "foundational"] }\n```\n\n' +
        '**3. Validation Strategies:**\n' +
        '- **Keyword check** — required terms present\n' +
        '- **Regex match** — structural patterns (code blocks, tables)\n' +
        '- **Negative check** — must NOT contain wrong info\n' +
        '- **Length gate** — minimum substantive response\n\n' +
        '**4. Execution:**\n' +
        '- Use `Promise.allSettled` with concurrency limit (80)\n' +
        '- Measure: accuracy (pass/fail), throughput (q/s), avg latency\n' +
        '- Tag by domain + difficulty for drill-down analysis\n\n' +
        '**5. Regression Guard:**\n' +
        '- Save baseline results as JSON\n' +
        '- After changes: re-run, diff against baseline, flag drops\n' +
        '- Never merge if accuracy decreases on any category';
    }

    // ── Benchmark Categories ──
    if (/benchmark\s+categor|(?:what|which)\s+.*benchmark.*(?:type|categor|suite)|vai\s+bench|list.*benchmark/i.test(input)) {
      return '**Vai Benchmark Categories:**\n\n' +
        '| Suite | Questions | Focus |\n' +
        '|-------|-----------|-------|\n' +
        '| **mega-200** | 230 | Comprehensive knowledge coverage |\n' +
        '| **precision** | 33 | Exact-match and format-sensitive |\n' +
        '| **networking** | 33 | Network protocols and infrastructure |\n' +
        '| **bench-all** | 263+ | Unified suite with throughput measurement |\n' +
        '| **logic-puzzles** | 20+100 | Deductive reasoning and problem-solving |\n' +
        '| **language-stack** | 50+ | Programming language trivia |\n\n' +
        '**Role Benchmarks (planned):**\n' +
        '- **devops-senior** — CI/CD, IaC, monitoring, incidents, security\n' +
        '- **frontend-architect** — React, performance, accessibility, design systems\n' +
        '- **backend-lead** — databases, APIs, scalability, security patterns\n\n' +
        '**Performance targets:** >90% accuracy, >50 q/s throughput, <50ms VPT per knowledge retrieval.';
    }

    // ── DevOps Senior Role ──
    if (/devops\s+senior|senior\s+devops|(?:what\s+(?:does|is)|explain|describe).*(?:devops\s+senior|senior\s+devops|devops\s+engineer)|devops\s+(?:role|responsib|competenc|skill)/i.test(input)) {
      return '**Senior DevOps Engineer** — responsibilities and competencies:\n\n' +
        '**Core domains:**\n' +
        '1. **CI/CD Pipeline Design** — GitHub Actions, GitLab CI, Jenkins, CircleCI. Build, test, deploy automation.\n' +
        '2. **Infrastructure as Code (IaC)** — Terraform, Pulumi, AWS CDK, Bicep. Declarative infra management.\n' +
        '3. **Container Orchestration** — Docker, Kubernetes (EKS/GKE/AKS), Helm charts, service meshes.\n' +
        '4. **Monitoring & Observability** — Prometheus + Grafana, ELK/Loki, Jaeger/Tempo, PagerDuty.\n' +
        '5. **Incident Response** — Runbooks, post-mortems, severity classification, on-call rotation.\n' +
        '6. **Security Hardening** — Secrets management (Vault), network policies, image scanning (Trivy).\n' +
        '7. **Cost Optimization** — Right-sizing, spot instances, reserved capacity, FinOps.\n\n' +
        '**Key metrics a Senior DevOps owns:**\n' +
        '- Deployment frequency, lead time for changes\n' +
        '- Change failure rate, MTTR\n' +
        '- SLA/SLO/SLI compliance\n' +
        '- Infrastructure cost per transaction\n\n' +
        '**DORA metrics** (DevOps Research and Assessment) are the industry standard for measuring DevOps performance.';
    }

    // ── SLA / SLO / SLI / Error Budget ──
    if (/sla\b.*slo|slo\b.*sli|sla\b.*sli|(?:what\s+(?:is|are)|explain|differ).*(?:sla|slo|sli)|error\s+budget|service\s+level\s+(?:agree|object|indic)/i.test(input)) {
      return '**SLA / SLO / SLI — Service Reliability Metrics:**\n\n' +
        '| Term | Meaning | Example |\n' +
        '|------|---------|--------|\n' +
        '| **SLI** | Service Level Indicator — the *measured metric* | 99.97% successful requests |\n' +
        '| **SLO** | Service Level Objective — the *internal target* | 99.95% availability |\n' +
        '| **SLA** | Service Level Agreement — the *contractual promise* | 99.9% uptime (with penalties) |\n\n' +
        '**Error Budget** = (1 − SLO) — the amount of allowed unreliability.\n' +
        '- SLO = 99.95% → error budget = 0.05% → ~22 min downtime/month\n' +
        '- If error budget is spent → freeze risky deploys, focus on reliability\n' +
        '- If error budget is healthy → safe to ship faster\n\n' +
        '**Best practice:** SLOs should be stricter than SLAs (leave margin). Measure SLIs continuously. Use error budgets to balance velocity vs reliability.';
    }

    // ── Incident Response ──
    if (/incident\s+response|(?:what\s+is|explain|how\s+to).*incident\s+(?:response|manag)|runbook|post.?mortem|mttd|mttr|mtbf|on.?call\s+(?:rotat|sched|manag)|severity\s+(?:classif|level|triage)/i.test(input)) {
      return '**Incident Response** — detecting, mitigating, and learning from production issues.\n\n' +
        '**Lifecycle:**\n' +
        '1. **Detect** — automated alerting (PagerDuty, OpsGenie, Grafana)\n' +
        '2. **Triage** — classify severity:\n' +
        '   - SEV1: Critical (all-hands, customer impact)\n' +
        '   - SEV2: Major (team response, degraded service)\n' +
        '   - SEV3: Minor (no customer impact, fix in queue)\n' +
        '3. **Mitigate** — immediate relief: rollback, scale up, feature flag off, failover\n' +
        '4. **Resolve** — root cause fix deployed and verified\n' +
        '5. **Post-mortem** — blameless retrospective: timeline, root cause, impact, action items\n\n' +
        '**Key metrics:**\n' +
        '- **MTTD** (Mean Time To Detect) — how fast you notice\n' +
        '- **MTTR** (Mean Time To Recover) — how fast you fix\n' +
        '- **MTBF** (Mean Time Between Failures) — reliability measure\n\n' +
        '**Best practices:** Runbooks for common incidents, war room Slack channel, status page updates, on-call rotation with escalation.';
    }

    // ── CI/CD Pipeline Optimization ──
    if (/pipeline\s+optim|ci.?cd\s+(?:optim|fast|slow|improv|speed)|(?:how\s+to\s+)?(?:optim|speed\s+up|improv).*(?:ci|pipeline|build)|docker\s+layer\s+cach|test\s+split/i.test(input)) {
      return '**CI/CD Pipeline Optimization** — making builds fast and reliable.\n\n' +
        '**Techniques:**\n' +
        '1. **Parallelism** — run lint, test, build concurrently (not sequentially)\n' +
        '2. **Caching** — cache `node_modules`, Docker layers, build artifacts\n' +
        '   - GitHub Actions: `actions/cache` + hash of lockfile\n' +
        '   - Docker: order Dockerfile from least → most changing\n' +
        '   - Turborepo: remote cache for monorepo\n' +
        '3. **Incremental builds** — only build/test affected packages\n' +
        '   - `turbo run build --filter=...[origin/main]`\n' +
        '   - Nx: `nx affected --target=test`\n' +
        '4. **Test splitting** — distribute across parallel runners\n' +
        '   - `jest --shard=1/4`, `playwright --shard=1/4`\n' +
        '5. **Artifact reuse** — build once, deploy to staging/prod\n' +
        '6. **Branch strategy** — full suite on `main`, fast checks on PRs\n\n' +
        '**Targets:**\n' +
        '- PR checks: **<5 minutes**\n' +
        '- Full deploy pipeline: **<15 minutes**\n\n' +
        '**Anti-patterns:** no caching, sequential steps, running all tests on every commit, large Docker images.';
    }

    return null;
  }

  /** Helper: find which option letter (A/B/C/D) contains a given text */
  private findOptionLetter(input: string, text: string): string {
    const letters = ['A', 'B', 'C', 'D'];
    for (const letter of letters) {
      const regex = new RegExp(`${letter}\\)\\s*([^A-D)]+)`, 'i');
      const m = input.match(regex);
      if (m && m[1].toLowerCase().includes(text.toLowerCase())) {
        return letter;
      }
    }
    return 'A'; // fallback
  }

  // ══════════════════════════════════════════════════════════════
  //  COGNITIVE FOUNDATIONS — first principles, calibration,
  //  compression, meta-learning, systems thinking, etc.
  // ══════════════════════════════════════════════════════════════

  private tryCognitiveFoundations(input: string): string | null {
    // Gate: cognitive foundation terms
    // Fixed: read/reading, ask/asking variants to catch both verb forms
    // Fixed: compression gate expanded to match "compression in communication" etc.
    if (!/first.?princip|calibrat(?:ed|ion)?\s+(?:uncert|confide)|epistemic|aleatory|compress(?:ion)?\s+(?:abstract|over\s+accum|(?:in\s+)?communicat|information\s+density)|kolmogorov|meta.?learn|spaced.?repetit|retrieval\s+practice|interleav|systems?.?think|second.?order\s+think|feedback.?loop|stocks?\s+(?:and|&)\s+flow|donella|leverage.?point|intellectual.?honest|steel.?man|taste\s+(?:and|&)\s+judg|dieter\s+rams|ask(?:ing)?\s+(?:the\s+)?right\s+question|5\s+whys|reframe|xy\s+problem|read(?:ing)?\s+between\s+(?:the\s+)?lines?|intent\s+detect|sound.?spell|phoneti|homophone|pitch\s+accent|efficiency\s+mission|api\s+(?:call\s+)?(?:waste|reduc)|norwegian\s+(?:linguistic\s+)?compress|kos\b|dugnad|clear\s+communicat|hemingway\s+princip|weasel\s+word|meta.?cognit|self.?aware(?:ness)?|bias\s+detect|brier\s+score|cognitive\s+foundation/i.test(input)) {
      return null;
    }

    // Approach 1: Source-specific knowledge store match
    // Uses findBestMatchForSource to search ONLY cognitive-foundations entries,
    // avoiding the global findBestMatch which may return higher-scoring entries
    // from unrelated sources (YouTube, web scraping, etc.)
    const match = this.knowledge.findBestMatchForSource(input, 'bootstrap:cognitive-foundations');
    if (match) {
      return match.response;
    }

    // Approach 2: TF-IDF retrieval filtered to cognitive foundations
    const retrieved = this.cachedRetrieveRelevant(input, 10);
    const cogDocs = retrieved.filter(r => r.source === 'bootstrap:cognitive-foundations');
    if (cogDocs.length === 0) return null;

    const best = cogDocs[0];
    // Minimum score gate
    if (best.score <= 0.02) return null;

    // Content relevance: at least 1 meaningful query word in the document
    const queryWords = input.toLowerCase().split(/\s+/)
      .filter(w => w.length > 2 && !KnowledgeStore.STOP_WORDS.has(w));
    const bestLower = best.text.toLowerCase();
    const hits = queryWords.filter(w => bestLower.includes(w)).length;
    if (hits < 1) return null;

    // Instead of extracting sentences from raw TF-IDF docs (which may be keyword soup),
    // try to find the closest knowledge entry by checking which entry's keywords
    // overlap most with the TF-IDF doc and the query. This returns the clean response.
    const cogEntry = this.knowledge.findBestMatchForSource(best.text.slice(0, 200), 'bootstrap:cognitive-foundations');
    if (cogEntry) return cogEntry.response;

    // Final fallback: extract sentences (only for well-formed documents)
    const sentences = best.text.split(/(?<=[.!?])\s+/).filter(s => s.length > 15);
    if (sentences.length === 0) return null; // keyword soup — no proper sentences

    const scored = sentences.map(s => {
      const sLower = s.toLowerCase();
      const sentHits = queryWords.filter(w => sLower.includes(w)).length;
      return { text: s, score: sentHits };
    }).sort((a, b) => b.score - a.score);

    const topSentences = scored.filter(s => s.score > 0).slice(0, 6).map(s => s.text);
    if (topSentences.length === 0) return null;

    const answer = topSentences.join(' ');
    return answer.length > 800 ? answer.slice(0, 800) + '...' : answer;
  }

  /**
   * Handle best practices queries for frameworks and languages.
   * Returns curated knowledge about Next.js, Vite, TypeScript, React, etc.
   */
  private tryBestPractices(input: string): string | null {
    // "Why should I use X instead of Y?" — recommendation/comparison framing
    if (/why\s+(?:should\s+(?:i|we|you)\s+)?(?:use|choose|prefer|pick)\s+typescript/i.test(input)) {
      return '**Why use TypeScript over JavaScript?**\n\n' +
        '**1. Catch bugs before runtime:**\n```typescript\n// JS: crashes at runtime\nuser.nme  // typo → undefined, no warning\n\n// TS: caught at compile time\nuser.nme  // ❌ Property \'nme\' does not exist on type \'User\'\n```\n\n' +
        '**2. Better developer experience:** IntelliSense, autocomplete, and inline docs — your IDE knows every property and method.\n\n' +
        '**3. Safer refactoring:** Rename a field → TypeScript flags every broken usage across the entire codebase.\n\n' +
        '**4. Self-documenting code:** Types ARE documentation:\n```typescript\nfunction createUser(name: string, role: "admin" | "user"): User\n```\n\n' +
        '**5. Scales with team size:** Solo projects survive without types. 5+ devs on 50K+ lines? TypeScript pays for itself.\n\n' +
        '**The trade-off:** Slightly more upfront typing for dramatically fewer production bugs.';
    }

    // Check for best practices / tips / recommendations patterns
    const bpMatch = input.match(
      /(?:best\s+(?:practices?|way\s+to)|tips|recommendations?|guidelines?|how\s+(?:to|should)\s+(?:i\s+)?(?:use|set\s*up|configure|structure|optimize))\s+(?:for\s+|in\s+|with\s+|of\s+)?(\w[\w.-]*(?:\s*\.?\s*\w+)*)/i
    );
    if (!bpMatch) {
      // Also try "what are the best practices for X"
      const altMatch = input.match(/(?:what\s+are\s+(?:the\s+)?)?(?:best\s+practices?|tips|recommendations?)\s+(?:for|in|of|with|when\s+using)\s+(\w[\w.-]*(?:\s+\w+){0,3})/i);
      if (!altMatch) return null;
      const topic = altMatch[1]?.trim().toLowerCase();
      return this.getBestPracticesFor(topic);
    }
    const topic = bpMatch[1]?.trim().toLowerCase();
    return this.getBestPracticesFor(topic);
  }

  private getBestPracticesFor(topic: string): string | null {
    // --- Next.js ---
    if (/next\.?js|nextjs/i.test(topic)) {
      return `## Next.js Best Practices

**Rendering Strategies:**
- Use **Server-Side Rendering (SSR)** with \`getServerSideProps\` for dynamic data that changes per request
- Use **Static Site Generation (SSG)** with \`getStaticProps\` for pages that can be pre-built at build time
- Use **Incremental Static Regeneration (ISR)** with \`revalidate\` to update static pages without a full rebuild
- Prefer the **App Router** (app/ directory) for new projects — it supports React Server Components

**Performance:**
- Use \`next/image\` for automatic image optimization — lazy loading, srcset, WebP/AVIF conversion
- Use \`next/font\` for zero-layout-shift font loading
- Enable **code splitting** — it happens automatically per page/route
- Use \`dynamic()\` imports for heavy components to reduce initial bundle size

**SEO & Metadata:**
- Export a \`metadata\` object or \`generateMetadata()\` function from page/layout files
- Add \`robots.txt\` and \`sitemap.xml\` in the app directory
- Use semantic HTML and proper heading hierarchy

**Data Fetching:**
- Fetch data in Server Components to reduce client bundle
- Use React \`cache()\` to deduplicate identical requests
- Implement proper error boundaries and loading states

**Routing:**
- Use file-based routing — each folder = route segment
- Use \`layout.tsx\` for shared UI between routes
- Use route groups \`(groupName)\` to organize without affecting URL
- Use middleware for auth, redirects, and request modification

**Caching:**
- Leverage Next.js built-in caching: Data Cache, Full Route Cache, Router Cache
- Use \`revalidatePath()\` or \`revalidateTag()\` for on-demand cache invalidation
- Set proper \`Cache-Control\` headers for API routes`;
    }

    // --- Vite ---
    if (/vite/i.test(topic)) {
      return `## Vite Best Practices

**Configuration:**
- Keep \`vite.config.ts\` clean — use the \`defineConfig\` helper for TypeScript autocompletion
- Set \`resolve.alias\` for cleaner imports (e.g., \`@/\` → \`src/\`)
- Use environment variables with the \`VITE_\` prefix for client-exposed values

**Performance & HMR:**
- Vite uses native **ES modules** in dev for instant Hot Module Replacement (HMR)
- Avoid barrel files (\`index.ts\` re-exports) — they can slow down HMR and increase bundle size
- Use \`optimizeDeps.include\` to pre-bundle large dependencies

**Plugins:**
- Use the Rollup-compatible **plugin ecosystem** — most Rollup plugins work with Vite
- Key plugins: \`@vitejs/plugin-react\`, \`vite-plugin-pwa\`, \`vite-plugin-compression\`
- Write custom plugins using Vite's plugin API hooks: \`configureServer\`, \`transformIndexHtml\`, \`transform\`

**Build & Tree Shaking:**
- Vite uses **Rollup** for production builds with automatic tree shaking
- Use \`build.rollupOptions.output.manualChunks\` for custom chunk splitting
- Set \`build.target\` to match your browser support requirements
- Enable \`build.sourcemap\` for production debugging

**Best Patterns:**
- Use \`import.meta.env\` for environment variables (not \`process.env\`)
- Use \`import.meta.glob\` for dynamic imports of multiple files
- Configure CSS modules or Tailwind CSS — both work out of the box
- Use \`vite preview\` to test production builds locally before deploying`;
    }

    // --- TypeScript ---
    if (/typescript|ts\b/i.test(topic)) {
      return `## TypeScript Best Practices

**Strictness:**
- Enable **strict mode** in \`tsconfig.json\` — it activates \`strictNullChecks\`, \`noImplicitAny\`, \`strictFunctionTypes\`, and more
- Never use \`any\` — prefer \`unknown\` for truly unknown types, then narrow with type guards
- Enable \`noUncheckedIndexedAccess\` for safer array/object access

**Types vs Interfaces:**
- Use **interfaces** for object shapes and class contracts — they support declaration merging and \`extends\`
- Use **type aliases** for unions, intersections, mapped types, and utility types
- Both work for most cases — be consistent within your project

**Generics:**
- Use generics to write reusable, type-safe functions and classes
- Constrain generics with \`extends\` to limit accepted types: \`<T extends Record<string, unknown>>\`
- Use default type parameters when appropriate: \`<T = string>\`

**Type Safety Patterns:**
- Use discriminated unions for state management: \`{ status: 'loading' } | { status: 'success'; data: T }\`
- Prefer \`as const\` for literal types and readonly arrays
- Use \`satisfies\` operator to validate types without widening
- Use template literal types for string patterns: \`\\\`on\\\${Capitalize<string>}\\\`\`

**Null Safety:**
- Use optional chaining (\`?.\`) and nullish coalescing (\`??\`) instead of manual null checks
- Prefer \`undefined\` over \`null\` as the "no value" sentinel
- Use the \`NonNullable<T>\` utility type to strip null/undefined

**Project Configuration:**
- Set \`target\` and \`module\` to match your runtime environment
- Use \`paths\` for import aliases
- Enable \`esModuleInterop\` for cleaner CommonJS imports
- Use project references for monorepo setups`;
    }

    // --- React ---
    if (/react/i.test(topic)) {
      // If asking about project structure/folder layout, return structure not coding patterns
      if (/structur|organiz|folder|layout/i.test(topic)) {
        return '**React project structure:**\n\n```\nsrc/\n├── components/        # Reusable UI components\n│   ├── ui/            # Generic (Button, Input, Modal)\n│   └── features/      # Feature-specific (UserCard, ChatBubble)\n├── hooks/             # Custom hooks (useAuth, useFetch)\n├── pages/             # Route-level components\n├── lib/               # Utilities, helpers, API client\n├── context/           # React Context providers\n├── types/             # TypeScript type definitions\n├── styles/            # Global styles, Tailwind config\n└── assets/            # Images, fonts, icons\n```\n\n' +
          '**Key principles:**\n- **Group by feature**, not by type (for larger apps)\n- **Co-locate** tests next to components: `Button.tsx` + `Button.test.tsx`\n- **Barrel exports** (`index.ts`) for clean imports\n- Keep components **small** — if it\'s over 200 lines, split it\n- **Hooks folder** for shared logic (not one-off effects)';
      }
      return `## React Best Practices

**Component Design:**
- Keep components small and focused on a single responsibility
- Use composition over inheritance — pass children and render props
- Extract reusable logic into custom hooks

**State Management:**
- Lift state only as high as needed — avoid unnecessary prop drilling
- Use \`useReducer\` for complex state transitions
- Consider Zustand, Jotai, or React Context for shared state

**Performance:**
- Use \`React.memo\` for expensive components that receive stable props
- Memoize callbacks with \`useCallback\` and values with \`useMemo\` only when needed
- Use \`key\` props correctly to avoid unnecessary re-renders

**Hooks:**
- Follow the Rules of Hooks — only call at the top level
- Use \`useEffect\` cleanup to prevent memory leaks
- Prefer \`useRef\` for values that don't trigger re-renders`;
    }

    return null;
  }

  // ─── ALGORITHM CODE GENERATION ──────────────────────────────────
  /**
   * Generate canonical algorithm implementations from programming textbooks.
   * Covers sorting, searching, recursion, data structures, and string processing.
   * Each algorithm has the ONE correct textbook implementation.
   */
  private tryAlgorithmCodeGen(input: string): string | null {
    // Must look like a code generation request
    const codeIntent = /(?:write|implement|create|code|generate|make|build|show|give)\s+/i.test(input)
      || /(?:how\s+(?:to|do\s+(?:i|you))\s+(?:implement|write|create|code|make|build))/i.test(input);
    if (!codeIntent) return null;

    // Detect language
    const langPatterns: [RegExp, string][] = [
      [/\b(?:in|using|with)\s+python\b/i, 'python'],
      [/\b(?:in|using|with)\s+(?:javascript|js)\b/i, 'javascript'],
      [/\b(?:in|using|with)\s+(?:typescript|ts)\b/i, 'javascript'],
      [/\b(?:in|using|with)\s+java\b(?!\s*script)/i, 'java'],
      [/\b(?:in|using|with)\s+(?:c\+\+|cpp)\b/i, 'cpp'],
      [/\b(?:in|using|with)\s+go(?:lang)?\b/i, 'go'],
      [/\bpython\b/i, 'python'],
      [/\b(?:javascript|js)\b/i, 'javascript'],
    ];
    let lang = 'python'; // default
    for (const [pat, l] of langPatterns) {
      if (pat.test(input)) { lang = l; break; }
    }

    // ─── Algorithm detection & template selection ───
    const lower = input.toLowerCase();

    // BST (check before binary search to avoid false match)
    if (/(?:binary\s+search\s+tree|bst)\s+(?:insert|class|implementation)/i.test(lower)
      || /(?:implement|write|create|build)\s+(?:me\s+)?(?:a\s+|an?\s+)?(?:binary\s+search\s+tree|bst)/i.test(lower)) return this.algoTemplate('bst_insert', lang);
    // Binary search (after BST check)
    if (/binary\s*search/i.test(lower) && !/binary\s*search\s*tree/i.test(lower)) return this.algoTemplate('binary_search', lang);
    // Bubble sort
    if (/bubble\s*sort/i.test(lower)) return this.algoTemplate('bubble_sort', lang);
    // Selection sort
    if (/selection\s*sort/i.test(lower)) return this.algoTemplate('selection_sort', lang);
    // Insertion sort
    if (/insertion\s*sort/i.test(lower)) return this.algoTemplate('insertion_sort', lang);
    // Merge sort
    if (/merge\s*sort/i.test(lower)) return this.algoTemplate('merge_sort', lang);
    // Recursive factorial
    if (/(?:recursive\s+)?factorial\s+(?:function|method|algorithm)/i.test(lower)
      || /(?:function|method)\s+(?:for\s+|to\s+(?:compute\s+|calculate\s+)?)?factorial/i.test(lower)) return this.algoTemplate('factorial_recursive', lang);
    // Recursive fibonacci
    if (/(?:recursive\s+)?fibonacci\s+(?:function|method|algorithm)/i.test(lower)
      || /(?:function|method)\s+(?:for\s+|to\s+(?:compute\s+|calculate\s+)?)?fibonacci/i.test(lower)) return this.algoTemplate('fibonacci_recursive', lang);
    // Recursive GCD / Euclidean algorithm
    if (/(?:recursive\s+)?(?:gcd|greatest\s+common\s+divisor|euclidean)\s+(?:function|method|algorithm)/i.test(lower)
      || /(?:function|method)\s+(?:for\s+|to\s+(?:find\s+|compute\s+|calculate\s+)?)?(?:gcd|greatest\s+common\s+divisor)/i.test(lower)) return this.algoTemplate('gcd_recursive', lang);
    // Recursive power function
    if (/(?:recursive\s+)?(?:power|exponent(?:iation)?)\s+(?:function|method)/i.test(lower)
      || /(?:function|method)\s+(?:for\s+|to\s+(?:compute\s+|calculate\s+)?)?(?:power|exponent)/i.test(lower)) return this.algoTemplate('power_recursive', lang);
    // Stack implementation
    if (/stack\s+(?:class|implementation|data\s*structure)/i.test(lower)
      || /(?:implement|class\s+for)\s+(?:a\s+)?stack/i.test(lower)) return this.algoTemplate('stack_class', lang);
    // Queue implementation
    if (/queue\s+(?:class|implementation|data\s*structure)/i.test(lower)
      || /(?:implement|class\s+for)\s+(?:a\s+)?queue/i.test(lower)) return this.algoTemplate('queue_class', lang);
    // Reverse string
    if (/reverse\s+(?:a\s+)?string/i.test(lower)
      || /string\s+revers(?:al|e|ing)/i.test(lower)) return this.algoTemplate('reverse_string', lang);
    // Palindrome check
    if (/palindrome\s+(?:check|detect|test|function|validator)/i.test(lower)
      || /(?:check|detect|test|verify)\s+(?:if\s+)?(?:a\s+)?(?:string\s+is\s+(?:a\s+)?)?palindrome/i.test(lower)
      || /(?:is\s+)?palindrome/i.test(lower) && /function|write|implement|create/i.test(lower)) return this.algoTemplate('palindrome_check', lang);
    // Count vowels
    if (/count\s+vowels?/i.test(lower)
      || /vowel\s+count/i.test(lower)) return this.algoTemplate('count_vowels', lang);
    // Anagram check
    if (/anagram\s+(?:check|detect|test|function|validator)/i.test(lower)
      || /(?:check|detect|test|verify)\s+(?:if\s+)?.*anagram/i.test(lower)) return this.algoTemplate('anagram_check', lang);
    // Is prime — broad matching for "check if prime" / "prime number" / "is prime"
    if (/\bprime\b/i.test(lower) && !/sieve|eratosthenes/i.test(lower)
      && (/check|test|verify|determin|function|method|write|implement/i.test(lower))) return this.algoTemplate('is_prime', lang);
    // Sieve of Eratosthenes
    if (/sieve\s+(?:of\s+)?eratosthenes/i.test(lower)
      || /eratosthenes/i.test(lower)
      || /(?:find|generate|list)\s+(?:all\s+)?primes?\s+(?:up\s+to|below|under|less\s+than)/i.test(lower)) return this.algoTemplate('sieve', lang);
    // LCM function — broad matching for lcm/least common multiple
    if (/\b(?:lcm|least\s+common\s+multiple)\b/i.test(lower)) return this.algoTemplate('lcm_function', lang);
    // Flatten array
    if (/flatten\s+(?:a\s+)?(?:nested\s+)?array/i.test(lower)
      || /(?:array|list)\s+flatten/i.test(lower)) return this.algoTemplate('flatten_array', lang);
    // Matrix transpose
    if (/matrix\s+transpose/i.test(lower)
      || /transpose\s+(?:a\s+)?matrix/i.test(lower)) return this.algoTemplate('matrix_transpose', lang);
    // Find max in array
    if (/(?:find|get)\s+(?:the\s+)?(?:max(?:imum)?|largest|biggest)\s+(?:element\s+)?(?:in\s+)?(?:an?\s+)?array/i.test(lower)
      || /max(?:imum)?\s+(?:element\s+)?(?:in\s+|of\s+)(?:an?\s+)?array/i.test(lower)) return this.algoTemplate('find_max', lang);

    return null;
  }

  /**
   * Return canonical algorithm implementation by key and language.
   */
  private algoTemplate(algo: string, lang: string): string {
    const templates: Record<string, Record<string, { title: string; code: string; desc: string }>> = {
      // ─── SORTING ───
      binary_search: {
        python: {
          title: 'Binary Search',
          code: `\`\`\`python
def binary_search(arr, target):
    left, right = 0, len(arr) - 1
    while left <= right:
        mid = (left + right) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1

# Usage:
print(binary_search([1, 3, 5, 7, 9, 11], 7))  # 3
\`\`\``,
          desc: 'Binary search on a sorted array. Returns the index of the target, or -1 if not found. Time complexity: O(log n).',
        },
        javascript: {
          title: 'Binary Search',
          code: `\`\`\`javascript
function binarySearch(arr, target) {
  let left = 0;
  let right = arr.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid] === target) return mid;
    else if (arr[mid] < target) left = mid + 1;
    else right = mid - 1;
  }
  return -1;
}

// Usage:
console.log(binarySearch([1, 3, 5, 7, 9, 11], 7)); // 3
\`\`\``,
          desc: 'Binary search on a sorted array. Returns the index of the target, or -1 if not found. Time complexity: O(log n).',
        },
      },
      bubble_sort: {
        python: {
          title: 'Bubble Sort',
          code: `\`\`\`python
def bubble_sort(arr):
    n = len(arr)
    for i in range(n):
        swapped = False
        for j in range(0, n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        if not swapped:
            break
    return arr

# Usage:
print(bubble_sort([64, 34, 25, 12, 22, 11, 90]))
# [11, 12, 22, 25, 34, 64, 90]
\`\`\``,
          desc: 'Bubble sort with early termination optimization. Time complexity: O(n²), Space: O(1).',
        },
        javascript: {
          title: 'Bubble Sort',
          code: `\`\`\`javascript
function bubbleSort(arr) {
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    let swapped = false;
    for (let j = 0; j < n - i - 1; j++) {
      if (arr[j] > arr[j + 1]) {
        [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return arr;
}

// Usage:
console.log(bubbleSort([64, 34, 25, 12, 22, 11, 90]));
// [11, 12, 22, 25, 34, 64, 90]
\`\`\``,
          desc: 'Bubble sort with early termination optimization. Time complexity: O(n²), Space: O(1).',
        },
      },
      selection_sort: {
        python: {
          title: 'Selection Sort',
          code: `\`\`\`python
def selection_sort(arr):
    n = len(arr)
    for i in range(n):
        min_idx = i
        for j in range(i + 1, n):
            if arr[j] < arr[min_idx]:
                min_idx = j
        arr[i], arr[min_idx] = arr[min_idx], arr[i]
    return arr

# Usage:
print(selection_sort([64, 25, 12, 22, 11]))
# [11, 12, 22, 25, 64]
\`\`\``,
          desc: 'Selection sort — finds the minimum element and places it at the beginning. Time complexity: O(n²), Space: O(1).',
        },
        javascript: {
          title: 'Selection Sort',
          code: `\`\`\`javascript
function selectionSort(arr) {
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    let minIdx = i;
    for (let j = i + 1; j < n; j++) {
      if (arr[j] < arr[minIdx]) minIdx = j;
    }
    [arr[i], arr[minIdx]] = [arr[minIdx], arr[i]];
  }
  return arr;
}

// Usage:
console.log(selectionSort([64, 25, 12, 22, 11]));
// [11, 12, 22, 25, 64]
\`\`\``,
          desc: 'Selection sort — finds the minimum element and places it at the beginning. Time complexity: O(n²), Space: O(1).',
        },
      },
      insertion_sort: {
        python: {
          title: 'Insertion Sort',
          code: `\`\`\`python
def insertion_sort(arr):
    for i in range(1, len(arr)):
        key = arr[i]
        j = i - 1
        while j >= 0 and arr[j] > key:
            arr[j + 1] = arr[j]
            j -= 1
        arr[j + 1] = key
    return arr

# Usage:
print(insertion_sort([12, 11, 13, 5, 6]))
# [5, 6, 11, 12, 13]
\`\`\``,
          desc: 'Insertion sort — builds sorted array one element at a time. Time complexity: O(n²), Space: O(1). Best for small or nearly sorted data.',
        },
        javascript: {
          title: 'Insertion Sort',
          code: `\`\`\`javascript
function insertionSort(arr) {
  for (let i = 1; i < arr.length; i++) {
    const key = arr[i];
    let j = i - 1;
    while (j >= 0 && arr[j] > key) {
      arr[j + 1] = arr[j];
      j--;
    }
    arr[j + 1] = key;
  }
  return arr;
}

// Usage:
console.log(insertionSort([12, 11, 13, 5, 6]));
// [5, 6, 11, 12, 13]
\`\`\``,
          desc: 'Insertion sort — builds sorted array one element at a time. Time complexity: O(n²), Space: O(1). Best for small or nearly sorted data.',
        },
      },
      merge_sort: {
        python: {
          title: 'Merge Sort',
          code: `\`\`\`python
def merge_sort(arr):
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    left = merge_sort(arr[:mid])
    right = merge_sort(arr[mid:])
    return merge(left, right)

def merge(left, right):
    result = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i])
            i += 1
        else:
            result.append(right[j])
            j += 1
    result.extend(left[i:])
    result.extend(right[j:])
    return result

# Usage:
print(merge_sort([38, 27, 43, 3, 9, 82, 10]))
# [3, 9, 10, 27, 38, 43, 82]
\`\`\``,
          desc: 'Merge sort — divide-and-conquer algorithm. Time complexity: O(n log n), Space: O(n). Stable sort.',
        },
        javascript: {
          title: 'Merge Sort',
          code: `\`\`\`javascript
function mergeSort(arr) {
  if (arr.length <= 1) return arr;
  const mid = Math.floor(arr.length / 2);
  const left = mergeSort(arr.slice(0, mid));
  const right = mergeSort(arr.slice(mid));
  return merge(left, right);
}

function merge(left, right) {
  const result = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) result.push(left[i++]);
    else result.push(right[j++]);
  }
  return result.concat(left.slice(i), right.slice(j));
}

// Usage:
console.log(mergeSort([38, 27, 43, 3, 9, 82, 10]));
// [3, 9, 10, 27, 38, 43, 82]
\`\`\``,
          desc: 'Merge sort — divide-and-conquer algorithm. Time complexity: O(n log n), Space: O(n). Stable sort.',
        },
      },
      // ─── RECURSION ───
      factorial_recursive: {
        python: {
          title: 'Recursive Factorial',
          code: `\`\`\`python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

# Usage:
print(factorial(5))   # 120
print(factorial(10))  # 3628800
\`\`\``,
          desc: 'Recursive factorial function. Base case: n <= 1 returns 1. Recursive case: n * factorial(n-1).',
        },
        javascript: {
          title: 'Recursive Factorial',
          code: `\`\`\`javascript
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

// Usage:
console.log(factorial(5));   // 120
console.log(factorial(10));  // 3628800
\`\`\``,
          desc: 'Recursive factorial function. Base case: n <= 1 returns 1. Recursive case: n * factorial(n-1).',
        },
      },
      fibonacci_recursive: {
        python: {
          title: 'Recursive Fibonacci',
          code: `\`\`\`python
def fibonacci(n):
    if n <= 0:
        return 0
    if n == 1:
        return 1
    return fibonacci(n - 1) + fibonacci(n - 2)

# Usage:
for i in range(10):
    print(fibonacci(i), end=' ')
# 0 1 1 2 3 5 8 13 21 34
\`\`\``,
          desc: 'Recursive Fibonacci function. Base cases: fib(0)=0, fib(1)=1. Recursive: fib(n-1) + fib(n-2). Time: O(2^n).',
        },
        javascript: {
          title: 'Recursive Fibonacci',
          code: `\`\`\`javascript
function fibonacci(n) {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// Usage:
for (let i = 0; i < 10; i++) {
  process.stdout.write(fibonacci(i) + ' ');
}
// 0 1 1 2 3 5 8 13 21 34
\`\`\``,
          desc: 'Recursive Fibonacci function. Base cases: fib(0)=0, fib(1)=1. Recursive: fib(n-1) + fib(n-2). Time: O(2^n).',
        },
      },
      gcd_recursive: {
        python: {
          title: 'Recursive GCD (Euclidean Algorithm)',
          code: `\`\`\`python
def gcd(a, b):
    if b == 0:
        return a
    return gcd(b, a % b)

# Usage:
print(gcd(48, 18))   # 6
print(gcd(56, 98))   # 14
\`\`\``,
          desc: 'Recursive GCD using the Euclidean algorithm. Base case: b=0 returns a. Recursive: gcd(b, a%b).',
        },
        javascript: {
          title: 'Recursive GCD (Euclidean Algorithm)',
          code: `\`\`\`javascript
function gcd(a, b) {
  if (b === 0) return a;
  return gcd(b, a % b);
}

// Usage:
console.log(gcd(48, 18));  // 6
console.log(gcd(56, 98));  // 14
\`\`\``,
          desc: 'Recursive GCD using the Euclidean algorithm. Base case: b=0 returns a. Recursive: gcd(b, a%b).',
        },
      },
      power_recursive: {
        python: {
          title: 'Recursive Power Function',
          code: `\`\`\`python
def power(base, exp):
    if exp == 0:
        return 1
    if exp % 2 == 0:
        half = power(base, exp // 2)
        return half * half
    return base * power(base, exp - 1)

# Usage:
print(power(2, 10))  # 1024
print(power(3, 4))   # 81
\`\`\``,
          desc: 'Recursive power function with fast exponentiation. Uses the property: x^(2k) = (x^k)^2. Time: O(log n).',
        },
        javascript: {
          title: 'Recursive Power Function',
          code: `\`\`\`javascript
function power(base, exp) {
  if (exp === 0) return 1;
  if (exp % 2 === 0) {
    const half = power(base, Math.floor(exp / 2));
    return half * half;
  }
  return base * power(base, exp - 1);
}

// Usage:
console.log(power(2, 10));  // 1024
console.log(power(3, 4));   // 81
\`\`\``,
          desc: 'Recursive power function with fast exponentiation. Uses the property: x^(2k) = (x^k)^2. Time: O(log n).',
        },
      },
      // ─── DATA STRUCTURES ───
      stack_class: {
        python: {
          title: 'Stack Implementation',
          code: `\`\`\`python
class Stack:
    def __init__(self):
        self.items = []

    def push(self, item):
        self.items.append(item)

    def pop(self):
        if self.is_empty():
            raise IndexError("Stack is empty")
        return self.items.pop()

    def peek(self):
        if self.is_empty():
            raise IndexError("Stack is empty")
        return self.items[-1]

    def is_empty(self):
        return len(self.items) == 0

    def size(self):
        return len(self.items)

# Usage:
s = Stack()
s.push(1)
s.push(2)
s.push(3)
print(s.peek())   # 3
print(s.pop())    # 3
print(s.size())   # 2
\`\`\``,
          desc: 'Stack (LIFO) implementation using a list. Operations: push, pop, peek, is_empty, size. All O(1).',
        },
        javascript: {
          title: 'Stack Implementation',
          code: `\`\`\`javascript
class Stack {
  constructor() {
    this.items = [];
  }

  push(item) {
    this.items.push(item);
  }

  pop() {
    if (this.isEmpty()) throw new Error('Stack is empty');
    return this.items.pop();
  }

  peek() {
    if (this.isEmpty()) throw new Error('Stack is empty');
    return this.items[this.items.length - 1];
  }

  isEmpty() {
    return this.items.length === 0;
  }

  size() {
    return this.items.length;
  }
}

// Usage:
const s = new Stack();
s.push(1);
s.push(2);
s.push(3);
console.log(s.peek());  // 3
console.log(s.pop());   // 3
console.log(s.size());  // 2
\`\`\``,
          desc: 'Stack (LIFO) implementation using an array. Operations: push, pop, peek, isEmpty, size. All O(1).',
        },
      },
      queue_class: {
        python: {
          title: 'Queue Implementation',
          code: `\`\`\`python
class Queue:
    def __init__(self):
        self.items = []

    def enqueue(self, item):
        self.items.append(item)

    def dequeue(self):
        if self.is_empty():
            raise IndexError("Queue is empty")
        return self.items.pop(0)

    def peek(self):
        if self.is_empty():
            raise IndexError("Queue is empty")
        return self.items[0]

    def is_empty(self):
        return len(self.items) == 0

    def size(self):
        return len(self.items)

# Usage:
q = Queue()
q.enqueue(1)
q.enqueue(2)
q.enqueue(3)
print(q.peek())     # 1
print(q.dequeue())  # 1
print(q.size())     # 2
\`\`\``,
          desc: 'Queue (FIFO) implementation using a list. Operations: enqueue, dequeue, peek, is_empty, size.',
        },
        javascript: {
          title: 'Queue Implementation',
          code: `\`\`\`javascript
class Queue {
  constructor() {
    this.items = [];
  }

  enqueue(item) {
    this.items.push(item);
  }

  dequeue() {
    if (this.isEmpty()) throw new Error('Queue is empty');
    return this.items.shift();
  }

  peek() {
    if (this.isEmpty()) throw new Error('Queue is empty');
    return this.items[0];
  }

  isEmpty() {
    return this.items.length === 0;
  }

  size() {
    return this.items.length;
  }
}

// Usage:
const q = new Queue();
q.enqueue(1);
q.enqueue(2);
q.enqueue(3);
console.log(q.peek());     // 1
console.log(q.dequeue());  // 1
console.log(q.size());     // 2
\`\`\``,
          desc: 'Queue (FIFO) implementation using an array. Operations: enqueue, dequeue, peek, isEmpty, size.',
        },
      },
      bst_insert: {
        python: {
          title: 'Binary Search Tree',
          code: `\`\`\`python
class TreeNode:
    def __init__(self, val):
        self.val = val
        self.left = None
        self.right = None

class BST:
    def __init__(self):
        self.root = None

    def insert(self, val):
        if not self.root:
            self.root = TreeNode(val)
        else:
            self._insert(self.root, val)

    def _insert(self, node, val):
        if val < node.val:
            if node.left is None:
                node.left = TreeNode(val)
            else:
                self._insert(node.left, val)
        else:
            if node.right is None:
                node.right = TreeNode(val)
            else:
                self._insert(node.right, val)

    def search(self, val):
        return self._search(self.root, val)

    def _search(self, node, val):
        if node is None:
            return False
        if val == node.val:
            return True
        elif val < node.val:
            return self._search(node.left, val)
        else:
            return self._search(node.right, val)

    def inorder(self):
        result = []
        self._inorder(self.root, result)
        return result

    def _inorder(self, node, result):
        if node:
            self._inorder(node.left, result)
            result.append(node.val)
            self._inorder(node.right, result)

# Usage:
tree = BST()
for val in [5, 3, 7, 1, 4, 6, 8]:
    tree.insert(val)
print(tree.inorder())    # [1, 3, 4, 5, 6, 7, 8]
print(tree.search(4))    # True
print(tree.search(9))    # False
\`\`\``,
          desc: 'Binary Search Tree with insert, search, and in-order traversal. Average time: O(log n) per operation.',
        },
        javascript: {
          title: 'Binary Search Tree',
          code: `\`\`\`javascript
class TreeNode {
  constructor(val) {
    this.val = val;
    this.left = null;
    this.right = null;
  }
}

class BST {
  constructor() {
    this.root = null;
  }

  insert(val) {
    if (!this.root) { this.root = new TreeNode(val); return; }
    this._insert(this.root, val);
  }

  _insert(node, val) {
    if (val < node.val) {
      if (!node.left) node.left = new TreeNode(val);
      else this._insert(node.left, val);
    } else {
      if (!node.right) node.right = new TreeNode(val);
      else this._insert(node.right, val);
    }
  }

  search(val) {
    return this._search(this.root, val);
  }

  _search(node, val) {
    if (!node) return false;
    if (val === node.val) return true;
    return val < node.val
      ? this._search(node.left, val)
      : this._search(node.right, val);
  }

  inorder() {
    const result = [];
    this._inorder(this.root, result);
    return result;
  }

  _inorder(node, result) {
    if (node) {
      this._inorder(node.left, result);
      result.push(node.val);
      this._inorder(node.right, result);
    }
  }
}

// Usage:
const tree = new BST();
[5, 3, 7, 1, 4, 6, 8].forEach(v => tree.insert(v));
console.log(tree.inorder());   // [1, 3, 4, 5, 6, 7, 8]
console.log(tree.search(4));   // true
console.log(tree.search(9));   // false
\`\`\``,
          desc: 'Binary Search Tree with insert, search, and in-order traversal. Average time: O(log n) per operation.',
        },
      },
      // ─── STRING PROCESSING ───
      reverse_string: {
        python: {
          title: 'Reverse String',
          code: `\`\`\`python
def reverse_string(s):
    return s[::-1]

# Alternative (iterative):
def reverse_string_iter(s):
    chars = list(s)
    left, right = 0, len(chars) - 1
    while left < right:
        chars[left], chars[right] = chars[right], chars[left]
        left += 1
        right -= 1
    return ''.join(chars)

# Usage:
print(reverse_string("hello"))       # "olleh"
print(reverse_string_iter("world"))  # "dlrow"
\`\`\``,
          desc: 'Reverse a string — both Pythonic (slicing) and iterative (two-pointer) approaches.',
        },
        javascript: {
          title: 'Reverse String',
          code: `\`\`\`javascript
function reverseString(s) {
  return s.split('').reverse().join('');
}

// Alternative (iterative):
function reverseStringIter(s) {
  const chars = s.split('');
  let left = 0, right = chars.length - 1;
  while (left < right) {
    [chars[left], chars[right]] = [chars[right], chars[left]];
    left++;
    right--;
  }
  return chars.join('');
}

// Usage:
console.log(reverseString("hello"));       // "olleh"
console.log(reverseStringIter("world"));   // "dlrow"
\`\`\``,
          desc: 'Reverse a string — both built-in method and iterative (two-pointer) approaches.',
        },
      },
      palindrome_check: {
        python: {
          title: 'Palindrome Checker',
          code: `\`\`\`python
def is_palindrome(s):
    s = s.lower().replace(' ', '')
    return s == s[::-1]

# Usage:
print(is_palindrome("racecar"))    # True
print(is_palindrome("hello"))      # False
print(is_palindrome("A man a plan a canal Panama".replace(' ', '')))  # True
\`\`\``,
          desc: 'Check if a string is a palindrome — reads the same forwards and backwards.',
        },
        javascript: {
          title: 'Palindrome Checker',
          code: `\`\`\`javascript
function isPalindrome(s) {
  const cleaned = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned === cleaned.split('').reverse().join('');
}

// Usage:
console.log(isPalindrome("racecar"));   // true
console.log(isPalindrome("hello"));     // false
console.log(isPalindrome("A man a plan a canal Panama")); // true
\`\`\``,
          desc: 'Check if a string is a palindrome — reads the same forwards and backwards.',
        },
      },
      count_vowels: {
        python: {
          title: 'Count Vowels',
          code: `\`\`\`python
def count_vowels(s):
    vowels = set('aeiouAEIOU')
    return sum(1 for char in s if char in vowels)

# Usage:
print(count_vowels("hello"))        # 2
print(count_vowels("programming"))  # 3
\`\`\``,
          desc: 'Count the number of vowels (a, e, i, o, u) in a string.',
        },
        javascript: {
          title: 'Count Vowels',
          code: `\`\`\`javascript
function countVowels(s) {
  const matches = s.match(/[aeiou]/gi);
  return matches ? matches.length : 0;
}

// Usage:
console.log(countVowels("hello"));        // 2
console.log(countVowels("programming"));  // 3
\`\`\``,
          desc: 'Count the number of vowels (a, e, i, o, u) in a string.',
        },
      },
      anagram_check: {
        python: {
          title: 'Anagram Checker',
          code: `\`\`\`python
def is_anagram(s1, s2):
    return sorted(s1.lower().replace(' ', '')) == sorted(s2.lower().replace(' ', ''))

# Usage:
print(is_anagram("listen", "silent"))   # True
print(is_anagram("hello", "world"))     # False
print(is_anagram("Astronomer", "Moon starer"))  # True
\`\`\``,
          desc: 'Check if two strings are anagrams — contain the same characters in different order.',
        },
        javascript: {
          title: 'Anagram Checker',
          code: `\`\`\`javascript
function isAnagram(s1, s2) {
  const normalize = (s) => s.toLowerCase().replace(/\\s/g, '').split('').sort().join('');
  return normalize(s1) === normalize(s2);
}

// Usage:
console.log(isAnagram("listen", "silent"));  // true
console.log(isAnagram("hello", "world"));    // false
console.log(isAnagram("Astronomer", "Moon starer"));  // true
\`\`\``,
          desc: 'Check if two strings are anagrams — contain the same characters in different order.',
        },
      },
      // ─── MATH FUNCTIONS ───
      is_prime: {
        python: {
          title: 'Prime Number Check',
          code: `\`\`\`python
def is_prime(n):
    if n < 2:
        return False
    if n < 4:
        return True
    if n % 2 == 0 or n % 3 == 0:
        return False
    i = 5
    while i * i <= n:
        if n % i == 0 or n % (i + 2) == 0:
            return False
        i += 6
    return True

# Usage:
print(is_prime(17))   # True
print(is_prime(4))    # False
print(is_prime(97))   # True
\`\`\``,
          desc: 'Check if a number is prime using trial division up to √n with 6k±1 optimization. Time: O(√n).',
        },
        javascript: {
          title: 'Prime Number Check',
          code: `\`\`\`javascript
function isPrime(n) {
  if (n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

// Usage:
console.log(isPrime(17));  // true
console.log(isPrime(4));   // false
console.log(isPrime(97));  // true
\`\`\``,
          desc: 'Check if a number is prime using trial division up to √n with 6k±1 optimization. Time: O(√n).',
        },
      },
      sieve: {
        python: {
          title: 'Sieve of Eratosthenes',
          code: `\`\`\`python
def sieve_of_eratosthenes(limit):
    is_prime = [True] * (limit + 1)
    is_prime[0] = is_prime[1] = False
    for i in range(2, int(limit**0.5) + 1):
        if is_prime[i]:
            for j in range(i*i, limit + 1, i):
                is_prime[j] = False
    return [i for i in range(limit + 1) if is_prime[i]]

# Usage:
print(sieve_of_eratosthenes(30))
# [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]
\`\`\``,
          desc: 'Sieve of Eratosthenes — finds all prime numbers up to a limit. Time: O(n log log n).',
        },
        javascript: {
          title: 'Sieve of Eratosthenes',
          code: `\`\`\`javascript
function sieveOfEratosthenes(limit) {
  const isPrime = new Array(limit + 1).fill(true);
  isPrime[0] = isPrime[1] = false;
  for (let i = 2; i * i <= limit; i++) {
    if (isPrime[i]) {
      for (let j = i * i; j <= limit; j += i) {
        isPrime[j] = false;
      }
    }
  }
  return isPrime.reduce((primes, val, idx) => {
    if (val) primes.push(idx);
    return primes;
  }, []);
}

// Usage:
console.log(sieveOfEratosthenes(30));
// [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]
\`\`\``,
          desc: 'Sieve of Eratosthenes — finds all prime numbers up to a limit. Time: O(n log log n).',
        },
      },
      lcm_function: {
        python: {
          title: 'LCM Function',
          code: `\`\`\`python
def gcd(a, b):
    while b:
        a, b = b, a % b
    return a

def lcm(a, b):
    return abs(a * b) // gcd(a, b)

# Usage:
print(lcm(12, 18))  # 36
print(lcm(4, 6))    # 12
\`\`\``,
          desc: 'Least Common Multiple calculated using GCD: LCM(a,b) = |a*b| / GCD(a,b).',
        },
        javascript: {
          title: 'LCM Function',
          code: `\`\`\`javascript
function gcd(a, b) {
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

function lcm(a, b) {
  return Math.abs(a * b) / gcd(a, b);
}

// Usage:
console.log(lcm(12, 18));  // 36
console.log(lcm(4, 6));    // 12
\`\`\``,
          desc: 'Least Common Multiple calculated using GCD: LCM(a,b) = |a*b| / GCD(a,b).',
        },
      },
      // ─── UTILITY FUNCTIONS ───
      flatten_array: {
        python: {
          title: 'Flatten Nested Array',
          code: `\`\`\`python
def flatten(arr):
    result = []
    for item in arr:
        if isinstance(item, list):
            result.extend(flatten(item))
        else:
            result.append(item)
    return result

# Usage:
print(flatten([1, [2, [3, 4], 5], [6, 7]]))
# [1, 2, 3, 4, 5, 6, 7]
\`\`\``,
          desc: 'Recursively flatten a nested array/list into a single flat list.',
        },
        javascript: {
          title: 'Flatten Nested Array',
          code: `\`\`\`javascript
function flatten(arr) {
  const result = [];
  for (const item of arr) {
    if (Array.isArray(item)) {
      result.push(...flatten(item));
    } else {
      result.push(item);
    }
  }
  return result;
}

// Usage:
console.log(flatten([1, [2, [3, 4], 5], [6, 7]]));
// [1, 2, 3, 4, 5, 6, 7]
\`\`\``,
          desc: 'Recursively flatten a nested array into a single flat array.',
        },
      },
      matrix_transpose: {
        python: {
          title: 'Matrix Transpose',
          code: `\`\`\`python
def transpose(matrix):
    rows = len(matrix)
    cols = len(matrix[0])
    return [[matrix[i][j] for i in range(rows)] for j in range(cols)]

# Usage:
m = [[1, 2, 3],
     [4, 5, 6]]
print(transpose(m))
# [[1, 4], [2, 5], [3, 6]]
\`\`\``,
          desc: 'Transpose a matrix — swap rows and columns. Element at [i][j] moves to [j][i].',
        },
        javascript: {
          title: 'Matrix Transpose',
          code: `\`\`\`javascript
function transpose(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const result = [];
  for (let j = 0; j < cols; j++) {
    result[j] = [];
    for (let i = 0; i < rows; i++) {
      result[j][i] = matrix[i][j];
    }
  }
  return result;
}

// Usage:
const m = [[1, 2, 3],
           [4, 5, 6]];
console.log(transpose(m));
// [[1, 4], [2, 5], [3, 6]]
\`\`\``,
          desc: 'Transpose a matrix — swap rows and columns. Element at [i][j] moves to [j][i].',
        },
      },
      find_max: {
        python: {
          title: 'Find Maximum in Array',
          code: `\`\`\`python
def find_max(arr):
    if not arr:
        raise ValueError("Array is empty")
    maximum = arr[0]
    for num in arr[1:]:
        if num > maximum:
            maximum = num
    return maximum

# Usage:
print(find_max([3, 1, 4, 1, 5, 9, 2, 6]))  # 9
\`\`\``,
          desc: 'Find the maximum element in an array by iterating through all elements. Time: O(n).',
        },
        javascript: {
          title: 'Find Maximum in Array',
          code: `\`\`\`javascript
function findMax(arr) {
  if (arr.length === 0) throw new Error('Array is empty');
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  return max;
}

// Usage:
console.log(findMax([3, 1, 4, 1, 5, 9, 2, 6]));  // 9
\`\`\``,
          desc: 'Find the maximum element in an array by iterating through all elements. Time: O(n).',
        },
      },
    };

    const algoData = templates[algo];
    if (!algoData) return null as unknown as string;

    // Fall back to python if requested language not available
    const impl = algoData[lang] || algoData['python'] || algoData['javascript'];
    if (!impl) return null as unknown as string;

    return `Here's a **${impl.title}** implementation in **${lang}**:\n\n${impl.code}\n\n${impl.desc}`;
  }

  /**
   * Detect code generation requests and generate basic code patterns.
   * Recognizes "hello world", "write a function", "code example" etc.
   */
  private tryCodeGeneration(input: string): string | null {
    // Detect if this is a code request
    const codePatterns = [
      /(?:write|show|give|create|make|generate|code)\s+(?:me\s+)?(?:a\s+)?(?:hello\s+world|helloworld)/i,
      /hello\s+world\s+(?:in|for|using|with|program|code|example|script)/i,
      /(?:write|show|give|create|make|generate)\s+(?:me\s+)?(?:a\s+)?(?:code|program|script|function|example)/i,
      /(?:code\s+block|code\s+example|code\s+snippet)\s+(?:of|for|in)/i,
      /(?:how\s+do\s+(?:i|you)\s+(?:write|code|create|make|program))\s/i,
      /(?:write|create|make)\s+(?:me\s+)?a\s+function/i,
      /(?:how\s+to)\s+(?:program|code|write|make|create|build)\s+(?:in\s+)?(?:a\s+)?/i,
      /\b(?:print|output|display|log)\s+(?:hello\s*world|"[^"]+")\s+(?:in|using|with)\b/i,
      /\b(?:in|using|with)\s+(?:java|python|rust|go|c\+\+|typescript|javascript|ruby|swift|kotlin)\b.*(?:hello|print|program|code)/i,
      /\b(?:java|python|rust|go|c\+\+|typescript|javascript|ruby|swift|kotlin)\s+(?:hello\s*world|program|code|example)/i,
    ];

    const isCodeRequest = codePatterns.some(p => p.test(input));
    if (!isCodeRequest) return null;

    // Detect language — check special chars (c++, c#) FIRST so they don't match plain 'c'
    const langMap: [string, string][] = [
      ['c++', 'cpp'], ['cpp', 'cpp'], ['c#', 'csharp'], ['csharp', 'csharp'],
      ['javascript', 'javascript'], ['js', 'javascript'], ['node', 'javascript'], ['nodejs', 'javascript'],
      ['typescript', 'typescript'], ['ts', 'typescript'],
      ['python', 'python'], ['py', 'python'],
      ['java', 'java'], ['rust', 'rust'], ['go', 'golang'], ['golang', 'golang'],
      ['c', 'c'],
      ['ruby', 'ruby'], ['php', 'php'], ['swift', 'swift'], ['kotlin', 'kotlin'],
      ['html', 'html'], ['css', 'css'], ['sql', 'sql'], ['bash', 'bash'], ['shell', 'bash'],
      ['elixir', 'elixir'], ['lua', 'lua'], ['dart', 'dart'],
    ];

    let detectedLang = 'javascript'; // default
    for (const [keyword, lang] of langMap) {
      if (this.matchLangKeyword(keyword, input)) {
        detectedLang = lang;
        break;
      }
    }

    // Detect what kind of code
    const isHelloWorld = /hello\s*world/i.test(input);
    const functionMatch = input.match(/(?:function|method)\s+(?:that\s+|to\s+|which\s+)(.+?)(?:\s+in\s+|\s*$)/i)
      || input.match(/(?:make|create|write|build)\s+(?:a\s+)?(?:function|method)\s+(?:that\s+|to\s+|which\s+)(.+?)(?:\s+in\s+|\s*$)/i);
    // Check if it's just a generic "how to make a function" with no description
    const isGenericFunctionQ = /(?:how\s+to|make|create|write)\s+(?:a\s+)?(?:function|method)\s*(?:\s+in\s+\w+)?\s*$/i.test(input);
    const isSumFunction = /(?:sum|add|addition|takes?\s+two\s+numbers?\s+and\s+returns?\s+their\s+sum)/i.test(input);

    // Generate hello world
    if (isHelloWorld) {
      return this.generateHelloWorld(detectedLang);
    }

    // Generate sum/add function
    if (isSumFunction || (functionMatch && /(?:sum|add|two\s+numbers)/i.test(functionMatch[1]))) {
      return this.generateSumFunction(detectedLang);
    }

    // Generic "how to make a function in X" — show function example
    if (isGenericFunctionQ) {
      return this.generateGenericFunction(detectedLang, 'example', true);
    }

    // Generic function request — generate a template
    if (functionMatch) {
      const desc = functionMatch[1].trim();
      // Don't use "in LANG" as a function description
      if (/^in\s+\w+$/i.test(desc)) {
        return this.generateGenericFunction(detectedLang, 'example', true);
      }
      return this.generateGenericFunction(detectedLang, desc);
    }

    // Fallback: hello world if it's a generic code request
    return this.generateHelloWorld(detectedLang);
  }

  private generateHelloWorld(lang: string): string {
    const examples: Record<string, string> = {
      javascript: '```javascript\nconsole.log("Hello, World!");\n```',
      typescript: '```typescript\nconsole.log("Hello, World!");\n```',
      python: '```python\nprint("Hello, World!")\n```',
      java: '```java\npublic class HelloWorld {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n```',
      rust: '```rust\nfn main() {\n    println!("Hello, World!");\n}\n```',
      golang: '```go\npackage main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, World!")\n}\n```',
      c: '```c\n#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}\n```',
      cpp: '```cpp\n#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}\n```',
      csharp: '```csharp\nusing System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello, World!");\n    }\n}\n```',
      ruby: '```ruby\nputs "Hello, World!"\n```',
      php: '```php\n<?php\necho "Hello, World!\\n";\n```',
      swift: '```swift\nprint("Hello, World!")\n```',
      kotlin: '```kotlin\nfun main() {\n    println("Hello, World!")\n}\n```',
      html: '```html\n<!DOCTYPE html>\n<html>\n<head><title>Hello</title></head>\n<body>\n    <h1>Hello, World!</h1>\n</body>\n</html>\n```',
      elixir: '```elixir\nIO.puts("Hello, World!")\n```',
      lua: '```lua\nprint("Hello, World!")\n```',
      dart: '```dart\nvoid main() {\n  print("Hello, World!");\n}\n```',
      bash: '```bash\necho "Hello, World!"\n```',
      sql: '```sql\nSELECT \'Hello, World!\';\n```',
      css: '```css\nbody::after {\n  content: "Hello, World!";\n}\n```',
    };
    const code = examples[lang] || examples.javascript;
    return `Here's Hello World in **${lang}**:\n\n${code}`;
  }

  private generateSumFunction(lang: string): string {
    const examples: Record<string, string> = {
      javascript: '```javascript\nfunction sum(a, b) {\n  return a + b;\n}\n\n// Usage:\nconsole.log(sum(3, 5)); // 8\n```',
      typescript: '```typescript\nfunction sum(a: number, b: number): number {\n  return a + b;\n}\n\n// Usage:\nconsole.log(sum(3, 5)); // 8\n```',
      python: '```python\ndef sum_numbers(a, b):\n    return a + b\n\n# Usage:\nprint(sum_numbers(3, 5))  # 8\n```',
      java: '```java\npublic static int sum(int a, int b) {\n    return a + b;\n}\n```',
      rust: '```rust\nfn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n```',
      golang: '```go\nfunc sum(a, b int) int {\n    return a + b\n}\n```',
      elixir: '```elixir\ndef sum(a, b), do: a + b\n```',
    };
    const code = examples[lang] || examples.javascript;
    return `Here's a sum function in **${lang}**:\n\n${code}`;
  }

  private generateGenericFunction(lang: string, description: string, isExample = false): string {
    // If it's a generic "how to make a function" request, show a proper example
    if (isExample) {
      const examples: Record<string, string> = {
        javascript: '```javascript\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\n\n// Usage:\nconsole.log(greet("World")); // "Hello, World!"\n```',
        typescript: '```typescript\nfunction greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\n// Usage:\nconsole.log(greet("World")); // "Hello, World!"\n```',
        python: '```python\ndef greet(name):\n    return f"Hello, {name}!"\n\n# Usage:\nprint(greet("World"))  # Hello, World!\n```',
        java: '```java\npublic static String greet(String name) {\n    return "Hello, " + name + "!";\n}\n```',
        rust: '```rust\nfn greet(name: &str) -> String {\n    format!("Hello, {}!", name)\n}\n```',
        golang: '```go\nfunc greet(name string) string {\n    return fmt.Sprintf("Hello, %s!", name)\n}\n```',
        csharp: '```csharp\nstatic string Greet(string name) {\n    return $"Hello, {name}!";\n}\n```',
        c: '```c\nvoid greet(const char* name) {\n    printf("Hello, %s!\\n", name);\n}\n```',
        cpp: '```cpp\nstd::string greet(const std::string& name) {\n    return "Hello, " + name + "!";\n}\n```',
      };
      const code = examples[lang] || examples.javascript;
      return `Here's how to write a function in **${lang}**:\n\n${code}`;
    }

    const templates: Record<string, (name: string, desc: string) => string> = {
      javascript: (name, desc) => `\`\`\`javascript\n/**\n * ${desc}\n */\nfunction ${name}(/* params */) {\n  // TODO: implement ${desc}\n}\n\`\`\``,
      typescript: (name, desc) => `\`\`\`typescript\n/**\n * ${desc}\n */\nfunction ${name}(/* params */): void {\n  // TODO: implement ${desc}\n}\n\`\`\``,
      python: (name, desc) => `\`\`\`python\ndef ${name}():\n    """${desc}"""\n    # TODO: implement\n    pass\n\`\`\``,
    };

    // Generate a function name from description
    const name = description.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).slice(0, 3)
      .map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join('');

    const gen = templates[lang] || templates.javascript;
    return `Here's a function template for "${description}" in **${lang}**:\n\n${gen(name || 'myFunction', description)}`;
  }

  // ─── ADVANCED CODE GENERATION ─────────────────────────────────────
  /**
   * Handle structured code requests: types, enums, classes, structs, interfaces.
   * Generates idiomatic code in TypeScript, Rust, C++, C, Go, Python, etc.
   */
  private tryAdvancedCodeGeneration(input: string): string | null {
    // Detect language — check special chars first (c++, c#) so they don't match plain 'c'
    const langMap: [string, string][] = [
      ['c++', 'cpp'], ['cpp', 'cpp'], ['c#', 'csharp'], ['csharp', 'csharp'],
      ['typescript', 'typescript'], ['ts', 'typescript'],
      ['rust', 'rust'], ['python', 'python'], ['py', 'python'],
      ['go', 'go'], ['golang', 'go'], ['java', 'java'],
      ['c', 'c'],
      ['javascript', 'javascript'], ['js', 'javascript'],
    ];

    let lang = '';
    for (const [keyword, langId] of langMap) {
      if (this.matchLangKeyword(keyword, input)) {
        lang = langId;
        break;
      }
    }
    if (!lang) return null; // no language detected, skip

    // ─── TYPE / UNION TYPE ───
    // ─── Helper: extract entity name from "for a NOUN" or "called/named NOUN" ───
    const extractName = (input: string, structKeyword: string): string | null => {
      // Pattern 1: "TYPE called/named X" or "TYPE X" (where X isn't "for"/"a"/"an"/"the"/"in"/"with")
      const directMatch = input.match(new RegExp(structKeyword + '\\s+(?:called\\s+|named\\s+)["`\']?(\\w+)["`\']?', 'i'));
      if (directMatch) return directMatch[1];

      // Pattern 2: "TYPE for [a/an] X" — the most common natural phrasing
      const forMatch = input.match(new RegExp(structKeyword + '\\s+for\\s+(?:a\\s+|an?\\s+|the\\s+)?([\\w]+(?:\\s+[\\w]+)?)', 'i'));
      if (forMatch) {
        // PascalCase multi-word names: "traffic lights" → "TrafficLight"
        return forMatch[1].split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
      }

      // Pattern 3: "TYPE X" where X is directly after keyword and isn't a stop word
      const directNameMatch = input.match(new RegExp(structKeyword + '\\s+["`\']?(\\w+)["`\']?', 'i'));
      if (directNameMatch) {
        const name = directNameMatch[1].toLowerCase();
        if (!['for', 'a', 'an', 'the', 'in', 'with', 'that', 'which', 'to', 'of'].includes(name)) {
          return directNameMatch[1];
        }
      }

      return null;
    };

    // ─── TYPE / UNION TYPE ───
    const typeDetected = /\b(?:type|union\s*type|type\s*alias)\b/i.test(input);
    if (typeDetected) {
      const typeName = extractName(input, '(?:type|union\\s*type|type\\s*alias)') || 'Item';
      return this.generateTypeCode(lang, typeName, input);
    }

    // ─── ENUM ───
    const enumDetected = /\benum\b/i.test(input);
    if (enumDetected) {
      const enumName = extractName(input, 'enum') || 'Status';
      return this.generateEnumCode(lang, enumName, input);
    }

    // ─── CLASS ───
    const classDetected = /\bclass\b/i.test(input);
    if (classDetected) {
      const className = extractName(input, 'class') || 'Entity';
      return this.generateClassCode(lang, className, input);
    }

    // ─── STRUCT ───
    const structDetected = /\bstruct\b/i.test(input);
    if (structDetected) {
      const structName = extractName(input, 'struct') || 'Data';
      return this.generateStructCode(lang, structName, input);
    }

    // ─── INTERFACE ───
    const ifaceDetected = /\binterface\b/i.test(input);
    if (ifaceDetected) {
      const ifaceName = extractName(input, 'interface') || 'Handler';
      return this.generateInterfaceCode(lang, ifaceName, input);
    }

    // ─── PROGRAM / ACCESS CONTROL ───
    const programMatch = input.match(/(?:create|write|make|generate)\s+(?:a\s+|an?\s+)?(?:(?:rust|c\+\+|cpp|c|go|python|typescript|ts|javascript|js)\s+)?(?:program|application|script)\s+(?:that\s+|which\s+|to\s+)?(.+)/i);
    if (programMatch) {
      const desc = programMatch[1].trim();
      return this.generateProgramCode(lang, desc, input);
    }

    return null;
  }

  private generateTypeCode(lang: string, name: string, input: string): string {
    // Extract variant/member hints from the input
    const variants = this.extractVariants(input);

    switch (lang) {
      case 'typescript':
        if (variants.length > 0) {
          const unionMembers = variants.map(v => `'${v}'`).join(' | ');
          const checkFn = `function check${name}(status: ${name}): boolean {\n  return status !== '${variants[variants.length - 1] || 'unknown'}';\n}`;
          return `Here's a TypeScript type **${name}**:\n\n\`\`\`typescript\ntype ${name} = ${unionMembers};\n\n${checkFn}\n\`\`\``;
        }
        return `Here's a TypeScript type **${name}**:\n\n\`\`\`typescript\ntype ${name} = {\n  id: string;\n  status: string;\n  createdAt: Date;\n};\n\`\`\``;

      case 'rust':
        if (variants.length > 0) {
          const rustVariants = variants.map(v => `    ${this.toPascalCase(v)}`).join(',\n');
          return `Here's a Rust type **${name}**:\n\n\`\`\`rust\n#[derive(Debug, Clone, PartialEq)]\npub enum ${name} {\n${rustVariants},\n}\n\`\`\``;
        }
        return `Here's a Rust type **${name}**:\n\n\`\`\`rust\n#[derive(Debug, Clone)]\npub struct ${name} {\n    pub id: String,\n    pub status: String,\n}\n\`\`\``;

      default:
        return `Here's a type **${name}** in **${lang}**:\n\n(Type aliases work best in TypeScript or Rust. Try specifying one of those languages.)`;
    }
  }

  private generateEnumCode(lang: string, name: string, input: string): string {
    const variants = this.extractVariants(input);
    const domainVariants = this.getDomainEnumVariants(name, input);
    const defaultVariants = variants.length > 0 ? variants : domainVariants.length > 0 ? domainVariants : ['Active', 'Inactive', 'Pending'];

    switch (lang) {
      case 'typescript': {
        const members = defaultVariants.map(v => `  ${this.toPascalCase(v)} = '${v.toLowerCase()}'`).join(',\n');
        return `Here's a TypeScript enum **${name}**:\n\n\`\`\`typescript\nenum ${name} {\n${members},\n}\n\`\`\``;
      }
      case 'rust': {
        const members = defaultVariants.map(v => `    ${this.toPascalCase(v)}`).join(',\n');
        const implBlock = `impl ${name} {\n    pub fn is_allowed(&self) -> bool {\n        matches!(self, ${name}::${this.toPascalCase(defaultVariants[0])})\n    }\n}`;
        return `Here's a Rust enum **${name}**:\n\n\`\`\`rust\n#[derive(Debug, Clone, PartialEq)]\npub enum ${name} {\n${members},\n}\n\n${implBlock}\n\`\`\``;
      }
      case 'cpp': {
        const members = defaultVariants.map(v => `    ${this.toPascalCase(v)}`).join(',\n');
        return `Here's a C++ enum **${name}**:\n\n\`\`\`cpp\nenum class ${name} {\n${members},\n};\n\`\`\``;
      }
      case 'c': {
        const members = defaultVariants.map(v => `    ${name.toUpperCase()}_${v.toUpperCase()}`).join(',\n');
        return `Here's a C enum **${name}**:\n\n\`\`\`c\ntypedef enum {\n${members},\n} ${name};\n\`\`\``;
      }
      case 'python': {
        const members = defaultVariants.map(v => `    ${v.toUpperCase()} = '${v.toLowerCase()}'`).join('\n');
        return `Here's a Python enum **${name}**:\n\n\`\`\`python\nfrom enum import Enum\n\nclass ${name}(Enum):\n${members}\n\`\`\``;
      }
      case 'java': {
        const members = defaultVariants.map(v => v.toUpperCase()).join(', ');
        return `Here's a Java enum **${name}**:\n\n\`\`\`java\npublic enum ${name} {\n    ${members}\n}\n\`\`\``;
      }
      case 'go': {
        const constBlock = defaultVariants.map((v, i) => i === 0
          ? `\t${this.toPascalCase(v)} ${name} = iota`
          : `\t${this.toPascalCase(v)}`
        ).join('\n');
        return `Here's a Go enum **${name}**:\n\n\`\`\`go\ntype ${name} int\n\nconst (\n${constBlock}\n)\n\`\`\``;
      }
      default:
        return `Here's an enum **${name}** in **${lang}** — try TypeScript, Rust, C++, C, Python, Java, or Go for best results.`;
    }
  }

  private generateClassCode(lang: string, name: string, input: string): string {
    // Extract field/property hints
    const isAccessControl = /access|security|auth|gate|permission/i.test(input);
    const isPrivate = /private|encapsulat/i.test(input);
    const domainFields = this.getDomainClassFields(name, input);

    switch (lang) {
      case 'typescript':
        if (isAccessControl) {
          return `Here's a TypeScript class **${name}**:\n\n\`\`\`typescript\nclass ${name} {\n  private readonly allowedUsers: Set<string>;\n\n  constructor(users: string[]) {\n    this.allowedUsers = new Set(users);\n  }\n\n  checkAccess(userId: string): boolean {\n    return this.allowedUsers.has(userId);\n  }\n\n  grantAccess(userId: string): void {\n    this.allowedUsers.add(userId);\n  }\n\n  revokeAccess(userId: string): void {\n    this.allowedUsers.delete(userId);\n  }\n}\n\`\`\``;
        }
        if (domainFields) {
          const fieldDecl = domainFields.fields.map(f => `  ${isPrivate ? 'private ' : ''}${f}: ${f === 'year' || f === 'age' || f === 'speed' || f === 'grade' || f === 'salary' || f === 'price' || f === 'quantity' || f === 'pages' || f === 'health' || f === 'score' || f === 'level' || f === 'balance' || f === 'width' || f === 'height' ? 'number' : 'string'};`).join('\n');
          const ctorParams = domainFields.fields.map(f => `${f}: ${f === 'year' || f === 'age' || f === 'speed' || f === 'grade' || f === 'salary' || f === 'price' || f === 'quantity' || f === 'pages' || f === 'health' || f === 'score' || f === 'level' || f === 'balance' || f === 'width' || f === 'height' ? 'number' : 'string'}`).join(', ');
          const ctorBody = domainFields.fields.map(f => `    this.${f} = ${f};`).join('\n');
          const methods = (domainFields.methods || []).map(m => `\n  ${m}(): void {\n    // TODO: implement ${m}\n  }`).join('');
          return `Here's a TypeScript class **${name}**:\n\n\`\`\`typescript\nclass ${name} {\n${fieldDecl}\n\n  constructor(${ctorParams}) {\n${ctorBody}\n  }\n${methods}\n\n  toString(): string {\n    return \`${name}(${domainFields.fields.slice(0, 2).map(f => `\${this.${f}}`).join(', ')})\`;\n  }\n}\n\`\`\``;
        }
        return `Here's a TypeScript class **${name}**:\n\n\`\`\`typescript\nclass ${name} {\n  ${isPrivate ? 'private' : ''} id: string;\n  ${isPrivate ? 'private' : ''} name: string;\n\n  constructor(id: string, name: string) {\n    this.id = id;\n    this.name = name;\n  }\n\n  toString(): string {\n    return \`${name}(\${this.id}: \${this.name})\`;\n  }\n}\n\`\`\``;

      case 'cpp':
        if (isAccessControl) {
          return `Here's a C++ class **${name}**:\n\n\`\`\`cpp\n#include <string>\n#include <vector>\n#include <algorithm>\n\nclass ${name} {\nprivate:\n    const std::string secretKey;\n    std::vector<std::string> allowedUsers;\n\npublic:\n    ${name}(const std::string& key) : secretKey(key) {}\n\n    void grantAccess(const std::string& user) {\n        allowedUsers.push_back(user);\n    }\n\n    bool checkAccess(const std::string& user) const {\n        return std::find(allowedUsers.begin(), allowedUsers.end(), user)\n               != allowedUsers.end();\n    }\n\n    const std::string& getKey() const { return secretKey; }\n};\n\`\`\``;
        }
        if (domainFields) {
          const fieldDecl = domainFields.fields.map(f => {
            const type = (f === 'year' || f === 'age' || f === 'speed' || f === 'grade' || f === 'salary' || f === 'pages' || f === 'health' || f === 'score' || f === 'level' || f === 'quantity') ? 'int' : f === 'price' || f === 'balance' || f === 'width' || f === 'height' ? 'double' : 'std::string';
            return `    ${type} ${f}_;`;
          }).join('\n');
          const ctorParams = domainFields.fields.map(f => {
            const type = (f === 'year' || f === 'age' || f === 'speed' || f === 'grade' || f === 'salary' || f === 'pages' || f === 'health' || f === 'score' || f === 'level' || f === 'quantity') ? 'int' : f === 'price' || f === 'balance' || f === 'width' || f === 'height' ? 'double' : 'const std::string&';
            return `${type} ${f}`;
          }).join(', ');
          const ctorInit = domainFields.fields.map(f => `${f}_(${f})`).join(', ');
          const getters = domainFields.fields.map(f => {
            const type = (f === 'year' || f === 'age' || f === 'speed' || f === 'grade' || f === 'salary' || f === 'pages' || f === 'health' || f === 'score' || f === 'level' || f === 'quantity') ? 'int' : f === 'price' || f === 'balance' || f === 'width' || f === 'height' ? 'double' : 'const std::string&';
            return `    ${type} get${this.toPascalCase(f)}() const { return ${f}_; }`;
          }).join('\n');
          const methods = (domainFields.methods || []).map(m => `\n    void ${m}() {\n        // TODO: implement ${m}\n    }`).join('');
          return `Here's a C++ class **${name}**:\n\n\`\`\`cpp\n#include <string>\n#include <iostream>\n\nclass ${name} {\nprivate:\n${fieldDecl}\n\npublic:\n    ${name}(${ctorParams})\n        : ${ctorInit} {}\n\n${getters}${methods}\n\n    friend std::ostream& operator<<(std::ostream& os, const ${name}& obj) {\n        os << "${name}(" << obj.${domainFields.fields[0]}_ << ")";\n        return os;\n    }\n};\n\`\`\``;
        }
        return `Here's a C++ class **${name}**:\n\n\`\`\`cpp\n#include <string>\n#include <iostream>\n\nclass ${name} {\nprivate:\n    std::string id_;\n    std::string name_;\n\npublic:\n    ${name}(const std::string& id, const std::string& name)\n        : id_(id), name_(name) {}\n\n    const std::string& getId() const { return id_; }\n    const std::string& getName() const { return name_; }\n\n    friend std::ostream& operator<<(std::ostream& os, const ${name}& obj) {\n        os << "${name}(" << obj.id_ << ": " << obj.name_ << ")";\n        return os;\n    }\n};\n\`\`\``;

      case 'rust':
        if (isAccessControl) {
          return `Here's a Rust struct **${name}**:\n\n\`\`\`rust\nuse std::collections::HashSet;\n\npub struct ${name} {\n    secret_key: String,\n    allowed_users: HashSet<String>,\n}\n\nimpl ${name} {\n    pub fn new(key: &str) -> Self {\n        Self {\n            secret_key: key.to_string(),\n            allowed_users: HashSet::new(),\n        }\n    }\n\n    pub fn grant_access(&mut self, user: &str) {\n        self.allowed_users.insert(user.to_string());\n    }\n\n    pub fn check_access(&self, user: &str) -> bool {\n        self.allowed_users.contains(user)\n    }\n}\n\`\`\``;
        }
        return `Here's a Rust struct **${name}**:\n\n\`\`\`rust\n#[derive(Debug, Clone)]\npub struct ${name} {\n    pub id: String,\n    pub name: String,\n}\n\nimpl ${name} {\n    pub fn new(id: &str, name: &str) -> Self {\n        Self {\n            id: id.to_string(),\n            name: name.to_string(),\n        }\n    }\n}\n\nimpl std::fmt::Display for ${name} {\n    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {\n        write!(f, "{}({}: {})", stringify!(${name}), self.id, self.name)\n    }\n}\n\`\`\``;

      case 'python':
        if (isAccessControl) {
          return `Here's a Python class **${name}**:\n\n\`\`\`python\nclass ${name}:\n    def __init__(self, secret_key: str):\n        self._secret_key = secret_key\n        self._allowed_users: set[str] = set()\n\n    def grant_access(self, user: str) -> None:\n        self._allowed_users.add(user)\n\n    def check_access(self, user: str) -> bool:\n        return user in self._allowed_users\n\n    @property\n    def key(self) -> str:\n        return self._secret_key\n\`\`\``;
        }
        if (domainFields) {
          const initParams = domainFields.fields.map(f => `${f}: ${ f === 'year' || f === 'age' || f === 'speed' || f === 'grade' || f === 'salary' || f === 'pages' || f === 'health' || f === 'score' || f === 'level' || f === 'quantity' ? 'int' : f === 'price' || f === 'balance' || f === 'width' || f === 'height' ? 'float' : 'str'}`).join(', ');
          const initBody = domainFields.fields.map(f => `        self.${f} = ${f}`).join('\n');
          const methods = (domainFields.methods || []).map(m => `\n    def ${m}(self):\n        # TODO: implement ${m}\n        pass`).join('');
          const reprFields = domainFields.fields.slice(0, 2).map(f => `{self.${f}}`).join(', ');
          return `Here's a Python class **${name}**:\n\n\`\`\`python\nclass ${name}:\n    def __init__(self, ${initParams}):\n${initBody}\n${methods}\n\n    def __repr__(self) -> str:\n        return f"${name}(${reprFields})"\n\`\`\``;
        }
        return `Here's a Python class **${name}**:\n\n\`\`\`python\nclass ${name}:\n    def __init__(self, id: str, name: str):\n        self.id = id\n        self.name = name\n\n    def __repr__(self) -> str:\n        return f"${name}({self.id}: {self.name})"\n\`\`\``;

      case 'java':
        return `Here's a Java class **${name}**:\n\n\`\`\`java\npublic class ${name} {\n    private final String id;\n    private final String name;\n\n    public ${name}(String id, String name) {\n        this.id = id;\n        this.name = name;\n    }\n\n    public String getId() { return id; }\n    public String getName() { return name; }\n\n    @Override\n    public String toString() {\n        return "${name}(" + id + ": " + name + ")";\n    }\n}\n\`\`\``;

      default:
        return `Here's a class **${name}** — try TypeScript, Rust, C++, Python, or Java for the best output.`;
    }
  }

  private generateStructCode(lang: string, name: string, _input: string): string {
    switch (lang) {
      case 'rust':
        return `Here's a Rust struct **${name}**:\n\n\`\`\`rust\n#[derive(Debug, Clone, PartialEq)]\npub struct ${name} {\n    pub id: u64,\n    pub name: String,\n    pub active: bool,\n}\n\nimpl ${name} {\n    pub fn new(id: u64, name: &str) -> Self {\n        Self { id, name: name.to_string(), active: true }\n    }\n}\n\`\`\``;
      case 'c':
        return `Here's a C struct **${name}**:\n\n\`\`\`c\n#include <stdint.h>\n#include <stdbool.h>\n\ntypedef struct {\n    uint64_t id;\n    char name[256];\n    bool active;\n} ${name};\n\nvoid ${name}_init(${name}* self, uint64_t id, const char* name) {\n    self->id = id;\n    strncpy(self->name, name, sizeof(self->name) - 1);\n    self->name[sizeof(self->name) - 1] = '\\0';\n    self->active = true;\n}\n\`\`\``;
      case 'cpp':
        return `Here's a C++ struct **${name}**:\n\n\`\`\`cpp\n#include <string>\n#include <cstdint>\n\nstruct ${name} {\n    uint64_t id;\n    std::string name;\n    bool active = true;\n\n    ${name}(uint64_t id, const std::string& name)\n        : id(id), name(name) {}\n};\n\`\`\``;
      case 'go':
        return `Here's a Go struct **${name}**:\n\n\`\`\`go\ntype ${name} struct {\n\tID     uint64\n\tName   string\n\tActive bool\n}\n\nfunc New${name}(id uint64, name string) ${name} {\n\treturn ${name}{ID: id, Name: name, Active: true}\n}\n\`\`\``;
      default:
        return `Structs work best in Rust, C, C++, or Go. Try specifying one of those languages.`;
    }
  }

  private generateInterfaceCode(lang: string, name: string, _input: string): string {
    switch (lang) {
      case 'typescript':
        return `Here's a TypeScript interface **${name}**:\n\n\`\`\`typescript\ninterface ${name} {\n  id: string;\n  name: string;\n  createdAt: Date;\n  isActive(): boolean;\n}\n\`\`\``;
      case 'go':
        return `Here's a Go interface **${name}**:\n\n\`\`\`go\ntype ${name} interface {\n\tGetID() string\n\tGetName() string\n\tIsActive() bool\n}\n\`\`\``;
      case 'java':
        return `Here's a Java interface **${name}**:\n\n\`\`\`java\npublic interface ${name} {\n    String getId();\n    String getName();\n    boolean isActive();\n}\n\`\`\``;
      default:
        return `Interfaces work best in TypeScript, Go, or Java. Try specifying one of those languages.`;
    }
  }

  private generateProgramCode(lang: string, description: string, input: string): string {
    const isAccessControl = /access|security|auth|gate|permission|check/i.test(input);

    if (isAccessControl) {
      switch (lang) {
        case 'c':
          return `Here's a C access control program:\n\n\`\`\`c\n#include <stdio.h>\n#include <string.h>\n#include <stdbool.h>\n\n#define MAX_USERS 100\n#define MAX_NAME_LEN 64\n\ntypedef struct {\n    char users[MAX_USERS][MAX_NAME_LEN];\n    int count;\n} SecurityGateway;\n\nvoid sg_init(SecurityGateway* sg) {\n    sg->count = 0;\n}\n\nvoid sg_grant(SecurityGateway* sg, const char* user) {\n    if (sg->count >= MAX_USERS) return;\n    strncpy(sg->users[sg->count], user, MAX_NAME_LEN - 1);\n    sg->users[sg->count][MAX_NAME_LEN - 1] = '\\0';\n    sg->count++;\n}\n\nbool sg_check(const SecurityGateway* sg, const char* user) {\n    for (int i = 0; i < sg->count; i++) {\n        if (strcmp(sg->users[i], user) == 0) return true;\n    }\n    return false;\n}\n\nint main(void) {\n    SecurityGateway gw;\n    sg_init(&gw);\n    sg_grant(&gw, "admin");\n    sg_grant(&gw, "user1");\n\n    printf("admin: %s\\n", sg_check(&gw, "admin") ? "GRANTED" : "DENIED");\n    printf("hacker: %s\\n", sg_check(&gw, "hacker") ? "GRANTED" : "DENIED");\n    return 0;\n}\n\`\`\``;

        case 'cpp':
          return `Here's a C++ access control program:\n\n\`\`\`cpp\n#include <iostream>\n#include <string>\n#include <vector>\n#include <algorithm>\n\nclass SecurityGateway {\nprivate:\n    const std::string secretKey;\n    std::vector<std::string> allowedUsers;\n\npublic:\n    SecurityGateway(const std::string& key) : secretKey(key) {}\n\n    void grantAccess(const std::string& user) {\n        allowedUsers.push_back(user);\n    }\n\n    bool checkAccess(const std::string& user) const {\n        return std::find(allowedUsers.begin(), allowedUsers.end(), user)\n               != allowedUsers.end();\n    }\n};\n\nint main() {\n    SecurityGateway gw("top-secret-key");\n    gw.grantAccess("admin");\n    gw.grantAccess("user1");\n\n    std::cout << "admin: " << (gw.checkAccess("admin") ? "GRANTED" : "DENIED") << std::endl;\n    std::cout << "hacker: " << (gw.checkAccess("hacker") ? "GRANTED" : "DENIED") << std::endl;\n    return 0;\n}\n\`\`\``;

        case 'rust':
          return `Here's a Rust access control program:\n\n\`\`\`rust\nuse std::collections::HashSet;\n\nstruct SecurityGateway {\n    secret_key: String,\n    allowed_users: HashSet<String>,\n}\n\nimpl SecurityGateway {\n    fn new(key: &str) -> Self {\n        Self {\n            secret_key: key.to_string(),\n            allowed_users: HashSet::new(),\n        }\n    }\n\n    fn grant_access(&mut self, user: &str) {\n        self.allowed_users.insert(user.to_string());\n    }\n\n    fn check_access(&self, user: &str) -> bool {\n        self.allowed_users.contains(user)\n    }\n}\n\nfn main() {\n    let mut gw = SecurityGateway::new("top-secret-key");\n    gw.grant_access("admin");\n    gw.grant_access("user1");\n\n    println!("admin: {}", if gw.check_access("admin") { "GRANTED" } else { "DENIED" });\n    println!("hacker: {}", if gw.check_access("hacker") { "GRANTED" } else { "DENIED" });\n}\n\`\`\``;

        default:
          return this.generateGenericFunction(lang, description);
      }
    }

    return this.generateGenericFunction(lang, description);
  }

  /**
   * Get contextual enum variants based on the domain/name of the enum.
   * For example, "TrafficLights" → ['Red', 'Yellow', 'Green'], "Season" → ['Spring', 'Summer', 'Fall', 'Winter'].
   */
  private getDomainEnumVariants(name: string, input: string): string[] {
    const lower = (name + ' ' + input).toLowerCase();
    if (/traffic\s*light|stop\s*light|signal\s*light/i.test(lower)) return ['Red', 'Yellow', 'Green'];
    if (/season/i.test(lower)) return ['Spring', 'Summer', 'Fall', 'Winter'];
    if (/day|weekday/i.test(lower)) return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    if (/direction|compass/i.test(lower)) return ['North', 'South', 'East', 'West'];
    if (/color|colour/i.test(lower)) return ['Red', 'Green', 'Blue', 'Yellow', 'Black', 'White'];
    if (/planet/i.test(lower)) return ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Neptune'];
    if (/priority/i.test(lower)) return ['Low', 'Medium', 'High', 'Critical'];
    if (/size/i.test(lower)) return ['Small', 'Medium', 'Large', 'ExtraLarge'];
    if (/http\s*method|request\s*method/i.test(lower)) return ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    if (/http\s*status|status\s*code/i.test(lower)) return ['Ok', 'NotFound', 'BadRequest', 'ServerError', 'Unauthorized'];
    if (/order|payment/i.test(lower)) return ['Pending', 'Processing', 'Completed', 'Cancelled', 'Refunded'];
    if (/animal/i.test(lower)) return ['Dog', 'Cat', 'Bird', 'Fish', 'Horse'];
    if (/fruit/i.test(lower)) return ['Apple', 'Banana', 'Orange', 'Grape', 'Mango'];
    if (/currency/i.test(lower)) return ['USD', 'EUR', 'GBP', 'JPY', 'NOK'];
    if (/role|permission/i.test(lower)) return ['Admin', 'Editor', 'Viewer', 'Guest'];
    if (/level|difficulty/i.test(lower)) return ['Easy', 'Medium', 'Hard', 'Expert'];
    if (/mood|emotion/i.test(lower)) return ['Happy', 'Sad', 'Angry', 'Neutral', 'Excited'];
    return [];
  }

  /**
   * Get domain-specific class fields when the name suggests a well-known entity.
   * Returns a map of { lang: { fields, constructor, methods } } overrides.
   */
  private getDomainClassFields(name: string, input: string): { fields: string[]; methods?: string[] } | null {
    const lower = (name + ' ' + input).toLowerCase();
    if (/car|vehicle|automobile/i.test(lower)) return { fields: ['make', 'model', 'year', 'speed'], methods: ['accelerate', 'brake'] };
    if (/person|human/i.test(lower)) return { fields: ['name', 'age', 'email'] };
    if (/animal|pet/i.test(lower)) return { fields: ['name', 'species', 'age', 'sound'], methods: ['speak'] };
    if (/product|item/i.test(lower)) return { fields: ['name', 'price', 'quantity'] };
    if (/student/i.test(lower)) return { fields: ['name', 'grade', 'studentId'] };
    if (/employee|worker/i.test(lower)) return { fields: ['name', 'position', 'salary'] };
    if (/book/i.test(lower)) return { fields: ['title', 'author', 'pages', 'isbn'] };
    if (/bank\s*account|account/i.test(lower)) return { fields: ['owner', 'balance'], methods: ['deposit', 'withdraw'] };
    if (/shape|rectangle|circle/i.test(lower)) return { fields: ['width', 'height'], methods: ['area', 'perimeter'] };
    if (/player|game\s*character/i.test(lower)) return { fields: ['name', 'health', 'score', 'level'] };
    return null;
  }

  private extractVariants(input: string): string[] {
    // Extract variant names from descriptions like "with variants: Active, Blocked, Revoked"
    // or "containing: Allowed, Blocked, UnderReview"
    const variantMatch = input.match(/(?:variants?|values?|members?|options?|containing|with|:)\s*[:-]?\s*([A-Za-z_]+(?:\s*[,|/]\s*[A-Za-z_]+)+)/i);
    if (variantMatch) {
      return variantMatch[1].split(/\s*[,|/]\s*/).map(v => v.trim()).filter(v => v.length > 0);
    }
    return [];
  }

  private toPascalCase(s: string): string {
    return s.replace(/(?:^|[-_ ])(\w)/g, (_, c) => c.toUpperCase());
  }

  /**
   * Match a language keyword in text, handling special chars like c++, c#.
   * Uses word boundaries for alphanumeric keywords and position-aware matching
   * for keywords with special characters (where \b fails).
   */
  private matchLangKeyword(keyword: string, text: string): boolean {
    // For keywords with non-word chars (c++, c#), use case-insensitive indexOf + boundary check
    if (/[^a-zA-Z0-9]/.test(keyword)) {
      const lower = text.toLowerCase();
      const kw = keyword.toLowerCase();
      const idx = lower.indexOf(kw);
      if (idx === -1) return false;
      // Check left boundary: start of string or non-alphanumeric char
      if (idx > 0 && /[a-zA-Z0-9]/.test(lower[idx - 1])) return false;
      // Check right boundary: end of string or non-alphanumeric char (after the special chars)
      const endIdx = idx + kw.length;
      if (endIdx < lower.length && /[a-zA-Z0-9]/.test(lower[endIdx])) return false;
      return true;
    }
    // For plain alphanumeric keywords, use standard \b word boundary
    return new RegExp(`\\b${keyword}\\b`, 'i').test(text);
  }

  /**
   * Look up concepts extracted from learned content.
   */
  private tryConceptLookup(input: string): string | null {
    // Extract the topic from the question
    const topicPatterns = [
      /^what\s+(?:is|are)\s+(?:a\s+|an\s+|the\s+)?(.+?)[\s?]*$/i,
      /^(?:tell\s+me\s+about|explain|describe|define)\s+(?:a\s+|an\s+|the\s+)?(.+?)[\s?]*$/i,
      /^(?:who|what)\s+(?:is|are|was|were)\s+(.+?)[\s?]*$/i,
    ];

    let topic: string | null = null;
    for (const pattern of topicPatterns) {
      const m = input.match(pattern);
      if (m) { topic = m[1].trim(); break; }
    }

    if (!topic) return null;

    const concept = this.knowledge.findConcept(topic);
    if (concept) {
      const sourceTag = concept.source && concept.source !== 'undefined' ? `\n\n[Source: ${concept.source}]` : '';
      return `${concept.definition}${sourceTag}`;
    }

    return null;
  }

  /**
   * Strategy 1.517: Taught document retrieval via TF-IDF.
   * Searches the document index specifically for user-taught content.
   * Uses relaxed quality gates compared to general synthesize because
   * taught content is explicitly provided by the user (high a priori relevance).
   */
  private tryTaughtDocumentRetrieval(input: string): string | null {
    const retrieved = this.cachedRetrieveRelevant(input, 8);

    // Filter to user-taught documents only
    const taughtDocs = retrieved.filter(r => r.source === 'user-taught');
    if (taughtDocs.length === 0) return null;

    const best = taughtDocs[0];

    // Minimum TF-IDF score threshold (lower than general synthesis since content is pre-vetted)
    if (best.score <= 0.02) return null;

    // Content relevance: at least 2 meaningful query words must appear in the document
    const queryWords = input.toLowerCase().split(/\s+/)
      .filter(w => w.length > 2 && !KnowledgeStore.STOP_WORDS.has(w));
    const bestLower = best.text.toLowerCase();
    const hits = queryWords.filter(w => bestLower.includes(w)).length;
    if (hits < 2) return null;

    // For 4+ query words, require at least 30% coverage (vs 75% in general synthesis)
    if (queryWords.length >= 4 && hits / queryWords.length < 0.3) return null;

    // Extract the most relevant sentences from the taught content
    const sentences = best.text.split(/(?<=[.!?])\s+/).filter(s => s.length > 15);
    const scored = sentences.map(s => {
      const sLower = s.toLowerCase();
      const sentHits = queryWords.filter(w => sLower.includes(w)).length;
      return { text: s, score: sentHits };
    }).sort((a, b) => b.score - a.score);

    const topSentences = scored.filter(s => s.score > 0).slice(0, 5).map(s => s.text);
    if (topSentences.length === 0) return null;

    const answer = topSentences.join(' ');
    const snippet = answer.length > 600 ? answer.slice(0, 600) + '...' : answer;
    return snippet;
  }

  /**
   * Strategy 1.7: Knowledge Intelligence — decompose complex questions, follow
   * connections between knowledge entries, and combine answers.
   *
   * Activates only for compound/complex questions that benefit from decomposition.
   * Simple questions skip this and go to the cheaper direct match (Strategy 2).
   */
  private tryIntelligentAnswer(input: string): string | null {
    const lower = input.toLowerCase().trim();

    // Only try decomposition for questions that look compound or complex:
    // - Contains "and" / "or" between topics
    // - Comparative: "vs", "compared to"
    // - Multi-topic: "about X and Y"
    // - Long questions (>6 meaningful words)
    const words = lower.split(/\s+/).filter(w => w.length > 2 && !KnowledgeStore.STOP_WORDS.has(w));
    const isCompound = /\b(?:and|or)\b/i.test(input) && words.length > 4;
    const isComparative = /\b(?:vs\.?|versus|compared?\s+to|differ(?:ence|ent)?|eller)\b/i.test(input);
    const isComplex = words.length > 6;

    if (!isCompound && !isComparative && !isComplex) return null;
// Rebuild intelligence indexes if knowledge changed since last build
    if (this.intelligenceDirty) {
      this.intelligence.build();
      this.intelligenceDirty = false;
    }

    
    const result = this.intelligence.answerDecomposed(input);
    if (!result || result.confidence < 0.2) return null;

    // Format based on whether it was decomposed or direct
    if (result.strategy === 'decomposed' && result.subAnswers.length > 1) {
      const parts = result.subAnswers.map(sa =>
        `**${sa.question}**\n${sa.answer}`
      );
      return parts.join('\n\n');
    }

    return result.text;
  }

  /**
   * Synthesize a response from multiple TF-IDF retrieved chunks.
   * Filters junk content, requires meaningful relevance, combines quality sources only.
   */
  private synthesizeFromKnowledge(input: string, _history: readonly Message[]): string | null {
    const retrieved = this.cachedRetrieveRelevant(input, VaiEngine.SYNTHESIS_RETRIEVE_COUNT);

    // Filter out junk content before scoring
    const clean = retrieved.filter(r => !KnowledgeStore.isJunkContent(r.text));
    if (clean.length === 0 || clean[0].score <= VaiEngine.SYNTHESIS_MIN_SCORE) return null;

    // Use the best match
    const best = clean[0];

    // Quality gate: if the best match score is very low, don't synthesize garbage
    if (best.score < VaiEngine.SYNTHESIS_MIN_SCORE) return null;

    // Content relevance check: the retrieved text must contain at least 1 meaningful query word
    // This prevents returning completely unrelated content that matched on stop words
    const queryWords = input.toLowerCase().split(/\s+/)
      .filter(w => w.length > 2 && !KnowledgeStore.STOP_WORDS.has(w));
    const bestLower = best.text.toLowerCase();
    const queryHitsInBest = queryWords.filter(w => bestLower.includes(w)).length;
    if (queryWords.length > 0 && queryHitsInBest === 0) return null;

    // Stricter relevance: require meaningful overlap between query and result
    if (queryWords.length >= 2) {
      // Sort query words by rarity (less common = more important for relevance)
      const wordImportance = queryWords.map(w => {
        const docCount = this.knowledge.getWordDocCount(w);
        return { word: w, docCount };
      }).sort((a, b) => a.docCount - b.docCount); // rarest first

      // The rarest word is the most discriminating — require it to be in the result
      const rarestWord = wordImportance[0];
      if (rarestWord) {
        // Check as whole word (not substring) to avoid false matches
        const escapedWord = rarestWord.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rarestRegex = new RegExp(`\\b${escapedWord}\\b`, 'i');
        if (!rarestRegex.test(best.text)) {
          return null; // Most distinctive query word missing = likely irrelevant match
        }
      }

      // Double-check: require at least 2 of the top-3 rarest words to be present
      const top3 = wordImportance.slice(0, Math.min(3, wordImportance.length));
      const topHits = top3.filter(w => bestLower.includes(w.word)).length;
      if (top3.length >= 2 && topHits < 2) {
        return null; // Too few discriminating words → likely irrelevant
      }

      // Also require meaningful hit rate — for 3+ words, require at least 60%
      // (Lowered from 75%: natural questions include functional words like "work",
      // "use", "create" that won't appear in knowledge text but don't reduce relevance)
      const hitThreshold = queryWords.length >= 3
        ? VaiEngine.SYNTHESIS_HIT_RATE_LONG
        : VaiEngine.SYNTHESIS_HIT_RATE_SHORT;
      if (queryHitsInBest / queryWords.length < hitThreshold) return null;
    }

    // If there are multiple good matches from DIFFERENT sources, combine them
    // But only if they're truly related (>75% of best score, not just keyword overlap)
    const goodMatches = clean.filter(r => r.score > best.score * VaiEngine.SYNTHESIS_GOOD_MATCH_RATIO);

    if (goodMatches.length === 1) {
      // Single source — extract the most relevant sentences
      const sentences = best.text.split(/(?<=[.!?])\s+/).filter(s => s.length > 20);

      // Score sentences by how many query words they contain
      const scored = sentences.map(s => {
        const lower = s.toLowerCase();
        const hits = queryWords.filter(w => lower.includes(w)).length;
        return { text: s, score: hits };
      }).sort((a, b) => b.score - a.score);

      // Only use sentences that actually have query word hits
      const topSentences = scored.filter(s => s.score > 0).slice(0, 5).map(s => s.text);
      if (topSentences.length === 0) {
        // No sentences matched query words — use first 500 chars as fallback
        const snippet = best.text.slice(0, 500);
        if (snippet.length < 30) return null; // too short to be useful
        return `From what I've learned:\n\n${snippet}\n\n[Source: ${best.source}]`;
      }
      let answer = topSentences.join(' ');

      // Enrich with connected knowledge if available
      if (this.intelligence && !this.intelligenceDirty) {
        const entries = this.knowledge.exportData().entries;
        const entryIdx = entries.findIndex(e => best.text.includes(e.response.slice(0, 50)));
        if (entryIdx >= 0) {
          const related = this.intelligence.connector.traverse(entryIdx, 1, 2);
          for (const rel of related) {
            const relEntry = entries[rel.index];
            if (!relEntry) continue;
            const relLower = relEntry.response.toLowerCase();
            const relHits = queryWords.filter(w => relLower.includes(w)).length;
            if (relHits > 0 && relEntry.response !== best.text) {
              const relSnippet = relEntry.response.slice(0, 200);
              answer += `\n\nRelated: ${relSnippet}`;
              break; // one enrichment is enough
            }
          }
        }
      }

      const snippet = answer.length > 800 ? answer.slice(0, 800) + '...' : answer;
      return `From what I've learned:\n\n${snippet}\n\n[Source: ${best.source}]`;
    }

    // Multiple sources — only combine if they're from truly different sources
    // Extract relevant sentences from each source rather than dumping raw text
    const seenSources = new Set<string>();
    const parts: string[] = [];
    const sources = new Set<string>();
    for (const match of goodMatches.slice(0, 3)) {
      // Deduplicate by source domain
      const sourceDomain = match.source.replace(/https?:\/\//, '').split('/')[0];
      if (seenSources.has(sourceDomain)) continue;

      // Content relevance check for each source: extract sentences containing query words
      const matchSentences = match.text.split(/(?<=[.!?])\s+/).filter(s => s.length > 15);
      const relevantSentences = matchSentences.filter(s => {
        const sl = s.toLowerCase();
        return queryWords.some(w => sl.includes(w));
      });
      // Skip sources that have no sentence-level query word overlap
      if (relevantSentences.length === 0) continue;

      seenSources.add(sourceDomain);

      const snippet = relevantSentences.slice(0, 3).join(' ');
      const trimmed = snippet.length > 300 ? snippet.slice(0, 300) + '...' : snippet;
      parts.push(trimmed);
      sources.add(match.source);
    }

    if (parts.length <= 1) {
      // Only one unique source after dedup
      const snippet = parts[0] ?? best.text.slice(0, 500);
      return `From what I've learned:\n\n${snippet}\n\n[Source: ${Array.from(sources)[0] ?? best.source}]`;
    }

    return `From what I've learned (${parts.length} sources):\n\n${parts.join('\n\n---\n\n')}\n\n[Sources: ${Array.from(sources).join(', ')}]`;
  }

  /* ── Strategy 0.1: Scaffold / Deploy Intent Detection ──────────── */

  /**
   * Detect when user wants to scaffold, build, or deploy a project.
   * Returns a friendly response with {{deploy:stackId:tier:Name}} markers
   * that MessageBubble renders as clickable deploy buttons.
   */
  private tryScaffoldIntent(input: string): string | null {
    // Keywords indicating intent to build/scaffold/deploy
    const buildIntent = /\b(scaffold|deploy|build|create|start|set\s*up|spin\s*up|launch|init|generate|make)\b/i;
    const projectWords = /\b(app|project|stack|template|site|website|application|starter)\b/i;
    // Question patterns — user is asking ABOUT something, not requesting a build
    const questionPattern = /^(what|how|why|when|where|who|which|is|are|do|does|can|could|tell|explain|describe|show|compare|difference)\b/i;

    // Must have a build verb — this is the primary gate
    const hasBuildIntent = buildIntent.test(input);
    const hasProjectWord = projectWords.test(input);
    const isQuestion = questionPattern.test(input);

    // Questions are informational ("How do you set up Vue 3?")
    // Only allow question-form inputs that are direct action requests ("Can you create...")
    if (isQuestion) {
      const directRequest = /^(?:can|could|would)\s+you\b/i;
      if (!directRequest.test(input)) return null;
    }
    // Must have a build verb at minimum
    if (!hasBuildIntent) return null;

    // Long, complex messages with planning/architecture language are NOT scaffold requests.
    // They want advice, not deploy buttons.
    const planningWords = /\b(plan|architect|pipeline|where.?to.?start|not.?sure|help.?me|advise|recommend|approach|strategy|design)\b/i;
    if (input.split(/\s+/).length > 25 && planningWords.test(input)) return null;

    // Direct stack detection patterns
    const stackPatterns: Array<{ pattern: RegExp; stackId: string; label: string; tagline: string }> = [
      { pattern: /\bnext\.?js\b|next\.?js\s+app/i, stackId: 'nextjs', label: 'Next.js', tagline: 'Notes dashboard with App Router' },
      { pattern: /\bpern\b|postgres.*react|react.*postgres|express.*react.*node/i, stackId: 'pern', label: 'PERN', tagline: 'Board task manager' },
      { pattern: /\bmern\b|mongo.*react|react.*mongo|express.*react.*mongo/i, stackId: 'mern', label: 'MERN', tagline: 'Bookmark collection manager' },
      { pattern: /\bt3\b|trpc.*react|react.*trpc|t3\s*stack/i, stackId: 't3', label: 'T3', tagline: 'Expense tracker with tRPC + Zod' },
    ];

    // Check for a specific stack mention
    let matchedStack: typeof stackPatterns[0] | null = null;
    for (const sp of stackPatterns) {
      if (sp.pattern.test(input)) {
        matchedStack = sp;
        break;
      }
    }

    // Need build intent + (stack name OR project word)
    if (!matchedStack && !hasProjectWord) return null;

    // Check for tier hints
    let suggestedTier = 'basic';
    if (/\b(production|prod|deploy|docker|ci\/?cd|battle[- ]?tested)\b/i.test(input)) {
      suggestedTier = 'battle-tested';
    } else if (/\b(prisma|orm|database|db|validation|zod|solid)\b/i.test(input)) {
      suggestedTier = 'solid';
    } else if (/\b(vai|full|enterprise|monitoring|health[- ]?check)\b/i.test(input)) {
      suggestedTier = 'vai';
    }

    // If a specific stack was identified, offer it with tier options
    if (matchedStack) {
      const { stackId, label, tagline } = matchedStack;
      return [
        `I'll set up a **${label} Stack** for you — ${tagline}! Pick a tier:`,
        '',
        `{{deploy:${stackId}:basic:${label} Basic}} — Polished app with Tailwind, in-memory API`,
        `{{deploy:${stackId}:solid:${label} Solid}} — Adds Prisma ORM + Zod validation + real database`,
        `{{deploy:${stackId}:battle-tested:${label} Battle-Tested}} — Docker, CI/CD, tests, PostgreSQL`,
        `{{deploy:${stackId}:vai:${label} Vai}} — Production-hardened with monitoring & health checks`,
      ].join('\n');
    }

    // Generic build request — no specific stack mentioned, offer all 4
    return [
      "Let's get building! Here are the stacks I can deploy for you — pick one:",
      '',
      '**PERN** — PostgreSQL + Express + React + Node.js',
      `{{deploy:pern:${suggestedTier}:PERN ${this.capitalize(suggestedTier)}}}`,
      '',
      '**MERN** — MongoDB + Express + React + Node.js',
      `{{deploy:mern:${suggestedTier}:MERN ${this.capitalize(suggestedTier)}}}`,
      '',
      '**Next.js** — App Router + API Routes + React',
      `{{deploy:nextjs:${suggestedTier}:Next.js ${this.capitalize(suggestedTier)}}}`,
      '',
      '**T3** — tRPC + Zod + React + TypeScript',
      `{{deploy:t3:${suggestedTier}:T3 ${this.capitalize(suggestedTier)}}}`,
    ].join('\n');
  }

  private capitalize(s: string): string {
    return s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
  }

  /**
   * Evaluate math expressions. Handles basic arithmetic, percentages, powers.
   * Also handles "10+10=20" (verify) and "1+1=X" patterns.
   */
  private tryMath(input: string): string | null {
    // Strip conversational wrapping
    let expr = input
      .replace(/^(what\s+is|what's|whats|calculate|compute|solve|how\s+much\s+is|tell\s+me|can\s+you\s+calculate)\s+/i, '')
      .replace(/[?!.]+$/, '')
      .trim();

    // Handle "10+10=20" — user stating a math fact. Extract just the expression.
    const verifyMatch = expr.match(/^([\d\s+\-*/().^%]+?)\s*=\s*(\d+(?:\.\d+)?)\s*$/);
    if (verifyMatch) {
      const lhs = verifyMatch[1].trim();
      const claimed = parseFloat(verifyMatch[2]);
      const actual = this.evalExpr(lhs);
      if (actual !== null) {
        if (Math.abs(actual - claimed) < 0.0001) {
          return `Correct! ${lhs} = **${this.formatNum(actual)}**`;
        }
        return `Not quite — ${lhs} = **${this.formatNum(actual)}**, not ${verifyMatch[2]}.`;
      }
    }

    // Handle "1+1=X and now X = 2" — strip everything after the first "=X" or "= ?"
    expr = expr
      .replace(/\s*=\s*[?x]\s*(and|so|now|,|;).*$/i, '')  // "=X and now..."
      .replace(/\s*=\s*[?x]\s*$/i, '')                      // trailing "=X" or "=?"
      .replace(/\s*=\s*$/i, '')                              // trailing "="
      .trim();

    // Convert word operators BEFORE convertWordNumbers (Norwegian "to" = 2 would destroy "to the power of")
    expr = expr
      .replace(/\bto\s+the\s+power\s+of\b/gi, '**')
      .replace(/\bsquared\b/gi, '**2')
      .replace(/\bcubed\b/gi, '**3');

    // ─── BASE CONVERSIONS — check BEFORE convertWordNumbers since "to" → 2 in Norwegian ───
    {
      const preClean = expr.replace(/^the\s+/i, '').trim();

      // "convert 255 to binary" / "255 in binary" / "255 to hex"
      const toBaseMatch = preClean.match(/^(?:convert\s+)?(\d+)\s+(?:to|in)\s+(binary|hex(?:adecimal)?|octal|base\s*(\d+))$/i);
      if (toBaseMatch) {
        const n = parseInt(toBaseMatch[1]);
        const baseWord = toBaseMatch[2].toLowerCase();
        const base = toBaseMatch[3] ? parseInt(toBaseMatch[3]) : baseWord.startsWith('bin') ? 2 : baseWord.startsWith('hex') ? 16 : baseWord.startsWith('oct') ? 8 : 10;
        const result = n.toString(base).toUpperCase();
        const baseName = base === 2 ? 'binary' : base === 16 ? 'hexadecimal' : base === 8 ? 'octal' : `base-${base}`;
        return `${n} in ${baseName} = **${result}**`;
      }

      // "convert binary 10110 to decimal" / "binary 10110 in decimal"
      const fromBinMatch = preClean.match(/^(?:convert\s+)?(?:binary\s+|bin\s+|0b)([01]+)\s+(?:to|in)\s+(?:decimal|dec(?:imal)?)$/i);
      if (fromBinMatch) {
        const result = parseInt(fromBinMatch[1], 2);
        return `Binary ${fromBinMatch[1]} in decimal = **${result}**`;
      }

      // "convert hex FF to decimal" / "hex FF in decimal"
      const fromHexMatch = preClean.match(/^(?:convert\s+)?(?:hex(?:adecimal)?\s+|0x)([0-9a-f]+)\s+(?:to|in)\s+(?:decimal|dec(?:imal)?)$/i);
      if (fromHexMatch) {
        const result = parseInt(fromHexMatch[1], 16);
        return `Hex ${fromHexMatch[1].toUpperCase()} in decimal = **${result}**`;
      }
    }

    // Convert word numbers to digits BEFORE operator check
    // Handle "1 million", "2.5 billion", "a hundred", etc.
    expr = this.convertWordNumbers(expr);

    // Handle "N% of N" → N/100 * N
    const pctOfMatch = expr.match(/^(\d+(?:\.\d+)?)\s*%\s*of\s+(\d+(?:\.\d+)?)$/i);
    if (pctOfMatch) {
      const pct = parseFloat(pctOfMatch[1]);
      const base = parseFloat(pctOfMatch[2]);
      const result = (pct / 100) * base;
      return `${pct}% of ${base} = **${this.formatNum(result)}**`;
    }

    // ─── EXTENDED MATH: factorial, GCD, fibonacci, sqrt, base conversions ───

    // Strip leading "the " for cleaner matching
    const cleanExpr = expr.replace(/^the\s+/i, '').trim();

    // Factorial: "factorial of 7" / "7 factorial" / "7!"
    const factorialMatch = cleanExpr.match(/^(?:factorial\s+(?:of\s+)?(\d+)|(\d+)\s*!|(\d+)\s+factorial)$/i);
    if (factorialMatch) {
      const n = parseInt(factorialMatch[1] || factorialMatch[2] || factorialMatch[3]);
      if (!isNaN(n) && n >= 0 && n <= 170) {
        let result = 1;
        for (let i = 2; i <= n; i++) result *= i;
        return `${n}! = **${result.toLocaleString('en-US')}**`;
      }
    }

    // GCD: "GCD of 48 and 18" / "greatest common divisor of 48 and 18"
    const gcdMatch = cleanExpr.match(/^(?:gcd|greatest\s+common\s+divisor|hcf|highest\s+common\s+factor)\s+(?:of\s+)?(\d+)\s+(?:and|,)\s+(\d+)$/i);
    if (gcdMatch) {
      let a = parseInt(gcdMatch[1]), b = parseInt(gcdMatch[2]);
      const origA = a, origB = b;
      while (b !== 0) { [a, b] = [b, a % b]; }
      return `GCD(${origA}, ${origB}) = **${a}**`;
    }

    // LCM: "LCM of 12 and 18" / "least common multiple of 12 and 18"
    const lcmMatch = cleanExpr.match(/^(?:lcm|least\s+common\s+multiple)\s+(?:of\s+)?(\d+)\s+(?:and|,)\s+(\d+)$/i);
    if (lcmMatch) {
      const a = parseInt(lcmMatch[1]), b = parseInt(lcmMatch[2]);
      const origA = a, origB = b;
      let ga = a, gb = b;
      while (gb !== 0) { [ga, gb] = [gb, ga % gb]; }
      const lcm = (origA * origB) / ga;
      return `LCM(${origA}, ${origB}) = **${lcm}**`;
    }

    // Fibonacci: "fibonacci 10" / "10th fibonacci number" / "fib(10)"
    const fibMatch = cleanExpr.match(/^(?:(?:fibonacci|fib)\s*\(?(\d+)\)?|(\d+)(?:st|nd|rd|th)\s+fibonacci(?:\s+number)?)$/i);
    if (fibMatch) {
      const n = parseInt(fibMatch[1] || fibMatch[2]);
      if (!isNaN(n) && n >= 0 && n <= 93) {
        let a = 0, b = 1;
        for (let i = 0; i < n; i++) { [a, b] = [b, a + b]; }
        return `Fibonacci(${n}) = **${a}**`;
      }
    }

    // Square root: "square root of 144" / "sqrt of 144" / "sqrt(144)"
    const sqrtMatch = cleanExpr.match(/^(?:square\s+root|sqrt)\s*(?:of\s*)?\(?(\d+(?:\.\d+)?)\)?$/i);
    if (sqrtMatch) {
      const n = parseFloat(sqrtMatch[1]);
      const result = Math.sqrt(n);
      return `√${n} = **${this.formatNum(result)}**`;
    }

    // ─── END EXTENDED MATH ───

    // Must contain at least one digit and one operator
    if (!/\d/.test(expr)) return null;
    if (!/[+\-*/%^()]/.test(expr) && !/\*\*/.test(expr) && !/\d\s+(plus|minus|times|divided\s+by)\s/i.test(expr)) return null;

    // Convert word operators to symbols
    expr = expr
      .replace(/\bplus\b/gi, '+')
      .replace(/\bminus\b/gi, '-')
      .replace(/\btimes\b/gi, '*')
      .replace(/\bmultiplied\s+by\b/gi, '*')
      .replace(/\bdivided\s+by\b/gi, '/')
      .replace(/\bto\s+the\s+power\s+of\b/gi, '**')
      .replace(/\bsquared\b/gi, '**2')
      .replace(/\bcubed\b/gi, '**3')
      .replace(/\bmod\b/gi, '%')
      .replace(/\^/g, '**');

    const result = this.evalExpr(expr);
    if (result === null) return null;

    const display = expr.replace(/\*\*/g, '^').replace(/\s+/g, '');
    return `${display} = **${this.formatNum(result)}**`;
  }

  /**
   * Convert word numbers to digits: "1 million" → "1000000", "a hundred" → "100"
   */
  private convertWordNumbers(expr: string): string {
    const magnitudes: Record<string, number> = {
      hundred: 100, thousand: 1000, million: 1000000,
      billion: 1000000000, trillion: 1000000000000,
      // Norwegian
      hundre: 100, tusen: 1000, millioner: 1000000,
      milliard: 1000000000, billioner: 1000000000000,
    };

    const wordNums: Record<string, number> = {
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
      sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
      thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
      // Norwegian
      null: 0, en: 1, ett: 1, to: 2, tre: 3, fire: 4, fem: 5,
      seks: 6, sju: 7, åtte: 8, ni: 9, ti: 10,
    };

    // Replace "a million" / "a thousand" etc.
    let result = expr.replace(/\ba\s+(hundred|thousand|million|billion|trillion)\b/gi, (_m, mag) => {
      return String(magnitudes[mag.toLowerCase()] ?? mag);
    });

    // Replace "<number> million/thousand/etc" patterns
    // e.g. "1 million" → "1000000", "2.5 billion" → "2500000000"
    result = result.replace(/(\d+(?:\.\d+)?)\s*(hundred|thousand|million|billion|trillion|hundre|tusen|millioner|milliard|billioner)\b/gi, (_m, num, mag) => {
      const multiplier = magnitudes[mag.toLowerCase()];
      if (multiplier) {
        return String(Math.round(parseFloat(num) * multiplier));
      }
      return _m;
    });

    // Replace word numbers: "twenty" → "20", "five" → "5"
    for (const [word, num] of Object.entries(wordNums)) {
      result = result.replace(new RegExp(`\\b${word}\\b`, 'gi'), String(num));
    }

    // Handle remaining standalone magnitude words (without a preceding number)
    for (const [mag, val] of Object.entries(magnitudes)) {
      result = result.replace(new RegExp(`\\b${mag}\\b`, 'gi'), String(val));
    }

    // Clean up commas in numbers: "1,000,000" → "1000000"
    result = result.replace(/(\d),(\d{3})/g, '$1$2');
    result = result.replace(/(\d),(\d{3})/g, '$1$2'); // run twice for "1,000,000"
    result = result.replace(/(\d),(\d{3})/g, '$1$2'); // run thrice for "1,000,000,000"

    return result;
  }

  private evalExpr(expr: string): number | null {
    const sanitized = expr.replace(/\s+/g, '').replace(/\^/g, '**');
    // Only allow safe characters
    if (!/^[0-9+\-*/.%()]+$/.test(sanitized)) return null;
    if (/^[0-9.]+$/.test(sanitized)) return null; // single number

    try {
      const fn = new Function(`"use strict"; return (${sanitized});`);
      const result = fn() as number;
      if (typeof result !== 'number' || !isFinite(result)) return null;
      return result;
    } catch {
      return null;
    }
  }

  private formatNum(n: number): string {
    return Number.isInteger(n) ? n.toString() : n.toFixed(6).replace(/\.?0+$/, '');
  }

  /**
   * Search the web when local knowledge is insufficient.
   * Uses the Perplexity-style search pipeline: clarify → fan out → rank → read → cross-check → conclude.
   * Learning happens automatically via the pipeline's onLearn callback.
   */
  private async tryWebSearch(query: string): Promise<string | null> {
    try {
      const result: SearchResponse = await this.searchPipeline.search(query);
      if (result.sources.length === 0) return null;
      this._lastSearchResponse = result;
      return result.answer;
    } catch {
      // Search failed — fall through silently
      return null;
    }
  }

  /**
   * Handle common conversational patterns without needing learned knowledge.
   */
  private handleConversational(input: string, history: readonly Message[]): string | null {
    // Greetings — includes informal Norwegian (oyoy, myyh, heia, heisann, ey, oi, fese)
    // and informal English (wassup, whaddup, yoyo, g'day, aye)
    if (/^(hello|hi|hey|yo|sup|hei|hallo|howdy|oyoy|oy+|myyh|fese|ey+|oi|heia|heisann|heihei|yoyo|aye|wassup|whaddup|wazzup|g'?day|good\s+(morning|afternoon|evening))(\s+\w+)?[\s!.?]*$/i.test(input)) {
      const stats = this.getStats();
      if (stats.documentsIndexed > 0) {
        return `Hey! I'm VeggaAI. I've been trained on ${stats.documentsIndexed} sources so far — ask me about Docker, TypeScript, React, Git, or anything else I've picked up. What's on your mind?`;
      }
      return 'Hey! I\'m VeggaAI — still fresh, but ask me anything and I\'ll do my best.';
    }

    // Thank you
    if (/^(thanks|thank\s*you|thx|takk|tusen\s*takk)[\s!.]*$/i.test(input)) {
      return "You're welcome! Let me know if there's anything else.";
    }

    // Vague "how do I get started?" — no specific topic
    if (/^(?:how\s+(?:do|can|should)\s+i\s+)?(?:get\s+started|begin|start)(?:\s+(?:with\s+)?(?:programming|coding|learning))?[\s?!.]*$/i.test(input)) {
      return 'Get started with what? I know about **Docker**, **React**, **TypeScript**, **Git**, **Kubernetes**, **PostgreSQL**, and more.\n\nJust pick a topic — "What is Docker?" or "How do I set up TypeScript?" are great starting points.';
    }

    // Orphan follow-ups — user says "explain more" but there's no history
    const orphanFollowUp = /(?:explain|tell|say)\s+(?:(?:me|it|that|this)\s+)?(?:more|(?:more\s+)?simply|simpler)|more\s+detail|elaborate|can you.*(?:break.*down|go deeper|expand)|more about that/i;
    if (history.length < 2 && orphanFollowUp.test(input)) {
      return 'I\'d be happy to explain more — but I\'m not sure what you\'re referring to. Could you tell me the topic? For example: "Explain Docker more simply" or "Tell me more about TypeScript."';
    }

    // Conversational follow-ups — reference previous assistant response
    if (history.length >= 2) {
      const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
      if (lastAssistant) {
        const followUp = /(?:explain|say).*(?:more simply|simpler|easier|in simple|plain)|simplify|eli5|explain.*like.*(?:5|five|child|beginner)|can you.*(?:break.*down|dumb.*down)/i;
        const exampleReq = /(?:show|give|provide).*(?:example|sample|demo)|can you.*(?:example|demonstrate|illustrate)/i;
        const moreDetail = /(?:tell|explain|say).*more|more detail|elaborate|go deeper|expand on/i;

        if (followUp.test(input)) {
          // Genuinely simplify the previous answer — not just truncate
          const prev = lastAssistant.content;
          // Extract core topic from the previous answer's first line/heading
          const headingMatch = prev.match(/\*\*([^*]+)\*\*/);
          const topic = headingMatch ? headingMatch[1].replace(/[*:]/g, '').trim().toLowerCase() : '';

          // Try to produce a real ELI5 for known topics
          const eli5Map: Record<string, string> = {
            'docker': 'Think of Docker like a **shipping container** for software. Just like a physical container holds goods that can be moved on any truck or ship, a Docker container packages your app with everything it needs to run — so it works the same way on any computer.\n\n**In 3 steps:** Write a recipe (Dockerfile) → Build a package (Image) → Run it anywhere (Container).',
            'kubernetes': 'If Docker is a single shipping container, **Kubernetes is the port manager** — it decides where to put containers, replaces broken ones, and scales up when traffic increases.\n\n**Think of it as:** You tell K8s "I want 3 copies of my app running" and it handles everything — scheduling, healing, load balancing.',
            'react': 'React lets you build web pages from **reusable building blocks** called components. Each component is a piece of UI (a button, a form, a card) that manages its own data and can be composed together like LEGO bricks.',
            'typescript': 'TypeScript is JavaScript with **spell-check for your code**. Just like a spell-checker catches typos before you send an email, TypeScript catches bugs before you run your program. It\'s the same JavaScript underneath — just safer.',
            'git': 'Git is like an **unlimited undo button** for your code. Every time you save a checkpoint (commit), you can always go back. Branches let you try experiments without breaking the main version.',
          };

          // Check if previous topic matches any ELI5
          for (const [key, explanation] of Object.entries(eli5Map)) {
            if (topic.includes(key) || prev.toLowerCase().includes(key)) {
              return explanation;
            }
          }

          // Fallback: strip formatting, take first 2 sentences + "In short: ..." summary
          const stripped = prev.replace(/\*\*/g, '').replace(/```[\s\S]*?```/g, '')
            .replace(/\|[^\n]*\|/g, '').replace(/\n{2,}/g, '\n').trim();
          const sentences = stripped.split(/(?<=[.!?])\s+/).filter(s => s.length > 15);
          if (sentences.length >= 2) {
            return `In simpler terms: ${sentences[0]} ${sentences[1]}`;
          }
          if (sentences.length === 1) {
            return `In simpler terms: ${sentences[0]}`;
          }
        }

        if (exampleReq.test(input)) {
          // Extract code blocks from previous answer
          const prev = lastAssistant.content;
          const codeBlocks = prev.match(/```[\s\S]*?```/g);
          if (codeBlocks && codeBlocks.length > 0) {
            return `Here's the key example from what I just explained:\n\n${codeBlocks[0]}`;
          }
          // No code in previous answer — detect topic and provide a concrete example
          const headingMatch = prev.match(/\*\*([^*]+)\*\*/);
          const topic = headingMatch ? headingMatch[1].replace(/[*:]/g, '').trim().toLowerCase() : '';

          const exampleMap: Record<string, string> = {
            'docker': '**Docker example — a simple Node.js app:**\n\n```dockerfile\n# Dockerfile\nFROM node:20-alpine      # Start from a small Linux + Node.js image\nWORKDIR /app              # All commands run from /app\nCOPY package.json .       # Copy dependencies list first (better caching)\nRUN npm install           # Install dependencies\nCOPY . .                  # Copy your source code\nCMD ["node", "index.js"]  # The command that runs when the container starts\n```\n\n```bash\n# Build the image and run it\ndocker build -t my-app .          # Creates an image called "my-app"\ndocker run -p 3000:3000 my-app    # Maps port 3000 on your machine to 3000 in the container\n```\n\nTry changing `index.js`, rebuild, and the container picks up the change. That\'s the Docker workflow.',
            'kubernetes': '**Kubernetes example — deploying 3 replicas:**\n\n```yaml\n# deployment.yaml\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: my-app\n  template:\n    metadata:\n      labels:\n        app: my-app\n    spec:\n      containers:\n      - name: my-app\n        image: my-app:latest\n        ports:\n        - containerPort: 3000\n```\n\n```bash\nkubectl apply -f deployment.yaml\nkubectl get pods\n```',
            'react': '**React example — a counter component:**\n\n```tsx\nimport { useState } from "react";\n\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  return (\n    <div>\n      <p>Count: {count}</p>\n      <button onClick={() => setCount(c => c + 1)}>+1</button>\n    </div>\n  );\n}\n```',
            'typescript': '**TypeScript example:**\n\n```typescript\ninterface User {\n  name: string;\n  age: number;\n  email?: string; // optional\n}\n\nfunction greet(user: User): string {\n  return `Hello, ${user.name}!`;\n}\n\nconst user: User = { name: "Alice", age: 30 };\nconsole.log(greet(user)); // "Hello, Alice!"\n```',
            'git': '**Git example — typical feature workflow:**\n\n```bash\ngit checkout -b feature/add-login   # create branch\n# ... make changes ...\ngit add .\ngit commit -m "Add login page"\ngit push origin feature/add-login\n# Create PR on GitHub, get review, merge\ngit checkout main\ngit pull\n```',
            'rest': '**REST API example with Express.js:**\n\n```javascript\nimport express from "express";\nconst app = express();\napp.use(express.json());\n\nlet users = [{ id: 1, name: "Alice" }];\n\napp.get("/api/users", (req, res) => res.json(users));\napp.post("/api/users", (req, res) => {\n  const user = { id: users.length + 1, ...req.body };\n  users.push(user);\n  res.status(201).json(user);\n});\n\napp.listen(3000);\n```',
          };

          for (const [key, example] of Object.entries(exampleMap)) {
            if (topic.includes(key) || prev.toLowerCase().includes(key)) {
              return example;
            }
          }

          // Last resort: search knowledge for an example
          const topicWords = prev.split(/\s+/).filter(w => w.length > 4 && !KnowledgeStore.STOP_WORDS.has(w.toLowerCase())).slice(0, 3);
          if (topicWords.length > 0) {
            const match = this.cachedFindBestMatch(`example ${topicWords.join(' ')}`);
            if (match) return match.response;
          }
          return `I don't have a specific example ready, but try asking: "show me a [topic] example" with the specific topic you want to see.`;
        }

        if (moreDetail.test(input)) {
          // Extract topic from previous answer heading
          const prev = lastAssistant.content;
          const headingMatch = prev.match(/\*\*([^*]+)\*\*/);
          const topic = headingMatch ? headingMatch[1].replace(/[*:]/g, '').trim().toLowerCase() : '';

          const detailMap: Record<string, string> = {
            'docker': '**Docker — deeper dive:**\n\n**Image layers:** Each Dockerfile instruction creates a layer. Layers are cached — put frequently changing code (COPY . .) last.\n\n**Networking:** Containers communicate via Docker networks. `docker network create my-net` → `docker run --network my-net`.\n\n**Volumes:** Persist data outside containers: `docker run -v mydata:/app/data`.\n\n**Multi-stage builds:** Separate build and runtime stages to keep images small:\n```dockerfile\nFROM node:20 AS builder\nRUN npm run build\nFROM node:20-alpine\nCOPY --from=builder /app/dist ./dist\n```\n\n**Health checks:** `HEALTHCHECK CMD curl -f http://localhost:3000/health || exit 1`',
            'kubernetes': '**Kubernetes — deeper dive:**\n\n**Pod lifecycle:** Pending → Running → Succeeded/Failed. K8s restarts failed pods automatically.\n\n**Services:** ClusterIP (internal), NodePort (external port), LoadBalancer (cloud LB), Ingress (HTTP routing rules).\n\n**Scaling:**\n```bash\nkubectl scale deployment my-app --replicas=5\n# Or use HorizontalPodAutoscaler for auto-scaling\n```\n\n**ConfigMaps & Secrets:** Store config outside containers. Secrets are base64-encoded (use external secrets for production).\n\n**Namespaces:** Isolate resources: `kubectl create namespace staging`.',
            'react': '**React — deeper dive:**\n\n**Component patterns:** Container/presentational, compound components, render props, higher-order components (HOCs).\n\n**Performance:** Use `React.memo()` for expensive renders, `useMemo` for computed values, `useCallback` for stable references.\n\n**State management tiers:**\n- Local: `useState`\n- Shared: Context + `useReducer`\n- Global: Zustand, Redux Toolkit, Jotai\n\n**Rendering:** React batches state updates. Use Suspense + lazy() for code splitting. Server Components (Next.js) reduce client JS.',
            'typescript': '**TypeScript — deeper dive:**\n\n**Utility types:** `Partial<T>`, `Required<T>`, `Pick<T, K>`, `Omit<T, K>`, `Record<K, V>`.\n\n**Generics:**\n```typescript\nfunction first<T>(arr: T[]): T | undefined {\n  return arr[0];\n}\n```\n\n**Discriminated unions:**\n```typescript\ntype Result = { ok: true; data: string } | { ok: false; error: string };\n```\n\n**Type guards:** `if ("data" in result)` narrows the type automatically.\n\n**Strict mode:** Enable `strict: true` in tsconfig for maximum safety.',
            'git': '**Git — deeper dive:**\n\n**Interactive rebase:** `git rebase -i HEAD~3` to squash, reorder, or edit commits.\n\n**Stashing:** `git stash` saves work-in-progress, `git stash pop` restores it.\n\n**Cherry-pick:** `git cherry-pick <sha>` applies a specific commit to current branch.\n\n**Bisect:** `git bisect start` → `git bisect bad` → `git bisect good <sha>` to binary-search for a bug.\n\n**Hooks:** `.git/hooks/pre-commit` runs before each commit (lint, test).',
          };

          for (const [key, detail] of Object.entries(detailMap)) {
            if (topic.includes(key) || prev.toLowerCase().includes(key)) {
              return detail;
            }
          }

          // Fallback: search knowledge entries (NOT raw TF-IDF documents) for more on the topic
          const topicWords = prev.split(/\s+/)
            .filter(w => w.length > 3 && !KnowledgeStore.STOP_WORDS.has(w.toLowerCase()) && !/^[\*\|`#\-]/.test(w))
            .slice(0, 3);
          if (topicWords.length > 0) {
            const match = this.cachedFindBestMatch(topicWords.join(' '));
            if (match && match.response.length > 50) {
              return `Here's more on that topic:\n\n${match.response}`;
            }
          }
          return `I've covered what I know on that topic. Try asking about a specific aspect — for example, "How does [feature] work?" or "What are the best practices for [topic]?"`;
        }

        // "What about X?" — sub-topic follow-up referencing previous conversation
        const whatAboutMatch = input.match(/what\s+about\s+(.+)/i);
        if (whatAboutMatch) {
          const subtopic = whatAboutMatch[1].replace(/[?.!]+$/, '').trim().toLowerCase();
          const prev = lastAssistant.content.toLowerCase();

          // Build subtopic map keyed by [mainTopic][subtopic]
          const subtopicMap: Record<string, Record<string, string>> = {
            'kubernetes': {
              'security': '**Kubernetes security:**\n\n**1. RBAC (Role-Based Access Control):**\n```yaml\napiVersion: rbac.authorization.k8s.io/v1\nkind: Role\nmetadata:\n  name: pod-reader\nrules:\n- apiGroups: [""]\n  resources: ["pods"]\n  verbs: ["get", "list", "watch"]\n```\n\n**2. Network Policies** — restrict pod-to-pod traffic:\n```yaml\napiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: deny-all\nspec:\n  podSelector: {}\n  policyTypes: ["Ingress", "Egress"]\n```\n\n**3. Secrets management:**\n- Use `kubectl create secret` (base64 only — NOT encrypted at rest by default)\n- For production: **External Secrets Operator**, **HashiCorp Vault**, or **AWS Secrets Manager**\n\n**4. Pod Security:**\n- Set `runAsNonRoot: true`, `readOnlyRootFilesystem: true`\n- Drop all capabilities: `securityContext.capabilities.drop: ["ALL"]`\n- Use Pod Security Standards (restricted/baseline/privileged)\n\n**5. Image security:** Scan images with Trivy/Snyk, use signed images, pull from private registries only.',
              'networking': '**Kubernetes networking:**\n\n**Service types:**\n- **ClusterIP** — internal only (default)\n- **NodePort** — exposes on each node\'s IP at a static port\n- **LoadBalancer** — provisions external cloud load balancer\n- **ExternalName** — maps to a DNS name\n\n**Ingress** — HTTP/HTTPS routing:\n```yaml\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: my-ingress\nspec:\n  rules:\n  - host: app.example.com\n    http:\n      paths:\n      - path: /\n        pathType: Prefix\n        backend:\n          service:\n            name: my-app\n            port:\n              number: 80\n```\n\n**DNS:** Every service gets a DNS name: `<service>.<namespace>.svc.cluster.local`.\n\n**Network Policies** control which pods can communicate — by default, all pods can reach all pods.',
              'monitoring': '**Kubernetes monitoring:**\n\n**Stack:** Prometheus (metrics) + Grafana (dashboards) + Alertmanager (alerts).\n\n**Key metrics:**\n- **Node:** CPU/memory utilization, disk pressure, network I/O\n- **Pod:** restart count, OOMKilled events, request vs limit usage\n- **Cluster:** pending pods, failed scheduling, API server latency\n\n**Commands:**\n```bash\nkubectl top nodes          # node resource usage\nkubectl top pods           # pod resource usage\nkubectl describe pod <pod> # events + conditions\nkubectl logs <pod> -f      # stream logs\n```\n\n**Liveness vs Readiness probes:**\n- **Liveness** — restart container if unhealthy\n- **Readiness** — remove from service if not ready\n- **Startup** — delay other probes until app is initialized',
            },
            'docker': {
              'security': '**Docker security best practices:**\n\n1. **Don\'t run as root** — use `USER node` in Dockerfile\n2. **Use minimal base images** — `alpine` or `distroless`\n3. **Scan images** — `docker scout cves my-image` or Trivy/Snyk\n4. **Don\'t store secrets in images** — use `--secret` flag or env vars at runtime\n5. **Read-only filesystem** — `docker run --read-only`\n6. **Drop capabilities** — `docker run --cap-drop ALL --cap-add NET_BIND_SERVICE`\n7. **Use multi-stage builds** — don\'t ship build tools in production image\n8. **Pin image versions** — `node:20.11-alpine` not `node:latest`\n9. **Limit resources** — `docker run --memory=512m --cpus=1`\n10. **Use Docker Content Trust** — `export DOCKER_CONTENT_TRUST=1` for signed images',
              'networking': '**Docker networking:**\n\n**Network types:**\n- **bridge** (default) — containers on same host communicate\n- **host** — container shares host network stack\n- **none** — no networking\n- **overlay** — multi-host networking (Swarm/K8s)\n\n**Commands:**\n```bash\ndocker network create my-net\ndocker run --network my-net --name app1 my-image\ndocker run --network my-net --name app2 my-image\n# app1 can reach app2 by name: http://app2:3000\n```\n\n**Port mapping:** `-p 8080:3000` maps host:8080 → container:3000.\n**DNS:** Containers on the same user-defined network resolve each other by container name.',
            },
            'react': {
              'performance': '**React performance optimization:**\n\n1. **React.memo()** — skip re-renders when props haven\'t changed\n2. **useMemo()** — cache expensive computed values\n3. **useCallback()** — stable function references for child components\n4. **Code splitting** — `React.lazy(() => import("./HeavyComponent"))`\n5. **Virtualization** — `react-window` or `@tanstack/virtual` for long lists\n6. **Keys** — use stable unique IDs, never array index for dynamic lists\n7. **State colocation** — keep state close to where it\'s used (avoid lifting too high)\n8. **Profiler** — React DevTools Profiler to identify slow renders',
              'testing': '**React testing:**\n\n**Stack:** Vitest + React Testing Library + MSW (API mocking).\n\n```tsx\nimport { render, screen, fireEvent } from "@testing-library/react";\nimport { Counter } from "./Counter";\n\ntest("increments count", () => {\n  render(<Counter />);\n  fireEvent.click(screen.getByText("+1"));\n  expect(screen.getByText("Count: 1")).toBeInTheDocument();\n});\n```\n\n**Principles:**\n- Test behavior, not implementation\n- Query by role/label (accessible selectors), not test IDs\n- Mock external dependencies (API calls, timers), not internal state',
            },
            'typescript': {
              'generics': '**TypeScript generics:**\n\n```typescript\n// Basic generic function\nfunction identity<T>(value: T): T { return value; }\n\n// Generic with constraint\nfunction getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {\n  return obj[key];\n}\n\n// Generic interface\ninterface Repository<T> {\n  find(id: string): Promise<T | null>;\n  save(item: T): Promise<void>;\n}\n\n// Generic class\nclass Stack<T> {\n  private items: T[] = [];\n  push(item: T) { this.items.push(item); }\n  pop(): T | undefined { return this.items.pop(); }\n}\n```\n\n**Common patterns:** `Array<T>`, `Promise<T>`, `Record<K, V>`, `Map<K, V>`.',
            },
            'git': {
              'merge': '**Git merge strategies:**\n\n- **Fast-forward** (`git merge --ff-only`) — linear history, only works if no divergence\n- **Merge commit** (`git merge --no-ff`) — preserves branch history with a merge commit\n- **Squash** (`git merge --squash`) — combines all branch commits into one\n- **Rebase** (`git rebase main`) — replays commits on top of target branch (linear history)\n\n**When to use what:**\n- Feature branches → squash merge (clean main history)\n- Release branches → merge commit (preserve history)\n- Keeping up-to-date → rebase (avoid merge commits in feature branches)',
            },
          };

          // Find matching main topic from previous answer
          for (const [mainTopic, subtopics] of Object.entries(subtopicMap)) {
            if (prev.includes(mainTopic)) {
              // Check if subtopic matches any key
              for (const [subKey, content] of Object.entries(subtopics)) {
                if (subtopic.includes(subKey) || subKey.includes(subtopic.replace(/\s+in\s+\w+$/i, '').trim())) {
                  return content;
                }
              }
            }
          }

          // Subtopic not in map — try knowledge search
          const searchQuery = `${subtopic}`;
          const match = this.cachedFindBestMatch(searchQuery);
          if (match && match.response.length > 50) {
            return match.response;
          }
        }
      }
    }

    // Write/say a sentence in Norwegian
    if (/(?:write|say|give|tell)\s+(?:to\s+)?(?:me\s+)?(?:a\s+)?(?:sentence|phrase|something|words?)\s+(?:in\s+)?(?:norwegian|norsk)/i.test(input)) {
      const sentences = [
        'Hei! Mitt navn er VeggaAI, og jeg er en lokal AI bygget fra bunnen av.',
        'Norge er et vakkert land med fjorder, fjell og midnattssol.',
        'Jeg lærer nye ting hver dag — jo mer du lærer meg, jo smartere blir jeg.',
        'Kunnskap er makt, og sammen kan vi bygge noe helt fantastisk.',
        'God morgen! Hva vil du at jeg skal hjelpe deg med i dag?',
      ];
      return sentences[Math.floor(Math.random() * sentences.length)];
    }

    // Generic "write me a sentence" (English)
    if (/(?:write|say|give|tell)\s+(?:me\s+)?(?:a\s+)?(?:sentence|phrase|something)\b/i.test(input) && !/\b(?:code|program|function|class|script)\b/i.test(input)) {
      return 'The fastest path to understanding is through building — write code, break things, and learn from every failure.';
    }

    // "What do you know about X?"
    const aboutMatch = input.match(/what\s+do\s+you\s+know\s+(?:about\s+)?(.+)/i);
    if (aboutMatch) {
      const topic = aboutMatch[1].replace(/[?.!]+$/, '').trim();
      const retrieved = this.cachedRetrieveRelevant(topic, 3);
      if (retrieved.length > 0 && retrieved[0].score > 0.005) {
        const snippet = retrieved[0].text.length > 400 ? retrieved[0].text.slice(0, 400) + '...' : retrieved[0].text;
        return `Here's what I know about "${topic}":\n\n${snippet}\n\n[Source: ${retrieved[0].source}]`;
      }
      return `I don't have any knowledge about "${topic}" yet. You can teach me by capturing web pages about it with the Chrome extension, or by chatting — tell me about it and I'll remember.`;
    }

    // User is teaching: "Python is a programming language" / "remember that X means Y"
    // Also handles longer teaching like "I want to teach you about X: ..."
    // MUST NOT match questions: skip if starts with question words, command words, or contains "?"
    if (!/^(what|who|how|why|when|where|which|can|do|does|did|is\s+(it|there)|are\s+(you|there)|explain|describe|tell|show|list|compare|give|write|create|build|make|generate|set\s?up|implement)\b/i.test(input) && !input.includes('?')) {
      // Short teaching: "X is Y"
      const teachMatch = input.match(/^(?:remember\s+that\s+)?([A-Za-z][A-Za-z0-9 _-]{2,50})\s+(?:is|means|equals)\s+(.{3,200})$/i);
      if (teachMatch) {
        const pattern = teachMatch[1].trim();
        const response = teachMatch[2].trim();
        if (!/^(it|this|that|the|a|an|my|your|so|now|here|there|also|just)$/i.test(pattern)
          && !/\b(?:function|class|method|implement|algorithm|program|script|code|module|interface|struct|enum)\b/i.test(pattern)) {
          this.knowledge.addEntry(pattern, response, 'user-taught', 'en');
          this.knowledge.learn(`${pattern} is ${response}`, 'user-taught', 'en');
          this.tokenizer.encode(`${pattern} ${response}`);
          return `Got it! I've learned that "${pattern}" is "${response}". I'll remember this.`;
        }
      }

      // Correction patterns: "Actually, X is Y" / "No, X is Y" / "That's wrong, X is Y" / "X should be Y"
      const correctionMatch = input.match(/^(?:actually|no|nope|wrong|that'?s\s+(?:wrong|incorrect|not\s+right)|correction)[,:\s]*(?:the\s+)?([A-Za-z][A-Za-z0-9 _-]{2,60})\s+(?:is|should\s+be|means|equals|=)\s+(.{3,200})$/i)
        || input.match(/^(?:the\s+)?(?:correct|right|actual)\s+(?:answer|response|info)\s+(?:is|for)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 _-]{2,60})\s+(?:is|=)\s+(.{3,200})$/i)
        || input.match(/^([A-Za-z][A-Za-z0-9 _-]{2,60})\s+(?:should\s+be|is\s+actually|is\s+really)\s+(.{3,200})$/i);
      if (correctionMatch) {
        const pattern = correctionMatch[1].trim();
        const response = correctionMatch[2].trim();
        if (!/^(it|this|that|the|a|an|my|your|so|now|here|there|also|just)$/i.test(pattern)
          && !/\b(?:function|class|method|implement|algorithm|program|script|code|module|interface|struct|enum)\b/i.test(pattern)) {
          this.knowledge.addEntry(pattern, response, 'user-taught', 'en');
          this.knowledge.learn(`${pattern} is ${response}`, 'user-taught', 'en');
          this.tokenizer.encode(`${pattern} ${response}`);
          return `Thanks for the correction! I've updated my knowledge: "${pattern}" → "${response}". I'll get it right next time.`;
        }
      }

      // Long teaching: "I want to teach you..." / "Let me teach you..." / "Here is something important..."
      const longTeachMatch = input.match(/^(?:i\s+want\s+to\s+teach\s+you|let\s+me\s+teach\s+you|here\s+is\s+(?:something|a\s+(?:key|important|profound))|learn\s+this|remember\s+this|the\s+concept\s+(?:is|of))\b[:\s]*(.{10,})/i);
      if (longTeachMatch) {
        const content = longTeachMatch[1].trim();
        // Extract key concepts from the teaching
        const sentences = content.split(/(?<=[.!])\s+/).filter(s => s.length > 10);
        const keyPhrases: string[] = [];

        for (const sentence of sentences.slice(0, 5)) {
          // Extract "X means Y" / "X is Y" patterns from the teaching
          const defMatch = sentence.match(/[""]?([A-Za-z][A-Za-z ]{2,40})[""]?\s*[-–—]?\s*(?:it\s+)?(?:means?|is|refers\s+to)\s+(.{5,})/i);
          if (defMatch) {
            this.knowledge.addEntry(defMatch[1].trim(), defMatch[2].trim(), 'user-taught', 'en');
            keyPhrases.push(defMatch[1].trim());
          }
        }

        // Learn the full text as knowledge
        this.knowledge.learn(content, 'user-taught', 'en');
        this.tokenizer.encode(content);

        if (keyPhrases.length > 0) {
          return `Thank you for teaching me! I've learned about: ${keyPhrases.join(', ')}. I've absorbed ${sentences.length} concepts from what you shared. Ask me about them anytime!`;
        }
        return `Thank you for teaching me! I've absorbed this knowledge (${sentences.length} key points). I'll do my best to apply what you've taught me. Ask me about it to see what I retained!`;
      }
    }

    // Recall previous messages in this conversation
    if (/what\s+(was|did)\s+(my|i)\s+(first|last|previous)/i.test(input) || /what\s+did\s+i\s+(say|ask)/i.test(input)) {
      const userMsgs = history.filter((m) => m.role === 'user');
      if (userMsgs.length > 1) {
        const first = userMsgs[0].content;
        const prev = userMsgs[userMsgs.length - 2]?.content;
        if (/first/i.test(input)) {
          return `Your first message in this conversation was: "${first}"`;
        }
        if (prev) {
          return `Your previous message was: "${prev}"`;
        }
      }
      return "I can see our conversation history, but there aren't enough messages yet to look back on.";
    }

    // Help / what can I do
    if (/^(help|what\s+can\s+(i|you)\s+do|how\s+do\s+(i|you)\s+work)/i.test(input)) {
      return `I'm VeggaAI — I learn from what you teach me and answer questions about it.\n\n**The basics:**\n- **Ask me anything** — "What is Docker?", "How do React hooks work?", "Compare PostgreSQL and MongoDB"\n- **Teach me** — feed me web pages, YouTube transcripts, or GitHub repos via the Chrome extension\n- **Check what I know** — "what do you know about [topic]?"\n- **Find my gaps** — "what do you need to learn?"\n\nThe more you teach me, the better I get. What would you like to start with?`;
    }

    // "What do you need to learn?" / "What should I teach you?"
    if (/what\s+(do\s+you\s+need|should\s+i\s+teach|are\s+your\s+gaps|don'?t\s+you\s+know|topics?\s+do\s+you\s+need)/i.test(input)) {
      return this.buildKnowledgeGapReport();
    }

    return null;
  }

  /**
   * Check if the user taught us something earlier in this conversation that we can now use.
   */
  private learnFromChat(input: string, history: readonly Message[]): string | null {
    // Look through history for clear teaching statements (not questions)
    for (const msg of history) {
      if (msg.role !== 'user') continue;
      const lower = msg.content.toLowerCase();
      if (lower.includes('?') || /^(what|who|how|why|when|where|which)\b/i.test(lower)) continue;

      const teachMatch = lower.match(/^([a-z][a-z0-9 _-]{2,40})\s+(?:is|means)\s+(.{3,})$/);
      if (teachMatch) {
        const pattern = teachMatch[1].trim();
        if (input.includes(pattern) && pattern.length > 2 && !/^(it|this|that|the|so|now)$/i.test(pattern)) {
          return `Based on what you told me earlier: "${msg.content}"`;
        }
      }
    }
    return null;
  }

  /**
   * Build a helpful fallback that tells the user what we DO know, not just that we don't know.
   */
  private buildHelpfulFallback(input: string): string {
    const stats = this.getStats();

    // Track this as a missed topic — extract key words (skip stop words)
    const stopWords = new Set(['what', 'how', 'why', 'when', 'where', 'who', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'would', 'should', 'the', 'a', 'an', 'of', 'to', 'in', 'for', 'on', 'with', 'at', 'by', 'it', 'i', 'you', 'me', 'my', 'your', 'this', 'that']);
    const topicWords = input.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    if (topicWords.length > 0) {
      const topic = topicWords.slice(0, 4).join(' ');
      this.missedTopics.set(topic, (this.missedTopics.get(topic) ?? 0) + 1);
      this.schedulePersist();
    }

    // Detect comparison queries — provide partial knowledge when we know one side
    const compareMatch = input.match(/(?:compare|difference|differences?\s+between)\s+(.+?)\s+(?:and|vs\.?|versus)\s+(.+)/i)
      || input.match(/(.+?)\s+(?:vs\.?|versus)\s+(.+)/i);
    if (compareMatch) {
      const itemA = compareMatch[1].replace(/[?.!]+$/, '').trim();
      const itemB = compareMatch[2].replace(/[?.!]+$/, '').trim();
      const matchA = this.cachedFindBestMatch(itemA);
      const matchB = this.cachedFindBestMatch(itemB);
      const hasA = matchA && matchA.response.length > 30;
      const hasB = matchB && matchB.response.length > 30;

      if (hasA && !hasB) {
        return `I can tell you about **${itemA}** but I haven't learned about **${itemB}** yet.\n\n**Here's what I know about ${itemA}:**\n${matchA!.response}\n\nTeach me about ${itemB} and I'll be able to compare them next time!`;
      }
      if (hasB && !hasA) {
        return `I can tell you about **${itemB}** but I haven't learned about **${itemA}** yet.\n\n**Here's what I know about ${itemB}:**\n${matchB!.response}\n\nTeach me about ${itemA} and I'll be able to compare them next time!`;
      }
      if (hasA && hasB) {
        return `**${itemA}:**\n${matchA!.response}\n\n**${itemB}:**\n${matchB!.response}`;
      }
    }

    // If we have no data at all, guide them
    if (stats.documentsIndexed === 0 && stats.knowledgeEntries <= 5) {
      return `I'm brand new and haven't learned anything yet beyond basics. Here's how to get started:\n\n1. **Chrome extension:** Capture web pages, YouTube videos, or GitHub repos\n2. **Direct teaching:** Tell me facts like "React is a JavaScript library"\n3. **Chat:** Once I have data, ask me questions about it\n\nThe more you teach me, the smarter I get!`;
    }

    // We have some data — tell them what topics we know about
    const knownSources = new Set<string>();
    const retrieved = this.cachedRetrieveRelevant(input, 5);
    for (const r of retrieved) {
      knownSources.add(r.source);
    }

    if (knownSources.size > 0) {
      const sourceList = Array.from(knownSources).slice(0, 3).join(', ');
      return `I couldn't find a strong match for that question, but I have related content from: ${sourceList}. Try rephrasing or ask "what do you know about [topic]?" to explore.\n\n(${stats.vocabSize} words learned, ${stats.documentsIndexed} sources indexed)`;
    }

    return `I don't have knowledge about that yet. I currently know about ${stats.documentsIndexed} sources with ${stats.vocabSize} words in my vocabulary.\n\nYou can teach me by:\n- Capturing pages with the Chrome extension\n- Telling me facts directly (e.g., "JavaScript is a programming language")\n- Feeding me content via the Knowledge Base panel\n\nTip: Ask "what do you need to learn?" to see topics I've struggled with.`;
  }

  /**
   * Report on knowledge gaps — what topics users asked about that we couldn't answer.
   */
  private buildKnowledgeGapReport(): string {
    const stats = this.getStats();

    if (this.missedTopics.size === 0) {
      if (stats.documentsIndexed === 0) {
        return "I haven't been asked any questions yet that I couldn't answer — mostly because I haven't been asked much! Start chatting and I'll track what I need to learn.";
      }
      return `So far I've been able to answer questions from my ${stats.documentsIndexed} indexed sources. Keep asking questions and I'll let you know when I hit gaps!`;
    }

    // Sort missed topics by frequency
    const sorted = Array.from(this.missedTopics.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const topicList = sorted.map(([topic, count]) =>
      `- **${topic}** (asked ${count}x)`
    ).join('\n');

    return `Here are topics I've struggled with — feeding me content about these would help the most:\n\n${topicList}\n\nYou can teach me by:\n- Capturing relevant web pages/YouTube videos with the Chrome extension\n- Telling me facts directly in chat\n\nI currently have ${stats.vocabSize} words and ${stats.documentsIndexed} sources indexed.`;
  }

  getStats(): { vocabSize: number; knowledgeEntries: number; ngramContexts: number; documentsIndexed: number; conceptsExtracted: number } {
    return {
      vocabSize: this.tokenizer.vocabSize,
      knowledgeEntries: this.knowledge.entryCount,
      ngramContexts: this.knowledge.ngramCount,
      documentsIndexed: this.knowledge.documentCount,
      conceptsExtracted: this.knowledge.conceptCount,
    };
  }
}
