---
name: fact-extractor
description: Extract factual claims with provenance from web pages or text. Each claim gets a source URL, exact snippet, and confidence score.
version: 1.0.0
author: vai
trust: verified
triggers:
  - extract facts
  - what does it say
  - find the fact
  - check source
  - verify claim
  - where does it say
tools:
  - fetch
  - extractor
permissions:
  - web
  - page-text
---

# Fact Extractor Skill

## Purpose
Extract specific factual claims from a source with exact provenance — so every piece of information can be traced back to where it came from.

## Procedure

### 1. Fetch and clean
- Fetch the source URL (or receive raw text)
- Strip boilerplate: nav, footer, ads, cookie banners
- Keep: paragraphs, headings, lists, tables

### 2. Segment into claim candidates
Split into sentences. A claim candidate is a sentence that:
- Contains a subject + predicate
- Has a specific claim (number, date, name, action, state)
- Is at least 20 characters long

### 3. Score relevance
For each candidate, score: does this sentence answer the query?
- High: directly answers with specific data
- Medium: provides context
- Low: tangential

Keep top 10 by relevance.

### 4. Extract provenance
For each kept sentence:
```typescript
EvidenceBlock {
  id: string,           // sha1(url + snippet)
  url: string,          // exact source URL
  title: string,        // page title
  snippet: string,      // exact sentence from source
  trustScore: number,   // domain trust 0-1
  domain: string,
  fetchedAt: string,    // ISO timestamp
}
```

### 5. Cross-source agreement
If multiple sources are provided:
- Find sentences with similar claims (overlap > 60%)
- Mark as `corroborated: true` if 2+ sources agree
- Flag as `conflicting: true` if sources disagree

## Confidence scoring
| Condition | Bonus |
|---|---|
| Claim corroborated by 2+ sources | +0.3 |
| Source is .gov/.edu | +0.2 |
| Source is Wikipedia | +0.15 |
| Source < 1 year old | +0.1 |
| Single source, low trust domain | -0.3 |
| Claim is speculative ("may", "could", "might") | -0.2 |

## Output format
```typescript
{
  query: string,
  evidence: EvidenceBlock[],
  corroboratedClaims: string[],
  conflictingClaims: Array<{ claim: string, sources: string[] }>,
  overallConfidence: number,
}
```
