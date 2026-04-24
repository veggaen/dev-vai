I#!/usr/bin/env node
/**
 * VAI MEGA TEST — 200+ Questions from 60+ Project Contexts
 * ═══════════════════════════════════════════════════════════
 * Categories:
 *   A. General Knowledge (20)        — capitals, science, history, literature
 *   B. TypeScript / JavaScript (25)   — types, generics, async, patterns
 *   C. React / Next.js (20)          — SSR, App Router, Server Components, hooks
 *   D. CSS / Tailwind (15)           — utility-first, v4, design tokens, responsive
 *   E. DevOps / Docker / CI-CD (15)  — containers, pipelines, deployment
 *   F. Databases / ORM (10)          — Prisma, SQL, PostgreSQL, schema
 *   G. Auth / Security (10)          — NextAuth, JWT, HTTPS, CORS
 *   H. Testing (10)                  — Vitest, unit, e2e, TDD
 *   I. Rust (10)                     — ownership, borrowing, lifetimes, async
 *   J. Python (10)                   — GIL, typing, FastAPI, asyncio
 *   K. Go (10)                       — goroutines, channels, error handling
 *   L. WCAG / Accessibility (10)     — POUR, ARIA, screen readers
 *   M. GDPR / Privacy (5)           — consent, data minimization, DPO
 *   N. Norwegian Web Standard (10)   — MVP 2026, universell utforming
 *   O. Monorepo / Architecture (5)   — Turborepo, pnpm workspaces
 *   P. Vue / Angular / WordPress (10) — Vue3 composition, Angular signals, headless CMS
 *   Q. 3D / Animation (5)           — Three.js, GSAP, hover effects
 *   R. State Management (5)         — Zustand, Jotai, Redux, Pinia
 *   S. Build Tools (5)              — Vite, Turbopack, esbuild
 *   T. Misc Stack (10)              — tRPC, Zod, shadcn, PWA, Tauri, WASM
 *   U. Norway History (10)          — fylke-based questions
 * ═══════════════════════════════════════════════════════════
 * Total: 220 questions
 *
 * Usage: node scripts/test-mega-200.mjs
 */
import WebSocket from 'ws';

const API = 'http://localhost:3006';
const WS_URL = 'ws://localhost:3006/api/chat';
const TIMEOUT = 20_000;

async function chatWithVai(conversationId, message, timeoutMs = TIMEOUT) {
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
    setTimeout(() => { if (!gotDone) { ws.close(); resolve(response || '[timeout]'); } }, timeoutMs);
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

// ═══════════════════════════════════════════════════════════════════════
//  QUESTION BANK — 220 questions, 21 categories, ~60 project contexts
// ═══════════════════════════════════════════════════════════════════════

const questions = [

  // ── A. GENERAL KNOWLEDGE (20) ──────────────────────────────────────
  { q: 'What is the capital of France?', cat: 'A-general', keywords: ['paris'] },
  { q: 'What is the capital of Japan?', cat: 'A-general', keywords: ['tokyo'] },
  { q: 'What is the capital of Australia?', cat: 'A-general', keywords: ['canberra'] },
  { q: 'What is the capital of Norway?', cat: 'A-general', keywords: ['oslo'] },
  { q: 'Who painted the Mona Lisa?', cat: 'A-general', keywords: ['leonardo', 'da vinci'] },
  { q: 'Who wrote Romeo and Juliet?', cat: 'A-general', keywords: ['shakespeare'] },
  { q: 'What year did World War II end?', cat: 'A-general', keywords: ['1945'] },
  { q: 'When did the Berlin Wall fall?', cat: 'A-general', keywords: ['1989'] },
  { q: 'What is DNA?', cat: 'A-general', keywords: ['deoxyribonucleic'] },
  { q: 'What is the boiling point of water in Celsius?', cat: 'A-general', keywords: ['100'] },
  { q: 'What is the speed of light in km/s?', cat: 'A-general', keywords: ['300', '299'] },
  { q: 'What is the chemical formula for water?', cat: 'A-general', keywords: ['h2o'] },
  { q: 'Which planet is known as the Red Planet?', cat: 'A-general', keywords: ['mars'] },
  { q: 'What is the largest ocean on Earth?', cat: 'A-general', keywords: ['pacific'] },
  { q: 'What is a prime number?', cat: 'A-general', keywords: ['prime', 'divisible', 'factor'] },
  { q: 'How many bits are in a byte?', cat: 'A-general', keywords: ['8'] },
  { q: 'Who created JavaScript?', cat: 'A-general', keywords: ['brendan', 'eich'] },
  { q: 'When was Google founded?', cat: 'A-general', keywords: ['1998'] },
  { q: 'What happened at Lillehammer in 1994?', cat: 'A-general', keywords: ['olympic', 'winter'] },
  { q: 'What is the Norwegian Oil Fund?', cat: 'A-general', keywords: ['pension', 'sovereign', 'wealth', 'government'] },

  // ── B. TYPESCRIPT / JAVASCRIPT (25) ────────────────────────────────
  { q: 'What is TypeScript and why use it over JavaScript?', cat: 'B-typescript', keywords: ['type', 'static', 'superset'] },
  { q: 'What is the difference between interface and type in TypeScript?', cat: 'B-typescript', keywords: ['interface', 'type', 'extend', 'intersect'] },
  { q: 'Explain generics in TypeScript with an example.', cat: 'B-typescript', keywords: ['generic', '<t>', 'type parameter'] },
  { q: 'What are union types and intersection types in TypeScript?', cat: 'B-typescript', keywords: ['union', 'intersection', '|', '&'] },
  { q: 'How does async/await work in JavaScript?', cat: 'B-typescript', keywords: ['promise', 'async', 'await'] },
  { q: 'What is the difference between var, let, and const?', cat: 'B-typescript', keywords: ['block', 'scope', 'hoist'] },
  { q: 'Explain closures in JavaScript.', cat: 'B-typescript', keywords: ['closure', 'scope', 'function'] },
  { q: 'What is the event loop in JavaScript?', cat: 'B-typescript', keywords: ['event loop', 'call stack', 'queue', 'microtask'] },
  { q: 'What are template literal types in TypeScript?', cat: 'B-typescript', keywords: ['template', 'literal', 'string'] },
  { q: 'Explain the difference between == and === in JavaScript.', cat: 'B-typescript', keywords: ['strict', 'type coercion', 'equality'] },
  { q: 'What is destructuring in JavaScript?', cat: 'B-typescript', keywords: ['destructur', 'object', 'array'] },
  { q: 'What are TypeScript utility types? Name at least 3.', cat: 'B-typescript', keywords: ['partial', 'required', 'pick', 'omit', 'record', 'readonly'] },
  { q: 'How do you handle errors in TypeScript?', cat: 'B-typescript', keywords: ['try', 'catch', 'error', 'throw'] },
  { q: 'What is the nullish coalescing operator (??) in JavaScript?', cat: 'B-typescript', keywords: ['null', 'undefined', '??'] },
  { q: 'Explain optional chaining (?.) in JavaScript.', cat: 'B-typescript', keywords: ['optional', 'chain', '?.'] },
  { q: 'What are mapped types in TypeScript?', cat: 'B-typescript', keywords: ['mapped', 'keyof', 'in'] },
  { q: 'What is a discriminated union in TypeScript?', cat: 'B-typescript', keywords: ['discriminat', 'tag', 'kind', 'type'] },
  { q: 'Explain the module system in JavaScript (ESM vs CommonJS).', cat: 'B-typescript', keywords: ['import', 'export', 'require', 'module'] },
  { q: 'What are decorators in TypeScript?', cat: 'B-typescript', keywords: ['decorator', '@', 'metadata'] },
  { q: 'How do you type a React component in TypeScript?', cat: 'B-typescript', keywords: ['react', 'fc', 'props', 'component'] },
  { q: 'What is a Record type in TypeScript?', cat: 'B-typescript', keywords: ['record', 'key', 'value'] },
  { q: 'Explain the concept of type narrowing in TypeScript.', cat: 'B-typescript', keywords: ['narrow', 'guard', 'typeof', 'instanceof'] },
  { q: 'What is the satisfies keyword in TypeScript?', cat: 'B-typescript', keywords: ['satisfies', 'type check', 'infer'] },
  { q: 'How do you create a type-safe API client in TypeScript?', cat: 'B-typescript', keywords: ['type', 'api', 'generic', 'fetch'] },
  { q: 'What are conditional types in TypeScript?', cat: 'B-typescript', keywords: ['conditional', 'extends', 'infer', 'ternary'] },

  // ── C. REACT / NEXT.JS (20) ───────────────────────────────────────
  { q: 'What is Next.js and what does it do?', cat: 'C-nextjs', keywords: ['react', 'framework', 'ssr', 'ssg'] },
  { q: 'Explain Server Components in Next.js App Router.', cat: 'C-nextjs', keywords: ['server component', 'rsc', 'client', 'app router'] },
  { q: 'What is the difference between SSR, SSG, and ISR in Next.js?', cat: 'C-nextjs', keywords: ['server', 'static', 'incremental', 'revalidat'] },
  { q: 'How does the Next.js App Router differ from Pages Router?', cat: 'C-nextjs', keywords: ['app', 'pages', 'layout', 'server component'] },
  { q: 'Explain React hooks: useState, useEffect, useRef.', cat: 'C-nextjs', keywords: ['usestate', 'useeffect', 'useref', 'hook'] },
  { q: 'What is React Server Actions and how do you use them?', cat: 'C-nextjs', keywords: ['server action', 'use server', 'form'] },
  { q: 'How do you handle metadata and SEO in Next.js 14+?', cat: 'C-nextjs', keywords: ['metadata', 'seo', 'generatemetadata', 'head'] },
  { q: 'What is React Suspense and how does it relate to streaming SSR?', cat: 'C-nextjs', keywords: ['suspense', 'stream', 'fallback', 'loading'] },
  { q: 'Explain the use of middleware in Next.js.', cat: 'C-nextjs', keywords: ['middleware', 'request', 'response', 'edge'] },
  { q: 'What are React Context and when should you use it vs a state library?', cat: 'C-nextjs', keywords: ['context', 'provider', 'consumer', 'state'] },
  { q: 'How do you optimize images in Next.js?', cat: 'C-nextjs', keywords: ['image', 'next/image', 'optimization', 'lazy'] },
  { q: 'What is React.memo and when should you use it?', cat: 'C-nextjs', keywords: ['memo', 'memoiz', 'performance', 're-render'] },
  { q: 'Explain parallel routes and intercepting routes in Next.js App Router.', cat: 'C-nextjs', keywords: ['parallel', 'intercept', '@', 'slot'] },
  { q: 'How do you implement error boundaries in React?', cat: 'C-nextjs', keywords: ['error', 'boundary', 'catch', 'fallback'] },
  { q: 'What is the difference between useCallback and useMemo?', cat: 'C-nextjs', keywords: ['usecallback', 'usememo', 'memoiz', 'function', 'value'] },
  { q: 'How do you handle forms in React with server actions?', cat: 'C-nextjs', keywords: ['form', 'action', 'server', 'formdata'] },
  { q: 'What is a layout in Next.js App Router and how does it work?', cat: 'C-nextjs', keywords: ['layout', 'children', 'nested', 'persist'] },
  { q: 'Explain client-side navigation in Next.js.', cat: 'C-nextjs', keywords: ['link', 'router', 'prefetch', 'navigation'] },
  { q: 'What are React portals and when do you use them?', cat: 'C-nextjs', keywords: ['portal', 'createportal', 'dom', 'modal'] },
  { q: 'How do you implement code splitting in Next.js?', cat: 'C-nextjs', keywords: ['dynamic', 'lazy', 'import', 'split', 'bundle'] },

  // ── D. CSS / TAILWIND (15) ────────────────────────────────────────
  { q: 'What is Tailwind CSS and how is it different from Bootstrap?', cat: 'D-css', keywords: ['utility', 'first', 'tailwind', 'bootstrap'] },
  { q: 'What changed in Tailwind CSS v4 compared to v3?', cat: 'D-css', keywords: ['v4', 'css-first', '@theme', 'config'] },
  { q: 'What are design tokens and how are they used in CSS?', cat: 'D-css', keywords: ['token', 'variable', 'custom property'] },
  { q: 'Explain CSS Grid vs Flexbox: when do you use each?', cat: 'D-css', keywords: ['grid', 'flex', 'layout', 'dimension'] },
  { q: 'How do you implement dark mode in Tailwind CSS?', cat: 'D-css', keywords: ['dark', 'mode', 'class', 'media'] },
  { q: 'What is mobile-first responsive design?', cat: 'D-css', keywords: ['mobile', 'first', 'min-width', 'breakpoint'] },
  { q: 'How do you create a hover effect that changes both color and scale?', cat: 'D-css', keywords: ['hover', 'scale', 'transform', 'transition'] },
  { q: 'What are CSS custom properties and how do they work?', cat: 'D-css', keywords: ['custom', 'property', 'var(', '--'] },
  { q: 'Explain the CSS cascade and specificity.', cat: 'D-css', keywords: ['cascade', 'specificity', 'selector', 'priority'] },
  { q: 'How do you handle responsive typography in CSS?', cat: 'D-css', keywords: ['clamp', 'fluid', 'vw', 'rem'] },
  { q: 'What is the @layer directive in CSS?', cat: 'D-css', keywords: ['@layer', 'cascade', 'priority'] },
  { q: 'How do you center an element both horizontally and vertically?', cat: 'D-css', keywords: ['flex', 'grid', 'center', 'place'] },
  { q: 'What is container queries in CSS and when are they useful?', cat: 'D-css', keywords: ['container', '@container', 'query', 'size'] },
  { q: 'How do you implement a smooth scroll-linked animation in CSS?', cat: 'D-css', keywords: ['scroll', 'animation', 'timeline', 'smooth'] },
  { q: 'What is the difference between rem, em, px, and vh/vw units?', cat: 'D-css', keywords: ['rem', 'em', 'px', 'viewport'] },

  // ── E. DEVOPS / DOCKER / CI-CD (15) ──────────────────────────────
  { q: 'Explain what Docker is and why developers use it.', cat: 'E-devops', keywords: ['container', 'docker', 'image', 'isolat'] },
  { q: 'Write a Dockerfile for a Next.js production app.', cat: 'E-devops', keywords: ['from', 'node', 'build', 'copy', 'run'] },
  { q: 'What is the difference between Docker image and Docker container?', cat: 'E-devops', keywords: ['image', 'container', 'running', 'instance'] },
  { q: 'What is docker-compose and when should you use it?', cat: 'E-devops', keywords: ['compose', 'multi', 'service', 'yml'] },
  { q: 'What is CI/CD and name some popular tools for it.', cat: 'E-devops', keywords: ['continuous', 'integration', 'deploy', 'github actions'] },
  { q: 'Write a GitHub Actions workflow for a Next.js app.', cat: 'E-devops', keywords: ['workflow', 'jobs', 'steps', 'checkout', 'run'] },
  { q: 'What is Kubernetes and how does it relate to Docker?', cat: 'E-devops', keywords: ['kubernetes', 'k8s', 'orchestr', 'pod'] },
  { q: 'Explain the concept of infrastructure as code (IaC).', cat: 'E-devops', keywords: ['infrastructure', 'code', 'terraform', 'declarative'] },
  { q: 'What is a multi-stage Docker build and why use it?', cat: 'E-devops', keywords: ['multi-stage', 'stage', 'from', 'size'] },
  { q: 'How do you handle environment variables in Docker?', cat: 'E-devops', keywords: ['env', 'environment', 'arg', '.env'] },
  { q: 'What is a reverse proxy and how does Nginx fit in?', cat: 'E-devops', keywords: ['reverse', 'proxy', 'nginx', 'upstream'] },
  { q: 'Explain blue-green deployment vs canary deployment.', cat: 'E-devops', keywords: ['blue', 'green', 'canary', 'traffic'] },
  { q: 'What are Docker volumes and why are they important?', cat: 'E-devops', keywords: ['volume', 'persist', 'data', 'mount'] },
  { q: 'How do you set up a CI pipeline for a monorepo?', cat: 'E-devops', keywords: ['monorepo', 'ci', 'affected', 'cache'] },
  { q: 'What is GitOps and how does it work?', cat: 'E-devops', keywords: ['gitops', 'git', 'reconcil', 'declarative'] },

  // ── F. DATABASES / ORM (10) ──────────────────────────────────────
  { q: 'What is Prisma and how does it work with databases?', cat: 'F-database', keywords: ['prisma', 'orm', 'schema', 'migration'] },
  { q: 'What is the difference between SQL and NoSQL databases?', cat: 'F-database', keywords: ['sql', 'nosql', 'relational', 'document'] },
  { q: 'How do you define a database schema in Prisma?', cat: 'F-database', keywords: ['model', 'schema', '@id', 'relation'] },
  { q: 'What are database migrations and why are they important?', cat: 'F-database', keywords: ['migration', 'schema', 'version', 'change'] },
  { q: 'Explain database indexing and why it matters for performance.', cat: 'F-database', keywords: ['index', 'perform', 'query', 'b-tree'] },
  { q: 'What is the difference between PostgreSQL and MySQL?', cat: 'F-database', keywords: ['postgres', 'mysql', 'json', 'extension'] },
  { q: 'How do you handle database transactions in Prisma?', cat: 'F-database', keywords: ['transaction', '$transaction', 'atomic'] },
  { q: 'What is connection pooling and why does it matter?', cat: 'F-database', keywords: ['pool', 'connection', 'concurrent', 'reuse'] },
  { q: 'Explain the N+1 query problem and how to solve it.', cat: 'F-database', keywords: ['n+1', 'eager', 'include', 'join'] },
  { q: 'What is Drizzle ORM and how does it compare to Prisma?', cat: 'F-database', keywords: ['drizzle', 'type', 'sql', 'lightweight'] },

  // ── G. AUTH / SECURITY (10) ──────────────────────────────────────
  { q: 'Explain JWT (JSON Web Token) and how authentication works.', cat: 'G-auth', keywords: ['jwt', 'token', 'header', 'payload', 'signature'] },
  { q: 'What is OAuth 2.0 and how does the authorization flow work?', cat: 'G-auth', keywords: ['oauth', 'authorization', 'code', 'token', 'redirect'] },
  { q: 'How do you implement authentication in Next.js with NextAuth?', cat: 'G-auth', keywords: ['nextauth', 'auth.js', 'provider', 'session'] },
  { q: 'What is CORS and why is it important for web security?', cat: 'G-auth', keywords: ['cors', 'origin', 'cross', 'header'] },
  { q: 'Explain HTTPS and SSL/TLS certificates.', cat: 'G-auth', keywords: ['https', 'ssl', 'tls', 'certificate', 'encrypt'] },
  { q: 'What is XSS (Cross-Site Scripting) and how do you prevent it?', cat: 'G-auth', keywords: ['xss', 'script', 'sanitiz', 'escap'] },
  { q: 'What is CSRF and how do you protect against it?', cat: 'G-auth', keywords: ['csrf', 'token', 'cross-site', 'request'] },
  { q: 'How do you store passwords securely in a database?', cat: 'G-auth', keywords: ['hash', 'bcrypt', 'salt', 'argon'] },
  { q: 'What is the difference between authentication and authorization?', cat: 'G-auth', keywords: ['authentication', 'authorization', 'identity', 'permission'] },
  { q: 'How do you implement role-based access control (RBAC)?', cat: 'G-auth', keywords: ['role', 'permission', 'access', 'rbac'] },

  // ── H. TESTING (10) ──────────────────────────────────────────────
  { q: 'What is Vitest and how does it compare to Jest?', cat: 'H-testing', keywords: ['vitest', 'jest', 'vite', 'fast', 'esm'] },
  { q: 'Explain the difference between unit tests, integration tests, and e2e tests.', cat: 'H-testing', keywords: ['unit', 'integration', 'e2e', 'end-to-end'] },
  { q: 'What is TDD (Test-Driven Development) and why use it?', cat: 'H-testing', keywords: ['tdd', 'red', 'green', 'refactor', 'test first'] },
  { q: 'How do you test React components with React Testing Library?', cat: 'H-testing', keywords: ['testing library', 'render', 'screen', 'user event'] },
  { q: 'What is mocking and when should you use it in tests?', cat: 'H-testing', keywords: ['mock', 'stub', 'spy', 'vi.fn', 'jest.fn'] },
  { q: 'How do you test API endpoints?', cat: 'H-testing', keywords: ['api', 'supertest', 'request', 'status', 'response'] },
  { q: 'What is code coverage and what percentage should you aim for?', cat: 'H-testing', keywords: ['coverage', 'percent', 'branch', 'line'] },
  { q: 'How do you test async code in Vitest/Jest?', cat: 'H-testing', keywords: ['async', 'await', 'resolve', 'reject', 'promise'] },
  { q: 'What is Playwright and how do you use it for e2e testing?', cat: 'H-testing', keywords: ['playwright', 'browser', 'page', 'e2e'] },
  { q: 'Explain snapshot testing and when it is useful.', cat: 'H-testing', keywords: ['snapshot', 'tomatchsnapshot', 'regression'] },

  // ── I. RUST (10) ─────────────────────────────────────────────────
  { q: 'How does Rust ensure memory safety without a garbage collector?', cat: 'I-rust', keywords: ['ownership', 'borrow', 'lifetime'] },
  { q: 'What is the difference between String and &str in Rust?', cat: 'I-rust', keywords: ['string', '&str', 'heap', 'slice', 'owned'] },
  { q: 'Explain the Rust borrow checker and why it exists.', cat: 'I-rust', keywords: ['borrow', 'checker', 'mutable', 'immutable', 'reference'] },
  { q: 'What are traits in Rust and how do they compare to interfaces?', cat: 'I-rust', keywords: ['trait', 'impl', 'interface', 'method'] },
  { q: 'How does error handling work in Rust with Result and Option?', cat: 'I-rust', keywords: ['result', 'option', 'ok', 'err', 'some', 'none'] },
  { q: 'What is the difference between Box, Rc, and Arc in Rust?', cat: 'I-rust', keywords: ['box', 'rc', 'arc', 'heap', 'reference count', 'thread'] },
  { q: 'Explain lifetimes in Rust and why they are needed.', cat: 'I-rust', keywords: ['lifetime', "'a", 'reference', 'scope', 'valid'] },
  { q: 'How does async/await work in Rust?', cat: 'I-rust', keywords: ['async', 'await', 'future', 'tokio', 'runtime'] },
  { q: 'What is the match expression in Rust?', cat: 'I-rust', keywords: ['match', 'pattern', 'arm', 'exhaustive'] },
  { q: 'How does Rust handle concurrency safely?', cat: 'I-rust', keywords: ['send', 'sync', 'thread', 'mutex', 'arc'] },

  // ── J. PYTHON (10) ───────────────────────────────────────────────
  { q: 'What is the GIL in Python and how does it affect concurrency?', cat: 'J-python', keywords: ['gil', 'global interpreter lock', 'thread'] },
  { q: 'How does Python type hinting work?', cat: 'J-python', keywords: ['type', 'hint', 'typing', 'int', 'str', 'annotation'] },
  { q: 'What is FastAPI and how does it compare to Flask/Django?', cat: 'J-python', keywords: ['fastapi', 'flask', 'django', 'async', 'pydantic'] },
  { q: 'Explain Python decorators and give an example.', cat: 'J-python', keywords: ['decorator', '@', 'wrapper', 'function'] },
  { q: 'How does asyncio work in Python?', cat: 'J-python', keywords: ['asyncio', 'async', 'await', 'event loop', 'coroutine'] },
  { q: 'What are Python list comprehensions and generator expressions?', cat: 'J-python', keywords: ['comprehension', 'generator', '[', 'for', 'yield'] },
  { q: 'Explain virtual environments in Python (venv, pipenv, poetry).', cat: 'J-python', keywords: ['venv', 'virtual', 'environment', 'pip', 'isolat'] },
  { q: 'What is Pydantic and why is it used?', cat: 'J-python', keywords: ['pydantic', 'validation', 'model', 'basemodel'] },
  { q: 'How do you handle dependency injection in Python?', cat: 'J-python', keywords: ['dependency', 'injection', 'inject', 'container'] },
  { q: 'What are dataclasses in Python and when should you use them?', cat: 'J-python', keywords: ['dataclass', '@dataclass', 'field', '__init__'] },

  // ── K. GO (10) ───────────────────────────────────────────────────
  { q: 'What are Go goroutines and how do they differ from OS threads?', cat: 'K-go', keywords: ['goroutine', 'lightweight', 'go ', 'thread'] },
  { q: 'How do Go channels work for concurrency?', cat: 'K-go', keywords: ['channel', 'chan', 'send', 'receive', 'buffered'] },
  { q: 'How does error handling work in Go?', cat: 'K-go', keywords: ['error', 'nil', 'err', 'return', 'if err'] },
  { q: 'What are Go interfaces and how are they implemented?', cat: 'K-go', keywords: ['interface', 'implicit', 'method', 'satisfy'] },
  { q: 'Explain the Go struct and how it compares to classes.', cat: 'K-go', keywords: ['struct', 'field', 'method', 'receiver'] },
  { q: 'What is the Go module system (go mod)?', cat: 'K-go', keywords: ['go mod', 'module', 'go.mod', 'dependency'] },
  { q: 'How do you handle HTTP requests in Go?', cat: 'K-go', keywords: ['http', 'net/http', 'handler', 'listenandserve'] },
  { q: 'What is the select statement in Go?', cat: 'K-go', keywords: ['select', 'channel', 'case', 'block'] },
  { q: 'Explain Go slices vs arrays.', cat: 'K-go', keywords: ['slice', 'array', 'dynamic', 'append', 'length', 'capacity'] },
  { q: 'What are Go generics and when were they introduced?', cat: 'K-go', keywords: ['generic', '1.18', 'type parameter', 'constraint'] },

  // ── L. WCAG / ACCESSIBILITY (10) ─────────────────────────────────
  { q: 'What is WCAG and why is it important for web accessibility?', cat: 'L-a11y', keywords: ['wcag', 'web content accessibility', 'guidelines'] },
  { q: 'Explain the POUR principles in web accessibility.', cat: 'L-a11y', keywords: ['perceivable', 'operable', 'understandable', 'robust'] },
  { q: 'What are ARIA attributes and when should you use them?', cat: 'L-a11y', keywords: ['aria', 'role', 'label', 'screen reader'] },
  { q: 'How do you make a React app accessible for screen readers?', cat: 'L-a11y', keywords: ['aria', 'semantic', 'alt', 'label', 'focus'] },
  { q: 'What is the difference between WCAG 2.1 AA and AAA?', cat: 'L-a11y', keywords: ['aa', 'aaa', 'contrast', 'level'] },
  { q: 'How do you test web accessibility?', cat: 'L-a11y', keywords: ['axe', 'lighthouse', 'screen reader', 'test'] },
  { q: 'What is color contrast ratio and what are the WCAG requirements?', cat: 'L-a11y', keywords: ['contrast', '4.5', '3:1', 'ratio'] },
  { q: 'How do you make forms accessible?', cat: 'L-a11y', keywords: ['label', 'for', 'fieldset', 'legend', 'error'] },
  { q: 'What is focus management and why is it important?', cat: 'L-a11y', keywords: ['focus', 'tab', 'keyboard', 'trap', 'visible'] },
  { q: 'How do you handle keyboard navigation in a web app?', cat: 'L-a11y', keywords: ['keyboard', 'tab', 'arrow', 'focus', 'trap'] },

  // ── M. GDPR / PRIVACY (5) ───────────────────────────────────────
  { q: 'What is GDPR and what does it require for web apps?', cat: 'M-gdpr', keywords: ['gdpr', 'data protection', 'consent', 'right'] },
  { q: 'How do you implement a GDPR-compliant cookie consent banner?', cat: 'M-gdpr', keywords: ['consent', 'cookie', 'opt-in', 'reject'] },
  { q: 'What is the right to be forgotten under GDPR?', cat: 'M-gdpr', keywords: ['right', 'erasure', 'delete', 'forgotten'] },
  { q: 'What is a Data Protection Officer (DPO) and when is one required?', cat: 'M-gdpr', keywords: ['dpo', 'officer', 'data protection', 'required'] },
  { q: 'How do you handle data breach notifications under GDPR?', cat: 'M-gdpr', keywords: ['breach', 'notification', '72 hour', 'authority'] },

  // ── N. NORWEGIAN WEB STANDARD (10) ──────────────────────────────
  { q: 'What is the Norwegian standard for a website MVP in 2026?', cat: 'N-nor-web', keywords: ['wcag', 'gdpr', 'responsive', 'https'] },
  { q: 'Hva er universell utforming, og hvorfor er det viktig for norske nettsider?', cat: 'N-nor-web', keywords: ['tilgjengelig', 'wcag', 'lov', 'universell'] },
  { q: 'What laws govern web accessibility in Norway?', cat: 'N-nor-web', keywords: ['likestilling', 'diskriminering', 'difi', 'tilsynet'] },
  { q: 'How should a Norwegian website handle personvern (privacy)?', cat: 'N-nor-web', keywords: ['personvern', 'gdpr', 'samtykke', 'cookie'] },
  { q: 'What is bærekraftig webdesign (sustainable web design)?', cat: 'N-nor-web', keywords: ['bærekraftig', 'sustainable', 'carbon', 'performance'] },
  { q: 'Hva betyr HTTPS og SSL for norske nettsider?', cat: 'N-nor-web', keywords: ['https', 'ssl', 'krypter', 'sikkerhet'] },
  { q: 'What should a Norwegian MVP landing page include in 2026?', cat: 'N-nor-web', keywords: ['landing', 'cta', 'responsive', 'wcag'] },
  { q: 'Hvordan tester man universell utforming i Norge?', cat: 'N-nor-web', keywords: ['test', 'uu', 'wcag', 'skjermleser'] },
  { q: 'What is Altinn and why is it relevant for Norwegian web developers?', cat: 'N-nor-web', keywords: ['altinn', 'government', 'digital', 'service'] },
  { q: 'How should a Norwegian e-commerce site handle payment and privacy?', cat: 'N-nor-web', keywords: ['payment', 'vipps', 'gdpr', 'samtykke'] },

  // ── O. MONOREPO / ARCHITECTURE (5) ──────────────────────────────
  { q: 'What is a monorepo and when should you use one?', cat: 'O-monorepo', keywords: ['monorepo', 'single', 'repository', 'multiple'] },
  { q: 'How does Turborepo work for monorepo builds?', cat: 'O-monorepo', keywords: ['turborepo', 'cache', 'pipeline', 'task'] },
  { q: 'Explain pnpm workspaces for monorepo management.', cat: 'O-monorepo', keywords: ['pnpm', 'workspace', 'package', 'link'] },
  { q: 'What is the difference between a monorepo and a monolith?', cat: 'O-monorepo', keywords: ['monorepo', 'monolith', 'deploy', 'independent'] },
  { q: 'How do you share TypeScript types across packages in a monorepo?', cat: 'O-monorepo', keywords: ['shared', 'types', 'package', 'reference'] },

  // ── P. VUE / ANGULAR / WORDPRESS (10) ───────────────────────────
  { q: 'What is Vue 3 Composition API and how does it differ from Options API?', cat: 'P-frameworks', keywords: ['composition', 'setup', 'ref', 'reactive'] },
  { q: 'Explain Angular signals and how they improve change detection.', cat: 'P-frameworks', keywords: ['signal', 'angular', 'change detection', 'reactive'] },
  { q: 'What is headless WordPress and when should you use it?', cat: 'P-frameworks', keywords: ['headless', 'wordpress', 'rest api', 'wp-json'] },
  { q: 'How do you set up a Vue 3 project with Vite?', cat: 'P-frameworks', keywords: ['vue', 'vite', 'create-vue', 'scaffold'] },
  { q: 'What are Angular standalone components?', cat: 'P-frameworks', keywords: ['standalone', 'angular', 'component', 'module'] },
  { q: 'How does Vue Router work for SPA navigation?', cat: 'P-frameworks', keywords: ['vue-router', 'route', 'navigation', 'component'] },
  { q: 'What is the Angular dependency injection system?', cat: 'P-frameworks', keywords: ['dependency', 'inject', 'provider', 'angular'] },
  { q: 'How do you build a headless WordPress site with Next.js?', cat: 'P-frameworks', keywords: ['wordpress', 'next', 'graphql', 'wp-graphql'] },
  { q: 'What is Nuxt 3 and how does it compare to Next.js?', cat: 'P-frameworks', keywords: ['nuxt', 'vue', 'ssr', 'server'] },
  { q: 'How do you create a custom WordPress block with React?', cat: 'P-frameworks', keywords: ['wordpress', 'block', 'gutenberg', 'react'] },

  // ── Q. 3D / ANIMATION (5) ──────────────────────────────────────
  { q: 'What is Three.js and how do you create a basic 3D scene?', cat: 'Q-3d', keywords: ['three', 'scene', 'camera', 'renderer'] },
  { q: 'How does GSAP work for web animations?', cat: 'Q-3d', keywords: ['gsap', 'tween', 'timeline', 'animation'] },
  { q: 'How do you create a hover animation that changes an icon and scales the element?', cat: 'Q-3d', keywords: ['hover', 'icon', 'scale', 'transition'] },
  { q: 'How do you integrate Three.js with React using React Three Fiber?', cat: 'Q-3d', keywords: ['react three fiber', '@react-three', 'canvas', 'three'] },
  { q: 'What is a scroll-triggered animation with GSAP ScrollTrigger?', cat: 'Q-3d', keywords: ['scrolltrigger', 'scroll', 'trigger', 'pin'] },

  // ── R. STATE MANAGEMENT (5) ────────────────────────────────────
  { q: 'What is Zustand and how does it compare to Redux?', cat: 'R-state', keywords: ['zustand', 'store', 'redux', 'simple'] },
  { q: 'Explain Jotai atoms and how they work for state management.', cat: 'R-state', keywords: ['jotai', 'atom', 'primitive', 'bottom-up'] },
  { q: 'When should you use Redux Toolkit vs Zustand?', cat: 'R-state', keywords: ['redux', 'zustand', 'middleware', 'devtools'] },
  { q: 'What is Pinia and how does it replace Vuex in Vue 3?', cat: 'R-state', keywords: ['pinia', 'vuex', 'store', 'composition'] },
  { q: 'How do you handle global state in Next.js App Router?', cat: 'R-state', keywords: ['state', 'context', 'zustand', 'server'] },

  // ── S. BUILD TOOLS (5) ────────────────────────────────────────
  { q: 'What is Vite and why is it faster than Webpack?', cat: 'S-build', keywords: ['vite', 'esm', 'hmr', 'fast'] },
  { q: 'Explain Turbopack and how it works with Next.js.', cat: 'S-build', keywords: ['turbopack', 'next', 'rust', 'incremental'] },
  { q: 'What is esbuild and why is it so fast?', cat: 'S-build', keywords: ['esbuild', 'go', 'fast', 'bundle'] },
  { q: 'How does tree-shaking work in modern bundlers?', cat: 'S-build', keywords: ['tree', 'shak', 'dead code', 'esm', 'import'] },
  { q: 'What is the difference between bundling and transpiling?', cat: 'S-build', keywords: ['bundle', 'transpil', 'combine', 'convert'] },

  // ── T. MISC STACK (10) ───────────────────────────────────────
  { q: 'What is tRPC and how does it provide end-to-end type safety?', cat: 'T-misc', keywords: ['trpc', 'type', 'end-to-end', 'router'] },
  { q: 'What is Zod and how do you use it for validation?', cat: 'T-misc', keywords: ['zod', 'schema', 'validation', 'parse'] },
  { q: 'What is shadcn/ui and how does it differ from a traditional component library?', cat: 'T-misc', keywords: ['shadcn', 'component', 'copy', 'paste', 'not npm'] },
  { q: 'What is a PWA (Progressive Web App) and what makes it work?', cat: 'T-misc', keywords: ['pwa', 'service worker', 'manifest', 'offline'] },
  { q: 'What is Tauri and how does it compare to Electron?', cat: 'T-misc', keywords: ['tauri', 'electron', 'rust', 'lightweight', 'native'] },
  { q: 'What is WebAssembly (WASM) and when should you use it?', cat: 'T-misc', keywords: ['wasm', 'webassembly', 'performance', 'binary'] },
  { q: 'What icon libraries work best with React and Tailwind?', cat: 'T-misc', keywords: ['lucide', 'heroicon', 'icon', 'react'] },
  { q: 'What is Storybook and how is it used for component development?', cat: 'T-misc', keywords: ['storybook', 'component', 'isolat', 'story'] },
  { q: 'Explain the difference between REST and GraphQL.', cat: 'T-misc', keywords: ['rest', 'graphql', 'endpoint', 'query'] },
  { q: 'What is Vercel and how does it simplify deployment?', cat: 'T-misc', keywords: ['vercel', 'deploy', 'preview', 'serverless'] },

  // ── U. NORWAY HISTORY (10 — one per fylke) ──────────────────────
  { q: 'What is the history of Rogaland and the North Sea oil?', cat: 'U-nor-hist', keywords: ['ekofisk', 'oil', 'stavanger', '1969'] },
  { q: 'What is the historical significance of Bryggen in Vestland?', cat: 'U-nor-hist', keywords: ['bryggen', 'bergen', 'hansa', 'unesco'] },
  { q: 'What major event happened in Oslo in 1952?', cat: 'U-nor-hist', keywords: ['olympic', '1952', 'winter', 'holmenkollen'] },
  { q: 'Why is Eidsvoll in Innlandet historically important for Norway?', cat: 'U-nor-hist', keywords: ['eidsvoll', 'grunnlov', 'constitution', '1814'] },
  { q: 'What was found at Gokstad in Vestfold og Telemark?', cat: 'U-nor-hist', keywords: ['gokstad', 'viking', 'ship', '900'] },
  { q: 'What is the historical significance of Nidaros in Trøndelag?', cat: 'U-nor-hist', keywords: ['nidaros', 'cathedral', 'trondheim', 'olav'] },
  { q: 'What happened in Finnmark during World War II (den brente jords taktikk)?', cat: 'U-nor-hist', keywords: ['scorched', 'brent', 'german', 'retreat'] },
  { q: 'What is Lofotfisket in Nordland and why was it important?', cat: 'U-nor-hist', keywords: ['lofot', 'cod', 'fishing', 'torsk'] },
  { q: 'What is the history of the age of sail (seilskutetiden) in Agder?', cat: 'U-nor-hist', keywords: ['seilskute', 'sail', 'shipping', 'arendal'] },
  { q: 'What happened with the battleship Tirpitz in Troms during WWII?', cat: 'U-nor-hist', keywords: ['tirpitz', 'battleship', 'tromsø', 'sunk'] },
];

// ═══════════════════════════════════════════════════════════════════════
//  EVALUATION ENGINE
// ═══════════════════════════════════════════════════════════════════════

function evaluate(answer, q) {
  const lower = answer.toLowerCase();
  const hasFallback = /couldn't find|don't have|no.*match|try rephrasing|haven't learned/i.test(answer);
  const isTaught = /got it.*i've learned|i'll remember this/i.test(answer);

  if (hasFallback) return { pass: false, reason: 'FALLBACK' };
  if (isTaught) return { pass: false, reason: 'TAUGHT (teach-handler misfire)' };
  if (answer.length < 50) return { pass: false, reason: 'TOO SHORT' };

  // Check keywords
  const matched = q.keywords.filter(kw => lower.includes(kw.toLowerCase()));
  if (matched.length === 0) return { pass: false, reason: `NO KEYWORDS (expected: ${q.keywords.join(', ')})` };

  return { pass: true, reason: `PASS (${matched.length}/${q.keywords.length} keywords)` };
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║     VAI MEGA TEST — 220 Questions from 21 Categories            ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

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

  // Use a fresh conversation per category batch to avoid conversation context pollution
  const categories = [...new Set(questions.map(q => q.cat))];
  const catResults = {};
  let totalPass = 0;
  let totalFail = 0;

  for (const cat of categories) {
    const catQs = questions.filter(q => q.cat === cat);
    const convId = await createConv(`MegaTest-${cat}`);
    catResults[cat] = { pass: 0, fail: 0, details: [] };

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  CATEGORY: ${cat} (${catQs.length} questions)`);
    console.log(`${'═'.repeat(70)}`);

    for (let i = 0; i < catQs.length; i++) {
      const cq = catQs[i];
      const globalIdx = questions.indexOf(cq) + 1;

      process.stdout.write(`\n  Q${String(globalIdx).padStart(3)}: ${cq.q.slice(0, 65)}${cq.q.length > 65 ? '...' : ''}  `);

      try {
        const answer = await chatWithVai(convId, cq.q);
        const result = evaluate(answer, cq);

        if (result.pass) {
          totalPass++;
          catResults[cat].pass++;
          process.stdout.write(`✅ ${result.reason}`);
        } else {
          totalFail++;
          catResults[cat].fail++;
          process.stdout.write(`❌ ${result.reason}`);
        }
        catResults[cat].details.push({
          idx: globalIdx,
          q: cq.q,
          pass: result.pass,
          reason: result.reason,
          answerLen: answer.length,
          answerPreview: answer.slice(0, 120).replace(/\n/g, ' '),
        });
      } catch (err) {
        totalFail++;
        catResults[cat].fail++;
        catResults[cat].details.push({ idx: globalIdx, q: cq.q, pass: false, reason: `ERROR: ${err.message}`, answerLen: 0 });
        process.stdout.write(`💥 ERROR: ${err.message.slice(0, 50)}`);
      }
    }

    console.log(`\n  ── ${cat}: ${catResults[cat].pass}/${catQs.length} passed`);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  FINAL REPORT
  // ═══════════════════════════════════════════════════════════════════
  const total = questions.length;
  const pct = ((totalPass / total) * 100).toFixed(1);

  console.log(`\n\n${'═'.repeat(70)}`);
  console.log('  MEGA TEST FINAL REPORT');
  console.log(`${'═'.repeat(70)}`);
  console.log(`\n  TOTAL: ${totalPass}/${total} passed (${pct}%)\n`);

  // Category breakdown
  console.log('  Category Breakdown:');
  console.log('  ─────────────────────────────────────────');

  for (const cat of categories) {
    const cr = catResults[cat];
    const catTotal = cr.pass + cr.fail;
    const icon = cr.fail === 0 ? '✅' : cr.pass === 0 ? '🔴' : '🟡';
    console.log(`  ${icon} ${cat.padEnd(20)} ${String(cr.pass).padStart(2)}/${String(catTotal).padStart(2)}`);
  }

  // Failed questions detail
  const failures = [];
  for (const cat of categories) {
    for (const d of catResults[cat].details) {
      if (!d.pass) failures.push(d);
    }
  }

  if (failures.length > 0) {
    console.log(`\n  FAILURES (${failures.length}):`);
    console.log('  ─────────────────────────────────────────');
    for (const f of failures) {
      console.log(`  Q${String(f.idx).padStart(3)}: ${f.q.slice(0, 55)}${f.q.length > 55 ? '...' : ''}`);
      console.log(`        ${f.reason}`);
      if (f.answerPreview) console.log(`        → "${f.answerPreview.slice(0, 80)}..."`);
    }
  }

  // Score card
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  SCORE: ${totalPass}/${total} (${pct}%)`);
  if (totalPass === total) console.log('  🏆 PERFECT SCORE — ALL 220 QUESTIONS ANSWERED');
  else if (totalPass >= 200) console.log('  🥇 EXCELLENT — 200+ questions correct');
  else if (totalPass >= 175) console.log('  🥈 VERY GOOD — 175+ questions correct');
  else if (totalPass >= 150) console.log('  🥉 GOOD — 150+ questions correct');
  else console.log('  📊 More work needed');
  console.log(`${'═'.repeat(70)}\n`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
