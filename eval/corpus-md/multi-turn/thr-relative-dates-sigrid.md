---
id: thr-relative-dates-sigrid
title: Sigrid — relative date math
version: 1
pattern: M↔M
category: multi-turn
tags: [thorsen, dates, utility]
weight: 1.0
expected_status: active
budget:
  max_ms: 4000
  max_chars: 2000
turns:
  - role: user
    say: "what day is it tomorrow?"
    must:
      - pattern: 'tomorrow'
        flags: 'i'
      - pattern: '\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b|\b\d{1,2}[\/\-]\d{1,2}\b'
        flags: 'i'
    must_not:
      - pattern: '^today\s+is\b'
        flags: 'i'
  - role: user
    say: "and what about in 30 days?"
    must:
      - pattern: 'in\s+30\s+days'
        flags: 'i'
      - pattern: '\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b|\b\d{1,2}[\/\-]\d{1,2}\b'
        flags: 'i'
    must_not:
      - pattern: '^today\s+is\b'
        flags: 'i'
  - role: user
    say: "how about 7 days ago?"
    must:
      - pattern: '7\s+days\s+ago'
        flags: 'i'
      - pattern: '\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b|\b\d{1,2}[\/\-]\d{1,2}\b'
        flags: 'i'
expected_behavior: "Compute relative dates correctly; do not echo 'today is …'."
pass_criteria: "Each turn returns the relative-date phrase + a real date."
fail_criteria: "Returns today's date or refuses."
---
