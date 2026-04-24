---
name: citation-composer
description: Build a cited answer from evidence blocks. Uses inline [1][2] citations. Marks uncertainty. Groups claims by source agreement.
version: 1.0.0
author: vai
trust: verified
triggers:
  - cite
  - with sources
  - reference
  - evidence
  - where does this come from
  - show your sources
  - back that up
tools:
  - memory
permissions:
  - memory-read
requires:
  - fact-extractor
---

# Citation Composer Skill

## Purpose
Given a set of EvidenceBlock objects, compose a human-readable answer with inline numbered citations. Every factual claim in the answer must have at least one citation.

## Rules

### Strict
- **Never state something as fact if only one low-trust source supports it** (trustScore < 0.5)
- **Never invent or paraphrase a citation** — use exact snippets
- If sources conflict: present both with attribution ("Source A says X [1], but Source B says Y [2]")
- If no sources support a claim: mark it as the model's own inference with "(unverified)"

### Style
- Use inline citations: `X is true [1][3]` not footnotes
- Keep citations tight — don't over-cite the same sentence
- Mark uncertain claims: "According to [1], though this is not confirmed elsewhere..."
- Mark well-corroborated claims: "Multiple sources confirm that X [1][2][3]"

## Procedure

1. **Group evidence by topic/claim cluster**
   - Use noun phrase overlap to cluster related snippets
   - Each cluster = one section of the answer

2. **Identify tier**
   - Tier 1: 3+ corroborating sources → state as confirmed fact
   - Tier 2: 2 sources agree → state with moderate confidence
   - Tier 3: single source → state with "According to [N]..."
   - Tier 4: no sources → either omit or mark "(based on general knowledge, unverified)"

3. **Draft answer**
   - One paragraph per topic cluster
   - Insert `[N]` inline citations at the claim they support
   - Number citations in order of first appearance

4. **Append source list**
   ```
   Sources:
   [1] Title — domain (URL)
   [2] Title — domain (URL)
   ```

5. **Final check**
   - Every factual sentence has at least one citation
   - No citation in the list is unreferenced in the text
   - Confidence stated honestly

## Output format
```typescript
CitedAnswer {
  text: string,          // answer with [1][2] inline citations
  evidence: EvidenceBlock[],
  confidence: number,    // 0-1 overall confidence
  tierBreakdown: {
    confirmed: string[],   // claims with 3+ sources
    likely: string[],      // claims with 2 sources
    single: string[],      // claims with 1 source
    unverified: string[],  // claims with 0 sources
  }
}
```
