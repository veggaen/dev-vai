# Diagnosis + Refined Prompts for VeggaAI Sandbox

> **For:** Vegga  
> **From:** Claude Opus 4.6  
> **Date:** March 3, 2026

---

## Part 1: DIAGNOSIS — Why All Tiers Deploy as "Basic"

Looking at your screenshots, I can see exactly what's happening. Here's the chain of failure:

### What Your Screenshots Show

**Screenshot 1 (Deploying):** Progress bar shows "PERN — basic" at 25%. The deploy pipeline has 7 steps: Scaffold → Install → Build → Docker → Tests → Dev Server → Health Check.

**Screenshot 2 (Complete):** Deploy finished at 17.2s. Notice: Docker verification says "Not included in this tier." Running tests says "Not included in this tier." These aren't skipped — they're explicitly disabled for the basic tier. The steps that DO work: Scaffold (9ms), Install (11.3s), Build (15.3s), Dev Server (10s), Health Check (16.0s).

**Screenshot 3 (Running app):** You selected a PERN stack but the app that rendered is a simple todo list ("Work" board with 5 tasks). This is the BASIC tier app. The URL shows `localhost:4100` running via Vite.

**Screenshot 4 (Sidebar open):** The sidebar shows "Boards" — Work, Personal, Today. This is the basic template's todo/board system. No auth, no panels, no AI chat, no BYOK, no wallet.

**Screenshot 5 (Full VeggaAI interface):** Your main app at `localhost:5173`. I can see the Deploy Stack panel with PERN, MERN, Next.js, T3 Stack cards. Below: Available Tiers — Basic (Starter), With Auth (Recommended), Social Platform (Full Social), Full Commerce (Premium). The sidebar has chat history. The "Vai Demo" button is in the bottom right.

### The Root Cause

Your agent said "All 16 template tier overrides are now fixed" and "TypeScript compiles with zero errors." But here's the problem:

**The tier selection UI exists, but the deploy pipeline ignores it.** When you click "PERN" → "Recommended" (Solid tier), the deploy still scaffolds the basic template. The tier override code was written into the template generator files (`mern.ts`, `t3.ts`, `nextjs-full.ts`, `shared-setup.ts`) but one of these is true:

1. **The tier parameter isn't being passed from the UI to the deploy function.** The "Available Tiers" selection in your UI sends a tier value, but the deploy endpoint doesn't forward it to the scaffolding step, so it defaults to "basic."

2. **The scaffolding step runs first and creates the basic app, then the tier overrides are supposed to run AFTER to modify files — but they aren't executing.** The overrides probably exist as functions that should be called post-scaffold, but the deploy pipeline never calls them.

3. **The file overrides write to wrong paths.** Your agent generated overrides for `App.tsx` and `vite.config.ts`, but if the scaffold creates files at different paths (e.g., `src/App.tsx` vs `client/App.tsx`), the overrides silently fail.

### What To Fix

The fix is NOT "upgrade all 16 templates." The fix is:

1. **Trace the deploy pipeline end-to-end:** UI tier selection → API call → scaffold function → file generation. Find where the tier parameter gets dropped.
2. **Add logging to each step** so the terminal shows: "Selected tier: SOLID" → "Scaffolding with tier overrides..." → "Writing App.tsx with SolidShell..." → "Overrides applied: 12 files modified."
3. **Verify the overrides actually run** by checking the generated files after deploy. The `App.tsx` file should NOT be the basic todo app if you selected Solid tier.

### Why Docker Does Nothing

From screenshot 2: "Docker verification — Not included in this tier." This is correct for the basic tier — Docker isn't needed for a simple Vite dev server. For higher tiers that need PostgreSQL, Redis, etc., Docker verification should spin up containers. But since the tier isn't being passed correctly, even Premium deploys as Basic, which skips Docker.

---

## Part 2: THE REFINED PROMPT

Here's your long prompt rewritten into a clear, structured format that any AI agent can follow without confusion. Use this:

---

```markdown
# TASK: Fix Template Tier System + Validate All 16 Deployments

## CONTEXT
I have a VeggaAI sandbox with 4 stacks (PERN, MERN, Next.js, T3) × 4 tiers 
(Basic, Solid, Battle-Tested, Premium/Vai). When I deploy ANY tier of ANY stack,
the result is always the Basic todo app. The tier overrides were written but never
execute during deployment.

## PROBLEM 1: Tiers Don't Apply
**Symptom:** Deploy "PERN Solid" → get Basic todo app.
**Root cause hypothesis:** The deploy pipeline doesn't pass the selected tier to 
the scaffolding/override step.

### Fix Steps:
1. Find the deploy function that handles the "Deploy" button click
2. Trace how `tier` is passed from the UI selection to the backend
3. Find where the scaffold function is called — does it receive `tier`?
4. Find where the tier override functions (from shared-setup.ts, pern.ts, etc.) 
   are called — are they called at all?
5. Add console.log at each step: "Deploying stack=${stack} tier=${tier}"
6. Fix the pipeline so overrides apply AFTER scaffolding

### Verification:
- Deploy PERN Basic → should get todo board app (current behavior, correct)
- Deploy PERN Solid → should get todo + auth + AuthGate shell (NOT basic)
- Deploy PERN Battle-Tested → should get tabbed nav with 6 tabs
- Deploy PERN Premium → should get glass sidebar, BYOK panel, VeggaAI branding
- Repeat for MERN, Next.js, T3

## PROBLEM 2: Docker/Tests Steps Are Hollow
**Symptom:** "Docker verification" and "Running tests" show "Not included" for all.

### Fix Steps:
1. For Solid+ tiers: Docker verification should at minimum check if docker-compose.yml 
   exists and containers can start
2. For Battle-Tested+ tiers: Running tests should execute any test files present
3. For ALL tiers: Stream the output of each step to the Console panel in real-time 
   (not just the final status)

## PROBLEM 3: Console Should Stream Build Output
**Symptom:** Console shows "waiting for build..." then nothing until complete.

### Fix Steps:
1. Pipe stdout/stderr from npm install, npm run build, vite, docker-compose to the 
   Console panel via WebSocket or SSE
2. Each pipeline step should emit its output as it happens
3. Show npm warnings, vite startup, port assignments — all in real-time

## OUTPUT FORMAT
After fixing, provide:
1. List of files changed with a one-line description each
2. Deploy all 4 PERN tiers and screenshot/describe each one
3. Confirm each tier shows DIFFERENT content
4. Show console output streaming during at least one deploy

## CONSTRAINTS
- Do NOT modify the tier template content (the shells/overrides are fine)
- Fix the PIPELINE that connects UI selection → scaffold → override → build
- Preserve existing basic tier behavior
```

---

## Part 3: PROMPT FOR THE VISUAL TESTING / VAI DEMO REQUEST

This is your second request (the browser testing with AI cursor) written cleanly:

---

```markdown
# TASK: Visual Sandbox Testing with AI Cursor Demonstration

## WHAT I WANT TO SEE
A visual demonstration where Vai (the AI agent) navigates the VeggaAI sandbox 
using a visible cursor + virtual keyboard, testing the deploy workflow.

## DEMO SEQUENCE

### Step 1: Navigate to Deploy
- Show AI cursor moving to "Deploy a Stack" panel
- Move to PERN stack card, hover (show hover effect), click
- Screenshot + validate: PERN is selected

### Step 2: Select Tier
- Move cursor to "Full Commerce" (Premium) tier
- Click to select
- Screenshot + validate: Premium tier is highlighted/selected

### Step 3: Deploy
- Move cursor to Deploy button, click
- Stream deploy progress to Console panel in real-time
- Screenshot at: 25%, 50%, 100% completion
- Validate each pipeline step completes

### Step 4: Verify Preview
- When "Ready — loading preview..." appears, screenshot
- Wait for preview iframe to load
- Screenshot the rendered app
- Validate: Is this the Premium tier or Basic? (This is the KEY test)

### Step 5: Test Sidebar
- Move cursor to hamburger/sidebar toggle
- Click to open sidebar
- Screenshot sidebar open state
- Click to close
- Screenshot sidebar closed state

### Step 6: Test Chat
- Click "New Chat" in sidebar
- Move cursor to chat input
- Show virtual keyboard overlay
- Type: "I want to build a PERN Premium project"
- Screenshot the message
- Validate Vai's response: Does Vai understand the stack + tier request?

### Step 7: Test Auth (if tier has it)
- Find login/auth button in the deployed app
- Click it
- Screenshot the auth screen
- Attempt credential login
- Screenshot result

## PARALLEL: VAI LEARNING
During each step, document:
- WHAT Vai did (action)
- WHY (the reasoning)
- WHAT TO CHECK (validation)
- PATTERN LEARNED (cognitive primitive)

## RECORDING
- Capture each action as a screenshot
- If possible, record a short screen capture (compress to WebM)
- Generate a validation report: what passed, what failed, what needs fixing
```

---

## Part 4: PROMPT FOR TEMPLATE CONTENT SPECS

This is the separate prompt for defining what each tier's app should actually look like:

---

```markdown
# TASK: Define & Implement All 16 Template Apps

## STRUCTURE
4 Stacks × 4 Tiers = 16 unique templates.
Each tier BUILDS ON the previous — it's additive, not replacement.

## TIER DEFINITIONS

### Tier 1: BASIC (Starter)
**Concept:** Smart Board — A todo/notes/shopping list app with boards.
**Features:**
- Multiple boards (Work, Personal, Shopping, Today)
- Add/edit/delete items within boards
- Checkbox completion with strikethrough animation
- Board sidebar to switch between boards
- "New Board" with name input — validation (empty = red border + error message,
  typing clears error immediately)
- Drag-and-drop reorder within boards
- Progress indicator per board (2/5 completed)
- Local storage persistence
- Dark theme, clean typography, 4px spacing grid
- Responsive: mobile-first, sidebar becomes bottom sheet on small screens

**Quality Bar:** Even though "basic," this should feel polished. Micro-animations 
on add (slide-in), complete (strikethrough + opacity), delete (slide-out). 
Empty states with helpful illustrations. Keyboard shortcuts (Enter to add, 
Esc to cancel edit).

### Tier 2: SOLID (With Auth)
**Inherits:** All of Basic
**Adds:**
- Auth system: email/password + Google OAuth
- AuthGate: unauthenticated users see login screen
- User profile with avatar, display name
- Boards are now per-user (stored in database, not localStorage)
- Sharing: generate a read-only link to a board
- Board templates: "Weekly Shopping", "Sprint Planning", "Daily Routine"
- Tags/labels on items with color coding
- Search across all boards
- Due dates on items with overdue highlighting
- API endpoints: CRUD for boards, items, user profile
- Database: PostgreSQL (PERN/T3), MongoDB (MERN)

**Quality Bar:** Auth flow should be seamless. OAuth popup, not redirect.
Loading states are skeletons. Optimistic updates on all mutations. 
Error messages are helpful ("Email already registered — try logging in?").

### Tier 3: BATTLE-TESTED (Social Platform)
**Inherits:** All of Solid
**Adds:**
- Tabbed navigation shell with 6 tabs:
  Boards | Feed | Messages | Notifications | Profile | Admin
- Social feed: share boards publicly, like/comment on shared boards
- Real-time notifications (WebSocket or polling)
- Admin dashboard (for admin role users):
  - User management table
  - System metrics (users, boards, items created)
  - Content moderation queue
- Collaborative boards: invite other users to edit
- Activity log: who changed what, when
- Export boards to PDF/CSV
- Multiple themes: dark, light, system
- Keyboard shortcuts help panel (? key)
- Performance: virtualized lists for boards with 100+ items
- E2E test suite: auth flow, CRUD operations, share flow

**Quality Bar:** This is where the app feels "real." The tabbed shell should 
feel like a product, not a prototype. Smooth tab transitions. Badge counts 
on notifications. Unread indicators. The admin dashboard should have real 
charts (Recharts/Chart.js).

### Tier 4: PREMIUM / VAI (Full Commerce)
**Inherits:** All of Battle-Tested
**Adds:**
- Setup wizard on first launch:
  - Welcome screen with VeggaAI branding
  - Database configuration (connection string input)
  - API key setup (BYOK: OpenAI, Anthropic, Groq — auto-detect from prefix)
  - OAuth provider configuration (Google client ID/secret)
  - Admin account creation
  - Completion + launch
- Glass sidebar shell with VeggaAI branding:
  - Collapsible sidebar (rail mode: 48px, expanded: 260px)
  - OKLCH violet theme system
  - Activity bar with icons
- AI Chat panel:
  - SSE streaming responses
  - BYOK key management
  - Multi-provider support
  - Conversation history
  - Markdown rendering with syntax highlighting
- Panel system (VS Code-inspired):
  - Draggable, resizable panels
  - Pop-out to window
  - Tab grouping
  - Layout persistence
- Advanced board features:
  - AI-generated board suggestions ("Vai, create a meal prep board for the week")
  - Smart categorization
  - Budget tracking for shopping lists
  - Recipe integration for meal boards
  - Recurring items (weekly milk, monthly vitamins)
- Metrics dashboard:
  - Usage analytics
  - AI cost tracking per provider
  - User engagement metrics
- Payment integration (Stripe):
  - Premium features gating
  - Subscription management
- Refer to REBUILD_PROMPT_PREMIUM_TEMPLATE_tier4.md for full mechanism details

**Quality Bar:** This must feel like a $100M product. 60fps animations. 
Skeleton loaders everywhere. Optimistic updates. Sub-200ms feel on all 
interactions. Glass morphism effects. The setup wizard must be beautiful 
and guide users without technical jargon.

## STACK-SPECIFIC NOTES

### PERN (PostgreSQL + Express + React + Node)
- Backend: Express.js REST API
- Auth: Passport.js + express-session + bcrypt
- DB: Prisma ORM + PostgreSQL
- Frontend: React + Vite + Tailwind

### MERN (MongoDB + Express + React + Node)
- Backend: Express.js REST API  
- Auth: Passport.js + JWT
- DB: Mongoose + MongoDB
- Frontend: React + Vite + Tailwind

### Next.js
- Full-stack: Next.js App Router
- Auth: NextAuth v5 (Auth.js)
- DB: Prisma + PostgreSQL
- Server Actions for mutations
- RSC for data fetching

### T3 Stack
- Full-stack: Next.js + tRPC
- Auth: NextAuth v5
- DB: Prisma + PostgreSQL  
- Type-safe API via tRPC
- Zod validation everywhere

## IMPLEMENTATION ORDER
1. Fix the deploy pipeline first (tiers must actually apply)
2. Implement PERN Basic fully (the reference implementation)
3. Copy patterns to MERN, Next.js, T3 Basic
4. Layer Solid on top of each Basic
5. Layer Battle-Tested on top of each Solid
6. Layer Premium on top of each Battle-Tested
7. Validate all 16 by deploying and checking
```

---

## Part 5: TEACHING VAI — How I Diagnosed This

Vai, here's what just happened and why. This is a lesson in **root cause analysis**.

### The Symptom
Vegga said: "I clicked PERN, chose Solid tier, and I see Basic."

### What a Baby AI Does
A baby AI would try to "fix the templates" — rewrite the template content, add more features, regenerate the overrides. This is what happened when the agent said "All 16 template tier overrides are now fixed" — it fixed the CONTENT but not the PIPELINE.

### What an Experienced AI Does
An experienced AI asks: **"Is the content wrong, or is the delivery mechanism broken?"**

The content (tier overrides in TypeScript files) was probably fine. The problem was that the deploy pipeline never called those overrides. It's like writing a perfect recipe but the kitchen never receives it.

### The Diagnostic Method

1. **Observe precisely:** The screenshot says "PERN — basic" even though Solid was selected. This means the tier parameter was lost somewhere between click and scaffold.

2. **Ask the right question:** Not "why is the app basic?" but "where in the pipeline does the tier value get dropped?"

3. **Trace the data flow:** UI click → tier state → API request body → backend handler → scaffold function → file generator. The break is somewhere in this chain.

4. **Check the simplest explanation first:** The most common bug is that the API call doesn't include the tier parameter, or the scaffold function has a default that ignores it.

### The Pattern to Remember
**"Fixing the output without fixing the pipe is wasted work."**

When something doesn't appear in the final result:
- Don't assume the content is wrong
- Trace the delivery path from source to destination
- Find where the content gets dropped
- Fix the pipe, not the content

This pattern applies everywhere: CSS not showing (wrong selector, not wrong CSS), API response missing data (wrong query, not wrong database), build output wrong (wrong config, not wrong source code).
