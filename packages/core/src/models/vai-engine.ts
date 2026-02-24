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
  pattern: string;       // input pattern (lowercased)
  response: string;      // learned response
  frequency: number;     // how often this pattern was seen
  source: string;        // where this knowledge came from
  language: 'en' | 'no' | 'code' | 'mixed';
}

export class KnowledgeStore {
  private entries: KnowledgeEntry[] = [];
  private ngramCounts: Map<string, Map<string, number>> = new Map();

  // TF-IDF index for retrieval
  private documents: Array<{ id: string; source: string; words: string[]; wordSet: Set<string> }> = [];
  private documentFrequency: Map<string, number> = new Map(); // word -> how many docs contain it

  /**
   * Learn from a text corpus — builds n-gram frequencies + TF-IDF index.
   */
  learn(text: string, source: string, _language: KnowledgeEntry['language'] = 'en'): void {
    const words = text.toLowerCase().split(/\s+/);

    // Add to TF-IDF document index (chunk into ~200 word segments)
    for (let i = 0; i < words.length; i += 200) {
      const segment = words.slice(i, i + 200);
      const wordSet = new Set(segment);
      const docId = `${source}:${i}`;
      this.documents.push({ id: docId, source, words: segment, wordSet });
      for (const w of wordSet) {
        this.documentFrequency.set(w, (this.documentFrequency.get(w) ?? 0) + 1);
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
  }

  /**
   * Add a pattern-response pair (for Q&A style knowledge).
   */
  addEntry(pattern: string, response: string, source: string, language: KnowledgeEntry['language'] = 'en'): void {
    const existing = this.entries.find((e) => e.pattern === pattern.toLowerCase());
    if (existing) {
      existing.frequency++;
      return;
    }
    this.entries.push({
      pattern: pattern.toLowerCase(),
      response,
      frequency: 1,
      source,
      language,
    });
  }

  /**
   * Find the best matching response for an input.
   */
  findBestMatch(input: string): KnowledgeEntry | null {
    const query = input.toLowerCase();
    let best: KnowledgeEntry | null = null;
    let bestScore = 0;

    for (const entry of this.entries) {
      const score = this.similarity(query, entry.pattern);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }

    return bestScore > 0.3 ? best : null;
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

  /**
   * TF-IDF retrieval: find the most relevant document chunks for a query.
   */
  retrieveRelevant(query: string, topK = 5): Array<{ text: string; source: string; score: number }> {
    if (this.documents.length === 0) return [];

    const queryWords = query.toLowerCase().split(/\s+/);
    const totalDocs = this.documents.length;

    const scored = this.documents.map((doc) => {
      let score = 0;
      for (const qw of queryWords) {
        if (!doc.wordSet.has(qw)) continue;
        // TF: frequency of query word in this document
        const tf = doc.words.filter((w) => w === qw).length / doc.words.length;
        // IDF: inverse document frequency
        const df = this.documentFrequency.get(qw) ?? 1;
        const idf = Math.log(totalDocs / df);
        score += tf * idf;
      }
      return { text: doc.words.join(' '), source: doc.source, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  get documentCount(): number {
    return this.documents.length;
  }

  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
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
  }
}

// ---- VAI Engine (the model adapter) ----

export class VaiEngine implements ModelAdapter {
  readonly id = 'vai:v0';
  readonly displayName = 'VeggaAI v0';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;

  readonly tokenizer = new VaiTokenizer();
  readonly knowledge = new KnowledgeStore();

  private systemPrompt = 'You are VeggaAI (VAI), a local-first AI assistant that learns from your data. You are still in early training — be honest about what you know and what you are still learning.';

  constructor() {
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
      'what can you do', 'Right now I can: learn from text you feed me, answer based on what I have learned, and try to generate text. I am v0 — pattern matching and n-grams. As you feed me more data and we build more of my architecture, I will get better.',
      'bootstrap', 'en',
    );
  }

  /**
   * Feed text data to VAI so it learns.
   */
  train(text: string, source: string, language: KnowledgeEntry['language'] = 'en'): void {
    this.knowledge.learn(text, source, language);
    this.tokenizer.encode(text); // expand vocabulary
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const lastMessage = request.messages[request.messages.length - 1];
    const response = this.generateResponse(lastMessage.content, request.messages);

    return {
      message: { role: 'assistant', content: response },
      usage: { promptTokens: this.tokenizer.encode(lastMessage.content).length, completionTokens: this.tokenizer.encode(response).length },
      finishReason: 'stop',
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const lastMessage = request.messages[request.messages.length - 1];
    const response = this.generateResponse(lastMessage.content, request.messages);

    // Simulate streaming by yielding word by word
    const words = response.split(' ');
    for (let i = 0; i < words.length; i++) {
      const text = (i === 0 ? '' : ' ') + words[i];
      yield { type: 'text_delta', textDelta: text };
      // Small delay to feel like streaming
      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    yield {
      type: 'done',
      usage: {
        promptTokens: this.tokenizer.encode(lastMessage.content).length,
        completionTokens: this.tokenizer.encode(response).length,
      },
    };
  }

  private generateResponse(input: string, _history: Message[]): string {
    // Strategy 1: Check knowledge store for a direct match
    const match = this.knowledge.findBestMatch(input);
    if (match) {
      return match.response;
    }

    // Strategy 2: TF-IDF retrieval — find relevant learned content
    const retrieved = this.knowledge.retrieveRelevant(input, 3);
    if (retrieved.length > 0 && retrieved[0].score > 0.01) {
      const context = retrieved.map((r) => r.text).join(' ... ');
      // Combine retrieved context with n-gram generation for a response
      const continuation = this.knowledge.generateFromNgrams(
        input,
        30,
      );

      if (continuation.length > 10) {
        return `Based on what I've learned: ${continuation}\n\n[Source: ${retrieved[0].source}]`;
      }

      // Return retrieved context directly with source attribution
      const snippet = context.length > 500 ? context.slice(0, 500) + '...' : context;
      return `From what I've learned, here's what I found relevant:\n\n${snippet}\n\n[Sources: ${retrieved.map((r) => r.source).join(', ')}]`;
    }

    // Strategy 3: Try n-gram continuation alone
    const continuation = this.knowledge.generateFromNgrams(input, 50);
    if (continuation.length > 10) {
      return continuation;
    }

    // Strategy 4: Honest "I don't know yet" response
    const stats = this.getStats();
    const responses = [
      `I haven't learned enough yet to answer that well. Feed me some data — ingest web pages, YouTube transcripts, or GitHub repos and I'll get better! (vocab: ${stats.vocabSize} tokens, knowledge: ${stats.knowledgeEntries} entries, ${stats.ngramContexts} n-gram contexts, ${stats.documentsIndexed} documents indexed)`,
      `I'm still in early training (v0). I have ${stats.documentsIndexed} documents indexed and ${stats.knowledgeEntries} knowledge entries. Teach me more!`,
      `That's beyond what I've learned so far. My knowledge base: ${stats.knowledgeEntries} entries, ${stats.documentsIndexed} docs indexed. The more you teach me, the better I get.`,
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  getStats(): { vocabSize: number; knowledgeEntries: number; ngramContexts: number; documentsIndexed: number } {
    return {
      vocabSize: this.tokenizer.vocabSize,
      knowledgeEntries: this.knowledge.entryCount,
      ngramContexts: this.knowledge.ngramCount,
      documentsIndexed: this.knowledge.documentCount,
    };
  }
}
