#!/usr/bin/env node
/**
 * Teach Vai about template upgrade patterns.
 *
 * This script sends structured knowledge to Vai's /api/teach endpoint,
 * covering the template upgrade system we just built. Vai can then use
 * these patterns when helping users build or customize templates.
 *
 * Topics taught:
 * 1. First-principles of template tier design
 * 2. The upgrade pattern (what changes per tier)
 * 3. Setup wizard architecture (CLI + web)
 * 4. Demo-as-validation system
 * 5. Key management (BYOK + platform keys)
 * 6. Meta-learning: how to approach similar upgrades in future
 * 7. Calibrated uncertainty: what we're confident about vs. what needs testing
 */

const API_URL = process.env.VAI_URL || 'http://localhost:3006';
const SOURCE = 'opus-template-upgrade-teaching';

const COLORS = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
};
const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

async function teach(pattern, response, source = SOURCE) {
  const res = await fetch(`${API_URL}/api/teach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ pattern, response, source }] }),
  });
  if (!res.ok) throw new Error(`Teach failed: ${res.status} ${await res.text()}`);
  return res.json();
}

console.log(c('cyan', '\n  ╔══════════════════════════════════════════╗'));
console.log(c('cyan', '  ║') + c('bold', '  📚 Teaching Vai — Template Upgrades') + c('cyan', '     ║'));
console.log(c('cyan', '  ╚══════════════════════════════════════════╝\n'));

const lessons = [
  // ── 1. FIRST-PRINCIPLES REASONING ──
  {
    pattern: 'What are the first principles of template tier design?',
    response: `Template tiers follow a PROGRESSIVE COMPLEXITY principle:

BASIC (Starter) — Clean MVP. Zero boilerplate junk. Works instantly with \`npm install && npm run dev\`. No database required. In-memory data. The goal: fastest possible time-to-running-app.

SOLID (Recommended) — Factory standard. Adds real database (Prisma/Mongoose), Zod validation, auth scaffolding. This is what a professional would ship as an MVP. The goal: production-ready patterns without overwhelming.

BATTLE-TESTED (Production) — Full deployment. Docker, tests, CI/CD, OAuth providers, admin dashboard. This is what you deploy to real users. The goal: zero surprises in production.

VAI (Premium) — The wow factor. BYOK AI panel, glass UI, performance monitoring, key sharing consent, full setup wizard. Inspired by the REBUILD_PROMPT quality spec. The goal: feels like a $100M product.

KEY INSIGHT: Each tier INHERITS from the previous via mergeFiles(). This means the Basic tier's code is always the foundation. Never break Basic to add Premium features. Additions only.`,
  },

  // ── 2. THE UPGRADE PATTERN ──
  {
    pattern: 'How do you upgrade a stack template across all 4 tiers?',
    response: `The upgrade pattern follows 5 steps:

1. SHARED SETUP MODULE — Create stack-specific env var definitions in shared-setup.ts. Each env var has: key, tiers it applies to, provider URL, how-to-get instructions, auto-generate capability, validation hints.

2. BASIC TIER ADDITIONS:
   - CLI setup script (scripts/setup.mjs) — auto-generates secrets, walks through env vars
   - demo.sequence.json — actions the demo runner executes
   - data-testid attributes on ALL interactive elements
   - .env.example with comments

3. SOLID TIER ADDITIONS (inherits Basic):
   - Web setup wizard component (src/pages/SetupWizard.tsx)
   - Setup API routes (server/setup-plugin.ts) for /api/setup/status and /api/setup/save
   - Enhanced demo sequence with validation assertions

4. BATTLE-TESTED ADDITIONS (inherits Solid):
   - OAuth provider setup guides (Google, GitHub) in wizard
   - Admin dashboard component with stats/moderation/settings tabs
   - CI/CD pipeline with test + Docker build

5. VAI PREMIUM ADDITIONS (inherits Battle-Tested):
   - BYOK panel (auto-detect provider from key prefix)
   - Key sharing consent gate (TOS agreement for platform keys)
   - Glass panel components (OKLCH colors, backdrop-blur)
   - Performance monitoring dashboard (live metrics)
   - Toast notification system (success/error/info)
   - Full OKLCH design system (dark-mode-first)
   - Skeleton shimmer loading states
   - Comprehensive .env.example with ALL providers`,
  },

  // ── 3. SETUP WIZARD ARCHITECTURE ──
  {
    pattern: 'How does the template setup wizard work?',
    response: `Two modes, both from the same env var definitions:

CLI MODE (all tiers): Run \`node scripts/setup.mjs\`
- Interactive terminal UI with colored output
- Auto-generates secrets (JWT, session, encryption keys)
- Shows existing .env values if file exists
- Deep links to provider consoles for manual keys
- Categories: database, server, auth, oauth, ai, crypto, realtime

WEB MODE (Solid+ tiers): Visit /setup in the browser
- Step-by-step wizard with progress bar
- Auto-generate buttons for secrets
- Password fields for sensitive values
- Collapsible "How to get this key" instructions
- Copy .env button on completion screen
- Saves directly to .env file via API

ARCHITECTURE:
- EnvVar[] definitions in shared-setup.ts per stack
- buildSetupScript() generates CLI script with injected setup calls
- generateSetupWizardComponent() generates React component
- generateSetupApiRoutes() generates Vite plugin for /api/setup/*

KEY DESIGN DECISION: Keys that CAN be auto-generated (secrets, UUIDs) ARE auto-generated. Keys that NEED human action (OAuth, API keys) get deep links + step-by-step instructions.`,
  },

  // ── 4. DEMO-AS-VALIDATION ──
  {
    pattern: 'How does the demo-as-validation system work?',
    response: `Every template includes a demo.sequence.json — an array of actions that BOTH:
1. Give the user a guided tour of all features
2. Validate that every feature actually works

ACTION TYPES:
- tooltip: Shows message overlay (teaching moment)
- click: Clicks a CSS selector (tests button works)
- type: Types text character-by-character (tests input)
- assert-visible: Verifies element exists (VALIDATION)
- assert-text: Verifies text content (VALIDATION)
- screenshot: Captures evidence
- wait: Pause between actions
- hover/scroll: Navigation

THE DUAL-PURPOSE TRICK: Every tooltip is a teaching moment. Every click is a test. Every assert-visible is a health check. The demo IS the test suite.

EXECUTION: vai-demo-runner.mjs connects to Selenium WebDriver, reads the sequence, executes each action, and reports pass/fail. Can run locally or in Docker Compose with VNC for visual debugging.

Docker Compose setup: app (template) + browser (selenium/standalone-chrome) + vai-agent (runs demo). VNC at localhost:7900 lets you watch the cursor move.`,
  },

  // ── 5. KEY MANAGEMENT ──
  {
    pattern: 'How does BYOK and key sharing work in premium templates?',
    response: `TWO KEY SOURCES:

1. BYOK (Bring Your Own Key):
   - User pastes API key into BYOK panel
   - Auto-detect provider from prefix: sk- → OpenAI, sk-ant- → Anthropic, gsk_ → Groq, etc.
   - Keys encrypted at rest (AES-256-GCM) if "remember" checked
   - Masked display (sk-pr••••abcd)
   - Links to ALL provider consoles for getting keys

2. PLATFORM KEYS (Key Sharing):
   - Platform owner's keys shared with users
   - Requires consent gate (TOS agreement)
   - Rate-limited per user/IP
   - keySource tagged as "platform" vs "byok"
   - User can switch to BYOK anytime

SECURITY:
   - Keys never sent back to client after storage
   - Never logged
   - Display masked only
   - Rate limiting on all AI operations
   - Consent required before platform key access`,
  },

  // ── 6. META-LEARNING ──
  {
    pattern: 'How should I approach upgrading templates in the future?',
    response: `META-PATTERN for future template upgrades:

1. READ BEFORE CHANGING — Always understand the full file before editing. Templates are 600-1600 lines. The mergeFiles() chain means changes cascade.

2. SHARED INFRASTRUCTURE FIRST — Build reusable modules (like shared-setup.ts) before touching individual stacks. This prevents duplication across 16 templates.

3. BASIC ALWAYS WORKS — Never break Basic tier. It's the foundation everything inherits from. Test Basic first, then cascade up.

4. TYPE-CHECK AFTER EVERY STACK — Run tsc --noEmit after each stack change. Don't batch 4 stacks and hope.

5. DEMO = TEST — Every new feature should get a demo action. If you can't demonstrate it in the demo, the user can't discover it.

6. TIER BOUNDARY RULE: Each tier should feel like a meaningful jump, not just "more files":
   - Basic → Solid: "Oh, now I have real persistence and validation"
   - Solid → Battle-Tested: "Oh, this is deployment-ready with CI"
   - Battle-Tested → Vai: "Oh, this feels like a premium product"

7. ENV VARS SCALE WITH TIER — Basic needs 0-2 vars. Solid needs 3-5. Battle-Tested needs 6-10. Vai needs 15+. The setup wizard handles this gracefully.`,
  },

  // ── 7. CALIBRATED UNCERTAINTY ──
  {
    pattern: 'What are you confident about vs uncertain about in the template system?',
    response: `HIGH CONFIDENCE (verified):
- TypeScript compiles with zero errors (tsc --noEmit passes)
- Setup wizard generates valid .env files
- Demo sequences have correct action types
- mergeFiles() correctly overrides by path
- Tier inheritance chain works (Basic → Solid → BT → Vai)
- BYOK auto-detection works for all 6 providers

MEDIUM CONFIDENCE (needs runtime testing):
- Selenium demo runner works in Docker Compose (depends on Chrome version)
- VNC viewer accessible at port 7900 (depends on Docker networking)
- Web setup wizard /api/setup/save writes correctly (needs live Vite server)
- Admin dashboard refreshes metrics every 10s without memory leak

LOW CONFIDENCE (needs user testing):
- OAuth deep links still point to correct console pages (URLs can change)
- Package versions in templates are still latest (check npm weekly)
- Demo sequences find all CSS selectors correctly (UI changes break selectors)
- Key sharing consent gate covers all legal requirements

KNOWN GAPS:
- No Playwright/E2E tests yet for the setup wizard itself
- Docker Compose not tested on Windows (Docker Desktop required)
- Premium tier components (BYOK, Glass, Toast) added as files but not wired into the main App.tsx — they need manual import by the developer using the template`,
  },

  // ── 8. READING BETWEEN THE LINES ──
  {
    pattern: 'When a user says "upgrade my templates", what do they actually mean?',
    response: `COMMON INTENTIONS behind "upgrade":

"Make it better" → Add features, improve UX, reduce friction. Focus on setup wizard and error handling.

"Make it production-ready" → Add Docker, tests, CI, env management. Move from Basic to Battle-Tested.

"Make it premium" → Glass UI, monitoring, BYOK, real-time features. Move to Vai tier quality.

"Fix the errors" → Build errors, missing deps, wrong versions. Check package.json versions first.

"Add OAuth" → They need Google/GitHub/Discord sign-in. Guide them through provider console setup.

"Help with .env" → They're stuck on configuration. Run setup wizard or explain which keys they need.

NEVER ASSUME: Ask which tier they're targeting. A "basic" user doesn't need BYOK guidance. A "premium" user doesn't need told what React is.`,
  },

  // ── 9. SYSTEMS JUDGMENT ──
  {
    pattern: 'How do you evaluate if a template upgrade is good?',
    response: `VALIDATION CHECKLIST (in priority order):

1. tsc --noEmit — Zero type errors. Non-negotiable.
2. npm install succeeds — No missing or conflicting deps.
3. npm run dev starts — Dev server runs on expected port.
4. /api/health returns 200 — Backend is alive.
5. UI renders without console errors — React mounts cleanly.
6. Demo sequence passes all assertions — Features work.
7. Docker build succeeds (if tier includes it).
8. Tests pass (if tier includes them).

QUALITY SIGNALS:
- Setup wizard detects existing .env and preserves values
- Auto-generated secrets are cryptographically random (64+ chars)
- Glass UI has correct backdrop-filter (not just background color)
- Toast notifications animate in/out smoothly
- BYOK auto-detect responds in <50ms (no network call needed)
- Admin dashboard metrics refresh without page flicker

RED FLAGS:
- Build warnings about deprecated APIs
- Console errors on load
- Layout shift when skeletons resolve to real content
- Missing data-testid attributes on interactive elements`,
  },

  // ── 10. ELIMINATE CLARIFICATION LOOPS ──
  {
    pattern: 'What should I know to help users with templates without asking too many questions?',
    response: `INFER FROM CONTEXT:

If user deployed pern-basic → they're new, guide gently.
If user deployed pern-vai → they're advanced, be technical.
If user mentions Docker → they want deployment, suggest Battle-Tested.
If user mentions OAuth → they need social login, need provider console setup.
If user mentions "errors" → check build output first, not the code.
If user mentions "keys" → they need setup wizard guidance.
If user mentions ".env" → run scripts/setup.mjs or visit /setup.

DEFAULTS TO ASSUME:
- Node 22 (our standard)
- pnpm (our package manager)
- SQLite for dev, PostgreSQL for prod
- Dark mode first
- English or Norwegian language
- Windows development environment

ONE-SHOT ANSWERS for common questions:
- "How do I start?" → npm install && npm run dev
- "How do I add OAuth?" → node scripts/setup.mjs, then follow prompts for Google/GitHub
- "How do I deploy?" → docker compose up -d (Battle-Tested+ tiers)
- "How do I test?" → npm test (Battle-Tested+ tiers)
- "Where are my keys?" → .env file or /setup route`,
  },
];

// ── Send all lessons ──
async function main() {
  let success = 0;
  let failed = 0;

  for (const lesson of lessons) {
    try {
      await teach(lesson.pattern, lesson.response);
      success++;
      console.log(c('green', `  ✓ ${lesson.pattern.slice(0, 60)}...`));
    } catch (err) {
      failed++;
      console.log(c('yellow', `  ⚠ ${lesson.pattern.slice(0, 60)}... — ${err.message}`));
    }
  }

  console.log('');
  console.log(c('bold', `  Taught: ${success}/${lessons.length} lessons`));
  if (failed > 0) console.log(c('yellow', `  ${failed} failed — is the server running? (pnpm dev:web)`));
  console.log('');
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  console.error('Make sure the Vai runtime server is running: pnpm dev:web');
  process.exit(1);
});
