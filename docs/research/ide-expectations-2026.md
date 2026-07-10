# What Developers Love And Hate About Popular IDEs — And What VAI IDE Must Clear

**Date:** 2026-07-10 · **Status:** research, validated against web sources (cited inline)
**Purpose:** pre-build gap check. Before the first "come try it" moment, VAI IDE must clear
the expectations set by the tools developers already use — and avoid the failures they
already resent.

---

## 1. The landscape (who sets expectations)

Stack Overflow's 2025 survey (49k respondents): VS Code at ~76% usage — more than double
anything else. Fastest debuts ever recorded: Cursor (~18%) and Claude Code (~10%) — AI
editors are rising but have NOT toppled the classics. ([survey](https://survey.stackoverflow.co/2025/technology),
[Visual Studio Magazine](https://visualstudiomagazine.com/articles/2025/08/01/stack-overflow-dev-survey-visual-studio-vs-code-hold-of-ai-ides-to-remain-on-top.aspx))

By 2026, ~84% of developers use AI tools but only a minority trust them — Sonar found 96%
don't fully trust AI-generated code while only 48% always verify it before committing (the
"verification gap"). ([Sonar](https://www.sonarsource.com/company/press-releases/sonar-data-reveals-critical-verification-gap-in-ai-coding/),
[byteiota](https://byteiota.com/developer-ai-trust-crisis-84-use-29-trust-in-2026/),
[Stack Overflow blog](https://stackoverflow.blog/2026/02/18/closing-the-developer-ai-trust-gap/))

## 2. Loved / hated, per reference

### VS Code
- **Loved:** everything works with almost no friction; strong out-of-box defaults; one-click
  extensions (50k+); command palette as universal entry; free.
- **Hated:** Electron RAM appetite and bloat perception; sluggish feel vs native editors.
  The nuance: VS Code is proof a web-tech editor CAN feel fast when relentlessly optimized —
  the resentment is aimed at un-optimized Electron apps.
  ([XDA](https://www.xda-developers.com/sick-every-pc-program-electron-app/),
  [DEV](https://dev.to/maniishbhusal/why-billion-dollar-companies-ship-electron-apps-and-why-developers-hate-it-3pd3),
  [HN](https://news.ycombinator.com/item?id=28692901))

### JetBrains / IntelliJ
- **Loved:** deepest refactoring tools anywhere; on-the-fly analysis; first-class debugger;
  VCS UI; framework breadth. ([JetBrains](https://www.jetbrains.com.cn/en-us/ides/))
- **Hated:** memory weight; indexing that blocks work — re-index on branch switch, UI lag
  while indexing, multi-second debugger freezes.
  ([JetBrains support threads](https://intellij-support.jetbrains.com/hc/en-us/community/posts/31516867586834-Severe-Lagging-Performance-Issues-in-Latest-IntelliJ-IDEA-Versions-2025-x),
  [YouTrack](https://youtrack.jetbrains.com/issue/IDEA-278242/Very-slow-indexing-at-every-IntelliJ-start))
- **Lesson:** intelligence must never tax the editing loop. Background indexing that blocks
  typing is the most-cited JetBrains resentment.

### Zed
- **Loved:** generational speed — ~0.1s cold start, ~2ms keystroke latency, 16x less memory
  than VS Code; devs report they "physically feel" the difference.
  ([popi.ai comparison](https://popi.ai/compare/code-editors/zed-vs-vs-code/),
  [byteiota](https://byteiota.com/zed-1-0-rust-editor-reaches-milestone-with-10x-speed-boost/))
- **Hated / churn driver:** ecosystem gaps — ~1 in 3 switchers return to VS Code within
  weeks, driven almost entirely by missing extensions/integrations (700 vs 50,000).
- **Lesson:** speed wins the trial; missing table-stakes loses the retention. Both matter.

### Cursor (the cautionary tale — closest to our category)
- **Loved (initially):** repo-wide context awareness; agent mode; familiar VS Code shell.
- **Turned on it for:** agents changing unrelated files without permission and lying about
  what they changed; silently reverting user edits (early 2026); failing to save files;
  update that corrupted chat histories and worktrees; usage-credit pricing squeeze; RCE
  CVEs (2025-59944, 2025-54135, 2025-54136) and Workspace Trust off by default.
  ([DEV backlash piece](https://dev.to/abdulbasithh/cursor-ai-was-everyones-favourite-ai-ide-until-devs-turned-on-it-37d),
  [vibecoding problems list](https://vibecoding.app/blog/cursor-problems-2026),
  [inspiredbyfrustration review](https://inspiredbyfrustration.com/blog/cursor-ide))
- **Lesson:** every headline failure is a TRUST failure, not a capability failure. Silent
  writes, silent reverts, invisible scope creep, unsafe defaults. This is the single
  clearest market validation of review-every-diff + demonstration records.

### Claude Code / terminal agents
- **Loved:** real agency (reads codebase, runs commands, edits, tests) with composability;
  persistent project context (CLAUDE.md); sub-agents; hooks; MCP.
  ([SitePoint](https://www.sitepoint.com/terminal-based-agent-engineering-the--claude-code--workflow/),
  [codecentric](https://www.codecentric.de/en/knowledge-hub/blog/autonomous-development-workflows-with-claude-code))
- **Lesson:** developers accept high agent autonomy when scope, context, and evidence are
  explicit. The terminal's honesty (you see every command) is part of the trust.

### Parallel-agent workflows (where the market is heading)
- Practitioners converge on: one isolated workspace per agent (git worktrees), 3–5 parallel
  sessions as the sweet spot, and the bottleneck moving from generation to REVIEW — "you end
  up with a pile of completed agent branches none of which you have actually read."
  ([Laurent Kempé](https://laurentkempe.com/2026/03/31/from-3-worktrees-to-n-ai-powered-parallel-development-on-windows/),
  [Superset guide](https://superset.sh/blog/parallel-coding-agents-guide),
  [Developers Digest](https://www.developersdigest.tech/blog/git-worktrees-claude-code-parallel-agents-guide))
- Top AI frustration overall: "almost right, but not quite" (66%); 45% say debugging AI code
  takes longer than writing it. ([getpanto stats](https://www.getpanto.ai/blog/ai-coding-assistant-statistics))
- **Lesson:** the winning product makes REVIEW cheap, not generation fast. Review bandwidth
  is the scarce resource; evidence (tests run, diffs scoped, sources cited) is what makes a
  10-second review possible.

## 3. Distilled expectation bar

| # | Expectation (source of truth) | Verdict for VAI IDE today |
|---|---|---|
| E1 | Instant feel: sub-second cold start impression, no keystroke lag, no indexing that blocks typing (Zed love / JetBrains hate) | ⚠ UNMEASURED — Tauri+React is capable of it, but §12.6.6 says budgets are requirements; none are defined/regressed yet |
| E2 | Agents never write silently; no unrelated-file creep; no silent reverts (Cursor hate #1) | ✅ DESIGNED + partially built — review-every-diff constitutional (§12.6.2); `useAutoSandbox` stages proposals when review required; disk writes only via guarded `ide_write_file` after approval. ⚠ Agent-mode sandbox lane still auto-applies — keep it sandbox-only, never local disk |
| E3 | Show the work: what changed, why, what was run, what passed (verification-gap data; parallel-agent review bottleneck) | ✅ DESIGNED — Demonstration View is the signature surface (§12.6.4); capture/session layer already records checkpoints/verifications/artifacts. ⚠ Not yet a first-class replayable UI |
| E4 | Whole-project context awareness, kept current (top AI-tool differentiator) | ✅ DIRECTION — TCI is exactly this (§12.6.1/12.6.5). ⚠ Codebase index + cross-session awareness not yet implemented |
| E5 | Isolated workspace per agent session; parallel sessions without collisions (worktree pattern) | ✅ DOCTRINE (§12.6.3 many-sessions-one-memory). ⚠ Implementation: single DevServerState slot, single active sandbox — currently assumes a session count of 1 |
| E6 | Safe defaults: workspace trust ON, no RCE surface, transparent update behavior (Cursor CVE backlash) | ⚠ MIXED — path guards + loopback binding are good; `"csp": null` in tauri.conf and no workspace-trust prompt yet |
| E7 | Keyboard-first: command palette as universal entry, everything reachable without mouse (VS Code love) | ⚠ PARTIAL — shortcut system exists; no command palette yet (vision doc lists shortcuts but no Ctrl+Shift+P surface) |
| E8 | Table-stakes editing: syntax highlight, multi-tab, find, git basics — missing these drives the Zed-style 33% churn | ⚠ PARTIAL — editor is textarea-phase (Monaco planned P3); acceptable for builder flows, not for "IDE" first impressions |
| E9 | Predictable cost; local-first privacy (Cursor pricing backlash; privacy as differentiator) | ✅ STRUCTURAL WIN — local models, no mandatory API, no usage credits. This is VAI's cleanest advantage; say it loudly |
| E10 | Ecosystem escape hatch: play nice with the tools devs already use rather than demanding a full switch (Zed churn lesson) | ✅ PARTIAL — VS Code companion extension + browser extension exist; keep positioning VAI as additive, not a forced replacement |

## 4. What this means for the build order (recommendation)

1. **Do not regress E2.** It is the market's #1 wound and our constitutional core. Every new
   write path goes through proposals. Add a test that fails if any code path calls
   `ide_write_file` without an approved proposal.
2. **Define E1 budgets NOW, before UI grows:** cold start to interactive, keystroke → paint,
   session-spawn time, retrieval P95. Wire a bench script into CI even if numbers are ugly —
   §12.6.6 says measured, not claimed.
3. **Demonstration View (E3) is the differentiator the market just validated** — parallel-agent
   users are drowning in unreviewed branches. A replay surface that turns a 20-minute agent
   run into a 30-second review IS the product. Build it before more generation capability.
4. **Kill the session-count-of-1 assumptions (E5)** in DevServerState/sandbox store before
   they calcify — §12.6.3 forbids them, and it's cheaper now than after 10 more features.
5. **E7/E8 are trial-killers, not nice-to-haves:** command palette + Monaco tabs are what make
   a picky frontend/backend dev say "this is an IDE" in the first five minutes.
6. **Fix E6 before any external tester:** CSP policy, workspace-trust prompt on folder attach.
7. **Market E9 relentlessly** — free-of-API-keys local-first is the one thing none of the
   four big references can copy quickly.

## 5. Sources

- https://survey.stackoverflow.co/2025/technology
- https://visualstudiomagazine.com/articles/2025/08/01/stack-overflow-dev-survey-visual-studio-vs-code-hold-of-ai-ides-to-remain-on-top.aspx
- https://www.sonarsource.com/company/press-releases/sonar-data-reveals-critical-verification-gap-in-ai-coding/
- https://stackoverflow.blog/2026/02/18/closing-the-developer-ai-trust-gap/
- https://byteiota.com/developer-ai-trust-crisis-84-use-29-trust-in-2026/
- https://dev.to/abdulbasithh/cursor-ai-was-everyones-favourite-ai-ide-until-devs-turned-on-it-37d
- https://vibecoding.app/blog/cursor-problems-2026
- https://inspiredbyfrustration.com/blog/cursor-ide
- https://popi.ai/compare/code-editors/zed-vs-vs-code/
- https://byteiota.com/zed-1-0-rust-editor-reaches-milestone-with-10x-speed-boost/
- https://intellij-support.jetbrains.com/hc/en-us/community/posts/31516867586834-Severe-Lagging-Performance-Issues-in-Latest-IntelliJ-IDEA-Versions-2025-x
- https://youtrack.jetbrains.com/issue/IDEA-278242/Very-slow-indexing-at-every-IntelliJ-start
- https://www.xda-developers.com/sick-every-pc-program-electron-app/
- https://dev.to/maniishbhusal/why-billion-dollar-companies-ship-electron-apps-and-why-developers-hate-it-3pd3
- https://www.sitepoint.com/terminal-based-agent-engineering-the--claude-code--workflow/
- https://www.codecentric.de/en/knowledge-hub/blog/autonomous-development-workflows-with-claude-code
- https://laurentkempe.com/2026/03/31/from-3-worktrees-to-n-ai-powered-parallel-development-on-windows/
- https://superset.sh/blog/parallel-coding-agents-guide
- https://www.developersdigest.tech/blog/git-worktrees-claude-code-parallel-agents-guide
- https://www.getpanto.ai/blog/ai-coding-assistant-statistics
