import { STOP_WORDS, QUERY_ACTION_WORDS } from './stop-words.js';

export class VaiTokenizer {
  private vocab: Map<string, number> = new Map();
  private reverseVocab: Map<number, string> = new Map();
  private nextId = 0;

  constructor() {
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
    const words = text.toLowerCase().split(/(\s+|[.,!?;:'"()[\]{}])/g).filter(Boolean);
    return words.map((word) => {
      if (!this.vocab.has(word)) this.addToken(word);
      return this.vocab.get(word)!;
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

export interface KnowledgeEntry {
  readonly pattern: string;
  response: string;
  frequency: number;
  source: string;
  language: 'en' | 'no' | 'code' | 'mixed';
}

class TopicBloomFilter {
  private readonly bits: Uint32Array;
  private readonly size: number;
  private count = 0;

  constructor(expectedItems = 4096) {
    this.size = expectedItems * 10;
    this.bits = new Uint32Array(Math.ceil(this.size / 32));
  }

  private hash1(input: string): number {
    let hash = 0;
    for (let index = 0; index < input.length; index++) hash = (hash * 31 + input.charCodeAt(index)) | 0;
    return Math.abs(hash) % this.size;
  }

  private hash2(input: string): number {
    let hash = 0;
    for (let index = 0; index < input.length; index++) hash = (hash * 37 + input.charCodeAt(index)) | 0;
    return Math.abs(hash) % this.size;
  }

  private hash3(input: string): number {
    let hash = 5381;
    for (let index = 0; index < input.length; index++) hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0;
    return Math.abs(hash) % this.size;
  }

  private setBit(position: number): void {
    this.bits[position >>> 5] |= 1 << (position & 31);
  }

  private getBit(position: number): boolean {
    return (this.bits[position >>> 5] & (1 << (position & 31))) !== 0;
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

  get itemCount(): number {
    return this.count;
  }
}

export class KnowledgeStore {
  private entries: KnowledgeEntry[] = [];
  private ngramCounts: Map<string, Map<string, number>> = new Map();
  private readonly topicFilter = new TopicBloomFilter();
  private entryWordIndex: Map<string, Set<number>> = new Map();
  private documents: Array<{ id: string; source: string; words: string[]; wordSet: Set<string> }> = [];
  private documentFrequency: Map<string, number> = new Map();
  private wordToDocIndices: Map<string, Set<number>> = new Map();
  private concepts: Map<string, { definition: string; source: string; frequency: number }> = new Map();

  private static readonly COVERAGE_THRESHOLD = 0.25;
  private static readonly PER_WORD_BOOST = 0.15;
  private static readonly SUBSTRING_BASE = 0.3;
  private static readonly REVERSE_CONTAIN_FLOOR = 0.5;
  private static readonly TRUSTED_MIN_SCORE = 0.2;
  private static readonly TRUSTED_BOOST = 0.15;
  private static readonly YOUTUBE_PENALTY = 0.6;
  private static readonly COGNITIVE_PENALTY = 0.3;
  private static readonly UI_CHROME_PENALTY = 0.1;
  private static readonly QUERY_COVERAGE_WEIGHT = 0.7;
  private static readonly JACCARD_WEIGHT = 0.3;
  private static readonly MATCH_THRESHOLD = 0.25;
  private static readonly DOC_MATCH_THRESHOLD = 0.15;

  learn(text: string, source: string, _language: KnowledgeEntry['language'] = 'en'): void {
    const words = text.toLowerCase().split(/\s+/);

    for (let index = 0; index < words.length; index += 200) {
      const segment = words.slice(index, index + 200);
      const wordSet = new Set(segment);
      const docId = `${source}:${index}`;
      const docIdx = this.documents.length;
      this.documents.push({ id: docId, source, words: segment, wordSet });
      for (const word of wordSet) {
        this.documentFrequency.set(word, (this.documentFrequency.get(word) ?? 0) + 1);
        if (!this.wordToDocIndices.has(word)) this.wordToDocIndices.set(word, new Set());
        this.wordToDocIndices.get(word)!.add(docIdx);
      }
    }

    for (let index = 0; index < words.length - 1; index++) {
      const context = words[index];
      const next = words[index + 1];
      if (!this.ngramCounts.has(context)) {
        this.ngramCounts.set(context, new Map());
      }
      const counts = this.ngramCounts.get(context)!;
      counts.set(next, (counts.get(next) ?? 0) + 1);
    }

    for (let index = 0; index < words.length - 2; index++) {
      const context = `${words[index]} ${words[index + 1]}`;
      const next = words[index + 2];
      if (!this.ngramCounts.has(context)) {
        this.ngramCounts.set(context, new Map());
      }
      const counts = this.ngramCounts.get(context)!;
      counts.set(next, (counts.get(next) ?? 0) + 1);
    }

    this.extractConcepts(text, source);
  }

  private extractConcepts(text: string, source: string): void {
    const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10 && s.length < 500);

    for (const sentence of sentences) {
      const isMatch = sentence.match(/^([A-Z][a-zA-Z0-9 _-]{1,60})\s+(?:is|are|was|were)\s+(?:a\s+|an\s+|the\s+)?(.{10,300})$/);
      if (isMatch) {
        const concept = isMatch[1].trim().toLowerCase();
        if (!/^(it|this|that|they|he|she|we|there|here|which|what|who)$/i.test(concept)) {
          this.addConcept(concept, sentence, source);
        }
      }

      const refMatch = sentence.match(/^([A-Z][a-zA-Z0-9 _-]{1,60})\s+(?:refers?\s+to|means?|denotes?|represents?)\s+(.{10,300})$/);
      if (refMatch) {
        const concept = refMatch[1].trim().toLowerCase();
        this.addConcept(concept, sentence, source);
      }

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
      if (definition.length > existing.definition.length) {
        existing.definition = definition;
        existing.source = source;
      }
    } else {
      this.concepts.set(name, { definition, source, frequency: 1 });
    }
  }

  findConcept(query: string): { name: string; definition: string; source: string } | null {
    const lower = query.toLowerCase().trim();
    const exact = this.concepts.get(lower);
    if (exact) return { name: lower, definition: exact.definition, source: exact.source };

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

  addEntry(pattern: string, response: string, source: string, language: KnowledgeEntry['language'] = 'en'): void {
    const existing = this.entries.find((entry) => entry.pattern === pattern.toLowerCase());
    if (existing) {
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

    const words = pattern.toLowerCase().split(/\s+/).filter(word => word.length > 1);
    for (const word of words) {
      if (!this.entryWordIndex.has(word)) this.entryWordIndex.set(word, new Set());
      this.entryWordIndex.get(word)!.add(idx);
    }
    this.topicFilter.add(pattern);

    const responseWords = response.toLowerCase().split(/\s+/).filter(word => word.length > 1);
    if (responseWords.length > 5) {
      const wordSet = new Set(responseWords);
      const docIdx = this.documents.length;
      const docId = `entry:${pattern.toLowerCase().substring(0, 60)}`;
      this.documents.push({ id: docId, source: `entry:${source}`, words: responseWords, wordSet });
      for (const word of wordSet) {
        this.documentFrequency.set(word, (this.documentFrequency.get(word) ?? 0) + 1);
        if (!this.wordToDocIndices.has(word)) this.wordToDocIndices.set(word, new Set());
        this.wordToDocIndices.get(word)!.add(docIdx);
      }
    }
  }

  findExactEntry(patterns: readonly string[]): KnowledgeEntry | null {
    const normalizedPatterns = new Set(
      patterns
        .map((pattern) => pattern.toLowerCase().trim())
        .filter((pattern) => pattern.length > 0),
    );
    if (normalizedPatterns.size === 0) return null;

    let bestMatch: KnowledgeEntry | null = null;
    for (const entry of this.entries) {
      const normalizedPattern = entry.pattern.toLowerCase().trim();
      if (!normalizedPatterns.has(normalizedPattern)) continue;
      if (KnowledgeStore.isJunkContent(entry.response)) continue;

      if (
        bestMatch === null
        || entry.frequency > bestMatch.frequency
        || (entry.frequency === bestMatch.frequency && entry.response.length > bestMatch.response.length)
      ) {
        bestMatch = entry;
      }
    }

    return bestMatch;
  }

  clearTaughtEntries(): void {
    const kept: KnowledgeEntry[] = [];
    for (const entry of this.entries) {
      if (!entry.source.includes('vcus') && entry.source !== 'user-taught') {
        kept.push(entry);
      }
    }
    this.entries = kept;
    this.entryWordIndex.clear();
    for (let index = 0; index < this.entries.length; index++) {
      const words = this.entries[index].pattern.split(/\s+/).filter(word => word.length > 1);
      for (const word of words) {
        if (!this.entryWordIndex.has(word)) this.entryWordIndex.set(word, new Set());
        this.entryWordIndex.get(word)!.add(index);
      }
    }
  }

  mightKnow(topic: string): boolean {
    return this.topicFilter.mightContain(topic);
  }

  findBestMatch(input: string): KnowledgeEntry | null {
    const query = input.toLowerCase().replace(/[?!,;:"'(){}\[\]<>\/]/g, ' ').replace(/\s+/g, ' ').trim();
    const queryWords = query.split(/\s+/).filter(word => word.length > 1);
    let best: KnowledgeEntry | null = null;
    let bestScore = 0;

    const meaningfulWords = queryWords.filter(word => word.length > 2 && !KnowledgeStore.STOP_WORDS.has(word));
    const rarestWord = meaningfulWords.length >= 1
      ? meaningfulWords.map(word => ({ word, docCount: this.getWordDocCount(word) }))
          .sort((left, right) => left.docCount - right.docCount)[0]?.word ?? null
      : null;

    const candidateIndices = new Set<number>();
    for (const word of queryWords) {
      const indices = this.entryWordIndex.get(word);
      if (indices) {
        for (const idx of indices) candidateIndices.add(idx);
      }
    }

    if (queryWords.length <= 3) {
      for (let index = 0; index < this.entries.length; index++) {
        if (this.entries[index].pattern.includes(query) || query.includes(this.entries[index].pattern)) {
          candidateIndices.add(index);
        }
      }
    }

    for (const idx of candidateIndices) {
      const entry = this.entries[idx];

      if (
        entry.response.startsWith('[No transcript available') ||
        entry.response.startsWith('[Transcript not') ||
        entry.response.length < 10
      ) {
        continue;
      }

      const isTrustedSource = entry.source.startsWith('bootstrap') || entry.source === 'user-taught' || entry.source === 'auto-learned';
      if (!isTrustedSource && KnowledgeStore.isJunkContent(entry.response)) {
        continue;
      }

      if (rarestWord && !isTrustedSource) {
        if (!entry.pattern.toLowerCase().includes(rarestWord)) {
          continue;
        }
      }

      let score = this.similarity(query, entry.pattern);

      if (query.includes(entry.pattern.toLowerCase())) {
        const patternWords = entry.pattern.split(/\s+/).filter(word => word.length > 0);
        const patternLen = patternWords.length;
        const queryLen = queryWords.length;
        const coverage = patternLen / Math.max(queryLen, 1);

        if (patternLen <= 2 && patternWords.every(word => queryWords.includes(word.toLowerCase()))) {
          score = Math.max(score, 0.55);
        } else if (coverage > KnowledgeStore.COVERAGE_THRESHOLD) {
          const boost = Math.min(0.5, patternLen * KnowledgeStore.PER_WORD_BOOST);
          score = Math.max(score, KnowledgeStore.SUBSTRING_BASE + boost);
        }
      }

      if (entry.pattern.toLowerCase().includes(query) && queryWords.length > 1) {
        score = Math.max(score, KnowledgeStore.REVERSE_CONTAIN_FLOOR);
      }

      if (isTrustedSource && score > KnowledgeStore.TRUSTED_MIN_SCORE) {
        score += KnowledgeStore.TRUSTED_BOOST;
      }

      if (entry.source.includes('youtube.com') || entry.source.includes('youtu.be') || entry.source === 'youtube') {
        score *= KnowledgeStore.YOUTUBE_PENALTY;
      }

      if (entry.source === 'bootstrap:cognitive-foundations') {
        score *= KnowledgeStore.COGNITIVE_PENALTY;
      }

      if (/^\s*(VeggaAI|Select a conversation|New Chat|Knowledge Base)/i.test(entry.response)) {
        score *= KnowledgeStore.UI_CHROME_PENALTY;
      }

      if (rarestWord) {
        const patternWordsLower = entry.pattern.toLowerCase().split(/\s+/);
        if (patternWordsLower.includes(rarestWord)) {
          score = Math.max(score, 0.6 * score + 0.4 * 0.55);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }

    const adaptiveThreshold = queryWords.length <= 2 ? 0.15 : queryWords.length <= 5 ? 0.2 : 0.25;
    if (bestScore <= adaptiveThreshold || !best) return null;
    return best;
  }

  findBestMatchWithScore(input: string): { entry: KnowledgeEntry; score: number } | null {
    const match = this.findBestMatch(input);
    if (!match) return null;

    const query = input.toLowerCase().replace(/[?!,;:"'(){}\[\]<>]/g, ' ').replace(/\s+/g, ' ').trim();
    const base = this.similarity(query, match.pattern);
    let score = base;
    if (query.includes(match.pattern.toLowerCase())) {
      const patternLen = match.pattern.split(/\s+/).length;
      const queryLen = query.split(/\s+/).length;
      const coverage = patternLen / Math.max(queryLen, 1);
      if (coverage > KnowledgeStore.COVERAGE_THRESHOLD) {
        score = Math.max(score, KnowledgeStore.SUBSTRING_BASE + Math.min(0.5, patternLen * KnowledgeStore.PER_WORD_BOOST));
      }
    }
    if (match.pattern.toLowerCase().includes(query) && query.split(/\s+/).length > 1) {
      score = Math.max(score, KnowledgeStore.REVERSE_CONTAIN_FLOOR);
    }
    if (match.source === 'user-taught' || match.source.startsWith('bootstrap')) score += KnowledgeStore.TRUSTED_BOOST;
    return { entry: match, score };
  }

  findBestMatchForSource(input: string, sourcePrefix: string): KnowledgeEntry | null {
    const query = input.toLowerCase().replace(/[?!,;:"'(){}\[\]<>]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    const queryWords = query.split(/\s+/).filter(word => word.length > 1);
    let best: KnowledgeEntry | null = null;
    let bestScore = 0;

    for (let index = 0; index < this.entries.length; index++) {
      const entry = this.entries[index];
      if (!entry.source.startsWith(sourcePrefix)) continue;
      if (entry.response.length < 10) continue;

      let score = this.similarity(query, entry.pattern);

      if (query.includes(entry.pattern.toLowerCase())) {
        const patternLen = entry.pattern.split(/\s+/).length;
        const queryLen = Math.max(queryWords.length, 1);
        const coverage = patternLen / queryLen;
        if (coverage > KnowledgeStore.COVERAGE_THRESHOLD) {
          score = Math.max(score, KnowledgeStore.SUBSTRING_BASE + Math.min(0.5, patternLen * KnowledgeStore.PER_WORD_BOOST));
        }
      }

      if (entry.pattern.toLowerCase().includes(query) && queryWords.length > 1) {
        score = Math.max(score, KnowledgeStore.REVERSE_CONTAIN_FLOOR);
      }

      if (entry.source.startsWith('bootstrap')) score += KnowledgeStore.TRUSTED_BOOST;

      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }

    return bestScore > KnowledgeStore.TRUSTED_MIN_SCORE && best ? best : null;
  }

  findBestTaughtMatch(input: string): KnowledgeEntry | null {
    const query = input.toLowerCase();
    const normalize = (text: string): string[] =>
      text.replace(/[^a-z0-9\s\-_.]/g, '').split(/\s+/)
        .filter(word => word.length > 1 && !KnowledgeStore.STOP_WORDS.has(word));

    const prefixMatch = (left: string, right: string): boolean => {
      if (left === right) return true;
      const min = Math.min(left.length, right.length);
      if (min < 3) return false;
      const prefixLen = min >= 4 ? 4 : 3;
      return left.slice(0, prefixLen) === right.slice(0, prefixLen) && Math.abs(left.length - right.length) <= 3;
    };

    const meaningfulQuery = normalize(query);
    if (meaningfulQuery.length === 0) return null;

    let best: KnowledgeEntry | null = null;
    let bestScore = 0;
    let bestHits = 0;

    for (let index = 0; index < this.entries.length; index++) {
      const entry = this.entries[index];
      if (!entry.source.includes('vcus') && entry.source !== 'user-taught') continue;

      const patternWords = normalize(entry.pattern);
      if (patternWords.length === 0) continue;

      const qSet = new Set(meaningfulQuery);
      const pSet = new Set(patternWords);
      const pArr = [...pSet];

      const matchedQueryWords = [...qSet].filter(queryWord => pArr.some(patternWord => prefixMatch(queryWord, patternWord)));
      const hits = matchedQueryWords.length;
      if (hits === 0) continue;

      const queryCoverage = hits / qSet.size;
      const union = new Set([...qSet, ...pSet]);
      const jaccard = hits / union.size;

      let score = KnowledgeStore.QUERY_COVERAGE_WEIGHT * queryCoverage + KnowledgeStore.JACCARD_WEIGHT * jaccard;

      const patternCoverage = hits / pSet.size;
      if (patternCoverage >= 0.8) score += 0.1;

      if (score > bestScore) {
        bestScore = score;
        best = entry;
        bestHits = hits;
      }
    }

    if (bestScore <= KnowledgeStore.MATCH_THRESHOLD || !best) return null;
    if (meaningfulQuery.length >= 3 && bestHits < 2) return null;
    return best;
  }

  findBestDocumentMatch(query: string, threshold = KnowledgeStore.DOC_MATCH_THRESHOLD): { text: string; source: string; score: number } | null {
    const results = this.retrieveRelevant(query, 1);
    if (results.length === 0 || results[0].score < threshold) return null;
    return results[0];
  }

  generateFromNgrams(seed: string, maxTokens: number): string {
    const words = seed.toLowerCase().split(/\s+/);
    const output = [...words];

    for (let index = 0; index < maxTokens; index++) {
      if (output.length >= 2) {
        const triContext = `${output[output.length - 2]} ${output[output.length - 1]}`;
        const triCounts = this.ngramCounts.get(triContext);
        if (triCounts && triCounts.size > 0) {
          output.push(this.weightedSample(triCounts));
          continue;
        }
      }

      const biContext = output[output.length - 1];
      const biCounts = this.ngramCounts.get(biContext);
      if (biCounts && biCounts.size > 0) {
        output.push(this.weightedSample(biCounts));
        continue;
      }

      break;
    }

    return output.slice(words.length).join(' ');
  }

  private weightedSample(counts: Map<string, number>): string {
    const total = Array.from(counts.values()).reduce((left, right) => left + right, 0);
    let remaining = Math.random() * total;
    for (const [word, count] of counts) {
      remaining -= count;
      if (remaining <= 0) return word;
    }
    return counts.keys().next().value!;
  }

  static readonly STOP_WORDS = new Set([...STOP_WORDS, ...QUERY_ACTION_WORDS]);

  static isJunkContent(text: string): boolean {
    const lower = text.toLowerCase();
    const timestampCount = (lower.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) ?? []).length;
    if (timestampCount >= 3) return true;
    if (timestampCount >= 1 && /[•·▸]/.test(lower)) return true;
    if (/\bvideo\s+\d{2}\.\d/i.test(lower) && /\bvideo\s+\d{2}\.\d.*\bvideo\s+\d{2}\.\d/i.test(lower)) return true;

    const viewCountHits = (lower.match(/(?:avspillinger|views|visninger|subscribers|abonnenter|plays|watching)/g) ?? []).length;
    if (viewCountHits >= 1) return true;
    if (/\b(?:for\s+)?\d+\s+(?:år|months?|weeks?|days?|timer?|hours?|minutes?)\s+(?:siden|ago)\b/i.test(lower)) return true;
    if (/(?:^\d+\.\s+|•\s*\d+:\d+|playlist|subscribe|notification)/i.test(lower) && timestampCount >= 1) return true;

    const bulletSegments = lower.split(/[•·]/).length - 1;
    if (bulletSegments >= 2 && timestampCount >= 1) return true;
    if (/\blearn\s+\w+\s+in\s+\d+\s+minutes?\b/i.test(lower) && (timestampCount >= 1 || bulletSegments >= 1)) return true;
    if (/^(?:select\s+a\s+conversation|new\s+chat|knowledge\s+base|veggaai\s+ai\s+online)/i.test(lower)) return true;

    const appShellChromeHits = [
      /\bsearch\s+computer\b/i,
      /\bnew\s+thread\b/i,
      /\bdiscover\s+spaces\b/i,
      /\bmore\s+recent\b/i,
      /\baccount\s*(?:&|and)\s*settings\b/i,
      /\bupgrade\s+to\s+access\s+the\s+top\s+ai\s+models\b/i,
      /\bask\s+anything\b/i,
      /\bmodel\s+computer\b/i,
    ].filter((pattern) => pattern.test(lower)).length;
    if (appShellChromeHits >= 2) return true;

    const wordCount = lower.split(/\s+/).length;
    if (wordCount < 3) return true;

    const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu) ?? []).length;
    if (emojiCount > 3 && emojiCount / wordCount > 0.08) return true;

    const flagCount = (text.match(/[\u{1F1E0}-\u{1F1FF}]/gu) ?? []).length;
    if (flagCount >= 2) return true;

    if (/\b(?:valid feedback|rate (?:this|us|our)|cookie\s*(?:policy|consent|settings)|sign\s*(?:in|up)\s*(?:with|to)|privacy\s*policy|terms\s*(?:of|&)\s*(?:service|use)|copyright\s*©?\s*\d{4})\b/i.test(lower)) return true;
    if (/\b(?:last updated|page migrating|copy page|sidebar|breadcrumb|skip to (?:content|main))\b/i.test(lower) && wordCount < 60) return true;
    if (text.trim().length < 10 && !/[.!?]$/.test(text.trim())) return true;

    return false;
  }

  retrieveRelevant(query: string, topK = 5): Array<{ text: string; source: string; score: number }> {
    if (this.documents.length === 0) return [];

    const queryWords = query.toLowerCase().split(/\s+/)
      .filter(word => word.length > 2 && !KnowledgeStore.STOP_WORDS.has(word));
    if (queryWords.length === 0) return [];

    const candidateDocIndices = new Set<number>();
    for (const queryWord of queryWords) {
      const docIndices = this.wordToDocIndices.get(queryWord);
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
      for (const queryWord of queryWords) {
        if (!doc.wordSet.has(queryWord)) continue;
        matchedWords++;
        const tf = doc.words.filter((word) => word === queryWord).length / doc.words.length;
        const df = this.documentFrequency.get(queryWord) ?? 1;
        const idf = Math.log(totalDocs / df);
        score += tf * idf;
      }
      if (matchedWords === 0) continue;

      const source = doc.source;
      if (source.startsWith('entry:bootstrap') || source.startsWith('entry:user-taught') || source.startsWith('entry:vcus')) {
        score *= 1.4;
      } else if (source.includes('youtube.com') || source.includes('youtu.be') || source === 'youtube') {
        score *= 0.6;
      }

      const text = doc.words.join(' ');
      if (/^veggaai\s+ai\s+online\s+\d+\s+words/i.test(text)) continue;
      if (text.startsWith('[no transcript available')) continue;
      if (KnowledgeStore.isJunkContent(text)) continue;

      scored.push({ text, source: doc.source, score });
    }

    return scored
      .sort((left, right) => right.score - left.score)
      .slice(0, topK);
  }

  get documentCount(): number {
    return this.documents.length;
  }

  getWordDocCount(word: string): number {
    return this.wordToDocIndices.get(word.toLowerCase())?.size ?? 0;
  }

  private similarity(left: string, right: string): number {
    const strip = (value: string) => value.replace(/[?!,;:"'(){}\[\]<>\/]/g, ' ');
    const wordsA = new Set(strip(left).split(/\s+/).filter(word => word.length > 0));
    const wordsB = new Set(strip(right).split(/\s+/).filter(word => word.length > 0));
    const intersection = new Set([...wordsA].filter((word) => wordsB.has(word)));
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
    for (const entry of this.entries) {
      this.topicFilter.add(entry.pattern);
    }
  }

  topicSummary(): Array<{ topic: string; entryCount: number; sources: string[]; depth: 'deep' | 'shallow' | 'bootstrap-only' }> {
    const topicMap = new Map<string, { count: number; sources: Set<string>; hasNonBootstrap: boolean }>();

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
        if (keywords.some(keyword => combined.includes(keyword))) {
          if (!topicMap.has(topic)) topicMap.set(topic, { count: 0, sources: new Set(), hasNonBootstrap: false });
          const topicData = topicMap.get(topic)!;
          topicData.count++;
          topicData.sources.add(entry.source.split(':')[0]);
          if (!entry.source.startsWith('bootstrap')) topicData.hasNonBootstrap = true;
          matched = true;
          break;
        }
      }

      if (!matched) {
        const words = entry.pattern.split(/\s+/).filter(word => word.length > 2 && !KnowledgeStore.STOP_WORDS.has(word));
        const topic = words[0] ?? 'uncategorized';
        if (!topicMap.has(topic)) topicMap.set(topic, { count: 0, sources: new Set(), hasNonBootstrap: false });
        const topicData = topicMap.get(topic)!;
        topicData.count++;
        topicData.sources.add(entry.source.split(':')[0]);
        if (!entry.source.startsWith('bootstrap')) topicData.hasNonBootstrap = true;
      }
    }

    return Array.from(topicMap.entries())
      .map(([topic, data]) => ({
        topic,
        entryCount: data.count,
        sources: Array.from(data.sources),
        depth: data.count >= 5 ? 'deep' as const : !data.hasNonBootstrap ? 'bootstrap-only' as const : 'shallow' as const,
      }))
      .sort((left, right) => right.entryCount - left.entryCount);
  }
}