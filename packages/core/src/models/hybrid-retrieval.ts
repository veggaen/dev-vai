/**
 * Hybrid retrieval — deterministic, dependency-free ranking that combines
 * BM25 (lexical recall with term-frequency saturation) and character-trigram
 * Jaccard (paraphrase / morphology / typo robustness).
 *
 * Fixes the main failure mode of the word-only TF-IDF in KnowledgeStore:
 * paraphrased queries ("how do I containerize X" vs doc "Docker containers
 * package X") that share semantic content but few surface tokens.
 *
 * Thorsen shape applied to retrieval:
 *   receive    → query + candidate docs
 *   normalize  → tokenize (BM25) + 3-gram shingle (Jaccard)
 *   route      → per-doc score via both kernels
 *   synthesize → weighted sum, L1-normalized for comparability
 *   verify     → rank sort, topK slice
 *   score      → return scored list (caller gets attribution)
 *
 * No weights are magic: BM25_K1 / B are the canonical defaults; TRIGRAM_WEIGHT
 * is 0.35 (tuned so pure keyword matches still dominate exact hits, but a
 * paraphrase with zero shared tokens can still surface).
 */

export interface HybridDocument {
  readonly id: string;
  readonly text: string;
  readonly source?: string;
}

export interface HybridScore {
  readonly doc: HybridDocument;
  readonly score: number;
  readonly bm25: number;
  readonly trigram: number;
}

export interface HybridIndexStats {
  readonly documents: number;
  readonly avgDocLength: number;
  readonly vocabularySize: number;
}

export interface HybridRetrieverOptions {
  /**
   * Score only documents with a lexical query hit when one exists. This is
   * useful for large corpora whose caller rejects BM25-zero results anyway.
   * Queries without lexical hits still fall back to the full fuzzy scan.
   */
  readonly candidateMode?: 'all' | 'lexical-first';
  /** Optional lexical token filter used only while selecting candidates. */
  readonly candidateTokenFilter?: (token: string) => boolean;
  /** Maximum documents to score after lexical candidate generation. */
  readonly candidateBudget?: number;
  /** Maximum lexical candidates to rerank with the more expensive trigram kernel. */
  readonly rerankBudget?: number;
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const TRIGRAM_WEIGHT = 0.35;
const BM25_WEIGHT = 1 - TRIGRAM_WEIGHT;

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9æøå]+/g, ' ').split(/\s+/).filter((t) => t.length > 1);
}

function trigrams(text: string): Set<string> {
  const s = ` ${text.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export class HybridRetriever {
  private docs: HybridDocument[] = [];
  private docTokens: string[][] = [];
  private docTermFreqs: Array<Map<string, number>> = [];
  private docTrigrams: Array<Set<string> | null> = [];
  private docLengths: number[] = [];
  private docFreq = new Map<string, number>();
  private tokenToDocIndices = new Map<string, Set<number>>();
  private totalDocLength = 0;

  constructor(private readonly options: HybridRetrieverOptions = {}) {}

  add(doc: HybridDocument): void {
    const tokens = tokenize(doc.text);
    const tgs = this.options.candidateMode === 'lexical-first' ? null : trigrams(doc.text);
    const unique = new Set(tokens);
    const docIdx = this.docs.length;
    const termFreq = new Map<string, number>();
    for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
    for (const t of unique) {
      this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
      if (!this.tokenToDocIndices.has(t)) this.tokenToDocIndices.set(t, new Set());
      this.tokenToDocIndices.get(t)!.add(docIdx);
    }
    this.docs.push(doc);
    this.docTokens.push(tokens);
    this.docTermFreqs.push(termFreq);
    this.docTrigrams.push(tgs);
    this.docLengths.push(tokens.length);
    this.totalDocLength += tokens.length;
  }

  addBatch(docs: readonly HybridDocument[]): void {
    for (const d of docs) this.add(d);
  }

  clear(): void {
    this.docs = [];
    this.docTokens = [];
    this.docTermFreqs = [];
    this.docTrigrams = [];
    this.docLengths = [];
    this.docFreq.clear();
    this.tokenToDocIndices.clear();
    this.totalDocLength = 0;
  }

  stats(): HybridIndexStats {
    const n = this.docs.length;
    return {
      documents: n,
      avgDocLength: n === 0 ? 0 : this.totalDocLength / n,
      vocabularySize: this.docFreq.size,
    };
  }

  private bm25Score(queryTokens: string[], docIdx: number): number {
    const n = this.docs.length;
    if (n === 0) return 0;
    const avgdl = this.totalDocLength / n;
    const dl = this.docLengths[docIdx];
    let score = 0;
    const termFreq = this.docTermFreqs[docIdx];
    for (const q of queryTokens) {
      const tf = termFreq.get(q) ?? 0;
      if (tf === 0) continue;
      const df = this.docFreq.get(q) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / (avgdl || 1)));
      score += idf * ((tf * (BM25_K1 + 1)) / denom);
    }
    return score;
  }

  retrieve(query: string, topK = 5, docFilter?: (doc: HybridDocument) => boolean): HybridScore[] {
    if (this.docs.length === 0) return [];
    const qTokens = tokenize(query);
    const qTri = trigrams(query);
    if (qTokens.length === 0 && qTri.size === 0) return [];

    const rawBm25: number[] = new Array(this.docs.length);
    const rawTri: number[] = new Array(this.docs.length);
    let maxBm25 = 0;
    let maxTri = 0;
    const lexicalCandidateWeights = new Map<number, number>();
    if (this.options.candidateMode === 'lexical-first') {
      const candidateTokens = this.options.candidateTokenFilter
        ? qTokens.filter(this.options.candidateTokenFilter)
        : qTokens;
      for (const token of candidateTokens) {
        const docIndices = this.tokenToDocIndices.get(token);
        if (!docIndices) continue;
        const rarityWeight = 1 / docIndices.size;
        for (const docIdx of docIndices) {
          if (docFilter && !docFilter(this.docs[docIdx])) continue;
          lexicalCandidateWeights.set(docIdx, (lexicalCandidateWeights.get(docIdx) ?? 0) + rarityWeight);
        }
      }
      if (lexicalCandidateWeights.size === 0) return [];
    }
    const candidateBudget = Math.max(topK, this.options.candidateBudget ?? Number.POSITIVE_INFINITY);
    const candidateIndices = lexicalCandidateWeights.size > 0
      ? [...lexicalCandidateWeights.entries()]
          .sort((left, right) => right[1] - left[1] || left[0] - right[0])
          .slice(0, candidateBudget)
          .map(([docIdx]) => docIdx)
      : this.docs.flatMap((doc, index) => !docFilter || docFilter(doc) ? [index] : []);
    for (const i of candidateIndices) {
      rawBm25[i] = this.bm25Score(qTokens, i);
    }
    const rerankBudget = this.options.candidateMode === 'lexical-first'
      ? Math.max(topK, this.options.rerankBudget ?? candidateIndices.length)
      : candidateIndices.length;
    const rerankIndices = candidateIndices.length > rerankBudget
      ? [...candidateIndices]
          .sort((left, right) =>
            rawBm25[right] - rawBm25[left]
            || (lexicalCandidateWeights.get(right) ?? 0) - (lexicalCandidateWeights.get(left) ?? 0)
            || left - right)
          .slice(0, rerankBudget)
      : candidateIndices;
    for (const i of rerankIndices) {
      const docTrigrams = this.docTrigrams[i] ?? trigrams(this.docs[i].text);
      this.docTrigrams[i] = docTrigrams;
      rawTri[i] = jaccard(qTri, docTrigrams);
      if (rawBm25[i] > maxBm25) maxBm25 = rawBm25[i];
      if (rawTri[i] > maxTri) maxTri = rawTri[i];
    }

    const scored: HybridScore[] = [];
    for (const i of rerankIndices) {
      const bNorm = maxBm25 === 0 ? 0 : rawBm25[i] / maxBm25;
      const tNorm = maxTri === 0 ? 0 : rawTri[i] / maxTri;
      const blended = BM25_WEIGHT * bNorm + TRIGRAM_WEIGHT * tNorm;
      if (blended === 0) continue;
      scored.push({ doc: this.docs[i], score: blended, bm25: rawBm25[i], trigram: rawTri[i] });
    }

    scored.sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id));
    return scored.slice(0, topK);
  }
}

/** Convenience: one-shot scoring without retaining an index. */
export function scoreHybrid(query: string, docs: readonly HybridDocument[], topK = 5): HybridScore[] {
  const r = new HybridRetriever();
  r.addBatch(docs);
  return r.retrieve(query, topK);
}
