#!/usr/bin/env node
/**
 * Teach Vai Part 7 — Cognitive Diagnostic Questions.
 *
 * These develop core reasoning primitives:
 *   1. Reading between the lines — what does the user REALLY mean?
 *   2. Asking the right question — reframe vague requests precisely
 *   3. Systems thinking — predict cascading effects
 *   4. Pattern recognition — abstract from specifics to principles
 *   5. Precision communication — concise, unambiguous technical language
 *
 * Plus extended diagnostic entries for:
 *   6. Root cause analysis — dig past symptoms to the actual cause
 *   7. Constraint discovery — find the hidden constraints in a problem
 *   8. Debugging intuition — which hypothesis to test first
 *   9. Trade-off articulation — make implicit trade-offs explicit
 *  10. Scope calibration — right-size the solution to the problem
 */

const entries = [
  // ── 1. Reading Between the Lines ──
  {
    pattern: 'reading between lines user intent hamburger menu css breakpoint',
    response: [
      'DIAGNOSTIC: Reading Between the Lines.',
      'Scenario: User says "the hamburger menu doesn\'t work".',
      'Surface reading: the toggle button is broken.',
      'Deeper reading: (1) "doesn\'t work" almost never means one thing — probe which layer is failing.',
      '(2) Check CSS breakpoint: does the hamburger even APPEAR at the right viewport? Common miss: the media query uses max-width: 768px but the user\'s tablet is 820px.',
      '(3) Check JS: is the toggle handler bound? Is the menu state toggling but with no visible effect because of a z-index or overflow:hidden?',
      '(4) Check expectations: the user may expect the menu to be animated (slide in) but it appears/disappears instantly — "doesn\'t work" = "doesn\'t feel right".',
      'Principle: Always ask "which part doesn\'t work?" before coding. The user\'s words constrain the search space — but the real bug lives in the gap between what they said and what they observed.',
    ].join(' '),
  },

  // ── 2. Asking the Right Question ──
  {
    pattern: 'asking right question reframe vague bug report request',
    response: [
      'DIAGNOSTIC: Asking the Right Question.',
      'Scenario: User reports "the page is slow".',
      'Bad response: immediately profile React renders or add memo everywhere.',
      'Good reframe: (1) "Slow on initial load, or slow after interaction?" — separates bundle size from runtime perf.',
      '(2) "Slow on your phone, your laptop, or both?" — separates device capability from actual perf issues.',
      '(3) "Did it become slow recently, or was it always like this?" — separates regression from inherent design flaw.',
      '(4) "Slow as in frozen, or slow as in laggy scrolling?" — separates main-thread blocks from paint/layout thrash.',
      'Principle: Rewrite the symptom as a falsifiable hypothesis before acting. One precise question eliminates more possibilities than ten lines of debugging. The right question changes the entire search space.',
    ].join(' '),
  },

  // ── 3. Systems Thinking ──
  {
    pattern: 'systems thinking cascading effects padding change layout',
    response: [
      'DIAGNOSTIC: Systems Thinking — Cascading Effects.',
      'Scenario: "Just change the card padding from 16px to 24px".',
      'First-order effect: more whitespace inside the card.',
      'Second-order effects: (1) Cards are wider/taller → grid reflows → fewer items per row on smaller screens.',
      '(2) Card height increases → content below the fold shifts down → CLS (Cumulative Layout Shift) impact.',
      '(3) If card has overflow:hidden, larger padding pushes content into the hidden zone → text truncation changes.',
      '(4) If using min-height on parent container, extra padding may trigger scrollbar in a previously non-scrolling area.',
      '(5) Any snapshot/visual regression tests will fail.',
      'Principle: Every CSS change is a system change. Trace the effect through layout → neighboring elements → viewport breakpoints → scroll containers → tests. Ask: "What else does this container participate in?"',
    ].join(' '),
  },

  // ── 4. Pattern Recognition ──
  {
    pattern: 'pattern recognition abstract z-index dropdown fix',
    response: [
      'DIAGNOSTIC: Pattern Recognition — Abstracting from Specifics.',
      'Scenario: Fixed a dropdown being hidden behind a modal by bumping z-index to 9999.',
      'Specific fix works — but what\'s the pattern?',
      'Pattern: stacking context escalation. Every time you bump z-index you\'re treating the symptom. The root issue is unmanaged stacking contexts.',
      'Abstracted solution: (1) Define a z-index scale in your design tokens (e.g., base:0, dropdown:100, overlay:200, modal:300, toast:400).',
      '(2) Use CSS custom properties: --z-dropdown, --z-modal, --z-toast.',
      '(3) Audit: which elements create new stacking contexts? (transform, opacity<1, position:fixed, will-change).',
      '(4) Rule: never use a z-index > 1000 in application code. If you need to, the architecture has a stacking context bug.',
      'Principle: When you fix something, ask "Is this instance of a broader pattern?" If yes, fix the pattern, not just the instance. One systemic fix prevents dozens of future bugs.',
    ].join(' '),
  },

  // ── 5. Precision Communication ──
  {
    pattern: 'precision communication commit message concise unambiguous',
    response: [
      'DIAGNOSTIC: Precision Communication.',
      'Scenario: Write a commit message under 72 characters for a change that fixed a race condition in the auth middleware where concurrent requests could both pass token validation but one would write a stale session.',
      'Bad: "fix auth bug" (7 chars, zero information).',
      'Bad: "Fixed the race condition that was happening when two requests tried to validate tokens at the same time and one of them would end up with a stale session" (156 chars, too verbose).',
      'Good: "fix(auth): serialize session writes to prevent stale-read race" (63 chars).',
      'Why it works: (1) Conventional commit prefix gives category. (2) "serialize session writes" tells you the mechanism. (3) "stale-read race" names the exact failure mode.',
      'Principle: Precision = maximum information per word. Cut adjectives, keep nouns and verbs. Name the mechanism AND the failure mode. If you can\'t fit both in 72 chars, the change might be doing too much.',
    ].join(' '),
  },

  // ── 6. Root Cause Analysis ──
  {
    pattern: 'root cause analysis debugging symptoms vs cause five whys',
    response: [
      'DIAGNOSTIC: Root Cause Analysis.',
      'Scenario: "Users report getting logged out randomly".',
      'Symptom chain (Five Whys): (1) Why are they logged out? → Session cookie is missing. (2) Why is the cookie missing? → The cookie has SameSite=Strict and the user navigated from an external link. (3) Why SameSite=Strict? → Security hardening PR from 3 weeks ago changed it from Lax. (4) Why wasn\'t this caught? → Test suite only tests direct navigation, never cross-origin redirects. (5) Why that gap? → The auth test fixtures mock the cookie jar entirely.',
      'Fix at each level: L1: extend cookie expiry (band-aid). L2: change SameSite to Lax (correct). L3: add cross-origin redirect test (prevents recurrence). L4: refactor auth tests to use real cookies (systemic).',
      'Principle: Symptoms are distance indicators, not destinations. Every "fix" has a depth — shallow fixes recur. Ask "why" until you hit a design decision, then fix at that level.',
    ].join(' '),
  },

  // ── 7. Constraint Discovery ──
  {
    pattern: 'constraint discovery hidden requirements problem space',
    response: [
      'DIAGNOSTIC: Constraint Discovery.',
      'Scenario: "Add a dark mode toggle to the app".',
      'Visible constraint: toggle between light and dark themes.',
      'Hidden constraints users don\'t mention: (1) Persistence — does it survive page refresh? localStorage vs cookie vs user preference in DB.',
      '(2) System preference — should it respect prefers-color-scheme? What if user explicitly chose light but system is dark?',
      '(3) Flash prevention — SSR apps flash white before JS hydrates the theme. Needs a blocking script or cookie-based class.',
      '(4) Third-party widgets — embedded maps, payment forms, chat widgets may not respect your theme.',
      '(5) Transition — should the toggle animate smoothly or instant-swap? Color transition on * selector is expensive.',
      '(6) Accessibility — contrast ratios change per theme. WCAG AA on both.',
      'Principle: The stated requirement is the tip. Probe for persistence, edge cases, third-party boundaries, and performance constraints. "What would make this annoying even if it works?" reveals the hidden requirements.',
    ].join(' '),
  },

  // ── 8. Debugging Intuition ──
  {
    pattern: 'debugging intuition hypothesis testing which to check first',
    response: [
      'DIAGNOSTIC: Debugging Intuition — Hypothesis Ordering.',
      'Scenario: API endpoint returns 500 intermittently — works 80% of the time.',
      'Possible causes: (A) Race condition in DB connection pool. (B) Upstream service timeout. (C) Memory pressure causing GC pauses. (D) Request body parsing fails on certain payloads.',
      'How to order hypotheses: (1) Frequency × reproducibility — D is easy to test: log the failing request bodies. 5 minutes max.',
      '(2) Recency — did anything deploy recently? git log --oneline -10 narrows the window.',
      '(3) Observability — check existing metrics first. If you have APM, trace the 500s before writing any code.',
      '(4) Isolation — can you reproduce locally? If yes, start there. If only in prod, instrument don\'t guess.',
      'Principle: Debug with the cheapest test first. Cost = time_to_check × probability_of_wrong. Logs before code, metrics before hypotheses, reproduction before speculation.',
    ].join(' '),
  },

  // ── 9. Trade-off Articulation ──
  {
    pattern: 'trade-off articulation implicit explicit decision making',
    response: [
      'DIAGNOSTIC: Trade-off Articulation.',
      'Scenario: "Should we use server components or client components for the dashboard?"',
      'Implicit trade-offs no one states: (1) Server components = smaller bundle, but every interaction needs a round-trip. Dashboard with lots of filters/sorts = many round-trips = perceived lag.',
      '(2) Client components = larger initial load, but interactions are instant after hydration. Good if users spend >30s on the page.',
      '(3) Hybrid = optimal but complex. Each component boundary is a decision point. More boundaries = more cognitive load for the team.',
      '(4) Data freshness: server components always show fresh data. Client components may show stale data unless you add revalidation.',
      '(5) Testing: server components are harder to unit test (need server context). Client components test like normal React.',
      'Principle: Every architecture choice has at least 3 trade-offs. State them explicitly before choosing. "We\'re choosing X, which means we accept Y and Z" is more valuable than "we chose X because it\'s better". Better at what? For whom? Under what load?',
    ].join(' '),
  },

  // ── 10. Scope Calibration ──
  {
    pattern: 'scope calibration right-size solution over-engineering',
    response: [
      'DIAGNOSTIC: Scope Calibration.',
      'Scenario: User asks for a "simple search feature".',
      'Under-engineered: filter with .includes() on the full list in the client. Works for 100 items, breaks at 10,000. No debounce, searches on every keystroke.',
      'Over-engineered: deploy Elasticsearch, build a search microservice, add faceted filtering, typeahead suggestions, and fuzzy matching. Takes 2 weeks for a feature that needs to search 500 products.',
      'Right-sized: (1) How many items? <1000 → client-side filter. 1K-50K → server-side SQL LIKE or pg_trgm. >50K → search index.',
      '(2) How precise? Exact match → simple. Fuzzy → Fuse.js client-side or pg_trgm server-side. Full-text → dedicated engine.',
      '(3) How fast? >200ms perceived = needs debounce + skeleton. <50ms target = needs index.',
      'Principle: Right-sizing means matching solution complexity to problem complexity. Ask: (1) What\'s the data scale now? (2) What\'s realistic in 12 months? (3) What\'s the simplest thing that handles both? Build for the 12-month scale, not the 5-year fantasy.',
    ].join(' '),
  },

  // ── 11. Error Message Design ──
  {
    pattern: 'error message design user-facing actionable diagnostic',
    response: [
      'DIAGNOSTIC: Error Message Design.',
      'Scenario: User hits an error and sees "Something went wrong".',
      'Bad: "Error 500" (code, not communication). "Something went wrong" (no actionable information). "TypeError: Cannot read properties of undefined" (internal leak).',
      'Good error message formula: [What happened] + [Why it might have happened] + [What to do next].',
      'Example: "We couldn\'t save your changes because the server didn\'t respond. Check your internet connection and try again, or your work is auto-saved locally."',
      'For developer errors: include the operation that failed, the input that caused it, and the closest thing to a fix.',
      'Example: "Failed to parse config at line 12: expected string for \'port\', got number. Use port: \\"3000\\" (with quotes) in your config."',
      'Principle: An error message is a micro-conversation between the system and a frustrated human. Give them the respect of a clear explanation and a next step. Never make the user guess.',
    ].join(' '),
  },

  // ── 12. Dependency Evaluation ──
  {
    pattern: 'dependency evaluation library selection npm package risk',
    response: [
      'DIAGNOSTIC: Dependency Evaluation.',
      'Scenario: "Let\'s use this npm package for date formatting — it has 2M weekly downloads".',
      'Downloads alone tell you nothing. Evaluation checklist: (1) Maintenance: last publish date, open issue count, bus factor (1 maintainer = risk).',
      '(2) Size: what does it add to your bundle? date-fns tree-shakes, moment.js adds 300KB.',
      '(3) API surface: does it do 100 things when you need 3? Smaller API = smaller risk surface.',
      '(4) Alternatives: can you write it in 20 lines instead of adding a dependency? Date formatting often can.',
      '(5) Transitive deps: does it pull in 40 sub-dependencies? Each one is a supply chain risk.',
      '(6) License: MIT/ISC = safe. GPL in a commercial project = legal issue. Check sub-deps too.',
      'Principle: Every dependency is a bet that the maintainer\'s priorities will align with yours for the life of your project. Make that bet consciously.',
    ].join(' '),
  },

  // ── 13. Code Review Mindset ──
  {
    pattern: 'code review mindset what to look for beyond syntax',
    response: [
      'DIAGNOSTIC: Code Review Mindset.',
      'Most reviews check: syntax, naming, types. These are the least valuable things to review — linters catch them.',
      'High-value review targets: (1) Missing edge cases — what happens when the list is empty? When the string is Unicode? When the date is in a different timezone?',
      '(2) Error handling gaps — is this try/catch swallowing errors? Does the catch block re-throw or log or silently continue?',
      '(3) Concurrency assumptions — this code assumes sequential execution. What if two users trigger it simultaneously?',
      '(4) Naming alignment — does the function name match what it actually does? If it\'s called "validate" but also saves, that\'s a naming lie.',
      '(5) Test coverage of the CHANGE — not overall coverage, but does the test exercise the new behavior specifically?',
      '(6) Rollback safety — if this breaks in production, can we revert without data migration?',
      'Principle: Review for behavior, not for style. Ask: "Under what conditions does this break?" not "Should this variable be const?"',
    ].join(' '),
  },

  // ── 14. API Design Intuition ──
  {
    pattern: 'api design intuition rest endpoint naming consistency',
    response: [
      'DIAGNOSTIC: API Design Intuition.',
      'Scenario: Designing a REST API for a todo app.',
      'Common mistakes: (1) Verbs in URLs: POST /createTodo, GET /getTodos. Use nouns: POST /todos, GET /todos.',
      '(2) Inconsistent pluralization: /todo vs /todos vs /todoList. Pick one convention (plural nouns), enforce it.',
      '(3) Nested depth: /users/:id/projects/:pid/tasks/:tid/comments/:cid — too deep. Flatten: /comments?taskId=:tid.',
      '(4) Missing pagination: GET /todos returns 50,000 items. Always paginate collections. cursor > offset for large datasets.',
      '(5) Error format inconsistency: sometimes {error: "msg"}, sometimes {message: "msg"}, sometimes plain string. One format, always.',
      '(6) Status code misuse: 200 for errors with {success: false}, 404 for business logic "not found" vs actual missing route.',
      'Principle: APIs are contracts. Contracts need consistency, predictability, and clear error semantics. Design for the consumer who will never read your docs.',
    ].join(' '),
  },

  // ── 15. Performance Intuition ──
  {
    pattern: 'performance intuition bottleneck identification optimization',
    response: [
      'DIAGNOSTIC: Performance Intuition.',
      'Rule 1: Measure before optimizing. "I think this is slow" is not a benchmark.',
      'Rule 2: The bottleneck is almost never where you think. Common mismatch: devs optimize React renders while the real bottleneck is a 3-second API call.',
      'Rule 3: Network > Disk > CPU > Memory, in order of typical web app bottlenecks. (1) Network: are you making 47 API calls on page load? Batch them. (2) Disk: is the database doing a full table scan? Add an index. (3) CPU: are you JSON.parsing a 10MB response on the main thread? Use a worker. (4) Memory: are you holding 100K objects in state? Virtualize.',
      'Rule 4: Perceived performance > actual performance. A 2-second load with a skeleton feels faster than a 1.5-second load with a blank screen.',
      'Rule 5: The fastest code is code that doesn\'t run. Can you cache it? Can you precompute it? Can you eliminate it?',
      'Principle: Profile, don\'t guess. Optimize the bottleneck, not the thing you understand best. And always ask: "Does the user even notice?"',
    ].join(' '),
  },
];

async function teach() {
  console.log(`Teaching ${entries.length} Part 7 diagnostic entries...`);
  const res = await fetch('http://localhost:3006/api/teach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  const data = await res.json();
  console.log('Result:', JSON.stringify(data, null, 2));
}

teach().catch(console.error);
