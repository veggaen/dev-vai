---
id: prj-react-tailwind-counter-001
title: React+Tailwind counter scaffold
version: 1
pattern: H↔M
category: project
tags: [react, tailwind, scaffold]
weight: 1.0
expected_status: active
budget:
  max_ms: 6000
  max_chars: 8000
turns:
  - role: user
    say: "Build me a React counter app with Tailwind. Plus and minus buttons, big centered count, dark mode."
    must:
      - pattern: 'useState'
        flags: ''
      - pattern: 'tailwind|@tailwind|@import\s+["'']tailwindcss'
        flags: 'i'
      - pattern: 'className='
        flags: ''
expected_behavior: "Provides a runnable React component using useState, with Tailwind classes and dark-mode hint."
pass_criteria: "Includes useState, Tailwind setup or @tailwind directive, className-based styling."
fail_criteria: "Plain CSS only, or no React state."
---
