/**
 * Perplexity-Style Search Pipeline — Types
 *
 * Structured types for the full search flow:
 *   clarify → fan out → rank → read → cross-check → conclude
 *
 * VaiSearchPlan is the normalized query schema that drives the pipeline.
 * SearchResult carries trust signals, citations, and provenance.
 */

// ── Query Normalization ──

export interface VaiSearchPlan {
  /** Original user query */
  readonly originalQuery: string;
  /** Extracted primary intent (what the user actually wants to know) */
  readonly intent: string;
  /** Key entities mentioned (people, technologies, organizations, etc.) */
  readonly entities: readonly string[];
  /** Constraints (time range, domain, language, etc.) */
  readonly constraints: SearchConstraints;
  /** Scoped sub-queries for parallel fan-out (3-6 narrow searches) */
  readonly fanOutQueries: readonly string[];
}

export interface SearchConstraints {
  /** Prefer results from this date range */
  readonly dateRange?: { from?: string; to?: string };
  /** Limit to specific domains (e.g., github.com, stackoverflow.com) */
  readonly domainFilter?: readonly string[];
  /** Exclude these domains */
  readonly domainExclude?: readonly string[];
  /** Prefer code-related results */
  readonly codeOnly?: boolean;
}

// ── Source Trust ──

export type TrustTier = 'high' | 'medium' | 'low' | 'untrusted';

export interface TrustSignal {
  readonly tier: TrustTier;
  /** Numeric score 0-1 */
  readonly score: number;
  /** Why this trust level was assigned */
  readonly reason: string;
}

// ── Search Results ──

export type SearchSyncState = 'linear' | 'parallel' | 'wormhole';

export interface SearchSyncStatus {
  /** Thorsen Curve state for this search run */
  readonly state: SearchSyncState;
  /** End-to-end latency for the search pipeline */
  readonly latencyMs: number;
  /** Current adaptive concurrency recommendation */
  readonly recommendedConcurrency: number;
  /** Median latency observed by the adaptive controller */
  readonly medianLatencyMs: number;
  /** P95 latency observed by the adaptive controller */
  readonly p95LatencyMs: number;
  /** Number of observations in the adaptive controller window */
  readonly observations: number;
}

export interface SearchSnippet {
  /** Text content of the snippet */
  readonly text: string;
  /** Source URL */
  readonly url: string;
  /** Domain extracted from URL */
  readonly domain: string;
  /** Title of the page/article */
  readonly title: string;
  /** Favicon URL for UI display */
  readonly favicon: string;
  /** Trust assessment for this source */
  readonly trust: TrustSignal;
  /** Position in original search results (lower = more prominent) */
  readonly rank: number;
}

export interface SearchResponse {
  /** The synthesized answer with inline citations */
  readonly answer: string;
  /** Sources used, ordered by trust × relevance */
  readonly sources: readonly SearchSnippet[];
  /** The search plan that was executed */
  readonly plan: VaiSearchPlan;
  /** How many raw results were fetched before filtering */
  readonly rawResultCount: number;
  /** Confidence score (0-1) based on source agreement and trust tiers */
  readonly confidence: number;
  /** Execution time in ms */
  readonly durationMs: number;
  /** Thorsen Curve sync classification for this search */
  readonly sync: SearchSyncStatus;
  /** Audit trail: full provenance log */
  readonly audit: readonly AuditEntry[];
}

export interface AuditEntry {
  readonly step: 'clarify' | 'fan-out' | 'fetch' | 'rank' | 'read' | 'cross-check' | 'conclude';
  readonly detail: string;
  readonly durationMs: number;
}

// ── Pipeline Config ──

export interface SearchPipelineConfig {
  /** Maximum number of fan-out queries (default: 6) */
  readonly maxFanOut: number;
  /** Maximum results to fetch per query (default: 5) */
  readonly resultsPerQuery: number;
  /** Minimum trust score to include in answer (default: 0.3) */
  readonly minTrustScore: number;
  /** Timeout per fetch in ms (default: 8000) */
  readonly fetchTimeoutMs: number;
  /** Maximum total snippets to synthesize (default: 10) */
  readonly maxSnippets: number;
  /** Number of top-ranked URLs to read full page content from (default: 3) */
  readonly readTopN: number;
  /** Max characters to extract per page read (default: 4000) */
  readonly maxPageChars: number;
  /** LRU cache capacity — number of query results to cache (default: 100) */
  readonly cacheSize: number;
  /** Cache TTL in ms (default: 10 minutes) */
  readonly cacheTtlMs: number;
  /** Brave Search API key (free tier: 2000 req/month — https://api.search.brave.com) */
  readonly braveApiKey?: string;
  /** SearXNG base URL for self-hosted search (e.g. http://localhost:8080) */
  readonly searxngUrl?: string;
}

export const DEFAULT_SEARCH_CONFIG: SearchPipelineConfig = {
  maxFanOut: 6,
  resultsPerQuery: 5,
  minTrustScore: 0.3,
  fetchTimeoutMs: 8000,
  maxSnippets: 10,
  readTopN: 3,
  maxPageChars: 4000,
  cacheSize: 100,
  cacheTtlMs: 10 * 60_000,
};

/** Callback invoked when the pipeline finds useful content — used by VaiEngine to learn. */
export type OnSearchLearn = (text: string, sourceUrl: string) => void;
