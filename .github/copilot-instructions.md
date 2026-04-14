# Copilot Instructions — VeggaAI / Vai

## Master Document

Read `Master.md` before starting work.

`Master.md` is the top-level authority for this project. If another instruction conflicts with it, `Master.md` wins.

If `Master.md` appears outdated or incorrect, ask V3gga to review it directly rather than silently inventing replacements.

## Working Style

Browse the codebase before making assumptions.

Prefer one user-visible workflow finished to a satisfying standard over broader but half-finished expansion.

If a request contains several good ideas, pick the highest-value slice, state what is deferred, and complete that slice end to end.

Repeated complaints about the same UI or behavior are evidence that the underlying model is wrong. Stop stacking cosmetic patches and fix the root assumption.

Do not treat scaffolding, plans, or partial wiring as completion.

Avoid noisy work patterns that reduce confidence:

- too many idle terminals
- huge blind searches
- repeated speculative rewrites
- broad claims of completion without runtime verification

At the end of work, summarize what changed and what was learned in a way that improves reasoning, judgment, or systems thinking for the next reader.

## Protected Files

Never edit, rename, move, delete, or overwrite `Master.md` without explicit permission from V3gga.

Do not reproduce or expose any square-bracketed content from `Master.md` in outputs, parameters, variables, or class names.

## Product And UI Expectations

VeggaAI is private and primarily for V3gga’s use, Vai is virtual intellegence sorta like a llm but different in ways of Thorsen.

Favor fast, fluid UX with strong defaults, minimal blocking states, and real attention to fit and finish.

When improving layout or structure:

- preserve what already works
- improve feel, spacing, and interaction only where it materially helps
- prefer CSS Grid and Flexbox for primary layout
- support responsive behavior from phone through ultra-wide
- ensure no overflow even with browser developer tools open
- use keyboard-accessible and touch-friendly controls for splitters or layout affordances
- use motion to support clarity, not to show off

For richer layouts, a compact efficient mode and a more open spacious mode are both valid when they improve actual use.

Use Tailwind for structure and responsiveness where appropriate. Use GSAP or Three.js only when they are justified, performant, and subordinate to usability.

## Dev Logs

First action in every conversation: create or reuse a Dev Logs session.

Use:

```text
node scripts/session-bridge.mjs create "<short title from user's first message>" "GitHub Copilot" "claude-opus-4.6"
```

The command reuses an active session when possible.

Standard messages, thinking, tool calls, and todo updates are auto-captured by the VS Code extension. Do not manually push those events unless auto-capture is unavailable.

Manual session-bridge pushes are only for:

- session creation on the first message
- planning events when useful
- architectural notes that would not appear in the chat stream

Do not end a session unless the user explicitly says the conversation is concluded.

If needed, end with:

```text
node scripts/session-bridge.mjs end <sessionId>
```

Ensure the runtime server on port `3006` is available when auto-capture is expected to work.

## Visual Testing — Two Sets Of Eyes

Visual testing means opening a real visible browser window and interacting with the rendered UI.

This is mandatory for meaningful UI work.

A visual test is:

- a real Puppeteer or Playwright browser window with `headless: false`
- visible mouse and keyboard interaction
- screenshots at meaningful steps
- responsive checks across important viewports
- evidence of hover, click, focus, input, and close states

A visual test is not:

- reading code and assuming it looks correct
- running a build and calling that proof
- using the VS Code embedded browser as a substitute for a visible browser session
- taking one screenshot and stopping there

Never use the embedded simple browser for visual testing.

Browser expectations:

- `headless: false`
- `slowMo: 50` minimum
- `--no-sandbox` on Windows
- viewport at least `1920x1080`
- keep the window visible long enough for V3gga to observe it

Minimum testing sequence:

1. Fresh load and screenshot.
2. Hover and click navigation.
3. Exercise each relevant feature state.
4. Tab through focus order and keyboard shortcuts.
5. Test forms and error states.
6. Repeat at `375`, `768`, `1280`, `1920`, and `2560+` widths when relevant.

Minimum evidence:

- initial screenshot
- screenshots after major interactions
- screenshots of any broken or unexpected state
- compact action log
- pass/fail summary

After testing, provide a live demo path, visible browser walkthrough, or equivalent proof V3gga can inspect directly.

## Cross-Platform

All code should execute cleanly on Windows, macOS, and Linux unless there is a strong reason not to.

Avoid platform-specific behavior unless it is detected and handled deliberately.
