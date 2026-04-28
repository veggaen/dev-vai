---
id: aud-summary-exec-001
title: Audience — outage summary for an exec
version: 1
pattern: AI↔AI
category: audience
tags: [audience-adaptation, executive]
weight: 1.0
expected_status: pending-feature
budget:
  max_ms: 3000
  max_chars: 1200
turns:
  - role: user
    say: "Summarize last night's database outage for our CEO. Three short paragraphs: impact, cause, what's next. No technical jargon."
    must:
      - pattern: 'impact|customers|users|revenue|downtime'
        flags: 'i'
      - pattern: 'cause|root\s+cause|because'
        flags: 'i'
      - pattern: 'next|prevent|going\s+forward|action'
        flags: 'i'
    must_not:
      - pattern: 'innodb|wal|b-?tree|replication\s+lag|qps\b|p99'
        flags: 'i'
expected_behavior: "Three concise paragraphs covering impact, cause, next steps; no engineering jargon."
pass_criteria: "All three sections present; no jargon terms appear."
fail_criteria: "Uses jargon or omits a section."
---
