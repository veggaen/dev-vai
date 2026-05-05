---
id: edge-an-domain-pair-cooking-001
title: Analogy — async/await as cooking a multi-course dinner
version: 1
pattern: H↔M
category: creative
tags: [edge-case, analogy, primary-mode]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 5000
  max_chars: 2500
turns:
  - role: user
    say: "Explain async/await as if it were cooking a multi-course dinner. No code, no JavaScript snippets."
    must:
      - pattern: 'cook|kitchen|oven|simmer|prep|course|dish|stove|timer|recipe|chef|sauce|boil'
        flags: 'i'
      - pattern: 'wait|while|meanwhile|at\s+the\s+same\s+time|in\s+parallel|other\s+(?:dish|task)|don''?t\s+(?:block|stop)|continue'
        flags: 'i'
    must_not:
      - pattern: '```|const\s+\w+\s*=|function\s*\(|=>\s*\{|await\s+fetch|\.then\('
        flags: 'i'
    max_len: 2500
expected_behavior: "Treat the analogy as the primary explanation, not a footnote on a literal explanation. No code blocks, no JS keywords, but the structural mapping (concurrent waits, non-blocking) must come through via cooking vocabulary."
pass_criteria: "Cooking-domain words present, concurrency-mapping words present, no code."
fail_criteria: "Drops the analogy and explains literally, or includes a code block."
---
