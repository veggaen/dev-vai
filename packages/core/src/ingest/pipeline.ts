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
import { sources, chunks, images } from '../db/schema.js';
import type { VaiEngine } from '../models/vai-engine.js';
import type { KnowledgeEntry } from '../models/vai-engine.js';

export interface IngestResult {
  sourceId: string;
  title: string;
  chunkCounts: { l0: number; l1: number; l2: number };
  tokensLearned: number;
  updated?: boolean; // true if this was an update of an existing source
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
   * Hydrate the engine from persisted data on startup.
   * Loads L0 chunks into the n-gram model and L1 summaries as knowledge entries.
   */
  hydrate(): { sourcesLoaded: number; chunksLoaded: number; imagesLoaded: number } {
    const allSources = this.db.select().from(sources).all();
    let chunksLoaded = 0;

    for (const src of allSources) {
      // Load L0 chunks into n-gram model + TF-IDF
      const l0Chunks = this.db.select().from(chunks)
        .where(eq(chunks.sourceId, src.id))
        .all()
        .filter(c => c.level === 0)
        .sort((a, b) => a.ordinal - b.ordinal);

      if (l0Chunks.length > 0) {
        const fullText = l0Chunks.map(c => c.content).join(' ');
        const language = this.detectLanguage(fullText);
        this.engine.train(fullText, src.url ?? src.title, language);
        chunksLoaded += l0Chunks.length;
      }

      // Load L1 summary as a knowledge entry for direct retrieval
      const l1 = this.db.select().from(chunks)
        .where(eq(chunks.sourceId, src.id))
        .all()
        .find(c => c.level === 1);

      if (l1) {
        const language = this.detectLanguage(l1.content);
        this.engine.knowledge.addEntry(
          src.title,
          l1.content,
          src.url ?? src.title,
          language,
        );
      }
    }

    // Hydrate image descriptions into the engine
    const allImages = this.db.select({
      id: images.id,
      filename: images.filename,
      description: images.description,
      question: images.question,
    }).from(images).all();

    for (const img of allImages) {
      const parts = [`Image: ${img.filename}`, `Description: ${img.description}`];
      if (img.question) parts.push(`Question: ${img.question}`);
      const text = parts.join('\n');
      const language = this.detectLanguage(img.description);
      this.engine.train(text, `image:${img.id}`, language);
      this.engine.knowledge.addEntry(img.filename, text, `image:${img.id}`, language);
    }

    return { sourcesLoaded: allSources.length, chunksLoaded, imagesLoaded: allImages.length };
  }

  /**
   * Ingest raw content: clean, chunk, summarize, store, and train.
   * If a source with the same URL already exists, it is updated (not duplicated).
   */
  ingest(capture: RawCapture): IngestResult {
    const now = new Date();
    const language = capture.language ?? this.detectLanguage(capture.content);

    // Check for existing source with the same URL — update instead of duplicating
    let sourceId: string;
    const existing = capture.url
      ? this.db.select().from(sources).where(eq(sources.url, capture.url)).all()[0]
      : null;

    if (existing) {
      sourceId = existing.id;

      // Update the existing source record
      this.db.update(sources).set({
        title: capture.title,
        capturedAt: now,
        meta: capture.meta ? JSON.stringify(capture.meta) : existing.meta,
      }).where(eq(sources.id, sourceId)).run();

      // Delete old chunks — they'll be recreated below
      this.db.delete(chunks).where(eq(chunks.sourceId, sourceId)).run();
    } else {
      sourceId = ulid();

      // Store new source record
      this.db.insert(sources).values({
        id: sourceId,
        sourceType: capture.sourceType === 'github' || capture.sourceType === 'search'
          ? 'web' : capture.sourceType,
        url: capture.url,
        title: capture.title,
        capturedAt: now,
        meta: capture.meta ? JSON.stringify(capture.meta) : null,
      }).run();
    }

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
      updated: !!existing,
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

  /**
   * Get detailed info for a single source, including all chunk content.
   */
  getSourceDetail(sourceId: string) {
    const src = this.db.select().from(sources).where(eq(sources.id, sourceId)).all()[0];
    if (!src) return null;

    const allChunks = this.db.select().from(chunks)
      .where(eq(chunks.sourceId, sourceId))
      .all()
      .sort((a, b) => a.level - b.level || a.ordinal - b.ordinal);

    const l0 = allChunks.filter(c => c.level === 0).map(c => c.content);
    const l1 = allChunks.find(c => c.level === 1)?.content ?? null;
    const l2 = allChunks.find(c => c.level === 2)?.content ?? null;

    return {
      ...src,
      meta: src.meta ? JSON.parse(src.meta) : null,
      content: {
        full: l0.join('\n\n'),
        summary: l1,
        bullets: l2,
      },
      chunkCount: allChunks.length,
    };
  }

  /**
   * Re-process all existing sources: re-clean L0 chunks with improved cleaning,
   * re-generate L1 summaries and L2 bullets, and re-train the engine.
   * This does NOT re-fetch content — it uses the existing L0 chunks in the DB.
   */
  reprocessAll(onProgress?: (done: number, total: number, title: string) => void): {
    total: number;
    processed: number;
    errors: number;
  } {
    const allSources = this.db.select().from(sources).all();
    let processed = 0;
    let errors = 0;

    for (const src of allSources) {
      try {
        // Get all L0 chunks for this source
        const l0Chunks = this.db.select().from(chunks)
          .where(eq(chunks.sourceId, src.id))
          .all()
          .filter(c => c.level === 0)
          .sort((a, b) => a.ordinal - b.ordinal);

        if (l0Chunks.length === 0) {
          processed++;
          continue;
        }

        // Reconstruct the full text and re-clean it
        const rawText = l0Chunks.map(c => c.content).join(' ');
        const cleaned = this.cleanText(rawText);

        // Delete ALL old chunks for this source
        this.db.delete(chunks).where(eq(chunks.sourceId, src.id)).run();

        // Re-create L0 chunks with cleaned text
        const newL0 = this.chunkText(cleaned, 500);
        for (let i = 0; i < newL0.length; i++) {
          this.db.insert(chunks).values({
            id: ulid(),
            sourceId: src.id,
            level: 0,
            ordinal: i,
            content: newL0[i],
            meta: null,
          }).run();
        }

        // Re-create L1 summary
        const l1Text = this.extractKeySentences(cleaned, 10);
        this.db.insert(chunks).values({
          id: ulid(),
          sourceId: src.id,
          level: 1,
          ordinal: 0,
          content: l1Text,
          meta: null,
        }).run();

        // Re-create L2 bullets
        const l2Text = this.extractBulletPoints(cleaned, 7);
        this.db.insert(chunks).values({
          id: ulid(),
          sourceId: src.id,
          level: 2,
          ordinal: 0,
          content: l2Text,
          meta: null,
        }).run();

        // Re-train engine on cleaned text
        const language = this.detectLanguage(cleaned);
        this.engine.train(cleaned, src.url ?? src.title, language);
        this.engine.knowledge.addEntry(src.title, l1Text, src.url ?? src.title, language);

        processed++;
        if (onProgress) onProgress(processed, allSources.length, src.title);
      } catch {
        errors++;
        processed++;
      }
    }

    return { total: allSources.length, processed, errors };
  }

  /**
   * Ingest an image with its human-provided description (and optional question).
   * The description is trained into the engine as knowledge. The image blob is stored in SQLite.
   */
  ingestImage(input: {
    data: string;        // base64
    mimeType: string;
    filename?: string;
    description: string; // required — at least 1 true fact about the image
    question?: string;
    width?: number;
    height?: number;
    sizeBytes?: number;
    conversationId?: string;
    sourceUrl?: string;
  }): { imageId: string; trained: boolean } {
    const id = ulid();

    // Store the image record
    this.db.insert(images).values({
      id,
      conversationId: input.conversationId ?? null,
      filename: input.filename ?? `image-${id}.png`,
      mimeType: input.mimeType,
      data: input.data,
      description: input.description,
      question: input.question ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      sizeBytes: input.sizeBytes ?? null,
      createdAt: new Date(),
    }).run();

    // Build training text from the description + question
    const trainingParts: string[] = [];
    trainingParts.push(`Image: ${input.filename ?? 'screenshot'}`);
    trainingParts.push(`Description: ${input.description}`);
    if (input.question) trainingParts.push(`Question: ${input.question}`);
    if (input.sourceUrl) trainingParts.push(`Source: ${input.sourceUrl}`);

    const trainingText = trainingParts.join('\n');
    const language = this.detectLanguage(input.description);

    // Train the engine on this image description
    this.engine.train(trainingText, `image:${id}`, language);

    // Also add as knowledge entry
    this.engine.knowledge.addEntry(
      input.filename ?? `Image ${id}`,
      trainingText,
      `image:${id}`,
      language,
    );

    return { imageId: id, trained: true };
  }

  /**
   * List all images, optionally filtered to those with descriptions.
   */
  listImages(limit = 50) {
    return this.db.select({
      id: images.id,
      filename: images.filename,
      mimeType: images.mimeType,
      description: images.description,
      question: images.question,
      width: images.width,
      height: images.height,
      sizeBytes: images.sizeBytes,
      createdAt: images.createdAt,
    }).from(images).limit(limit).all();
  }

  /**
   * Get an image by ID (including the base64 data).
   */
  getImage(imageId: string) {
    return this.db.select().from(images).where(eq(images.id, imageId)).get();
  }

  // ---- Private helpers ----

  private cleanText(text: string): string {
    let cleaned = text
      .replace(/<[^>]*>/g, ' ')                     // strip HTML tags
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

    // Strip YouTube page noise patterns that sneak in from DOM scraping
    cleaned = cleaned
      .replace(/\b\d+[KkMm]?\s*avspillinger\b/g, '')              // Norwegian view counts
      .replace(/\b\d+[KkMm]?\s*views?\b/g, '')                    // English view counts
      .replace(/\bfor\s+\d+\s+(timer|døgn|måneder?|uker?)\s+siden\b/g, '') // Norwegian relative dates
      .replace(/\b\d+\s+(hours?|days?|weeks?|months?|years?)\s+ago\b/g, '') // English relative dates
      .replace(/\b(Ny|Strømmet|abonnenter?|Bli medlem|Del|Lagre)\b/g, '')   // Norwegian YT UI
      .replace(/\b(Subscribe|Share|Save|Like|Dislike|Clip)\b/g, '')          // English YT UI
      .replace(/Hopp over navigeringen/g, '')       // "Skip navigation" in Norwegian
      .replace(/Opprett\s+\d+\+/g, '')             // "Create 9+" etc
      .replace(/Sorter etter/g, '')                 // "Sort by"
      .replace(/Legg til en kommentar/g, '')        // "Add a comment"
      .replace(/Oversett til engelsk/g, '')         // "Translate to English"
      .replace(/Les mer/g, '')                      // "Read more"
      .replace(/Svar\b/g, '')                       // "Reply"
      .replace(/Innholdet er ikke tilgjengelig/g, '') // "Content not available"
      .replace(/Prøv igjen senere/g, '');            // "Try again later"

    return cleaned
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
