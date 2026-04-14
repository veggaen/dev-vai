---
name: web-search
description: Search the web via SearXNG (self-hosted meta-search) with DDG/Wikipedia fallback. Returns ranked results with trust scores and citations.
version: 1.0.0
author: vai
trust: verified
triggers:
  - search
  - google
  - look up
  - find out
  - research
  - latest
  - current
  - what is
  - who is
  - when did
  - how does
tools:
  - search
  - fetch
permissions:
  - web
---

# Web Search Skill

## Purpose
Query multiple search engines simultaneously and return ranked, deduplicated results with trust scores.

## Search provider priority
1. **SearXNG** (self-hosted, `http://localhost:8080`) — queries Google + Bing + DDG + Wikipedia at once, zero rate limits
2. **DuckDuckGo Instant Answer API** — free, no key, good for factual questions
3. **Wikipedia REST API** — `https://en.wikipedia.org/api/rest_v1/page/summary/{term}` — high trust, free
4. **DDG Lite HTML** — scrape fallback when APIs return nothing

## Procedure

### Query normalization
1. Remove question words: "what is", "how do I", "can you explain"
2. Extract key entities (nouns, proper nouns, version numbers)
3. Generate 2-3 query variants:
   - Exact query
   - Entity-only version
   - Quoted version for proper nouns

### Parallel search
1. Fire all providers simultaneously (Promise.allSettled)
2. Collect results per provider
3. Normalize to common format: `{ url, title, snippet, score, domain }`

### Ranking
Score = domain_trust × 0.4 + relevance_to_query × 0.4 + recency × 0.2

Recency bonus:
- Within 30 days: +0.2
- Within 1 year: +0.1
- Older: 0

### Deduplication
- Group by domain — keep only highest-scoring per domain
- Remove near-duplicate snippets (Jaccard similarity > 0.7)

### Output
Return top 8 results ranked by final score.

## Output format
```typescript
SearchResponse {
  query: string,
  results: SearchSnippet[],
  totalFound: number,
  providers: string[],
  searchedAt: string,
}

SearchSnippet {
  url: string,
  title: string,
  snippet: string,
  trustScore: number,  // 0-1
  domain: string,
  provider: string,
  publishedAt?: string,
}
```

## Notes
- Never fabricate snippets — only return what the provider returned
- If SearXNG is down, fall through to DDG silently
- Always include `providers` in output so the user knows which sources were queried
