---
id: edge-an-structural-vs-vocab-001
title: Analogy — structural mapping vs. vocabulary swap (adversarial)
version: 1
pattern: H↔M
category: creative
tags: [edge-case, analogy, adversarial, structural-mapping]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 6000
  max_chars: 2500
turns:
  - role: user
    say: "Explain a hash table by analogy to a library, but don't use the words index, lookup, key, bucket, hash, or table. Describe the mechanism through what a librarian and a patron actually do."
    must:
      - pattern: 'librar(?:y|ian)|book|shelf|patron|card\s+catalog|catalog|aisle|section|number|label|sticker'
        flags: 'i'
      - pattern: 'walk|find|hand(?:s|ed)?|fetch|retriev|asks?|tells?|points?|directly|without\s+(?:checking|reading)\s+(?:every|each|all)|straight\s+to'
        flags: 'i'
    must_not:
      - pattern: '\b(?:index|lookup|key|bucket|hash|table)\b'
        flags: 'i'
    max_len: 2500
expected_behavior: "Adversarial: tests structural mapping vs. vocabulary swap. A naive engine swaps synonyms ('drawer' for 'bucket', 'name' for 'key') while still describing direct lookup mechanically. A structural mapping describes the librarian-finds-book-via-card-catalog process — the patron asks, the librarian uses a labelled aisle/shelf number to walk straight to the book without scanning every shelf. The asserts require both library vocabulary AND a process-narrative verb."
pass_criteria: "Library vocabulary + process verbs, no forbidden terms, narrative shape."
fail_criteria: "Synonym-swap paraphrase of a hash table description, or any forbidden term, or a literal explanation that abandons the analogy."
---
