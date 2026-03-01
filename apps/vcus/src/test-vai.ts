/**
 * VCUS Test Framework — Test VAI's Code Understanding
 *
 * Tests VAI by:
 * 1. Asking questions about ingested repos (pattern recognition)
 * 2. Asking VAI to generate code (sandbox execution)
 * 3. Grading answers against expected patterns
 * 4. For each pattern, 4 variant questions to verify deep understanding
 *
 * Usage:
 *   tsx src/test-vai.ts                    # run all tests
 *   tsx src/test-vai.ts --suite lawn       # run tests for specific repo
 *   tsx src/test-vai.ts --generate lawn    # generate tests from ingested repo
 */

const BASE = process.env.VAI_URL || 'http://localhost:3006';

// ─── Test Types ─────────────────────────────────────────────────

interface TestQuestion {
  id: string;
  category: string;       // 'pattern' | 'code-gen' | 'architecture' | 'concept' | 'debug'
  repo?: string;          // which repo this tests knowledge of
  question: string;
  /** Keywords that MUST appear in a correct answer */
  requiredKeywords: string[];
  /** Keywords that SHOULD appear (bonus) */
  bonusKeywords?: string[];
  /** Patterns that should NOT appear (wrong answers) */
  antiPatterns?: string[];
  /** Minimum word count for a valid answer */
  minWords?: number;
  /** Variant index (1-4) — each pattern has 4 variants */
  variant?: number;
  /** Description of what this tests */
  tests: string;
}

interface TestResult {
  question: TestQuestion;
  answer: string;
  score: number;        // 0-100
  passed: boolean;
  matchedKeywords: string[];
  missedKeywords: string[];
  matchedAntiPatterns: string[];
  feedback: string;
}

// ─── Question Banks ─────────────────────────────────────────────

/**
 * Generate a "short question" — a focused, Google-friendly question.
 * Short questions are: specific, 3-10 words, ask ONE thing, no preamble.
 */
function makeShortQuestion(topic: string): string {
  // Strip filler words and make it search-engine friendly
  return topic
    .replace(/^(?:can you |please |could you |what is |tell me about )/i, '')
    .replace(/[?!.]+$/, '')
    .trim() + '?';
}

/**
 * Core questions that test understanding of modern web dev patterns.
 * Each pattern has 4 variants to ensure deep learning, not just memorization.
 */
const CORE_QUESTIONS: TestQuestion[] = [
  // ─── React Component Patterns ───
  {
    id: 'comp-variant-1',
    category: 'pattern',
    question: 'What is a variant prop in a React component and how is it typically implemented?',
    requiredKeywords: ['variant', 'prop', 'component'],
    bonusKeywords: ['cva', 'class-variance-authority', 'tailwind', 'className', 'default'],
    minWords: 20,
    variant: 1,
    tests: 'Understanding of component variant patterns'
  },
  {
    id: 'comp-variant-2',
    category: 'pattern',
    question: 'How does shadcn/ui implement button variants using cva?',
    requiredKeywords: ['variant', 'button'],
    bonusKeywords: ['cva', 'class-variance-authority', 'default', 'destructive', 'outline', 'ghost', 'secondary'],
    minWords: 20,
    variant: 2,
    tests: 'Specific shadcn/ui variant implementation'
  },
  {
    id: 'comp-variant-3',
    category: 'pattern',
    question: 'Write a React button component with size and variant props using Tailwind CSS.',
    requiredKeywords: ['button', 'variant', 'size'],
    bonusKeywords: ['className', 'default', 'props', 'React', 'tailwind'],
    minWords: 15,
    variant: 3,
    tests: 'Code generation for variant pattern'
  },
  {
    id: 'comp-variant-4',
    category: 'pattern',
    question: 'What is class-variance-authority (cva) and why would you use it instead of manual className conditionals?',
    requiredKeywords: ['variant'],
    bonusKeywords: ['cva', 'type-safe', 'className', 'tailwind', 'reusable'],
    minWords: 20,
    variant: 4,
    tests: 'Understanding WHY variant patterns exist'
  },

  // ─── Next.js App Router ───
  {
    id: 'nextjs-approuter-1',
    category: 'architecture',
    question: 'What is the difference between the Next.js pages directory and the app directory?',
    requiredKeywords: ['app', 'page'],
    bonusKeywords: ['server component', 'layout', 'routing', 'file-based', 'React Server'],
    minWords: 20,
    variant: 1,
    tests: 'Next.js routing architecture'
  },
  {
    id: 'nextjs-approuter-2',
    category: 'architecture',
    question: 'How does file-based routing work in Next.js app directory?',
    requiredKeywords: ['file', 'route', 'app'],
    bonusKeywords: ['page.tsx', 'layout.tsx', 'loading.tsx', 'error.tsx', 'folder', 'dynamic'],
    minWords: 20,
    variant: 2,
    tests: 'Specific app router file conventions'
  },
  {
    id: 'nextjs-approuter-3',
    category: 'architecture',
    question: 'What are React Server Components and how does Next.js use them by default?',
    requiredKeywords: ['server', 'component'],
    bonusKeywords: ['client', 'use client', 'default', 'SSR', 'hydration', 'bundle'],
    minWords: 20,
    variant: 3,
    tests: 'RSC understanding'
  },
  {
    id: 'nextjs-approuter-4',
    category: 'code-gen',
    question: 'Write a Next.js app router layout.tsx that wraps children with a navigation header.',
    requiredKeywords: ['layout', 'children'],
    bonusKeywords: ['export default', 'ReactNode', 'nav', 'header', 'metadata'],
    minWords: 10,
    variant: 4,
    tests: 'Code generation for Next.js layout'
  },

  // ─── tRPC ───
  {
    id: 'trpc-1',
    category: 'concept',
    question: 'What is tRPC and what problem does it solve?',
    requiredKeywords: ['type', 'safe'],
    bonusKeywords: ['API', 'end-to-end', 'TypeScript', 'client', 'server', 'procedure', 'router'],
    minWords: 20,
    variant: 1,
    tests: 'tRPC concept understanding'
  },
  {
    id: 'trpc-2',
    category: 'pattern',
    question: 'How do you define a tRPC router with a query and a mutation?',
    requiredKeywords: ['router', 'query'],
    bonusKeywords: ['mutation', 'procedure', 'publicProcedure', 'input', 'zod', 'context'],
    minWords: 15,
    variant: 2,
    tests: 'tRPC router pattern'
  },
  {
    id: 'trpc-3',
    category: 'code-gen',
    question: 'Write a simple tRPC router with a getUser query that takes an ID input.',
    requiredKeywords: ['router', 'query'],
    bonusKeywords: ['publicProcedure', 'input', 'z.', 'zod', 'ctx', 'id'],
    minWords: 10,
    variant: 3,
    tests: 'tRPC code generation'
  },
  {
    id: 'trpc-4',
    category: 'architecture',
    question: 'How does tRPC achieve end-to-end type safety without code generation?',
    requiredKeywords: ['type'],
    bonusKeywords: ['infer', 'TypeScript', 'runtime', 'schema', 'zod', 'no codegen'],
    minWords: 20,
    variant: 4,
    tests: 'tRPC deep understanding'
  },

  // ─── T3 Stack ───
  {
    id: 't3-1',
    category: 'concept',
    question: 'What is the T3 Stack and what technologies does it include?',
    requiredKeywords: ['Next.js'],
    bonusKeywords: ['tRPC', 'Prisma', 'Tailwind', 'TypeScript', 'NextAuth', 'Drizzle', 'full-stack'],
    minWords: 20,
    variant: 1,
    tests: 'T3 stack knowledge'
  },
  {
    id: 't3-2',
    category: 'architecture',
    question: 'How does create-t3-app structure its project?',
    requiredKeywords: ['src'],
    bonusKeywords: ['server', 'api', 'trpc', 'pages', 'app', 'env', 'prisma'],
    minWords: 15,
    variant: 2,
    tests: 'T3 project structure'
  },
  {
    id: 't3-3',
    category: 'concept',
    question: 'Why is the T3 Stack considered typesafe from database to frontend?',
    requiredKeywords: ['type'],
    bonusKeywords: ['Prisma', 'tRPC', 'zod', 'infer', 'end-to-end', 'schema', 'TypeScript'],
    minWords: 20,
    variant: 3,
    tests: 'T3 type safety understanding'
  },
  {
    id: 't3-4',
    category: 'code-gen',
    question: 'Show a T3 stack API route using tRPC with Prisma to fetch a list of posts.',
    requiredKeywords: ['router'],
    bonusKeywords: ['prisma', 'query', 'publicProcedure', 'findMany', 'post', 'ctx'],
    minWords: 10,
    variant: 4,
    tests: 'T3 code generation'
  },

  // ─── Tailwind CSS ───
  {
    id: 'tw-1',
    category: 'concept',
    question: 'What is Tailwind CSS and how does it differ from traditional CSS frameworks?',
    requiredKeywords: ['utility', 'class'],
    bonusKeywords: ['CSS', 'responsive', 'design', 'custom', 'JIT', 'purge', 'arbitrary'],
    minWords: 20,
    variant: 1,
    tests: 'Tailwind concept'
  },
  {
    id: 'tw-2',
    category: 'pattern',
    question: 'How do you handle responsive design in Tailwind CSS?',
    requiredKeywords: ['responsive'],
    bonusKeywords: ['sm:', 'md:', 'lg:', 'xl:', 'breakpoint', 'mobile-first', 'prefix'],
    minWords: 15,
    variant: 2,
    tests: 'Tailwind responsive pattern'
  },
  {
    id: 'tw-3',
    category: 'code-gen',
    question: 'Write a responsive card component using Tailwind CSS classes.',
    requiredKeywords: ['class'],
    bonusKeywords: ['rounded', 'shadow', 'p-', 'flex', 'grid', 'md:', 'hover:', 'bg-'],
    minWords: 10,
    variant: 3,
    tests: 'Tailwind code generation'
  },
  {
    id: 'tw-4',
    category: 'pattern',
    question: 'How does the cn() utility function work and why is it used with Tailwind?',
    requiredKeywords: ['class', 'merge'],
    bonusKeywords: ['cn', 'clsx', 'tailwind-merge', 'conditional', 'className', 'conflict'],
    minWords: 15,
    variant: 4,
    tests: 'cn() utility understanding'
  },

  // ─── Monorepo / Turborepo ───
  {
    id: 'mono-1',
    category: 'architecture',
    question: 'What is a monorepo and what are its advantages?',
    requiredKeywords: ['monorepo'],
    bonusKeywords: ['packages', 'workspace', 'shared', 'dependencies', 'turborepo', 'pnpm'],
    minWords: 20,
    variant: 1,
    tests: 'Monorepo concept'
  },
  {
    id: 'mono-2',
    category: 'pattern',
    question: 'How does Turborepo handle caching and task dependencies?',
    requiredKeywords: ['cache'],
    bonusKeywords: ['turbo', 'pipeline', 'hash', 'remote', 'parallel', 'dependsOn', 'outputs'],
    minWords: 15,
    variant: 2,
    tests: 'Turborepo caching pattern'
  },
  {
    id: 'mono-3',
    category: 'concept',
    question: 'What is the difference between internal packages and published packages in a monorepo?',
    requiredKeywords: ['package'],
    bonusKeywords: ['workspace:', 'internal', 'published', 'npm', 'private', 'shared', 'import'],
    minWords: 15,
    variant: 3,
    tests: 'Package types in monorepo'
  },
  {
    id: 'mono-4',
    category: 'code-gen',
    question: 'Write a pnpm-workspace.yaml for a monorepo with apps and packages directories.',
    requiredKeywords: ['packages'],
    bonusKeywords: ['apps', 'pnpm-workspace', 'yaml', 'workspace'],
    minWords: 3,
    variant: 4,
    tests: 'pnpm workspace config generation'
  },

  // ─── Database / Prisma / Drizzle ───
  {
    id: 'db-1',
    category: 'concept',
    question: 'What is Prisma and how does it provide type-safe database access?',
    requiredKeywords: ['Prisma'],
    bonusKeywords: ['schema', 'type', 'generate', 'client', 'migration', 'model', 'ORM'],
    minWords: 20,
    variant: 1,
    tests: 'Prisma concept'
  },
  {
    id: 'db-2',
    category: 'pattern',
    question: 'How do you define a Prisma schema with a User model that has posts?',
    requiredKeywords: ['model'],
    bonusKeywords: ['User', 'Post', 'relation', '@id', 'String', 'Int', 'DateTime'],
    minWords: 10,
    variant: 2,
    tests: 'Prisma schema pattern'
  },
  {
    id: 'db-3',
    category: 'code-gen',
    question: 'Write a Prisma schema for a blog with User, Post, and Comment models.',
    requiredKeywords: ['model'],
    bonusKeywords: ['User', 'Post', 'Comment', 'relation', '@id', '@relation', 'author'],
    minWords: 10,
    variant: 3,
    tests: 'Prisma schema generation'
  },
  {
    id: 'db-4',
    category: 'concept',
    question: 'What is the difference between Prisma and Drizzle ORM?',
    requiredKeywords: ['ORM'],
    bonusKeywords: ['Prisma', 'Drizzle', 'schema', 'type', 'SQL', 'performance', 'lightweight'],
    minWords: 20,
    variant: 4,
    tests: 'ORM comparison knowledge'
  },

  // ─── API Design ───
  {
    id: 'api-1',
    category: 'concept',
    question: 'What is REST and what are the main HTTP methods?',
    requiredKeywords: ['GET', 'POST'],
    bonusKeywords: ['PUT', 'DELETE', 'PATCH', 'REST', 'resource', 'endpoint', 'status code'],
    minWords: 15,
    variant: 1,
    tests: 'REST basics'
  },
  {
    id: 'api-2',
    category: 'concept',
    question: 'What are the differences between REST and GraphQL?',
    requiredKeywords: ['REST'],
    bonusKeywords: ['GraphQL', 'query', 'mutation', 'over-fetching', 'under-fetching', 'schema', 'endpoint'],
    minWords: 20,
    variant: 2,
    tests: 'API paradigm comparison'
  },
  {
    id: 'api-3',
    category: 'pattern',
    question: 'How does Next.js handle API routes in the app directory?',
    requiredKeywords: ['route'],
    bonusKeywords: ['route.ts', 'GET', 'POST', 'NextRequest', 'NextResponse', 'app', 'handler'],
    minWords: 15,
    variant: 3,
    tests: 'Next.js API routes pattern'
  },
  {
    id: 'api-4',
    category: 'code-gen',
    question: 'Write a Next.js API route handler that accepts POST requests with JSON body.',
    requiredKeywords: ['POST'],
    bonusKeywords: ['NextRequest', 'NextResponse', 'json', 'export', 'async', 'route.ts'],
    minWords: 10,
    variant: 4,
    tests: 'API route code generation'
  },

  // ─── Authentication ───
  {
    id: 'auth-1',
    category: 'concept',
    question: 'What is NextAuth.js and how does it handle authentication?',
    requiredKeywords: ['auth'],
    bonusKeywords: ['NextAuth', 'provider', 'session', 'callback', 'JWT', 'OAuth', 'adapter'],
    minWords: 20,
    variant: 1,
    tests: 'NextAuth concept'
  },
  {
    id: 'auth-2',
    category: 'pattern',
    question: 'How do you protect a page or API route with authentication in Next.js?',
    requiredKeywords: ['auth', 'session'],
    bonusKeywords: ['getServerSession', 'middleware', 'redirect', 'protect', 'useSession'],
    minWords: 15,
    variant: 2,
    tests: 'Auth protection pattern'
  },

  // ─── E-commerce Patterns (Medusa/Commerce) ───
  {
    id: 'ecom-1',
    category: 'architecture',
    question: 'How is a headless e-commerce system typically architected?',
    requiredKeywords: ['headless'],
    bonusKeywords: ['API', 'frontend', 'backend', 'storefront', 'admin', 'cart', 'product'],
    minWords: 20,
    variant: 1,
    tests: 'Headless commerce architecture'
  },
  {
    id: 'ecom-2',
    category: 'concept',
    question: 'What is Medusa.js and how does it compare to Shopify?',
    requiredKeywords: ['commerce'],
    bonusKeywords: ['Medusa', 'open-source', 'headless', 'API', 'plugin', 'customizable'],
    minWords: 20,
    variant: 2,
    tests: 'Medusa knowledge'
  },

  // ─── Chat App Patterns ───
  {
    id: 'chat-1',
    category: 'pattern',
    question: 'What are the key components of a chat application architecture?',
    requiredKeywords: ['message'],
    bonusKeywords: ['WebSocket', 'real-time', 'conversation', 'history', 'streaming', 'model'],
    minWords: 20,
    variant: 1,
    tests: 'Chat app architecture'
  },
  {
    id: 'chat-2',
    category: 'pattern',
    question: 'How does a ChatGPT-style streaming response work in a web application?',
    requiredKeywords: ['stream'],
    bonusKeywords: ['SSE', 'WebSocket', 'token', 'chunk', 'real-time', 'EventSource'],
    minWords: 15,
    variant: 2,
    tests: 'Streaming chat pattern'
  },

  // ─── Short Question Understanding ───
  {
    id: 'short-q-1',
    category: 'concept',
    question: 'What is a "short question" for search engines? Give examples.',
    requiredKeywords: ['question', 'search'],
    bonusKeywords: ['specific', 'concise', 'keyword', 'Google', 'query'],
    minWords: 15,
    variant: 1,
    tests: 'Short question concept'
  },
  {
    id: 'short-q-2',
    category: 'concept',
    question: 'Convert this to a short Google query: "I want to know how to set up authentication in a Next.js application using NextAuth"',
    requiredKeywords: ['NextAuth'],
    bonusKeywords: ['setup', 'Next.js', 'auth'],
    antiPatterns: ['I want to know', 'I would like'],
    minWords: 3,
    variant: 2,
    tests: 'Short question generation'
  },

  // ─── Scaling React Apps ───
  {
    id: 'scale-1',
    category: 'architecture',
    question: 'How do you implement code splitting and lazy loading in a React application?',
    requiredKeywords: ['lazy', 'import'],
    bonusKeywords: ['Suspense', 'React.lazy', 'dynamic', 'bundle', 'route', 'split'],
    minWords: 20,
    variant: 1,
    tests: 'Code splitting knowledge'
  },
  {
    id: 'scale-2',
    category: 'pattern',
    question: 'How do you render a list of 10000 items efficiently in React?',
    requiredKeywords: ['virtual'],
    bonusKeywords: ['react-window', 'TanStack', 'virtualize', 'visible', 'overscan', 'performance'],
    minWords: 15,
    variant: 2,
    tests: 'Virtual list pattern'
  },
  {
    id: 'scale-3',
    category: 'concept',
    question: 'What is React.memo and when should you use it?',
    requiredKeywords: ['memo', 're-render'],
    bonusKeywords: ['props', 'comparison', 'performance', 'skip', 'React.memo', 'shallow'],
    minWords: 15,
    variant: 3,
    tests: 'React.memo understanding'
  },
  {
    id: 'scale-4',
    category: 'pattern',
    question: 'What is the difference between useMemo and useCallback in React?',
    requiredKeywords: ['useMemo', 'useCallback'],
    bonusKeywords: ['memoize', 'function', 'value', 'reference', 'dependency', 'render'],
    minWords: 15,
    variant: 4,
    tests: 'Hook optimization patterns'
  },

  // ─── UI/UX Polish ───
  {
    id: 'uiux-1',
    category: 'pattern',
    question: 'What is a skeleton loading screen and how do you build one with Tailwind?',
    requiredKeywords: ['skeleton', 'loading'],
    bonusKeywords: ['animate-pulse', 'placeholder', 'layout', 'perceived', 'bg-zinc', 'rounded'],
    minWords: 15,
    variant: 1,
    tests: 'Skeleton screen pattern'
  },
  {
    id: 'uiux-2',
    category: 'pattern',
    question: 'How do you implement toast notifications in a React app?',
    requiredKeywords: ['toast'],
    bonusKeywords: ['sonner', 'notification', 'success', 'error', 'position', 'Toaster'],
    minWords: 15,
    variant: 2,
    tests: 'Toast notification pattern'
  },
  {
    id: 'uiux-3',
    category: 'code-gen',
    question: 'Write a React ErrorBoundary component that shows a fallback and retry button.',
    requiredKeywords: ['error', 'boundary'],
    bonusKeywords: ['getDerivedStateFromError', 'fallback', 'retry', 'children', 'render', 'catch'],
    minWords: 15,
    variant: 3,
    tests: 'Error boundary code generation'
  },
  {
    id: 'uiux-4',
    category: 'concept',
    question: 'What are empty states in UI design and why are they important?',
    requiredKeywords: ['empty'],
    bonusKeywords: ['state', 'data', 'action', 'user', 'helpful', 'CTA', 'onboarding'],
    minWords: 15,
    variant: 4,
    tests: 'Empty state UX knowledge'
  },

  // ─── Responsive Design ───
  {
    id: 'resp-1',
    category: 'pattern',
    question: 'How does mobile-first responsive design work in Tailwind CSS?',
    requiredKeywords: ['mobile', 'breakpoint'],
    bonusKeywords: ['sm:', 'md:', 'lg:', 'first', 'responsive', 'prefix', 'screen'],
    minWords: 15,
    variant: 1,
    tests: 'Mobile-first responsive pattern'
  },
  {
    id: 'resp-2',
    category: 'code-gen',
    question: 'Write a responsive sidebar layout that collapses on mobile using Tailwind.',
    requiredKeywords: ['sidebar'],
    bonusKeywords: ['hidden', 'md:', 'flex', 'translate', 'mobile', 'overlay', 'w-64'],
    minWords: 15,
    variant: 2,
    tests: 'Responsive sidebar code generation'
  },

  // ─── State Management ───
  {
    id: 'state-1',
    category: 'pattern',
    question: 'How do Zustand selectors help with React performance?',
    requiredKeywords: ['selector', 're-render'],
    bonusKeywords: ['Zustand', 'subscribe', 'shallow', 'store', 'performance', 'specific'],
    minWords: 15,
    variant: 1,
    tests: 'Zustand selector pattern'
  },
  {
    id: 'state-2',
    category: 'architecture',
    question: 'How do you split a large Zustand store into slices?',
    requiredKeywords: ['slice', 'store'],
    bonusKeywords: ['Zustand', 'create', 'combine', 'interface', 'middleware', 'persist'],
    minWords: 15,
    variant: 2,
    tests: 'Zustand store slicing'
  },

  // ─── Accessibility ───
  {
    id: 'a11y-1',
    category: 'concept',
    question: 'What are the most important accessibility practices for React web apps?',
    requiredKeywords: ['accessible'],
    bonusKeywords: ['ARIA', 'semantic', 'keyboard', 'screen reader', 'focus', 'label', 'contrast'],
    minWords: 20,
    variant: 1,
    tests: 'Accessibility fundamentals'
  },

  // ─── Design System ───
  {
    id: 'design-1',
    category: 'architecture',
    question: 'How do you build a component-based design system with Tailwind and React?',
    requiredKeywords: ['component', 'design'],
    bonusKeywords: ['token', 'CSS variable', 'consistent', 'primitive', 'theme', 'reusable'],
    minWords: 20,
    variant: 1,
    tests: 'Design system architecture'
  },
];

// ─── Test Runner ────────────────────────────────────────────────

/**
 * Send a question to VAI and get the response.
 */
async function askVai(question: string, conversationId?: string): Promise<{ answer: string; convId: string }> {
  // Create conversation if needed
  let convId = conversationId;
  if (!convId) {
    const res = await fetch(`${BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: 'vai:v0', title: 'VCUS Test' }),
    });
    const conv = await res.json() as { id: string };
    convId = conv.id;
  }

  // Use HTTP chat endpoint (not WebSocket for scripted tests)
  // We'll use the REST-style approach: send message, collect response
  const res = await fetch(`${BASE}/api/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: question }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    // Fallback: use direct engine chat
    const chatRes = await fetch(`${BASE}/api/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vai:v0',
        messages: [{ role: 'user', content: question }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!chatRes.ok) throw new Error(`Chat failed: ${chatRes.status}`);
    const data = await chatRes.json() as { choices?: Array<{ message?: { content: string } }> };
    return { answer: data.choices?.[0]?.message?.content ?? '', convId: convId! };
  }

  const data = await res.json() as { content?: string; assistant?: { content: string } };
  return { answer: data.content ?? data.assistant?.content ?? '', convId: convId! };
}

/**
 * Grade VAI's answer against expected criteria.
 */
function gradeAnswer(question: TestQuestion, answer: string): TestResult {
  const lower = answer.toLowerCase();
  const words = answer.split(/\s+/).filter(Boolean);

  // Check required keywords
  const matchedRequired: string[] = [];
  const missedRequired: string[] = [];
  for (const kw of question.requiredKeywords) {
    if (lower.includes(kw.toLowerCase())) {
      matchedRequired.push(kw);
    } else {
      missedRequired.push(kw);
    }
  }

  // Check bonus keywords
  const matchedBonus: string[] = [];
  for (const kw of question.bonusKeywords ?? []) {
    if (lower.includes(kw.toLowerCase())) {
      matchedBonus.push(kw);
    }
  }

  // Check anti-patterns
  const matchedAnti: string[] = [];
  for (const ap of question.antiPatterns ?? []) {
    if (lower.includes(ap.toLowerCase())) {
      matchedAnti.push(ap);
    }
  }

  // Calculate score
  let score = 0;

  // Required keywords: 60% of score
  const reqScore = question.requiredKeywords.length > 0
    ? (matchedRequired.length / question.requiredKeywords.length) * 60
    : 60;
  score += reqScore;

  // Bonus keywords: 25% of score
  const bonusTotal = question.bonusKeywords?.length ?? 0;
  const bonusScore = bonusTotal > 0
    ? (matchedBonus.length / bonusTotal) * 25
    : 15; // default bonus if no bonus keywords defined
  score += bonusScore;

  // Word count: 10% of score
  const minWords = question.minWords ?? 10;
  const wordScore = words.length >= minWords ? 10 : (words.length / minWords) * 10;
  score += wordScore;

  // Anti-pattern penalty: -15 per match
  score -= matchedAnti.length * 15;

  // No-answer penalty
  if (answer.length < 10 || lower.includes("i don't know") || lower.includes('i do not know')) {
    score = Math.min(score, 15);
  }

  // Clamp
  score = Math.max(0, Math.min(100, Math.round(score)));

  const passed = score >= 50;

  // Generate feedback
  let feedback = '';
  if (passed) {
    if (score >= 80) feedback = '✅ Excellent understanding';
    else if (score >= 65) feedback = '✅ Good, but could be more detailed';
    else feedback = '⚠️ Passing, but needs improvement';
  } else {
    if (missedRequired.length > 0) {
      feedback = `❌ Missing key concepts: ${missedRequired.join(', ')}`;
    } else if (words.length < minWords) {
      feedback = `❌ Answer too short (${words.length} words, need ${minWords}+)`;
    } else {
      feedback = '❌ Answer does not demonstrate understanding';
    }
  }

  return {
    question,
    answer,
    score,
    passed,
    matchedKeywords: [...matchedRequired, ...matchedBonus],
    missedKeywords: missedRequired.length > 0 ? missedRequired : [],
    matchedAntiPatterns: matchedAnti,
    feedback,
  };
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const suiteFilter = args.includes('--suite') ? args[args.indexOf('--suite') + 1] : null;

  // Check server
  try {
    await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error('❌ VAI server not running at', BASE);
    process.exit(1);
  }

  let questions = CORE_QUESTIONS;
  if (suiteFilter) {
    questions = questions.filter(q => q.repo === suiteFilter || q.id.startsWith(suiteFilter));
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  🧪 VCUS Knowledge Test — ${questions.length} questions`);
  console.log(`${'═'.repeat(60)}\n`);

  const results: TestResult[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    process.stdout.write(`  [${i + 1}/${questions.length}] ${q.id}: `);

    try {
      // Use a fresh conversation for each question to avoid history pollution
      const { answer } = await askVai(q.question);
      const result = gradeAnswer(q, answer);
      results.push(result);

      const icon = result.passed ? (result.score >= 80 ? '🟢' : '🟡') : '🔴';
      console.log(`${icon} ${result.score}/100 — ${result.feedback}`);

      if (!result.passed) {
        console.log(`     Q: ${q.question}`);
        console.log(`     A: ${answer.slice(0, 150)}${answer.length > 150 ? '...' : ''}`);
      }
    } catch (err) {
      console.log(`💥 Error: ${(err as Error).message}`);
      results.push({
        question: q,
        answer: '',
        score: 0,
        passed: false,
        matchedKeywords: [],
        missedKeywords: q.requiredKeywords,
        matchedAntiPatterns: [],
        feedback: `Error: ${(err as Error).message}`,
      });
    }

    // Small delay between questions
    await new Promise(r => setTimeout(r, 100));
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const avgScore = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
    : 0;

  // Group by category
  const byCategory: Record<string, TestResult[]> = {};
  for (const r of results) {
    const cat = r.question.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(r);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  📊 TEST RESULTS`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Total:   ${results.length} questions`);
  console.log(`  Passed:  ${passed} (${Math.round(passed / results.length * 100)}%)`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Average: ${avgScore}/100`);

  console.log(`\n  By Category:`);
  for (const [cat, res] of Object.entries(byCategory)) {
    const catPassed = res.filter(r => r.passed).length;
    const catAvg = Math.round(res.reduce((s, r) => s + r.score, 0) / res.length);
    console.log(`    ${cat.padEnd(15)} ${catPassed}/${res.length} passed, avg ${catAvg}/100`);
  }

  // By variant (shows if VAI consistently knows patterns)
  const byVariant: Record<number, TestResult[]> = {};
  for (const r of results) {
    const v = r.question.variant ?? 0;
    if (!byVariant[v]) byVariant[v] = [];
    byVariant[v].push(r);
  }

  if (Object.keys(byVariant).length > 1) {
    console.log(`\n  By Variant (pattern depth):`);
    for (const [v, res] of Object.entries(byVariant).sort()) {
      const vPassed = res.filter(r => r.passed).length;
      const vAvg = Math.round(res.reduce((s, r) => s + r.score, 0) / res.length);
      console.log(`    Variant ${v}:  ${vPassed}/${res.length} passed, avg ${vAvg}/100`);
    }
  }

  console.log(`\n${'═'.repeat(60)}\n`);

  // Failed questions detail
  if (failed > 0) {
    console.log('  Failed Questions:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    ${r.question.id}: ${r.feedback}`);
      console.log(`      Missing: ${r.missedKeywords.join(', ') || 'N/A'}`);
    }
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
