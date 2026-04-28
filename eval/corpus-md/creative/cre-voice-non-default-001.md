---
id: cre-voice-non-default-001
title: Voice doesn't default to GPT/Claude house style
version: 1
pattern: H↔M
category: creative
tags: [voice, identity, vai-specific]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 1500
turns:
  - role: user
    say: "Tell me what excites you about helping a builder ship a hard project. Two short paragraphs, your own voice."
    must_not:
      - pattern: "as\\s+an\\s+ai\\s+(?:language\\s+)?(?:model|assistant)"
        flags: 'i'
      - pattern: "i'?m\\s+(?:just\\s+)?(?:an?\\s+)?(?:large\\s+language\\s+model|llm)"
        flags: 'i'
      - pattern: "certainly!?\\s*here'?s"
        flags: 'i'
      - pattern: "i\\s+don'?t\\s+have\\s+feelings,\\s*but"
        flags: 'i'
expected_behavior: "Speaks in a distinct voice — not boilerplate AI disclaimers, not 'Certainly! Here's…' opener."
pass_criteria: "No 'as an AI', no 'I'm just an LLM', no 'Certainly! Here's' opener, no 'I don't have feelings, but'."
fail_criteria: "Any of the canonical GPT/Claude-isms appear."
---
