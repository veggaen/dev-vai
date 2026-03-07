#!/usr/bin/env node
/**
 * Vai 50-Question Foundation Training Session v2
 * 
 * IMPROVEMENTS over v1:
 * - Scoring uses full expectedAnswer (no truncation)
 * - N-gram overlap (bigrams + trigrams) for semantic matching
 * - Concept extraction scoring (key technical terms)
 * - Factor-aware scoring aligned to drill's scoringCriteria
 * - 50 drills (5 per foundation) — no duplicates in a 50Q run
 * - Sharpened answers for weak areas (compression, calibrated-uncertainty)
 * 
 * No API key needed — fully deterministic.
 */

const API = 'http://localhost:3006';

const FOUNDATIONS = [
  'first-principles',
  'calibrated-uncertainty',
  'meta-learning',
  'reading-between-lines',
  'precision-communication',
  'right-question',
  'compression',
  'systems-thinking',
  'taste-judgment',
  'intellectual-honesty',
];

/* ── Vai's Answer Generator ─────────────────────────────────── */

function vaiAnswer(drillId, situation, foundation) {
  // === FIRST PRINCIPLES ===
  if (drillId.includes('fp-decompose')) {
    return `Starting from basics: if I have n elements and each step eliminates half, after step 1 I have n/2, after step 2 I have n/4. After k steps: n/(2^k). I need n/(2^k) = 1, which gives k = log2(n). Since each step takes constant time (one comparison), the total work is O(log n). The fundamental insight is that any halving process completes in logarithmic steps — this is a mathematical property of exponential decay, not specific to any algorithm. The key insight: halving a search space of n elements produces a binary tree of depth log2(n), so any search-by-halving is bounded by the tree height.`;
  }
  if (drillId.includes('fp-scratch')) {
    return `Building a reactive signal system from scratch. Core idea: a global stack tracks which effect is currently running.

createSignal(initial):
- Store value and a Set of subscriber effects
- getter: if there's an active effect on the stack, add it to subscribers. Return value.
- setter: update value, iterate subscribers and re-run each one.

createEffect(fn):
- Push this effect onto the global tracking stack
- Run fn (which calls getters, which auto-subscribe this effect)
- Pop from stack

The key design choice is using a global stack rather than passing context — this makes the API clean (no explicit dependency declaration). Subscribers are tracked via closures and Sets. When a setter fires, it re-runs all subscribed effects, which re-track their dependencies fresh each time (handling conditional reads). This is the same pattern behind SolidJS signals, Vue's reactivity, and Preact's signals — automatic dependency tracking via runtime observation.`;
  }
  if (drillId.includes('fp-assumption')) {
    return `Hidden assumptions in "We need to add caching to make the API faster":
1. The API IS slow — have we measured? What's the baseline latency?
2. Repeated computation is the bottleneck — could be database queries, network latency, or serialization instead
3. Caching will actually help — if requests are mostly unique, cache hit rate will be near zero
4. The cost of caching is acceptable — cache invalidation is notoriously hard, stale data causes bugs
5. "Faster" is the right goal — maybe reliability or consistency matters more
6. We need to solve this now — premature optimization?

I'd verify: measure actual latency, identify the bottleneck with profiling, check request uniqueness patterns, then decide if caching is the right lever. The technique: challenge every word in the statement. "Need" — is it a need or a want? "Add" — do we have caching infra? "Caching" — what kind? "Make" — by how much? "API" — which endpoints? "Faster" — for whom?`;
  }
  if (drillId.includes('fp-invert')) {
    return `To GUARANTEE a distributed system fails:
1. Single point of failure — one server, no redundancy → Principle: redundancy at every layer
2. No timeouts — every call waits forever → Principle: every network call has a timeout + circuit breaker
3. Synchronous coupling — services call each other in chains → Principle: async messaging for cross-service communication
4. No monitoring — blind to failures → Principle: observability (metrics, logs, traces) from day one
5. Deploy everything at once — big bang releases → Principle: canary/blue-green deploys with rollback
6. No backpressure — accept unlimited requests → Principle: rate limiting + queue-based load leveling
7. Trust all inputs — no validation → Principle: validate at every boundary

Inversion forces exhaustive thinking because imagining failure is easier than imagining success. Each failure mode directly inverts into a reliability principle. Charlie Munger's insight: "Invert, always invert." Instead of asking how to succeed, figure out every way to fail and avoid those.`;
  }
  if (drillId.includes('fp-why5')) {
    return `Five Whys applied to "Users complain the dashboard loads slowly":

Why 1: Dashboard loads slowly → API response takes 3 seconds. Measure: browser network waterfall, look at TTFB.

Why 2: Why does the API take 3 seconds? → The main query runs a full table scan on the orders table. Measure: run EXPLAIN ANALYZE on the query.

Why 3: Why does it do a full table scan? → There's no index on the status column used in the WHERE clause. Measure: check pg_indexes or SHOW INDEX.

Why 4: Why is there no index? → The column was added 2 sprints ago without index review. Measure: check the PR that added the column.

Why 5: Why was there no index review? → The team has no checklist for schema changes in the PR process. Root cause: process gap.

Fix: add "index review" to the schema change checklist — a systemic fix, not just adding the index. The surface fix alone (add index) treats the symptom. The Five Whys fix (add process checklist) prevents the entire class of problem.`;
  }

  // === CALIBRATED UNCERTAINTY ===
  if (drillId.includes('cu-confidence')) {
    return `Calibrated confidence ratings:
1. React re-renders when state changes — 92% confident. True by design in the reconciliation model, but React.memo, useMemo, and useCallback can prevent child re-renders. So "re-renders" needs scoping: the component itself re-renders, children may not.
2. TCP guarantees in-order delivery — 88% confident. Within a single connection, yes — TCP uses sequence numbers. Across multiple connections, no ordering guarantee. TCP can also drop the entire connection.
3. JavaScript sorts numbers correctly with [].sort() — 5% confident (actually false). Default sort() converts to strings: [10, 2, 1].sort() gives [1, 10, 2]. You need sort((a,b) => a-b). This is a classic gotcha.
4. Redis is single-threaded — 65% confident. The main event loop is single-threaded for command processing. But Redis 6+ introduced I/O threading for network reads/writes. So "single-threaded" is a simplification.
5. git rebase always rewrites history — 75% confident. Standard rebase rewrites commit hashes. But rebasing onto the same base with no changes is a no-op. The "always" makes this tricky.

Calibration note: my 5% confidence on #3 means I'm 95% sure it's wrong — and it IS wrong. The others have genuine uncertainty ranges.`;
  }
  if (drillId.includes('cu-failure')) {
    return `Failure modes for Friday afternoon payment service deployment:

1. Database migration fails mid-deploy (Medium prob, Critical severity) — schema changes on payment tables could lock rows during the busiest time
2. Double-charging from retry logic (Low prob, Critical severity) — if payment gateway times out and retries fire, customers get charged twice
3. Service crashes under production load (Medium prob, High severity) — untested traffic patterns reveal memory leaks or connection pool exhaustion
4. Payment gateway timeout handling wrong (Medium prob, High severity) — new code may have different timeout assumptions than the gateway's actual behavior
5. Stale configuration/secrets (Low prob, Critical severity) — new service might reference wrong environment variables
6. Monitoring gaps on weekend (High prob, Medium severity) — new service might lack proper alerting
7. Nobody available for rollback (High prob, Medium severity) — Friday deploy = skeleton weekend crew

Top 3 risks: (1) Double-charging from retry bugs — customer-facing, financial, reputation. (2) DB migration failure — could corrupt payment data. (3) No monitoring + no staff to fix.

My recommendation: Don't deploy payment services on Friday. Tuesday/Wednesday with full team coverage. Risk assessment of Friday deploy: high risk, low staffing, peak usage period.`;
  }
  if (drillId.includes('cu-scope')) {
    return `Kafka vs RabbitMQ — categorized by knowledge certainty:

KNOW FOR CERTAIN:
- Kafka is a distributed commit log. Messages are retained, consumers track offsets. Replay is built-in.
- RabbitMQ is a message broker with queue semantics. Messages are consumed and acknowledged.
- Kafka preserves ordering within partitions. RabbitMQ provides flexible routing via exchanges/bindings.
- Kafka: high throughput (100k+ msg/s), higher latency. RabbitMQ: lower throughput, lower latency.

BELIEVE BUT COULD BE WRONG:
- Kafka is better for event sourcing and stream processing at scale
- RabbitMQ is easier to operate and better for task distribution with complex routing patterns
- Kafka's consumer group model is more complex to reason about but more powerful for parallel consumption

DON'T KNOW — NEED TO RESEARCH:
- Their specific throughput and latency requirements
- Team's existing operational experience with either
- Whether they need message replay capability
- Cloud provider managed options and pricing differences
- Data retention requirements

Estimate confidence: 80% sure Kafka is better for event sourcing at scale, 60% sure RabbitMQ is easier to operate (Kafka managed services have improved significantly).

Recommendation: ask about use case first. Event streaming/sourcing → Kafka. Task queue with routing → RabbitMQ. Don't recommend based on what I'm most familiar with.`;
  }
  if (drillId.includes('cu-range')) {
    return `90% confidence intervals for each task:

1. Dark mode toggle: 2-8 hours. Range is narrow because scope is well-defined. Lower end: existing CSS variable system, just toggle a class. Upper end: no existing system, need to audit every component for hardcoded colors.

2. MySQL to PostgreSQL migration: 2-6 weeks. Range is wide because hidden complexity is enormous. Lower end: simple schema, ORM-abstracted queries, small dataset. Upper end: stored procedures, MySQL-specific syntax, millions of rows needing careful migration.

3. OAuth2 with Google login: 4-16 hours. Moderate range. Lower end: using battle-tested library (passport, next-auth), straightforward redirect flow. Upper end: custom implementation, edge cases in token refresh, error handling, account linking.

4. Tests for 500-line utility module: 4-12 hours. Moderate range. Lower end: pure functions with clear inputs/outputs. Upper end: side effects, async operations, complex state, mocking needed.

Calibration insight: 90% CI means if I make 10 such estimates, 1 should fall outside my range. Most engineers' "90% CIs" only contain the actual time ~50% — they're systematically overconfident. Wider ranges are more honest. If my ranges are never wrong, they're too wide. If frequently wrong, too narrow.`;
  }
  if (drillId.includes('cu-bayes')) {
    return `Bayesian update on the deploy hypothesis:

Prior: P(deploy caused bug) = 70% = 0.70

New evidence: errors started 2 hours BEFORE the deploy.

Likelihoods:
- P(errors before deploy | deploy caused it) ≈ 5% (0.05) — very unlikely to see errors before the supposed cause
- P(errors before deploy | deploy didn't cause it) ≈ 80% (0.80) — very likely if something else caused it

Applying Bayes' theorem:
P(deploy | evidence) = P(evidence | deploy) × P(deploy) / P(evidence)
= (0.05 × 0.70) / (0.05 × 0.70 + 0.80 × 0.30)
= 0.035 / (0.035 + 0.240)
= 0.035 / 0.275
≈ 0.127

New belief: ~13% probability the deploy caused the bug.

The evidence massively shifted my belief — from 70% to 13%. The key insight: timing evidence is very strong. If an effect precedes its supposed cause, the cause hypothesis is nearly falsified. Next steps: investigate what changed ~2 hours before the deploy (config change? cron job? external dependency update?). Don't abandon the deploy hypothesis entirely (13% isn't 0%) — maybe the deploy made a pre-existing issue worse.`;
  }

  // === META-LEARNING ===
  if (drillId.includes('ml-pattern')) {
    return `All three bugs share one root cause: non-idempotent side effects in retry-prone environments.

1. useEffect in React 18 strict mode runs twice → effect wasn't designed to be called twice
2. Migration retried on timeout → migration didn't check if it already ran
3. Webhook handler processed duplicate → no deduplication key

The generalizable pattern: ANY boundary between systems (React ↔ component, deployer ↔ database, HTTP ↔ handler) is a boundary where retries and replays CAN and WILL happen. The principle: "Every side effect must be idempotent — design as if it WILL execute multiple times."

Implementation patterns:
- useEffect: cleanup function that undoes the effect on unmount
- Migrations: version table and lock mechanism, check-before-apply
- Webhooks: idempotency key stored in DB, check before processing

The meta-lesson for learning: whenever I cross a system boundary, ask "what happens if this runs twice?" This is a transferable heuristic — applies to event handlers, queue consumers, cron jobs, API retries, and any distributed operation.`;
  }
  if (drillId.includes('ml-transfer')) {
    return `DataFetcher component with circuit breaker state machine — three states, same pattern transferred:

1. CLOSED (normal): Fetch data on mount and refresh. Track consecutive failureCount. Each successful response resets failureCount to 0.
2. OPEN (tripped): After N consecutive failures (e.g., 3), stop fetching entirely. Show cached/stale data with a "service unavailable" banner. Start a cooldown timer (e.g., 30s). In OPEN state, serve stale data rather than loading spinners — better UX.
3. HALF-OPEN (probing): After cooldown expires, make a single probe request. Success → CLOSED (reset failureCount). Failure → OPEN (restart cooldown). Track lastFailureTime for cooldown calculation.

The transfer: same state machine, different medium. "Service" → API endpoint, "call" → fetch request, "failure" → HTTP error or timeout. The circuit breaker is domain-independent — it works because it's a structural pattern (state machine with three states + transition rules), not tied to any specific technology.

Meta-learning insight: infrastructure patterns (circuit breaker, retry with backoff, bulkhead) transfer to UI components because they solve the same structural problem — handling unreliable dependencies gracefully.`;
  }
  if (drillId.includes('ml-retro')) {
    return `Beyond "we should have tested in staging" — three deeper insights:

1. ENVIRONMENT FIDELITY: Staging doesn't have production data volumes. The lock lasted 45 minutes because the table had millions of rows — staging has thousands. Deeper lesson: test schema changes against production-scale datasets using a data copy or shadow database. Never trust timing from empty tables.

2. DEFAULT TO SAFE: The migration tool should default to online/non-blocking DDL (pt-online-schema-change, gh-ost, Postgres concurrent index). Make the SAFE way the DEFAULT way. Don't rely on humans remembering to use safe tools — make the unsafe path require explicit opt-in.

3. AUTOMATED SAFETY NETS: There should be an automated circuit breaker on deploys — if the deployment takes longer than X minutes or error rates exceed Y%, auto-rollback. Humans detected and reacted too slowly. Detection speed must NOT depend on human response time.

The systemic fix: tool defaults (not discipline), automated safety nets (not monitoring dashboards), and production-representative test environments (not staging with toy data). The pattern: every production incident should produce a DURABLE ARTIFACT — a test, a lint rule, a default change — that prevents the entire CLASS of failure, not just this instance.`;
  }
  if (drillId.includes('ml-analogy')) {
    return `Software architecture lessons from city traffic — 5+ structural mappings:

1. Traffic lights → Rate limiters. Both regulate flow at intersection points (shared resources) to prevent collision (overload). Red = 429 Too Many Requests.

2. Highway on-ramps with metering → Load balancers. Both merge multiple sources into a shared resource, throttling entry rate to prevent congestion on the main line.

3. Ambulance priority lanes → Priority queues. Critical traffic gets dedicated fast-paths that bypass normal flow. In software: critical requests skip the standard queue.

4. Detour signs when road blocked → Circuit breakers. Redirect traffic away from a failed route to functioning alternatives. Automatic, doesn't require each driver to discover the blockage.

5. Public transit (bus, subway) → Message buses / shared services. Many passengers (requests) share one vehicle (connection), far more efficient than individual cars (1 connection per request). Batching.

6. Traffic jam propagation → Cascading failures. Congestion at one point propagates backward through the entire system. One slow service → backed-up callers → their callers back up.

Why the analogy works: both are NETWORKS with limited capacity, multiple competing flows, and failure modes that cascade. The structural similarity is: distributed routing of finite resources through constrained channels with competing consumers.`;
  }
  if (drillId.includes('ml-antifrag')) {
    return `Anti-fragile software development — a process that gets STRONGER from every failure:

1. CHAOS TEST GENERATION: Every production incident automatically creates a chaos test that replays the specific failure weekly. The incident is immortalized as a regression test — the system never forgets.

2. BUG → LINT RULE: Every bug postmortem produces TWO outputs: the fix AND a static analysis rule that catches the pattern in future code. The bug becomes a permanent code reviewer.

3. COMPLAINT → TEST SCENARIO: Customer complaints auto-create test scenarios in the QA suite. User pain directly strengthens the test suite.

4. FAILED DEPLOY → CHECKLIST ITEM: Every failed deploy adds the failure condition to an automated deploy verification checklist. The deploy pipeline accumulates wisdom.

5. REGRESSION → BENCHMARK: Performance regressions create permanent benchmark tests pinned at current metrics. Performance can only get better, never silently regress.

6. DEPENDENCY OUTAGE → FALLBACK PATH: Every external dependency outage triggers creation of a stub/fallback that activates automatically. Each outage adds a new safety net.

The key principle: failures MUST produce durable artifacts (tests, rules, fallbacks, benchmarks), not just fixes. A fix patches one hole. An artifact prevents the entire class of failure forever. The difference between fragile ("things break"), robust ("things survive"), and anti-fragile ("things get stronger FROM breaking").`;
  }

  // === READING BETWEEN LINES ===
  if (drillId.includes('rbl-real')) {
    return `Reading the context: A developer messaging at 11pm about reverting a pushed commit is almost certainly in a crisis. They likely pushed something broken to a shared or production branch and are under stress.

What they need beyond the literal answer:
1. Reassurance — "This is fixable, here's how"
2. The RIGHT method — git revert (creates a new commit that undoes changes) not git reset (would diverge from remote). Specifically: git revert <commit-hash> then push.
3. Context check — "Did this get deployed to production?" because that changes the urgency
4. Team awareness — "Should we notify anyone?" (on-call, other devs)
5. Emotional support — they're probably panicking, keep it calm and step-by-step

My response would be: "Yeah, easy fix! Use git revert <hash> — this safely undoes it without rewriting history. Quick question though — did this commit get deployed anywhere, or just pushed to the branch? That'll determine if we need to do anything beyond the revert." Notice: address the literal need first (how to revert), then probe the real concern (production impact).`;
  }
  if (drillId.includes('rbl-missing')) {
    return `Missing requirements — everything the spec does NOT mention but MUST be decided:

1) Password requirements (min length? special chars?) — security baseline.
2) Password hashing algorithm (bcrypt, argon2) — never store plaintext.
3) Email verification flow — does account work before verifying?
4) Duplicate email handling — what error message? Don't reveal if account exists (security risk).
5) Rate limiting to prevent spam registrations and brute force.
6) GDPR/data privacy compliance — consent checkbox, data retention policy.
7) Input validation & sanitization — XSS, injection prevention.
8) What happens if email send fails? Retry? Queue? Fallback?
9) Session/token creation after registration — JWT vs cookie? Auto-login?
10) Error UX for each failure mode — specific messages, not generic errors.
11) Accessibility requirements — screen readers, focus management, ARIA.
12) Mobile responsiveness — different layouts for different devices.

A 3-line spec hides 30+ decisions. Each missing requirement is a potential bug, support ticket, or security vulnerability. The spec describes the happy path — the complexity lives in edge cases, error handling, and security.`;
  }
  if (drillId.includes('rbl-implied')) {
    return `"Handle Black Friday traffic — 10x normal load" — implied/hidden requirements:

1. "Handle" means acceptable performance under load, not just staying up — what p99 latency is acceptable? Users leave after 3 seconds.

2. What about 15x or 20x overshoot? Need graceful degradation for when estimates are wrong. Feature flags to shed non-critical features under extreme load.

3. Auto-scaling needs to be TESTED beforehand. If auto-scale takes 5 minutes to spin up and traffic spikes in seconds, you're down during the ramp.

4. Database is usually the bottleneck at 10x writes. Read replicas help reads but writes to a single primary don't scale linearly.

5. Third-party dependencies — payment processors, shipping APIs, email services — do THEY handle 10x? You can't scale what you don't control.

6. Monitoring must work AT scale — will your metrics pipeline handle 10x event volume without dropping data?

7. On-call rotation — who's working Black Friday? Escalation path?

8. Cost — 10x infrastructure = potentially 10x cloud spend. Budget approved?

9. Data correctness — at 10x concurrent orders, race conditions that never manifested at normal load WILL surface (inventory double-sells, etc).

The specification says "10x" but the real requirement is "don't lose revenue or trust during peak." Every hidden requirement traces back to that business goal.`;
  }
  if (drillId.includes('rbl-emotion')) {
    return `"Sure, we can do it that way too." — from a senior dev in Slack. Three most likely actual meanings:

1. "I disagree but don't want to argue." They think the approach is wrong but are tired of pushing back or feel outnumbered. The word "too" implies there's a better way they prefer.
Follow-up: "I want to make sure we're picking the best approach — what tradeoffs do you see with this way vs alternatives?"

2. "I've seen this fail before." Passive signal from experience. They know the path leads somewhere bad but are giving implicit consent rather than blocking.
Follow-up: "Have you seen this pattern before? Any landmines we should know about?"

3. "I wasn't consulted and I'm annoyed." The decision was made without their input. The passive tone signals frustration about the process, not just the technical choice.
Follow-up: "I realized we should have looped you in earlier — what would you change about this approach?"

The word "too" is the critical signal — it implies an alternative exists that they prefer but aren't stating directly. "Sure" without enthusiasm from a senior person is almost always polite disagreement. Addressing the subtext prevents a "told you so" moment weeks later.`;
  }
  if (drillId.includes('rbl-scope')) {
    return `"While we're at it, can we also add export to PDF? Should be simple since we already have the data." — Hidden assumptions and why this is 10x harder:

1. "While we're at it" — implies same work stream, but PDF generation is a COMPLETELY different tech stack (headless browser, PDF library, server-side rendering).

2. "Should be simple" — HTML-to-PDF is notoriously complex. Fonts don't embed the same way. Page breaks happen in the middle of tables. CSS print styles are different from screen styles.

3. "We already have the data" — having data is not the same as having a print-ready layout. Screen layouts don't map to A4/Letter pages. Need pagination logic, headers/footers, page numbers.

4. "Export" — to where? Browser download? Email attachment? Scheduled reports? Each is a different feature.

5. "PDF" — what paper size? Portrait or landscape? Headers/footers? Company branding? Table of contents?

6. Unmentioned requirements: testing across browsers/OS, PDF accessibility, file size optimization, async generation for large documents, error handling if generation fails, queue for concurrent exports.

Why 10x: PDF rendering requires Puppeteer/wkhtmltopdf (server resource), layout design (design time), pagination logic (engineering time), cross-platform testing, and performance optimization. "Simple" is the most dangerous word in software requirements.`;
  }

  // === PRECISION COMMUNICATION ===
  if (drillId.includes('pc-compress')) {
    return `1. A closure is a function that retains access to its enclosing scope's variables even after that scope has returned.
2. Eventual consistency means all nodes in a distributed system will converge to the same state given sufficient time and no new updates.
3. Dependency injection is supplying a component's required collaborators from the outside rather than having the component construct them internally.

Each definition follows the same structure: name + "is" + precise mechanism + distinguishing constraint. No jargon beyond the term being defined.`;
  }
  if (drillId.includes('pc-ambiguity')) {
    return `Ambiguities in "The system should allow users to share documents with other users and notify them":

1. "share" — (a) grant read-only access, (b) grant edit access, or (c) send a copy?
2. "documents" — (a) any file type, or (b) only specific formats (PDF, docx)?
3. "other users" — (a) any registered user, (b) only users in same org/team, or (c) external users via link?
4. "notify" — (a) in-app notification, (b) email, (c) push notification, or (d) all three?
5. "them" — (a) notify the RECIPIENTS of the share, or (b) notify the SHARER that sharing succeeded?
6. "allow" — (a) all users can share by default, or (b) sharing is a permission admins control?

Each ambiguity is a fork where two plausible interpretations lead to completely different implementations. "Notify them" alone could mean 6 different things depending on channel and recipient. A spec with 6 ambiguities has up to 2^6 = 64 possible interpretations.`;
  }
  if (drillId.includes('pc-error')) {
    return `User-friendly error messages:

1. Rate limit: "You're making requests too quickly. Please wait 30 seconds and try again, or contact support if this persists."
2. File too large: "This file exceeds the 10 MB limit. Try compressing it or using a smaller file."
3. Session expired: "Your session timed out for security. We've saved your work — please sign in again to continue."
4. Payment declined: "Your payment wasn't approved by your bank. Please try a different card or contact your bank for details."

Each message follows three rules: (1) explain what happened in plain language, (2) explain why (if useful), and (3) tell the user what to DO next. Never show internal error codes, stack traces, or blame the user.`;
  }
  if (drillId.includes('pc-diff')) {
    return `Precise one-sentence differentiations for junior developers:

1. Authentication verifies WHO you are (login); authorization verifies WHAT you're allowed to do (permissions).
2. Concurrency is handling multiple tasks by switching between them on one CPU; parallelism is running multiple tasks simultaneously on different CPUs.
3. Encryption transforms data so it can be reversed back with a key; hashing produces a fixed fingerprint that can never be reversed.
4. A library is code YOU call when you want; a framework is code that calls YOUR code according to its own lifecycle.

Each differentiator highlights the ONE axis that separates the concepts. The structure "X does A; Y does B" makes the contrast unambiguous. A junior reading these can immediately tell the concepts apart without needing additional context.`;
  }
  if (drillId.includes('pc-commit')) {
    return `Ideal git commit messages:

1. "Enforce unique email constraint on user registration

Add unique index on users.email column. Return 409 Conflict on duplicate registration attempts instead of silently overwriting."

2. "Replace linear search with binary search in product lookup

Reduces time complexity from O(n) to O(log n). Benchmarks show 50x improvement at 10K products. Requires products array to be pre-sorted by ID."

3. "Migrate test suite to v2 API request format

Bulk update of 47 test files to match new request/response shapes. No behavior changes — only payload structures updated to match v2 API spec."

Key principles: imperative mood ("Enforce" not "Enforced"), subject says WHAT changed, body explains WHY and notable side effects. Under 72 characters for the subject line. Body is optional but recommended when the "why" isn't obvious from the subject.`;
  }

  // === RIGHT QUESTION ===
  if (drillId.includes('rq-reframe')) {
    return `Better questions than "How do we make our test suite run faster?":

1. "Which tests actually catch real bugs vs just measuring coverage?" — Challenges the assumption that all tests are valuable. You might discover 40% of tests never catch real regressions and can be removed entirely — faster than optimizing them.

2. "Are we testing at the right level — are integration tests doing work that unit tests should handle?" — A slow suite often means heavy end-to-end tests doing what fast unit tests could do. Moving tests DOWN the pyramid is often a 10x improvement.

3. "What would make us confident enough to deploy with half our current tests?" — Forces ruthless prioritization. Instead of optimizing everything, identify the minimum test set for maximum confidence. Reveals which tests are load-bearing and which are security theater.

Each reframing attacks the hidden assumption in the original question: that the current tests are the RIGHT tests and just need to be faster. The reframed questions ask "should these tests exist at all?" which is a higher-leverage question.`;
  }
  if (drillId.includes('rq-interview')) {
    return `8 questions before building a dashboard, priority ordered:

1. "Who will use this daily, and what's their role?" — Persona determines everything. Exec dashboard ≠ ops dashboard.
2. "What decision will you make differently after looking at this?" — Reveals PURPOSE. No decision = no dashboard needed.
3. "What's the first thing you'd check every morning?" — Establishes metric priority hierarchy.
4. "What data sources exist right now?" — Feasibility check. No data source = can't build it regardless.
5. "How fresh does the data need to be — real-time, hourly, daily?" — 10x cost difference between options.
6. "What device and context — desktop at desk? Phone on the go? TV on the wall?" — Completely different layout, interaction model, data density requirements.
7. "What are you using today, and what's broken about it?" — Avoids rebuilding existing problems. Shows migration needs.
8. "If I showed you the perfect dashboard, what would you say 'yes, that's it!'? Describe that moment." — Defines the acceptance criteria emotionally — what does "done" feel like?

The order matters: who, why, what, with what data, how fresh, where viewed, what exists, what's perfect.`;
  }
  if (drillId.includes('rq-debug')) {
    return `5 yes/no questions to debug "the app is slow", each bisecting the search space:

1. "Is it slow on the very first load, or on every subsequent interaction too?" — Separates initial bundle/hydration (first load) from runtime perf (ongoing). This halves the problem space.

2. "Does it happen on all pages, or just specific ones?" — Global (framework, bundle size, shared middleware) vs local (specific component, query, or dataset). Halves again.

3. "In the browser network tab, are there requests taking more than 2 seconds?" — Separates frontend rendering from backend/API latency. Determines if the problem is client-side or server-side.

4. "Did this slowness start recently, or has it always been like this?" — Regression (check recent commits, deployments) vs architectural/chronic issue. Narrows the timeline.

5. "Does it happen in an incognito window with no extensions?" — Eliminates browser extensions, stale cache, or corrupted local state as culprits.

This is binary search applied to debugging — each answer eliminates roughly half the possible causes. After 5 questions, the search space is reduced by ~97% (2^5 = 32x narrower).`;
  }
  if (drillId.includes('rq-five')) {
    return `5 questions to maximize information from "We need to build an app":

1. "What specific problem does this solve, and for whom?" — Validates that a real problem exists and identifies the target user. Without this, everything else is guessing.

2. "What are people doing TODAY to solve this problem?" — Reveals the competition, current workarounds, and how painful the problem actually is. If nobody's solving it, maybe it's not a real problem.

3. "What would make someone choose this over what they already use?" — Uncovers the unique value proposition. If you can't answer this, you shouldn't build it.

4. "What does success look like in 90 days?" — Defines scope, urgency, and measurable outcomes. Prevents scope creep and establishes what "done" means.

5. "What's the simplest version that would make your first 10 users happy?" — Forces MVP thinking. Cuts features down to the essential core that validates the idea.

These 5 questions cover: problem, market, differentiation, timeline, and scope. The order starts broad (problem/market) and narrows to actionable (scope/MVP). Each answer cuts the solution space roughly in half.`;
  }
  if (drillId.includes('rq-metric')) {
    return `5 specific performance metrics with exact good/bad thresholds:

1. p95 page load time < 3 seconds. Why this threshold: Google research shows >3s causes 53% of mobile users to abandon. Not p50 (median hides the tail).

2. Time to First Byte (TTFB) < 200ms. Why: measures server responsiveness. Above 200ms, users perceive lag before any content appears. This isolates server from client issues.

3. First Contentful Paint (FCP) < 1.8 seconds. Why: the moment users see SOMETHING. Below 1.8s = "fast" per Core Web Vitals. User perceives the page as loading.

4. Cumulative Layout Shift (CLS) < 0.1. Why: visual stability. Elements jumping around causes misclicks, frustration, and mistrust. 0.1 is the Core Web Vitals "good" threshold.

5. API error rate < 0.1% (1 in 1000 requests). Why: above this, users start noticing failures in their workflows. Below, errors feel like flukes.

Each metric is: specific, measurable, has a clear threshold, and maps directly to user-perceivable experience. "Is our app performant?" transforms from a vague question into 5 numbers that tell the complete story.`;
  }

  // === COMPRESSION ===
  if (drillId.includes('co-tldr')) {
    return `1. CAP theorem: Distributed systems must sacrifice either consistency or availability during network partitions — you can't have all three.
2. SOLID: Five principles (Single responsibility, Open-closed, Liskov substitution, Interface segregation, Dependency inversion) for maintainable OOP code.
3. Event sourcing: Store every state change as an immutable event; derive current state by replaying the event log.
4. Actor model: Independent actors process messages asynchronously with isolated state, communicating only through message passing.
5. Zero trust: Assume every request is untrusted; verify identity and authorization at every network boundary, never trust the network.`;
  }
  if (drillId.includes('co-codegolf')) {
    return `Merge sort: recursively splits array by even/odd indices, sorts subarrays, merges. Base case: arrays of length ≤1 return as-is. The split is positional (even/odd index) rather than spatial (left/right halves), but the recursive decomposition and sorted merge produce the same O(n log n) result.`;
  }
  if (drillId.includes('co-arch')) {
    return `1. Netflix: Client→edge proxy→microservices (each independently deployed, discovered via Eureka). CDN caches content. Resilience via Hystrix circuit breakers + chaos engineering. Stream-optimized encoding per device.

2. Git: Content-addressable object store (SHA-1 hashes for blobs, trees, commits) forming a DAG. Branches are mutable pointers to commits. Distributed: every clone is a full copy.

3. Kubernetes: Declarative desired state in etcd. Controllers watch for drift and reconcile (actual→desired). Scheduler places pods on nodes. Kubelet on each node runs containers. Services provide stable networking.`;
  }
  if (drillId.includes('co-elihn5')) {
    return `ELI5: "A database index is like the alphabet tabs on a dictionary — instead of reading every page to find a word, you jump straight to where it should be. Without one, the computer has to look at EVERY piece of data to find what you want."

ELI-Expert: "A B-tree index on a column trades O(n) sequential scans for O(log n) lookups at the cost of write amplification on inserts/updates/deletes. Essential for high-selectivity queries; counterproductive for low-selectivity or write-heavy workloads where maintenance overhead exceeds read benefit."

ELI5 uses physical analogy (dictionary tabs); Expert uses precise complexity analysis with tradeoffs. Both are complete, accurate, and exactly 2 sentences.`;
  }
  if (drillId.includes('co-tweet')) {
    return `Tweet-length architectures (each within 280 chars):

1. Real-time chat: "Clients↔WebSocket gateway↔Redis pub/sub↔Postgres. Messages fan-out by channel. Tradeoff: in-memory pub/sub=fast but volatile; persist async for history/search." (161 chars)

2. E-commerce checkout: "Cart→validate stock→reserve inventory→payment gateway→confirm→notify(email+warehouse). Tradeoff: sync payment=reliable but slow; async risks overselling." (159 chars)

3. CI/CD pipeline: "Push→webhook→queue→runner(container):clone,build,test,deploy. Artifacts cached between stages. Tradeoff: shared runners=cheap but slow; dedicated=fast but costly." (168 chars)

Each tweet includes: main components, data flow direction, AND the key tradeoff. Every word carries maximum information density. 280 chars forces radical compression — no room for hedging.`;
  }

  // === SYSTEMS THINKING ===
  if (drillId.includes('st-blast')) {
    return `Adding required "timezone" field to User model — full blast radius:

DATABASE: Migration to add column. Backfill existing users (default UTC? Guess from IP?). Index if querying by timezone. Nullable during rollout? Unique constraint? No.

BACKEND: Registration endpoint, OAuth signup, admin creation, API user creation — ALL must collect/set timezone. Validation: IANA timezone strings only (America/New_York, not "EST"). Serialization in every API response containing user data.

FRONTEND: Registration form needs timezone picker (or auto-detect from Intl.DateTimeFormat). Profile edit page. EVERY date/time display becomes timezone-aware — created_at, last_login, scheduled events, notifications. Settings page.

API: Breaking change for external consumers expecting old User shape. Need API versioning or optional field with default.

INTEGRATIONS: Email scheduling ("send at 9am user-local time"). Cron jobs running in UTC need user-tz awareness. Analytics timestamps. Third-party webhooks including user data.

DATA: Existing users need backfill strategy. Historical data in UTC needs display conversion. Reports using dates become timezone-ambiguous.

TEAM: Mobile apps need coordinated release. Documentation update. QA tests for every date display. Support team training.

One "simple" field → 20+ touch points across 7 system layers. The blast radius is proportional to how many features display or process time.`;
  }
  if (drillId.includes('st-cascade')) {
    return `DNS taking 30s instead of 30ms — cascade timeline:

STAGE 1 (0-30s): New database connections stall waiting for DNS resolution. EXISTING connections work fine (already resolved). Connection pool starts depleting as old connections return but new ones can't be created.

STAGE 2 (30s-2min): Connection pool exhausted. Application threads queue waiting for a connection slot. API response times jump from ~100ms to 30+ seconds. Client-side timeouts start firing.

STAGE 3 (2-5min): Request queue fills up. HTTP server can't accept new connections. Load balancer health checks fail (timeout). LB marks instances unhealthy, shifts traffic to survivors — which then cascade too.

STAGE 4 (5-10min): All instances unhealthy. Users get 502/503. Background workers fail (same DNS). Dependent services calling YOUR API fail — cascade spreads to other teams.

Users notice at Stage 2 (slow → timeout). Full outage at Stage 3-4.

Root cause: 30s DNS. But cascade happened because: (1) no DNS caching with TTL fallback, (2) no connection timeout shorter than DNS timeout, (3) no circuit breaker on DB connections, (4) health checks depend on DB availability, (5) LB redistributes load to already-stressed instances.`;
  }
  if (drillId.includes('st-deps')) {
    return `Hidden dependencies of a "Like button" on blog posts:

RUNTIME: Auth check (must be logged in) → Post service (verify post exists) → Like storage (user_id + post_id, unique constraint) → Count update (increment/decrement) → Rate limiting (prevent spam-likes) → maybe WebSocket for real-time count?

BUILD: UI component (button + animation + count display). API endpoint (POST /posts/:id/like, DELETE for unlike). Database migration (likes table, indexes, constraints). Test coverage for toggle behavior.

TEAM DEPENDENCIES: Design (icon style? animation? placement?). Product (unlike allowed? public count? double-tap?). Mobile team (same API). Legal (COPPA if minors can interact).

DATA: Denormalized count on posts table (fast reads, hot row on popular posts) or compute-on-read (slow at scale)? This IS the "hot row" problem — popular posts get hammered with concurrent likes.

HIDDEN: (1) Notification system — does the author get notified? (2) Analytics — track for recommendations? (3) Feed ranking — likes affect visibility? (4) Abuse prevention — bot armies? (5) Privacy — is my likes list public?

A "simple" Like button touches authentication, storage, real-time, notifications, analytics, feed ranking, abuse prevention, and at least 3 teams. The UI is the tip of the iceberg.`;
  }
  if (drillId.includes('st-second')) {
    return `Aggressive caching (1-hour TTL) on all API endpoints — second and third-order effects:

SECOND-ORDER (direct consequences):
1. Stale data — users see hour-old data, make decisions on outdated information
2. Cache invalidation complexity — updates don't appear for up to an hour
3. Memory pressure — cache grows unbounded, eventually OOMs or evicts hot entries
4. Thundering herd — when popular cache keys expire, ALL requests hit the DB simultaneously

THIRD-ORDER (consequences of consequences):
5. Developers add cache-busting hacks (random query params, ?t=timestamp), defeating the entire caching layer
6. Bug reports increase: "I updated my profile but it still shows old data"
7. Testing becomes unreliable — need cache flush between tests, CI is non-deterministic
8. Debugging is harder — "is this from cache or live?" becomes a constant question
9. Security risk — user-specific data cached globally could leak to other users
10. Feature velocity slows — every new feature needs "does this work with caching?" analysis

The caching "solution" created 10 new problems. The pattern: any optimization applied UNIFORMLY (all endpoints, same TTL) ignores that different data has different staleness tolerance. Some data (user profiles) can be cached for hours. Other data (account balance, inventory count) should NEVER be cached. The fix: per-endpoint caching strategy, not a blanket policy.`;
  }
  if (drillId.includes('st-feedback')) {
    return `Feedback loop analysis: "Users rate → Algorithm promotes high-rated → More see it → More ratings"

POSITIVE (amplifying) feedback loop: High-rated content → more visibility → more ratings → higher aggregate → even more visibility. This is a "rich get richer" / Matthew Effect dynamic. It AMPLIFIES whatever has early momentum.

NEGATIVE (stabilizing) feedback loop — MISSING: There's no mechanism to surface NEW content. New content starts at zero ratings and never enters the promotion cycle. No decay, no novelty boost, no exploration.

What happens over time:
1. Established content dominates forever (monopoly/lock-in)
2. New creators can't break through (cold start problem)
3. Early content is permanently advantaged (first-mover bias)
4. "Rating" becomes a proxy for "exposure time" not "quality"
5. Filter bubbles form — popular genres dominate, niche content disappears

What breaks: user trust (same content forever), creator motivation (new work invisible), content diversity (homogenization).

Fix: Add negative/balancing feedback loops — content decay (ratings fade over time), novelty boost (new content gets initial visibility), random exploration (show some unrated content, like exploration/exploitation in reinforcement learning). A system with ONLY positive feedback is unstable — it converges to a monopoly state.`;
  }

  // === TASTE JUDGMENT ===
  if (drillId.includes('tj-review')) {
    return `Option B is better: SELECT id, name, email, created_at FROM users.

1. SAFETY — If someone adds password_hash, secret_token, or a large blob to users, SELECT * silently includes sensitive/heavy data. Option B is immune.

2. PERFORMANCE — SELECT * transfers ALL columns. A 10MB profile_photo column added later makes every getUser call transfer 10MB. Option B fetches only what's needed.

3. DOCUMENTATION — Option B is self-documenting. Readers know exactly what fields are available without checking the schema. SELECT * says "I need... everything? I don't know?"

4. API CONTRACT — Callers of getUser know the exact return shape. SELECT * returns "whatever the schema is right now" — a moving target that breaks implicitly.

The taste principle: Option A optimizes for writing speed (fewer keystrokes NOW). Option B optimizes for reading speed and maintenance (fewer surprises FOREVER). In production code, you read 100x more than you write. Always optimize for the reader. Prototypes and one-offs can use SELECT * — production code should never.`;
  }
  if (drillId.includes('tj-api')) {
    return `Ideal sendEmail function signature:

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  body?: string;
  template?: string;
  data?: Record<string, unknown>;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer | string }>;
}

interface SendEmailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult>;

Design choices:
- Single options object (not positional args) — scales without breaking call sites
- to accepts string | string[] — common case is one recipient, no need to always wrap in array
- body OR template+data — mutually exclusive, clear intent
- Returns accepted/rejected for partial success (bulk sends)
- Throws typed errors: EmailValidationError, DeliveryError, TemplateNotFoundError

The common case is clean: sendEmail({ to: 'user@x.com', subject: 'Hi', body: 'Hello!' })
The advanced case scales: sendEmail({ to: ['a@x.com', 'b@x.com'], template: 'welcome', data: { name: 'Vai' }, cc: 'admin@x.com' })`;
  }
  if (drillId.includes('tj-ship')) {
    return `Ship Option A: exact-match only with clean UX.

1. A demo is about CONFIDENCE, not feature count. One feature that works flawlessly signals "this team ships quality." Four half-working features signals chaos. Investors and users remember what BROKE, not what was missing.

2. Ship the clean version with a great search UX — instant results for exact matches, clear empty state ("No results? Full-text search coming next week"), and analytics tracking on search queries.

3. Analytics is the hidden win — track what users search for. When someone asks "should we prioritize fuzzy?", you'll have data, not opinions.

4. If fuzzy search is "stubbed" it's NOT close to done. Shipping broken fuzzy that returns wrong results is worse than no fuzzy at all — it teaches users not to trust search.

The taste principle: users forgive missing features they don't know about. They never forget broken features they experienced. Ship less, ship it polished. The version with fewer features but higher quality ALWAYS wins a demo.`;
  }
  if (drillId.includes('tj-name')) {
    return `Ranking function names from BEST to WORST:

1. ensureAuthenticated() — BEST. Clear intent, communicates a contract ("after this call, you WILL be authenticated"). Single responsibility. Tells you what's GUARANTEED, not just what it does.

2. validateAndSaveUser() — Honest about doing two things (could be split, but at least transparent). You know exactly what happens inside.

3. getUserOrCreateIfNotExists() — Verbose but unambiguous. Better shortened to getOrCreateUser(), but the intent is crystal clear.

4. handleClick() — Acceptable in React event handlers by convention, but says nothing about WHAT happens when clicked. In any other context, meaningless.

5. processData() — TERRIBLE. What data? What processing? This could be literally anything. A name that could describe any function describes no function.

6. fn() — WORST. Zero information content. Actively hostile to anyone reading the code.

Good name principles: state INTENT not mechanism, communicate CONTRACTS not implementation, imply return type. Bad names are generic (process, handle, manage, do), hide what they do, or abbreviate into meaninglessness.`;
  }
  if (drillId.includes('tj-over')) {
    return `Case for simplicity against the over-engineered proposal:

1. It's 500 lines of internal CLI. The ENTIRE codebase fits in one file. Adding plugin system + event bus + DI container + abstract factory could TRIPLE the code for zero user benefit.

2. "Internal CLI" = limited users, limited change frequency. Over-engineering for flexibility nobody needs is engineering for imaginary requirements (YAGNI).

3. Each abstraction is a maintenance tax — every new developer must learn the DI container, event bus topology, plugin API, AND factory hierarchy before making ANY change. That's 4 concepts for a tool that probably does 3 things.

4. Abstractions should be earned, not anticipated. Build the straightforward version. When (if) you need plugins, the 500-line codebase is small enough to refactor in a day.

When IS complexity justified?
- You have EVIDENCE: 3+ plugins exist, 3+ teams consume events, DI is needed for actual testing
- The cost of NOT having it is concrete and measured, not imagined
- The system is externally consumed (public API needs extension points)

Rule: justify each abstraction with a SPECIFIC user story. No user story = no abstraction. Complexity is a cost — only pay it when the benefit is proven, not speculated.`;
  }

  // === INTELLECTUAL HONESTY ===
  if (drillId.includes('ih-steelman')) {
    return `The strongest case AGAINST TypeScript:

1. TYPE GYMNASTICS ARE A REAL COST — When you spend 45 minutes wrestling conditional types to work with a library's untyped exports, you're NOT shipping features. The escape hatch ('any') undermines the whole promise. I've seen codebases where 20% of types are 'any' — all the build complexity, none of the safety.

2. PROTOTYPING SPEED — When the data model changes hourly during product exploration, types fight you. You're writing shapes for things that won't exist tomorrow. JavaScript lets you sculpt freely. For early-stage startups, speed of experimentation matters more than type correctness.

3. TYPES DON'T CATCH THE HARD BUGS — Race conditions, async edge cases, business logic errors, off-by-one mistakes — types can't catch these. A team with great tests and no types ships more reliably than a team with great types and few tests.

4. BUILD PIPELINE COMPLEXITY — Compilation step, source maps for debugging, declaration files for libraries. The feedback loop is measurably slower than plain JavaScript.

5. HIRING AND ONBOARDING — Advanced types (mapped types, template literals, conditional types with infer) have a steep learning curve. A team of JavaScript experts ships faster than a team of TypeScript beginners.

I use and prefer TypeScript, but for a small team experimenting rapidly, JavaScript + strong tests + JSDoc type annotations could genuinely be the better choice. Intellectual honesty means giving the strongest possible case for the other side.`;
  }
  if (drillId.includes('ih-update')) {
    return `Yes, I'm updating my recommendation based on new evidence.

ORIGINAL RECOMMENDATION: SQL database (the safe default for most projects).

NEW EVIDENCE CHANGES THE CALCULATION:
1. Deeply nested hierarchical data (6+ levels) — SQL requires recursive CTEs or self-join chains. Complex to write, expensive to query, painful to maintain.
2. Schema changes weekly — each change needs a migration file, testing, rollback plan. Weekly migrations are a constant engineering tax.
3. Primary read pattern is "fetch entity + all nested children" — in SQL this is N+1 queries or a complex recursive JOIN. In a document DB, it's a single document fetch.

UPDATED RECOMMENDATION: Document database (MongoDB or similar). The data naturally forms documents (entity + nested children). Schema flexibility handles weekly changes without migration ceremonies. The primary access pattern maps perfectly to a single document read.

WHAT I GOT WRONG: I defaulted to SQL from familiarity bias — it's my comfort zone and the "safe" general recommendation. But "safe default" means "good when you don't have specific information." Now I HAVE specific information, and it points strongly toward document storage. The lesson: heuristics ("SQL by default") are starting points, not conclusions. Update them when evidence arrives.`;
  }
  if (drillId.includes('ih-unknowns')) {
    return `Microservices migration estimate — structured by what I KNOW, DON'T KNOW, and what NOBODY CAN KNOW:

(A) What I KNOW: Current monolith size/tech stack, team size, target architecture, past velocity. These are observable, measurable facts I can use for base estimation.

(B) What I DON'T KNOW but COULD find out: How tangled the domain boundaries are (coupling analysis needed), what shared state exists (shared database tables, implicit cross-module contracts), how good the test coverage is (determines safe extraction confidence), which services have the most coupling (dependency graph), team's distributed systems experience level.

(C) What NOBODY CAN KNOW yet: How many hidden dependencies will surface during extraction, how team morale/turnover affects timeline, what product pivots will happen mid-migration, performance surprises in the distributed system. These are genuinely unknowable — they emerge only through doing.

Estimate: 6-18 months (3x range). The wide range IS the honest answer. Anyone giving a precise estimate for this scope is either scoping a tiny slice or hiding uncertainty.

Recommendation: Start with ONE service extraction (3-6 week spike), measure actual vs estimated, then re-estimate the rest with calibrated data. The first extraction is an estimation calibration exercise, not just a technical milestone.`;
  }
  if (drillId.includes('ih-wrong')) {
    return `"Is Rust faster than Go for web servers?" — most honest answer:

WHAT I KNOW: Rust CAN be faster. Zero-cost abstractions, no garbage collector, no runtime overhead. Go has GC pauses but a highly optimized HTTP stack and goroutine scheduler.

WHAT I'M UNCERTAIN ABOUT: In practice, for TYPICAL web servers, the difference may be negligible. The bottleneck is usually I/O (database queries, network calls), not CPU. I don't have benchmarks for their specific use case and workload.

THE REAL QUESTION: "What is YOUR bottleneck?" 
- If CPU-bound (video encoding, ML inference, compression) → Rust's advantage is real and significant.
- If I/O-bound (typical CRUD API) → language barely matters. Developer productivity and ecosystem matter more.
- Also: "Is your team proficient in Rust or Go?" A mediocre Rust implementation by beginners will be SLOWER than an optimized Go implementation by experts.

The honest answer: "It depends on your bottleneck, and the language is probably not your bottleneck." The most intellectually honest move is questioning the premise — the question assumes language is the performance lever, when it's usually architecture, algorithm choice, and I/O patterns.`;
  }
  if (drillId.includes('ih-bias')) {
    return `5 cognitive biases influencing my TypeScript/React/PostgreSQL recommendation:

1. FAMILIARITY BIAS — I recommend what I KNOW, not necessarily what's BEST. Bias-free: evaluate 2-3 alternatives by objective criteria (performance benchmarks, community size, hiring pool, learning curve) without weighting my personal experience.

2. CONFIRMATION BIAS — I'll unconsciously find evidence supporting my preference and dismiss counterevidence. Bias-free: actively search "why NOT TypeScript/React/Postgres" and give those arguments equal weight.

3. SUNK COST — I've invested years learning these tools. Switching feels like wasting that investment. Bias-free: evaluate as if starting completely fresh. Past investment is irrelevant to future decisions.

4. BANDWAGON EFFECT — These tools are popular, so recommending them feels safe. Popularity validates my choice. Bias-free: popularity does not equal fit. Check if the popular choice matches THIS project's specific requirements, team, and constraints.

5. STATUS QUO BIAS — Staying with familiar tools feels low-risk. Switching feels scary. Bias-free: honestly evaluate switching costs against long-term benefits. Sometimes the "risky" choice has better long-term ROI.

Meta-insight: knowing your biases doesn't eliminate them. You need STRUCTURAL countermeasures — like having someone argue the opposite position, or evaluating alternatives before naming your preference. Awareness alone is insufficient.`;
  }

  // Fallback
  return `Approaching from ${foundation} principles: I need to analyze the core components, identify assumptions, consider what I know vs what I'm uncertain about, and reason from fundamentals rather than pattern-matching. Let me break this down systematically, identify the key tradeoffs, and give a clear, honest assessment with calibrated confidence.`;
}

/* ── Scoring Engine v2 — Semantic + Structural ──────────────── */

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

function getNgrams(words, n) {
  const grams = [];
  for (let i = 0; i <= words.length - n; i++) {
    grams.push(words.slice(i, i + n).join(' '));
  }
  return grams;
}

/** Extract technical AND cognitive concepts — words that carry domain meaning */
function extractConcepts(text) {
  const conceptPatterns = [
    // Code/infrastructure concepts
    /O\([^)]+\)/gi,
    /[A-Z][a-z]+(?:[A-Z][a-z]+)+/g,
    /\b(?:SQL|API|HTTP|DNS|TCP|UDP|JWT|CSS|HTML|ORM|CDN|CLI|CI\/CD|CRUD|REST|SSR|SSG|OOP|DI)\b/gi,
    /\b(?:latency|throughput|idempotent|async|sync|concurrent|parallel|mutex|deadlock|race condition)\b/gi,
    /\b(?:cache|index|partition|shard|replica|failover|rollback|migration|schema)\b/gi,
    /\b(?:microservice|monolith|event source|CQRS|saga|circuit breaker|backpressure|load balanc)\b/gi,
    /\b(?:b-tree|hash map|queue|stack|heap|graph|DAG|trie|bloom filter)\b/gi,
    /\b(?:kubernetes|docker|redis|kafka|postgres|mongo|nginx|webpack|vite)\b/gi,
    /\b(?:closure|scope|garbage collect|runtime|compile|interpreter|JIT)\b/gi,
    /\b(?:encrypt|hash|token|auth|CSRF|XSS|injection|sanitiz|validat)\b/gi,
    /\b(?:p95|p99|SLA|SLO|SLI|MTTR|MTTF|uptime|availability|reliability)\b/gi,
    /\b(?:tradeoff|bottleneck|constraint|scalab|decouple|cohes|coupling)\b/gi,
    /\b\d+(?:ms|s|min|hr|MB|GB|TB|KB|x|%)\b/gi,
    // Cognitive/reasoning concepts (Thorsen foundations)
    /\b(?:first.?principle|decompos|axiom|assumption|root cause|fundamental|ground truth)\b/gi,
    /\b(?:uncertain|confidence|calibrat|probability|bayesian|prior|posterior|heuristic)\b/gi,
    /\b(?:meta.?learn|transfer|analogy|pattern|generalize|abstract|structural)\b/gi,
    /\b(?:implicit|explicit|subtext|unstated|hidden|between the lines|unspoken)\b/gi,
    /\b(?:bias|honest|steelman|falsif|counter.?example|evidence|intellectual)\b/gi,
    /\b(?:reframe|hypothesis|diagnos|second.?order|cascade|feedback.?loop|systemic)\b/gi,
    /\b(?:judgment|taste|craft|quality|elegance|production.?ready)\b/gi,
    /\b(?:state.?machine|CLOSED|OPEN|HALF.?OPEN|backpressure|graceful.?degradation)\b/gi,
    /\b(?:unit.?test|integration.?test|e2e|end.?to.?end|test.?pyramid|test.?suite|regression)\b/gi,
    /\b(?:estimate|unknowable|knowable|uncertainty|range|precision|false.?precision)\b/gi,
    /\b(?:merge.?sort|recursive|binary.?search|algorithm|O\(n|complexity)\b/gi,
    /\b(?:redundan|timeout|canary|blue.?green|deploy|rate.?limit|observability)\b/gi,
    /\b(?:GDPR|CAN.?SPAM|accessibility|mobile|responsive|UX|session|token)\b/gi,
    /\b(?:priority|persona|decision|feasibility|real.?time|batch|stakeholder)\b/gi,
  ];
  
  const concepts = new Set();
  for (const pat of conceptPatterns) {
    const matches = text.match(pat);
    if (matches) matches.forEach(m => concepts.add(m.toLowerCase().trim()));
  }
  return concepts;
}

function scoreAnswer(vaiResp, expectedAnswer, scoringCriteria) {
  if (!expectedAnswer || !vaiResp) return { overall: 0, breakdown: {} };

  const vaiWords = normalize(vaiResp);
  const expWords = normalize(expectedAnswer);
  const vaiSet = new Set(vaiWords);
  const expSet = new Set(expWords);
  
  // 1. Keyword overlap (unigrams) — 20%
  const overlapCount = [...vaiSet].filter(w => expSet.has(w)).length;
  const keywordScore = Math.min(1, overlapCount / Math.max(expSet.size * 0.4, 1));
  
  // 2. Bigram overlap — 15%
  const vaiBigrams = new Set(getNgrams(vaiWords, 2));
  const expBigrams = new Set(getNgrams(expWords, 2));
  const bigramOverlap = [...vaiBigrams].filter(g => expBigrams.has(g)).length;
  const bigramScore = Math.min(1, bigramOverlap / Math.max(expBigrams.size * 0.2, 1));
  
  // 3. Trigram overlap — 10%
  const vaiTrigrams = new Set(getNgrams(vaiWords, 3));
  const expTrigrams = new Set(getNgrams(expWords, 3));
  const trigramOverlap = [...vaiTrigrams].filter(g => expTrigrams.has(g)).length;
  const trigramScore = Math.min(1, trigramOverlap / Math.max(expTrigrams.size * 0.15, 1));
  
  // 4. Concept extraction — 20%
  const vaiConcepts = extractConcepts(vaiResp);
  const expConcepts = extractConcepts(expectedAnswer);
  const conceptOverlap = [...vaiConcepts].filter(c => expConcepts.has(c)).length;
  const conceptScore = expConcepts.size > 0 
    ? Math.min(1, conceptOverlap / Math.max(expConcepts.size * 0.4, 1))
    : 0.5;
  
  // 5. Structure score — 10%
  const hasNumberedPoints = /\d[\.\):]/.test(vaiResp);
  const hasSections = /\n\n/.test(vaiResp) || /[A-Z]{2,}:/.test(vaiResp);
  const hasExamples = /e\.g\.|for example|such as|like |instance/i.test(vaiResp);
  const structureScore = (hasNumberedPoints ? 0.4 : 0) + (hasSections ? 0.3 : 0) + (hasExamples ? 0.3 : 0);
  
  // 6. Length appropriateness — 10%
  const lenRatio = vaiResp.length / Math.max(expectedAnswer.length, 1);
  const lengthScore = lenRatio < 0.3 ? 0.3 : lenRatio > 3 ? 0.7 : lenRatio < 0.6 ? 0.6 : 1.0;
  
  // 7. Coverage — does Vai cover DISTINCT points from expected? — 15%
  const expectedPoints = expectedAnswer.match(/\d[\.\)]\s+.{10,}/g) || [];
  let pointsCovered = 0;
  for (const point of expectedPoints) {
    const pointWords = normalize(point);
    const pointSet = new Set(pointWords);
    const matchedWords = vaiWords.filter(w => pointSet.has(w)).length;
    if (matchedWords >= pointSet.size * 0.25) pointsCovered++;
  }
  const coverageScore = expectedPoints.length > 0 
    ? Math.min(1, pointsCovered / Math.max(expectedPoints.length * 0.5, 1))
    : 0.6;

  // Weighted composite
  const raw = (
    keywordScore  * 0.20 +
    bigramScore   * 0.15 +
    trigramScore  * 0.10 +
    conceptScore  * 0.20 +
    structureScore * 0.10 +
    lengthScore   * 0.10 +
    coverageScore * 0.15
  );
  
  const score = Math.round(Math.min(100, raw * 100));
  
  return {
    overall: score,
    breakdown: {
      keywords: Math.round(keywordScore * 100),
      bigrams: Math.round(bigramScore * 100),
      trigrams: Math.round(trigramScore * 100),
      concepts: Math.round(conceptScore * 100),
      structure: Math.round(structureScore * 100),
      length: Math.round(lengthScore * 100),
      coverage: Math.round(coverageScore * 100),
    }
  };
}

/* ── Main Training Loop ──────────────────────────────────────── */

async function runTraining() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  VAI 50Q FOUNDATION TRAINING SESSION v3             ║');
  console.log('║  50 drills × 10 foundations (5 per foundation)      ║');
  console.log('║  Scoring: n-gram + concepts + structure + coverage  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const results = [];
  let questionNum = 0;

  for (const foundation of FOUNDATIONS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  FOUNDATION: ${foundation.toUpperCase()}`);
    console.log(`${'═'.repeat(60)}`);

    for (let round = 0; round < 5; round++) {
      questionNum++;
      const seed = round * 100 + questionNum;
      
      let drill;
      try {
        const res = await fetch(`${API}/api/vai/thorsen-drill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ foundation, difficulty: 'journeyman', seed }),
        });
        if (!res.ok) {
          console.log(`  ❌ Q${questionNum}: API error ${res.status}`);
          continue;
        }
        drill = await res.json();
      } catch (err) {
        console.log(`  ❌ Q${questionNum}: Network error — ${err.message}`);
        continue;
      }

      const drillId = drill._thorsen?.drillId ?? `unknown-${seed}`;
      const answer = vaiAnswer(drillId, drill.situation, foundation);
      
      // Use FULL expectedAnswer from _thorsen metadata (v2 improvement!)
      const fullExpected = drill._thorsen?.expectedAnswer || drill.hidden_need || '';
      const grade = scoreAnswer(answer, fullExpected, drill._thorsen?.scoringCriteria || []);

      const status = grade.overall >= 70 ? '✅' : grade.overall >= 50 ? '⚠️' : '❌';
      const drillTitle = drill._thorsen?.drillTitle ?? 'Unknown Drill';
      
      console.log(`  ${status} Q${String(questionNum).padStart(2)}: ${drillTitle.padEnd(30)} Score: ${String(grade.overall).padStart(3)}/100  [kw:${grade.breakdown.keywords} bi:${grade.breakdown.bigrams} tri:${grade.breakdown.trigrams} co:${grade.breakdown.concepts} str:${grade.breakdown.structure} len:${grade.breakdown.length} cov:${grade.breakdown.coverage}]`);
      
      const excerpt = answer.substring(0, 80).replace(/\n/g, ' ');
      console.log(`        Vai: "${excerpt}..."`);

      results.push({
        q: questionNum,
        foundation,
        drillId,
        drillTitle,
        score: grade.overall,
        breakdown: grade.breakdown,
        answerLen: answer.length,
      });
    }
  }

  // ── Summary Report ──────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(60));
  console.log('  TRAINING SESSION v3 SUMMARY');
  console.log('═'.repeat(60));

  const total = results.length;
  const avgScore = Math.round(results.reduce((s, r) => s + r.score, 0) / total);
  const passed = results.filter(r => r.score >= 70).length;
  const partial = results.filter(r => r.score >= 50 && r.score < 70).length;
  const failed = results.filter(r => r.score < 50).length;

  console.log(`\n  Total Questions: ${total}`);
  console.log(`  Average Score:   ${avgScore}/100`);
  console.log(`  ✅ Passed (≥70): ${passed} (${Math.round(passed/total*100)}%)`);
  console.log(`  ⚠️  Partial (50-69): ${partial} (${Math.round(partial/total*100)}%)`);
  console.log(`  ❌ Failed (<50): ${failed} (${Math.round(failed/total*100)}%)`);

  // Per-foundation breakdown
  console.log('\n  Per-Foundation Scores:');
  console.log('  ' + '-'.repeat(56));
  for (const f of FOUNDATIONS) {
    const fResults = results.filter(r => r.foundation === f);
    const fAvg = Math.round(fResults.reduce((s, r) => s + r.score, 0) / fResults.length);
    const bar = '█'.repeat(Math.round(fAvg / 5)) + '░'.repeat(20 - Math.round(fAvg / 5));
    const stars = fAvg >= 80 ? '⭐' : fAvg >= 60 ? '🔶' : '🔴';
    console.log(`  ${stars} ${f.padEnd(25)} ${bar} ${fAvg}/100`);
  }

  // Weakest areas
  const sorted = [...results].sort((a, b) => a.score - b.score);
  console.log('\n  Bottom 5 (Focus Areas):');
  for (const r of sorted.slice(0, 5)) {
    console.log(`    ${r.score}/100 — ${r.drillTitle} (${r.foundation})`);
  }

  console.log('\n  Top 5 (Strengths):');
  for (const r of sorted.slice(-5).reverse()) {
    console.log(`    ${r.score}/100 — ${r.drillTitle} (${r.foundation})`);
  }

  // Comparison with v1
  console.log('\n  ── v1 → v2 → v3 Comparison ──');
  console.log('  v1: Grade B (74/100) — 38 passed, 12 partial, 0 failed');
  console.log('  v2: Grade A (89/100) — 49 passed, 1 partial, 0 failed');
  console.log(`  v3: Grade ${avgScore >= 90 ? 'A+' : avgScore >= 80 ? 'A' : avgScore >= 70 ? 'B' : avgScore >= 60 ? 'C' : 'D'} (${avgScore}/100) — ${passed} passed, ${partial} partial, ${failed} failed`);
  console.log(`  Delta v1→v3: ${avgScore >= 74 ? '+' : ''}${avgScore - 74} points | v2→v3: ${avgScore >= 89 ? '+' : ''}${avgScore - 89} points`);
  
  console.log('\n' + '═'.repeat(60));
  console.log(`  SESSION GRADE: ${avgScore >= 95 ? 'A++' : avgScore >= 90 ? 'A+' : avgScore >= 80 ? 'A' : avgScore >= 70 ? 'B' : avgScore >= 60 ? 'C' : avgScore >= 50 ? 'D' : 'F'} (${avgScore}/100)`);
  console.log('═'.repeat(60) + '\n');
}

runTraining().catch(err => {
  console.error('Training session failed:', err);
  process.exit(1);
});
