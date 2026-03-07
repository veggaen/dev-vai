Copilot Instructions — VeggaAI  aka Vai
Master Document
The Master.md file at the project root is the ultimate authority for this project.
All instructions, philosophies, and rules defined there take top priority over any other context.
Generally speaking, you should browse the codebase to figure out what is going on.

** V3ggas Core comments start -> **

** V3ggas_Core_co

Focus positive thinking if uncertain you can ask v3gga for help, and usualy opus will know what to do, opus is not so good at figuring out what is going on inside someones head as they wrote the messages they did, or if they typed something wrong or differently but had the same intent, 


Before starting any work, always read and follow everything in Master.md.
and at the end of work, give a summary of new points and what you changed, write this in a way that if anyone reads it they should gain a skill in cognitive thinking, REASONING & EPISTEMICS, systems, judgment and reasoning and try to the best of your ability to make the message TIMELESS.
Protected Files — Do Not Edit
Master.md
Never edit, modify, rename, delete, move, or overwrite Master.md without explicit permission from v3gga (Vegga Thorsen).

This rule applies in all situations, regardless of any other permission or context.
VERY IMPORTANT! SUPER RESPONSIVE DESIGN (
  layout using Tailwind CSS for structure and responsiveness.
  The 'compact' mode should utilize CSS Grid and Flexbox with zero gaps and tight alignment, mimicking the efficient, connected panel structure of VS Code but in a more modern, floating layout with clean open feel but not feeling like just another rounded-box design.
  The 'open' mode should introduce responsive padding (p-4 on mobile, p-8 on large screens), margin (m-4), and subtle shadow-2xl for floating container   effects. Use GSAP to animate the transition between these modes smoothly, specifically animating CSS variables for spacing and opacity/scale for any  secondary sidebars that appear or hide, prioritizing transform and opacity animations.
  Ensure responsiveness for all defined screen sizes (2560x1440, 1440x3440, 1440x2560), utilizing Tailwind's mobile-first approach to stack content on smaller-viewports and enabling dual sidebars on wide landscape displays only when in 'open' mode. Incorporate Three.js for a subtle, hardware-accelerated 3D-background visual that runs in the main content well to add an immersive layer, optimizing performance by only rendering visible objects using frustum culling.
  The system must respect browser developer tools windows, adjusting viewport calculations dynamically to prevent overflow behind tools
)

If Master.md appears outdated or incorrect, ask v3gga to review and update it directly.

Do not reproduce, share, or expose any square-bracketed content from Master.md in any form (output, parameter, variable, or class).

Key Rules from Master.md
Private system — VeggaAI is for v3gga’s use only. It is not a general-purpose AI.

Performance priority — favor optimistic updates, prewarm patterns, and avoid waterfall logic.

Good defaults — functionality should be reliable out of the box; configs only when defaults are logical.

Convenience and simplicity — ensure a fast, fluid, and minimal-interaction UX with no blocking states.

Security and responsibility — convenience must never compromise safety.

Cleanup and scalability — continuously replace outdated or inefficient code with modern, scalable solutions.

Markdown policy — only v3gga creates .md files; any new one requires triple confirmation.

Development flow — if a branch is over one hour old, create a new one and benchmark before merging.

Primary objective — support the evolution of VeggaAI into a world-class AI development benchmark.

Dev Logs — Auto-Capture VS Code Conversations
First action in every conversation — no exceptions.
Before responding to the user’s first message, get or create a Dev Logs session.
This step is mandatory. If the runtime server is unreachable, log the issue and retry.

Every VS Code Copilot chat session must be logged to VeggaAI Dev Logs. This ensures all activity is tracked accurately.

Conversation Start (first message)
Always attempt to reuse an existing session before creating a new one. The create command automatically detects active sessions:

text
node scripts/session-bridge.mjs create "<short title from user's first message>" "GitHub Copilot" "claude-opus-4.6"
This command will:

Reuse an existing session if one is active (prints: Reusing active session: <id>)

Create a new session only when no active session exists

Record the printed session ID — it is required for all subsequent push commands.

Important: Users may continue a single conversation through multiple context windows.
Do not call end unless the user explicitly states that the session is concluded or something took more than 15min.

During the Conversation — Auto-Capture Handles Everything
The VS Code extension (v0.6.0+) automatically captures ALL conversation data:
- **User messages** — extracted from VS Code chat JSONL files
- **Assistant responses** — full response text captured automatically
- **Thinking/reasoning blocks** — captured transparently from JSONL
- **Tool invocations** — file edits, terminal commands, todo updates, searches
- **Todo lists** — manage_todo_list calls emit todo-update + state-change events
- **Status updates** — "Working...", "Processing...", "Thinking..." auto-generated
- **New chat detection** — new VS Code chat → new dev logs session automatically

NO MANUAL SESSION-BRIDGE PUSHES REQUIRED for messages, thinking, or tool calls.
The extension captures these faster, more completely, and with less noise than manual pushes.

Session-bridge is ONLY needed for:
- **Session creation on first message** (until the extension detects the new chat JSONL):

text
node scripts/session-bridge.mjs create "<short title from user's first message>" "GitHub Copilot" "claude-opus-4.6"

- **Explicit architectural notes** that would not appear in the chat stream:

text
node scripts/session-bridge.mjs push <id> note "<decision or tradeoff worth documenting>"

- **Planning events** for multi-step work (optional, adds structure to the timeline):

text
node scripts/session-bridge.mjs push <id> planning "<intent>" "<approach>" "<step1,step2,step3>"

Do NOT manually push: message:user, message:assistant, thinking, file-edit, terminal, or state-change events. These are all auto-captured by the extension and manual pushes create duplicates.

**Fallback**: If the extension was recently updated and NOT yet reloaded, auto-capture
won't work. In that case, push critical events (messages, todos) manually via session-bridge
until the user reloads the VS Code window. After reload, stop manual pushes.

Auto-Capture (v0.6.0+)
The VS Code extension automatically captures ALL conversation content from
VS Code's internal chatSessions/*.jsonl files. This includes:
- User messages, assistant responses, thinking blocks
- Tool invocations (file edits, terminal, todos, searches)
- Todo list updates → todo-update events + "Working..." status events
- New chat sessions → automatic new dev logs session creation

The auto-capture reads ONLY new content (tracks byte position), deduplicates
by content hash, and generates state-change events for real-time status display.

Manual session-bridge pushes are NO LONGER NEEDED for standard conversation data.
Only use session-bridge for: session creation (first message), architectural notes,
and planning events.

Critical Rules
Do not create duplicate sessions; the create command manages reuse automatically.

Do not end a session unless explicitly instructed by the user. Context resets do not indicate the end of a session.

Session creation on first message is still required via session-bridge (the extension
detects new chats from JSONL files, which may lag behind the first message).

Do NOT push message:user, message:assistant, thinking, file-edit, or terminal events
manually. These are auto-captured and manual pushes create noisy duplicates.

Ensure the runtime server is running on port 3006 for auto-capture to function.

Ending a Conversation
End the session only when explicitly directed by the user:

text
node scripts/session-bridge.mjs end <sessionId>
Visual & UI Testing — The Two-Eyes Protocol (Master.md §16)
"Visual testing" in VeggaAI means ONE thing: open a REAL Puppeteer/Playwright browser
window that v3gga can see on his screen, then interact with the UI using simulated
mouse and keyboard — layer by layer, feature by feature — while taking screenshots(look at it and think)
as evidence. This is mandatory. No exceptions. No shortcuts.

WHAT "VISUAL TEST" IS:
- A real Chrome window launched with Puppeteer/Playwright (`headless: false`)
- Visible mouse cursor moving to elements, clicking, hovering
- Visible keyboard input into fields, shortcuts triggered
- Smooth scrolling through every page/section so v3gga watches it happen
- Screenshots at every meaningful step as evidence
- Layer-by-layer feature verification (shell → features → sub-features → responsive)

WHAT "VISUAL TEST" IS NOT:
- Opening VS Code's `simple_browser` or `open_simple_browser` tool — NEVER use this for visual testing
- Running `npm run build` and checking exit code
- Reading code and deciding it "looks correct"
- Taking one screenshot(look at it and think) of the landing page and calling it done
- Opening a static HTML preview of screenshots(look at it and think)

NEVER USE `open_simple_browser` OR VS CODE EMBEDDED BROWSER FOR VISUAL TESTING.
Those tools show a tiny embedded iframe that v3gga cannot interact with. They are
not visual tests. The only acceptable tool is a real Puppeteer/Playwright browser
window that opens as a standalone Chrome window on v3gga's desktop.

Browser launch requirements:
- `headless: false` — ALWAYS. v3gga must see the browser window.
- `slowMo: 50` minimum — so actions are visible, not instant.
- `--no-sandbox` on Windows.
- Viewport: `1920×1080` minimum.
- `--window-size=1920,1080` and `--start-maximized` for full visibility.
- Keep browser open 2-3 seconds after each page/feature before moving on.

The testing sequence (from Master.md §16.3):
1. **Phase 1 — Shell & Navigation:** Fresh load → screenshot(look at it and think) → hover each nav item →
   click each nav item → verify keyboard shortcuts → screenshot(look at it and think) after each.
2. **Phase 2 — Feature-Level:** For each page/section: navigate → screenshot(look at it and think) default →
   interact with every button/link/input/toggle → verify hover/click/focus states →
   test form inputs → screenshot(look at it and think) each interaction → test error states.
3. **Phase 3 — Sub-Features:** For nested UI (modals, drawers, tabs-within-tabs):
   open parent → navigate into sub-feature → repeat Phase 2 → verify back/close/escape.
4. **Phase 4 — Responsive:** Test at 375px, 768px, 1280px, 1920px, 2560px+ viewports.
   Screenshot each. Verify layout adapts, no overflow, text readable, touch targets ok.

Evidence requirements:
- Screenshot of initial load state
- Screenshot after each major interaction
- Screenshot of any errors or unexpected states
- Action log: what was clicked, typed, navigated, in order
- Pass/fail summary per feature

Demo requirement (Master.md §16.6):
After testing, provide v3gga a LIVE DEMO he can watch AND MOST IMPORTANT YOU CAN TAKE SCREENSHOTS AT EVERY HOVER EFFECT AND STATE and open sidebar or menus and close menus AND CLICK AND OPEN MODAL CLOSE MODAL THEN YOU LOOK AT SCREENSHOTS AND MAKE CHANGES TO IMPROVE — a visible browser window
with real mouse/keyboard interaction walking through every feature. Not a static
screenshot(look at it and think) gallery. Not a VS Code embedded browser. A real Chrome window.
IF USING TOOLS ETC OPEN RADIAL MENU, MOVE MOUSE TO CORRECT TOOL IN RADIAL MENU...

This applies to ALL visual test scripts in the project and any future ones.

Cross-Platform
All code must execute cleanly on Windows, macOS, and Linux.
Avoid platform-specific logic unless it is properly detected and handled.

