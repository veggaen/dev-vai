/**
 * VeggaAI Ingestion Pipeline
 *
 * Takes raw content from any source and processes it into 3 context levels:
 *   L0 (Full): Complete cleaned text + metadata
 *   L1 (Short): Key sentences summary (few paragraphs)
 *   L2 (Tiny): Index card (5-10 bullet points)
 *
 * Then feeds everything to the VaiEngine for learning.
 */

import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import type { VaiDatabase } from '../db/client.js';
import { sources, chunks } from '../db/schema.js';
import type { VaiEngine } from '../models/vai-engine.js';
import type { KnowledgeEntry } from '../models/vai-engine.js';

export interface IngestResult {
  sourceId: string;
  title: string;
  chunkCounts: { l0: number; l1: number; l2: number };
  tokensLearned: number;
}

export interface RawCapture {
  sourceType: 'web' | 'youtube' | 'file' | 'github' | 'search';
  url: string;
  title: string;
  content: string;
  language?: 'en' | 'no' | 'code' | 'mixed';
  meta?: Record<string, unknown>;
}

export class IngestPipeline {
  constructor(
    private db: VaiDatabase,
    private engine: VaiEngine,
  ) {}

  /**
   * Ingest raw content: clean, chunk, summarize, store, and train.
   */
  ingest(capture: RawCapture): IngestResult {
    const sourceId = ulid();
    const now = new Date();
    const language = capture.language ?? this.detectLanguage(capture.content);

    // Store source record
    this.db.insert(sources).values({
      id: sourceId,
      sourceType: capture.sourceType === 'github' || capture.sourceType === 'search'
        ? 'web' : capture.sourceType,
      url: capture.url,
      title: capture.title,
      capturedAt: now,
      meta: capture.meta ? JSON.stringify(capture.meta) : null,
    }).run();

    // Clean the content
    const cleaned = this.cleanText(capture.content);

    // L0: Full text, chunked into ~500 word segments
    const l0Chunks = this.chunkText(cleaned, 500);
    for (let i = 0; i < l0Chunks.length; i++) {
      this.db.insert(chunks).values({
        id: ulid(),
        sourceId,
        level: 0,
        ordinal: i,
        content: l0Chunks[i],
        meta: null,
      }).run();
    }

    // L1: Summary (extract key sentences)
    const l1Text = this.extractKeySentences(cleaned, 10);
    this.db.insert(chunks).values({
      id: ulid(),
      sourceId,
      level: 1,
      ordinal: 0,
      content: l1Text,
      meta: null,
    }).run();

    // L2: Bullet points (ultra-short)
    const l2Text = this.extractBulletPoints(cleaned, 7);
    this.db.insert(chunks).values({
      id: ulid(),
      sourceId,
      level: 2,
      ordinal: 0,
      content: l2Text,
      meta: null,
    }).run();

    // Train the engine on this content
    this.engine.train(cleaned, capture.url, language);

    // Also add as knowledge entry for direct retrieval
    this.engine.knowledge.addEntry(
      capture.title,
      l1Text,
      capture.url,
      language,
    );

    return {
      sourceId,
      title: capture.title,
      chunkCounts: { l0: l0Chunks.length, l1: 1, l2: 1 },
      tokensLearned: this.engine.tokenizer.encode(cleaned).length,
    };
  }

  /**
   * Get all chunks for a source at a specific level.
   */
  getChunks(sourceId: string, level: number) {
    return this.db.select().from(chunks)
      .where(eq(chunks.sourceId, sourceId))
      .all()
      .filter((c) => c.level === level)
      .sort((a, b) => a.ordinal - b.ordinal);
  }

  /**
   * Search across all ingested content.
   */
  search(query: string, maxResults = 10): Array<{ sourceId: string; content: string; score: number }> {
    const queryWords = new Set(query.toLowerCase().split(/\s+/));
    const allChunks = this.db.select().from(chunks)
      .all()
      .filter((c) => c.level === 0);

    const scored = allChunks.map((chunk) => {
      const chunkWords = new Set(chunk.content.toLowerCase().split(/\s+/));
      const intersection = new Set([...queryWords].filter((w) => chunkWords.has(w)));
      const score = queryWords.size > 0 ? intersection.size / queryWords.size : 0;
      return { sourceId: chunk.sourceId, content: chunk.content, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  /**
   * List all ingested sources.
   */
  listSources() {
    return this.db.select().from(sources).all();
  }

  // ---- Private helpers ----

  private cleanText(text: string): string {
    return text
      .replace(/<[^>]*>/g, ' ')                     // strip HTML tags
      .replace(/\s+/g, ' ')                         // collapse whitespace
      .replace(/[^\S\n]+/g, ' ')                    // normalize spaces
      .replace(/\n{3,}/g, '\n\n')                   // max 2 newlines
      .trim();
  }

  private chunkText(text: string, wordsPerChunk: number): string[] {
    const words = text.split(/\s+/);
    const result: string[] = [];

    for (let i = 0; i < words.length; i += wordsPerChunk) {
      const chunk = words.slice(i, i + wordsPerChunk).join(' ');
      if (chunk.length > 10) result.push(chunk);
    }

    return result.length > 0 ? result : [text];
  }

  private extractKeySentences(text: string, maxSentences: number): string {
    const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 20);

    if (sentences.length <= maxSentences) return sentences.join('. ') + '.';

    // Score sentences by word importance (TF-like)
    const wordFreq = new Map<string, number>();
    const allWords = text.toLowerCase().split(/\s+/);
    for (const w of allWords) {
      wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
    }

    const scored = sentences.map((s) => {
      const words = s.toLowerCase().split(/\s+/);
      const score = words.reduce((sum, w) => sum + (wordFreq.get(w) ?? 0), 0) / words.length;
      return { sentence: s, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxSentences).map((s) => s.sentence).join('. ') + '.';
  }

  private extractBulletPoints(text: string, maxPoints: number): string {
    const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 15);

    if (sentences.length === 0) return text.slice(0, 200);

    // Take evenly spaced sentences through the text
    const step = Math.max(1, Math.floor(sentences.length / maxPoints));
    const points: string[] = [];
    for (let i = 0; i < sentences.length && points.length < maxPoints; i += step) {
      const point = sentences[i].length > 100 ? sentences[i].slice(0, 100) + '...' : sentences[i];
      points.push(`- ${point}`);
    }

    return points.join('\n');
  }

  private detectLanguage(text: string): KnowledgeEntry['language'] {
    // Simple heuristic: check for Norwegian-specific characters and common words
    const norwegianPatterns = /\b(og|er|det|en|av|til|som|har|med|for|ikke|var|den|han|hun|vi|kan|vil|skal|alle|dette|fra|om|men|ble|har|seg|sin|sitt)\b/gi;
    const norwegianChars = /[æøåÆØÅ]/g;

    const noMatches = (text.match(norwegianPatterns) ?? []).length;
    const noChars = (text.match(norwegianChars) ?? []).length;

    // Check for code patterns
    const codePatterns = /\b(function|const|let|var|class|import|export|return|if|else|for|while|switch|case|break|continue|try|catch|throw|async|await|interface|type|enum|struct|fn|pub|mod|use|impl|trait|def|self|lambda|yield)\b/g;
    const codeMatches = (text.match(codePatterns) ?? []).length;

    const totalWords = text.split(/\s+/).length;
    const codeRatio = codeMatches / totalWords;
    const noRatio = (noMatches + noChars) / totalWords;

    if (codeRatio > 0.05) return 'code';
    if (noRatio > 0.02 || noChars > 0) return 'no';
    return 'en';
  }
}
