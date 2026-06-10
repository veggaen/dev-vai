# Live UI + Response-Quality Test Log — 2026-06-10

Context: Recorded during the UI modernization pass (kinetic empty state, new
design tokens, Bricolage Grotesque/Instrument Sans/JetBrains Mono, brand
avatar, theme-aware markdown). All messages were sent live through the desktop
shell at `localhost:5173` against the local runtime (port 3006), engine
`vai:v0` with `qwen2.5:7b` escalation.

## Test transcript & verdicts

### T1 — Format-constrained factual ("TCP vs UDP, two sentences each")
- Route: escalated to qwen2.5:7b (~3.8s).
- **PASS.** Correct, concise, respected the two-sentence constraint, clean markdown.

### T2 — Contextual follow-up ("one-line analogy for each of those two protocols")
- Route: qwen2.5:7b (~6.0s).
- **PASS.** Resolved "those two protocols" from conversation context. Good analogy quality.

### T3 — Non-English prompt ("Hva er hovedstaden i Norge, og nevn en kjent severdighet der?")
- Route: fallback:no-knowledge → qwen2.5:7b, `verify:pass:complementary`.
- **FAIL (severe).** Answer started in Norwegian, drifted into Chinese mid-sentence
  (`...severdighet i Oslo er奥斯陆是挪威的首都...`), then "translated back" and
  hallucinated a nonsense landmark (a 2005 cold-temperature record instead of an
  actual sight). Two compounding engine weaknesses:
  1. **No language-consistency guard** on escalated answers — the verification
     gate passed an answer containing CJK script for a Norwegian question.
  2. **Semantic sanity not checked** — "severdighet" (landmark) answered with a
     weather event.
  - Suggested fixes: add a script/language check to `response-verification`
    (reject/regenerate when the dominant script of the answer mismatches the
    prompt language), and lower verification confidence when the answer
    contains meta-commentary about translation.

### T4 — Code generation with explicit requirement ("debounce with a cancel method")
- Route: local "creative code" snippet (140ms, 85% confidence).
- **PARTIAL FAIL.** Solid debounce snippet, but the canned local answer ignored
  the explicit "with a cancel method" requirement. The fast-path snippet
  matcher (`programming-idioms` / canned code) doesn't validate that all named
  requirements in the prompt are present in the snippet.
  - Suggested fix: when a canned snippet is chosen, scan the prompt for
    requirement keywords (e.g. "cancel", "typed", "async") missing from the
    snippet and either escalate or append the missing capability.

### T5 — Correction turn ("You missed the cancel method I asked for. Add it.")
- Route: qwen2.5:7b (~9.5s).
- **PASS (with nit).** Correctly took the feedback and produced a cancelable
  debounce. Nit: returned type signature `{ (args: Parameters<T>): void; cancel(): void }`
  drops the rest/spread (`...args`) — subtly wrong TS. No type-sanity pass on
  generated code.

### T6 — Ambiguous terse follow-up ("make it faster")
- Route: qwen2.5:7b (~6.3s).
- **PARTIAL PASS.** Stayed on the debounce context (good), but conflated
  "faster" with "more concise/efficient code" and never asked what "faster"
  means (runtime perf? response latency? shorter delay?). The clarifying-question
  discipline didn't trigger on a genuinely ambiguous performance request.

### T7 — Live capability/meta question ("What tools, models, and connected friends can you reach right now?")
- Route: "Recalled a fact" canned capabilities answer (3.8s).
- **FAIL.** Three problems:
  1. **Stale/canned**: answered with the generic v0 capability blurb instead of
     live workspace state (the runtime knows: qwen2.5:7b is registered, which
     IDE clients are online, web search availability, sandbox state).
  2. **Broken text**: mojibake `am v0 ��� pattern matching` (encoding bug in the
     stored capabilities string) plus dropped pronouns ("answer based on what
     have learned").
  3. Didn't address "connected friends" at all — the collab/companion broker
    has this data.
  - Suggested fixes: `capabilities-fallback` should be composed at answer time
    from bootstrap/registry state (models list, online IDE clients from the
    companion broker, search availability), and the stored blurb needs its
    encoding fixed.

## Scorecard

| # | Scenario | Verdict |
|---|----------|---------|
| T1 | Constrained factual | PASS |
| T2 | Contextual follow-up | PASS |
| T3 | Norwegian prompt | **FAIL — language drift + hallucinated landmark** |
| T4 | Code w/ explicit requirement | PARTIAL — requirement ignored by canned snippet |
| T5 | Correction turn | PASS (TS type nit) |
| T6 | Ambiguous "make it faster" | PARTIAL — no clarifying question |
| T7 | Live capabilities | **FAIL — stale canned answer + mojibake** |

## Engine improvement backlog (ranked)

1. **Language-consistency gate** in `packages/core/src/chat/response-verification.ts`:
   reject answers whose dominant Unicode script differs from the prompt's, and
   strip/regenerate translation meta-commentary. (Fixes T3.)
2. **Live capabilities composer**: replace the static capability blurb with a
   runtime-composed answer (registered models, online companion clients,
   search/tools availability). Fix the mojibake in the stored string. (Fixes T7.)
3. **Snippet requirement check**: canned code answers must satisfy explicit
   requirement tokens from the prompt or escalate. (Fixes T4.)
4. **Clarify-on-ambiguity for perf-words**: "faster/slower/better" with no
   measurable target should trigger the single-clarifying-question path. (T6.)
5. **Generated-code type sanity**: lightweight tsc-style signature check on
   TypeScript snippets before sending. (T5 nit.)

## UI observations made during the same session

- Light theme renders correctly with the new theme-aware markdown tokens
  (previously hardcoded dark zinc values).
- New kinetic empty state, starter chips, brand avatar, JetBrains Mono code
  blocks all verified live in both themes.
- Perf (dev mode): FCP ~180ms, DOMContentLoaded ~140ms, 0 long tasks.
- Found and fixed a hard crash on boot: `ActivityRail.tsx` referenced `useMemo`
  without importing it (dead `hasActiveCouncil` block) — the app rendered a
  black screen before this pass.

---

# Round 2 — chat cleanup, theme accent system, process panel, sidebar (same day)

## What changed

1. **Empty state simplified** (`ChatEmptyState.tsx`): headline is now just the
   time-aware greeting ("Good evening, Local."), subline "Send a message to get
   started." The four starter buttons (Research/Build/Explain/Improve) were
   removed entirely.
2. **Accent system** (`index.css`): new `--accent*` tokens — violet in dark
   mode, **blue in light mode**. Wired into ActivityRail (logo gradient, active
   indicator, focus rings), SidebarPanel (active row, pins, owner panel),
   composer (focus ring, send button, mode chips), ThinkingPanel.
3. **Seamless theme switching**: `[data-theme-switching]` cross-fade (300ms) on
   background/border/text colors, applied by App.tsx for 350ms on each flip.
4. **Process panel redesign** (`ThinkingPanel.tsx`):
   - Fully theme-aware (was illegible in light mode — hardcoded zinc-100/300 on
     white). New `.thinking-*` surface classes + `--tone-*` status colors.
   - Analyst stat grid: Intent · Answered by · Elapsed · Grounding ·
     **Commands run · Files changed · Web sources · Models consulted**.
   - Explicit zero-evidence line: "No shell commands were run and no project
     files were created or changed for this turn."
   - "Friends advised" → "Recommendation" (casual framing per owner request).
   - Removed dead "save / apply" stub button and the Design Mode hint line.
5. **Sidebar** (t3code/odysseus-inspired): personal chats now group into
   **Today / Yesterday / Last 7 days / Last 30 days / Older** date buckets;
   **pinning** added (pin floats chat to a Pinned section, persisted in
   localStorage); project groups unchanged; accent-token active indicator.

## Live verification (Chrome, dev server :5173)

| Check | Result |
|---|---|
| Empty state minimal, no starter chips (dark+light) | PASS |
| Accent flips violet→blue on light mode (logo, kinetic text, send button, mode chip) | PASS |
| Theme cross-fade on toggle | PASS (mechanism verified, no snap) |
| Process panel light-mode legibility | PASS (was broken before) |
| Analyst grid + zero-evidence line on a real turn | PASS (debounce/throttle Q: commands 0, files 0, sources 0, models Vai→qwen advisor→qwen answer) |
| Sidebar date buckets + pin/unpin | PASS (Pinned section renders with accent pin) |
| Desktop unit tests | 17 files / 104 tests PASS |

## Engine quality note from this round's live turn

The debounce-vs-throttle turn was answered correctly and idiomatically by the
qwen2.5:7b fallback with verification `calibrate:contradicted` — the
calibration note stayed out of the answer, as designed. Routing weighed 9
candidates; all deterministic handlers correctly declined.

## Encoding lesson (tooling)

PowerShell `Get-Content`/`Set-Content -Encoding UTF8` round-trip mangled UTF-8
em-dashes in `ThinkingPanel.tsx` (mojibake). Fixed with
`[System.IO.File]::ReadAllText/WriteAllText` + explicit UTF8 no-BOM. Future
bulk edits should use the file APIs, never bare `Set-Content -Encoding UTF8`
after a bare `Get-Content`.

---

## Round 3 — Light/dark parity, composer border, process panel refactor, peer code review

### UI fixes
- **Composer (dark mode):** Removed Framer `animate borderColor` and hardcoded
  `border-zinc-*` classes. Composer now uses `--composer-*` tokens via
  `.composer-shell` / `.composer-toolbar` — border is theme-native zinc, not a
  harsh white ring.
- **ThinkingPanel (light mode):** Expanded body uses `.thinking-surface` /
  `.thinking-surface-soft` / `.thinking-stat` with solid `#f4f4f5` panel bg and
  `#e4e4e7` borders so cards are visible on white (1:1 structure with dark mode).
- **Process layout:** Metrics-first grid → “Why this answer” card → vertical
  steps timeline → evidence log. Peer-review steps render as dedicated cards.

### Engine — peer code review
- `code-review-policy.ts`: triggers friend review when prompt asks for code and
  draft contains fenced/file blocks.
- `service.ts`: extends `shouldReviewDraft` + rejection path for failed code review.
- ThinkingPanel evidence: `stage: 'friend-review'` → “Peer review” card in UI.

### Tests
- `code-review-policy.test.ts` — 9 tests PASS
- `ThinkingPanel.logic.test.ts` — 33 tests PASS (includes friend-review stage)
