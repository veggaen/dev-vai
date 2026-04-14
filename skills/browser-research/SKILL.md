---
name: browser-research
description: Navigate web pages, extract full text, follow links, and compile structured evidence from multiple sources.
version: 1.0.0
author: vai
trust: verified
triggers:
  - browse
  - read this page
  - open this link
  - navigate to
  - visit
  - scrape
  - extract from url
  - read the article
  - check this website
tools:
  - fetch
  - browser
  - extractor
permissions:
  - web
  - web-screenshots
  - page-text
requires:
  - fact-extractor
---

# Browser Research Skill

## Purpose
Navigate web pages and extract structured evidence. Goes deeper than web-search by reading full page content rather than just snippets.

## When to activate
- User provides a specific URL to read
- A prior web-search result needs deeper reading
- A claim requires page-level verification (not just snippet)

## Procedure

### Phase 1 — Fetch
1. GET the URL (timeout: 10s, follow redirects max 3)
2. Respect robots.txt — skip if disallow matches
3. Check content-type — only process text/html and text/plain
4. Strip: nav, footer, sidebar, ads, cookie banners, scripts, styles
5. Extract: title, main content, headings structure, publish date (if present)

### Phase 2 — Extract
1. Split content into paragraphs (min 50 chars, max 800 chars)
2. Score each paragraph for relevance to the query (TF-IDF or embedding)
3. Keep top 5 paragraphs, preserving character positions for provenance
4. Extract any structured data (tables, lists) separately

### Phase 3 — Evidence Assembly
For each extracted paragraph:
```
EvidenceBlock {
  id: sha1(url + charStart),
  url: original URL,
  title: page title,
  snippet: extracted paragraph,
  trustScore: domain_trust_score,
  domain: hostname,
  fetchedAt: ISO timestamp,
}
```

### Phase 4 — Link Following (optional, depth ≤ 1)
If the query requires broader context:
1. Extract internal links from the page
2. Filter to links that seem topically relevant (keyword overlap with query > 0.4)
3. Fetch top 2 relevant links and add their evidence to the pool

## Trust scoring
| Domain type | Score range |
|---|---|
| .gov, .edu | 0.85 – 0.95 |
| Major news (reuters, bbc, nytimes) | 0.75 – 0.85 |
| Known encyclopedias (wikipedia) | 0.80 – 0.90 |
| Tech docs (mdn, docs.python.org) | 0.85 – 0.95 |
| Unknown / personal blogs | 0.30 – 0.50 |
| No HTTPS | 0.20 – 0.35 |

## Output format
```typescript
{
  url: string,
  title: string,
  evidence: EvidenceBlock[],
  wordCount: number,
  fetchedAt: string,
  followedLinks: string[],
}
```

## Error handling
- Timeout → return partial evidence with `fetchedAt = 'timeout'`
- 404 → skip, do not include in evidence pool
- 403/429 → note rate-limited, try alternative source
- Paywall detected (< 200 words main content) → flag as `paywall: true`, extract whatever is visible
