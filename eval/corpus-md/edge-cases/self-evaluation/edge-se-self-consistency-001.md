---
id: edge-se-self-consistency-001
title: Self-evaluation — detect self-inconsistency within a single response
version: 1
pattern: H↔M
category: cognitive
tags: [edge-case, self-evaluation, consistency-checking, sub-capability-2]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 8000
  max_chars: 2500
turns:
  - role: user
    say: "List three programming languages, then for each one say whether it is statically or dynamically typed. Be consistent — if you call it statically typed in your list, the explanation must agree."
    must:
      - pattern: '(?:python|javascript|typescript|ruby|java|c\+\+|c#|go|rust|kotlin|swift|haskell|elixir|php|scala)'
        flags: 'i'
      - pattern: 'static(?:ally)?\s+typed|dynamic(?:ally)?\s+typed'
        flags: 'i'
    must_not:
      - pattern: 'python\s+is\s+statically|javascript\s+is\s+statically|ruby\s+is\s+statically|rust\s+is\s+dynamically|java\s+is\s+dynamically|haskell\s+is\s+dynamically|typescript\s+is\s+dynamically'
        flags: 'i'
    max_len: 2000
expected_behavior: "Probes intra-response consistency. A first-pass draft can easily mis-label a language; a real self-eval pass cross-checks the labels against ground truth. The must_not list catches the most common mis-labels."
pass_criteria: "Three languages, each labelled, no factually wrong label from the must_not list."
fail_criteria: "Any language assigned the wrong typing discipline."
---
