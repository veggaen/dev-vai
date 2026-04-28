---
id: prj-sql-join-001
title: SQL — top customers by revenue
version: 1
pattern: H↔M
category: project
tags: [sql, query]
weight: 1.0
expected_status: active
budget:
  max_ms: 3000
  max_chars: 1500
turns:
  - role: user
    say: "Write a SQL query for the top 5 customers by total revenue. Tables: customers(id, name) and orders(id, customer_id, amount)."
    must:
      - pattern: '\bjoin\b'
        flags: 'i'
      - pattern: '\bgroup\s+by\b'
        flags: 'i'
      - pattern: '\border\s+by\b'
        flags: 'i'
      - pattern: '\blimit\s+5\b|top\s+5'
        flags: 'i'
expected_behavior: "Joins customers to orders, sums amount, groups, orders desc, limits to 5."
pass_criteria: "Has JOIN, GROUP BY, ORDER BY, LIMIT 5 (or TOP 5)."
fail_criteria: "Missing join, group, sort, or limit."
---
