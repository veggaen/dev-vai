---
id: cre-voice-matching-001
title: 1920s detective coffee tweet
version: 1
pattern: H↔M
category: creative
tags: [voice-matching, style]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 600
turns:
  - role: user
    say: "Write a tweet (under 280 chars) about morning coffee, in the voice of a 1920s hardboiled detective. No emojis."
    must:
      - pattern: 'coffee|joe|brew|cup'
        flags: 'i'
    must_not:
      - pattern: '[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]'
        flags: 'u'
expected_behavior: "Hardboiled noir voice, period-appropriate slang, mentions coffee, no emoji."
pass_criteria: "Reads as 1920s noir, mentions coffee, no emoji, under 280 chars."
fail_criteria: "Modern voice, contains emoji, or omits coffee."
---
