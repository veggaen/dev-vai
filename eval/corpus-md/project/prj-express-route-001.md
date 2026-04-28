---
id: prj-express-route-001
title: Express GET /health route
version: 1
pattern: H↔M
category: project
tags: [express, node, api]
weight: 1.0
expected_status: active
budget:
  max_ms: 4000
  max_chars: 3000
turns:
  - role: user
    say: "Show me a minimal Express server with a GET /health route that returns JSON {status:'ok'}."
    must:
      - pattern: 'require\s*\(\s*[''"]express[''"]\s*\)|from\s+[''"]express[''"]'
        flags: ''
      - pattern: '\.get\s*\(\s*[''"]/health[''"]'
        flags: ''
      - pattern: 'status[''"\s]*:\s*[''"]ok[''"]|res\.json\s*\(\s*\{[^}]*status'
        flags: 'i'
expected_behavior: "Minimal Express app with /health returning ok JSON."
pass_criteria: "Imports express, defines GET /health, returns ok JSON."
fail_criteria: "Wrong framework or missing the route."
---
