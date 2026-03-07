/**
 * Perplexity-Style Search Pipeline
 *
 * Full structured search flow:
 *   1. CLARIFY   — normalize query → VaiSearchPlan (intent, entities, constraints)
 *   2. FAN OUT   — parallel sub-queries (3-6 scoped searches)
 *   3. FETCH     — execute searches, collect raw snippets
 *   4. RANK      — score by trust × relevance, deduplicate
 *   5. READ      — extract answerable content from top results
 *   6. CROSS-CHECK — verify claims appear in multiple sources
 *   7. CONCLUDE  — synthesize answer with inline citations
 *
 * Safety is embedded at every step: URL validation before fetch,
 * trust scoring on results, content scanning on text, dedup on snippets.
 */

import type {
  VaiSearchPlan,
  SearchConstraints,
  SearchSnippet,
  SearchResponse,
  AuditEntry,
  SearchPipelineConfig,
  TrustTier,
  OnSearchLearn,
} from './types.js';
import { DEFAULT_SEARCH_CONFIG } from './types.js';
import { validateSearchUrl, scoreDomain, scanContentSafety, contentFingerprint, assessUrl } from './safety.js';

// ── Query Normalization (Step 1: CLARIFY) ──

/** Common query intent markers */
const INTENT_PATTERNS: ReadonlyArray<{ pattern: RegExp; intent: string }> = [
  { pattern: /^(what is|what are|what's|define)\b/i, intent: 'definition' },
  { pattern: /^(how to|how do|how can|how does)\b/i, intent: 'how-to' },
  { pattern: /^(why|why does|why is|why are)\b/i, intent: 'explanation' },
  { pattern: /^(compare|versus|vs\.?|difference between)\b/i, intent: 'comparison' },
  { pattern: /^(best|top|recommend|alternatives)\b/i, intent: 'recommendation' },
  { pattern: /^(when|what year|what date|timeline)\b/i, intent: 'temporal' },
  { pattern: /^(who|who is|who are|who was)\b/i, intent: 'person' },
  { pattern: /^(debug|fix|error|issue|problem|bug)\b/i, intent: 'troubleshoot' },
  { pattern: /\b(latest|newest|recent|2024|2025)\b/i, intent: 'current' },
];

/** Stop words to strip when extracting entities */
const ENTITY_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'about', 'and', 'but',
  'or', 'if', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
  'those', 'i', 'me', 'my', 'it', 'its', 'we', 'they', 'search', 'find',
  'look', 'up', 'tell', 'give', 'show', 'get', 'know', 'please',
]);

export function buildSearchPlan(query: string): VaiSearchPlan {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();

  // Detect intent
  const matched = INTENT_PATTERNS.find(p => p.pattern.test(lower));
  const intent = matched?.intent ?? 'general';

  // Extract entities (meaningful words)
  const words = trimmed.split(/\s+/);
  const entities = words
    .filter(w => !ENTITY_STOP_WORDS.has(w.toLowerCase()) && w.length > 1)
    .map(w => w.replace(/[^a-zA-Z0-9_.#+-]/g, ''))
    .filter(w => w.length > 1);

  // Build constraints from query signals
  const constraints: SearchConstraints = {};

  // Generate fan-out queries (scoped sub-searches)
  const fanOutQueries = generateFanOutQueries(trimmed, intent, entities);

  return {
    originalQuery: trimmed,
    intent,
    entities,
    constraints,
    fanOutQueries,
  };
}

function generateFanOutQueries(query: string, intent: string, entities: readonly string[]): string[] {
  const queries: string[] = [query]; // always include original

  const entityStr = entities.slice(0, 4).join(' ');

  switch (intent) {
    case 'definition':
      queries.push(`${entityStr} explained simply`);
      queries.push(`${entityStr} wikipedia`);
      break;
    case 'how-to':
      queries.push(`${entityStr} tutorial step by step`);
      queries.push(`${entityStr} example code`);
      break;
    case 'explanation':
      queries.push(`${entityStr} reason why explained`);
      queries.push(`${entityStr} cause`);
      break;
    case 'comparison':
      queries.push(`${entityStr} pros cons comparison`);
      queries.push(`${entityStr} benchmarks performance`);
      break;
    case 'recommendation':
      queries.push(`best ${entityStr} 2025`);
      queries.push(`${entityStr} alternatives comparison`);
      break;
    case 'troubleshoot':
      queries.push(`${entityStr} solution fix`);
      queries.push(`${entityStr} stackoverflow`);
      break;
    case 'current':
      queries.push(`${entityStr} latest 2025`);
      queries.push(`${entityStr} release notes changelog`);
      break;
    default:
      queries.push(`${entityStr} overview`);
      break;
  }

  // Cap at configured max
  return queries.slice(0, 6);
}

// ── DuckDuckGo Search Provider (Step 3: FETCH) ──

interface RawSearchResult {
  title: string;
  snippet: string;
  url: string;
}

async function fetchDuckDuckGo(query: string, timeoutMs: number): Promise<RawSearchResult[]> {
  const results: RawSearchResult[] = [];

  // 1. Instant Answer API
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(ddgUrl, {
      headers: { 'User-Agent': 'VeggaAI/0.1' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const data = await res.json() as {
        Abstract?: string; AbstractSource?: string; AbstractURL?: string;
        Answer?: string; AnswerType?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };

      if (data.Abstract && data.Abstract.length > 20) {
        results.push({
          title: data.AbstractSource ?? 'DuckDuckGo',
          snippet: data.Abstract,
          url: data.AbstractURL ?? `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        });
      }
      if (data.Answer && data.Answer.length > 5) {
        results.push({
          title: 'Instant Answer',
          snippet: data.Answer,
          url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        });
      }
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, 5)) {
          if (topic.Text && topic.Text.length > 10 && topic.FirstURL) {
            results.push({ title: '', snippet: topic.Text, url: topic.FirstURL });
          }
        }
      }
    }
  } catch { /* continue to fallback */ }

  // 2. HTML scrape fallback
  if (results.length === 0) {
    try {
      const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(htmlUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const html = await res.text();
        // Extract titles and snippets
        const titleRegex = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
        const snippetRegex = /<a class="result__snippet"[^>]*>(.*?)<\/a>/gi;

        const titles: Array<{ url: string; title: string }> = [];
        let m;
        while ((m = titleRegex.exec(html)) !== null && titles.length < 8) {
          titles.push({ url: m[1], title: m[2].replace(/<\/?[^>]+(>|$)/g, '').trim() });
        }

        const snippets: string[] = [];
        while ((m = snippetRegex.exec(html)) !== null && snippets.length < 8) {
          snippets.push(m[1].replace(/<\/?[^>]+(>|$)/g, '').trim());
        }

        for (let i = 0; i < Math.min(titles.length, snippets.length); i++) {
          if (snippets[i].length > 15) {
            results.push({ title: titles[i].title, snippet: snippets[i], url: titles[i].url });
          }
        }
      }
    } catch { /* no results */ }
  }

  return results;
}

// ── Ranking (Step 4: RANK) ──

function rankSnippets(
  rawResults: Array<RawSearchResult & { queryIndex: number }>,
  minTrust: number,
): SearchSnippet[] {
  const seen = new Set<string>();
  const scored: SearchSnippet[] = [];

  for (const raw of rawResults) {
    // URL safety check
    let domain: string;
    try {
      const url = validateSearchUrl(raw.url);
      domain = url.hostname;
    } catch {
      continue; // skip unsafe URLs
    }

    // Content safety
    const safety = scanContentSafety(raw.snippet);
    if (!safety.safe) continue;

    // Dedup by content fingerprint
    const fp = contentFingerprint(raw.snippet);
    if (seen.has(fp)) continue;
    seen.add(fp);

    // Trust scoring
    const trust = scoreDomain(domain);
    if (trust.score < minTrust) continue;

    // Relevance boost: earlier queries and earlier results rank higher
    const positionBoost = 1 / (1 + raw.queryIndex * 0.3);

    scored.push({
      text: raw.snippet.slice(0, 500),
      url: raw.url,
      domain,
      title: raw.title,
      favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`,
      trust,
      rank: trust.score * positionBoost,
    });
  }

  // Sort by combined rank descending
  scored.sort((a, b) => b.rank - a.rank);
  return scored;
}

// ── Cross-Check (Step 5: verify claims across sources) ──

function crossCheck(snippets: readonly SearchSnippet[]): readonly SearchSnippet[] {
  if (snippets.length <= 1) return snippets;

  // Extract key phrases from each snippet, boost those that appear in multiple sources
  const phraseCount = new Map<string, number>();
  for (const s of snippets) {
    // Extract 3-word phrases
    const words = s.text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const phrases = new Set<string>();
    for (let i = 0; i < words.length - 2; i++) {
      phrases.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
    for (const p of phrases) {
      phraseCount.set(p, (phraseCount.get(p) ?? 0) + 1);
    }
  }

  // Find phrases corroborated by 2+ sources
  const corroborated = new Set<string>();
  for (const [phrase, count] of phraseCount) {
    if (count >= 2) corroborated.add(phrase);
  }

  // Re-rank: boost snippets that contain corroborated phrases
  return snippets.map(s => {
    const words = s.text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    let boost = 0;
    for (let i = 0; i < words.length - 2; i++) {
      if (corroborated.has(`${words[i]} ${words[i + 1]} ${words[i + 2]}`)) boost++;
    }
    const boostFactor = 1 + Math.min(boost, 5) * 0.1;
    return { ...s, rank: s.rank * boostFactor };
  }).sort((a, b) => b.rank - a.rank);
}

// ── Synthesis (Step 6: CONCLUDE) ──

/**
 * Compute confidence score (0-1) based on source count,
 * trust tier distribution, and cross-check survival rate.
 */
function computeConfidence(snippets: readonly SearchSnippet[]): number {
  if (snippets.length === 0) return 0;

  // Factor 1: source count (diminishing returns, caps at ~6 sources)
  const countScore = Math.min(snippets.length / 6, 1);

  // Factor 2: average trust score of sources
  const avgTrust = snippets.reduce((sum, s) => sum + s.trust.score, 0) / snippets.length;

  // Factor 3: presence of high-trust sources (bonus)
  const highTrustCount = snippets.filter(s => s.trust.tier === 'high').length;
  const highBonus = Math.min(highTrustCount / 2, 1) * 0.15;

  // Factor 4: domain diversity (more diverse = more confident)
  const uniqueDomains = new Set(snippets.map(s => s.domain)).size;
  const diversityScore = Math.min(uniqueDomains / 3, 1);

  // Weighted combination
  const raw = (countScore * 0.25) + (avgTrust * 0.35) + (diversityScore * 0.25) + highBonus;
  return Math.min(Math.max(raw, 0), 1);
}

function synthesizeAnswer(query: string, snippets: readonly SearchSnippet[]): string {
  if (snippets.length === 0) {
    return `I searched for "${query}" but couldn't find useful results. Try rephrasing or being more specific.`;
  }

  const lines: string[] = [];
  lines.push(`**Search: "${query}"**\n`);

  // Group by trust tier for the summary
  const highTrust = snippets.filter(s => s.trust.tier === 'high');
  const medTrust = snippets.filter(s => s.trust.tier === 'medium');
  const otherTrust = snippets.filter(s => s.trust.tier !== 'high' && s.trust.tier !== 'medium');

  // Build answer from highest trust sources first
  const ordered = [...highTrust, ...medTrust, ...otherTrust];
  const used = ordered.slice(0, 5);

  for (let i = 0; i < used.length; i++) {
    const s = used[i];
    const citation = `[${i + 1}]`;
    const text = s.text.length > 300 ? s.text.slice(0, 300) + '...' : s.text;
    lines.push(`${citation} ${text}`);
  }

  lines.push('\n**Sources:**');
  for (let i = 0; i < used.length; i++) {
    const s = used[i];
    const trustBadge = s.trust.tier === 'high' ? '🟢' : s.trust.tier === 'medium' ? '🟡' : '🔴';
    const title = s.title || s.domain;
    lines.push(`${i + 1}. ${trustBadge} [${title}](${s.url}) — trust: ${s.trust.score.toFixed(2)}`);
  }

  return lines.join('\n');
}

// ── Page Reading (Step 5: READ — fetch full page content for top results) ──

/**
 * Fetch and extract readable text from a URL.
 * Lightweight extraction — strips HTML tags, nav, scripts, ads.
 * Returns null on any failure (network, timeout, safety).
 */
async function readPage(url: string, timeoutMs: number, maxChars: number): Promise<string | null> {
  try {
    validateSearchUrl(url); // SSRF check
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'VeggaAI/0.1 (Local AI Learning Agent)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('xhtml')) return null;

    const html = await res.text();
    const text = extractReadableText(html);
    if (text.length < 50) return null;

    // Content safety scan
    const safety = scanContentSafety(text.slice(0, 1000));
    if (!safety.safe) return null;

    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}

/** Strip HTML to readable text — lightweight version of ingest/web's extractMainContent */
function extractReadableText(html: string): string {
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Try semantic containers first
  const mainMatch = cleaned.match(/<main[^>]*>([\s\S]+)<\/main>/i);
  const articleMatch = cleaned.match(/<article[^>]*>([\s\S]+)<\/article>/i);
  if (mainMatch && mainMatch[1].length > 200) cleaned = mainMatch[1];
  else if (articleMatch && articleMatch[1].length > 200) cleaned = articleMatch[1];

  // Strip remaining tags
  cleaned = cleaned.replace(/<\/?[^>]+(>|$)/g, ' ');
  // Normalize whitespace
  cleaned = cleaned.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

/**
 * Read full pages for the top-N ranked snippets.
 * Enriches snippet text with full page content when available.
 */
async function readTopPages(
  snippets: SearchSnippet[],
  topN: number,
  timeoutMs: number,
  maxChars: number,
): Promise<{ enriched: SearchSnippet[]; pagesRead: number }> {
  const urlsSeen = new Set<string>();
  const toRead: Array<{ index: number; url: string }> = [];

  for (let i = 0; i < snippets.length && toRead.length < topN; i++) {
    const s = snippets[i];
    // Only read from trusted sources with real URLs
    if (s.trust.tier === 'untrusted') continue;
    if (urlsSeen.has(s.url)) continue;
    // Skip DuckDuckGo internal URLs
    if (s.url.includes('duckduckgo.com')) continue;
    urlsSeen.add(s.url);
    toRead.push({ index: i, url: s.url });
  }

  if (toRead.length === 0) return { enriched: snippets, pagesRead: 0 };

  const pageResults = await Promise.all(
    toRead.map(({ url }) => readPage(url, timeoutMs, maxChars)),
  );

  let pagesRead = 0;
  const enriched = [...snippets];
  for (let j = 0; j < toRead.length; j++) {
    const pageContent = pageResults[j];
    if (!pageContent || pageContent.length < 100) continue;
    pagesRead++;

    const { index, url } = toRead[j];
    const original = enriched[index];
    // Merge: use page content (richer) but keep original metadata
    enriched[index] = {
      ...original,
      text: pageContent.slice(0, maxChars),
      // Boost rank for successfully-read pages
      rank: original.rank * 1.3,
    };
  }

  // Re-sort after rank boost
  enriched.sort((a, b) => b.rank - a.rank);
  return { enriched, pagesRead };
}

// ── LRU Cache ──

interface CacheEntry {
  response: SearchResponse;
  timestamp: number;
}

class SearchCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): SearchResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.response;
  }

  set(key: string, response: SearchResponse): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { response, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ── Main Pipeline ──

export class SearchPipeline {
  private readonly config: SearchPipelineConfig;
  private readonly cache: SearchCache;
  private onLearn: OnSearchLearn | null = null;

  constructor(config?: Partial<SearchPipelineConfig>) {
    this.config = { ...DEFAULT_SEARCH_CONFIG, ...config };
    this.cache = new SearchCache(this.config.cacheSize, this.config.cacheTtlMs);
  }

  /** Register a callback to learn from search results (used by VaiEngine). */
  setLearnCallback(cb: OnSearchLearn): void {
    this.onLearn = cb;
  }

  /** Build a search plan without executing it (preview). */
  plan(query: string): VaiSearchPlan {
    return buildSearchPlan(query);
  }

  /** Clear the result cache. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Execute the full search pipeline: clarify → fan out → rank → read → cross-check → conclude */
  async search(query: string): Promise<SearchResponse> {
    // Check cache first
    const cacheKey = contentFingerprint(query.toLowerCase());
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const start = Date.now();
    const audit: AuditEntry[] = [];

    // Step 1: CLARIFY — normalize into structured plan
    const clarifyStart = Date.now();
    const plan = buildSearchPlan(query);
    audit.push({ step: 'clarify', detail: `Intent: ${plan.intent}, entities: [${plan.entities.join(', ')}], ${plan.fanOutQueries.length} sub-queries`, durationMs: Date.now() - clarifyStart });

    // Step 2+3: FAN OUT + FETCH — parallel sub-queries
    const fanOutStart = Date.now();
    const queries = plan.fanOutQueries.slice(0, this.config.maxFanOut);
    const allRaw: Array<RawSearchResult & { queryIndex: number }> = [];

    const fetchPromises = queries.map((q, idx) =>
      fetchDuckDuckGo(q, this.config.fetchTimeoutMs).then(results =>
        results.slice(0, this.config.resultsPerQuery).map(r => ({ ...r, queryIndex: idx })),
      ).catch(() => [] as Array<RawSearchResult & { queryIndex: number }>),
    );

    const batchResults = await Promise.all(fetchPromises);
    for (const batch of batchResults) {
      allRaw.push(...batch);
    }

    audit.push({ step: 'fan-out', detail: `${queries.length} queries, ${allRaw.length} raw results`, durationMs: Date.now() - fanOutStart });

    // Step 4: RANK — score by trust × relevance, deduplicate
    const rankStart = Date.now();
    const ranked = rankSnippets(allRaw, this.config.minTrustScore);
    audit.push({ step: 'rank', detail: `${ranked.length} snippets after trust filter + dedup (from ${allRaw.length} raw)`, durationMs: Date.now() - rankStart });

    // Step 5: READ — fetch full page content for top-N results
    const readStart = Date.now();
    const { enriched, pagesRead } = await readTopPages(
      ranked.slice(0, this.config.maxSnippets),
      this.config.readTopN,
      this.config.fetchTimeoutMs,
      this.config.maxPageChars,
    );
    audit.push({ step: 'read', detail: `${pagesRead} pages read from top ${Math.min(ranked.length, this.config.maxSnippets)} results`, durationMs: Date.now() - readStart });

    // Step 6: CROSS-CHECK — verify claims across multiple sources
    const crossStart = Date.now();
    const verified = crossCheck(enriched);
    audit.push({ step: 'cross-check', detail: `${verified.length} snippets after cross-check`, durationMs: Date.now() - crossStart });

    // Step 7: CONCLUDE — synthesize answer with citations
    const concludeStart = Date.now();
    const answer = synthesizeAnswer(query, verified);
    audit.push({ step: 'conclude', detail: `Answer synthesized from ${verified.length} sources`, durationMs: Date.now() - concludeStart });

    // Notify learn callback with top results
    if (this.onLearn) {
      for (const s of verified.slice(0, 3)) {
        if (s.text.length > 50 && s.trust.tier !== 'untrusted') {
          this.onLearn(s.text.slice(0, 2000), s.url);
        }
      }
    }

    const response: SearchResponse = {
      answer,
      sources: verified,
      plan,
      rawResultCount: allRaw.length,
      confidence: computeConfidence(verified),
      durationMs: Date.now() - start,
      audit,
    };

    // Cache the result
    this.cache.set(cacheKey, response);

    return response;
  }
}

// ── Follow-Up Suggestions (Perplexity-style) ──

/**
 * Generate 2-3 follow-up questions based on the search query and results.
 * These help users dig deeper into the topic without reformulating.
 */
export function generateFollowUps(query: string, response: SearchResponse): string[] {
  const plan = response.plan;
  const entities = plan.entities.slice(0, 3);
  const entityStr = entities.join(' ');
  const followUps: string[] = [];

  switch (plan.intent) {
    case 'definition':
      followUps.push(`How does ${entityStr} work in practice?`);
      followUps.push(`What are the alternatives to ${entityStr}?`);
      followUps.push(`What are common ${entityStr} best practices?`);
      break;
    case 'how-to':
      followUps.push(`What are common mistakes when ${entityStr.toLowerCase()}?`);
      followUps.push(`What are the best tools for ${entityStr.toLowerCase()}?`);
      followUps.push(`${entityStr} advanced techniques`);
      break;
    case 'comparison':
      followUps.push(`Which is better for beginners, ${entityStr}?`);
      followUps.push(`Performance benchmarks for ${entityStr}`);
      followUps.push(`Migration guide between ${entityStr}`);
      break;
    case 'troubleshoot':
      followUps.push(`Why does this ${entityStr.toLowerCase()} error happen?`);
      followUps.push(`How to prevent ${entityStr.toLowerCase()} issues?`);
      followUps.push(`${entityStr} debugging tools`);
      break;
    default:
      followUps.push(`Tell me more about ${entityStr}`);
      followUps.push(`${entityStr} examples and use cases`);
      if (entities.length > 1) followUps.push(`How does ${entities[0]} relate to ${entities[1]}?`);
      else followUps.push(`Latest developments in ${entityStr}`);
      break;
  }

  return followUps.slice(0, 3);
}
