---
id: prj-debug-typeerror-001
title: Debug — TypeError on .map of undefined
version: 1
pattern: H↔M
category: project
tags: [debugging, javascript]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 2000
turns:
  - role: user
    say: "I'm getting `TypeError: Cannot read properties of undefined (reading 'map')` in my React component. The array comes from a fetch. What's wrong and how do I fix it?"
    must:
      - pattern: 'undefined|not\s+yet|initial(?:ly)?|before\s+(?:the\s+)?fetch|loading'
        flags: 'i'
      - pattern: '\?\.\s*map|&&\s*\w+\.map|\|\|\s*\[\]|useState\s*\(\s*\[\s*\]\s*\)'
        flags: ''
expected_behavior: "Explains the array is undefined on first render; suggests default [] state, optional chaining, or guard."
pass_criteria: "Names the cause AND offers a concrete fix (default [], ?.map, guard)."
fail_criteria: "Generic 'check your code' answer with no fix."
---
