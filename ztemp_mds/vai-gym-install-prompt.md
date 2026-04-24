# INSTALL: Vai Training Gymnasium

## Prompt to paste into your VS Code Claude agent chat:

---

```
I have a new React component to integrate: the Vai Training Gymnasium. It's a training system where Vai practices responding to realistic scenarios and gets graded by the Anthropic API across 6 dimensions (accuracy, compression, foundation-fit, anti-pattern avoidance, vetle-alignment, actionability). It tracks progress persistently.

Here is what I need you to do:

## 1. GET THE FILE

The component source is at: vai-training-gymnasium.jsx
(I will paste it or attach it — it's a single ~650 line React component with zero external dependencies beyond React)

## 2. PLACE IT

Create these files in the project:

- `src/components/vai/VaiGym.tsx` — the main component (convert from JSX to TSX, add proper types)
- `src/app/vai/gym/page.tsx` — route wrapper (or wherever routes live in our framework — find the pattern, follow it)
- `src/lib/vai-gym-storage.ts` — storage adapter (see step 4)
- `src/app/api/vai/grade/route.ts` — API endpoint for grading (see step 3)
- `src/app/api/vai/generate/route.ts` — API endpoint for scenario generation (see step 3)

Before creating any files: READ the existing codebase structure first. Find how other routes and components are organized. Follow that exact pattern. Do not invent a new structure.

## 3. REPLACE DIRECT API CALLS WITH BACKEND ROUTES

The component currently calls `fetch("https://api.anthropic.com/v1/messages")` directly from the client. That won't work in production — the API key can't be exposed client-side.

Create two API routes that proxy these calls:

**POST /api/vai/grade**
- Receives: `{ scenario, response }` from the client
- Calls Anthropic API server-side using our ANTHROPIC_API_KEY env var
- Returns the grading result
- Use `claude-sonnet-4-5-20250514` as the model
- Keep the exact system prompt and user prompt from the component's `gradeResponse` function

**POST /api/vai/generate**  
- Receives: `{ foundation, difficulty }` from the client
- Calls Anthropic API server-side
- Returns the generated scenario
- Keep the exact system prompt and user prompt from the component's `generateScenario` function

Then update the component to call `/api/vai/grade` and `/api/vai/generate` instead of the Anthropic API directly.

## 4. REPLACE STORAGE

The component uses `window.storage` (a Claude artifacts API). Replace with one of these depending on what we already use:

- If we have a database (Supabase, Prisma, etc): store progress in a `vai_gym_progress` table/collection
- If not: use localStorage as a simple fallback

Create a storage adapter at `src/lib/vai-gym-storage.ts`:

```ts
export async function loadProgress(): Promise<VaiGymProgress | null> { ... }
export async function saveProgress(data: VaiGymProgress): Promise<void> { ... }
```

The component should import from this adapter instead of calling window.storage directly.

## 5. STYLING

The component uses inline styles (it was built for Claude artifacts). You have two options — pick whichever matches our codebase patterns:

**Option A (preferred if we use Tailwind):** Convert inline styles to Tailwind classes. Follow our existing Tailwind patterns. Dark mode first. Zinc base. Green/purple accents per Master.md Section 4.

**Option B (if inline styles are fine):** Keep them but extract the `styles` object to a separate file or co-located styles.

Either way: make sure it matches our app's existing visual language. Dark background (#0a0b0f or our equivalent), zinc text, indigo accents. Check Master.md Section 4 (Styling System) and Section 15 (Software Quality Standards).

## 6. ENSURE VAI/OPUS CAN ACCESS IT

The gym needs to be accessible to AI agents in two ways:

**Via browser (for visual testing):** The route must be navigable — Puppeteer/Playwright can open it, interact with it, take screenshots. Make sure the page works standalone without requiring auth (or add a bypass for dev/testing).

**Via API (for programmatic training):** The `/api/vai/grade` and `/api/vai/generate` endpoints should work with simple POST requests so Vai can run training sessions programmatically without a browser. Consider adding a third endpoint:

**POST /api/vai/train**
- Receives: `{ foundation?, difficulty? }`  
- Picks or generates a scenario, auto-generates a response using Vai's current system prompt, grades it, saves progress
- Returns the full result (scenario, response, grade)
- This lets Vai self-train in batch — run 10 sessions overnight, review results in the morning

## 7. TYPES

Add proper TypeScript types for everything. At minimum:

```ts
interface VaiGymProgress {
  totalSessions: number;
  totalScore: number;
  foundationScores: Record<string, { attempts: number; totalScore: number; bestScore: number }>;
  antiPatternDodges: Record<string, { encountered: number; dodged: number }>;
  history: SessionEntry[];
  streaks: { current: number; best: number };
  level: "apprentice" | "journeyman" | "expert" | "master";
  lastSession: string | null;
}

interface SessionEntry {
  date: string;
  foundation: string;
  difficulty: string;
  score: number;
  scenario: string;
}

interface GradeResult {
  scores: Record<string, number>;
  overall: number;
  feedback: string;
  anti_patterns_triggered: string[];
  strengths: string[];
  improvements: string[];
}

interface Scenario {
  foundation: string;
  difficulty: string;
  situation: string;
  hidden_need: string;
  ideal_traits: string[];
  anti_pattern_traps: string[];
  grading_rubric: string;
}
```

## 8. AFTER INTEGRATION

Once the files are created:

1. Run `pnpm dev` and verify the route loads
2. Open Puppeteer/Playwright and navigate to the gym route
3. Take a screenshot — verify it looks like 2026, not 2002 (Master.md Section 15.1)
4. Click through: Dashboard → select a scenario → verify the training view loads
5. Type a test response → submit → verify the API route calls work and grading returns
6. Check that progress saves and persists on page reload
7. Test responsive behavior at 375px, 768px, 1280px, 1920px
8. Screenshot each state as evidence (Master.md Section 16)

DO NOT skip the visual test. DO NOT report "done" without screenshots. Two sets of eyes.

## IMPORTANT CONTEXT

Read Master.md before starting. Specifically:
- Section 3 (Core Philosophies — especially Performance and Craftsmanship)
- Section 4 (Styling System — theme, hover effects, always alive)
- Section 5 (Development Flow — branch discipline)
- Section 15 (Software Quality Standards — the 2026→2030 baseline)
- Section 16 (Visual Testing Protocol — the full sequence)

The gym is Vai's training system. Treat it with the same quality bar as any production feature. Every interactive element needs hover/focus/active states. The design must match our app's visual language. Performance matters.
```

---

## What to do:

1. Copy everything between the ``` marks above
2. Open your VS Code Claude agent chat
3. Paste the component file (vai-training-gymnasium.jsx) first, or attach it
4. Paste this prompt after it
5. Let the agent work

## What the agent will create:

```
src/
├── components/vai/
│   └── VaiGym.tsx              ← Main component (TSX, typed, styled to match your app)
├── lib/
│   └── vai-gym-storage.ts      ← Storage adapter (DB or localStorage)
├── app/
│   ├── vai/gym/
│   │   └── page.tsx            ← Route wrapper
│   └── api/vai/
│       ├── grade/route.ts      ← Grading endpoint (proxies Anthropic API)
│       ├── generate/route.ts   ← Scenario generation endpoint
│       └── train/route.ts      ← Self-training endpoint (Vai trains itself)
```

## The self-training endpoint is the key unlock

The `/api/vai/train` endpoint is what makes this truly powerful. Once it exists, you (or Vai itself via Claude Code or Copilot) can run:

```bash
# Train Vai on 10 random scenarios
for i in $(seq 1 10); do
  curl -X POST http://localhost:3000/api/vai/train \
    -H "Content-Type: application/json" \
    -d '{"difficulty":"journeyman"}'
done

# Train on a specific weakness
curl -X POST http://localhost:3000/api/vai/train \
  -H "Content-Type: application/json" \
  -d '{"foundation":"systems-thinking","difficulty":"expert"}'

# Overnight batch: train 50 sessions across all foundations
for f in first-principles calibrated-uncertainty meta-learning reading-between-lines precision-communication right-question compression systems-thinking taste-judgment intellectual-honesty; do
  for i in $(seq 1 5); do
    curl -X POST http://localhost:3000/api/vai/train \
      -H "Content-Type: application/json" \
      -d "{\"foundation\":\"$f\",\"difficulty\":\"journeyman\"}"
    sleep 2
  done
done
```

Then open the gym dashboard in the morning and review the scores, patterns, and weak spots.
