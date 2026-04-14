#!/usr/bin/env node
/**
 * bench-all.mjs — Unified VAI benchmark runner.
 *
 * Runs ALL benchmark suites in parallel using the parallel-query utility.
 * Reports per-suite scores, VPT metrics, and total wall-clock time.
 *
 * Usage:
 *   node scripts/bench-all.mjs              # all suites
 *   node scripts/bench-all.mjs mega         # single suite
 *   node scripts/bench-all.mjs mega prec    # multiple suites
 *
 * Suites: mega, precision, networking, live
 */
import { queryParallel, createConv, querySingle } from './lib/parallel-query.mjs';

const API = process.env.VAI_API ?? 'http://localhost:3006';
const CONCURRENCY = parseInt(process.env.BENCH_CONCURRENCY ?? '20', 10);

// ─── Suite Definitions ─────────────────────────────────────────
// Each suite is { name, questions: [{ q, keywords?, validate?, cat, desc? }] }

const suites = {};

// ── MEGA 220 (keyword-based) ──────────────────────────────────
suites.mega = {
  name: 'Mega-220',
  evaluator: 'keywords',
  questions: [
    // A. GENERAL KNOWLEDGE (20)
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
    // B. TYPESCRIPT / JAVASCRIPT (25)
    { q: 'What is TypeScript and why use it over JavaScript?', cat: 'B-typescript', keywords: ['type', 'static', 'superset'] },
    { q: 'What is the difference between interface and type in TypeScript?', cat: 'B-typescript', keywords: ['interface', 'type', 'extend', 'intersect'] },
    { q: 'Explain generics in TypeScript with an example.', cat: 'B-typescript', keywords: ['generic', '<t>', 'type parameter'] },
    { q: 'What are union types and intersection types in TypeScript?', cat: 'B-typescript', keywords: ['union', 'intersection', '|', '&'] },
    { q: 'How does async/await work in JavaScript?', cat: 'B-typescript', keywords: ['promise', 'async', 'await'] },
    { q: 'What is the difference between var, let, and const?', cat: 'B-typescript', keywords: ['block', 'scope', 'hoist'] },
    { q: 'Explain closures in JavaScript.', cat: 'B-typescript', keywords: ['closure', 'scope', 'function'] },
    { q: 'What is the event loop in JavaScript?', cat: 'B-typescript', keywords: ['event loop', 'call stack', 'queue'] },
    { q: 'What are Map and Set in JavaScript?', cat: 'B-typescript', keywords: ['map', 'set', 'key'] },
    { q: 'What is the Proxy object in JavaScript?', cat: 'B-typescript', keywords: ['proxy', 'handler', 'trap'] },
    { q: 'What is the difference between == and === in JavaScript?', cat: 'B-typescript', keywords: ['strict', 'coercion', 'type'] },
    { q: 'What are template literal types in TypeScript?', cat: 'B-typescript', keywords: ['template', 'literal', 'string'] },
    { q: 'What is the satisfies operator in TypeScript?', cat: 'B-typescript', keywords: ['satisfies', 'type', 'narrow'] },
    { q: 'What are decorators in TypeScript?', cat: 'B-typescript', keywords: ['decorator', '@', 'metadata'] },
    { q: 'What is the difference between unknown and any in TypeScript?', cat: 'B-typescript', keywords: ['unknown', 'any', 'type'] },
    { q: 'What is WeakRef in JavaScript?', cat: 'B-typescript', keywords: ['weakref', 'garbage', 'reference'] },
    { q: 'What is the Temporal API in JavaScript?', cat: 'B-typescript', keywords: ['temporal', 'date', 'time'] },
    { q: 'What is structuredClone()?', cat: 'B-typescript', keywords: ['structuredclone', 'deep', 'copy', 'clone'] },
    { q: 'What are AbortController and AbortSignal?', cat: 'B-typescript', keywords: ['abort', 'signal', 'controller'] },
    { q: 'What is the difference between for...in and for...of?', cat: 'B-typescript', keywords: ['for...in', 'for...of', 'key', 'value', 'enumerable', 'iterable'] },
    { q: 'What is the purpose of Symbol in JavaScript?', cat: 'B-typescript', keywords: ['symbol', 'unique', 'property'] },
    { q: 'What is a tagged template literal in JavaScript?', cat: 'B-typescript', keywords: ['tagged', 'template', 'literal'] },
    { q: 'Explain the module system in JavaScript (ESM vs CJS).', cat: 'B-typescript', keywords: ['esm', 'commonjs', 'import', 'require'] },
    { q: 'What is tree-shaking?', cat: 'B-typescript', keywords: ['tree', 'shaking', 'dead', 'code', 'unused'] },
    { q: 'What is a service worker?', cat: 'B-typescript', keywords: ['service worker', 'cache', 'offline', 'fetch'] },
    // C. REACT / NEXT.JS (20)
    { q: 'What is the difference between SSR and SSG in Next.js?', cat: 'C-react', keywords: ['ssr', 'ssg', 'server', 'static'] },
    { q: 'What are Server Components in React?', cat: 'C-react', keywords: ['server', 'component', 'client'] },
    { q: 'How does the Next.js App Router work?', cat: 'C-react', keywords: ['app', 'router', 'layout', 'page'] },
    { q: 'What is React Suspense?', cat: 'C-react', keywords: ['suspense', 'fallback', 'lazy', 'loading'] },
    { q: 'What is the useEffect hook in React?', cat: 'C-react', keywords: ['useeffect', 'side effect', 'lifecycle', 'effect'] },
    { q: 'How does React hydration work?', cat: 'C-react', keywords: ['hydration', 'server', 'client', 'render'] },
    { q: 'What is the Context API in React?', cat: 'C-react', keywords: ['context', 'provider', 'consumer'] },
    { q: 'What is the difference between useMemo and useCallback?', cat: 'C-react', keywords: ['usememo', 'usecallback', 'memoize'] },
    { q: 'What is ISR in Next.js?', cat: 'C-react', keywords: ['isr', 'incremental', 'static', 'regeneration'] },
    { q: 'What are React Server Actions?', cat: 'C-react', keywords: ['server action', 'use server', 'form'] },
    { q: 'How does the Next.js Image component optimize images?', cat: 'C-react', keywords: ['image', 'next/image', 'optimize', 'lazy'] },
    { q: 'What is the React Compiler?', cat: 'C-react', keywords: ['compiler', 'react', 'memo', 'automatic'] },
    { q: 'What is the difference between pages/ and app/ in Next.js?', cat: 'C-react', keywords: ['pages', 'app', 'router', 'layout'] },
    { q: 'What is useReducer in React?', cat: 'C-react', keywords: ['usereducer', 'dispatch', 'action', 'state'] },
    { q: 'What are custom hooks in React?', cat: 'C-react', keywords: ['custom hook', 'use', 'reuse', 'logic'] },
    { q: 'What is Next.js middleware?', cat: 'C-react', keywords: ['middleware', 'edge', 'request', 'response'] },
    { q: 'What are React Portals?', cat: 'C-react', keywords: ['portal', 'createportal', 'dom', 'modal'] },
    { q: 'What is React.forwardRef?', cat: 'C-react', keywords: ['forwardref', 'ref', 'component'] },
    { q: 'How does Next.js code splitting work?', cat: 'C-react', keywords: ['code split', 'dynamic', 'import', 'chunk'] },
    { q: 'What is the use hook in React?', cat: 'C-react', keywords: ['use', 'promise', 'context', 'hook'] },
    // D. CSS / TAILWIND (15)
    { q: 'What is Tailwind CSS?', cat: 'D-css', keywords: ['utility', 'css', 'class'] },
    { q: 'What is CSS Grid?', cat: 'D-css', keywords: ['grid', 'row', 'column', 'layout'] },
    { q: 'What is Flexbox?', cat: 'D-css', keywords: ['flex', 'direction', 'align', 'justify'] },
    { q: 'What is the CSS cascade?', cat: 'D-css', keywords: ['cascade', 'specificity', 'inherit'] },
    { q: 'What are CSS custom properties (variables)?', cat: 'D-css', keywords: ['custom property', '--', 'var('] },
    { q: 'What is the difference between em, rem, and px?', cat: 'D-css', keywords: ['em', 'rem', 'px', 'relative'] },
    { q: 'What is CSS-in-JS?', cat: 'D-css', keywords: ['css-in-js', 'styled', 'emotion', 'runtime'] },
    { q: 'What are CSS container queries?', cat: 'D-css', keywords: ['container', 'query', 'responsive'] },
    { q: 'What is the :has() selector in CSS?', cat: 'D-css', keywords: [':has', 'selector', 'parent'] },
    { q: 'What is clamp() in CSS?', cat: 'D-css', keywords: ['clamp', 'min', 'max', 'responsive'] },
    { q: 'What is the difference between Tailwind v3 and v4?', cat: 'D-css', keywords: ['v3', 'v4', 'css', 'config'] },
    { q: 'What is a design token?', cat: 'D-css', keywords: ['design token', 'variable', 'theme', 'color'] },
    { q: 'What is OKLCH color space?', cat: 'D-css', keywords: ['oklch', 'color', 'perceptual', 'hue'] },
    { q: 'How does Tailwind purge unused CSS?', cat: 'D-css', keywords: ['purge', 'content', 'unused', 'treeshake'] },
    { q: 'What is a CSS reset vs normalize?', cat: 'D-css', keywords: ['reset', 'normalize', 'default', 'browser'] },
    // E. DEVOPS / DOCKER / CI-CD (15)
    { q: 'What is Docker?', cat: 'E-devops', keywords: ['docker', 'container', 'image'] },
    { q: 'What is the difference between a Docker image and container?', cat: 'E-devops', keywords: ['image', 'container', 'instance', 'template'] },
    { q: 'What is a Dockerfile?', cat: 'E-devops', keywords: ['dockerfile', 'build', 'from', 'instruction'] },
    { q: 'What is Docker Compose?', cat: 'E-devops', keywords: ['compose', 'multi', 'service', 'yaml'] },
    { q: 'What is CI/CD?', cat: 'E-devops', keywords: ['continuous', 'integration', 'delivery', 'deployment'] },
    { q: 'What is GitHub Actions?', cat: 'E-devops', keywords: ['github', 'action', 'workflow', 'yaml'] },
    { q: 'What is Kubernetes?', cat: 'E-devops', keywords: ['kubernetes', 'k8s', 'container', 'orchestrat'] },
    { q: 'What is a reverse proxy?', cat: 'E-devops', keywords: ['reverse proxy', 'nginx', 'forward', 'request'] },
    { q: 'What is blue-green deployment?', cat: 'E-devops', keywords: ['blue', 'green', 'deployment', 'zero'] },
    { q: 'What is IaC (Infrastructure as Code)?', cat: 'E-devops', keywords: ['infrastructure', 'code', 'terraform', 'provision'] },
    { q: 'What is a CDN?', cat: 'E-devops', keywords: ['cdn', 'content', 'delivery', 'edge'] },
    { q: 'What is serverless computing?', cat: 'E-devops', keywords: ['serverless', 'function', 'lambda', 'scale'] },
    { q: 'What is a multi-stage Docker build?', cat: 'E-devops', keywords: ['multi-stage', 'build', 'layer', 'size'] },
    { q: 'What is Nginx?', cat: 'E-devops', keywords: ['nginx', 'web server', 'reverse proxy', 'http'] },
    { q: 'What is a load balancer?', cat: 'E-devops', keywords: ['load balanc', 'traffic', 'distribut', 'server'] },
    // F. DATABASES / ORM (10)
    { q: 'What is Prisma ORM?', cat: 'F-database', keywords: ['prisma', 'orm', 'schema', 'typescript'] },
    { q: 'What is SQL injection and how to prevent it?', cat: 'F-database', keywords: ['sql injection', 'parameterize', 'sanitize'] },
    { q: 'What is database normalization?', cat: 'F-database', keywords: ['normalization', 'normal form', '1nf', '2nf', '3nf'] },
    { q: 'What is an ORM?', cat: 'F-database', keywords: ['orm', 'object', 'relational', 'mapping'] },
    { q: 'What is PostgreSQL?', cat: 'F-database', keywords: ['postgresql', 'postgres', 'relational', 'database'] },
    { q: 'What is a database index?', cat: 'F-database', keywords: ['index', 'query', 'performance', 'b-tree'] },
    { q: 'What is the difference between SQL and NoSQL?', cat: 'F-database', keywords: ['sql', 'nosql', 'schema', 'document'] },
    { q: 'What is a database migration?', cat: 'F-database', keywords: ['migration', 'schema', 'version', 'change'] },
    { q: 'What is Redis?', cat: 'F-database', keywords: ['redis', 'cache', 'memory', 'key-value'] },
    { q: 'What is an ACID transaction?', cat: 'F-database', keywords: ['acid', 'atomic', 'consistent', 'isolation', 'durable'] },
    // G. AUTH / SECURITY (10)
    { q: 'What is NextAuth.js?', cat: 'G-auth', keywords: ['nextauth', 'auth', 'provider', 'session'] },
    { q: 'What is JWT?', cat: 'G-auth', keywords: ['jwt', 'json', 'web', 'token'] },
    { q: 'What is OAuth 2.0?', cat: 'G-auth', keywords: ['oauth', 'authorization', 'token', 'grant'] },
    { q: 'What is HTTPS?', cat: 'G-auth', keywords: ['https', 'tls', 'ssl', 'encrypt'] },
    { q: 'What is CORS?', cat: 'G-auth', keywords: ['cors', 'cross-origin', 'header', 'allow'] },
    { q: 'What is CSRF?', cat: 'G-auth', keywords: ['csrf', 'cross-site', 'request', 'forgery'] },
    { q: 'What is XSS?', cat: 'G-auth', keywords: ['xss', 'cross-site', 'script', 'inject'] },
    { q: 'What is two-factor authentication?', cat: 'G-auth', keywords: ['two-factor', '2fa', 'mfa', 'authenticat'] },
    { q: 'What is bcrypt?', cat: 'G-auth', keywords: ['bcrypt', 'hash', 'password', 'salt'] },
    { q: 'What is Content Security Policy?', cat: 'G-auth', keywords: ['content security policy', 'csp', 'header', 'script'] },
    // H. TESTING (10)
    { q: 'What is Vitest?', cat: 'H-testing', keywords: ['vitest', 'test', 'vite', 'fast'] },
    { q: 'What is the difference between unit and integration tests?', cat: 'H-testing', keywords: ['unit', 'integration', 'isolat'] },
    { q: 'What is test-driven development?', cat: 'H-testing', keywords: ['tdd', 'test', 'red', 'green', 'refactor'] },
    { q: 'What is mocking in tests?', cat: 'H-testing', keywords: ['mock', 'stub', 'fake', 'spy'] },
    { q: 'What is code coverage?', cat: 'H-testing', keywords: ['coverage', 'line', 'branch', 'percent'] },
    { q: 'What is Playwright?', cat: 'H-testing', keywords: ['playwright', 'browser', 'e2e', 'end-to-end'] },
    { q: 'What is snapshot testing?', cat: 'H-testing', keywords: ['snapshot', 'serialized', 'compare'] },
    { q: 'What is the testing trophy?', cat: 'H-testing', keywords: ['trophy', 'integration', 'unit', 'e2e', 'static'] },
    { q: 'What is a test fixture?', cat: 'H-testing', keywords: ['fixture', 'setup', 'test data', 'state'] },
    { q: 'What is component testing?', cat: 'H-testing', keywords: ['component', 'render', 'test', 'isolat'] },
    // I. RUST (10)
    { q: 'What is ownership in Rust?', cat: 'I-rust', keywords: ['ownership', 'move', 'scope', 'drop'] },
    { q: 'What is borrowing in Rust?', cat: 'I-rust', keywords: ['borrow', 'reference', '&', 'immutable'] },
    { q: 'What are lifetimes in Rust?', cat: 'I-rust', keywords: ['lifetime', "'a", 'reference', 'scope'] },
    { q: 'What is the Result type in Rust?', cat: 'I-rust', keywords: ['result', 'ok', 'err', 'error'] },
    { q: 'What is pattern matching in Rust?', cat: 'I-rust', keywords: ['match', 'pattern', 'arm', 'enum'] },
    { q: 'What are traits in Rust?', cat: 'I-rust', keywords: ['trait', 'impl', 'interface', 'method'] },
    { q: 'What is the borrow checker?', cat: 'I-rust', keywords: ['borrow checker', 'reference', 'lifetime', 'compile'] },
    { q: 'What is async/await in Rust?', cat: 'I-rust', keywords: ['async', 'await', 'tokio', 'future'] },
    { q: 'What is cargo in Rust?', cat: 'I-rust', keywords: ['cargo', 'build', 'package', 'crate'] },
    { q: 'What is unsafe code in Rust?', cat: 'I-rust', keywords: ['unsafe', 'raw pointer', 'ffi', 'dereference'] },
    // J. PYTHON (10)
    { q: 'What is the GIL in Python?', cat: 'J-python', keywords: ['gil', 'global interpreter lock', 'thread'] },
    { q: 'What is type hinting in Python?', cat: 'J-python', keywords: ['type hint', 'annotation', 'int', 'str'] },
    { q: 'What is FastAPI?', cat: 'J-python', keywords: ['fastapi', 'api', 'async', 'pydantic'] },
    { q: 'What is asyncio in Python?', cat: 'J-python', keywords: ['asyncio', 'async', 'await', 'event loop'] },
    { q: 'What are Python decorators?', cat: 'J-python', keywords: ['decorator', '@', 'wrapper', 'function'] },
    { q: 'What is a Python virtual environment?', cat: 'J-python', keywords: ['virtual', 'venv', 'environment', 'isolat'] },
    { q: 'What is list comprehension in Python?', cat: 'J-python', keywords: ['list comprehension', 'for', 'bracket', 'expression'] },
    { q: 'What is the difference between a list and tuple in Python?', cat: 'J-python', keywords: ['list', 'tuple', 'mutable', 'immutable'] },
    { q: 'What is pip in Python?', cat: 'J-python', keywords: ['pip', 'package', 'install', 'pypi'] },
    { q: 'What is Django?', cat: 'J-python', keywords: ['django', 'web', 'framework', 'python'] },
    // K. GO (10)
    { q: 'What are goroutines in Go?', cat: 'K-go', keywords: ['goroutine', 'concurrent', 'lightweight', 'thread'] },
    { q: 'What are channels in Go?', cat: 'K-go', keywords: ['channel', 'goroutine', 'send', 'receive'] },
    { q: 'How does error handling work in Go?', cat: 'K-go', keywords: ['error', 'nil', 'return', 'if err'] },
    { q: 'What are interfaces in Go?', cat: 'K-go', keywords: ['interface', 'method', 'implicit', 'implement'] },
    { q: 'What is the defer keyword in Go?', cat: 'K-go', keywords: ['defer', 'function', 'stack', 'cleanup'] },
    { q: 'What are Go modules?', cat: 'K-go', keywords: ['module', 'go.mod', 'dependency', 'version'] },
    { q: 'What is a slice in Go?', cat: 'K-go', keywords: ['slice', 'array', 'dynamic', 'append'] },
    { q: 'What is the select statement in Go?', cat: 'K-go', keywords: ['select', 'channel', 'case', 'block'] },
    { q: 'What is the sync package in Go?', cat: 'K-go', keywords: ['sync', 'mutex', 'waitgroup', 'concurrent'] },
    { q: 'What is a Go struct?', cat: 'K-go', keywords: ['struct', 'field', 'method', 'type'] },
    // L. WCAG / ACCESSIBILITY (10)
    { q: 'What is WCAG?', cat: 'L-wcag', keywords: ['wcag', 'web content', 'accessibility', 'guideline'] },
    { q: 'What are the POUR principles?', cat: 'L-wcag', keywords: ['perceivable', 'operable', 'understandable', 'robust'] },
    { q: 'What is ARIA?', cat: 'L-wcag', keywords: ['aria', 'accessible', 'rich', 'internet'] },
    { q: 'What is the difference between WCAG 2.1 and 2.2?', cat: 'L-wcag', keywords: ['2.1', '2.2', 'criteria', 'new'] },
    { q: 'What is a screen reader?', cat: 'L-wcag', keywords: ['screen reader', 'blind', 'assistive', 'technology'] },
    { q: 'What is the alt attribute?', cat: 'L-wcag', keywords: ['alt', 'image', 'text', 'description'] },
    { q: 'What is keyboard accessibility?', cat: 'L-wcag', keywords: ['keyboard', 'focus', 'tab', 'navigation'] },
    { q: 'What is color contrast ratio?', cat: 'L-wcag', keywords: ['contrast', 'ratio', '4.5', 'color'] },
    { q: 'What is the purpose of semantic HTML?', cat: 'L-wcag', keywords: ['semantic', 'html', 'meaning', 'element'] },
    { q: 'What is a focus trap?', cat: 'L-wcag', keywords: ['focus trap', 'modal', 'keyboard', 'escape'] },
    // M. GDPR / PRIVACY (5)
    { q: 'What is GDPR?', cat: 'M-gdpr', keywords: ['gdpr', 'data', 'protection', 'regulation'] },
    { q: 'What is the right to be forgotten?', cat: 'M-gdpr', keywords: ['right', 'erasure', 'delete', 'forgotten'] },
    { q: 'What is data minimization?', cat: 'M-gdpr', keywords: ['data minimization', 'necessary', 'purpose'] },
    { q: 'What is a DPO?', cat: 'M-gdpr', keywords: ['dpo', 'data protection officer', 'officer'] },
    { q: 'What is cookie consent under GDPR?', cat: 'M-gdpr', keywords: ['cookie', 'consent', 'opt-in', 'track'] },
    // N. NORWEGIAN WEB STANDARD (10)
    { q: 'What is universell utforming?', cat: 'N-norway', keywords: ['universell', 'utforming', 'accessibility', 'tilgjengelig'] },
    { q: 'What is the Norwegian requirement for web accessibility?', cat: 'N-norway', keywords: ['wcag', 'uu', 'lov', 'likestilling', 'tilgjengelig'] },
    { q: 'What is UUTILSYNET?', cat: 'N-norway', keywords: ['uutilsynet', 'tilsyn', 'universell', 'utforming'] },
    { q: 'What is the Digdir standard?', cat: 'N-norway', keywords: ['digdir', 'digital', 'forvaltning', 'standard'] },
    { q: 'What is bokmål and nynorsk?', cat: 'N-norway', keywords: ['bokmål', 'nynorsk', 'language', 'norwegian'] },
    { q: 'What is the Norwegian MVP 2026 web requirement?', cat: 'N-norway', keywords: ['mvp', '2026', 'wcag', 'norway'] },
    { q: 'What is ID-porten?', cat: 'N-norway', keywords: ['id-porten', 'login', 'identity', 'norwegian'] },
    { q: 'What is Altinn?', cat: 'N-norway', keywords: ['altinn', 'government', 'service', 'digital'] },
    { q: 'What is Bring API for shipping in Norway?', cat: 'N-norway', keywords: ['bring', 'shipping', 'api', 'post'] },
    { q: 'What is Vipps?', cat: 'N-norway', keywords: ['vipps', 'payment', 'mobile', 'norway'] },
    // O. MONOREPO / ARCHITECTURE (5)
    { q: 'What is Turborepo?', cat: 'O-monorepo', keywords: ['turborepo', 'monorepo', 'build', 'cache'] },
    { q: 'What are pnpm workspaces?', cat: 'O-monorepo', keywords: ['pnpm', 'workspace', 'monorepo', 'package'] },
    { q: 'What is a monorepo?', cat: 'O-monorepo', keywords: ['monorepo', 'repository', 'package', 'code'] },
    { q: 'What is the difference between monorepo and polyrepo?', cat: 'O-monorepo', keywords: ['monorepo', 'polyrepo', 'repository'] },
    { q: 'What is Nx?', cat: 'O-monorepo', keywords: ['nx', 'monorepo', 'build', 'graph'] },
    // P. VUE / ANGULAR / WORDPRESS (10)
    { q: 'What is the Vue 3 Composition API?', cat: 'P-vue-angular', keywords: ['composition', 'ref', 'reactive', 'setup'] },
    { q: 'What is Angular?', cat: 'P-vue-angular', keywords: ['angular', 'component', 'typescript', 'module'] },
    { q: 'What are Angular Signals?', cat: 'P-vue-angular', keywords: ['signal', 'angular', 'reactive', 'fine-grained'] },
    { q: 'What is headless WordPress?', cat: 'P-vue-angular', keywords: ['headless', 'wordpress', 'api', 'frontend'] },
    { q: 'What is Nuxt.js?', cat: 'P-vue-angular', keywords: ['nuxt', 'vue', 'ssr', 'framework'] },
    { q: 'What is Svelte?', cat: 'P-vue-angular', keywords: ['svelte', 'compiler', 'reactive', 'virtual dom'] },
    { q: 'What is SvelteKit?', cat: 'P-vue-angular', keywords: ['sveltekit', 'svelte', 'ssr', 'routing'] },
    { q: 'What is Pinia?', cat: 'P-vue-angular', keywords: ['pinia', 'vue', 'store', 'state'] },
    { q: 'What is the Angular CLI?', cat: 'P-vue-angular', keywords: ['angular', 'cli', 'generate', 'build'] },
    { q: 'What is Vue Router?', cat: 'P-vue-angular', keywords: ['vue router', 'route', 'navigation', 'guard'] },
    // Q. 3D / ANIMATION (5)
    { q: 'What is Three.js?', cat: 'Q-3d', keywords: ['three', 'js', '3d', 'webgl'] },
    { q: 'What is GSAP?', cat: 'Q-3d', keywords: ['gsap', 'animation', 'tween', 'timeline'] },
    { q: 'What is Framer Motion?', cat: 'Q-3d', keywords: ['framer', 'motion', 'animation', 'react'] },
    { q: 'What is WebGL?', cat: 'Q-3d', keywords: ['webgl', 'gpu', '3d', 'canvas'] },
    { q: 'What is Lottie?', cat: 'Q-3d', keywords: ['lottie', 'animation', 'json', 'bodymovin'] },
    // R. STATE MANAGEMENT (5)
    { q: 'What is Zustand?', cat: 'R-state', keywords: ['zustand', 'store', 'state', 'react'] },
    { q: 'What is Jotai?', cat: 'R-state', keywords: ['jotai', 'atom', 'state', 'react'] },
    { q: 'What is Redux?', cat: 'R-state', keywords: ['redux', 'store', 'action', 'reducer'] },
    { q: 'What is the difference between Zustand and Redux?', cat: 'R-state', keywords: ['zustand', 'redux', 'boilerplate', 'simple'] },
    { q: 'What is React Query / TanStack Query?', cat: 'R-state', keywords: ['react query', 'tanstack', 'cache', 'server state'] },
    // S. BUILD TOOLS (5)
    { q: 'What is Vite?', cat: 'S-build', keywords: ['vite', 'dev server', 'hmr', 'esm'] },
    { q: 'What is Turbopack?', cat: 'S-build', keywords: ['turbopack', 'next', 'webpack', 'fast'] },
    { q: 'What is esbuild?', cat: 'S-build', keywords: ['esbuild', 'fast', 'bundler', 'go'] },
    { q: 'What is Webpack?', cat: 'S-build', keywords: ['webpack', 'bundle', 'loader', 'plugin'] },
    { q: 'What is Rollup?', cat: 'S-build', keywords: ['rollup', 'esm', 'bundle', 'tree'] },
    // T. MISC STACK (10)
    { q: 'What is tRPC?', cat: 'T-misc', keywords: ['trpc', 'type-safe', 'api', 'rpc'] },
    { q: 'What is Zod?', cat: 'T-misc', keywords: ['zod', 'schema', 'validation', 'type'] },
    { q: 'What is shadcn/ui?', cat: 'T-misc', keywords: ['shadcn', 'ui', 'component', 'radix'] },
    { q: 'What is a PWA?', cat: 'T-misc', keywords: ['pwa', 'progressive', 'web app', 'offline'] },
    { q: 'What is Tauri?', cat: 'T-misc', keywords: ['tauri', 'rust', 'desktop', 'webview'] },
    { q: 'What is WebAssembly?', cat: 'T-misc', keywords: ['webassembly', 'wasm', 'binary', 'performance'] },
    { q: 'What is Drizzle ORM?', cat: 'T-misc', keywords: ['drizzle', 'orm', 'typescript', 'sql'] },
    { q: 'What is Astro?', cat: 'T-misc', keywords: ['astro', 'islands', 'static', 'content'] },
    { q: 'What is Bun?', cat: 'T-misc', keywords: ['bun', 'runtime', 'fast', 'bundler'] },
    { q: 'What is Deno?', cat: 'T-misc', keywords: ['deno', 'runtime', 'typescript', 'secure'] },
    // U. NORWAY HISTORY (10)
    { q: 'What happened at Stiklestad in 1030?', cat: 'U-norway-hist', keywords: ['olav', 'battle', 'viking', 'saint'] },
    { q: 'When did Norway gain independence from Sweden?', cat: 'U-norway-hist', keywords: ['1905', 'union', 'independence'] },
    { q: 'Who was Roald Amundsen?', cat: 'U-norway-hist', keywords: ['amundsen', 'south pole', 'explorer'] },
    { q: 'What is 17. mai in Norway?', cat: 'U-norway-hist', keywords: ['constitution', 'national', 'day', '1814'] },
    { q: 'What happened in Norway during World War II?', cat: 'U-norway-hist', keywords: ['occupation', 'german', 'resistance', 'quisling'] },
    { q: 'When was oil discovered in the Norwegian North Sea?', cat: 'U-norway-hist', keywords: ['oil', 'north sea', '1969', 'ekofisk'] },
    { q: 'What is the Sami Parliament (Sametinget)?', cat: 'U-norway-hist', keywords: ['sami', 'sametinget', 'indigenous', 'parliament'] },
    { q: 'Who was Fridtjof Nansen?', cat: 'U-norway-hist', keywords: ['nansen', 'explorer', 'polar', 'nobel'] },
    { q: 'What is the history of Bergen?', cat: 'U-norway-hist', keywords: ['bergen', 'hanseatic', 'bryggen', 'trade'] },
    { q: 'What is the Norwegian Storting?', cat: 'U-norway-hist', keywords: ['storting', 'parliament', 'legislative', 'law'] },
  ],
};

// ── PRECISION 33 (validator-based) ────────────────────────────
suites.precision = {
  name: 'Precision-33',
  evaluator: 'validate',
  questions: [
    { q: 'what is the factorial of 7', cat: 'exact-math', validate: (r) => /5,?040/.test(r), desc: 'Factorial 7! = 5040' },
    { q: 'what is the GCD of 48 and 18', cat: 'exact-math', validate: (r) => /\b6\b/.test(r) && /gcd/i.test(r), desc: 'GCD(48,18) = 6' },
    { q: 'what is the 10th fibonacci number', cat: 'exact-math', validate: (r) => /\b55\b/.test(r), desc: 'Fibonacci(10) = 55' },
    { q: 'what is the square root of 144', cat: 'exact-math', validate: (r) => /\b12\b/.test(r), desc: '√144 = 12' },
    { q: 'convert 255 to binary', cat: 'base-convert', validate: (r) => /11111111/.test(r), desc: '255→binary' },
    { q: 'convert binary 10110 to decimal', cat: 'base-convert', validate: (r) => /\b22\b/.test(r), desc: '10110→22' },
    { q: 'convert hex FF to decimal', cat: 'base-convert', validate: (r) => /\b255\b/.test(r), desc: 'FF→255' },
    { q: 'decode hex 56 41 49', cat: 'base-convert', validate: (r) => /VAI/i.test(r), desc: '56 41 49→VAI' },
    { q: 'write a recursive factorial function in python', cat: 'recursive-algo', validate: (r) => /```python/.test(r) && /def\s+factorial/i.test(r.toLowerCase()) && /n\s*\*\s*factorial\(n\s*-\s*1\)/i.test(r.toLowerCase()), desc: 'recursive factorial py' },
    { q: 'write a recursive fibonacci function in javascript', cat: 'recursive-algo', validate: (r) => /```javascript/.test(r) && /function\s+fib/i.test(r.toLowerCase()) && /fib\(n\s*-\s*1\)\s*\+\s*fib\(n\s*-\s*2\)/i.test(r.toLowerCase()), desc: 'recursive fib js' },
    { q: 'write a recursive GCD function using Euclid\'s algorithm in python', cat: 'recursive-algo', validate: (r) => /```python/.test(r) && /def\s+gcd/i.test(r.toLowerCase()) && /gcd\(b\s*,\s*a\s*%\s*b\)/i.test(r.toLowerCase()), desc: 'recursive GCD py' },
    { q: 'write a recursive power function in javascript', cat: 'recursive-algo', validate: (r) => /```javascript/.test(r) && /function\s+power/i.test(r.toLowerCase()), desc: 'recursive power js' },
    { q: 'write bubble sort in python', cat: 'sort-algo', validate: (r) => /```python/.test(r) && /def\s+bubble.?sort/i.test(r.toLowerCase()) && /swap|arr\[/.test(r.toLowerCase()), desc: 'bubble sort py' },
    { q: 'write selection sort in javascript', cat: 'sort-algo', validate: (r) => /```javascript/.test(r) && /function\s+selection.?sort/i.test(r.toLowerCase()), desc: 'selection sort js' },
    { q: 'write insertion sort in python', cat: 'sort-algo', validate: (r) => /```python/.test(r) && /def\s+insertion.?sort/i.test(r.toLowerCase()), desc: 'insertion sort py' },
    { q: 'write merge sort in javascript', cat: 'sort-algo', validate: (r) => /```javascript/.test(r) && /function\s+merge.?sort/i.test(r.toLowerCase()), desc: 'merge sort js' },
    { q: 'write binary search in python', cat: 'search-algo', validate: (r) => /```python/.test(r) && /def\s+binary.?search/i.test(r.toLowerCase()) && /mid|middle/i.test(r.toLowerCase()), desc: 'binary search py' },
    { q: 'implement a stack in javascript', cat: 'data-struct', validate: (r) => /```javascript/.test(r) && /push|pop/i.test(r.toLowerCase()) && /class\s+stack/i.test(r.toLowerCase()), desc: 'stack js' },
    { q: 'implement a queue in python', cat: 'data-struct', validate: (r) => /```python/.test(r) && /enqueue|dequeue/.test(r.toLowerCase()) && /class\s+queue/i.test(r.toLowerCase()), desc: 'queue py' },
    { q: 'implement a binary search tree in javascript with insert and search methods', cat: 'data-struct', validate: (r) => /```javascript/.test(r) && /class/i.test(r) && /insert/i.test(r) && /search|find/i.test(r), desc: 'BST js' },
    { q: 'write a function to reverse a string in python', cat: 'string-proc', validate: (r) => /```python/.test(r) && /def\s+reverse/i.test(r.toLowerCase()) && /\[::\s*-1\]|reversed|reverse/i.test(r.toLowerCase()), desc: 'reverse string py' },
    { q: 'write a function to check if a string is a palindrome in javascript', cat: 'string-proc', validate: (r) => /```javascript/.test(r) && /function\s+.*palindrome/i.test(r.toLowerCase()) && /reverse|split/i.test(r.toLowerCase()), desc: 'palindrome js' },
    { q: 'write a function to count vowels in a string in python', cat: 'string-proc', validate: (r) => /```python/.test(r) && /def\s+count.*vowel/i.test(r.toLowerCase()) && /[aeiou]/i.test(r), desc: 'count vowels py' },
    { q: 'write a function to check if two strings are anagrams in javascript', cat: 'string-proc', validate: (r) => /```javascript/.test(r) && /function\s+.*anagram/i.test(r.toLowerCase()) && /sort|map|count/i.test(r.toLowerCase()), desc: 'anagram check js' },
    { q: 'write a function to check if a number is prime in python', cat: 'math-func', validate: (r) => /```python/.test(r) && /def\s+is.?prime/i.test(r.toLowerCase()) && /%|mod/i.test(r.toLowerCase()), desc: 'is_prime py' },
    { q: 'write the sieve of eratosthenes in javascript', cat: 'math-func', validate: (r) => /```javascript/.test(r) && /function\s+sieve/i.test(r.toLowerCase()) && /true|false|boolean/i.test(r.toLowerCase()), desc: 'sieve js' },
    { q: 'write a function to find the LCM of two numbers in python', cat: 'math-func', validate: (r) => /```python/.test(r) && /def\s+lcm/i.test(r.toLowerCase()) && /gcd|\/\//i.test(r.toLowerCase()), desc: 'LCM py' },
    { q: 'write a function to find the maximum number in an array in javascript without using Math.max', cat: 'math-func', validate: (r) => /```javascript/.test(r) && /function\s+find.?max/i.test(r.toLowerCase()) && /for|reduce/i.test(r.toLowerCase()), desc: 'find_max js' },
    { q: 'write a function to flatten a nested array in javascript', cat: 'utility-func', validate: (r) => /```javascript/.test(r) && /function\s+flatten/i.test(r.toLowerCase()) && /array|concat|isarray|push|recursive/i.test(r.toLowerCase()), desc: 'flatten array js' },
    { q: 'write a function to transpose a matrix in python', cat: 'utility-func', validate: (r) => /```python/.test(r) && /def\s+transpose/i.test(r.toLowerCase()) && /zip|\[i\]\[j\]|\[j\]\[i\]/i.test(r.toLowerCase()), desc: 'transpose matrix py' },
    { q: 'what is 15% of 240', cat: 'combo-math', validate: (r) => /\b36\b/.test(r), desc: '15% of 240 = 36' },
    { q: 'what is 2 to the power of 10', cat: 'combo-math', validate: (r) => /1,?024/.test(r), desc: '2^10 = 1024' },
    { q: 'what is the LCM of 12 and 18', cat: 'combo-math', validate: (r) => /\b36\b/.test(r), desc: 'LCM(12,18) = 36' },
  ],
};

// ── Evaluate a result ─────────────────────────────────────────
function evaluateResult(answer, question, suiteEvaluator) {
  const lower = answer.toLowerCase();
  const hasFallback = /couldn't find|don't have|no.*match|try rephrasing|haven't learned/i.test(answer);

  // Validation function (precision/networking/live)
  if (typeof question.validate === 'function') {
    if (hasFallback) return { pass: false, reason: 'FALLBACK' };
    const pass = question.validate(answer);
    return { pass, reason: pass ? 'PASS' : 'FAIL' };
  }

  // Keyword matching (mega-200)
  if (question.keywords) {
    if (hasFallback) return { pass: false, reason: 'FALLBACK' };
    const isTaught = /got it.*i've learned|i'll remember this/i.test(answer);
    if (isTaught) return { pass: false, reason: 'TAUGHT-MISFIRE' };
    if (answer.length < 50) return { pass: false, reason: 'TOO SHORT' };
    const matched = question.keywords.filter(kw => lower.includes(kw.toLowerCase()));
    if (matched.length === 0) return { pass: false, reason: `NO KEYWORDS` };
    return { pass: true, reason: `${matched.length}/${question.keywords.length}kw` };
  }

  return { pass: false, reason: 'NO EVALUATOR' };
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const selectedSuites = args.length > 0
    ? args.map(a => a.toLowerCase())
    : Object.keys(suites);

  // Validate suite names
  for (const s of selectedSuites) {
    if (!suites[s]) {
      console.error(`Unknown suite: ${s}. Available: ${Object.keys(suites).join(', ')}`);
      process.exit(1);
    }
  }

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║       VAI BENCH-ALL — Parallel Unified Benchmark        ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // Health check
  try {
    const h = await fetch(`${API}/health`);
    if (!h.ok) throw new Error(`HTTP ${h.status}`);
    const s = await h.json();
    console.log(`  Server: vocab=${s.stats?.vocabSize ?? s.vocabSize ?? '?'}, knowledge=${s.stats?.knowledgeEntries ?? s.knowledgeEntries ?? '?'}`);
  } catch (e) {
    console.error(`  ✗ Server not reachable: ${e.message}`);
    process.exit(1);
  }

  const totalStart = performance.now();
  const suiteResults = {};
  let totalPass = 0;
  let totalFail = 0;
  let totalQuestions = 0;
  let totalDurationMs = 0;
  let totalTokens = 0;

  for (const suiteName of selectedSuites) {
    const suite = suites[suiteName];
    const questions = suite.questions;
    totalQuestions += questions.length;

    console.log(`\n  ─── ${suite.name} (${questions.length}q, concurrency=${CONCURRENCY}) ───`);
    const suiteStart = performance.now();

    // Pre-create one conversation PER question to avoid SQLite write contention.
    // Conversations are cheap (one row insert), and this prevents history pollution
    // + WAL lock contention from 80 concurrent writes to the same conversation.
    const convIds = await Promise.all(
      questions.map((_, i) => createConv(`Bench-${suite.name}-Q${i}`))
    );

    let completed = 0;
    let suitePass = 0;
    let suiteFail = 0;
    const details = [];

    const results = await queryParallel(
      questions.map((q, i) => ({ ...q, convId: convIds[i] })),
      {
        concurrency: CONCURRENCY,
        onResult: (result, idx, total) => {
          const evalResult = evaluateResult(result.answer, questions[idx], suite.evaluator);
          const icon = evalResult.pass ? '✅' : '❌';
          if (evalResult.pass) suitePass++; else suiteFail++;
          completed++;
          details.push({ idx, q: result.question, pass: evalResult.pass, reason: evalResult.reason, durationMs: result.durationMs, answerLen: result.answer.length });

          // Compact progress
          if (completed % 20 === 0 || completed === total) {
            process.stdout.write(`\r    ${completed}/${total}  [${suitePass}✅ ${suiteFail}❌]`);
          }
        },
      },
    );

    const suiteMs = Math.round(performance.now() - suiteStart);
    const suitePct = ((suitePass / questions.length) * 100).toFixed(1);
    console.log(`\r    ${suite.name}: ${suitePass}/${questions.length} (${suitePct}%) in ${suiteMs}ms`);

    // VPT per suite
    const suiteTotalMs = results.reduce((s, r) => s + r.durationMs, 0);
    const suiteAvgMs = Math.round(suiteTotalMs / results.length);
    totalDurationMs += suiteTotalMs;

    suiteResults[suiteName] = {
      name: suite.name,
      pass: suitePass,
      fail: suiteFail,
      total: questions.length,
      wallMs: suiteMs,
      avgMs: suiteAvgMs,
      details,
    };
    totalPass += suitePass;
    totalFail += suiteFail;
  }

  const totalWallMs = Math.round(performance.now() - totalStart);

  // ─── REPORT ─────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  BENCH-ALL RESULTS');
  console.log(`${'═'.repeat(60)}\n`);

  for (const [key, sr] of Object.entries(suiteResults)) {
    const pct = ((sr.pass / sr.total) * 100).toFixed(1);
    const icon = sr.fail === 0 ? '🟢' : sr.pass / sr.total >= 0.9 ? '🟡' : '🔴';
    console.log(`  ${icon} ${sr.name.padEnd(20)} ${String(sr.pass).padStart(3)}/${String(sr.total).padStart(3)} (${pct}%)  wall=${sr.wallMs}ms  avg=${sr.avgMs}ms`);

    // Show category breakdown
    const cats = {};
    for (const d of sr.details) {
      const cat = suites[key].questions[d.idx]?.cat ?? 'unknown';
      if (!cats[cat]) cats[cat] = { pass: 0, total: 0 };
      cats[cat].total++;
      if (d.pass) cats[cat].pass++;
    }
    for (const [cat, cs] of Object.entries(cats).sort((a, b) => a[0].localeCompare(b[0]))) {
      const cpct = ((cs.pass / cs.total) * 100).toFixed(0);
      const ci = cs.pass === cs.total ? '  ✓' : ' ✗';
      console.log(`    ${ci} ${cat.padEnd(18)} ${cs.pass}/${cs.total} (${cpct}%)`);
    }
  }

  // VPT Summary
  const avgMs = totalDurationMs > 0 ? Math.round(totalDurationMs / totalQuestions) : 0;
  const throughput = totalWallMs > 0 ? ((totalQuestions / totalWallMs) * 1000).toFixed(1) : 0;
  const passRate = ((totalPass / totalQuestions) * 100).toFixed(1);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  TOTAL:      ${totalPass}/${totalQuestions} (${passRate}%)`);
  console.log(`  WALL TIME:  ${totalWallMs}ms (${(totalWallMs / 1000).toFixed(1)}s)`);
  console.log(`  THROUGHPUT: ${throughput} questions/sec`);
  console.log(`  AVG LATENCY: ${avgMs}ms per question`);
  console.log(`${'─'.repeat(60)}`);

  if (totalFail === 0) {
    console.log(`\n  🏆 PERFECT SCORE — ${totalPass}/${totalQuestions}\n`);
  } else {
    // Show failures
    const allFailures = [];
    for (const [key, sr] of Object.entries(suiteResults)) {
      for (const d of sr.details) {
        if (!d.pass) allFailures.push({ suite: sr.name, ...d });
      }
    }
    if (allFailures.length <= 100) {
      console.log(`\n  FAILURES (${allFailures.length}):`);
      for (const f of allFailures) {
        console.log(`    ${f.suite}: ${f.q.slice(0, 50)} — ${f.reason}`);
      }
    } else {
      console.log(`\n  ${allFailures.length} failures (use specific suite for details)`);
    }
    console.log();
  }

  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
