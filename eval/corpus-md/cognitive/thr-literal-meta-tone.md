---
id: thr-literal-meta-tone
title: Tone — literal meta-questions
version: 1
pattern: H↔M
category: cognitive
tags: [thorsen, literal-meta]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 500
turns:
  - role: user
    say: "what is the first letter in this question?"
    must:
      - pattern: '\bw\b'
        flags: 'i'
    max_len: 200
  - role: user
    say: "how many words are in this sentence?"
    must:
      - pattern: '\b7\b|\bseven\b'
        flags: 'i'
    max_len: 200
expected_behavior: "Operate literally on the prompt itself."
pass_criteria: "Returns 'W' / '7' (or 'seven')."
fail_criteria: "Generic explanation instead of the literal answer."
---
