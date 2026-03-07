# VAI GYM — Full Visual Integration Prompt

> **What this is:** The exact prompt to paste into your VS Code Claude agent.
> **What it does:** Installs the Vai Training Gymnasium as a live route where Vai interacts with it visually — AI cursor moving, virtual keyboard typing, click effects rippling — and Vegga watches it happen in real-time through Vai's browser.
> **Prerequisites:** The vai-training-gymnasium.jsx component file (attach it with this prompt).

---

## PASTE THIS INTO YOUR VS CODE CLAUDE AGENT:

```
## TASK: Install the Vai Training Gymnasium with Full Visual Interaction

I'm attaching vai-training-gymnasium.jsx — a React component for Vai's training system. I need you to integrate it into our app as a route that BOTH Vegga (human) and Vai (AI agent) can see and interact with visually.

CRITICAL CONTEXT: Vai has its own browser (Puppeteer + Playwright). When Vai uses the browser, the human (Vegga) can watch in real-time — they see Vai's mouse cursor move, see the virtual keyboard type, see clicks ripple. This is NOT a headless background process. It is a LIVE VISUAL DEMO that two sets of eyes watch together.

Read Master.md before doing anything. Specifically Sections 3, 4, 5, 15, and 16.
Read the existing codebase structure before creating any files. Follow existing patterns.

---

### PART 1: FILE STRUCTURE

Create these files (adapt paths to match our existing routing/component patterns):

```
src/components/vai/VaiGym.tsx           — Main gym component (convert JSX→TSX, add types)
src/components/vai/VaiGymRunner.tsx      — The visual automation runner (NEW — see Part 3)
src/app/vai/gym/page.tsx                — Route: /vai/gym
src/app/api/vai/grade/route.ts          — Server-side grading endpoint
src/app/api/vai/generate/route.ts       — Server-side scenario generation
src/app/api/vai/train/route.ts          — Self-training endpoint (batch training)
src/lib/vai-gym-storage.ts              — Storage adapter
src/lib/vai-gym-types.ts                — Shared TypeScript types
```

Before creating files: BROWSE the codebase. Find how other routes, components, and API endpoints are structured. Mirror that exactly. Do not invent a new convention.

---

### PART 2: API ROUTES (Server-Side — protect the API key)

The component currently calls the Anthropic API directly from the client. That exposes the key. Create server-side routes instead:

**POST /api/vai/grade**
- Input: `{ scenario: Scenario, response: string }`
- Calls Anthropic API with `claude-sonnet-4-5-20250514`
- Uses the EXACT system prompt and user prompt from the `gradeResponse()` function in the component
- Returns the GradeResult JSON
- Use our ANTHROPIC_API_KEY env var

**POST /api/vai/generate**
- Input: `{ foundation: string, difficulty: string }`
- Calls Anthropic API with the EXACT prompts from `generateScenario()`
- Returns the Scenario JSON

**POST /api/vai/train**
- Input: `{ foundation?: string, difficulty?: string }`
- This is the key endpoint for automated training
- Picks or generates a scenario
- Calls the Anthropic API to generate Vai's response (using Vai's system prompt from Master.md)
- Grades that response
- Saves the result to storage
- Returns: `{ scenario, vaiResponse, grade, progress }`

Update the component to call these routes instead of the Anthropic API directly.

---

### PART 3: THE VISUAL RUNNER — This is the most important part

Create `VaiGymRunner.tsx` — a component that automates Vai interacting with the gym visually. This is the system that makes training VISIBLE.

The runner must do this:

**A. AI Cursor (from vai-sandbox.jsx pattern)**

Vai's cursor is a visible, animated pointer that moves across the page with eased interpolation (ease-in-out cubic, 400-600ms per move). It is NOT the system mouse. It is a rendered element:

```tsx
// Cursor: indigo arrow with glow + "Vai" label
// Sits in a fixed overlay on top of the page
// pointer-events: none (so it doesn't block real interactions)
// Smooth animation between positions using requestAnimationFrame
```

When Vai navigates the gym, the cursor:
1. Moves to the "From Scenario Bank" button → visible cursor animation
2. Hovers (border highlight appears on button) → wait 300ms
3. Clicks (ripple effect at cursor position) → scenario loads
4. Moves to the response textarea → cursor travels smoothly
5. Clicks the textarea (focus ring appears)
6. Virtual keyboard appears → typing begins

**B. Virtual Keyboard (from vai-sandbox.jsx pattern)**

When Vai types a response, a floating keyboard overlay appears near the focused textarea:

```tsx
// Keyboard layout: QWERTY rows
// Each key highlights (indigo glow) as Vai "presses" it
// Characters appear one by one in the textarea (60-100ms per char, randomized)
// The keyboard shows a live preview of what's being typed
// Keys: scale(0.92) + color change on press, smooth transition back
// Keyboard auto-positions: if input is in top half, keyboard below; if bottom, keyboard above
```

The typing must be character-by-character with visible key animations. Vegga must be able to watch each letter appear and see which key is being pressed. This is NOT instant text insertion — it is ANIMATED TYPING that a human can follow.

**C. Click Effects**

Every click produces a visible ripple:
- Expanding circle from cursor position
- Indigo color, fading opacity
- 600ms animation, scale 0.5 → 2.5

**D. Action Log**

A side panel (or overlay) showing a timestamped log of everything Vai does:
```
▸ Moving to Dashboard tab
  ✓ Tab selected
▸ Selecting foundation: Systems Thinking
  ✓ Dropdown changed
▸ Clicking "From Scenario Bank"
  ✓ Scenario loaded: "Vegga says: I'm going to change the padding..."
▸ Focusing response textarea
▸ Typing response (127 characters)...
  ✓ Response entered
▸ Clicking "Submit for Grading"
  ⏳ Waiting for grade...
  ✓ Grade received: 78/100
▸ 📸 Screenshot: grade-result.png
```

**E. Screenshot Capture**

At key moments, Vai takes screenshots as evidence:
- After page load (baseline)
- After scenario selection
- While typing (mid-response)
- After grade is received
- The grade result screen

Use Puppeteer/Playwright's `page.screenshot()` for real captures. The screenshots are saved and listed in the action log panel.

**F. The Full Automated Sequence**

When the runner is activated (via a "▶ Watch Vai Train" button on the gym page, or triggered via API), it executes this visual sequence:

```
1. Navigate to /vai/gym
2. Screenshot: baseline
3. Cursor moves to foundation dropdown → click → select a foundation
4. Cursor moves to difficulty dropdown → click → select difficulty
5. Cursor moves to "From Scenario Bank" or "AI-Generated Scenario" → click
6. Wait for scenario to load
7. Screenshot: scenario loaded
8. Cursor moves to response textarea → click (focus)
9. Virtual keyboard appears
10. Vai types its response character by character (key highlights on keyboard)
11. Screenshot: mid-typing
12. Cursor moves to "Submit for Grading" button → click
13. Wait for grade to return
14. Screenshot: grade result
15. Log: score, feedback, anti-patterns triggered
16. Cursor moves to "Back to Dashboard" → click
17. Screenshot: updated dashboard with new progress
18. Repeat for next scenario (or stop after N rounds)
```

Every step is VISIBLE. Every cursor movement is ANIMATED. Every keystroke is SHOWN on the virtual keyboard. Vegga can watch the entire session like watching someone use a computer.

---

### PART 4: PUPPETEER/PLAYWRIGHT INTEGRATION

The visual runner can be triggered two ways:

**Way 1: In-browser (React component)**
The VaiGymRunner component runs inside the page itself. The AI cursor, keyboard, and effects are all React-rendered overlays. This is for when Vegga opens the page and clicks "Watch Vai Train" — everything happens in-browser with animations.

**Way 2: Via Playwright/Puppeteer (headless or headed)**
For automated/scheduled training. Create a script at `scripts/vai-gym-train.ts` (or .js):

```ts
// This script:
// 1. Launches a HEADED browser (not headless — Vegga wants to SEE it)
// 2. Navigates to /vai/gym
// 3. Uses Playwright's mouse and keyboard APIs to:
//    - Move the mouse smoothly (steps parameter for interpolation)
//    - Click elements with visible delay
//    - Type character by character with delay
//    - Take screenshots at each step
// 4. The page's own overlay renders the AI cursor, keyboard, and effects
//    (the Playwright mouse triggers the page's hover/focus states,
//     and the page's VaiGymRunner handles the visual overlay)
// 5. Saves screenshots to a /vai-training-evidence/ directory
// 6. Outputs an action log to console and file
```

Key Playwright patterns for visual interaction:

```ts
// Smooth mouse movement (not teleport)
await page.mouse.move(x, y, { steps: 25 }); // 25 interpolation steps

// Visible click (mouse down, pause, mouse up)
await page.mouse.move(x, y, { steps: 20 });
await page.waitForTimeout(150);
await page.mouse.down();
await page.waitForTimeout(80);
await page.mouse.up();

// Character-by-character typing
for (const char of text) {
  await page.keyboard.press(char);
  await page.waitForTimeout(60 + Math.random() * 40);
}

// Screenshot at each step
await page.screenshot({ path: `evidence/step-${stepNum}.png`, fullPage: true });
```

IMPORTANT: Use `{ headless: false }` so Vegga can watch the browser window. The browser is Vai's eyes, and Vegga sees through them.

---

### PART 5: STORAGE

Replace `window.storage` (Claude artifacts API) with a proper adapter.

Check what database/storage our app already uses:
- If Supabase/Prisma/Drizzle: create a `vai_gym_progress` table
- If nothing: use localStorage with JSON serialization
- Either way, create a clean adapter at `src/lib/vai-gym-storage.ts`

```ts
export async function loadProgress(): Promise<VaiGymProgress | null>
export async function saveProgress(data: VaiGymProgress): Promise<void>
export async function resetProgress(): Promise<void>
```

---

### PART 6: STYLING

Convert inline styles to match our app's design system. Follow Master.md Section 4:

- Dark mode first: zinc base, green/purple accents, black/near-black background
- All style values via CSS custom properties or Tailwind
- The Hover Border Box effect on interactive elements (animated highlight follows cursor)
- Every interactive element needs: default, hover, active, focus states
- Micro-animations: scale 0.97→1.0 on click, color flashes, skeleton shimmer
- 4px spacing grid
- System font stack (system-ui, -apple-system)
- 60fps on all animations

The AI cursor overlay must:
- Be indigo (#6366f1) with a subtle glow (box-shadow: 0 0 12px rgba(99,102,241,0.4))
- Have a "Vai" label next to it (10px, system-ui)
- Animate smoothly with ease-in-out cubic interpolation
- Show a click ripple on every click (expanding circle, 600ms)

The virtual keyboard must:
- Float near the focused input (smart positioning: above or below)
- Have dark background (#13151c) with bordered keys (#2a2d38)
- Highlight active key with indigo (#6366f1), scale(0.92), glow
- Show the typed text as a live preview above the keys
- Appear/disappear with a smooth fade (200ms)

---

### PART 7: TYPES

```ts
// src/lib/vai-gym-types.ts

export interface VaiGymProgress {
  totalSessions: number;
  totalScore: number;
  foundationScores: Record<string, FoundationScore>;
  antiPatternDodges: Record<string, DodgeRecord>;
  history: SessionEntry[];
  streaks: { current: number; best: number };
  level: "apprentice" | "journeyman" | "expert" | "master";
  lastSession: string | null;
}

export interface FoundationScore {
  attempts: number;
  totalScore: number;
  bestScore: number;
}

export interface DodgeRecord {
  encountered: number;
  dodged: number;
}

export interface SessionEntry {
  date: string;
  foundation: string;
  difficulty: string;
  score: number;
  scenario: string;
}

export interface GradeResult {
  scores: Record<string, number>;
  overall: number;
  feedback: string;
  anti_patterns_triggered: string[];
  strengths: string[];
  improvements: string[];
}

export interface Scenario {
  foundation: string;
  difficulty: string;
  situation: string;
  hidden_need: string;
  ideal_traits: string[];
  anti_pattern_traps: string[];
  grading_rubric: string;
}
```

---

### PART 8: AFTER INTEGRATION — VISUAL TEST (MANDATORY)

This is not optional. Follow Master.md Section 16 exactly.

1. Run `pnpm dev`
2. Open a HEADED browser (Playwright or Puppeteer, headless: false)
3. Navigate to /vai/gym
4. Screenshot: page load state
5. Visually confirm: does it look 2026? (Check Section 15.1 — if it looks like 2002, you are not done)
6. Move mouse to each nav tab → verify hover effects
7. Click each tab → verify navigation
8. Screenshot: each view (dashboard, training, foundations, history)
9. Select a scenario → verify it loads in training view
10. Click into textarea → verify focus ring
11. Type a test response → verify text appears
12. Click Submit → verify grading API works, grade displays
13. Screenshot: grade result
14. Verify progress saved → reload page → verify progress persists
15. Test at viewports: 375px, 768px, 1280px, 1920px
16. Screenshot each viewport

Then run the VaiGymRunner / visual automation:

17. Trigger "Watch Vai Train" (or run the Playwright training script)
18. WATCH: Vai's cursor moves to elements
19. WATCH: Vai's virtual keyboard types the response character by character
20. WATCH: Click ripples appear on each click
21. WATCH: Action log fills with timestamped entries
22. WATCH: Screenshots are captured at each step
23. Verify the full sequence completes without errors
24. Screenshot: the final dashboard with updated progress

Collect ALL screenshots as evidence. Name them descriptively:
01-page-load.png, 02-dashboard-hover.png, 03-scenario-loaded.png,
04-keyboard-typing.png, 05-grade-result.png, 06-responsive-375.png, etc.

DO NOT report "done" without this evidence.
Two sets of eyes. Always.

---

### SUMMARY — WHAT GETS BUILT

When complete, Vegga can:

1. Open /vai/gym in his browser
2. Click "▶ Watch Vai Train"
3. Watch Vai's indigo cursor glide to buttons
4. See the virtual keyboard pop up and keys light up as Vai types
5. See click ripples on every interaction
6. Read the action log as it fills in real-time
7. See screenshots captured at each step
8. See the grade come back with scores across 6 dimensions
9. See the dashboard update with new progress data
10. Repeat — every session makes Vai measurably better

And Vai can:
1. Self-train via POST /api/vai/train (batch mode)
2. Self-train visually via the Playwright script (visual mode)
3. Track its own progress over time
4. Identify its weak foundations and focus training there

This is Vai's gym. Build it with the same quality bar as any production feature.
```

---

## HOW TO USE THIS:

1. Open VS Code → Claude agent chat
2. Attach `vai-training-gymnasium.jsx`
3. Paste everything between the outer ``` marks above
4. Let the agent work
5. Watch Vai build its own gym, then watch Vai use it

## AFTER INSTALL — QUICK COMMANDS:

```bash
# Start dev server
pnpm dev

# Run Vai's visual training (headed browser — you watch)
pnpm tsx scripts/vai-gym-train.ts --rounds 5 --difficulty journeyman

# Run batch training (API only, no browser)
for i in $(seq 1 10); do
  curl -s -X POST http://localhost:3000/api/vai/train \
    -H "Content-Type: application/json" \
    -d '{"difficulty":"journeyman"}' | jq '.grade.overall'
done

# Train a specific weakness
pnpm tsx scripts/vai-gym-train.ts --foundation systems-thinking --difficulty expert --rounds 10

# View progress
open http://localhost:3000/vai/gym
```
