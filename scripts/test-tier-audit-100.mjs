#!/usr/bin/env node
/**
 * VAI TIER AUDIT — 100 Questions Testing Stack & Tier Knowledge
 * ═══════════════════════════════════════════════════════════════
 *
 * Tests Vai's understanding of:
 *   1. Greeting recognition (casual/informal)
 *   2. Stack identity (PERN vs MERN vs Next.js vs T3)
 *   3. Tier progression (Basic → Solid → Battle-Tested → Vai)
 *   4. Tier-specific features (Docker, tests, Prisma, Zod, CI/CD)
 *   5. Cross-stack comparison
 *   6. Context retention (follow-ups)
 *   7. Off-topic handling (every 5th question)
 *
 * For EVERY wrong answer, the script sends 4 corrections to Vai
 * and re-asks to test learning capacity.
 *
 * Usage: node scripts/test-tier-audit-100.mjs
 */
import WebSocket from 'ws';

const API = 'http://localhost:3006';
const WS_URL = 'ws://localhost:3006/api/chat';
const TIMEOUT = 20_000;

/* ═══════════════ Chat Helper ═══════════════ */

async function chatWithVai(conversationId, message) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let response = '';
    let gotDone = false;
    ws.on('open', () => ws.send(JSON.stringify({ conversationId, content: message })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'text_delta' && msg.textDelta) response += msg.textDelta;
      else if (msg.type === 'done') { gotDone = true; ws.close(); }
      else if (msg.type === 'error') { ws.close(); reject(new Error(msg.error)); }
    });
    ws.on('close', () => resolve(response || '[no response]'));
    ws.on('error', (err) => reject(err));
    setTimeout(() => { if (!gotDone) { ws.close(); resolve(response || '[timeout]'); } }, TIMEOUT);
  });
}

async function createConv(title) {
  const res = await fetch(`${API}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, modelId: 'vai:v0' }),
  });
  return (await res.json()).id;
}

/* ═══════════════ 100 Questions ═══════════════ */

const questions = [
  // ── 1-5: GREETING RECOGNITION ──────────────────────────────────
  {
    id: 1, cat: 'greeting', q: 'oyoy',
    expect: 'Should recognize as informal greeting and respond with a greeting back',
    keywords: ['hey', 'hi', 'hello', 'sup', 'yo', 'what', 'how'],
    corrections: [
      '"oyoy" is a casual Norwegian greeting like "hey" or "yo"',
      'A good response would be: "Hey! What can I help you with?"',
      'Do not treat greetings as knowledge queries — just greet back',
      'Norwegian informal speech includes: oyoy, myyh, fese, ey, yo, sup',
    ],
  },
  {
    id: 2, cat: 'greeting', q: 'myyh',
    expect: 'Should recognize as informal greeting',
    keywords: ['hey', 'hi', 'hello', 'sup', 'yo', 'what', 'how'],
    corrections: [
      '"myyh" is a lazy/casual Norwegian greeting meaning "hey" or "what\'s up"',
      'The correct response is a simple greeting, not a knowledge search',
      'Vai should have a greeting handler that catches informal words',
      'Never return "I don\'t have knowledge about that" for greetings',
    ],
  },
  {
    id: 3, cat: 'greeting', q: 'fese?',
    expect: 'Should recognize as informal greeting/question',
    keywords: ['hey', 'hi', 'hello', 'good', 'fine', 'what'],
    corrections: [
      '"fese" is Norwegian slang for "what\'s up?" or "how\'s it going?"',
      'A natural response would be: "All good! What can I do for you?"',
      'This is NOT a factual question — it\'s a social greeting',
      'Norwegian chatbot should understand local slang',
    ],
  },
  {
    id: 4, cat: 'greeting', q: 'ey yo what up',
    expect: 'Should recognize as casual greeting',
    keywords: ['hey', 'hi', 'hello', 'sup', 'what', 'good', 'help'],
    corrections: [
      '"ey yo what up" is clearly a casual English greeting',
      'Correct: respond with enthusiasm matching the user\'s energy',
      'Never search DuckDuckGo for greeting-like messages',
      'A chatbot should ALWAYS have a greeting fallback',
    ],
  },
  {
    id: 5, cat: 'off-topic', q: 'What year was the Eiffel Tower built?',
    expect: 'Should answer 1887-1889',
    keywords: ['1887', '1889', 'paris', 'gustave'],
    corrections: [
      'The Eiffel Tower was built between 1887-1889',
      'It was designed by Gustave Eiffel\'s engineering company',
      'It was built for the 1889 World\'s Fair in Paris',
      'It is 330 meters tall and was the world\'s tallest structure until 1930',
    ],
  },

  // ── 6-10: PERN STACK IDENTITY ──────────────────────────────────
  {
    id: 6, cat: 'pern-identity', q: 'What does PERN stand for?',
    expect: 'PostgreSQL, Express, React, Node.js',
    keywords: ['postgresql', 'express', 'react', 'node'],
    corrections: [
      'PERN = PostgreSQL + Express + React + Node.js',
      'PostgreSQL is a relational SQL database, not MongoDB',
      'PERN is NOT the same as T3 — T3 uses tRPC + Next.js',
      'PERN uses Express.js as the backend framework, not Next.js API routes',
    ],
  },
  {
    id: 7, cat: 'pern-identity', q: 'What database does the PERN stack use?',
    expect: 'PostgreSQL',
    keywords: ['postgresql', 'postgres', 'sql', 'relational'],
    corrections: [
      'PERN uses PostgreSQL — a powerful open-source relational database',
      'PostgreSQL supports JSON/JSONB, full-text search, and extensions',
      'The "P" in PERN stands for PostgreSQL',
      'PERN does NOT use MongoDB — that would be MERN',
    ],
  },
  {
    id: 8, cat: 'pern-tiers', q: 'What tier levels does the PERN stack have?',
    expect: 'Basic, Solid, Battle-Tested, Vai',
    keywords: ['basic', 'solid', 'battle', 'vai'],
    corrections: [
      'PERN has 4 tiers: Basic, Solid, Battle-Tested, and Vai',
      'Basic = minimal starter, Solid = Prisma+Zod, Battle-Tested = Docker+tests+CI, Vai = premium monitoring',
      'Each tier builds on the previous with mergeFiles()',
      'All 4 stacks (PERN, MERN, Next.js, T3) share the same tier structure',
    ],
  },
  {
    id: 9, cat: 'pern-tiers', q: 'What does PERN Basic tier include?',
    expect: 'Task board manager, in-memory storage, inline edit, Framer Motion',
    keywords: ['task', 'board', 'inline', 'edit', 'react', 'memory'],
    corrections: [
      'PERN Basic is a board task manager with inline editing',
      'It uses in-memory storage (no database), React 19 + TypeScript + Tailwind v4',
      'Features: multiple boards, sidebar nav, drag-to-reorder, long-press edit, click-to-toggle',
      'Has Framer Motion spring animations and mobile-first responsive design',
    ],
  },
  {
    id: 10, cat: 'off-topic', q: 'Who invented the telephone?',
    expect: 'Alexander Graham Bell',
    keywords: ['alexander', 'graham', 'bell', '1876'],
    corrections: [
      'Alexander Graham Bell patented the telephone in 1876',
      'Some credit Antonio Meucci as an earlier inventor',
      'Bell demonstrated the first practical telephone',
      'The patent was filed on February 14, 1876',
    ],
  },

  // ── 11-15: PERN TIER PROGRESSION ──────────────────────────────
  {
    id: 11, cat: 'pern-tiers', q: 'What does PERN Solid tier add over Basic?',
    expect: 'Prisma ORM, Zod validation, User model, JWT auth scaffolding',
    keywords: ['prisma', 'zod', 'validation', 'orm'],
    corrections: [
      'PERN Solid adds Prisma ORM with Board+Todo+User models',
      'It adds Zod validation on ALL inputs (create, update, reorder)',
      'Has JWT_SECRET in .env.example for auth scaffolding',
      'Switches from in-memory to SQLite (dev) via Prisma, swappable to PostgreSQL',
    ],
  },
  {
    id: 12, cat: 'pern-tiers', q: 'What does PERN Battle-Tested add over Solid?',
    expect: 'Docker, docker-compose, Vitest tests, GitHub Actions CI/CD, PostgreSQL',
    keywords: ['docker', 'test', 'ci', 'vitest'],
    corrections: [
      'Battle-Tested adds Dockerfile + docker-compose.yml with PostgreSQL 16',
      'Includes Vitest tests for validation and data model',
      'Has GitHub Actions CI workflow (.github/workflows/ci.yml)',
      'Switches database from SQLite to PostgreSQL in docker-compose',
    ],
  },
  {
    id: 13, cat: 'pern-tiers', q: 'What makes PERN Vai tier special?',
    expect: 'Performance monitoring, ErrorBoundary, useApi hook, optimized Docker',
    keywords: ['monitor', 'error', 'boundary', 'docker', 'optimized'],
    corrections: [
      'PERN Vai adds server/monitor.ts — performance monitoring middleware',
      'Includes a React ErrorBoundary component for graceful error handling',
      'Has a custom useApi() hook for type-safe API calls',
      'Uses a 3-stage optimized Dockerfile with non-root user and healthcheck',
    ],
  },
  {
    id: 14, cat: 'pern-comparison', q: 'Does PERN Basic have Docker? What about testing?',
    expect: 'No Docker, no tests in Basic',
    keywords: ['no', 'basic', 'docker', 'test'],
    corrections: [
      'PERN Basic has NO Docker and NO tests — it\'s a minimal starter',
      'Docker is only added at the Battle-Tested tier',
      'Tests (Vitest) are only added at Battle-Tested tier',
      'Basic is meant to get running in seconds with zero configuration',
    ],
  },
  {
    id: 15, cat: 'off-topic', q: 'What is the largest planet in our solar system?',
    expect: 'Jupiter',
    keywords: ['jupiter'],
    corrections: [
      'Jupiter is the largest planet in our solar system',
      'Jupiter is a gas giant with a diameter of about 139,820 km',
      'It has at least 95 known moons, including the four Galilean moons',
      'Jupiter\'s Great Red Spot is a storm larger than Earth',
    ],
  },

  // ── 16-20: MERN STACK ─────────────────────────────────────────
  {
    id: 16, cat: 'mern-identity', q: 'What does MERN stand for?',
    expect: 'MongoDB, Express, React, Node.js',
    keywords: ['mongodb', 'express', 'react', 'node'],
    corrections: [
      'MERN = MongoDB + Express + React + Node.js',
      'The "M" is MongoDB — a document-oriented NoSQL database',
      'MERN is NOT the same as PERN — PERN uses PostgreSQL instead of MongoDB',
      'MERN is good for document-driven data models and rapid prototyping',
    ],
  },
  {
    id: 17, cat: 'mern-tiers', q: 'What is the MERN Basic tier app?',
    expect: 'Bookmark collection manager with inline editing, tags, search',
    keywords: ['bookmark', 'collection', 'tag', 'search'],
    corrections: [
      'MERN Basic is a bookmark collection manager',
      'Features: collections sidebar, tags, pin/unpin, fulltext search',
      'Has inline edit with pencil icon + long-press + haptic vibration',
      'Uses Framer Motion animations and optimistic updates',
    ],
  },
  {
    id: 18, cat: 'mern-tiers', q: 'What does MERN Solid add?',
    expect: 'Zod validation schemas on all inputs',
    keywords: ['zod', 'validation', 'schema'],
    corrections: [
      'MERN Solid adds Zod validation schemas (CreateBookmarkSchema, UpdateBookmarkSchema)',
      'URL validation, length limits, and partial update support',
      'Still uses in-memory storage but with strict input validation',
      'No auth in MERN at any tier — unlike PERN which has User model at Solid',
    ],
  },
  {
    id: 19, cat: 'mern-tiers', q: 'Does MERN have authentication at any tier?',
    expect: 'No, MERN has no auth at any tier',
    keywords: ['no', 'auth'],
    corrections: [
      'MERN has NO authentication at any tier',
      'Only PERN has auth scaffolding (User model + JWT_SECRET at Solid tier)',
      'Neither Next.js nor T3 have auth either in the current templates',
      'Auth could be added as a custom enhancement',
    ],
  },
  {
    id: 20, cat: 'off-topic', q: 'How many continents are there?',
    expect: '7 continents',
    keywords: ['7', 'seven'],
    corrections: [
      'There are 7 continents: Africa, Antarctica, Asia, Australia, Europe, North America, South America',
      'Some models count 5 or 6 by merging Americas or Europe/Asia',
      'The 7-continent model is the most widely taught',
      'The largest continent is Asia, the smallest is Australia/Oceania',
    ],
  },

  // ── 21-25: NEXT.JS STACK ──────────────────────────────────────
  {
    id: 21, cat: 'nextjs-identity', q: 'What makes the Next.js stack different from PERN and MERN?',
    expect: 'Uses Next.js App Router with Server Components, file-based routing, not Express',
    keywords: ['app router', 'server component', 'file', 'routing'],
    corrections: [
      'Next.js stack uses the App Router with React Server Components',
      'It has file-based routing instead of Express.js routes',
      'API routes are in src/app/api/ directory, not a separate server',
      'No separate Express server needed — everything runs in Next.js',
    ],
  },
  {
    id: 22, cat: 'nextjs-tiers', q: 'What is the Next.js Basic tier app?',
    expect: 'Notes dashboard with inline editing, categories, stats',
    keywords: ['notes', 'dashboard', 'categor', 'stats'],
    corrections: [
      'Next.js Basic is a notes dashboard with inline editing',
      'Features: category badges, stats cards, search, in-memory API routes',
      'Uses GET/POST/PATCH/DELETE API routes for CRUD operations',
      'Has Framer Motion animations and mobile-first design',
    ],
  },
  {
    id: 23, cat: 'nextjs-tiers', q: 'How many files does Next.js Basic have?',
    expect: '11 files',
    keywords: ['11'],
    corrections: [
      'Next.js Basic has 11 files: package.json, tsconfig.json, postcss.config.mjs, next.config.ts, layout.tsx, globals.css, utils.ts, page.tsx, api/notes/route.ts, api/notes/[id]/route.ts, api/health/route.ts',
      'This is more than PERN Basic (8 files) because Next.js needs layout, globals, etc.',
      'The API routes follow Next.js App Router conventions',
      'Health check endpoint is included even at the Basic tier',
    ],
  },
  {
    id: 24, cat: 'nextjs-tiers', q: 'What does the Next.js Vai tier add over Battle-Tested?',
    expect: 'Optimized Docker (3-stage, non-root, healthcheck), vai.config.ts',
    keywords: ['docker', 'optimized', 'vai.config', 'healthcheck'],
    corrections: [
      'Next.js Vai adds 4 file overrides: package.json, Dockerfile, vai.config.ts, README.md',
      'The Dockerfile is 3-stage with non-root user and healthcheck',
      'vai.config.ts has serverComponents: true and edgeReady: true',
      'Compared to PERN Vai, the Next.js Vai is less feature-rich (no monitor.ts, no ErrorBoundary, no useApi hook)',
    ],
  },
  {
    id: 25, cat: 'off-topic', q: 'What programming language was Git written in?',
    expect: 'C',
    keywords: ['c ', 'c language', 'written in c'],
    corrections: [
      'Git was written in C by Linus Torvalds',
      'It was created in 2005 for Linux kernel development',
      'Git is free and open source under the GPL license',
      'The name "git" is British slang for a silly person',
    ],
  },

  // ── 26-30: T3 STACK ───────────────────────────────────────────
  {
    id: 26, cat: 't3-identity', q: 'What is the T3 stack and who created it?',
    expect: 'Type-safe fullstack — tRPC, Prisma, Tailwind. Created by Theo (t3.gg)',
    keywords: ['trpc', 'type', 'safe', 'theo'],
    corrections: [
      'T3 Stack was created by Theo (t3.gg) for end-to-end type safety',
      'Core: Next.js + tRPC + Prisma/Drizzle + Tailwind + NextAuth + TypeScript',
      'In Vai\'s template system, T3 uses tRPC-style typed procedures',
      'T3 is the only stack with Zod validation even at Basic tier (tRPC requires it)',
    ],
  },
  {
    id: 27, cat: 't3-tiers', q: 'What is the T3 Basic tier app?',
    expect: 'Expense tracker with tRPC procedures, category breakdown',
    keywords: ['expense', 'tracker', 'trpc', 'category'],
    corrections: [
      'T3 Basic is an expense tracker with tRPC-style typed procedures',
      'Has 6 endpoints, category breakdown chart with color bars',
      'Stats cards: total spending, count, top category, average',
      'Unique: T3 Basic already has Zod validation (tRPC requires it natively)',
    ],
  },
  {
    id: 28, cat: 't3-tiers', q: 'How does T3 Basic differ from PERN Basic?',
    expect: 'T3 has tRPC with Zod, PERN has Express REST. Different apps (expense vs task board)',
    keywords: ['trpc', 'expense', 'task', 'zod'],
    corrections: [
      'T3 Basic is an expense tracker, PERN Basic is a task board manager',
      'T3 has tRPC with Zod even at Basic, PERN only gets Zod at Solid tier',
      'T3 uses src/trpc.ts for a typed client, PERN uses standard fetch/API calls',
      'Both share: React 19 + TypeScript + Tailwind v4 + Framer Motion + inline editing',
    ],
  },
  {
    id: 29, cat: 't3-tiers', q: 'What does T3 Solid add?',
    expect: 'Prisma ORM with DB-backed procedures',
    keywords: ['prisma', 'database', 'db'],
    corrections: [
      'T3 Solid adds Prisma ORM — switches from in-memory to database-backed procedures',
      'Uses SQLite for development (swappable to PostgreSQL)',
      'tRPC procedures now query Prisma instead of in-memory arrays',
      'Adds prisma/schema.prisma, package.json updates, server/plugin.ts rewrite, .env.example',
    ],
  },
  {
    id: 30, cat: 'off-topic', q: 'What is the speed of sound in meters per second?',
    expect: 'Approximately 343 m/s at 20°C',
    keywords: ['343', '340', 'meter'],
    corrections: [
      'The speed of sound in air at 20°C is approximately 343 m/s',
      'It varies with temperature, humidity, and medium',
      'Sound travels faster in water (~1480 m/s) and steel (~5960 m/s)',
      'The speed of sound at sea level is also known as Mach 1',
    ],
  },

  // ── 31-35: CROSS-STACK COMPARISON ─────────────────────────────
  {
    id: 31, cat: 'cross-stack', q: 'Which is the only stack that has auth scaffolding in its templates?',
    expect: 'PERN (User model + JWT at Solid tier)',
    keywords: ['pern', 'user', 'jwt', 'auth'],
    corrections: [
      'Only PERN has auth scaffolding — a User model in Prisma + JWT_SECRET at Solid tier',
      'MERN has no auth at any tier',
      'Next.js has no auth at any tier',
      'T3 has no auth at any tier — despite the "real" T3 stack including NextAuth',
    ],
  },
  {
    id: 32, cat: 'cross-stack', q: 'Do all 4 stacks have the same tier structure?',
    expect: 'Yes, all have Basic → Solid → Battle-Tested → Vai',
    keywords: ['basic', 'solid', 'battle', 'vai', 'same', 'all', 'yes'],
    corrections: [
      'Yes, all 4 stacks (PERN, MERN, Next.js, T3) share the same 4-tier structure',
      'Basic → Solid → Battle-Tested → Vai is the universal progression',
      'Each tier builds on the previous using mergeFiles()',
      'No stacks have comingSoon flags — all tiers are available',
    ],
  },
  {
    id: 33, cat: 'cross-stack', q: 'Which stacks use Docker at Battle-Tested tier?',
    expect: 'All 4 stacks',
    keywords: ['all', 'pern', 'mern', 'next', 't3'],
    corrections: [
      'ALL 4 stacks add Docker at the Battle-Tested tier',
      'PERN/Next.js/T3 use docker-compose with PostgreSQL 16',
      'MERN uses docker-compose with MongoDB 7',
      'All include multi-stage Dockerfile + docker-compose.yml',
    ],
  },
  {
    id: 34, cat: 'cross-stack', q: 'Which Vai tier is the most feature-rich?',
    expect: 'PERN Vai — has monitor.ts, ErrorBoundary, useApi hook',
    keywords: ['pern', 'monitor', 'error', 'boundary'],
    corrections: [
      'PERN Vai is the richest — it adds 8 file overrides including server/monitor.ts, ErrorBoundary, useApi hook',
      'The other 3 Vai tiers only add 4 overrides: Dockerfile + vai.config.ts + README + package.json',
      'PERN Vai has performance monitoring middleware that others lack',
      'Next.js/MERN/T3 Vai tiers are relatively thin compared to PERN Vai',
    ],
  },
  {
    id: 35, cat: 'off-topic', q: 'Who wrote "To Kill a Mockingbird"?',
    expect: 'Harper Lee',
    keywords: ['harper', 'lee'],
    corrections: [
      'Harper Lee wrote "To Kill a Mockingbird" (1960)',
      'It won the Pulitzer Prize for Fiction in 1961',
      'The main characters are Scout Finch and her father Atticus',
      'Lee published one other novel: "Go Set a Watchman" (2015)',
    ],
  },

  // ── 36-40: TIER FEATURES DEEP DIVE ────────────────────────────
  {
    id: 36, cat: 'tier-features', q: 'What ORM do the stacks use at the Solid tier?',
    expect: 'Prisma',
    keywords: ['prisma'],
    corrections: [
      'All stacks use Prisma ORM starting at the Solid tier',
      'Prisma provides type-safe database access with auto-generated client',
      'At Solid tier, Prisma uses SQLite for development',
      'At Battle-Tested tier, it switches to PostgreSQL (PERN/Next.js/T3) or MongoDB (MERN)',
    ],
  },
  {
    id: 37, cat: 'tier-features', q: 'What validation library do the stacks use?',
    expect: 'Zod',
    keywords: ['zod'],
    corrections: [
      'All stacks use Zod for input validation',
      'PERN/MERN/Next.js add Zod at the Solid tier',
      'T3 has Zod from Basic tier because tRPC requires it natively',
      'Zod provides runtime type checking with TypeScript inference',
    ],
  },
  {
    id: 38, cat: 'tier-features', q: 'What testing framework is used and at which tier?',
    expect: 'Vitest, added at Battle-Tested tier',
    keywords: ['vitest', 'battle'],
    corrections: [
      'All stacks use Vitest for testing, added at the Battle-Tested tier',
      'Basic and Solid tiers have NO tests',
      'Battle-Tested includes vitest.config.ts and __tests__/ directory',
      'PERN Vai expands tests with additional monitor and API tests',
    ],
  },
  {
    id: 39, cat: 'tier-features', q: 'What CI/CD tool is included in the templates?',
    expect: 'GitHub Actions',
    keywords: ['github', 'actions'],
    corrections: [
      'GitHub Actions CI is added at the Battle-Tested tier',
      'The workflow file is at .github/workflows/ci.yml',
      'It runs tests and Docker build on push/PR',
      'Basic and Solid tiers have no CI/CD configuration',
    ],
  },
  {
    id: 40, cat: 'off-topic', q: 'What is the boiling point of water at sea level?',
    expect: '100°C or 212°F',
    keywords: ['100', '212'],
    corrections: [
      '100°C (212°F) at standard atmospheric pressure (1 atm)',
      'Higher altitudes have lower boiling points due to less air pressure',
      'Pure water boils at exactly 100°C at sea level',
      'Adding salt raises the boiling point slightly',
    ],
  },

  // ── 41-45: APP-SPECIFIC FEATURES ──────────────────────────────
  {
    id: 41, cat: 'app-features', q: 'What is the common UX pattern across all Basic tier apps?',
    expect: 'Inline edit via pencil icon + long-press (500ms + haptic), Framer Motion, mobile-first',
    keywords: ['inline', 'edit', 'pencil', 'long-press', 'framer'],
    corrections: [
      'All Basic tiers share: inline edit via pencil icon + long-press (500ms + haptic vibration)',
      'Framer Motion spring animations for transitions and reordering',
      'Mobile-first responsive design with React 19 + TypeScript + Tailwind v4',
      'Geist font is the standard across all templates',
    ],
  },
  {
    id: 42, cat: 'app-features', q: 'What does the PERN Basic task board support for drag-and-drop?',
    expect: 'Drag-to-reorder with Framer Motion, tap-to-toggle completion',
    keywords: ['drag', 'reorder', 'tap', 'toggle'],
    corrections: [
      'PERN Basic supports drag-to-reorder tasks using Framer Motion',
      'Click/tap to toggle task completion status',
      'Multiple boards with sidebar navigation',
      'Progress bar showing completion percentage',
    ],
  },
  {
    id: 43, cat: 'app-features', q: 'What search features does MERN Basic have?',
    expect: 'Fulltext search across bookmarks, tag filtering',
    keywords: ['fulltext', 'search', 'tag', 'filter'],
    corrections: [
      'MERN Basic has fulltext search across bookmark titles and descriptions',
      'Tag filtering for organizing bookmarks by category',
      'Pin/unpin bookmarks to keep important ones at top',
      'Collections sidebar for grouping bookmarks',
    ],
  },
  {
    id: 44, cat: 'app-features', q: 'What stats does the T3 expense tracker show?',
    expect: 'Total spending, count, top category, average, category breakdown chart',
    keywords: ['total', 'count', 'category', 'average'],
    corrections: [
      'T3 expense tracker shows: total spending, transaction count, top category, average per transaction',
      'A category breakdown chart with color bars',
      'Stats cards at the top of the dashboard',
      'Inline editing for modifying expense records',
    ],
  },
  {
    id: 45, cat: 'off-topic', q: 'What is photosynthesis?',
    expect: 'Process where plants convert sunlight, CO2, and water into glucose and oxygen',
    keywords: ['plant', 'sunlight', 'carbon', 'oxygen', 'glucose'],
    corrections: [
      'Photosynthesis: 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂',
      'Plants use chlorophyll in chloroplasts to capture light energy',
      'It converts carbon dioxide and water into glucose and oxygen',
      'Without photosynthesis, most life on Earth would not exist',
    ],
  },

  // ── 46-50: DOCKER SPECIFICS ───────────────────────────────────
  {
    id: 46, cat: 'docker', q: 'What version of PostgreSQL do the PERN docker-compose templates use?',
    expect: 'PostgreSQL 16',
    keywords: ['16', 'postgresql'],
    corrections: [
      'PERN, Next.js, and T3 all use PostgreSQL 16 in docker-compose',
      'MERN uses MongoDB 7 instead',
      'The docker-compose.yml defines a db service with postgres:16 image',
      'Includes health check, volume persistence, and env configuration',
    ],
  },
  {
    id: 47, cat: 'docker', q: 'What database does MERN docker-compose use?',
    expect: 'MongoDB 7',
    keywords: ['mongodb', '7', 'mongo'],
    corrections: [
      'MERN docker-compose uses MongoDB 7',
      'This is the only stack that uses a NoSQL database',
      'PERN/Next.js/T3 all use PostgreSQL 16',
      'MongoDB is chosen because MERN stands for MongoDB-Express-React-Node',
    ],
  },
  {
    id: 48, cat: 'docker', q: 'What are the Docker optimizations in Vai tier?',
    expect: '3-stage build, non-root user, healthcheck',
    keywords: ['3-stage', 'non-root', 'healthcheck', 'multi-stage'],
    corrections: [
      'Vai tier Dockerfile uses 3-stage build (deps → build → production)',
      'Runs as non-root user for security',
      'Includes HEALTHCHECK instruction for container monitoring',
      'Smaller final image size compared to Battle-Tested tier Dockerfile',
    ],
  },
  {
    id: 49, cat: 'docker', q: 'Which tier first introduces Docker?',
    expect: 'Battle-Tested',
    keywords: ['battle', 'tested'],
    corrections: [
      'Docker (Dockerfile + docker-compose.yml) is first introduced at Battle-Tested tier',
      'Basic has no Docker',
      'Solid has no Docker',
      'Vai tier improves the Docker config with optimizations',
    ],
  },
  {
    id: 50, cat: 'off-topic', q: 'How many bones does an adult human have?',
    expect: '206 bones',
    keywords: ['206'],
    corrections: [
      'An adult human has 206 bones',
      'Babies are born with about 270 bones that fuse together',
      'The smallest bone is the stapes in the ear',
      'The largest bone is the femur (thigh bone)',
    ],
  },

  // ── 51-55: VAI CONFIG ─────────────────────────────────────────
  {
    id: 51, cat: 'vai-config', q: 'What is vai.config.ts and which tier has it?',
    expect: 'Configuration file for VeggaAI settings, only in Vai tier',
    keywords: ['vai', 'config', 'tier'],
    corrections: [
      'vai.config.ts is a VeggaAI-specific configuration file only in Vai tier',
      'It defines stack-specific settings like monitoring, trpc, prisma flags',
      'Example: T3 Vai has trpc: true, prisma: true, monitoring: true',
      'Next.js Vai has serverComponents: true, edgeReady: true',
    ],
  },
  {
    id: 52, cat: 'vai-config', q: 'What does vai.config.ts contain for the T3 Vai tier?',
    expect: 'trpc: true, prisma: true, monitoring: true',
    keywords: ['trpc', 'prisma', 'monitoring'],
    corrections: [
      'T3 vai.config.ts: trpc: true, prisma: true, monitoring: true',
      'These flags tell VeggaAI what features the template uses',
      'It helps the AI system understand the project capabilities',
      'Each stack has different vai.config.ts settings reflecting its tech',
    ],
  },
  {
    id: 53, cat: 'vai-config', q: 'What does vai.config.ts contain for Next.js Vai?',
    expect: 'serverComponents: true, edgeReady: true',
    keywords: ['servercomponent', 'edgeready', 'edge'],
    corrections: [
      'Next.js vai.config.ts: serverComponents: true, edgeReady: true',
      'serverComponents flag indicates React Server Components are used',
      'edgeReady means the app can run on Vercel Edge Runtime',
      'Different from T3 which focuses on trpc/prisma/monitoring',
    ],
  },
  {
    id: 54, cat: 'pern-vai', q: 'What is the server/monitor.ts file in PERN Vai?',
    expect: 'Performance monitoring middleware for tracking request latency, error rates',
    keywords: ['performance', 'monitoring', 'middleware', 'latency'],
    corrections: [
      'server/monitor.ts is a performance monitoring middleware unique to PERN Vai',
      'It tracks request latency, error rates, and throughput',
      'This is the main differentiator making PERN Vai the richest tier',
      'Other stacks\' Vai tiers don\'t have an equivalent monitoring file',
    ],
  },
  {
    id: 55, cat: 'off-topic', q: 'What is the chemical symbol for gold?',
    expect: 'Au',
    keywords: ['au'],
    corrections: [
      'Au (from Latin "aurum")',
      'Gold has atomic number 79',
      'It is a transition metal in group 11',
      'Gold is one of the least reactive chemical elements',
    ],
  },

  // ── 56-60: TECH STACK DETAILS ─────────────────────────────────
  {
    id: 56, cat: 'tech-detail', q: 'What version of React do the templates use?',
    expect: 'React 19',
    keywords: ['19', 'react'],
    corrections: [
      'All templates use React 19 (^19.0.0)',
      'React 19 brings Server Components, use() hook, and Suspense improvements',
      'The templates use TypeScript with React 19',
      'React 18 is not used in any template',
    ],
  },
  {
    id: 57, cat: 'tech-detail', q: 'What version of Tailwind CSS do the templates use?',
    expect: 'Tailwind v4',
    keywords: ['4', 'tailwind', 'v4'],
    corrections: [
      'All templates use Tailwind CSS v4 with CSS-first configuration',
      'Tailwind v4 uses @theme and CSS variables instead of tailwind.config.js',
      'This is a major change from v3 which used JS config files',
      'The templates include PostCSS and autoprefixer',
    ],
  },
  {
    id: 58, cat: 'tech-detail', q: 'What font do the templates use?',
    expect: 'Geist font',
    keywords: ['geist'],
    corrections: [
      'All templates use the Geist font family by Vercel',
      'Geist Sans for body text and Geist Mono for code',
      'It\'s a modern, clean font designed for developer tools',
      'Loaded via system-ui fallback stack',
    ],
  },
  {
    id: 59, cat: 'tech-detail', q: 'What animation library do all templates use?',
    expect: 'Framer Motion',
    keywords: ['framer', 'motion'],
    corrections: [
      'All templates use Framer Motion for animations',
      'Spring animations for natural, physics-based movement',
      'Used for: drag-to-reorder, page transitions, hover effects, mount/unmount',
      'Framer Motion is the standard animation library in the Vai ecosystem',
    ],
  },
  {
    id: 60, cat: 'off-topic', q: 'In what year did humans first land on the Moon?',
    expect: '1969',
    keywords: ['1969'],
    corrections: [
      'July 20, 1969 — Apollo 11 mission',
      'Neil Armstrong was the first person to walk on the Moon',
      'Buzz Aldrin was the second. Michael Collins orbited in the command module.',
      '"That\'s one small step for man, one giant leap for mankind"',
    ],
  },

  // ── 61-65: MERGEFILES & ARCHITECTURE ──────────────────────────
  {
    id: 61, cat: 'architecture', q: 'How does the tier system build on previous tiers?',
    expect: 'mergeFiles() — each tier overrides/adds files from previous tier',
    keywords: ['merge', 'files', 'override', 'build'],
    corrections: [
      'The mergeFiles() function takes base files and override files',
      'Each tier starts with the previous tier\'s files and adds/replaces',
      'Basic → Solid adds ~4-5 files, Solid → Battle-Tested adds ~7-8 files',
      'Files are matched by path — a file with the same path replaces the old one',
    ],
  },
  {
    id: 62, cat: 'architecture', q: 'Are all stacks and tiers available or are some marked comingSoon?',
    expect: 'All available, none comingSoon',
    keywords: ['all', 'available', 'no', 'none', 'coming'],
    corrections: [
      'All 16 templates (4 stacks × 4 tiers) are available',
      'No comingSoon flags are set anywhere',
      'This means users can scaffold any stack at any tier right now',
      'Custom stacks can also be registered at runtime',
    ],
  },
  {
    id: 63, cat: 'architecture', q: 'Can users create custom stacks in Vai?',
    expect: 'Yes, via registerCustomStack() using CustomStackConfig',
    keywords: ['custom', 'register', 'yes'],
    corrections: [
      'Yes — users can register custom stacks using registerCustomStack()',
      'Custom stack IDs use the format custom-{slug}',
      'The customConfigToStack() function converts user config to a StackDefinition',
      'Custom stacks appear alongside built-in stacks in getAllStacks()',
    ],
  },
  {
    id: 64, cat: 'architecture', q: 'What is the deploy pipeline for scaffolding a project?',
    expect: 'Scaffold → Install → Build → Docker → Test → Start → Health check',
    keywords: ['scaffold', 'install', 'build', 'docker', 'test', 'start', 'health'],
    corrections: [
      'Deploy steps: scaffold → install packages → build → Docker verify → run tests → start dev server → health check',
      'Defined in DEPLOY_STEPS constant in types.ts',
      'Each step has an id and label for UI display',
      'Not all steps apply to Basic tier (no Docker, no tests)',
    ],
  },
  {
    id: 65, cat: 'off-topic', q: 'What is the tallest mountain in the world?',
    expect: 'Mount Everest (8,849m)',
    keywords: ['everest', '8849', '8848'],
    corrections: [
      'Mount Everest at 8,849 meters (29,032 feet)',
      'Located on the border of Nepal and Tibet/China',
      'First summited by Edmund Hillary and Tenzing Norgay in 1953',
      'K2 (8,611m) is the second tallest',
    ],
  },

  // ── 66-70: DATABASE PROGRESSION ───────────────────────────────
  {
    id: 66, cat: 'db-progression', q: 'What database do Basic tier templates use?',
    expect: 'In-memory (no database)',
    keywords: ['memory', 'no database', 'in-memory'],
    corrections: [
      'All Basic tiers use in-memory storage (arrays/objects in server code)',
      'No database connection needed for Basic tier',
      'This allows instant startup without any database setup',
      'Data is lost when the server restarts',
    ],
  },
  {
    id: 67, cat: 'db-progression', q: 'What database do Solid tier templates use?',
    expect: 'SQLite via Prisma (for dev, swappable to PostgreSQL)',
    keywords: ['sqlite', 'prisma'],
    corrections: [
      'Solid tier uses Prisma ORM with SQLite for development',
      'SQLite is zero-config — just a file on disk',
      'Can be swapped to PostgreSQL by changing the datasource in schema.prisma',
      'This gives a real database experience without Docker complexity',
    ],
  },
  {
    id: 68, cat: 'db-progression', q: 'What database do Battle-Tested templates use?',
    expect: 'PostgreSQL 16 (PERN/Next.js/T3) or MongoDB 7 (MERN) via Docker',
    keywords: ['postgresql', 'mongodb', 'docker'],
    corrections: [
      'Battle-Tested switches to production databases via docker-compose',
      'PERN, Next.js, T3 use PostgreSQL 16',
      'MERN uses MongoDB 7',
      'The database runs in a Docker container alongside the app',
    ],
  },
  {
    id: 69, cat: 'db-progression', q: 'Describe the full database progression from Basic to Vai.',
    expect: 'In-memory → SQLite/Prisma → PostgreSQL or MongoDB (Docker) → same with optimized Docker',
    keywords: ['memory', 'sqlite', 'postgresql', 'docker'],
    corrections: [
      'Basic: In-memory arrays (no persistence)',
      'Solid: SQLite via Prisma (file-based, auto-migration)',
      'Battle-Tested: PostgreSQL 16 or MongoDB 7 via docker-compose',
      'Vai: Same production DB with optimized Docker (multi-stage, non-root, healthcheck)',
    ],
  },
  {
    id: 70, cat: 'off-topic', q: 'What is the smallest country in the world?',
    expect: 'Vatican City',
    keywords: ['vatican'],
    corrections: [
      'Vatican City at 0.44 km² (0.17 sq mi)',
      'It is an independent city-state surrounded by Rome, Italy',
      'The Pope is the head of state',
      'Monaco is the second smallest country',
    ],
  },

  // ── 71-75: PERN DEEP DIVE ────────────────────────────────────
  {
    id: 71, cat: 'pern-deep', q: 'What Prisma models does PERN Solid define?',
    expect: 'Board, Todo, User',
    keywords: ['board', 'todo', 'user'],
    corrections: [
      'PERN Solid has 3 Prisma models: Board, Todo, User',
      'Board has: id, title, createdAt — one Board has many Todos',
      'Todo has: id, text, done, order, boardId — belongs to Board',
      'User has: id, email, name, passwordHash — for auth scaffolding',
    ],
  },
  {
    id: 72, cat: 'pern-deep', q: 'How does PERN handle task reordering?',
    expect: 'Transaction-based reorder with Prisma $transaction',
    keywords: ['transaction', 'reorder', 'prisma'],
    corrections: [
      'PERN Solid uses Prisma $transaction for atomic reorder operations',
      'All order updates happen in a single transaction for consistency',
      'Basic tier uses array manipulation for in-memory reorder',
      'Framer Motion handles the visual drag-to-reorder animation',
    ],
  },
  {
    id: 73, cat: 'pern-deep', q: 'What is the useApi hook in PERN Vai?',
    expect: 'Type-safe API client hook for React components',
    keywords: ['type', 'safe', 'api', 'hook', 'fetch'],
    corrections: [
      'useApi() is a custom React hook in PERN Vai for type-safe API calls',
      'Provides loading states, error handling, and response typing',
      'Encapsulates fetch logic so components don\'t need raw fetch calls',
      'Only exists in PERN Vai — other stacks don\'t have this hook',
    ],
  },
  {
    id: 74, cat: 'pern-deep', q: 'What is the ErrorBoundary component in PERN Vai?',
    expect: 'React error boundary for graceful crash handling',
    keywords: ['error', 'boundary', 'crash', 'fallback', 'react'],
    corrections: [
      'ErrorBoundary catches JavaScript errors in React component tree',
      'Shows a fallback UI instead of crashing the entire app',
      'Only in PERN Vai — other stacks don\'t include this component',
      'Uses React\'s componentDidCatch lifecycle or the error boundary pattern',
    ],
  },
  {
    id: 75, cat: 'off-topic', q: 'What does DNA stand for?',
    expect: 'Deoxyribonucleic Acid',
    keywords: ['deoxyribonucleic', 'acid'],
    corrections: [
      'DNA = Deoxyribonucleic Acid',
      'It carries genetic instructions for all living organisms',
      'DNA has a double helix structure discovered by Watson and Crick in 1953',
      'DNA is made of nucleotides: A-T and G-C base pairs',
    ],
  },

  // ── 76-80: MERN & NEXT.JS DEEP DIVE ──────────────────────────
  {
    id: 76, cat: 'mern-deep', q: 'What Zod schemas does MERN Solid define?',
    expect: 'CreateBookmarkSchema, UpdateBookmarkSchema',
    keywords: ['createbookmark', 'updatebookmark', 'schema'],
    corrections: [
      'MERN Solid defines CreateBookmarkSchema and UpdateBookmarkSchema',
      'These validate: URL format, title/description length limits',
      'UpdateBookmarkSchema supports partial updates',
      'Zod provides runtime validation + TypeScript type inference',
    ],
  },
  {
    id: 77, cat: 'nextjs-deep', q: 'What API routes does Next.js Basic have?',
    expect: 'GET/POST via /api/notes, PATCH/DELETE via /api/notes/[id], GET /api/health',
    keywords: ['notes', 'route', 'api', 'health'],
    corrections: [
      'Next.js Basic has 3 route files: /api/notes/route.ts, /api/notes/[id]/route.ts, /api/health/route.ts',
      'GET/POST on /api/notes for listing and creating notes',
      'PATCH/DELETE on /api/notes/[id] for updating and deleting specific notes',
      'Health check endpoint at /api/health for monitoring',
    ],
  },
  {
    id: 78, cat: 'nextjs-deep', q: 'Does Next.js Basic use Server Components?',
    expect: 'Yes, it uses Next.js App Router with Server Components',
    keywords: ['server', 'component', 'app router', 'yes'],
    corrections: [
      'Yes, Next.js Basic uses the App Router with Server Components by default',
      'src/app/layout.tsx is a Server Component (no "use client" directive)',
      'Client components are opted in with "use client" when needed',
      'This is different from PERN/MERN/T3 which use pure client-side React',
    ],
  },
  {
    id: 79, cat: 'cross-deep', q: 'What is the file count difference between the simplest and most complex templates?',
    expect: 'Basic has 8-11 files, Vai (PERN) has ~24+ files after merging',
    keywords: ['8', '11', 'file', 'merge'],
    corrections: [
      'PERN Basic: 8 files, Next.js Basic: 11 files',
      'Each tier adds 3-8 files on top of the previous',
      'PERN Vai is the largest with ~24+ files after all merges',
      'Files accumulate because mergeFiles() only adds/replaces, never removes',
    ],
  },
  {
    id: 80, cat: 'off-topic', q: 'What is the population of Norway?',
    expect: 'Approximately 5.5 million',
    keywords: ['5', 'million'],
    corrections: [
      'Norway has approximately 5.5 million people (2025)',
      'Oslo is the most populated city with ~700,000 residents',
      'Norway has one of the highest standards of living in the world',
      'The country is sparsely populated — most live in the south',
    ],
  },

  // ── 81-85: DEPLOYMENT & SCAFFOLD ──────────────────────────────
  {
    id: 81, cat: 'deploy', q: 'What happens when a user selects a stack and tier?',
    expect: 'Files are scaffolded from the template, packages installed, app built and started',
    keywords: ['scaffold', 'install', 'build', 'start'],
    corrections: [
      'The deploy pipeline: scaffold files → install packages → build → Docker → test → start → health check',
      'getStackTemplate(stackId, tier) retrieves the file list',
      'mergeFiles() applies tier-specific overrides on top of base files',
      'Not all steps run for all tiers (Basic skips Docker and tests)',
    ],
  },
  {
    id: 82, cat: 'deploy', q: 'How does the sandbox manager deploy a stack?',
    expect: 'Uses deploy.ts and manager.ts to scaffold and run the project',
    keywords: ['deploy', 'manager', 'sandbox'],
    corrections: [
      'The sandbox system is in packages/runtime/src/sandbox/',
      'deploy.ts handles the deployment pipeline execution',
      'manager.ts manages sandbox lifecycle (create, start, stop)',
      'templates.ts provides standalone templates separate from stacks',
    ],
  },
  {
    id: 83, cat: 'deploy', q: 'What deploy steps are skipped for Basic tier?',
    expect: 'Docker verification and full testing are skipped (no Dockerfile, no tests)',
    keywords: ['docker', 'test', 'skip'],
    corrections: [
      'Basic tier skips: docker verification (no Dockerfile), testing (no vitest)',
      'Only relevant steps run: scaffold → install → build → start → health',
      'Battle-Tested and Vai run all 7 deploy steps',
      'Solid skips Docker but could optionally run tests if any were added',
    ],
  },
  {
    id: 84, cat: 'deploy', q: 'What is the health check endpoint across templates?',
    expect: '/api/health in Next.js, varies in PERN/MERN/T3',
    keywords: ['health', 'api', 'endpoint'],
    corrections: [
      'Next.js Basic includes /api/health/route.ts returning status: ok',
      'PERN/MERN/T3 use a Fastify/Express health endpoint on the server',
      'Health checks verify the app is running correctly after deploy',
      'Docker HEALTHCHECK also uses the health endpoint in Vai tier',
    ],
  },
  {
    id: 85, cat: 'off-topic', q: 'What is the speed of light?',
    expect: '~299,792 km/s or ~186,000 mi/s',
    keywords: ['299', '300', 'km'],
    corrections: [
      'Speed of light in vacuum: 299,792,458 m/s (approximately 300,000 km/s)',
      'Nothing with mass can travel at or exceed the speed of light',
      'Light takes ~8 minutes to travel from the Sun to Earth',
      'Represented as "c" in physics equations (E = mc²)',
    ],
  },

  // ── 86-90: TIER LABELING & METADATA ───────────────────────────
  {
    id: 86, cat: 'tier-meta', q: 'What are the tier labels? (e.g., what label does Basic have?)',
    expect: 'Basic=Starter, Solid=Recommended, Battle-Tested=Production, Vai=Premium',
    keywords: ['starter', 'recommended', 'production', 'premium'],
    corrections: [
      'Basic = "Starter" — Minimal starter, get running in seconds',
      'Solid = "Recommended" — Production patterns with auth, validation, ORM',
      'Battle-Tested = "Production" — Deployment ready with Docker, tests, CI/CD',
      'Vai = "Premium" — VeggaAI\'s curated collection with Vegga\'s patterns & tooling',
    ],
  },
  {
    id: 87, cat: 'tier-meta', q: 'What is the TIER_META description for the Vai tier?',
    expect: "VeggaAI's curated collection — Vegga's patterns & tooling",
    keywords: ['veggaai', 'curated', 'vegga', 'pattern'],
    corrections: [
      'Vai = "VeggaAI\'s curated collection — Vegga\'s patterns & tooling"',
      'This is the premium tier with the most production-ready features',
      'Vai tier represents the best practices curated by the VeggaAI project',
      'It includes monitoring, optimized Docker, and project config',
    ],
  },
  {
    id: 88, cat: 'tier-meta', q: 'What icons and colors do the 4 stacks use?',
    expect: 'PERN=🐘/blue, MERN=🍃/green, Next.js=▲/zinc, T3=🔷/purple',
    keywords: ['🐘', '🍃', '▲', '🔷'],
    corrections: [
      'PERN: 🐘 (elephant for PostgreSQL) / blue color',
      'MERN: 🍃 (leaf for MongoDB) / green color',
      'Next.js: ▲ (triangle for Vercel) / zinc color',
      'T3: 🔷 (blue diamond for type safety) / purple color',
    ],
  },
  {
    id: 89, cat: 'tier-meta', q: 'What are the stack taglines?',
    expect: 'PERN=The classic full-stack combo, MERN=Document-driven full stack, etc.',
    keywords: ['classic', 'document', 'react framework', 'type-safety'],
    corrections: [
      'PERN: "The classic full-stack combo"',
      'MERN: "Document-driven full stack"',
      'Next.js: "The React framework for the web"',
      'T3: "Type-safety everywhere"',
    ],
  },
  {
    id: 90, cat: 'off-topic', q: 'What language has the most native speakers?',
    expect: 'Mandarin Chinese',
    keywords: ['mandarin', 'chinese'],
    corrections: [
      'Mandarin Chinese with ~920+ million native speakers',
      'Spanish is second with ~475 million native speakers',
      'English is third with ~373 million native speakers',
      'English has the most total speakers (native + L2) at ~1.5 billion',
    ],
  },

  // ── 91-95: TEMPLATE QUALITY VERIFICATION ──────────────────────
  {
    id: 91, cat: 'quality', q: 'Is the progression from Basic to Solid meaningful? What actually changes?',
    expect: 'Yes—adds Prisma ORM + Zod + database. Major quality jump.',
    keywords: ['prisma', 'zod', 'orm', 'database', 'quality'],
    corrections: [
      'Basic→Solid is the biggest quality jump: in-memory → real database via Prisma',
      'Adds Zod validation for all inputs (type safety at runtime)',
      'PERN Solid also adds User model + JWT for auth foundation',
      'Solid is labeled "Recommended" — it\'s where most users should start for real projects',
    ],
  },
  {
    id: 92, cat: 'quality', q: 'Is Battle-Tested a significant upgrade over Solid?',
    expect: 'Yes—adds Docker, testing, CI/CD, production database',
    keywords: ['docker', 'test', 'ci', 'production'],
    corrections: [
      'Battle-Tested adds: Docker + docker-compose, Vitest tests, GitHub Actions CI/CD',
      'Switches from SQLite to PostgreSQL/MongoDB production database',
      'Labeled "Production" — ready for real deployment',
      'Adds README.md documenting the full stack setup',
    ],
  },
  {
    id: 93, cat: 'quality', q: 'Is the Vai tier worth the upgrade over Battle-Tested?',
    expect: 'PERN Vai yes (monitoring+ErrorBoundary+useApi), others are light upgrades',
    keywords: ['monitor', 'pern', 'light', 'docker', 'optimiz'],
    corrections: [
      'PERN Vai is a meaningful upgrade: monitoring middleware, ErrorBoundary, useApi hook',
      'Next.js/MERN/T3 Vai tiers are light: only Dockerfile optimization + vai.config.ts',
      'The gap between Battle-Tested and Vai is smaller than Basic→Solid or Solid→Battle-Tested',
      'Vai tier could be enriched: add SSR optimization, caching, rate limiting, etc.',
    ],
  },
  {
    id: 94, cat: 'quality', q: 'Which tier jump is the smallest in terms of new content?',
    expect: 'Battle-Tested → Vai (especially for MERN, Next.js, T3)',
    keywords: ['battle', 'vai', 'small', 'mern', 'next', 't3'],
    corrections: [
      'Battle-Tested → Vai is the smallest jump for MERN/Next.js/T3 (only 4 file overrides)',
      'These tiers mostly just optimize the Dockerfile and add vai.config.ts',
      'PERN Vai is more substantial with 8 overrides including new features',
      'Opportunity: make Vai tiers richer across all stacks',
    ],
  },
  {
    id: 95, cat: 'off-topic', q: 'How many elements are on the periodic table?',
    expect: '118 elements',
    keywords: ['118'],
    corrections: [
      'There are 118 confirmed elements on the periodic table',
      'Element 118 is Oganesson (Og), a synthetic superheavy element',
      'The most recent additions were elements 113-118, confirmed 2015-2016',
      'About 94 elements occur naturally; the rest are synthetic',
    ],
  },

  // ── 96-100: CONVERSATIONAL UNDERSTANDING ──────────────────────
  {
    id: 96, cat: 'conversational', q: 'I want to build a blog. Which stack and tier should I use?',
    expect: 'Next.js at Solid or Battle-Tested tier (SSR, SEO, Prisma ORM)',
    keywords: ['next', 'solid', 'battle', 'ssr', 'seo'],
    corrections: [
      'For a blog: Next.js is ideal because of SSR/SSG for SEO',
      'Solid tier gives you Prisma ORM for database-backed posts',
      'Battle-Tested adds Docker deployment and CI/CD for production',
      'PERN/MERN could work but Next.js has better SEO out of the box',
    ],
  },
  {
    id: 97, cat: 'conversational', q: 'I need real-time data and document storage. Which stack?',
    expect: 'MERN (MongoDB for documents) or PERN with PostgreSQL JSONB',
    keywords: ['mern', 'mongodb', 'document'],
    corrections: [
      'MERN with MongoDB is perfect for document-oriented data',
      'MongoDB handles flexible schemas and nested documents well',
      'PERN with PostgreSQL JSONB is an alternative if you need SQL too',
      'For real-time: add WebSocket or Socket.io on top of either stack',
    ],
  },
  {
    id: 98, cat: 'conversational', q: 'I care most about type safety end-to-end. Which stack?',
    expect: 'T3 Stack (tRPC gives end-to-end type safety)',
    keywords: ['t3', 'trpc', 'type', 'safety'],
    corrections: [
      'T3 Stack is designed specifically for end-to-end type safety',
      'tRPC gives you type-safe API calls without manual type definitions',
      'Combined with Prisma, you get types from database to UI React components',
      'T3 even has Zod at Basic tier because tRPC requires it',
    ],
  },
  {
    id: 99, cat: 'conversational', q: 'I just want the fastest way to prototype something. Which tier?',
    expect: 'Basic tier of any stack — no database setup, instant start',
    keywords: ['basic', 'fast', 'instant', 'no setup'],
    corrections: [
      'Basic tier is the fastest — in-memory storage, no database config',
      'Just npm install && npm run dev and you\'re coding',
      'Choose the stack based on your project type',
      'You can always upgrade to Solid/Battle-Tested later',
    ],
  },
  {
    id: 100, cat: 'off-topic', q: 'What is the longest river in the world?',
    expect: 'Nile (6,650 km) or Amazon (disputed)',
    keywords: ['nile', 'amazon'],
    corrections: [
      'The Nile at ~6,650 km is traditionally considered longest',
      'The Amazon at ~6,400 km is disputed to be longer by some measurements',
      'The Nile flows through 11 African countries',
      'The Amazon carries the most water of any river',
    ],
  },
];

/* ═══════════════ Evaluation ═══════════════ */

function evaluate(answer, q) {
  const lower = answer.toLowerCase();
  const hasFallback = /couldn't find|don't have|no.*match|try rephrasing|haven't learned/i.test(answer);
  const isTaught = /got it.*i've learned|i'll remember this/i.test(answer);
  const isGarbage = /derivative|differentiat|infinitely larger|dot we draw/i.test(answer);

  if (hasFallback) return { pass: false, reason: 'FALLBACK — Vai said "I don\'t know"', score: 0 };
  if (isTaught) return { pass: false, reason: 'TEACH-HANDLER misfire', score: 0 };
  if (isGarbage) return { pass: false, reason: 'GARBAGE — irrelevant YouTube transcript bleed', score: 0 };
  if (answer.length < 30) return { pass: false, reason: 'TOO SHORT', score: 5 };

  // Greeting check (special case)
  if (q.cat === 'greeting') {
    const isGreetingResponse = /hey|hi|hello|sup|what's up|how can|help|good|welcome|veggaai/i.test(answer);
    if (isGreetingResponse) return { pass: true, reason: 'GREETING recognized', score: 100 };
    return { pass: false, reason: 'GREETING not recognized — treated as query', score: 10 };
  }

  // Keyword check
  const matched = q.keywords.filter(kw => lower.includes(kw.toLowerCase()));
  const keywordRatio = matched.length / q.keywords.length;
  const score = Math.round(keywordRatio * 100);

  if (matched.length === 0) return { pass: false, reason: `NO KEYWORDS (expected: ${q.keywords.join(', ')})`, score: 0 };
  if (keywordRatio >= 0.5) return { pass: true, reason: `PASS (${matched.length}/${q.keywords.length} keywords)`, score };
  return { pass: false, reason: `PARTIAL (${matched.length}/${q.keywords.length} keywords)`, score };
}

/* ═══════════════ Main ═══════════════ */

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  VAI TIER AUDIT — 100 Questions with Steering & Fixes  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Health check
  try {
    const h = await fetch(`${API}/health`);
    if (!h.ok) throw new Error(`${h.status}`);
    const s = await h.json();
    console.log(`✓ Server healthy — vocab: ${s.stats.vocabSize}, knowledge: ${s.stats.knowledgeEntries}\n`);
  } catch (e) {
    console.error(`✗ Server not reachable: ${e.message}`);
    process.exit(1);
  }

  // Create conversations — one per 10 questions to avoid context saturation
  const results = [];
  let totalPass = 0;
  let totalFail = 0;
  let totalCorrections = 0;
  let totalReasks = 0;
  let reaskPassed = 0;

  // Process in batches of 10
  for (let batch = 0; batch < 10; batch++) {
    const batchQs = questions.slice(batch * 10, (batch + 1) * 10);
    const convId = await createConv(`TierAudit-batch${batch + 1}`);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  BATCH ${batch + 1}/10 — Questions ${batch * 10 + 1}-${(batch + 1) * 10}`);
    console.log(`  Conversation: ${convId}`);
    console.log(`${'═'.repeat(60)}`);

    for (const q of batchQs) {
      console.log(`\n  ── Q${String(q.id).padStart(3)}: ${q.q.slice(0, 65)}${q.q.length > 65 ? '...' : ''}`);
      console.log(`     Expected: ${q.expect.slice(0, 70)}`);

      try {
        // Ask the question
        const answer = await chatWithVai(convId, q.q);
        const result = evaluate(answer, q);

        if (result.pass) {
          totalPass++;
          console.log(`     ✅ ${result.reason}`);
          console.log(`     Preview: ${answer.slice(0, 120).replace(/\n/g, ' ')}`);
          results.push({ ...q, firstAnswer: answer.slice(0, 200), firstResult: result, corrected: false });
        } else {
          totalFail++;
          console.log(`     ❌ ${result.reason}`);
          console.log(`     Preview: ${answer.slice(0, 120).replace(/\n/g, ' ')}`);

          // Send 4 corrections
          totalCorrections++;
          const correctionMsg = `That answer was wrong. Here are 4 corrections:\n` +
            q.corrections.map((c, i) => `${i + 1}. ${c}`).join('\n') +
            `\n\nPlease now answer the original question correctly: "${q.q}"`;

          console.log(`     📝 Sending 4 corrections...`);
          const correctedAnswer = await chatWithVai(convId, correctionMsg);
          const correctedResult = evaluate(correctedAnswer, q);
          totalReasks++;

          if (correctedResult.pass) {
            reaskPassed++;
            console.log(`     🔄 CORRECTED → ✅ ${correctedResult.reason}`);
          } else {
            console.log(`     🔄 CORRECTED → ❌ Still wrong: ${correctedResult.reason}`);
          }
          console.log(`     Preview: ${correctedAnswer.slice(0, 120).replace(/\n/g, ' ')}`);

          results.push({
            ...q,
            firstAnswer: answer.slice(0, 200),
            firstResult: result,
            corrected: true,
            correctedAnswer: correctedAnswer.slice(0, 200),
            correctedResult,
          });
        }
      } catch (err) {
        totalFail++;
        console.log(`     💥 ERROR: ${err.message.slice(0, 60)}`);
        results.push({ ...q, firstAnswer: '', firstResult: { pass: false, reason: `ERROR: ${err.message}`, score: 0 }, corrected: false });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  FINAL REPORT
  // ═══════════════════════════════════════════════════════════════
  const total = questions.length;
  const pct = ((totalPass / total) * 100).toFixed(1);

  console.log(`\n\n${'═'.repeat(60)}`);
  console.log('  TIER AUDIT — FINAL REPORT');
  console.log(`${'═'.repeat(60)}`);
  console.log(`\n  FIRST ATTEMPT: ${totalPass}/${total} passed (${pct}%)`);
  console.log(`  CORRECTIONS SENT: ${totalCorrections}`);
  console.log(`  AFTER CORRECTIONS: ${reaskPassed}/${totalReasks} re-asks passed (${totalReasks > 0 ? ((reaskPassed / totalReasks) * 100).toFixed(1) : 0}%)\n`);

  // Category breakdown
  const categories = [...new Set(questions.map(q => q.cat))];
  console.log('  Category Breakdown:');
  console.log('  ──────────────────────────────────────────');

  for (const cat of categories) {
    const catResults = results.filter(r => r.cat === cat);
    const catPassed = catResults.filter(r => r.firstResult.pass).length;
    const catTotal = catResults.length;
    const icon = catPassed === catTotal ? '✅' : catPassed === 0 ? '🔴' : '🟡';
    console.log(`  ${icon} ${cat.padEnd(20)} ${String(catPassed).padStart(2)}/${String(catTotal).padStart(2)}`);
  }

  // Failures
  const failures = results.filter(r => !r.firstResult.pass);
  if (failures.length > 0) {
    console.log(`\n  FAILURES (${failures.length}):`);
    console.log('  ──────────────────────────────────────────');
    for (const f of failures) {
      const corrNote = f.corrected
        ? (f.correctedResult?.pass ? ' → FIXED after correction' : ' → Still wrong after correction')
        : '';
      console.log(`  Q${String(f.id).padStart(3)}: ${f.q.slice(0, 55)}${f.q.length > 55 ? '...' : ''}`);
      console.log(`        ${f.firstResult.reason}${corrNote}`);
    }
  }

  // Score card
  console.log(`\n${'═'.repeat(60)}`);
  const effectivePass = totalPass + reaskPassed;
  const effectivePct = ((effectivePass / total) * 100).toFixed(1);
  console.log(`  FIRST-TRY SCORE:  ${totalPass}/${total} (${pct}%)`);
  console.log(`  WITH CORRECTIONS: ${effectivePass}/${total} (${effectivePct}%)`);
  console.log(`  CORRECTION RATE:  ${reaskPassed}/${totalReasks} fixed (${totalReasks > 0 ? ((reaskPassed / totalReasks) * 100).toFixed(1) : 0}%)`);

  if (totalPass >= 90) console.log('  🏆 EXCELLENT tier knowledge');
  else if (totalPass >= 70) console.log('  🥈 GOOD — most tier concepts understood');
  else if (totalPass >= 50) console.log('  🥉 FAIR — basic understanding');
  else console.log('  📊 NEEDS WORK — tier knowledge gaps');
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
