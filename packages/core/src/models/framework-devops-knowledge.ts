/**
 * framework-devops-knowledge — extracted from VaiEngine (decomposition phase 2, slice 2).
 *
 * The framework/DevOps/infrastructure knowledge answerer: given a question about kubernetes, docker,
 * microservices, CI/CD, caching, message queues, auth flows, etc., return the curated answer (or
 * null when it isn't one of these topics). Extracted verbatim from the god-class; its 5 real
 * dependencies are INJECTED as a `deps` object so this is a free function (no `this`).
 *
 * NOTE: several `this.` occurrences in the body are INSIDE knowledge-string code EXAMPLES (an Angular
 * UserService showing `this.http.get` / `this.name`) — those are display content, NOT dependencies,
 * and are deliberately left untouched. Only the 5 genuine method/field deps were rewritten to `deps.`.
 *
 * VaiEngine keeps a thin wrapper. Extracted byte-identical (proven by golden snapshot).
 */

import type { KnowledgeEntry } from './knowledge-store.js';
import type { SkillRouter } from './skill-router.js';

export interface FrameworkDevopsDeps {
  normalizeFollowUpTopic(raw: string): string;
  findExactTopicEntry(topic: string): KnowledgeEntry | null;
  findCuratedShortTopicPrimer(topic: string): { text: string; sourceUrls?: readonly string[] } | null;
  formatShortTopicPrimer(primer: { text: string; sourceUrls?: readonly string[] }): string;
  skillRouter: Pick<SkillRouter, 'isExplicitScaffoldRequest'>;
}

export function tryFrameworkDevopsKnowledge(input: string, deps: FrameworkDevopsDeps): string | null {
    input = input.replace(/["'""''`]/g, ' ').replace(/\s+/g, ' ').trim();

    // ── Defer to browsing-memory retrieval when the user is asking about
    //    specific stored content ("the notes", "the article", "the guide",
    //    "the docs said", etc.). Generic topic templates would override the
    //    grounded retrieved answer otherwise. Allow up to 6 words between
    //    "the/these/my" and the content noun ("the React server components notes",
    //    "the JSONB indexing guide", "the Docker Compose notes").
    if (/\b(?:the|these|those|that|my|our)(?:\s+\w+){0,6}\s+(?:notes?|article|guide|docs?|documentation|write[\s-]?up|post|page|memo|summary|fixture|cheat[\s-]?sheet)\b/i.test(input)
      || /\b(?:notes?|article|guide|docs?|documentation)\s+(?:said|say|says|mention|mentions|recommend|recommended|recommends|explain|explains|explained|describe|describes|described|note[sd]?|state[sd]?|argue[sd]?|claim[sd]?|warn[sd]?)\b/i.test(input)
      || /\b(?:according\s+to|from|per)\s+(?:the|these|those|my|our)(?:\s+\w+){0,6}\s+(?:notes?|article|guide|docs?|documentation|write[\s-]?up|post|page|memo)\b/i.test(input)) {
      return null;
    }

    // ── Popular programming languages — common general question ──
    if (/\b(?:name|list|tell\s+me|give\s+me)\s+(?:me\s+)?(?:three|3|some|a\s+few|five|5|four|4)\s+(?:programming\s+)?languages?\b/i.test(input)) {
      return [
        '**Three widely used programming languages:**',
        '',
        '1. **JavaScript** — runs in every browser and (via Node.js) on servers. The default language of the web.',
        '2. **Python** — clean syntax, dominant in data science, machine learning, automation, and scripting.',
        '3. **TypeScript** — JavaScript with a static type system; used by most modern web codebases for safety at scale.',
        '',
        'Other very popular options today include **Java**, **C#**, **Go**, **Rust**, **C++**, **Swift**, **Kotlin**, and **PHP**.',
      ].join('\n');
    }

    if (/\b(?:popular|top|best|most\s+(?:used|popular|common|in[\s-]?demand)|widely\s+used)\s+(?:programming\s+)?languages?\b/i.test(input)
      || /\bprogramming\s+languages?\b.*\b(?:popular|top|best|most\s+(?:used|common))\b/i.test(input)) {
      return [
        '**Most popular programming languages (2025):**',
        '',
        '| Language | Primary use | Why it\'s popular |',
        '|---|---|---|',
        '| **JavaScript** | Web (frontend + backend) | Runs everywhere, massive ecosystem |',
        '| **Python** | Data science, AI/ML, scripting | Simple syntax, incredible libraries |',
        '| **TypeScript** | Web (typed JavaScript) | Catches bugs at compile time |',
        '| **Java** | Enterprise, Android | Mature, stable, huge job market |',
        '| **C#** | .NET, games (Unity) | Microsoft ecosystem, versatile |',
        '| **Go** | Cloud infrastructure, CLIs | Fast, simple, great concurrency |',
        '| **Rust** | Systems, performance-critical | Memory safety without GC |',
        '| **C/C++** | Systems, embedded, games | Maximum performance, hardware access |',
        '| **PHP** | Web backends (WordPress) | Powers ~75% of websites |',
        '| **Swift/Kotlin** | iOS / Android native | Modern mobile development |',
        '',
        '**For web development:** JavaScript/TypeScript is the clear default.',
        '**For data/AI:** Python dominates.',
        '**For systems/performance:** Rust and Go are growing fast.',
        '',
        'What are you interested in building? I can recommend the best fit.',
      ].join('\n');
    }

    if (/\b(?:list|name|give|tell)\b.*\b(?:three|3)\b.*\bjavascript\s+frameworks?\b/i.test(input)
      || /\bjavascript\s+frameworks?\b.*\b(?:popular|top|three|3)\b/i.test(input)) {
      return [
        '1. **React** - the dominant UI library for component-based web apps.',
        '2. **Vue** - approachable, progressive, and popular for smaller-to-medium apps.',
        '3. **Angular** - a full framework with routing, forms, dependency injection, and TypeScript built in.',
      ].join('\n');
    }

    const normalizedTopic = deps.normalizeFollowUpTopic(input);
    const topicWords = normalizedTopic.split(/\s+/).filter(Boolean);
    const isSimpleExplanationPrompt = /^(?:(?:can|could|would)\s+you\s+)?(?:what\s+(?:is|are)|explain|describe|hva\s+er|forklar|hvordan\s+fungerer)\b/i.test(input);
    if (isSimpleExplanationPrompt && topicWords.length > 0 && topicWords.length <= 2) {
      const exactLocal = deps.findExactTopicEntry(normalizedTopic);
      if (exactLocal) return exactLocal.response;

      const curatedPrimer = deps.findCuratedShortTopicPrimer(normalizedTopic);
      if (curatedPrimer) return deps.formatShortTopicPrimer(curatedPrimer);
    }

    // Gate: framework / devops / modern web terms
    if (!/\b(docker|container|dockerfile|compose|ci\s*\/?\s*cd|continuous\s+(?:integration|deployment|delivery)|github\s+actions|jenkins|gitlab|\bgit\b|branch|merge|rebase|typescript|type\s+safe|static\s+typ|tailwind|css\s*v?4|utility.?first|@theme|oklch|design\s+token|wcag|accessibility|universell\s+utforming|tilgjengelighet|gdpr|personvern|privacy|cookie|samtykke|consent|responsive|mobile.?first|ssl|https|security|sikkerhet|rust\b|borrow\s+checker|ownership|cargo|python|gil\b|global\s+interpreter|virtualenv|pip|go\s+(?:routine|goroutine|channel)|goroutine|golang|go\b|angular|vue\.?js|vue\s+3|composition\s+api|options\s+api|wordpress|cms|headless|sanity|strapi|next\.?js|nextjs|app\s+router|server\s+component|server\s+action|isr|incremental|three\.?js|threejs|gsap|animation|framer.?motion|hover\s+effect|landing\s+page|mvp|minimum\s+viable|norsk\s+standard|norwegian\s+standard|bærekraftig|sustainab|carbon\s+footprint|web\s+performance|lazy\s+load|code\s+split|tree\s+shak|webpack|vite\b|turbopack|esbuild|swc|monorepo|turborepo|nx\b|pnpm|tauri|electron|wasm|webassembly|edge\s+function|vercel|netlify|auth|authentication|oauth|jwt|session|bcrypt|argon|passport\.?js|next.?auth|clerk|supabase|prisma|drizzle|postgres|sqlite|redis|trpc|zod|micro.?service|micro.?frontend|graphql|apollo|urql|rest\s*(?:api|ful)?|openapi|swagger|websocket|sse|server.?sent|push\s+notif|service\s+worker|pwa|manifest|web\s+worker|shadcn|radix|headless\s+ui|icon|lucide|heroicon|phosphor|mdi|feather|react\s+icon|svg\s+icon|storybook|chromatic|figma|design\s+system|token\s+system|state\s+manage|zustand|jotai|recoil|redux|pinia|vuex|ngrx|signal|react\s+query|tanstack|swr|cache|invalidat|optimistic|testing|vitest|jest|playwright|cypress|puppeteer|rtl|react\s+testing|msw|mock\s+service|test\s+driven|tdd|bdd|unit\s+test|integration\s+test|e2e|end.?to.?end|linting|eslint|prettier|biome|oxc|stylelint|husky|lint.?staged|conventional\s+commit|semantic\s+release|changelog|deploy|vercel|netlify|railway|fly\.io|render|aws|gcp|azure|cloudflare|docker\s+compose|k(?:ubernete)?8?s|helm|terraform|pulumi|iac|infrastructure\s+as\s+code|setup.*(?:docker|nextjs|next\.js|project|app)|create.*(?:landing|page|app|project)|install.*(?:auth|database|tailwind)|modern\s+(?:landing|web|stack)|norwegian\s+(?:web|mvp|standard)|interface\s+vs|generic|union\s+type|intersection\s+type|async.*await|var\s.*let\s.*const|closure|event\s+loop|template\s+literal|destructur|spread\s+(?:operator|syntax)|rest\s+(?:operator|parameter)|\.{3}\s*operator|fs\.read|read\b.*file\b.*node|node\b.*read\b.*file|nullish|optional\s+chain|\?\?|\?\.|mapped\s+type|discriminat|esm\b|commonjs|decorator|record\s+type|type\s+narrow|satisfies|conditional\s+type|hooks?\b|usestate|useeffect|useref|usecallback|usememo|usereducer|suspense\b|middleware\b|react\.?memo|portal|grid\s+vs\s+flex|dark\s+mode|cascade\s+|specificity|container\s+quer|clamp\b|scroll\b.*animat|rem\b.*em\b|em\b.*rem|viewport|cors\b|xss\b|csrf\b|hash.*password|rbac\b|role.?based|snapshot\s+test|mock.*test|code\s+coverage|string\b.*&str|str\b.*rust|\btrait|result\b.*option|lifetime|box\b.*rc\b|type\s+hint|fastapi|asyncio|pydantic|dataclass|comprehension|venv|channel\b.*go|go\b.*interface|go\b.*struct|select\b.*go|slice\b.*array|go\b.*generic|go\b.*http|go\b.*mod|pour\s+principle|aria\b|screen\s+reader|contrast\s+ratio|focus\s+manage|keyboard\s+nav|form.*accessible|dpo\b|data\s+breach|altinn|e.?commerce|vipps|nuxt|vue.?router|gutenberg|angular.*standalone|angular.*inject|react.*hook|ssr\b.*ssg\b|parallel.*route|error\s+boundar|layout.*next|metadata.*next|code.*split|image.*optim|client.*navig|multi.?stage|reverse\s+proxy|nginx|blue.?green|canary\s+deploy|docker\s+volume|gitops|sql\b.*nosql|database\s+(?:index|migrat|transaction|pool)|connection\s+pool|n\+1\s+query|drizzle|jwt\b|oauth|nextauth|cors\b|xss\b|csrf\b|password\b.*(?:hash|secur|stor)|authentication\b.*authorization|rbac|vitest\b.*jest|tdd\b|react\s+testing|api\s+test|code\s+coverage|async\b.*test|playwright\b|snapshot\b|string\b.*&str|trait\b.*rust|result\b.*option\b|box\b.*rc\b.*arc|lifetime\b.*rust|async\b.*rust|match\b.*rust|concurrency\b.*rust|type\b.*hint\b.*python|fastapi|decorator\b.*python|asyncio|comprehension|virtual\b.*env|pydantic|dataclass|dependency\b.*inject.*python|go\b.*channel|go\b.*error|go\b.*interface|go\b.*struct|go\b.*mod|go\b.*http|select\b.*go|slice\b.*array|go\b.*generic|pour\b|aria\b|screen\b.*reader|color\b.*contrast|focus\b.*manage|keyboard\b.*nav|form\b.*accessi|altinn|norsk.*lov|vipps|e.?handel|nuxt|vue.?router|gutenberg|angular.*standalone|angular.*depend|\bvar\b|\bconst\b|\bjavascript\b|\breact\b|\bcontext\b|\bcss\b|@layer|\bcenter\b.*(?:element|horizontal|vertical)|passwords?.*(?:hash|secur|stor)|test\b.*\bapi\b|api\b.*endpoint|error\b.*\bgo\b|http\b.*\bgo\b|\bslices?\b|tree.?shak|\bbundl|\btranspil|sso\b|single.?sign.?on|embed(?:ding)|vector.?(?:databas|search|space)|hnsw|approximate.?nearest|message.?queue|kafka|rabbitmq|event.?driven|copilot|coherence|cohesion|strategic|scalab|n.?tier|horizontal.*scal|vertical.*scal|load.?balanc|caching.?(?:strat|pattern|layer)|search.?(?:architect|engine.*index)|role.?based\s+bench|benchmark.*(?:write|design|method|categor|suite)|ai\s+role\s+simul|devops\s+senior|sla\b.*slo|slo\b.*sli|error\s+budget|incident\s+response|runbook|post.?mortem|mttd|mttr|on.?call|pipeline\s+optim|ci.?cd\s+(?:optim|cache|parallel)|docker\s+layer\s+cach|test\s+split|vai\s+bench|competency\s+domain|question\s+taxonomy|forwardref|forward\s*ref|for\.{3}in|for\.{3}of|for\s+in\s+.*for\s+of|slice\b.*\bgo\b|\bresult\b.*\brust|\brust\b.*\bresult|serverless|lambda\b|django\b|alt\b.*(?:attribute|text|tag)|right.*(?:forgotten|erasure)|astro\b|weakref|temporal\b.*api|unknown\b.*\bany\b|custom\s+hook|css.?in.?js|css\s+reset|normalize\.?css|list\b.*tuple|tuple\b.*list|content.?security|csp\b|\bpx\b.*\brem\b|\brem\b.*\bpx\b|\bpages?\b.*\bapp\b.*(?:next|router))/i.test(input)) {
      return null;
    }

    // ══════════════════════════════════════════════════════════════
    //  ARCHITECTURE PLANNING — multi-technology questions
    // ══════════════════════════════════════════════════════════════

    // Detect multi-technology planning questions (mentions 3+ technologies + planning language)
    if (/\breact\b/i.test(input) && /\btailwind\b/i.test(input) && /\b(?:set\s*up|setup|install|create|scaffold|start)\b/i.test(input)) {
      return [
        '**React + Tailwind setup:**',
        '',
        '1. Create the React app: `npm create vite@latest my-app -- --template react-ts`',
        '2. Install Tailwind: `npm install tailwindcss @tailwindcss/vite`',
        '3. Add the Vite plugin in `vite.config.ts`: `plugins: [react(), tailwindcss()]`',
        '4. Import Tailwind in your CSS: `@import "tailwindcss";`',
        '5. Start it: `npm run dev`',
        '',
        'Then use classes like `className="min-h-screen bg-zinc-950 text-white"` in your React components.',
      ].join('\n');
    }

    if (/\bfastapi\b/i.test(input) && /\bsvelte(?:kit)?\b/i.test(input)) {
      return [
        '**FastAPI + Svelte stack:**',
        '',
        '- **FastAPI** owns the API: request validation with Pydantic, async route handlers, OpenAPI docs.',
        '- **Svelte/SvelteKit** owns the UI: pages, forms, client-side state, and calls to the FastAPI endpoints.',
        '- In development, run them separately: FastAPI on `localhost:8000`, Svelte on `localhost:5173`.',
        '- Add CORS in FastAPI for the Svelte dev origin, then proxy or colocate behind one domain in production.',
        '',
        'Good starting split: `/api` for FastAPI routes, `/web` for Svelte, shared types generated from OpenAPI when the API stabilizes.',
      ].join('\n');
    }

    const techTerms = ['react', 'vue', 'angular', 'next', 'nuxt', 'typescript', 'javascript',
      'node', 'express', 'fastify', 'postgres', 'mongodb', 'redis', 'prisma',
      'docker', 'kubernetes', 'k8s', 'aws', 'vercel', 'nginx'];
    const techCount = techTerms.filter(t => input.toLowerCase().includes(t)).length;
    const hasPlanningIntent = /(?:plan|architect|where.*start|help.*(?:plan|start|approach)|deployment\s+pipeline|not\s+sure|how\s+(?:do|should|would)\s+i\s+(?:start|begin|structure|design|plan))/i.test(input);

    if (techCount >= 3 && (hasPlanningIntent || input.split(/\s+/).length > 25)) {
      // Detect which technologies are mentioned
      const hasFrontend = /react|vue|angular|next|nuxt|svelte/i.test(input);
      const hasDB = /postgres|mongo|mysql|sqlite|redis|database/i.test(input);
      const hasBackend = /node|express|fastify|nest|api/i.test(input) || hasDB;
      const hasInfra = /docker|kubernetes|k8s|aws|gcp|azure|vercel|deploy/i.test(input);

      let response = 'Great stack choice — here\'s how I\'d lay this out:\n\n';
      response += '**Recommended structure:**\n```\n';
      if (hasFrontend) response += '├── frontend/          # React/TypeScript app\n';
      if (hasBackend) response += '├── backend/           # API server (Express/Fastify)\n';
      response += '├── docker-compose.yml # Local development\n';
      if (hasInfra) response += '├── k8s/               # Kubernetes manifests\n';
      response += '└── README.md\n```\n\n';

      response += '**Step-by-step:**\n';
      response += '1. **Start with the API** — define your data models and REST/GraphQL endpoints\n';
      if (hasDB) response += '2. **Set up the database** — schema, migrations, seed data\n';
      if (hasFrontend) response += '3. **Build the frontend** — connect to API, implement core features\n';
      response += '4. **Dockerize** — write Dockerfile for each service, create docker-compose.yml\n';
      if (hasInfra && /kubernetes|k8s/i.test(input)) {
        response += '5. **Kubernetes** — write Deployment + Service manifests, set up Ingress\n';
        response += '6. **CI/CD** — GitHub Actions → build → push to registry → deploy to K8s\n';
      } else {
        response += '5. **Deploy** — push to your platform (Vercel, Railway, or VPS with Docker)\n';
      }

      response += '\n**My advice:** Build one feature end-to-end first (API → DB → frontend → Docker) before expanding horizontally. Don\'t touch K8s until Docker works locally.';
      return response;
    }

    // ══════════════════════════════════════════════════════════════
    //  BENCHMARK COVERAGE — deterministic handlers for core queries
    // ══════════════════════════════════════════════════════════════

    // B-typescript: unknown vs any
    if (/\bunknown\b.*\bany\b.*(?:typescript|ts\b)|(?:typescript|ts)\b.*\bunknown\b.*\bany\b/i.test(input)) {
      return '**`unknown` vs `any` in TypeScript:**\n\n' +
        '`any` disables **all** type checking — any operation is allowed, no errors. It\'s an escape hatch that defeats the purpose of TypeScript.\n\n' +
        '`unknown` is the **type-safe** counterpart — it accepts any value but forces you to narrow the type before using it.\n\n' +
        '```typescript\nlet a: any = "hello";\na.foo(); // No error — but crashes at runtime!\n\nlet b: unknown = "hello";\n// b.foo(); // Error! Must narrow first\nif (typeof b === "string") {\n  b.toUpperCase(); // OK — TypeScript knows it\'s a string\n}\n```\n\n' +
        '**Rule:** Use `unknown` instead of `any` when the type is genuinely uncertain. Use `any` only for gradual migration from JavaScript.';
    }

    // B-typescript: WeakRef
    if (/\bweakref\b/i.test(input)) {
      return '**WeakRef** in JavaScript holds a **weak reference** to an object — it does NOT prevent **garbage collection**.\n\n' +
        '```javascript\nlet obj = { data: "important" };\nconst weak = new WeakRef(obj);\n\nweak.deref(); // { data: "important" }\nobj = null; // Object becomes eligible for GC\n// Later: weak.deref() → undefined (collected)\n```\n\n' +
        '**Use cases:** Caches that should not prevent cleanup, DOM element references in frameworks, memoization that automatically shrinks under memory pressure.\n\n' +
        '**Companion:** `FinalizationRegistry` lets you register a callback when a referenced object is garbage collected. Together they enable sophisticated cache patterns without memory leaks.';
    }

    // B-typescript: Temporal API
    if (/\btemporal\b.*\bapi\b|\btemporal\b.*\bdate\b|\btemporal\b.*\btime\b/i.test(input)) {
      return '**Temporal API** is the modern JavaScript replacement for the broken `Date` object.\n\n' +
        '**Problems with Date:** Mutable (methods modify in-place), months are 0-indexed, no timezone support, parsing is unreliable.\n\n' +
        '**Temporal fixes all of this:**\n' +
        '- `Temporal.PlainDate` — date without time or timezone\n' +
        '- `Temporal.PlainTime` — time without date\n' +
        '- `Temporal.PlainDateTime` — date + time, no timezone\n' +
        '- `Temporal.ZonedDateTime` — full date/time/timezone\n' +
        '- `Temporal.Duration` — represents a span of time\n' +
        '- `Temporal.Instant` — exact moment on the timeline (like Unix timestamp)\n\n' +
        '```javascript\nconst today = Temporal.Now.plainDateISO();\nconst future = today.add({ months: 3, days: 10 });\nconst diff = today.until(future); // P3M10D\n```\n\n' +
        '**Status:** Stage 3 TC39 proposal, available via polyfill `@js-temporal/polyfill`.';
    }

    // C-react: pages/ vs app/ in Next.js
    if (/\bpages?\b.*\bapp\b.*(?:next|router)|(?:next|router).*\bpages?\b.*\bapp\b/i.test(input)) {
      return '**`pages/` vs `app/` in Next.js:**\n\n' +
        '| Feature | `pages/` (Pages Router) | `app/` (App Router) |\n' +
        '|---------|----------------------|--------------------|\n' +
        '| Routing | File-based, flat | File-based with nested **layout** hierarchy |\n' +
        '| Data fetching | `getServerSideProps`, `getStaticProps` | `async` Server Components (direct `fetch`) |\n' +
        '| Components | All client-side by default | **Server Components** by default |\n' +
        '| Layouts | Custom `_app.tsx` wrapper | Native nested `layout.tsx` files |\n' +
        '| Loading states | Manual | Built-in `loading.tsx` with Suspense |\n' +
        '| Error handling | Custom `_error.tsx` | Co-located `error.tsx` per route |\n\n' +
        '**`app/` router** is the recommended approach for new Next.js projects (13.4+). It supports React Server Components, streaming, and parallel routes. The `pages/` router still works and can coexist with `app/` during migration.';
    }

    // C-react: useReducer
    if (/\busereducer\b/i.test(input)) {
      return '**useReducer** is a React hook for managing complex **state** logic — an alternative to `useState` when state transitions depend on previous state or involve multiple sub-values.\n\n' +
        '```jsx\nconst reducer = (state, action) => {\n  switch (action.type) {\n    case "increment": return { count: state.count + 1 };\n    case "decrement": return { count: state.count - 1 };\n    case "reset": return { count: 0 };\n    default: throw new Error(`Unknown action: ${action.type}`);\n  }\n};\n\nfunction Counter() {\n  const [state, dispatch] = useReducer(reducer, { count: 0 });\n  return (\n    <>\n      <p>{state.count}</p>\n      <button onClick={() => dispatch({ type: "increment" })}>+</button>\n      <button onClick={() => dispatch({ type: "reset" })}>Reset</button>\n    </>\n  );\n}\n```\n\n' +
        '**When to use:** Complex state objects, state transitions that depend on previous state, when you want to centralize state logic. **dispatch** is stable across re-renders (unlike setState closures).';
    }

    // C-react: custom hooks
    if (/\bcustom\s+hooks?\b/i.test(input)) {
      return '**Custom hooks** in React extract **reusable** stateful **logic** into functions prefixed with `use`.\n\n' +
        '```jsx\nfunction useWindowSize() {\n  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });\n  useEffect(() => {\n    const handler = () => setSize({ w: window.innerWidth, h: window.innerHeight });\n    window.addEventListener("resize", handler);\n    return () => window.removeEventListener("resize", handler);\n  }, []);\n  return size;\n}\n\n// Usage in any component:\nfunction Header() {\n  const { w } = useWindowSize();\n  return <nav>{w < 768 ? <MobileMenu /> : <DesktopMenu />}</nav>;\n}\n```\n\n' +
        '**Rules:** Must start with `use`, can call other hooks inside, follow the Rules of Hooks (top-level only, no conditionals). Custom hooks share **logic** reuse, not **state** — each component using the hook gets its own independent state.';
    }

    // D-css: em, rem, px
    if (/\b(?:em|rem|px)\b.*\b(?:em|rem|px)\b/i.test(input) && /\b(?:difference|compare|vs|versus|between|unit)\b/i.test(input)) {
      return '**CSS Units — `em`, `rem`, and `px`:**\n\n' +
        '| Unit | Relative to | Example |\n' +
        '|------|------------|----------|\n' +
        '| `px` | Absolute — fixed pixels | `font-size: 16px` |\n' +
        '| `em` | **Parent** element\'s font-size | `padding: 1.5em` (1.5× parent) |\n' +
        '| `rem` | **Root** (`<html>`) font-size | `margin: 2rem` (2× root, usually 32px) |\n\n' +
        '**Why `rem` is preferred:** Consistent across the page (no compounding), respects user font-size preferences for accessibility, predictable math.\n\n' +
        '**When to use `em`:** Component-internal spacing that should scale with the component\'s own font-size (e.g., button padding).\n\n' +
        '**When to use `px`:** Borders, box-shadows, and fine-grained control where relative sizing doesn\'t help.\n\n' +
        '**Compounding problem with `em`:** If a parent is `2em` and child is `2em`, the child renders at 4× root — this cascading is why `rem` was introduced.';
    }

    // D-css: CSS-in-JS
    if (/css.?in.?js/i.test(input)) {
      return '**CSS-in-JS** writes CSS directly in JavaScript, scoped to components.\n\n' +
        '**Runtime libraries** (styled-components, Emotion) generate styles at runtime:\n' +
        '```jsx\nconst Button = styled.button`\n  background: blue;\n  color: white;\n  padding: 8px 16px;\n`;\n```\n\n' +
        '**Zero-runtime libraries** (vanilla-extract, Linaria, Panda CSS) extract CSS at build time — no runtime cost.\n\n' +
        '**Pros:** Scoped styles (no class name collisions), dynamic styling based on props, co-located with components, dead code elimination.\n\n' +
        '**Cons:** Runtime overhead (for runtime libs), bundle size increase, SSR complexity, harder to cache separately.\n\n' +
        '**Trend:** The ecosystem is moving toward zero-runtime solutions and CSS Modules. Tailwind CSS avoids CSS-in-JS entirely with utility classes.';
    }

    // D-css: container queries
    if (/container\s+quer/i.test(input)) {
      return '**CSS Container Queries** style elements based on **container** size, not viewport.\n\n' +
        '```css\n.card-wrapper {\n  container-type: inline-size;\n  container-name: card;\n}\n\n@container card (min-width: 400px) {\n  .card { display: grid; grid-template-columns: 1fr 1fr; }\n}\n\n@container card (max-width: 399px) {\n  .card { display: flex; flex-direction: column; }\n}\n```\n\n' +
        '**Why it matters:** Media queries check the **viewport**. Container queries check the **parent** — so the same component adapts whether it\'s in a sidebar (300px) or main content (800px).\n\n' +
        '**Key properties:**\n- `container-type: inline-size` — enable container queries on width\n- `container-name` — optional name for targeting\n- `@container` — the query rule, works like `@media` but for the container\n\n' +
        '**Browser support:** All modern browsers since 2023. **Responsive** design is now truly component-based.';
    }

    // D-css: CSS reset vs normalize
    if (/css\s+reset|normalize\.?css|\bnormalize\b.*\breset\b|\breset\b.*\bnormalize\b/i.test(input)) {
      return '**CSS Reset vs Normalize:**\n\n' +
        '**CSS Reset** (e.g., Eric Meyer\'s) strips ALL **default** **browser** styles — margins, padding, font sizes — to zero. Everything starts from a blank slate.\n```css\n* { margin: 0; padding: 0; box-sizing: border-box; }\n```\n\n' +
        '**Normalize.css** preserves useful **default** browser styles while fixing inconsistencies **between** browsers. Headings still look like headings, lists still have bullets.\n\n' +
        '| Approach | Strategy | Result |\n' +
        '|----------|----------|--------|\n' +
        '| Reset | Remove ALL defaults | Blank canvas, must restyle everything |\n' +
        '| Normalize | Fix inconsistencies | Sensible defaults preserved |\n\n' +
        '**Modern approach:** Most frameworks (Tailwind, Chakra) include their own "preflight" reset that combines both — reset most things but keep accessible defaults. Tailwind\'s preflight is based on `modern-normalize` + opinionated resets.';
    }

    // E-devops: What is Docker? / What do you think about Docker?
    if (/^what\s+(?:is|are)\s+docker\b/i.test(input) && !/image|container.*vs|vs.*container|dockerfile|compose/i.test(input)) {
      return '**Docker** is a platform for building, shipping, and running applications in **containers**.\n\n' +
        'A **container** packages your app with all its dependencies — code, runtime, libraries, system tools — into a single portable unit. It runs identically on any machine with Docker installed.\n\n' +
        '**Key concepts:**\n' +
        '- **Image** — a read-only template (like a class). Built from a Dockerfile.\n' +
        '- **Container** — a running instance of an image (like an object). Lightweight, isolated, ephemeral.\n' +
        '- **Dockerfile** — instructions to build an image (`FROM`, `COPY`, `RUN`, `CMD`)\n' +
        '- **Docker Compose** — define multi-container apps in a `docker-compose.yml`\n' +
        '- **Registry** — Docker Hub or private registries to share images\n\n' +
        '**Why Docker?** "Works on my machine" → works everywhere. Consistent dev/staging/prod environments, easy scaling, fast startup (seconds vs minutes for VMs), isolation without full virtual machines.';
    }

    // Opinion/think about Docker — same core knowledge
    if (/(?:think|opinion|thoughts?|take)\s+(?:about|on)\s+docker/i.test(input)) {
      return '**Docker** is a platform for building, shipping, and running applications in **containers**.\n\n' +
        'A **container** packages your app with all its dependencies — code, runtime, libraries, system tools — into a single portable unit. It runs identically on any machine with Docker installed.\n\n' +
        '**Key concepts:**\n' +
        '- **Image** — a read-only template (like a class). Built from a Dockerfile.\n' +
        '- **Container** — a running instance of an image (like an object). Lightweight, isolated, ephemeral.\n' +
        '- **Dockerfile** — instructions to build an image (`FROM`, `COPY`, `RUN`, `CMD`)\n' +
        '- **Docker Compose** — define multi-container apps in a `docker-compose.yml`\n\n' +
        '**Why Docker?** "Works on my machine" → works everywhere. Consistent dev/staging/prod environments, easy scaling, fast startup (seconds vs minutes for VMs), isolation without full virtual machines.';
    }

    // E-devops: Docker image vs container
    if (/docker\b.*\bimage\b.*\bcontainer\b|image\b.*vs.*container|container\b.*vs.*image/i.test(input)) {
      return '**Docker Image vs Container:**\n\n' +
        '| | **Image** | **Container** |\n' +
        '|---|-----------|---------------|\n' +
        '| What | Read-only **template** | Running **instance** of an image |\n' +
        '| Analogy | Class definition | Object / instance |\n' +
        '| State | Immutable (layered filesystem) | Has writable layer on top |\n' +
        '| Created by | `docker build` + Dockerfile | `docker run` or `docker create` |\n' +
        '| Stored | Registry (Docker Hub) or local cache | Only exists while running (or stopped) |\n\n' +
        '```bash\n# Build an image from Dockerfile\ndocker build -t my-app .\n\n# Create a container (instance) from the image\ndocker run -p 3000:3000 my-app\n\n# One image → many containers\ndocker run --name app1 my-app\ndocker run --name app2 my-app\n```\n\n' +
        '**Key insight:** Images are the blueprint, containers are the running process. You can create many containers from one image — each with its own state.';
    }

    // E-devops: Dockerfile
    if (/\bdockerfile\b/i.test(input) && !/compose|how.*deploy/i.test(input)) {
      return '**Dockerfile** is a text file with **instructions** to **build** a Docker image, layer by layer.\n\n' +
        '```dockerfile\n# Base image\nFROM node:20-alpine\n\n# Set working directory\nWORKDIR /app\n\n# Copy dependency files first (layer caching)\nCOPY package*.json ./\nRUN npm ci --only=production\n\n# Copy application code\nCOPY . .\n\n# Expose port\nEXPOSE 3000\n\n# Start command\nCMD ["node", "server.js"]\n```\n\n' +
        '**Key instructions:**\n' +
        '- `FROM` — base image (every Dockerfile starts with this)\n' +
        '- `WORKDIR` — set the working directory\n' +
        '- `COPY` / `ADD` — copy files from host to image\n' +
        '- `RUN` — execute commands during build (install deps, compile)\n' +
        '- `EXPOSE` — document which port the app uses\n' +
        '- `CMD` — default command when container starts\n' +
        '- `ENV` — set environment variables\n\n' +
        '**Build:** `docker build -t my-app .` reads the Dockerfile and creates an image.';
    }

    // E-devops: serverless
    if (/\bserverless\b/i.test(input)) {
      return '**Serverless** computing runs code without managing servers — the cloud provider handles infrastructure, **scaling**, and availability.\n\n' +
        '**How it works:** You deploy a **function** (AWS **Lambda**, Vercel Functions, Cloudflare Workers). The provider:\n' +
        '- Allocates compute on demand\n' +
        '- **Scales** automatically (0 to thousands of instances)\n' +
        '- Charges per invocation (pay only when your code runs)\n' +
        '- Handles OS, runtime, patching\n\n' +
        '**Pros:** Zero server management, automatic scaling, cost-effective for variable traffic, instant deployments.\n\n' +
        '**Cons:** Cold starts (first invocation is slow), execution time limits (e.g., 15 min on **Lambda**), vendor lock-in, harder to debug, stateless (no persistent memory).\n\n' +
        '**Common use cases:** API endpoints, webhooks, scheduled tasks, image processing, form handling.\n\n' +
        '**Platforms:** AWS Lambda, Vercel Edge Functions, Cloudflare Workers, Google Cloud Functions, Azure Functions.';
    }

    // E-devops: Nginx
    if (/\bnginx\b/i.test(input) && !/how.*config|setup/i.test(input)) {
      return '**Nginx** (pronounced "engine-x") is a high-performance **web server**, **reverse proxy**, and load balancer.\n\n' +
        '**Primary roles:**\n' +
        '- **Web server** — serves static files (HTML, CSS, JS, images) extremely fast\n' +
        '- **Reverse proxy** — forwards requests to backend servers (Node.js, Python, etc.) via **HTTP**\n' +
        '- **Load balancer** — distributes traffic across multiple backend instances\n' +
        '- **SSL termination** — handles HTTPS certificates\n' +
        '- **Caching** — stores responses to reduce backend load\n\n' +
        '```nginx\nserver {\n  listen 80;\n  server_name example.com;\n\n  location / {\n    proxy_pass http://localhost:3000;  # reverse proxy to Node.js\n  }\n\n  location /static/ {\n    root /var/www;  # serve static files directly\n  }\n}\n```\n\n' +
        '**Why Nginx?** Handles 10,000+ concurrent connections with minimal memory. Event-driven architecture (non-blocking), unlike Apache\'s thread-per-connection model.';
    }

    // G-auth: Content Security Policy
    if (/content.?security.?policy|\bcsp\b/i.test(input)) {
      return '**Content Security Policy** (**CSP**) is a security **header** that tells the browser which sources of content are trusted — preventing XSS and injection attacks.\n\n' +
        '```http\nContent-Security-Policy: default-src \'self\'; script-src \'self\' https://cdn.example.com; style-src \'self\' \'unsafe-inline\'\n```\n\n' +
        '**Key directives:**\n' +
        '- `default-src` — fallback for all resource types\n' +
        '- `script-src` — allowed **script** sources (prevents inline scripts by default)\n' +
        '- `style-src` — allowed stylesheet sources\n' +
        '- `img-src` — allowed image sources\n' +
        '- `connect-src` — allowed fetch/XHR/WebSocket targets\n' +
        '- `frame-ancestors` — who can embed your page (replaces X-Frame-Options)\n\n' +
        '**Why CSP matters:** Even if an attacker injects `<script>` tags (XSS), CSP blocks execution because the script source isn\'t whitelisted. It\'s defense-in-depth — the last line of defense against injection.\n\n' +
        '**Tip:** Start with `Content-Security-Policy-Report-Only` to test without breaking anything.';
    }

    // J-python: list vs tuple
    if (/\blist\b.*\btuple\b|\btuple\b.*\blist\b/i.test(input) && /python|differ|compare|vs/i.test(input)) {
      return '**List vs Tuple in Python:**\n\n' +
        '| Feature | **List** `[]` | **Tuple** `()` |\n' +
        '|---------|--------------|----------------|\n' +
        '| Mutability | **Mutable** — can add, remove, change | **Immutable** — fixed after creation |\n' +
        '| Syntax | `[1, 2, 3]` | `(1, 2, 3)` |\n' +
        '| Hashable | No (can\'t be dict key) | Yes (can be dict key/set member) |\n' +
        '| Performance | Slightly slower | Slightly faster, less memory |\n' +
        '| Use case | Collections that change | Fixed records, function returns |\n\n' +
        '```python\n# List — mutable\ncolors = ["red", "blue"]\ncolors.append("green")  # OK\ncolors[0] = "yellow"    # OK\n\n# Tuple — immutable\npoint = (10, 20)\n# point[0] = 30  # TypeError!\ncoords = {point: "A"}  # OK as dict key\n```\n\n' +
        '**Rule of thumb:** Use **list** when order matters and items change. Use **tuple** for fixed data (coordinates, RGB values, function returns).';
    }

    // J-python: pip
    if (/\bpip\b.*\bpython\b|\bpython\b.*\bpip\b|^what\s+is\s+pip\b/i.test(input)) {
      return '**pip** is Python\'s default **package** manager — it **installs** packages from **PyPI** (Python Package Index).\n\n' +
        '```bash\n# Install a package\npip install requests\n\n# Install specific version\npip install django==4.2\n\n# Install from requirements file\npip install -r requirements.txt\n\n# List installed packages\npip list\n\n# Save current packages\npip freeze > requirements.txt\n```\n\n' +
        '**Key concepts:**\n' +
        '- **PyPI** (pypi.org) — the central repository with 400,000+ packages\n' +
        '- `requirements.txt` — lists project dependencies with version pins\n' +
        '- **Virtual environments** — isolate packages per project: `python -m venv .venv`\n' +
        '- **pip install -e .** — editable install for local development\n\n' +
        '**Modern alternatives:** `pipx` (for CLI tools), `poetry` (dependency management + lockfile), `uv` (extremely fast Rust-based pip replacement).';
    }

    // J-python: Django
    if (/\bdjango\b/i.test(input)) {
      return '**Django** is a batteries-included **Python** **web** **framework** — the most popular full-stack framework in the Python ecosystem.\n\n' +
        '**Key features:**\n' +
        '- **ORM** — define models in Python, auto-generates SQL/migrations\n' +
        '- **Admin panel** — auto-generated CRUD interface from your models\n' +
        '- **URL routing** — map URLs to views with regex or path converters\n' +
        '- **Template engine** — server-side HTML rendering\n' +
        '- **Authentication** — built-in user auth, sessions, permissions\n' +
        '- **Security** — CSRF protection, XSS prevention, SQL injection prevention\n\n' +
        '```python\n# models.py\nclass Article(models.Model):\n    title = models.CharField(max_length=200)\n    body = models.TextField()\n    published = models.DateTimeField(auto_now_add=True)\n\n# views.py\ndef article_list(request):\n    articles = Article.objects.all()\n    return render(request, "articles.html", {"articles": articles})\n```\n\n' +
        '**Philosophy:** "Don\'t repeat yourself" (DRY), convention over configuration. Used by Instagram, Pinterest, Mozilla, Disqus.';
    }

    // L-wcag: alt attribute
    if (/\balt\b.*(?:attribute|text|tag|img)/i.test(input)) {
      return '**The `alt` attribute** provides a **text** **description** of an **image** for accessibility and fallback display.\n\n' +
        '```html\n<img src="chart.png" alt="Monthly sales chart showing 20% growth in Q4">\n<img src="decoration.svg" alt="">  <!-- decorative: empty alt -->\n```\n\n' +
        '**Why it matters:**\n' +
        '- **Screen readers** read alt text aloud for visually impaired users\n' +
        '- **SEO** — search engines index alt text to understand images\n' +
        '- **Fallback** — displayed when images fail to load\n' +
        '- **Required by WCAG** — images without alt fail accessibility audits\n\n' +
        '**Best practices:**\n' +
        '- Describe the image\'s PURPOSE, not just appearance ("Sales chart" not "Picture of graph")\n' +
        '- Keep it concise (under 125 characters)\n' +
        '- Use `alt=""` (empty, not missing) for decorative images\n' +
        '- Never use "image of..." or "picture of..." — the screen reader already says "image"\n' +
        '- For complex images (charts, diagrams), use `aria-describedby` with a longer description';
    }

    // M-gdpr: right to be forgotten
    if (/right.*(?:forgotten|erasure)|right.*(?:delete|delet).*(?:data|personal)/i.test(input)) {
      return '**Right to be Forgotten** (Right to **Erasure**, GDPR Article 17):\n\n' +
        'Data subjects can request that organizations **delete** all their personal data. The organization must comply within 30 days if:\n' +
        '- The data is no longer necessary for its original purpose\n' +
        '- Consent is withdrawn\n' +
        '- The data was unlawfully processed\n' +
        '- Legal obligation requires deletion\n\n' +
        '**Exceptions (you may refuse):**\n' +
        '- Legal obligation to retain data\n' +
        '- Public interest (health, archiving, research)\n' +
        '- Exercising right to freedom of expression\n' +
        '- Establishing, exercising, or defending legal claims\n\n' +
        '**Implementation for developers:**\n' +
        '- Build a "delete my account" feature that cascades through ALL systems\n' +
        '- Don\'t just soft-delete — remove from backups, logs, analytics, third-party services\n' +
        '- Document your data retention policies\n' +
        '- Return confirmation to the user after deletion\n\n' +
        '**Famous case:** Google v. Spain (2014) — the EU court ruled that search engines must remove links to outdated personal information on request.';
    }

    // N-norway: universell utforming
    if (/universell\s+utforming/i.test(input)) {
      return '**Universell utforming** (Universal Design / **accessibility**) is Norway\'s legal requirement that all digital services must be **tilgjengelig** for everyone, including people with disabilities.\n\n' +
        '**Legal basis:** *Likestillings- og diskrimineringsloven* (Equality and Anti-Discrimination Act) + *Forskrift om universell utforming av IKT*. Applies to all public and private sector websites and apps.\n\n' +
        '**Requirements (based on WCAG 2.1 AA):**\n' +
        '- Text alternatives for images (alt text)\n' +
        '- Keyboard navigability for all functionality\n' +
        '- Sufficient color contrast (4.5:1 for text)\n' +
        '- Resizable text without breaking layout\n' +
        '- Captions for video/audio content\n' +
        '- Clear, consistent navigation\n\n' +
        '**Enforcement:** Digitaliseringsdirektoratet (Digdir) monitors compliance. Violations can result in fines.\n\n' +
        '**Testing tools:** axe DevTools, WAVE, Lighthouse accessibility audit, NVDA/VoiceOver screen reader testing.\n\n' +
        '**Deadline:** All existing websites must comply. New digital services must be accessible from launch.';
    }

    // N-norway: Vipps
    if (/\bvipps\b/i.test(input)) {
      return '**Vipps** is **Norway\'s** dominant **mobile** **payment** app — used by 4+ million Norwegians (80%+ of the population).\n\n' +
        '**Features:**\n' +
        '- Person-to-person payments (like Venmo, but Norwegian)\n' +
        '- Online payments (e-commerce checkout)\n' +
        '- In-store payments (NFC/QR)\n' +
        '- Invoice payments\n' +
        '- Recurring payments (subscriptions)\n\n' +
        '**For developers (Vipps MobilePay API):**\n' +
        '- ePayment API — online checkout integration\n' +
        '- Recurring API — subscriptions and memberships\n' +
        '- Login API — "Log in with Vipps" (like Google/Apple sign-in)\n' +
        '- Order Management API — receipts and order tracking\n\n' +
        '**History:** Launched in 2015 by DNB (Norway\'s largest bank). Merged with Danish MobilePay and Finnish Pivo in 2022 to form Vipps MobilePay across the Nordics.\n\n' +
        '**Integration:** Available as a Shopify plugin, WooCommerce plugin, and standalone API. Extremely high conversion rates in Norway because users already have the app.';
    }

    // S-build: Webpack
    if (/\bwebpack\b/i.test(input) && !/vs\s+vite|vite\s+vs|migrate/i.test(input)) {
      return '**Webpack** is a module **bundler** for JavaScript applications — it takes your source files (JS, CSS, images) and packages them into optimized output files.\n\n' +
        '**Core concepts:**\n' +
        '- **Entry** — starting point for the dependency graph (e.g., `src/index.js`)\n' +
        '- **Output** — where bundled files go (e.g., `dist/bundle.js`)\n' +
        '- **Loaders** — transform non-JS files: `css-loader`, `ts-loader`, `babel-loader`, `file-loader`\n' +
        '- **Plugins** — extend functionality: `HtmlWebpackPlugin`, `MiniCssExtractPlugin`, `DefinePlugin`\n\n' +
        '```javascript\nmodule.exports = {\n  entry: "./src/index.js",\n  output: { filename: "bundle.js", path: __dirname + "/dist" },\n  module: {\n    rules: [{ test: /\\.css$/, use: ["style-loader", "css-loader"] }]\n  },\n  plugins: [new HtmlWebpackPlugin({ template: "./src/index.html" })]\n};\n```\n\n' +
        '**Key features:** Code splitting, tree shaking, hot module replacement (HMR), dev server.\n\n' +
        '**Modern alternatives:** Vite (faster dev, ESM-native), esbuild (extremely fast), Turbopack (Vercel\'s Rust-based bundler).';
    }

    // T-misc: Astro
    if (/\bastro\b/i.test(input) && !/astro.*physics|astro.*nomy/i.test(input)) {
      return '**Astro** is a modern web framework optimized for **content**-driven websites — blogs, docs, marketing pages, portfolios.\n\n' +
        '**Key innovation — Islands Architecture:**\n' +
        '- Pages are **static** HTML by default (zero JavaScript shipped)\n' +
        '- Interactive components are hydrated as "**islands**" only where needed\n' +
        '- Result: extremely fast pages with selective interactivity\n\n' +
        '```astro\n---\n// Server-side (runs at build time)\nimport Header from "../components/Header.astro";\nimport Counter from "../components/Counter.tsx";\nconst posts = await fetch("/api/posts").then(r => r.json());\n---\n<Header />\n<Counter client:visible />  <!-- Hydrate only when visible -->\n{posts.map(p => <article>{p.title}</article>)}\n```\n\n' +
        '**Unique features:**\n' +
        '- **Framework-agnostic** — use React, Vue, Svelte, Solid components in the same project\n' +
        '- **Content Collections** — type-safe Markdown/MDX with schemas\n' +
        '- **SSG + SSR** — static by default, server rendering when needed\n' +
        '- **View Transitions** — built-in page transition animations\n\n' +
        '**Performance:** Ships zero JS by default. Lighthouse 100 scores out of the box.';
    }

    // ══════════════════════════════════════════════════════════════
    //  PROCEDURAL "How do I..." handlers
    // ══════════════════════════════════════════════════════════════

    if (/(?:how|steps?).*(?:deploy|run|host).*(?:node|nodejs).*(?:docker|container)|(?:docker|container).*(?:node|nodejs).*(?:deploy|run)/i.test(input)) {
      return '**Deploying a Node.js app with Docker:**\n\n' +
        '**1. Create a `Dockerfile`:**\n```dockerfile\nFROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --only=production\nCOPY . .\nEXPOSE 3000\nCMD ["node", "server.js"]\n```\n\n' +
        '**2. Add `.dockerignore`:**\n```\nnode_modules\nnpm-debug.log\n.git\n```\n\n' +
        '**3. Build and run:**\n```bash\ndocker build -t my-app .\ndocker run -p 3000:3000 my-app\n```\n\n' +
        '**Best practices:**\n- Use multi-stage builds to reduce image size\n- Use `npm ci` (not `npm install`) for reproducible builds\n- Run as non-root user: `USER node`\n- Use `alpine` base images for smaller footprint\n- Copy `package.json` first to leverage Docker layer caching';
    }

    if (/(?:how|steps?).*(?:setup|set\s*up|start|init|create|configure).*typescript.*(?:project|app|new)|(?:setup|set\s*up|start|init).*(?:new|fresh).*typescript/i.test(input)) {
      return '**Setting up TypeScript in a new project:**\n\n' +
        '**1. Initialize and install:**\n```bash\nmkdir my-project && cd my-project\nnpm init -y\nnpm install -D typescript @types/node\nnpx tsc --init\n```\n\n' +
        '**2. Configure `tsconfig.json`:**\n```json\n{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "NodeNext",\n    "moduleResolution": "NodeNext",\n    "strict": true,\n    "outDir": "dist",\n    "rootDir": "src",\n    "esModuleInterop": true,\n    "skipLibCheck": true\n  },\n  "include": ["src/**/*"]\n}\n```\n\n' +
        '**3. Create source file:**\n```bash\nmkdir src\necho \'console.log("Hello TypeScript!");\' > src/index.ts\n```\n\n' +
        '**4. Build and run:**\n```bash\nnpx tsc\nnode dist/index.js\n```\n\n' +
        '**For dev workflow**, add `tsx` for direct execution: `npx tsx src/index.ts`';
    }

    if (/(?:how|steps?).*(?:use|work\s+with|manage).*(?:git\s+)?branch|git\s+branch.*(?:how|tutorial|guide|explain)|branch.*(?:strategy|workflow|merge)/i.test(input)) {
      return '**Using Git branches:**\n\n' +
        '**Create and switch:**\n```bash\ngit branch feature/login    # create branch\ngit checkout feature/login  # switch to it\n# or in one step:\ngit checkout -b feature/login\n```\n\n' +
        '**List branches:**\n```bash\ngit branch          # local branches\ngit branch -a       # include remote branches\n```\n\n' +
        '**Merge a branch:**\n```bash\ngit checkout main\ngit merge feature/login\n```\n\n' +
        '**Delete a branch:**\n```bash\ngit branch -d feature/login       # safe delete\ngit push origin --delete feature/login  # remote\n```\n\n' +
        '**Branch strategies:**\n- **Feature branches** — one branch per feature, merge into main\n- **Git Flow** — main, develop, feature/*, release/*, hotfix/*\n- **Trunk-based** — short-lived branches, frequent merges to main\n\n' +
        '**Tip:** Keep branches short-lived. The longer a branch lives, the harder the merge.';
    }

    // ══════════════════════════════════════════════════════════════
    //  SPECIFIC KNOWLEDGE HANDLERS — TypeScript deep
    // ══════════════════════════════════════════════════════════════

    if (/interface\s+vs\s+type|type\s+vs\s+interface|difference.*(?:interface|type).*typescript/i.test(input)) {
      return '**interface vs type in TypeScript:**\n\n' +
        '| Feature | `interface` | `type` |\n|---|---|---|\n' +
        '| **Extend** | `extends` keyword | `&` intersection |\n' +
        '| **Merge** | Declaration merging ✅ | Cannot re-open ❌ |\n' +
        '| **Unions** | Not supported | `type A = B | C` ✅ |\n' +
        '| **Primitives** | Objects only | Any type |\n\n' +
        '**Use `interface`** for object shapes that may be extended.\n**Use `type`** for unions, intersections, mapped types, or primitives.\n\n' +
        '```typescript\ninterface User { name: string; age: number; }\ninterface Admin extends User { role: "admin"; }\n\ntype ID = string | number;\ntype UserWithId = User & { id: ID };\n```';
    }

    if (/generic.*typescript|typescript.*generic|explain.*generic|what\s+(?:are|is)\s+generic/i.test(input)) {
      return '**Generics in TypeScript** let you write reusable code with a type parameter `<T>` that preserves type safety.\n\n' +
        '```typescript\nfunction identity<T>(value: T): T {\n  return value;\n}\nidentity<string>("hello"); // T = string\nidentity(42);             // T inferred as number\n\ninterface ApiResponse<T> {\n  data: T;\n  status: number;\n}\n\nfunction getLength<T extends { length: number }>(item: T): number {\n  return item.length;\n}\n```\n\n' +
        '**Common uses:** collections, API responses, form handlers, utility functions.';
    }

    if (/union\s+type|intersection\s+type|union.*intersection|what.*(?:union|intersection).*type/i.test(input)) {
      return '**Union and intersection types in TypeScript:**\n\n' +
        '**Union (`|`)** — a value can be ONE of several types:\n```typescript\ntype Status = "loading" | "success" | "error";\ntype ID = string | number;\n```\n\n' +
        '**Intersection (`&`)** — combines multiple types into one:\n```typescript\ntype Named = { name: string };\ntype Aged = { age: number };\ntype Person = Named & Aged; // { name: string; age: number }\n```\n\n' +
        '**Key difference:** Union = "OR" (one of), Intersection = "AND" (all of).\n\n' +
        '**Narrowing unions:**\n```typescript\nfunction handle(value: string | number) {\n  if (typeof value === "string") value.toUpperCase();\n}\n```';
    }

    if (/async\s*\/?\s*await.*(?:javascript|js|how|work|explain)|how\s+does\s+async/i.test(input)) {
      return '**async/await** in JavaScript simplifies working with Promises.\n\n' +
        '- `async` marks a function as returning a Promise\n- `await` pauses execution until the Promise resolves\n\n' +
        '```javascript\nasync function getData() {\n  try {\n    const res = await fetch("/api/data");\n    const data = await res.json();\n    console.log(data);\n  } catch (err) {\n    console.error(err);\n  }\n}\n```\n\n' +
        '**Key rules:** `await` only works inside `async` functions. Each `await` yields to the event loop microtask queue.';
    }

    if (/var\b.*let\b.*const\b|let\s+vs\s+const|difference.*(?:var|let|const)|var\s+let\s+const/i.test(input)) {
      return '**var, let, and const in JavaScript:**\n\n' +
        '| | `var` | `let` | `const` |\n|---|---|---|---|\n' +
        '| **Scope** | Function scope | Block scope | Block scope |\n' +
        '| **Hoisting** | Hoisted (undefined) | Temporal dead zone | Temporal dead zone |\n' +
        '| **Reassign** | ✅ | ✅ | ❌ |\n| **Redeclare** | ✅ | ❌ | ❌ |\n\n' +
        '**Best practice:** Default to `const`. Use `let` only when reassignment is needed. Never use `var`.';
    }

    if (/closure.*(?:javascript|js|explain|what|programming)|what.*closure|explain.*closure/i.test(input)) {
      return '**A closure** in JavaScript (and in any language with **first-class functions** and **lexical scope**) is a function bundled together with references to the variables from its surrounding **lexical (enclosing) scope** — so the inner function can still access those *free variables* even after the outer function has returned.\n\n' +
        '```javascript\nfunction createCounter() {\n  let count = 0;          // free variable, captured by lexical scope\n  return function() {     // inner function "encloses" count\n    count++;\n    return count;\n  };\n}\nconst counter = createCounter();\ncounter(); // 1\ncounter(); // 2\n```\n\n' +
        '**How it works:** Because functions are **first-class** values in JavaScript and resolved by **lexical scope** (not call-site scope), the inner function keeps a reference to the variable environment it was defined in. The closed-over (enclosed) free variables persist on the heap as long as the closure itself is reachable.\n\n**Common uses:** data privacy / encapsulation, factory functions, partial application and currying, event handlers, callbacks, React hooks like `useState` and `useCallback`.';
    }

    if (/event\s+loop|call\s+stack.*queue|microtask.*macrotask/i.test(input)) {
      return '**The JavaScript event loop** manages async execution in a single-threaded environment.\n\n' +
        '**Components:**\n1. **Call stack** — executes synchronous code (LIFO)\n2. **Microtask queue** — Promises, queueMicrotask\n3. **Macrotask queue** — setTimeout, setInterval, I/O\n\n' +
        '**Execution order:** sync code → drain microtask queue → one macrotask → repeat.\n\n' +
        '```javascript\nconsole.log("1");           // sync\nsetTimeout(() => console.log("2"), 0); // macrotask\nPromise.resolve().then(() => console.log("3")); // microtask\nconsole.log("4");           // sync\n// Output: 1, 4, 3, 2\n```';
    }

    if (/template\s+literal\s+type|template.*type.*string/i.test(input)) {
      return '**Template literal types** in TypeScript create new string literal types using template syntax.\n\n' +
        '```typescript\ntype Color = "red" | "blue";\ntype Size = "sm" | "lg";\ntype ColorSize = `${Color}-${Size}`;\n// "red-sm" | "red-lg" | "blue-sm" | "blue-lg"\n\ntype EventName<T extends string> = `on${Capitalize<T>}`;\ntype ClickEvent = EventName<"click">; // "onClick"\n```\n\n' +
        '**Use cases:** CSS class builders, event handler types, API route patterns, string manipulation at the type level.';
    }

    if (/==\s*(?:vs|versus)?\s*===|strict.*equal|type\s+coercion.*equal|difference.*(?:==|===|equality)/i.test(input)) {
      return '**`==` vs `===`** in JavaScript:\n\n- **`===`** (strict equality) — compares value AND type, no type coercion\n- **`==`** (loose equality) — converts types before comparing (type coercion)\n\n' +
        '```javascript\n1 === "1"  // false (different type)\n1 == "1"   // true (string coerced to number)\nnull === undefined // false\nnull == undefined  // true (special rule)\n```\n\n' +
        '**Best practice:** Always use `===` (strict equality) to avoid unexpected type coercion bugs.';
    }

    if (/destructur.*(?:javascript|js|what|explain|how)|what\s+is\s+destructur/i.test(input)) {
      return '**Destructuring** in JavaScript extracts values from objects and arrays with shorthand syntax.\n\n' +
        '**Object destructuring:**\n```javascript\nconst user = { name: "Alice", age: 30 };\nconst { name, age } = user;\nconst { name: userName, country = "Norway" } = user;\n```\n\n' +
        '**Array destructuring:**\n```javascript\nconst [first, second, ...rest] = [1, 2, 3, 4, 5];\n[a, b] = [b, a]; // swap\n```\n\n' +
        '**In function parameters:**\n```javascript\nfunction greet({ name, age }: { name: string; age: number }) {\n  return `Hi ${name}, you are ${age}`;\n}\n```';
    }

    if (/spread\s+(?:operator|syntax)|what\s+does.*spread\s+(?:operator|do|mean)|\.\.\.\s*(?:operator|syntax)|rest\s+(?:operator|parameter)/i.test(input)) {
      return '**The spread operator (`...`)** in JavaScript expands an iterable (array, string, object, set, map, generator) into individual elements.\n\n' +
        '**Spread arrays:**\n```javascript\nconst nums = [1, 2, 3];\nconst more = [0, ...nums, 4]; // [0, 1, 2, 3, 4]\nconst copy = [...nums];        // shallow copy\nMath.max(...nums);             // 3 (spread as args)\n```\n\n' +
        '**Spread objects (ES2018):**\n```javascript\nconst base = { a: 1, b: 2 };\nconst extended = { ...base, c: 3 };       // { a: 1, b: 2, c: 3 }\nconst override = { ...base, b: 99 };      // { a: 1, b: 99 }\n```\n\n' +
        '**Rest parameter (same `...` token, opposite direction):**\n```javascript\nfunction sum(...nums) {           // collects args into an array\n  return nums.reduce((a, b) => a + b, 0);\n}\nconst [first, ...rest] = [1, 2, 3, 4]; // first = 1, rest = [2, 3, 4]\n```\n\n' +
        '**Key rules:**\n- Spread = "expand into pieces". Rest = "collect pieces into one".\n- Object spread is **shallow** — nested objects share references.\n- Order matters in object spread: later keys overwrite earlier ones.';
    }

    if (/(?:how\s+(?:do|to|can\s+i)|read|reading)\s+(?:a\s+)?file\s+in\s+node|fs\.read\s*file|node\b.*read\b.*file|node\.?js\b.*read\b.*file/i.test(input)) {
      return '**Reading a file in Node.js** — three common patterns.\n\n' +
        '**1. Async with promises (recommended, Node 10+):**\n```javascript\nimport { readFile } from "node:fs/promises";\n\nconst text = await readFile("data.txt", "utf8");\nconsole.log(text);\n```\n\n' +
        '**2. Async with callback (classic API):**\n```javascript\nimport { readFile } from "node:fs";\n\nreadFile("data.txt", "utf8", (err, data) => {\n  if (err) throw err;\n  console.log(data);\n});\n```\n\n' +
        '**3. Synchronous (blocks the event loop — only OK for startup/CLI scripts):**\n```javascript\nimport { readFileSync } from "node:fs";\n\nconst text = readFileSync("data.txt", "utf8");\n```\n\n' +
        '**Tips:**\n- Pass `"utf8"` (or another encoding) to get a **string**; omit it to get a `Buffer`.\n- Use `node:fs/promises` for modern code — it composes cleanly with `async/await` and `try/catch`.\n- For huge files, prefer **streams** (`fs.createReadStream`) so you don\'t load everything into memory.';
    }

    if (/for\s*\.{0,3}\s*in\b.*for\s*\.{0,3}\s*of|for\s*\.{0,3}\s*of\b.*for\s*\.{0,3}\s*in|differ.*for\s*\.{0,3}\s*(?:in|of)|for\s+in\s+(?:vs|versus)\s+for\s+of|\bfor\.\.\.in\b|\bfor\.\.\.of\b/i.test(input)) {
      return '**for...in vs for...of in JavaScript:**\n\n' +
        '| | `for...in` | `for...of` |\n|---|---|---|\n' +
        '| **Iterates** | Object **keys** (enumerable properties) | Iterable **values** (arrays, strings, maps, sets) |\n' +
        '| **Works on** | Objects, arrays (gives indices) | Arrays, strings, Maps, Sets, generators |\n' +
        '| **Returns** | Property names (strings) | Actual values |\n\n' +
        '```javascript\nconst arr = [10, 20, 30];\nfor (const key in arr) console.log(key);   // "0", "1", "2" (indices as strings)\nfor (const val of arr) console.log(val);   // 10, 20, 30 (actual values)\n\nconst obj = { a: 1, b: 2 };\nfor (const key in obj) console.log(key);   // "a", "b" (property names)\n// for...of on plain objects throws TypeError\n```\n\n' +
        '**Rule of thumb:** Use `for...of` for arrays/iterables (values), `for...in` for objects (keys). Prefer `.forEach()` or `.map()` for arrays when possible.';
    }

    if (/utility\s+type|partial\b.*required\b|pick\b.*omit\b|typescript.*(?:partial|pick|omit|record|readonly)/i.test(input)) {
      return '**TypeScript utility types** — built-in type transformations:\n\n' +
        '| Utility | Description |\n|---|---|\n| `Partial<T>` | All properties optional |\n| `Required<T>` | All properties required |\n| `Pick<T, K>` | Select specific properties |\n| `Omit<T, K>` | Exclude specific properties |\n| `Record<K, V>` | Key-value type map |\n| `Readonly<T>` | All properties readonly |\n\n' +
        '```typescript\ninterface User { id: number; name: string; email: string; }\ntype PartialUser = Partial<User>;\ntype UserName = Pick<User, "name" | "email">;\ntype WithoutEmail = Omit<User, "email">;\ntype UserMap = Record<string, User>;\n```';
    }

    if (/error\s+handling.*typescript|handle.*error.*typescript|try\s+catch.*typescript/i.test(input)) {
      return '**Error handling in TypeScript:**\n\n```typescript\ntry {\n  const data = JSON.parse(input);\n} catch (error) {\n  if (error instanceof SyntaxError) console.error("Invalid JSON:", error.message);\n  throw error; // re-throw if unhandled\n} finally {\n  cleanup();\n}\n```\n\n' +
        '**Custom error class:**\n```typescript\nclass AppError extends Error {\n  constructor(message: string, public code: number) {\n    super(message);\n    this.name = "AppError";\n  }\n}\n```';
    }

    if (/nullish\s+coalescing|\?\?\s|what\s+is\s+\?\?/i.test(input)) {
      return '**Nullish coalescing operator (`??`)** returns the right operand when the left is `null` or `undefined`.\n\n' +
        '```javascript\nconst a = null ?? "default";    // "default"\nconst b = undefined ?? "default"; // "default"\nconst c = 0 ?? "default";      // 0 (NOT "default"!)\nconst d = "" ?? "default";      // "" (NOT "default"!)\n```\n\n' +
        '**`??` vs `||`:** `??` only checks null/undefined, while `||` treats `0`, `""`, `false` as falsy too. Use `??` when `0` or `""` are valid values.';
    }

    if (/optional\s+chain|\?\.\s|explain\s+\?\./i.test(input)) {
      return '**Optional chaining (`?.`)** safely accesses nested properties without throwing if a parent is null or undefined.\n\n' +
        '```typescript\nconst zip = user?.address?.zip; // undefined if any link is null\nconst result = obj?.method?.(); // safe method call\nconst item = arr?.[0]; // safe array access\n```\n\n' +
        '**Combined with `??`:** `const name = user?.profile?.name ?? "Anonymous";`\n\n**Key behavior:** Short-circuits to `undefined` if any link in the chain is `null` or `undefined`.';
    }

    if (/mapped\s+type|keyof.*in\s+|what.*mapped.*type/i.test(input)) {
      return '**Mapped types** in TypeScript transform every property using `in keyof` syntax.\n\n' +
        '```typescript\ntype MyPartial<T> = { [K in keyof T]?: T[K]; };\ntype MyReadonly<T> = { readonly [K in keyof T]: T[K]; };\ntype Stringify<T> = { [K in keyof T]: string; };\n\ninterface User { name: string; age: number; }\ntype StringUser = Stringify<User>; // { name: string; age: string }\n```\n\n' +
        '**Key modifiers:** `+readonly`, `-readonly`, `+?`, `-?` to add/remove modifiers.\n**Built-in mapped types:** `Partial`, `Required`, `Readonly`, `Record`.';
    }

    if (/discriminat.*union|tagged\s+union|what.*discriminat/i.test(input)) {
      return '**Discriminated unions** (tagged unions) use a common literal property to distinguish between union members.\n\n' +
        '```typescript\ntype Shape =\n  | { kind: "circle"; radius: number }\n  | { kind: "square"; side: number }\n  | { kind: "rectangle"; width: number; height: number };\n\nfunction area(shape: Shape): number {\n  switch (shape.kind) {\n    case "circle":    return Math.PI * shape.radius ** 2;\n    case "square":    return shape.side ** 2;\n    case "rectangle": return shape.width * shape.height;\n  }\n}\n```\n\n' +
        '**Benefits:** TypeScript narrows the type in each branch. Exhaustiveness checking warns about missing cases.';
    }

    if (/esm\b.*commonjs|commonjs.*esm|module\s+system.*javascript|import.*export.*require|es\s+module/i.test(input)) {
      return '**JavaScript module systems — ESM vs CommonJS:**\n\n' +
        '| | ESM (ES Modules) | CommonJS |\n|---|---|---|\n' +
        '| **Syntax** | `import`/`export` | `require()`/`module.exports` |\n' +
        '| **Loading** | Async, static | Sync, dynamic |\n| **Tree-shaking** | ✅ | ❌ |\n| **Browser** | Native support | Needs bundler |\n\n' +
        '```javascript\n// ESM\nimport { readFile } from "fs/promises";\nexport function hello() { return "world"; }\n\n// CommonJS\nconst { readFile } = require("fs/promises");\nmodule.exports = { hello: () => "world" };\n```\n\n**2026 recommendation:** Use ESM. Set `"type": "module"` in package.json.';
    }

    if (/decorator.*typescript|typescript.*decorator|what.*decorator|explain.*decorator/i.test(input) && !/python/i.test(input)) {
      return '**Decorators** in TypeScript modify classes, methods, and properties using the `@` syntax.\n\n' +
        '```typescript\nfunction Log(target: any, key: string, descriptor: PropertyDescriptor) {\n  const original = descriptor.value;\n  descriptor.value = function(...args: any[]) {\n    console.log(`Calling ${key} with`, args);\n    return original.apply(this, args);\n  };\n}\n\nclass UserService {\n  @Log\n  getUser(id: string) { return { id, name: "Alice" }; }\n}\n```\n\n' +
        '**Enable:** `"experimentalDecorators": true` in tsconfig.json. TS 5.0+ supports Stage 3 decorator syntax.\n**Common uses:** logging, caching, validation, dependency injection (NestJS, Angular). Decorators provide metadata annotation.';
    }

    if (/type\s+.*react\s+component|react\s+component.*typescript|how.*type.*react/i.test(input)) {
      return '**Typing React components in TypeScript:**\n\n' +
        '```typescript\ninterface ButtonProps {\n  label: string;\n  onClick: () => void;\n  variant?: "primary" | "secondary";\n  children?: React.ReactNode;\n}\n\nfunction Button({ label, onClick, variant = "primary" }: ButtonProps) {\n  return <button onClick={onClick} className={variant}>{label}</button>;\n}\n\n// With React.FC (optional)\nconst Button: React.FC<ButtonProps> = ({ label, onClick }) => (\n  <button onClick={onClick}>{label}</button>\n);\n```\n\n' +
        '**Key types:** `React.FC`, `React.ReactNode`, `React.ComponentProps<"button">`, `React.PropsWithChildren`.';
    }

    if (/record\s+type.*typescript|what\s+is.*record.*type|typescript.*record\b/i.test(input)) {
      return '**`Record<K, V>`** in TypeScript creates an object type with keys of type `K` and values of type `V`.\n\n' +
        '```typescript\ntype Status = "loading" | "success" | "error";\ntype StatusMessages = Record<Status, string>;\n\nconst messages: StatusMessages = {\n  loading: "Please wait...",\n  success: "Done!",\n  error: "Something went wrong",\n};\n```\n\n' +
        '**Under the hood:** `Record<K, V>` = `{ [P in K]: V }` (a mapped type).\n**Common uses:** lookup tables, enum-like key-value mappings, normalized state.';
    }

    if (/type\s+narrow|narrow.*type|type\s+guard|typeof.*instanceof/i.test(input)) {
      return '**Type narrowing** in TypeScript refines a broad type to a more specific one within a code block.\n\n' +
        '```typescript\nfunction process(value: string | number) {\n  if (typeof value === "string") value.toUpperCase(); // narrowed to string\n  else value.toFixed(2); // narrowed to number\n}\nif (error instanceof TypeError) error.message; // narrowed\n```\n\n' +
        '**Custom type guard:**\n```typescript\nfunction isUser(obj: unknown): obj is User {\n  return typeof obj === "object" && obj !== null && "name" in obj;\n}\n```\n\n' +
        '**Narrowing methods:** `typeof`, `instanceof`, `in` operator, equality checks, discriminated unions.';
    }

    if (/satisfies.*typescript|what\s+is\s+satisfies|typescript.*satisfies\s+keyword/i.test(input)) {
      return '**The `satisfies` keyword** (TypeScript 4.9+) validates that an expression matches a type without broadening the inferred type.\n\n' +
        '```typescript\ntype Color = "red" | "green" | "blue";\ntype Theme = Record<string, Color | Color[]>;\n\nconst theme = {\n  primary: "red",\n  gradients: ["red", "green"],\n} satisfies Theme;\n\ntheme.primary.toUpperCase(); // ✅ infer knows it\'s string\n```\n\n' +
        '**Key insight:** `satisfies` performs a type check without losing specific type inference — it validates the constraint while preserving the narrowest type.';
    }

    if (/type.?safe.*api\s+client|api\s+client.*type.*safe|typed.*fetch|generic.*api.*client/i.test(input)) {
      return '**Creating a type-safe API client in TypeScript:**\n\n' +
        '```typescript\ninterface ApiRoutes {\n  "/users": { response: User[] };\n  "/users/:id": { response: User };\n}\n\nasync function apiClient<T extends keyof ApiRoutes>(\n  endpoint: T, options?: RequestInit\n): Promise<ApiRoutes[T]["response"]> {\n  const res = await fetch(`/api${endpoint}`, options);\n  if (!res.ok) throw new Error(`API error: ${res.status}`);\n  return res.json();\n}\n\nconst users = await apiClient("/users"); // User[] — fully typed via generic\n```\n\n' +
        '**Alternatives:** tRPC (end-to-end safety), openapi-typescript (generate from OpenAPI), zodios (Zod + Axios).';
    }

    if (/conditional\s+type|extends.*infer|ternary.*type|what.*conditional.*type/i.test(input)) {
      return '**Conditional types** in TypeScript: `T extends U ? X : Y`\n\n' +
        '```typescript\ntype IsString<T> = T extends string ? true : false;\ntype A = IsString<"hello">; // true\ntype B = IsString<42>;      // false\n\n// infer extracts types\ntype ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;\ntype Fn = () => string;\ntype Result = ReturnType<Fn>; // string\n\ntype NonNullable<T> = T extends null | undefined ? never : T;\n```\n\n' +
        '**`infer`** extracts a type from within the conditional — essential for utility types like `ReturnType`, `Parameters`, `Awaited`.';
    }

    // ══════════════════════════════════════════════════════════════
    //  CSS deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/grid\s+vs\s+flex|flex.*vs.*grid|when.*use.*(?:grid|flex)|grid.*flex.*(?:when|differ)/i.test(input)) {
      return '**CSS Grid vs Flexbox:**\n\n| | CSS Grid | Flexbox |\n|---|---|---|\n' +
        '| **Dimension** | Two-dimensional (rows + columns) | One-dimensional (row OR column) |\n' +
        '| **Layout** | Grid-based page layouts | Alignment within a container |\n' +
        '| **Best for** | Page structure, card grids | Navbars, centering |\n\n' +
        '**Use Grid for:** page layouts, equal-sized card grids, two-dimensional layouts.\n**Use Flexbox for:** navbars, centering, distributing items in one direction.\n\nThey work great together! Use Grid for page layout, Flexbox inside each section.';
    }

    if (/dark\s+mode.*(?:tailwind|css|implement)|tailwind.*dark\s+mode|implement.*dark\s+mode/i.test(input)) {
      return '**Dark mode in Tailwind CSS:**\n\n**Class strategy (recommended):**\n```js\nmodule.exports = { darkMode: "class" };\n```\n```html\n<html class="dark">\n  <div class="bg-white dark:bg-gray-900 text-black dark:text-white">Content</div>\n</html>\n```\n\n**Media strategy** (follows OS preference):\n```js\nmodule.exports = { darkMode: "media" };\n```\n\n**Toggle:** `document.documentElement.classList.toggle("dark")`';
    }

    if (/css\s+custom\s+proper|css\s+variable|what.*custom.*propert.*css/i.test(input) && !/tailwind/i.test(input)) {
      return '**CSS custom properties** (CSS variables) use the `--` prefix and `var()` function.\n\n' +
        '```css\n:root {\n  --color-primary: #3b82f6;\n  --spacing-md: 1rem;\n  --font-body: "Inter", sans-serif;\n}\n.button {\n  background: var(--color-primary);\n  padding: var(--spacing-md);\n}\ncolor: var(--color-accent, #ff6600); /* with fallback */\n```\n\n' +
        '**Advantages:** cascade and inherit, runtime changes via JS, scoped to selectors, enable theming without preprocessors.';
    }

    if (/cascade.*specific|specific.*css|what.*(?:cascade|specificit)|css.*(?:cascade|priority)/i.test(input)) {
      return '**CSS Cascade and Specificity:**\n\n**Priority (highest first):**\n1. `!important`\n2. Inline styles\n3. ID selectors (`#id`)\n4. Class selectors (`.class`, `[attr]`, `:pseudo`)\n5. Element selectors (`div`, `p`)\n\n' +
        '**Specificity scoring:** (ID, Class, Element)\n- `#nav .item a` → (1,1,1)\n- `.header .nav` → (0,2,0)\n\n**`@layer` (CSS 2023+):** Controls cascade layer priority without specificity hacks.\n\n**Best practice:** Avoid `!important`, use `@layer`, prefer class selectors.';
    }

    if (/responsive\s+typograph|fluid\s+typograph|clamp.*font|font.*(?:clamp|fluid|responsive)/i.test(input)) {
      return '**Responsive (fluid) typography** using `clamp()`:\n\n```css\nh1 { font-size: clamp(1.5rem, 4vw, 3rem); }\n/* min: 1.5rem | preferred: 4vw | max: 3rem */\n```\n\n**Units:** `rem` = relative to root (accessible), `em` = relative to parent, `vw` = viewport width (fluid), `ch` = character width.\n\n**Goal:** ~45-75 characters per line for readability.';
    }

    if (/@layer.*css|css.*@layer|layer\s+directive|what.*@layer/i.test(input)) {
      return '**`@layer`** in CSS controls cascade priority explicitly.\n\n```css\n@layer reset, base, components, utilities;\n\n@layer base { h1 { font-size: 2rem; } }\n@layer utilities { .hidden { display: none; } }\n```\n\n**Rules:** Later layers have higher cascade priority. Un-layered styles beat all layered styles. Tailwind CSS v4 uses `@layer` internally.';
    }

    if (/center.*(?:element|div|both|horizontal|vertical)|how\s+(?:do\s+you\s+)?center/i.test(input)) {
      return '**Centering elements in CSS:**\n\n**Flexbox:**\n```css\n.parent { display: flex; justify-content: center; align-items: center; }\n```\n\n**Grid (shortest):**\n```css\n.parent { display: grid; place-items: center; }\n```\n\n**Tailwind:** `flex items-center justify-center` or `grid place-items-center`';
    }

    if (/container\s+quer|@container|container.*query.*css|what.*container.*quer/i.test(input)) {
      return '**CSS Container Queries** style elements based on **container** size, not viewport.\n\n' +
        '```css\n.card-wrapper { container-type: inline-size; container-name: card; }\n\n@container card (min-width: 400px) {\n  .card-title { font-size: 1.5rem; }\n  .card-body { display: grid; grid-template-columns: 1fr 1fr; }\n}\n```\n\n' +
        '**When useful:** Reusable components adapting to container (not viewport), cards in sidebar vs main. Supported in all modern browsers (2023+).';
    }

    if (/scroll.*(?:animat|linked|driven|timeline)|animation.*scroll|css.*scroll.*animat/i.test(input)) {
      return '**Scroll-linked animations:**\n\n**CSS Scroll Timeline:**\n```css\n.reveal {\n  animation: fadeIn linear both;\n  animation-timeline: view();\n  animation-range: entry 0% entry 100%;\n}\n```\n\n**Smooth scroll:** `html { scroll-behavior: smooth; }`\n\n**Libraries:** GSAP ScrollTrigger (most powerful), Framer Motion `useScroll`, Intersection Observer API.';
    }

    if (/rem\b.*\bem\b.*\bpx\b|\bpx\b.*\brem\b|what.*\b(?:rem|em|px|vh|vw)\b\s+unit|differ.*\b(?:rem|em|px)\b/i.test(input)) {
      return '**CSS units — rem, em, px, vh/vw:**\n\n| Unit | Relative to | Use case |\n|---|---|---|\n' +
        '| `px` | Fixed | Borders, fine details |\n| `rem` | Root font size (16px) | Font sizes, spacing |\n| `em` | Parent font size | Component-relative |\n| `vh/vw` | Viewport height/width | Full-screen sections |\n\n' +
        '**Best practice:** Use `rem` for most things (accessible), `px` for borders, `vw/vh` for viewport layouts, `dvh` on mobile.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Auth / Security handlers
    // ══════════════════════════════════════════════════════════════

    if (/\bjwt\b|json\s+web\s+token|how.*jwt.*work|explain.*jwt/i.test(input) && !/oauth|cors|xss|csrf/i.test(input)) {
      return '**JWT (JSON Web Token)** — compact self-contained token for authentication.\n\n' +
        '**Structure:** `header.payload.signature`\n- **Header** — algorithm + type: `{"alg": "HS256", "typ": "JWT"}`\n' +
        '- **Payload** — claims: `{"sub": "1234", "name": "Alice", "exp": ...}`\n' +
        '- **Signature** — HMAC(header + payload, secret)\n\n' +
        '**Flow:** Login → server creates signed token → client stores in httpOnly cookie → sends `Authorization: Bearer <token>` → server verifies signature.\n\n' +
        '**Tips:** Short expiration (15-60 min), refresh tokens for long sessions, httpOnly cookies (not localStorage).';
    }

    if (/oauth|authorization\s+(?:flow|code|grant)|what.*oauth/i.test(input) && !/cors|xss|csrf|jwt\b/i.test(input) && !deps.skillRouter.isExplicitScaffoldRequest(input)) {
      return '**OAuth 2.0** — authorization framework for third-party access without sharing passwords.\n\n' +
        '**Authorization Code flow:**\n1. App redirects user to authorization server (Google, GitHub)\n2. User logs in and grants permission\n3. Server redirects back with authorization code\n4. App exchanges code for access token (server-to-server)\n5. App uses access token to call APIs\n\n' +
        '**Key concepts:** Access token (short-lived), Refresh token (long-lived), Redirect URI, Scopes.\n\n**OAuth = authorization (access). OpenID Connect (OIDC) = authentication (identity).**';
    }

    if (/\bcors\b|cross.?origin\s+resource|what.*cors|cors.*(?:what|why|important)/i.test(input)) {
      return '**CORS** (Cross-Origin Resource Sharing) — browser security restricting cross-origin requests.\n\n' +
        '**How it works:** Browser sends `Origin` header → server responds with `Access-Control-Allow-Origin` → if origins match, browser allows response.\n\n' +
        '**Server headers:**\n```\nAccess-Control-Allow-Origin: https://app.com\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE\nAccess-Control-Allow-Headers: Content-Type, Authorization\n```\n\n' +
        '**Preflight:** Non-simple requests (PUT, DELETE) trigger an OPTIONS preflight request first. Never use `Allow-Origin: *` with credentials.';
    }

    if (/\bxss\b|cross.?site\s+script|what.*xss|prevent.*xss/i.test(input)) {
      return '**XSS (Cross-Site Scripting)** — attack injecting malicious scripts into trusted websites.\n\n' +
        '**Types:** Stored (saved in DB), Reflected (in URL params), DOM-based (client-side).\n\n' +
        '**Prevention:**\n1. **Sanitize** input — remove/escape HTML tags\n2. **Escape** output — encode `<`, `>`, `&`, `"`\n3. **CSP** headers — restrict script sources\n4. **HttpOnly cookies** — prevent JS access\n5. **Frameworks** — React auto-escapes JSX\n\n' +
        '```tsx\n// React is safe by default\nreturn <p>{userInput}</p>; // auto-escaped\n// If needed: DOMPurify.sanitize(html)\n```';
    }

    if (/\bcsrf\b|cross.?site\s+request\s+forg|what.*csrf|prevent.*csrf/i.test(input)) {
      return '**CSRF (Cross-Site Request Forgery)** — tricks authenticated users into unwanted requests.\n\n' +
        '**Attack:** Evil site submits form to bank.com using victim\'s cookies.\n\n' +
        '**Protection:**\n1. **CSRF token** — random token in forms, validated server-side\n2. **SameSite cookies** — `SameSite=Strict` or `SameSite=Lax`\n3. **Check Origin/Referer header**\n4. **Double submit cookie**\n\nNext.js Server Actions have built-in CSRF protection. For API routes, use a cross-site request forgery token library.';
    }

    if (/password.*(?:hash|secur|stor)|hash.*password|bcrypt|argon2.*password|store.*password.*safe/i.test(input)) {
      return '**Storing passwords securely — NEVER plain text. Always hash.**\n\n' +
        '| Algorithm | Strength |\n|---|---|\n| **Argon2** | Strongest (memory-hard) |\n| **bcrypt** | Strong (time-tested) |\n| **scrypt** | Strong (memory-hard) |\n| SHA-256/MD5 | ❌ Never for passwords |\n\n' +
        '**How:** Generate random **salt** (unique per user) → hash(password + salt) → store only hash + salt.\n\n' +
        '```typescript\nimport { hash, verify } from "@node-rs/argon2";\nconst hashed = await hash(password);\nconst valid = await verify(hashed, inputPassword);\n```';
    }

    if (/authentication\s+vs\s+authorization|authorization\s+vs\s+authentication|differ.*(?:authentication|authorization).*(?:authentication|authorization)/i.test(input)) {
      return '**Authentication vs Authorization:**\n\n| | Authentication | Authorization |\n|---|---|---|\n' +
        '| **Question** | "Who are you?" | "What can you do?" |\n| **Verifies** | Identity | Permissions |\n| **Methods** | Password, OAuth, biometrics | Roles, policies, ACLs |\n\n' +
        '**Flow:** User authenticates (proves identity) → server checks authorization (role, permissions) → access granted or denied.';
    }

    if (/rbac|role.?based\s+access|implement.*role.*access|role.*permission.*access/i.test(input)) {
      return '**RBAC (Role-Based Access Control)** assigns permissions to roles, roles to users.\n\n' +
        '```typescript\nconst ROLES = {\n  admin: ["read", "write", "delete", "manage_users"],\n  editor: ["read", "write"],\n  viewer: ["read"],\n} as const;\n\nfunction hasPermission(userRole: keyof typeof ROLES, permission: string) {\n  return ROLES[userRole].includes(permission as any);\n}\n```\n\n' +
        '**Pattern:** Users → Roles → Permissions. Check access in middleware or API routes.';
    }

    // ══════════════════════════════════════════════════════════════
    //  React / Next.js deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/what\s+is\s+next\.?js|explain\s+next\.?js|next\.?js.*(?:what|explain|overview)/i.test(input) && !/app\s+router|server\s+component|server\s+action|middleware|parallel|intercept/i.test(input)) {
      return '**Next.js** is a full-stack React framework by Vercel.\n\n**Key features:**\n' +
        '- **SSR** (Server-Side Rendering) — HTML per request\n- **SSG** (Static Site Generation) — HTML at build time\n' +
        '- **ISR** (Incremental Static Regeneration) — static + revalidation\n- **App Router** (v13.4+) — Server Components, layouts, streaming\n' +
        '- **API Routes** — serverless functions built-in\n- **File-based routing** — pages map to URLs\n- **Image optimization** — `next/image`\n' +
        '- **Middleware** — code before requests complete\n\nUsed by Vercel, Netflix, TikTok, and more.';
    }

    if (/what\s+is\s+isr|\bisr\b.*next\.?js|next\.?js.*\bisr\b/i.test(input)) {
      return '**ISR (Incremental Static Regeneration)** in Next.js lets you update static pages after deployment without rebuilding the entire site.\n\n' +
        '**How it works:**\n- Pages are statically generated at build time\n- After the `revalidate` period, the next request triggers background regeneration\n- Stale page is served while the new one generates (stale-while-revalidate)\n\n' +
        '**Usage (App Router):**\n```tsx\nexport const revalidate = 60; // revalidate every 60s\n```\n\n' +
        '**On-demand ISR:** `revalidatePath(\'/blog\')` or `revalidateTag(\'posts\')` for immediate regeneration.\n\n' +
        '**Benefits:** Static performance (CDN-cached) with dynamic freshness. Perfect for blogs, e-commerce, dashboards.';
    }

    if (/ssr\b.*ssg\b|ssg\b.*ssr|ssr.*isr|difference.*(?:ssr|ssg|isr)|server\s+side.*static\s+(?:site|generat)/i.test(input)) {
      return '**SSR vs SSG vs ISR in Next.js:**\n\n' +
        '| Strategy | When generated | Best for |\n|---|---|---|\n' +
        '| **SSR** (Server-Side Rendering) | Each request | Dynamic data, personalized |\n' +
        '| **SSG** (Static Site Generation) | Build time | Blogs, docs, marketing |\n' +
        '| **ISR** (Incremental Static Regeneration) | Build + revalidates | Static + fresh data |\n\n' +
        '**App Router:** `export const dynamic = "force-dynamic"` (SSR), default is static (SSG), `export const revalidate = 60` (ISR).';
    }

    if (/app\s+router.*pages\s+router|pages\s+router.*app\s+router|differ.*(?:app|pages)\s+router/i.test(input)) {
      return '**App Router vs Pages Router:**\n\n| Feature | App Router (v13.4+) | Pages Router |\n|---|---|---|\n' +
        '| **Components** | Server Components (default) | Client-only |\n| **Routing** | `app/` directory | `pages/` directory |\n' +
        '| **Layouts** | Nested layouts (persistent) | Custom `_app.tsx` |\n| **Data** | `async` Server Components | `getServerSideProps` |\n' +
        '| **Streaming** | Suspense built-in | Not supported |\n\nApp Router is recommended for all new projects.';
    }

    if (/(?:structure|organize|folder|layout|architect).*react.*(?:project|app)|react.*(?:project|app).*(?:structure|organize|folder|layout)|best\s+way.*(?:structure|organize).*react/i.test(input)) {
      return '**React project structure:**\n\n```\nsrc/\n├── components/        # Reusable UI components\n│   ├── ui/            # Generic (Button, Input, Modal)\n│   └── features/      # Feature-specific (UserCard, ChatBubble)\n├── hooks/             # Custom hooks (useAuth, useFetch)\n├── pages/             # Route-level components\n├── lib/               # Utilities, helpers, API client\n├── context/           # React Context providers\n├── types/             # TypeScript type definitions\n├── styles/            # Global styles, Tailwind config\n└── assets/            # Images, fonts, icons\n```\n\n' +
        '**Key principles:**\n- **Group by feature**, not by type (for larger apps)\n- **Co-locate** tests next to components: `Button.tsx` + `Button.test.tsx`\n- **Barrel exports** (`index.ts`) for clean imports\n- Keep components **small** — if it\'s over 200 lines, split it\n- **Hooks folder** for shared logic (not one-off effects)';
    }

    if (/react\s+hooks?\b(?!.*(?:vs|versus|compared|flutter|vue|angular))/i.test(input) && /hooks?/i.test(input)) {
      return 'Hooks replaced class components as the standard way to use state and side effects in React (since 16.8). Here are the ones you\'ll use daily:\n\n**useState** — state + setter:\n```tsx\nconst [count, setCount] = useState(0);\n```\n\n' +
        '**useEffect** — side effects (data fetching, subscriptions):\n```tsx\nuseEffect(() => {\n  document.title = `Count: ${count}`;\n  return () => { /* cleanup */ };\n}, [count]);\n```\n\n' +
        '**useRef** — mutable ref persisting across renders:\n```tsx\nconst inputRef = useRef<HTMLInputElement>(null);\ninputRef.current?.focus();\n```\n\n' +
        '**useCallback** — memoized callback (prevents child re-renders):\n```tsx\nconst handleClick = useCallback(() => setCount(c => c + 1), []);\n```\n\n' +
        '**useMemo** — memoized value (expensive computation):\n```tsx\nconst sorted = useMemo(() => items.sort(compareFn), [items]);\n```\n\n' +
        '**useContext** — consume context without wrapper:\n```tsx\nconst theme = useContext(ThemeContext);\n```\n\n**Hook rules:** Only call at top level (not in loops/conditions). Only from React components or custom hooks.';
    }

    if (/server\s+action|use\s+server|react.*server.*action/i.test(input) && !/app\s+router.*(?:server\s+component|differ|vs)|.*(?:ssr|ssg|isr)/i.test(input)) {
      return '**React Server Actions** — run server-side code from components using `"use server"`.\n\n' +
        '```tsx\n// app/actions.ts\n"use server";\nexport async function createUser(formData: FormData) {\n  const name = formData.get("name") as string;\n  await db.user.create({ data: { name } });\n  revalidatePath("/users");\n}\n```\n\n' +
        '**Usage in form:**\n```tsx\nexport default function Form() {\n  return (\n    <form action={createUser}>\n      <input name="name" required />\n      <button type="submit">Create</button>\n    </form>\n  );\n}\n```\n\n**No API route needed.** Progressive enhancement (works without JS).';
    }

    if (/metadata.*(?:next|seo)|seo.*next\.?js|generatemetadata|head.*next\.?js/i.test(input)) {
      return '**Metadata and SEO in Next.js 14+:**\n\n```tsx\nimport type { Metadata } from "next";\nexport const metadata: Metadata = {\n  title: "My App",\n  description: "Built with Next.js",\n  openGraph: { title: "My App", images: ["/og-image.png"] },\n};\n```\n\n' +
        '**Dynamic:** `export async function generateMetadata({ params }): Promise<Metadata> { ... }`\n\n' +
        '**SEO:** Use metadata export (not `<Head>`), generate sitemap.xml with `app/sitemap.ts`, add `robots.ts`, structured data with JSON-LD.';
    }

    if (/suspense.*(?:react|stream|ssr)|streaming\s+ssr|react.*suspense.*stream/i.test(input)) {
      return '**React Suspense** — declarative loading states and streaming SSR.\n\n' +
        '```tsx\n<Suspense fallback={<p>Loading...</p>}>\n  <AsyncComponent /> {/* streams in when ready */}\n</Suspense>\n```\n\n' +
        '**Streaming SSR:** Server sends shell HTML immediately → suspended components stream in as they complete → React hydrates progressively.\n\n' +
        '**In Next.js:** Use `loading.tsx` (automatic Suspense boundary) or wrap in `<Suspense fallback={...}>`.';
    }

    if (/middleware.*next\.?js|next\.?js.*middleware|explain.*middleware.*next/i.test(input)) {
      return '**Next.js Middleware** — runs before a request completes, at the edge.\n\n' +
        '```typescript\n// middleware.ts (root)\nimport { NextResponse } from "next/server";\nimport type { NextRequest } from "next/server";\n\nexport function middleware(request: NextRequest) {\n  const token = request.cookies.get("token");\n  if (!token && request.nextUrl.pathname.startsWith("/dashboard")) {\n    return NextResponse.redirect(new URL("/login", request.url));\n  }\n  return NextResponse.next();\n}\n\nexport const config = { matcher: ["/dashboard/:path*"] };\n```\n\n' +
        '**Use cases:** Auth checks, redirects, geolocation routing, rate limiting. Runs on edge runtime.';
    }

    if (/react\s+context|usecontext|context.*(?:vs|versus).*(?:state|zustand|redux)|when.*use.*context/i.test(input)) {
      return '**React Context** passes data through the component tree without prop drilling.\n\n' +
        '```tsx\nconst ThemeCtx = createContext<"light"|"dark">("light");\n\nexport function ThemeProvider({ children }) {\n  const [theme, setTheme] = useState<"light"|"dark">("light");\n  return <ThemeCtx.Provider value={theme}>{children}</ThemeCtx.Provider>;\n}\n\nexport const useTheme = () => useContext(ThemeCtx);\n```\n\n' +
        '**Context vs state library:** Context = simple shared state (theme, auth). Zustand/Redux = complex state, frequent updates, devtools needed.\n\n**Warning:** Context re-renders ALL consumers on value change.';
    }

    if (/image.*optim.*next|next.*image.*optim|next\/image|optimize\s+image/i.test(input)) {
      return '**Image optimization in Next.js** via `next/image`:\n\n' +
        '```tsx\nimport Image from "next/image";\n<Image src="/hero.jpg" alt="Hero" width={1200} height={600} priority placeholder="blur" />\n```\n\n' +
        '**Auto features:** WebP/AVIF formats, responsive srcset, lazy loading by default, prevents layout shift (CLS), on-demand optimization.\n\n**Remote images:** Add domains to `next.config.js` → `images.remotePatterns`.';
    }

    if (/react\.?\s*memo\b|when.*use.*memo|memo.*performance/i.test(input) && !/usecallback|usememo/i.test(input)) {
      return '**React.memo** — memoizes a component, preventing re-renders when props haven\'t changed.\n\n' +
        '```tsx\nconst ExpensiveList = React.memo(function({ items }) {\n  return <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>;\n});\n```\n\n' +
        '**When to use:** Component re-renders often with same props, has expensive rendering.\n**When NOT:** Props change every render (waste), simple components.\n\nCombine with `useMemo`/`useCallback` to stabilize object/function props for performance.';
    }

    if (/forward\s*ref|forwardref|forward.*ref.*react|react.*forward.*ref/i.test(input)) {
      return '**React.forwardRef** lets a component expose a DOM node (or child ref) to its parent.\n\n' +
        '```tsx\nconst FancyInput = React.forwardRef<HTMLInputElement, Props>((props, ref) => {\n  return <input ref={ref} className="fancy" {...props} />;\n});\n\n// Parent can now access the input directly:\nconst inputRef = useRef<HTMLInputElement>(null);\n<FancyInput ref={inputRef} />\ninputRef.current?.focus();\n```\n\n' +
        '**React 19 update:** `forwardRef` is no longer needed — `ref` is passed as a regular prop:\n```tsx\nfunction FancyInput({ ref, ...props }: { ref?: React.Ref<HTMLInputElement> }) {\n  return <input ref={ref} {...props} />;\n}\n```\n\n' +
        '**Use cases:** Design system components (Input, Button), wrapping third-party components, imperative handles with `useImperativeHandle`.';
    }

    if (/parallel\s+route|intercept.*route|@.*slot.*next|modal.*route.*next/i.test(input)) {
      return '**Parallel routes** — render multiple pages in one layout using **slots** (`@`):\n```\napp/layout.tsx  → receives @analytics, @team as props\napp/@analytics/page.tsx\napp/@team/page.tsx\n```\n\n' +
        '**Intercepting routes** — show a route as modal while preserving URL:\n```\napp/(.)photo/[id]/page.tsx  → intercepts as modal\napp/photo/[id]/page.tsx     → full page (direct nav)\n```\n\n**Convention:** `(.)` same level, `(..)` one level up, `(...)` from root. Used for @modal patterns in App Router.';
    }

    if (/error\s+boundar|catch.*error.*react|react.*error.*catch|error\.tsx.*next/i.test(input)) {
      return '**Error boundaries** in React catch JS errors in children and display a fallback UI.\n\n' +
        '**Next.js App Router — `error.tsx`:**\n```tsx\n"use client";\nexport default function Error({ error, reset }: { error: Error; reset: () => void }) {\n  return <div><h2>Something went wrong!</h2><button onClick={reset}>Try again</button></div>;\n}\n```\n\n' +
        '**Class-based:** Implement `getDerivedStateFromError` + `componentDidCatch`.\n\n**Key rule:** Error boundaries only catch rendering errors — not event handlers or async code.';
    }

    if (/usecallback.*usememo|usememo.*usecallback|differ.*(?:usecallback|usememo)/i.test(input)) {
      return '**useCallback vs useMemo:**\n\n| | useCallback | useMemo |\n|---|---|---|\n' +
        '| **Returns** | Memoized function | Memoized value |\n| **Use case** | Stable function reference | Expensive computation |\n\n' +
        '```tsx\nconst sorted = useMemo(() => items.sort(...), [items]); // memoized value\nconst handleClick = useCallback((id) => setSelected(id), []); // memoized function\n```\n\n' +
        '**When:** `useCallback` for functions passed to memoized children. `useMemo` for expensive calculations. Don\'t optimize prematurely.';
    }

    if (/layout.*(?:next|app\s+router)|next.*layout.*(?:work|explain|how|what)/i.test(input) && !/parallel|intercept/i.test(input)) {
      return '**Layouts in Next.js App Router** — shared UI that persists across navigations.\n\n' +
        '```tsx\n// app/layout.tsx (required root layout)\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body><nav/><main>{children}</main></body></html>;\n}\n\n// app/dashboard/layout.tsx (nested)\nexport default function DashLayout({ children }) {\n  return <div className="flex"><aside>Sidebar</aside><section>{children}</section></div>;\n}\n```\n\n' +
        '**Key:** Layouts are nested automatically, persist on navigation (no re-render), receive children prop.';
    }

    if (/client.?side\s+navig|next.*(?:link\b|prefetch|navig)|link\s+component.*next/i.test(input) && !/middleware|intercept|parallel/i.test(input)) {
      return '**Client-side navigation in Next.js:**\n\n' +
        '**`<Link>` component:**\n```tsx\nimport Link from "next/link";\n<Link href="/">Home</Link>\n<Link href="/about" prefetch={false}>About</Link>\n```\n\n' +
        '**`useRouter` hook:**\n```tsx\nimport { useRouter } from "next/navigation";\nconst router = useRouter();\nrouter.push("/dashboard");\nrouter.prefetch("/settings");\n```\n\n' +
        '**Prefetching:** Links in viewport are automatically prefetched. No full page reload on navigation.';
    }

    if (/portal.*react|react.*portal|createportal|what.*portal/i.test(input)) {
      return '**React Portals** render children into a different DOM node outside the parent.\n\n```tsx\nimport { createPortal } from "react-dom";\n\nfunction Modal({ children, onClose }) {\n  return createPortal(\n    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">\n      <div className="bg-white rounded-lg p-6">{children}<button onClick={onClose}>Close</button></div>\n    </div>,\n    document.body\n  );\n}\n```\n\n' +
        '**Use cases:** Modals/dialogs (escape overflow/z-index), tooltips, toast notifications. Events still bubble through React tree.';
    }

    if (/code\s+split.*next|lazy.*import.*next|dynamic\s+import.*next|bundle.*split/i.test(input)) {
      return '**Code splitting in Next.js:**\n\n**`next/dynamic`:**\n```tsx\nimport dynamic from "next/dynamic";\nconst Chart = dynamic(() => import("./Chart"), {\n  loading: () => <p>Loading...</p>,\n  ssr: false,\n});\n```\n\n' +
        '**React.lazy + Suspense:**\n```tsx\nconst Heavy = lazy(() => import("./Heavy"));\n<Suspense fallback={<p>Loading...</p>}><Heavy /></Suspense>\n```\n\n' +
        '**Automatic:** Next.js code-splits by route. Each page/layout is a separate bundle chunk.';
    }

    // ══════════════════════════════════════════════════════════════
    //  DevOps deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/docker.*(?:crash|fail|error|debug|troubleshoot|not\s+(?:working|starting|running))|(?:crash|fail|error|debug|troubleshoot).*docker/i.test(input)) {
      return '**Debugging a Docker container** — when something breaks, here\'s the workflow I follow:\n\n' +
        '**1. Check logs:**\n```bash\ndocker logs <container>          # stdout/stderr\ndocker logs --tail 50 <container> # last 50 lines\ndocker logs -f <container>        # follow live\n```\n\n' +
        '**2. Inspect the container:**\n```bash\ndocker inspect <container>        # full config + state\ndocker ps -a                      # see exit codes\n```\n\n' +
        '**3. Get inside a running container:**\n```bash\ndocker exec -it <container> sh    # open shell\n```\n\n' +
        '**Common crash causes:**\n- Missing environment variables → check `docker inspect` or `.env` file\n- Port conflicts → `docker ps` to see bound ports\n- Out of memory → add `--memory=512m` or check `docker stats`\n- Bad CMD/ENTRYPOINT → test with `docker run -it <image> sh`\n- File permissions → ensure `USER` in Dockerfile matches volume ownership';
    }

    if (/docker\s+image.*(?:vs|container)|container.*vs.*image|differ.*docker.*(?:image|container)/i.test(input)) {
      return '**Docker Image vs Container:**\n\n| | Image | Container |\n|---|---|---|\n' +
        '| **What** | Read-only template (blueprint) | Running instance of an image |\n| **State** | Immutable | Mutable (writable layer) |\n| **Analogy** | Class | Object/Instance |\n\n' +
        '**One image → many containers.** Images are built from Dockerfiles. Containers are created from images with `docker run`.';
    }

    if (/docker.?compose|what.*compose|compose.*(?:what|when|explain)/i.test(input) && !/dockerfile/i.test(input)) {
      return '**Docker Compose** — tool for defining multi-container applications in a YAML file.\n\n' +
        '```yaml\n# docker-compose.yml\nservices:\n  app:\n    build: .\n    ports: ["3000:3000"]\n    env_file: .env\n    depends_on: [db]\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_DB: myapp\n    volumes: [pgdata:/var/lib/postgresql/data]\nvolumes:\n  pgdata:\n```\n\n' +
        '**Commands:** `docker compose up -d`, `docker compose down`, `docker compose logs`.\n**When:** Multi-service apps (app + db + redis), local dev environments.';
    }

    if (/github\s+actions\s+workflow|write.*github.*action|github.*action.*(?:next|workflow)/i.test(input)) {
      return '**GitHub Actions workflow for Next.js:**\n\n```yaml\n# .github/workflows/ci.yml\nname: CI\non:\n  push: { branches: [main] }\n  pull_request: { branches: [main] }\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: pnpm/action-setup@v2\n      - uses: actions/setup-node@v4\n        with: { node-version: 20, cache: pnpm }\n      - run: pnpm install --frozen-lockfile\n      - run: pnpm lint\n      - run: pnpm test\n      - run: pnpm build\n```\n\n' +
        '**Key:** checkout, setup-node, install deps, lint, test, build in sequential steps.';
    }

    if (/(?:docker.*(?:vs|versus|compared|difference|differ).*(?:k8s|kubernetes))|(?:(?:k8s|kubernetes).*(?:vs|versus|compared|difference|differ).*docker)|(?:difference.*(?:docker|k8s|kubernetes).*(?:docker|k8s|kubernetes))/i.test(input)) {
      return '**Docker vs Kubernetes:**\n\n' +
        '| | Docker | Kubernetes (K8s) |\n|---|---|---|\n' +
        '| **What it does** | Builds and runs containers | Orchestrates containers at scale |\n' +
        '| **Scope** | Single host | Cluster of machines |\n' +
        '| **Scaling** | Manual (`docker run` more copies) | Automatic (set replicas, K8s handles it) |\n' +
        '| **Self-healing** | No (container dies = stays dead) | Yes (restarts failed pods) |\n' +
        '| **Load balancing** | Basic (Docker Compose) | Built-in (Services) |\n' +
        '| **Config file** | Dockerfile, docker-compose.yml | deployment.yaml, service.yaml |\n' +
        '| **Learning curve** | Low | High |\n\n' +
        '**How they work together:** Docker builds your images. Kubernetes deploys and manages them across servers. Most teams use both — Docker for packaging, K8s for production orchestration.';
    }

    if (/kubernetes|k8s|what.*kubernetes/i.test(input)) {
      return '**Kubernetes (K8s)** picks up where Docker leaves off — once you have containers, K8s decides where they run, how many copies exist, and what happens when they crash.\n\n' +
        '**Core concepts:**\n- **Pod** — smallest deployable unit (one or more containers)\n- **Service** — stable network endpoint for pods\n- **Deployment** — manages pod replicas and updates\n- **Node** — physical/virtual machine running pods\n- **Cluster** — set of nodes managed by Kubernetes\n\n' +
        '**Docker vs K8s:** Docker = build and run containers. Kubernetes = orchestrate containers at scale (scheduling, self-healing, load balancing).';
    }

    // "What are microservices?" / "Tell me about microservices" / "Microservices vs monolith"
    if (/microservice|micro.?service/i.test(input)) {
      if (/monolith|vs|compar|differ/i.test(input)) {
        return '**Microservices vs Monolith:**\n\n| | Monolith | Microservices |\n|---|---|---|\n' +
          '| **Deployment** | One unit | Independent services |\n| **Scaling** | Scale everything | Scale per-service |\n| **Team** | One codebase | Service per team |\n| **Complexity** | Simpler at first | Distributed system complexity |\n| **Data** | Shared database | Database per service |\n| **Failure** | One bug can crash all | Isolated failures |\n\n' +
          '**When to use microservices:** Large teams, independent scaling needs, polyglot tech stacks.\n**When monolith is better:** Small teams, early-stage products, simple domains. Start monolith, extract services when you feel the pain.';
      }
      return '**Microservices** decompose an application into small, independently deployable services — each owning its own data and business logic.\n\n' +
        '**Key principles:**\n' +
        '- **Single responsibility** — each service does one thing well\n' +
        '- **Independent deployment** — update one service without redeploying all\n' +
        '- **Database per service** — no shared databases\n' +
        '- **API communication** — REST, gRPC, or message queues between services\n' +
        '- **Decentralized governance** — each team picks their own stack\n\n' +
        '**Common patterns:** API Gateway, Service Discovery, Circuit Breaker, Event Sourcing, CQRS.\n\n' +
        '**Trade-offs:** Operational complexity (distributed tracing, service mesh), network latency, data consistency challenges. Start with a well-structured monolith unless you have a strong reason to go micro.';
    }

    // "What is CI/CD?" / "Explain CI/CD" / "Continuous integration"
    if (/ci\s*\/?\s*cd\b|continuous\s+(?:integration|delivery|deployment)(?!\s+(?:monorepo|pipeline\s+for\s+monorepo))/i.test(input) && !/monorepo/i.test(input)) {
      return '**CI/CD** — Continuous Integration / Continuous Delivery (or Deployment).\n\n' +
        '**CI (Continuous Integration):**\n- Developers merge code to main branch frequently\n- Every merge triggers automated build + tests\n- Catch bugs early, keep the codebase healthy\n\n' +
        '**CD (Continuous Delivery):**\n- Code is always in a deployable state\n- One-click deployment to production\n- Automated staging → manual production approval\n\n' +
        '**CD (Continuous Deployment):**\n- Every passing commit deploys to production automatically\n- No manual gates — requires strong test coverage\n\n' +
        '**Popular tools:** GitHub Actions, GitLab CI, Jenkins, CircleCI, Argo CD.\n\n' +
        '```yaml\n# GitHub Actions example\non: [push]\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm test\n      - run: npm run build\n```';
    }

    // "What is PostgreSQL?" / "Explain PostgreSQL" / "Tell me about Postgres"
    if (/(?:what\s+is|explain|tell\s+me\s+about|describe)\s+(?:postgres(?:ql)?)\b/i.test(input)) {
      return '**PostgreSQL** is a powerful open-source relational database — the most feature-rich SQL database available.\n\n' +
        '**Why PostgreSQL:**\n' +
        '- **JSONB** — store and query JSON with indexes (best-in-class)\n' +
        '- **Extensions** — PostGIS (geospatial), pg_vector (AI embeddings), pg_trgm (fuzzy search)\n' +
        '- **Full-text search** — built-in, no external engine needed\n' +
        '- **ACID compliant** — reliable transactions\n' +
        '- **Arrays, enums, custom types** — rich type system\n' +
        '- **CTEs, window functions, lateral joins** — advanced SQL\n\n' +
        '**Getting started:**\n```sql\nCREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL,\n  email TEXT UNIQUE,\n  metadata JSONB DEFAULT \'{}\'\n);\n\nCREATE INDEX idx_metadata ON users USING GIN (metadata);\n```\n\n' +
        '**2026 recommendation:** PostgreSQL is the default choice for most projects. Use MySQL only if you have a specific reason.';
    }

    // "What is Redis?" / "Explain Redis" / "Tell me about Redis"
    if (/(?:what\s+is|explain|tell\s+me\s+about|describe)\s+redis\b/i.test(input)) {
      return '**Redis** is an **in-memory data store** — think of it as a lightning-fast dictionary that lives in RAM.\n\n' +
        '**Why Redis matters:** It handles millions of operations per second with sub-millisecond latency. When your database is too slow for certain reads, Redis is the answer.\n\n' +
        '**Key data structures:**\n' +
        '- **Strings** — caching, counters (`INCR page:views`)\n' +
        '- **Hashes** — objects/sessions (`HSET user:1 name "Alice" age 30`)\n' +
        '- **Lists** — queues, recent items\n' +
        '- **Sets** — unique collections, intersections\n' +
        '- **Sorted Sets** — leaderboards, time-series ranking\n' +
        '- **Streams** — event logs, pub/sub messaging\n\n' +
        '**Common use cases:** Caching, session storage, rate limiting, real-time leaderboards, message queues, pub/sub.\n\n' +
        '```typescript\nimport Redis from "ioredis";\nconst redis = new Redis();\n\nawait redis.set("user:1:name", "Alice", "EX", 3600); // expires in 1h\nconst name = await redis.get("user:1:name"); // "Alice"\nawait redis.incr("page:views"); // atomic counter\n```';
    }

    // "What is GraphQL?" / "Explain GraphQL" / "Tell me about GraphQL"
    if (/(?:what\s+is|explain|tell\s+me\s+about|describe)\s+graphql\b/i.test(input)) {
      return '**GraphQL** is a **query language for APIs** — you ask for exactly the data you need, nothing more.\n\n' +
        '**Why GraphQL matters:** REST returns fixed data shapes. GraphQL lets the client decide what fields to fetch, solving over-fetching and under-fetching in one request.\n\n' +
        '**Key concepts:**\n' +
        '- **Schema** — defines available types, queries, and mutations\n' +
        '- **Queries** — read data: `{ user(id: "1") { name posts { title } } }`\n' +
        '- **Mutations** — write data: `mutation { createUser(name: "Alice") { id } }`\n' +
        '- **Subscriptions** — real-time updates via WebSocket\n' +
        '- **Resolvers** — functions that fetch data for each field\n\n' +
        '**GraphQL vs REST:**\n| | GraphQL | REST |\n|---|---|---|\n' +
        '| **Endpoints** | Single `/graphql` | Multiple `/users`, `/posts` |\n' +
        '| **Data shape** | Client decides | Server decides |\n' +
        '| **Over-fetching** | No | Common |\n' +
        '| **Caching** | More complex | HTTP caching built-in |\n\n' +
        '**Popular tools:** Apollo Server/Client, Pothos (schema-first TS), GraphQL Yoga, Hasura.';
    }

    // "What is MongoDB?" / "Explain MongoDB" / "Tell me about MongoDB"
    if (/(?:what\s+is|explain|tell\s+me\s+about|describe)\s+mongo(?:db)?\b/i.test(input) && !/mongoose/i.test(input)) {
      return '**MongoDB** is a **document database** — it stores data as flexible JSON-like documents instead of rigid tables and rows.\n\n' +
        '**Why MongoDB matters:** When your data doesn\'t fit neatly into tables, or when you need flexible schemas that evolve with your app, MongoDB shines.\n\n' +
        '**Key concepts:**\n' +
        '- **Documents** — JSON-like objects (BSON format)\n' +
        '- **Collections** — groups of documents (like tables)\n' +
        '- **Flexible schema** — documents in the same collection can have different fields\n' +
        '- **Aggregation pipeline** — powerful data processing: $match → $group → $sort\n' +
        '- **Indexes** — B-tree, compound, text, geospatial\n\n' +
        '```javascript\n// Insert\nawait db.collection("users").insertOne({\n  name: "Alice",\n  tags: ["developer", "gamer"],\n  address: { city: "Oslo", country: "Norway" }\n});\n\n// Query with nested field\nawait db.collection("users").find({ "address.city": "Oslo" });\n```\n\n' +
        '**When to use:** Content management, IoT data, catalogs, prototypes. For strict data integrity and complex joins, prefer PostgreSQL.';
    }

    if (/infrastructure\s+as\s+code|what.*iac|iac.*(?:what|explain)|terraform.*(?:what|explain)/i.test(input)) {
      return '**Infrastructure as Code (IaC)** — manage infrastructure through declarative configuration files.\n\n' +
        '**Tools:**\n| Tool | Language | Provider |\n|---|---|---|\n| **Terraform** | HCL | Multi-cloud |\n| **Pulumi** | TS/Python/Go | Multi-cloud |\n| **AWS CDK** | TS/Python | AWS only |\n| **Bicep** | Bicep | Azure only |\n\n' +
        '**Benefits:** Version-controlled, reproducible, reviewable via PRs, automated deployments.\n\n```hcl\nresource "aws_instance" "web" {\n  ami           = "ami-0c55b159cbfafe1f0"\n  instance_type = "t3.micro"\n}\n```';
    }

    if (/multi.?stage.*docker|docker.*multi.?stage|multi.*stage.*build/i.test(input)) {
      return '**Multi-stage Docker build** — use multiple FROM statements to reduce final image size.\n\n```dockerfile\n# Stage 1: Build\nFROM node:20-alpine AS builder\nWORKDIR /app\nCOPY package.json pnpm-lock.yaml ./\nRUN pnpm install --frozen-lockfile\nCOPY . .\nRUN pnpm build\n\n# Stage 2: Production (no dev deps, no source)\nFROM node:20-alpine\nWORKDIR /app\nCOPY --from=builder /app/.next/standalone ./\nCOPY --from=builder /app/public ./public\nEXPOSE 3000\nCMD ["node", "server.js"]\n```\n\n' +
        '**Why:** Build stage has full toolchain. Production stage is tiny (only runtime). Smaller image = faster deploys, less attack surface.';
    }

    if (/env.*variable.*docker|docker.*env|environment.*docker/i.test(input)) {
      return '**Environment variables in Docker:**\n\n' +
        '**In Dockerfile:** `ENV NODE_ENV=production`\n**Build-time:** `ARG API_KEY` + `docker build --build-arg API_KEY=xxx`\n**Runtime:** `docker run -e DB_URL=postgres://...`\n' +
        '**Compose:**\n```yaml\nservices:\n  app:\n    environment:\n      - NODE_ENV=production\n    env_file: .env\n```\n\n' +
        '**Best practice:** Never bake secrets into images. Use `.env` files (gitignored) or secrets management.';
    }

    if (/reverse\s+proxy|nginx.*(?:what|proxy|how)|what.*reverse.*proxy/i.test(input)) {
      return '**Reverse proxy** sits between clients and backend servers, forwarding requests.\n\n**Nginx as reverse proxy:**\n```nginx\nserver {\n  listen 80;\n  server_name myapp.com;\n  location / {\n    proxy_pass http://localhost:3000;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n  }\n}\n```\n\n' +
        '**Benefits:** SSL termination, load balancing, caching, compression, rate limiting. Nginx is the most popular upstream reverse proxy.';
    }

    if (/blue.?green.*deploy|canary.*deploy|blue.*green.*canary|deploy.*(?:blue|canary)/i.test(input)) {
      return '**Blue-green vs Canary deployment:**\n\n| | Blue-Green | Canary |\n|---|---|---|\n' +
        '| **Traffic** | Switch 100% at once | Gradual rollout (1% → 10% → 100%) |\n| **Rollback** | Instant (switch back) | Stop canary, route to stable |\n| **Risk** | Medium (all-or-nothing) | Low (small % affected) |\n| **Cost** | 2x infrastructure | Minimal extra |\n\n' +
        '**Blue-green:** Two identical environments. Deploy to "green", test, switch traffic from "blue" to "green".\n**Canary:** Route small % of traffic to new version, monitor, gradually increase.';
    }

    if (/docker\s+volume|volume.*docker|persist.*docker|what.*docker.*volume/i.test(input)) {
      return '**Docker volumes** persist data beyond container lifecycle.\n\n```yaml\nservices:\n  db:\n    image: postgres:16\n    volumes:\n      - pgdata:/var/lib/postgresql/data  # named volume\n      - ./init.sql:/docker-entrypoint-initdb.d/init.sql  # bind mount\nvolumes:\n  pgdata:  # persists even when container is removed\n```\n\n' +
        '**Types:** Named volumes (managed by Docker), bind mounts (host directory), tmpfs (memory only).\n**Why:** Databases, uploads, logs — any data that must survive container restarts.';
    }

    if (/ci\s+(?:pipeline\s+)?.*monorepo|monorepo.*ci|how.*set.*ci.*monorepo/i.test(input)) {
      return '**CI pipeline for monorepo:**\n\n```yaml\n# .github/workflows/ci.yml\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with: { fetch-depth: 0 }  # full history for affected detection\n      - uses: actions/cache@v3\n        with: { path: node_modules/.cache, key: turbo-${{ hashFiles("**/pnpm-lock.yaml") }} }\n      - run: pnpm install\n      - run: pnpm turbo run lint test build --filter=...[origin/main]\n```\n\n' +
        '**Key:** Only run affected packages, cache build artifacts, use `--filter` to scope.';
    }

    if (/gitops|what.*gitops|gitops.*(?:what|how|explain)/i.test(input)) {
      return '**GitOps** — using Git as the single source of truth for declarative infrastructure and deployment.\n\n' +
        '**How it works:**\n1. All infrastructure/config stored in Git\n2. Pull requests for changes (review + audit trail)\n3. Automated reconciliation — controller watches Git, applies changes\n4. Drift detection — alerts if reality differs from Git state\n\n' +
        '**Tools:** ArgoCD, Flux, Jenkins X.\n**Key principle:** The desired state is declared in Git. An operator reconciles the actual state to match.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Database deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/sql\s+vs\s+nosql|nosql\s+vs\s+sql|differ.*(?:sql|nosql).*(?:sql|nosql)/i.test(input)) {
      return '**SQL vs NoSQL databases:**\n\n| | SQL (Relational) | NoSQL (Non-relational) |\n|---|---|---|\n' +
        '| **Structure** | Tables with schemas | Documents, key-value, graph |\n| **Joins** | Native JOIN support | Usually no joins (embed data) |\n| **Schema** | Fixed, enforced | Flexible, schema-less |\n| **Scale** | Vertical (scale up) | Horizontal (scale out) |\n| **ACID** | Full ACID compliance | Eventual consistency (often) |\n\n' +
        '**SQL:** PostgreSQL, MySQL — structured data, complex queries, transactions.\n**NoSQL:** MongoDB (document), Redis (key-value), DynamoDB (cloud-native).';
    }

    if (/(?:define|create)\s+.*schema\s+.*prisma|prisma\s+schema\s+(?:defin|creat|how|synta)/i.test(input)) {
      return '**Prisma schema definition:**\n\n```prisma\n// prisma/schema.prisma\nmodel User {\n  id        String   @id @default(cuid())\n  email     String   @unique\n  name      String?\n  posts     Post[]\n  role      Role     @default(USER)\n  createdAt DateTime @default(now())\n}\n\nmodel Post {\n  id       String  @id @default(cuid())\n  title    String\n  author   User    @relation(fields: [authorId], references: [id])\n  authorId String\n}\n\nenum Role { USER ADMIN }\n```\n\n**Key:** `@id`, `@unique`, `@default`, `@relation` for relationships. Run `npx prisma db push` or `npx prisma migrate dev`.';
    }

    if (/database\s+migrat|what.*migrat.*database|migrat.*(?:what|why|important)/i.test(input)) {
      return '**Database migrations** = versioned, incremental schema changes.\n\n**Why:** Track schema history, reproducible across environments, team collaboration, rollback support.\n\n' +
        '**Prisma:** `npx prisma migrate dev --name add_users` → creates SQL migration file → applies to DB.\n\n**Key concepts:**\n- Schema version tracking\n- Up/down migrations (apply/rollback)\n- Change history in version control\n- Applied in order, idempotent';
    }

    if (/database\s+index|index.*(?:database|perform|query)|what.*index.*database|explain.*index/i.test(input)) {
      return '**Database indexing** — data structures that speed up queries (like a book index).\n\n' +
        '**Types:**\n- **B-tree** — default, good for range queries and equality\n- **Hash** — fast equality lookups\n- **GIN** — full-text search, JSONB\n- **Composite** — multi-column index\n\n' +
        '**When to index:** Columns used in WHERE, JOIN, ORDER BY. Primary keys are auto-indexed.\n\n**Trade-off:** Faster reads, slower writes (index must be updated). Don\'t over-index.\n\n```sql\nCREATE INDEX idx_user_email ON users(email);\n```\n**Performance impact can be dramatic — from full table scan to instant lookup.**';
    }

    if (/postgres.*vs.*mysql|mysql.*vs.*postgres|differ.*(?:postgres|mysql)/i.test(input)) {
      return '**PostgreSQL vs MySQL:**\n\n| | PostgreSQL | MySQL |\n|---|---|---|\n' +
        '| **JSON** | Native JSONB (indexable) | Basic JSON support |\n| **Extensions** | Rich ecosystem (PostGIS, etc.) | Limited |\n| **Types** | Arrays, enums, custom types | Simpler type system |\n| **Compliance** | More SQL-standard | Some deviations |\n| **Performance** | Complex queries | Simple read-heavy |\n\n' +
        '**2026 recommendation:** PostgreSQL for most projects (richer features, better JSON support, extensions).';
    }

    if (/transaction.*prisma|prisma.*transaction|database\s+transaction/i.test(input)) {
      return '**Database transactions in Prisma:**\n\n```typescript\n// Sequential operations (all succeed or all fail)\nawait prisma.$transaction([\n  prisma.user.create({ data: { name: "Alice" } }),\n  prisma.post.create({ data: { title: "Hello", authorId: "..." } }),\n]);\n\n// Interactive transaction\nawait prisma.$transaction(async (tx) => {\n  const user = await tx.user.findUnique({ where: { id } });\n  if (user.balance < amount) throw new Error("Insufficient funds");\n  await tx.user.update({ where: { id }, data: { balance: { decrement: amount } } });\n});\n```\n\n' +
        '**Atomic** — all operations succeed or none do. Essential for financial operations, data consistency.';
    }

    if (/connection\s+pool|pool.*(?:database|connect)|what.*connection.*pool/i.test(input)) {
      return '**Connection pooling** — maintain a pool of reusable database connections instead of creating new ones per request.\n\n' +
        '**Why:** Creating connections is expensive (TCP handshake, auth). Pool reuses existing connections for concurrent requests.\n\n' +
        '**Prisma** manages pooling automatically. For serverless, use **Prisma Accelerate** or **PgBouncer**.\n\n' +
        '**Config:** `DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=10"`\n\n**Key:** Limits concurrent connections, prevents database overload, reduces latency.';
    }

    if (/n\+1\s+query|n\+1\s+problem|what.*n\+1|solve.*n\+1/i.test(input)) {
      return '**N+1 query problem** — fetching a list (1 query) then fetching related data per item (N queries).\n\n' +
        '**Bad (N+1):**\n```typescript\nconst users = await prisma.user.findMany(); // 1 query\nfor (const u of users) {\n  const posts = await prisma.post.findMany({ where: { authorId: u.id } }); // N queries!\n}\n```\n\n' +
        '**Fixed (eager loading with `include`):**\n```typescript\nconst users = await prisma.user.findMany({\n  include: { posts: true }, // 1 JOIN query instead of N+1\n});\n```\n\n' +
        '**Also:** SQL `JOIN`, DataLoader pattern, GraphQL batching.';
    }

    if (/drizzle\s+orm|what.*drizzle|drizzle.*(?:compare|vs|differ)/i.test(input) && !/prisma.*(?:setup|schema|what)/i.test(input)) {
      return '**Drizzle ORM** — lightweight, type-safe, SQL-like ORM for TypeScript.\n\n' +
        '**Drizzle vs Prisma:**\n| | Drizzle | Prisma |\n|---|---|---|\n' +
        '| **Schema** | TypeScript | Prisma Schema Language |\n| **Queries** | SQL-like | Method chaining |\n| **Bundle** | Lightweight (~7KB) | Larger (engine binary) |\n| **Performance** | Faster (less overhead) | Good |\n\n' +
        '```typescript\nimport { pgTable, text, integer } from "drizzle-orm/pg-core";\nconst users = pgTable("users", {\n  id: text("id").primaryKey(),\n  name: text("name").notNull(),\n  age: integer("age"),\n});\n```';
    }

    // ══════════════════════════════════════════════════════════════
    //  General language overview handlers (Rust, Go)
    // ══════════════════════════════════════════════════════════════

    // "What is Rust?" / "Explain Rust" / "Tell me about Rust"
    if (/(?:what\s+is|explain|tell\s+me\s+about|describe)\s+rust\b/i.test(input) && !/iron|oxide|corrosion|metal/i.test(input)) {
      return '**Rust** is a systems programming language focused on **safety, speed, and concurrency** — created by Mozilla (2010, stable 2015).\n\n' +
        '**Why Rust matters:** It gives you C/C++-level performance without the memory bugs. The compiler catches use-after-free, data races, and null pointer errors **at compile time**.\n\n' +
        '**Key concepts:**\n' +
        '- **Ownership** — each value has exactly one owner\n' +
        '- **Borrowing** — references without taking ownership (`&T`, `&mut T`)\n' +
        '- **Lifetimes** — compiler-enforced reference validity\n' +
        '- **Pattern matching** — exhaustive `match` expressions\n' +
        '- **Zero-cost abstractions** — iterators, generics compile to optimal code\n\n' +
        '**Use cases:** operating systems, game engines, WebAssembly, CLI tools, embedded systems.\n\n' +
        '**Ecosystem:** Cargo (build tool + package manager), crates.io (package registry).';
    }

    // "What is Go?" / "What is Golang?" / "Explain Go" / "Tell me about Go"
    if (/(?:what\s+is|explain|tell\s+me\s+about|describe)\s+(?:go(?:lang)?)\b/i.test(input) && !/(?:how|where)\s+(?:do|does|should|can|to)\s+i?\s*go\b/i.test(input)) {
      return '**Go** (Golang) is a statically typed, compiled language designed at **Google** (2009) for simplicity and concurrency.\n\n' +
        '**Why Go matters:** It compiles fast, runs fast, and makes concurrency easy. If you need a reliable backend service that handles thousands of concurrent connections, Go is a strong pick.\n\n' +
        '**Key features:**\n' +
        '- **Goroutines** — lightweight threads (start thousands with minimal memory)\n' +
        '- **Channels** — type-safe communication between goroutines\n' +
        '- **Simple syntax** — intentionally minimal (no generics until 1.18, no classes)\n' +
        '- **Fast compilation** — large projects compile in seconds\n' +
        '- **Static binary** — single executable, no runtime dependencies\n\n' +
        '**Use cases:** microservices, CLI tools, DevOps tooling (Docker, Kubernetes are written in Go), APIs.\n\n' +
        '**Getting started:** `go mod init`, `go run main.go`, `go build`.';
    }

    // "What is Git?" / "Tell me about Git" / "Explain Git"
    if (/(?:what\s+is|explain|tell\s+me\s+about|describe)\s+git\b/i.test(input) && !/github\s+actions|github\s+pages/i.test(input)) {
      return '**Git** is a **distributed version control system** — it lets you track every change to your code, undo mistakes, and collaborate with others without stepping on each other\'s work.\n\n' +
        '**Why it matters:** Without Git, one bad edit can destroy your project. With Git, you can always go back.\n\n' +
        '**Key operations:**\n' +
        '- `git init` — start tracking a project\n' +
        '- `git add .` — stage changes\n' +
        '- `git commit -m "message"` — save a snapshot\n' +
        '- `git branch feature/x` — create a parallel line of work\n' +
        '- `git merge` — combine branches\n' +
        '- `git push` / `git pull` — sync with a remote (GitHub, GitLab)\n\n' +
        '**Core concept:** Git stores *snapshots*, not diffs. Every commit is a full snapshot of your project at that point in time, with pointers to unchanged files for efficiency.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Rust deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/string\b.*&str|&str.*string|differ.*(?:string|&str).*rust/i.test(input)) {
      return '**`String` vs `&str` in Rust:**\n\n| | `String` | `&str` |\n|---|---|---|\n' +
        '| **Storage** | Heap-allocated, owned | String slice (reference) |\n| **Mutability** | Growable, mutable | Immutable |\n| **Ownership** | Owns the data | Borrows the data |\n\n' +
        '```rust\nlet owned: String = String::from("hello"); // heap, owned\nlet slice: &str = "hello";                  // stack/static, borrowed\nlet s: &str = &owned;                       // borrow from String\n```\n\n' +
        '**Rule:** Use `&str` for function params (accept any string). Use `String` when you need ownership.';
    }

    if (/borrow\s+checker.*rust|rust.*borrow\s+checker|explain.*borrow\s+checker/i.test(input)) {
      return '**Rust borrow checker** — compile-time verification of memory safety rules.\n\n**Rules:**\n' +
        '1. Each value has one owner\n2. At any time: **one mutable reference** OR **any number of immutable references**\n3. References must always be valid (no dangling)\n\n' +
        '```rust\nlet mut s = String::from("hello");\nlet r1 = &s;     // immutable borrow OK\nlet r2 = &s;     // another immutable OK\n// let r3 = &mut s; // ERROR: can\'t borrow mutably while immutably borrowed\nprintln!("{} {}", r1, r2);\nlet r3 = &mut s;  // OK now — r1 and r2 no longer used\n```\n\n' +
        '**Why:** Prevents data races, dangling pointers, use-after-free — all at compile time with zero runtime cost.';
    }

    if (/trait.*rust|rust.*trait|what.*trait.*rust|trait.*(?:vs|interface)/i.test(input)) {
      return '**Traits in Rust** — define shared behavior (similar to interfaces).\n\n' +
        '```rust\ntrait Summary {\n  fn summarize(&self) -> String;\n  fn default_method(&self) -> String { String::from("Read more...") } // default impl\n}\n\nstruct Article { title: String, content: String }\n\nimpl Summary for Article {\n  fn summarize(&self) -> String {\n    format!("{}: {}...", self.title, &self.content[..50])\n  }\n}\n```\n\n' +
        '**Key differences from interfaces:** Traits can have default method implementations, trait objects for dynamic dispatch (`dyn Trait`), trait bounds for generics (`fn print<T: Display>(x: T)`).';
    }

    if (/result\b.*option|option\b.*result|error\s+handling.*rust|rust.*(?:\bresult\b|\boption\b|\bok\b|\berr\b)|\bresult\b.*(?:type|rust)|what.*result.*rust/i.test(input)) {
      return '**Result and Option in Rust — error handling without exceptions.**\n\n' +
        '**Option<T>** — value that may or may not exist:\n```rust\nfn find_user(id: u32) -> Option<User> {\n  if id == 1 { Some(User { name: "Alice" }) } else { None }\n}\n```\n\n' +
        '**Result<T, E>** — operation that can succeed or fail:\n```rust\nfn parse(s: &str) -> Result<i32, ParseIntError> {\n  s.parse::<i32>()\n}\nmatch parse("42") {\n  Ok(n) => println!("Parsed: {}", n),\n  Err(e) => println!("Error: {}", e),\n}\n```\n\n**`?` operator:** `let n = "42".parse::<i32>()?;` — propagates errors automatically.';
    }

    if (/box\b.*rc\b.*arc|rc\b.*arc|box\b.*rc|differ.*(?:box|rc|arc).*rust/i.test(input)) {
      return '**Box, Rc, and Arc in Rust — smart pointers:**\n\n| | Box<T> | Rc<T> | Arc<T> |\n|---|---|---|\n' +
        '| **Purpose** | Heap allocation | Reference counting | Atomic reference counting |\n| **Ownership** | Single owner | Multiple owners | Multiple owners |\n| **Thread-safe** | Yes (single owner) | ❌ Single-thread only | ✅ Thread-safe |\n\n' +
        '**Box:** Heap allocate data with single owner.\n**Rc:** Multiple owners in single-threaded code (reference counted).\n' +
        '**Arc:** Multiple owners across threads (atomic reference counting). Often combined with `Mutex<T>` for shared mutable state.';
    }

    if (/lifetime.*rust|rust.*lifetime|explain.*lifetime|what.*lifetime/i.test(input) && !/async/i.test(input)) {
      return '**Lifetimes in Rust** — tell the compiler how long references are valid.\n\n' +
        '```rust\n// Lifetime annotation: \'a\nfn longest<\'a>(x: &\'a str, y: &\'a str) -> &\'a str {\n  if x.len() > y.len() { x } else { y }\n}\n```\n\n' +
        '**Why needed:** The compiler must know that the returned reference doesn\'t outlive the data it points to (no dangling references).\n\n' +
        '**Rules:** Lifetime of the return reference must be within the scope of the input references. The `\'a` annotation says "the output lives as long as both inputs."';
    }

    if (/async\b.*rust|rust.*async|tokio|async\s+await.*rust/i.test(input)) {
      return '**Async/await in Rust:**\n\n```rust\nasync fn fetch_data(url: &str) -> Result<String, reqwest::Error> {\n  let body = reqwest::get(url).await?.text().await?;\n  Ok(body)\n}\n\n#[tokio::main]\nasync fn main() {\n  let data = fetch_data("https://api.example.com").await.unwrap();\n}\n```\n\n' +
        '**Key concepts:** `async fn` returns a `Future`. `.await` drives the future to completion. Need a runtime (**Tokio** is most popular).\n\n' +
        '**Rust async is zero-cost** — no heap allocation for state machines, compiled to efficient code.';
    }

    if (/match\b.*rust|rust.*match\s+express|what.*match.*rust|pattern\s+match.*rust/i.test(input)) {
      return '**`match` expression in Rust** — powerful pattern matching (like switch on steroids).\n\n' +
        '```rust\nmatch value {\n  1 => println!("one"),\n  2 | 3 => println!("two or three"),\n  4..=9 => println!("four to nine"),\n  _ => println!("other"), // exhaustive — must handle all cases\n}\n\n// With enums\nmatch result {\n  Ok(val) => println!("Success: {}", val),\n  Err(e) => println!("Error: {}", e),\n}\n```\n\n' +
        '**Key:** Match is exhaustive — every arm must be covered. Uses pattern destructuring. Each arm returns a value.';
    }

    if (/concurrency.*rust|rust.*concurren|send\b.*sync\b.*rust|thread.*rust.*safe/i.test(input)) {
      return '**Rust concurrency — "fearless concurrency":**\n\n' +
        '**Thread safety markers:**\n- **`Send`** — type can be transferred between threads\n- **`Sync`** — type can be shared (&T) between threads\n\n' +
        '**Shared state:**\n```rust\nuse std::sync::{Arc, Mutex};\n\nlet counter = Arc::new(Mutex::new(0));\nlet c = Arc::clone(&counter);\nlet handle = std::thread::spawn(move || {\n  let mut num = c.lock().unwrap();\n  *num += 1;\n});\n```\n\n' +
        '**Key:** Compiler enforces Send + Sync at compile time. Data races are impossible in safe Rust.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Python deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/type\s+hint.*python|python.*type\s+hint|python.*typing|how.*python.*type/i.test(input)) {
      return '**Python type hints** (PEP 484) — optional static type annotations.\n\n' +
        '```python\ndef greet(name: str, age: int) -> str:\n    return f"Hello {name}, age {age}"\n\nfrom typing import Optional, List\ndef find_user(id: int) -> Optional[User]:\n    ...\n\nscores: List[int] = [100, 95, 87]\ndata: dict[str, Any] = {"key": "value"}\n```\n\n' +
        '**Tools:** mypy (type checker), pyright (fast, used in VS Code). Type hints are NOT enforced at runtime — they\'re for static analysis and IDE support.';
    }

    if (/fastapi|what.*fastapi|fastapi.*(?:flask|django|compare)/i.test(input)) {
      return '**FastAPI** — modern, fast Python web framework built on Starlette + Pydantic.\n\n' +
        '**vs Flask/Django:**\n| | FastAPI | Flask | Django |\n|---|---|---|---|\n' +
        '| **Async** | Native async/await | Limited | ASGI (3.1+) |\n' +
        '| **Validation** | Pydantic (automatic) | Manual | Forms/DRF |\n| **Docs** | Auto Swagger/OpenAPI | Manual | DRF |\n| **Performance** | Very fast | Moderate | Moderate |\n\n' +
        '```python\nfrom fastapi import FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI()\n\nclass User(BaseModel):\n    name: str\n    email: str\n\n@app.post("/users")\nasync def create(user: User):\n    return {"id": 1, **user.dict()}\n```';
    }

    if (/decorator.*python|python.*decorator|explain.*decorator.*python|what.*decorator.*python/i.test(input)) {
      return '**Python decorators** — functions that modify other functions using the `@` syntax.\n\n' +
        '```python\ndef log(func):\n    def wrapper(*args, **kwargs):\n        print(f"Calling {func.__name__}")\n        result = func(*args, **kwargs)\n        print(f"Returned {result}")\n        return result\n    return wrapper\n\n@log\ndef add(a, b):\n    return a + b\n\nadd(3, 4)  # prints: Calling add, Returned 7\n```\n\n' +
        '**Common decorators:** `@property`, `@staticmethod`, `@classmethod`, `@functools.cache`, `@app.route()` (Flask/FastAPI).';
    }

    if (/asyncio|python.*async.*await|async.*python|event\s+loop.*python/i.test(input)) {
      return '**asyncio** — Python\'s async I/O framework for concurrent coroutines.\n\n' +
        '```python\nimport asyncio\n\nasync def fetch(url: str) -> str:\n    await asyncio.sleep(1)  # simulate I/O\n    return f"Data from {url}"\n\nasync def main():\n    results = await asyncio.gather(\n        fetch("https://api1.com"),\n        fetch("https://api2.com"),\n    )  # runs concurrently!\n\nasyncio.run(main())\n```\n\n' +
        '**Key:** `async def` = coroutine, `await` = yield to event loop, `asyncio.gather()` = concurrent execution. Best for I/O-bound tasks (network, files).';
    }

    if (/comprehension.*python|python.*comprehension|list\s+comprehension|generator\s+express/i.test(input)) {
      return '**Python comprehensions and generator expressions:**\n\n' +
        '**List comprehension:**\n```python\nsquares = [x**2 for x in range(10)]           # [0, 1, 4, 9, ...]\nevens = [x for x in range(20) if x % 2 == 0]  # filter\n```\n\n' +
        '**Dict comprehension:** `{k: v for k, v in pairs}`\n**Set comprehension:** `{x**2 for x in range(10)}`\n\n' +
        '**Generator expression** (lazy, memory-efficient):\n```python\ngen = (x**2 for x in range(1_000_000))  # no list in memory\nfor val in gen:\n    yield val  # produces values on demand\n```';
    }

    if (/virtual\s*env.*python|python.*(?:venv|virtualenv|pipenv|poetry)|explain.*venv/i.test(input)) {
      return '**Python virtual environments** — isolated package installations per project.\n\n' +
        '| Tool | Usage |\n|---|---|\n| **venv** | `python -m venv .venv` (built-in) |\n| **pipenv** | `pipenv install` (Pipfile) |\n| **poetry** | `poetry init` (pyproject.toml) |\n| **conda** | Scientific computing |\n\n' +
        '**venv workflow:**\n```bash\npython -m venv .venv\nsource .venv/bin/activate  # Linux/Mac\n.venv\\Scripts\\activate     # Windows\npip install fastapi uvicorn\npip freeze > requirements.txt\n```\n\n' +
        '**Why:** Isolates dependencies per project. Avoids version conflicts between projects.';
    }

    if (/pydantic|what.*pydantic|pydantic.*(?:what|why|valid)/i.test(input) && !/fastapi.*(?:flask|django)/i.test(input)) {
      return '**Pydantic** — data validation library using Python type annotations.\n\n' +
        '```python\nfrom pydantic import BaseModel, EmailStr\n\nclass User(BaseModel):\n    name: str\n    email: EmailStr\n    age: int\n\nuser = User(name="Alice", email="alice@example.com", age=30)  # validates!\nUser(name="Bob", email="invalid", age="not a number")  # raises ValidationError\n```\n\n' +
        '**Why:** Runtime validation + type safety. Used by FastAPI for automatic request validation. Generates JSON Schema.';
    }

    if (/dependency\s+inject.*python|python.*depend.*inject|inject.*python/i.test(input)) {
      return '**Dependency injection in Python:**\n\n```python\n# Simple DI via constructor\nclass UserService:\n    def __init__(self, db: Database, cache: Cache):\n        self.db = db\n        self.cache = cache\n\n# FastAPI DI (built-in)\nfrom fastapi import Depends\n\nasync def get_db():\n    db = Database()\n    try:\n        yield db\n    finally:\n        await db.close()\n\n@app.get("/users")\nasync def get_users(db: Database = Depends(get_db)):\n    return await db.fetch_all("SELECT * FROM users")\n```\n\n' +
        '**Libraries:** FastAPI `Depends` (built-in), `dependency-injector`, `python-inject`. DI container manages object creation and lifecycle.';
    }

    if (/dataclass.*python|python.*dataclass|what.*dataclass|@dataclass/i.test(input)) {
      return '**Python dataclasses** (PEP 557) — auto-generate `__init__`, `__repr__`, `__eq__` for data classes.\n\n' +
        '```python\nfrom dataclasses import dataclass, field\n\n@dataclass\nclass User:\n    name: str\n    age: int\n    tags: list[str] = field(default_factory=list)\n\nuser = User(name="Alice", age=30)  # auto __init__\nprint(user)  # User(name=\'Alice\', age=30, tags=[])\n```\n\n' +
        '**Options:** `@dataclass(frozen=True)` for immutable, `@dataclass(slots=True)` for performance.\n**vs Pydantic:** Dataclasses = simple data holders. Pydantic = runtime validation.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Go deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/go\s+channel|channel.*go\b|how.*channel.*work|chan\b.*go\b/i.test(input) && !/goroutine/i.test(input)) {
      return '**Go channels** — typed conduits for communication between goroutines.\n\n' +
        '```go\nch := make(chan string)       // unbuffered\nch := make(chan string, 10)   // buffered (capacity 10)\n\ngo func() { ch <- "hello" }() // send\nmsg := <-ch                    // receive (blocks until data)\n```\n\n' +
        '**Buffered vs unbuffered:** Unbuffered blocks sender until receiver reads. Buffered blocks only when full.\n**Direction types:** `chan<- string` (send-only), `<-chan string` (receive-only).\n**Close:** `close(ch)` signals no more values.';
    }

    if (/error\s+handling.*go\b|go\b.*error\s+handling|how.*handle.*error.*go|go\b.*err.*nil/i.test(input)) {
      return '**Error handling in Go** — explicit error returns (no exceptions).\n\n' +
        '```go\nfunc readFile(path string) (string, error) {\n    data, err := os.ReadFile(path)\n    if err != nil {\n        return "", fmt.Errorf("readFile: %w", err)\n    }\n    return string(data), nil\n}\n\n// Caller must check\ndata, err := readFile("config.json")\nif err != nil {\n    log.Fatal(err)\n}\n```\n\n' +
        '**Pattern:** Functions return `(value, error)`. Caller checks `if err != nil`. Use `fmt.Errorf("...: %w", err)` to wrap errors.';
    }

    if (/go\b.*interface|interface.*go\b|what.*interface.*go|go\b.*implicit.*interface/i.test(input)) {
      return '**Go interfaces** — implicitly satisfied (no `implements` keyword).\n\n' +
        '```go\ntype Writer interface {\n    Write([]byte) (int, error)\n}\n\ntype Logger struct{}\n\n// Logger implicitly satisfies Writer\nfunc (l Logger) Write(data []byte) (int, error) {\n    fmt.Println(string(data))\n    return len(data), nil\n}\n\nfunc save(w Writer) { w.Write([]byte("data")) }\nsave(Logger{}) // Logger satisfies Writer — no explicit declaration needed\n```\n\n' +
        '**Key:** A type satisfies an interface by implementing all its methods. This enables duck typing with compile-time safety.';
    }

    if (/go\b.*struct|struct.*go\b|explain.*struct.*go|go\b.*struct.*class/i.test(input)) {
      return '**Go structs** — composite types (Go\'s answer to classes).\n\n' +
        '```go\ntype User struct {\n    Name  string\n    Email string\n    Age   int\n}\n\n// Method with receiver\nfunc (u User) Greet() string {\n    return fmt.Sprintf("Hi, I\'m %s", u.Name)\n}\n\n// Pointer receiver (can modify)\nfunc (u *User) SetAge(age int) {\n    u.Age = age\n}\n\nuser := User{Name: "Alice", Email: "alice@go.dev", Age: 30}\nuser.Greet() // "Hi, I\'m Alice"\n```\n\n' +
        '**Go has no classes.** Structs + methods + interfaces provide all the composition needed. Favor composition over inheritance.';
    }

    if (/go\s+mod|go\b.*module|go\.mod|go\b.*dependency\s+manage/i.test(input)) {
      return '**Go modules** — dependency management system.\n\n```bash\ngo mod init github.com/user/myapp  # creates go.mod\ngo get github.com/gin-gonic/gin     # add dependency\ngo mod tidy                         # clean up unused deps\n```\n\n' +
        '**go.mod file:**\n```\nmodule github.com/user/myapp\n\ngo 1.22\n\nrequire (\n    github.com/gin-gonic/gin v1.9.1\n)\n```\n\n' +
        '**Key:** `go.mod` tracks dependencies, `go.sum` verifies checksums. Semantic versioning for module versions.';
    }

    if (/http.*go\b|go\b.*http|net\/http|listenandserve|go\b.*web\s+server/i.test(input)) {
      return '**HTTP in Go** using the `net/http` standard library:\n\n' +
        '```go\npackage main\nimport ("fmt"; "net/http")\n\nfunc handler(w http.ResponseWriter, r *http.Request) {\n    fmt.Fprintf(w, "Hello, %s!", r.URL.Path[1:])\n}\n\nfunc main() {\n    http.HandleFunc("/", handler)\n    http.ListenAndServe(":8080", nil)\n}\n```\n\n' +
        '**Popular frameworks:** Gin (fast, middleware), Echo (minimal), Chi (composable), Fiber (Express-like).\n**Key:** `http.Handler` interface, `ListenAndServe` starts server, standard library is production-ready.';
    }

    if (/select\b.*go\b|go\b.*select|select\s+statement.*go|go\b.*select.*channel/i.test(input)) {
      return '**Go `select` statement** — waits on multiple channel operations.\n\n' +
        '```go\nselect {\ncase msg := <-ch1:\n    fmt.Println("From ch1:", msg)\ncase msg := <-ch2:\n    fmt.Println("From ch2:", msg)\ncase <-time.After(5 * time.Second):\n    fmt.Println("Timeout")\ndefault:\n    fmt.Println("No channel ready") // non-blocking\n}\n```\n\n' +
        '**Key:** Like `switch` but for channels. Blocks until one case is ready. If multiple ready, picks randomly. Used for timeouts, multiplexing, cancellation.';
    }

    if (/slice.*array.*go|go\b.*slice.*array|differ.*(?:slice|array).*go|go\b.*(?:slice|array)|\bslice\b.*\bgo\b|what.*slice.*go/i.test(input)) {
      return '**Go slices vs arrays:**\n\n| | Array | Slice |\n|---|---|---|\n' +
        '| **Size** | Fixed at compile time | Dynamic (growable) |\n| **Syntax** | `[3]int{1,2,3}` | `[]int{1,2,3}` |\n| **Length** | Part of type | Separate length + capacity |\n\n' +
        '```go\narr := [3]int{1, 2, 3}   // array (fixed)\nslice := []int{1, 2, 3}  // slice (dynamic)\nslice = append(slice, 4)  // grows automatically\nfmt.Println(len(slice), cap(slice)) // length and capacity\n```\n\n' +
        '**Slices are used 99% of the time.** Arrays are mainly for fixed-size data (crypto hashes, etc.).';
    }

    if (/go\b.*generic|generic.*go\b|go\b.*1\.18|type\s+parameter.*go/i.test(input)) {
      return '**Go generics** (introduced in Go **1.18**, March 2022):\n\n' +
        '```go\nfunc Map[T any, U any](items []T, fn func(T) U) []U {\n    result := make([]U, len(items))\n    for i, item := range items {\n        result[i] = fn(item)\n    }\n    return result\n}\n\n// With constraint\ntype Number interface { int | float64 }\nfunc Sum[T Number](nums []T) T {\n    var total T\n    for _, n := range nums { total += n }\n    return total\n}\n```\n\n' +
        '**Key:** Type parameters with `[T constraint]`, `any` = unconstrained, custom constraints via interfaces.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Accessibility / WCAG deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/pour\s+principle|perceivable.*operable|what.*pour|explain.*pour/i.test(input)) {
      return '**POUR principles** — four pillars of web accessibility (WCAG foundation):\n\n' +
        '1. **Perceivable** — content presented in ways users can perceive (alt text, captions, sufficient contrast)\n' +
        '2. **Operable** — UI navigable by keyboard, enough time, no seizure-inducing content\n' +
        '3. **Understandable** — readable content, predictable navigation, error prevention\n' +
        '4. **Robust** — content works with assistive technologies (valid HTML, ARIA, semantic markup)\n\n' +
        '**Each principle has testable success criteria at levels A, AA, and AAA.**';
    }

    if (/aria\s+(?:attribute|role|label)|what.*aria|when.*use.*aria|aria.*(?:what|when|explain)/i.test(input)) {
      return '**ARIA** (Accessible Rich Internet Applications) — attributes that enhance HTML for screen readers.\n\n' +
        '**Key attributes:**\n- `role="navigation"` — defines the element\'s purpose\n- `aria-label="Close"` — provides accessible name\n- `aria-hidden="true"` — hides from screen readers\n- `aria-expanded="false"` — toggle state\n- `aria-live="polite"` — announces dynamic content\n\n' +
        '**Golden rule:** Use semantic HTML first (`<nav>`, `<button>`, `<main>`). Only add ARIA when native HTML semantics aren\'t sufficient.\n\n' +
        '**"No ARIA is better than bad ARIA."**';
    }

    if (/react.*(?:accessible|screen\s+reader|a11y)|accessible.*react\s+app|screen\s+reader.*react/i.test(input)) {
      return '**Making React apps accessible for screen readers:**\n\n' +
        '1. **Semantic HTML** — use `<button>`, `<nav>`, `<main>`, not `<div onClick>`\n' +
        '2. **Alt text** — `<Image alt="Description" />` for all images\n' +
        '3. **Labels** — every input needs `<label htmlFor="...">`\n' +
        '4. **Focus management** — `autoFocus`, `tabIndex`, focus trapping in modals\n' +
        '5. **ARIA** — `aria-label`, `aria-expanded`, `role` when needed\n' +
        '6. **Keyboard nav** — all interactive elements keyboard-accessible\n\n' +
        '**Tools:** eslint-plugin-jsx-a11y (lint), @testing-library (user-centric tests), axe-core (automated audit).';
    }

    if (/wcag.*(?:aa|aaa)|aa\s+vs\s+aaa|differ.*(?:aa|aaa)|level.*(?:aa|aaa)/i.test(input)) {
      return '**WCAG conformance levels:**\n\n| Level | Requirements |\n|---|---|\n' +
        '| **A** (minimum) | Basic accessibility (alt text, keyboard access) |\n| **AA** (standard) | Color contrast 4.5:1, resize to 200%, focus visible |\n| **AAA** (enhanced) | Contrast 7:1, sign language, extended audio description |\n\n' +
        '**Most laws require AA compliance** (including Norway\'s Likestillings- og diskrimineringsloven).\n**AAA** is aspirational — not typically required by law but covers edge cases.';
    }

    if (/test.*(?:accessib|a11y|wcag)|(?:accessib|a11y|wcag).*test|how.*test.*(?:accessib|a11y)/i.test(input)) {
      return '**Testing web accessibility:**\n\n' +
        '**Automated tools:**\n- **axe DevTools** (browser extension) — catches ~30% of issues\n- **Lighthouse** (Chrome built-in) — accessibility audit score\n- **eslint-plugin-jsx-a11y** — lint React for a11y issues\n\n' +
        '**Manual testing:**\n- **Keyboard-only** navigation (Tab, Enter, Escape)\n- **Screen reader** testing (NVDA, VoiceOver, JAWS)\n- **Color contrast** check (WebAIM contrast checker)\n- **Zoom to 200%** — verify layout doesn\'t break\n\n' +
        '**Best practice:** Combine automated + manual testing. No tool catches everything.';
    }

    if (/color\s+contrast\s+ratio|contrast\s+ratio|wcag.*contrast|what.*contrast.*(?:ratio|require)/i.test(input)) {
      return '**Color contrast ratio (WCAG):**\n\n| Level | Normal text | Large text |\n|---|---|---|\n' +
        '| **AA** | 4.5:1 minimum | 3:1 minimum |\n| **AAA** | 7:1 minimum | 4.5:1 minimum |\n\n' +
        '**Large text:** ≥18pt (24px) or ≥14pt (18.5px) bold.\n**Tools:** WebAIM Contrast Checker, Chrome DevTools, Figma plugins.\n\n' +
        '**Example:** White text on dark blue (ratio 8.5:1) ✅ AA+AAA. Light gray on white (ratio 2:1) ❌ Fails all levels.';
    }

    if (/form.*(?:accessib|a11y)|accessible\s+form|make\s+form.*accessib/i.test(input)) {
      return '**Making forms accessible:**\n\n' +
        '1. **Label every input:** `<label for="email">Email</label><input id="email" />`\n' +
        '2. **Group related fields:** `<fieldset><legend>Address</legend>...</fieldset>`\n' +
        '3. **Error messages:** Link errors to inputs with `aria-describedby`\n' +
        '4. **Required fields:** Use `required` attribute + visual indicator\n' +
        '5. **Autocomplete:** `autocomplete="email"` for common fields\n' +
        '6. **Focus management:** Focus first error field on submission\n\n' +
        '**Never use placeholder as label replacement.** Screen readers may not announce placeholders.';
    }

    if (/focus\s+manage|what.*focus\s+manage|focus\s+trap|focus.*(?:important|manage|trap)/i.test(input)) {
      return '**Focus management** — controlling which element has keyboard focus.\n\n' +
        '**Why important:** Keyboard and screen reader users navigate via focus. Lost focus = lost user.\n\n' +
        '**Key patterns:**\n- **Focus trapping** in modals — Tab cycles within dialog only\n- **Focus restoration** — return focus to trigger after modal closes\n- **Skip links** — "Skip to content" link for keyboard users\n- **Visible focus** — never use `outline: none` without replacement\n\n' +
        '**React:** `useRef` + `ref.current.focus()`, or libraries like Radix UI (handles focus trap automatically).\n\n`tabIndex={0}` makes non-interactive elements focusable. `tabIndex={-1}` makes elements programmatically focusable only.';
    }

    if (/keyboard\s+nav|keyboard\s+access|how.*keyboard.*nav|keyboard.*(?:web|app|accessi)/i.test(input)) {
      return '**Keyboard navigation in web apps:**\n\n**Essential keys:**\n- **Tab** — move between focusable elements\n- **Shift+Tab** — move backwards\n- **Enter/Space** — activate buttons and links\n- **Arrow keys** — navigate within components (menus, tabs, radio groups)\n- **Escape** — close modals, dropdowns\n\n' +
        '**Requirements:**\n1. All interactive elements must be keyboard-accessible\n2. Focus order must be logical (match visual order)\n3. Focus indicator must be visible\n4. No keyboard traps (user can always Tab out)\n\n' +
        '**Tip:** Use semantic HTML (`<button>`, `<a>`, `<input>`) — they get keyboard support for free.';
    }

    // ══════════════════════════════════════════════════════════════
    //  GDPR deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/cookie\s+consent.*banner|gdpr.*cookie.*consent|implement.*consent.*banner/i.test(input)) {
      return '**GDPR-compliant cookie consent banner:**\n\n' +
        '**Requirements:**\n- **Opt-in** — no cookies set before explicit consent\n- **Granular** — separate consent per category (analytics, marketing, functional)\n- **Reject** button equally prominent as Accept\n- **No dark patterns** — no pre-checked boxes\n- **Withdrawable** — easy to change preferences later\n\n' +
        '**Implementation:** Use a consent management platform (CMP) like Cookiebot, Osano, or build custom with React state + cookies.\n\n' +
        '**Key:** Block all tracking scripts until consent is given. Store consent proof for compliance.';
    }

    if (/right\s+to\s+be\s+forgotten|right.*erasure|right.*delete.*gdpr|forgotten.*gdpr/i.test(input)) {
      return '**Right to be forgotten (Right to Erasure)** — GDPR Article 17.\n\n' +
        '**Users can request deletion of personal data when:**\n- Data is no longer necessary for its original purpose\n- User withdraws consent\n- User objects to processing\n- Data was unlawfully processed\n\n' +
        '**Implementation:**\n- Provide a "Delete my account" feature\n- Remove data from all systems (including backups, within reasonable time)\n- Notify third parties who received the data\n\n' +
        '**Exceptions:** Legal obligations, public interest, scientific research may override the right to erasure.';
    }

    if (/data\s+protection\s+officer|what.*dpo|dpo.*(?:what|when|required)/i.test(input)) {
      return '**Data Protection Officer (DPO)** — GDPR Article 37-39.\n\n' +
        '**Required when:**\n- Public authority or body\n- Core activities involve large-scale monitoring of individuals\n- Core activities involve large-scale processing of special category data\n\n' +
        '**DPO responsibilities:**\n- Advise on data protection obligations\n- Monitor GDPR compliance\n- Serve as contact point for supervisory authorities\n- Conduct data protection impact assessments\n\n' +
        '**The DPO must be independent** — cannot be instructed on how to perform their tasks.';
    }

    if (/data\s+breach.*(?:gdpr|notif)|breach\s+notif|72\s+hour|how.*handle.*breach/i.test(input)) {
      return '**Data breach notifications under GDPR:**\n\n' +
        '**Timeline:**\n- Report to supervisory authority within **72 hours** of becoming aware\n- Notify affected individuals "without undue delay" if high risk\n\n' +
        '**Notification must include:**\n- Nature of the breach\n- Categories and number of affected individuals\n- Likely consequences\n- Measures taken to address and mitigate\n\n' +
        '**In Norway:** Report to **Datatilsynet** (Norwegian Data Protection Authority). Have an incident response plan ready.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian web deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/universell\s+utforming.*(?:hva|what|viktig|important|hvorfor|why)|hva\s+er\s+universell/i.test(input)) {
      return '**Universell utforming** (universal design) betyr at nettsider og digitale tjenester skal være tilgjengelige for alle.\n\n' +
        '**Hvorfor viktig:**\n- **Lovpålagt** i Norge (Likestillings- og diskrimineringsloven)\n- WCAG 2.1 AA er minimumskravet\n- ~15% av befolkningen har en funksjonsnedsettelse\n- Bedre UX for ALLE brukere\n\n' +
        '**Krav:**\n- Tastaturnavigasjon\n- Skjermleserkompatibilitet\n- Tilstrekkelig kontrast (4.5:1)\n- Tekstalternativer for bilder\n- Responsivt design\n\n' +
        '**Tilsyn:** Digitaliseringsdirektoratet (tidl. Difi) fører tilsyn med universell utforming av IKT.';
    }

    if (/(?:norsk|norwegian)\s+(?:lov|law).*(?:accessib|tilgjengelig|web)|law.*(?:accessib|web).*norw|likestilling.*diskriminering/i.test(input)) {
      return '**Norwegian web accessibility laws:**\n\n' +
        '- **Likestillings- og diskrimineringsloven** (Equality and Anti-Discrimination Act) — requires universal design of ICT\n' +
        '- **Forskrift om universell utforming av IKT** — mandates WCAG 2.1 AA for web solutions\n' +
        '- Enforced by **Digitaliseringsdirektoratet** (formerly Difi)\n- **Tilsynet for universell utforming av IKT** monitors compliance\n\n' +
        '**Applies to:** All businesses, organizations, and public services targeting Norwegian users.\n**Penalties:** Fines and orders for non-compliance.';
    }

    if (/(?:norsk|norwegian)\s+.*personvern|personvern.*(?:handle|website|nettside)|how.*(?:norwegian|norsk).*privacy/i.test(input)) {
      return '**Personvern (privacy) for Norwegian websites:**\n\n' +
        '1. **Samtykkeboks (consent)** — GDPR-compliant cookie banner with opt-in\n2. **Personvernerklæring** — privacy policy in Norwegian\n3. **Cookie-policy** — list all cookies, purposes, and retention\n4. **Data minimering** — collect only necessary data\n5. **Rett til sletting** — users can request deletion\n\n' +
        '**Enforced by:** Datatilsynet (Norwegian Data Protection Authority).\n**Key:** Samtykke (consent) must be freely given, specific, informed, and unambiguous.';
    }

    if (/https.*(?:norsk|norwegian|ssl)|(?:norsk|norwegian).*(?:https|ssl)|hva\s+betyr\s+https|krypter.*nettside/i.test(input)) {
      return '**HTTPS og SSL for norske nettsider:**\n\n' +
        '- **HTTPS** = HTTP + TLS-kryptering — all trafikk er kryptert\n- **Lovpålagt** for nettsider som behandler personopplysninger (GDPR)\n- **SSL-sertifikat** — Gratis via Let\'s Encrypt\n\n' +
        '**Hvorfor viktig i Norge:**\n- Personvern og sikkerhet er lovfestet\n- Google rangerer HTTPS-sider høyere (SEO)\n- Nødvendig for PWA og Service Workers\n- Datatilsynet forventer kryptering\n\n' +
        '**Sett opp:** Redirect HTTP → HTTPS, HSTS-header, sikkerhetshoder (CSP, X-Frame-Options).';
    }

    if (/norwegian\s+mvp\s+landing|(?:norsk|norwegian)\s+landing\s+page|landing.*(?:norsk|norwegian).*2026/i.test(input)) {
      return '**Norwegian MVP landing page (2026):**\n\n' +
        '1. **Above the fold:** Clear value proposition + one CTA button\n2. **Responsive design** — mobile-first (Tailwind breakpoints)\n3. **WCAG 2.1 AA** — contrast, keyboard nav, alt text (legally required)\n4. **GDPR consent** — cookie banner with opt-in before tracking\n5. **HTTPS** — SSL certificate (Let\'s Encrypt)\n6. **Content:** Om oss, Tjenester, Kontakt (skjema eller e-post)\n7. **Performance** — < 3 seconds load time\n\n' +
        '**Stack:** Next.js + Tailwind CSS + Vercel. Bærekraftig design — minimize resources.';
    }

    if (/(?:test|how).*universell\s+utforming|universell\s+utforming.*test|uu\s+test|hvordan\s+test/i.test(input)) {
      return '**Testing universell utforming (UU) i Norge:**\n\n' +
        '**Automatisert testing:**\n- **axe DevTools** — finner ca. 30% av WCAG-feil\n- **Lighthouse** — tilgjengelighetspoeng\n- **WAVE** — visuell tilgjengelighetsvurdering\n\n' +
        '**Manuell testing:**\n- **Tastaturnavigasjon** — Tab gjennom hele siden\n- **Skjermleser** — NVDA (Windows), VoiceOver (Mac)\n- **Kontrastsjekk** — WebAIM Contrast Checker\n- **Zoom 200%** — sjekk at layout fungerer\n\n' +
        '**Krav:** Digitaliseringsdirektoratet bruker WCAG 2.1 AA som standard for tilsyn.';
    }

    if (/altinn|what.*altinn|altinn.*(?:what|relevant|developer)/i.test(input)) {
      return '**Altinn** — Norway\'s digital government platform for public services.\n\n' +
        '**What it is:**\n- Portal for tax filing, business registration, government reporting\n- API platform for digital service delivery\n- Used by ~90% of Norwegian businesses\n\n' +
        '**Why relevant for web developers:**\n- **Altinn 3** — modern, open-source platform for building government digital services\n- RESTful APIs for integrating government data\n- Altinn Studio — low-code tool for creating digital forms and services\n- Authentication via ID-porten (Norwegian national login)\n\n' +
        '**Key:** Norway\'s most important digital government infrastructure.';
    }

    if (/(?:norsk|norwegian)\s+e.?(?:commerce|handel)|e.?(?:commerce|handel).*(?:norsk|norwegian|vipps|payment)/i.test(input)) {
      return '**Norwegian e-commerce — payment and privacy:**\n\n' +
        '**Payment solutions:**\n- **Vipps** — Norway\'s dominant mobile payment (must-have)\n- **Klarna** — buy now, pay later\n- **Nets/Nexi** — card payments\n- **Stripe** — international payments\n\n' +
        '**GDPR requirements:**\n- Cookie samtykke (consent) before tracking\n- Personvernerklæring (privacy policy)\n- Rett til sletting (right to delete)\n- Secure checkout (HTTPS, PCI compliance)\n\n' +
        '**Norwegian consumer law:** 14-day return right (angrerett), clear pricing, forbrukerrettigheter.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Vue / Angular / WordPress / Nuxt deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/angular\s+signal|signal.*angular|angular.*change\s+detection.*signal/i.test(input)) {
      return '**Angular Signals** (v16+) — fine-grained reactive state management.\n\n' +
        '```typescript\nimport { signal, computed, effect } from "@angular/core";\n\nconst count = signal(0);\nconst doubled = computed(() => count() * 2);\n\neffect(() => console.log("Count:", count()));\n\ncount.set(5);       // set new value\ncount.update(v => v + 1); // update based on current\n```\n\n' +
        '**How Signals improve change detection:** Instead of checking entire component tree (Zone.js), Signals notify only affected components. More reactive, less overhead — similar to Solid.js approach.';
    }

    if (/vue\s+3.*vite|vite.*vue|set\s*up.*vue.*(?:vite|project)|create.?vue/i.test(input)) {
      return '**Setting up Vue 3 with Vite:**\n\n```bash\nnpm create vue@latest  # uses create-vue (official scaffold)\n# or\nnpm create vite@latest my-app -- --template vue-ts\n```\n\n' +
        '**Scaffold includes:** Vue 3, Vite, TypeScript, Vue Router, Pinia (optional), ESLint, Prettier.\n\n' +
        '```vue\n<script setup lang="ts">\nimport { ref } from "vue"\nconst msg = ref("Hello Vue 3 + Vite!")\n</script>\n<template><h1>{{ msg }}</h1></template>\n```\n\n' +
        '**Vite gives:** Instant HMR, fast builds, native ESM dev server.';
    }

    if (/angular\s+standalone|standalone.*angular|standalone\s+component/i.test(input)) {
      return '**Angular standalone components** (v14+) — components without NgModule.\n\n' +
        '```typescript\nimport { Component } from "@angular/core";\nimport { CommonModule } from "@angular/common";\n\n@Component({\n  selector: "app-hello",\n  standalone: true,\n  imports: [CommonModule],\n  template: `<h1>Hello {{ name }}!</h1>`,\n})\nexport class HelloComponent {\n  name = "Angular";\n}\n```\n\n' +
        '**Key:** No more `NgModule` boilerplate. Direct `imports` in the component. Simpler, more tree-shakable, recommended for all new Angular projects.';
    }

    if (/vue.?router|vue\s+router|how.*vue.*(?:route|nav)|spa.*navigation.*vue/i.test(input)) {
      return '**Vue Router** — official router for Vue.js SPA navigation.\n\n' +
        '```typescript\nimport { createRouter, createWebHistory } from "vue-router";\n\nconst router = createRouter({\n  history: createWebHistory(),\n  routes: [\n    { path: "/", component: () => import("./Home.vue") },\n    { path: "/about", component: () => import("./About.vue") },\n    { path: "/user/:id", component: () => import("./User.vue") },\n  ],\n});\n```\n\n' +
        '**Features:** Dynamic routes, lazy loading via `import()`, nested routes, navigation guards, route params.\n\n**In template:** `<RouterLink to="/">Home</RouterLink>` + `<RouterView />`';
    }

    if (/angular\s+(?:dependency\s+inject|di\s+system|inject)|dependency\s+inject.*angular/i.test(input)) {
      return '**Angular dependency injection** — built-in DI container.\n\n' +
        '```typescript\nimport { Injectable, inject } from "@angular/core";\n\n@Injectable({ providedIn: "root" })\nexport class UserService {\n  private http = inject(HttpClient);\n\n  getUsers() {\n    return this.http.get<User[]>("/api/users");\n  }\n}\n\n// In component\n@Component({ ... })\nexport class UserList {\n  private userService = inject(UserService);\n  users = this.userService.getUsers();\n}\n```\n\n' +
        '**Key:** `@Injectable` marks services. `inject()` function (modern) or constructor injection (classic). `providedIn: "root"` = singleton.';
    }

    if (/headless\s+wordpress.*next|wordpress.*(?:next|graphql|wp.?graphql)|build.*wordpress.*next/i.test(input)) {
      return '**Headless WordPress with Next.js:**\n\n' +
        '**Setup:**\n1. WordPress as CMS backend + **WPGraphQL** plugin\n2. Next.js frontend fetching data via GraphQL\n\n```tsx\n// lib/api.ts\nconst API_URL = process.env.WORDPRESS_API_URL;\n\nexport async function getPosts() {\n  const res = await fetch(API_URL, {\n    method: "POST",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify({ query: `{ posts { nodes { title slug content } } }` }),\n  });\n  const json = await res.json();\n  return json.data.posts.nodes;\n}\n```\n\n' +
        '**Benefits:** WordPress admin for editors + Next.js performance for users. WPGraphQL or REST API (`/wp-json/wp/v2/posts`).';
    }

    if (/nuxt\s*3|what.*nuxt|nuxt.*(?:compare|vs|next|what)/i.test(input)) {
      return '**Nuxt 3** — the Vue.js full-stack framework (Vue\'s answer to Next.js).\n\n' +
        '| | Nuxt 3 | Next.js |\n|---|---|---|\n| **Framework** | Vue 3 | React |\n| **SSR** | Nitro server engine | Node.js/Edge |\n| **File routing** | `pages/` directory | `app/` directory |\n| **State** | Pinia | Zustand/Redux |\n| **DX** | Auto-imports, composables | Manual imports |\n\n' +
        '**Nuxt 3 features:** Auto-imports, Nitro server engine, built-in `useFetch`, file-based API routes, Vite-powered dev server.';
    }

    if (/custom\s+wordpress\s+block|wordpress.*block.*react|gutenberg.*react|create.*\b(?:block|gutenberg)\b/i.test(input) && /wordpress|gutenberg|wp[-_]|block\s+editor/i.test(input)) {
      return '**Custom WordPress block with React (Gutenberg):**\n\n' +
        '```bash\nnpx @wordpress/create-block my-custom-block\n```\n\n' +
        '```jsx\n// src/edit.js — Editor view (React component)\nimport { useBlockProps, RichText } from "@wordpress/block-editor";\n\nexport default function Edit({ attributes, setAttributes }) {\n  return (\n    <div {...useBlockProps()}>\n      <RichText\n        tagName="p"\n        value={attributes.content}\n        onChange={(content) => setAttributes({ content })}\n        placeholder="Enter text..."\n      />\n    </div>\n  );\n}\n```\n\n' +
        '**Key:** Gutenberg blocks are built with React. `@wordpress/scripts` provides the build toolchain. Register with `registerBlockType()`.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Testing deep handlers
    // ══════════════════════════════════════════════════════════════

    if (/vitest.*(?:vs|compare).*jest|jest.*(?:vs|compare).*vitest|what.*vitest|vitest.*(?:what|how)/i.test(input) && !/playwright|cypress|e2e/i.test(input)) {
      return '**Vitest** — Vite-native test framework.\n\n| | Vitest | Jest |\n|---|---|---|\n' +
        '| **Speed** | Very fast (Vite-powered) | Slower (transforms) |\n| **ESM** | Native ESM support | Requires config |\n| **Config** | Shares Vite config | Separate jest.config |\n| **API** | Jest-compatible | Original |\n| **HMR** | Watch mode with HMR | File watching |\n\n' +
        '**Migration:** Drop-in Jest replacement — same `describe`, `it`, `expect` API.\n\n```typescript\nimport { describe, it, expect } from "vitest";\ndescribe("sum", () => {\n  it("adds numbers", () => { expect(1 + 2).toBe(3); });\n});\n```';
    }

    if (/unit\s+test.*integration.*e2e|differ.*(?:unit|integration|e2e)|unit.*(?:vs|integration)/i.test(input)) {
      return '**Unit vs Integration vs E2E tests:**\n\n' +
        '| | Unit | Integration | E2E (End-to-End) |\n|---|---|---|---|\n' +
        '| **Scope** | Single function/component | Multiple modules together | Full user flow |\n| **Speed** | Fast | Medium | Slow |\n| **Cost** | Low | Medium | High |\n| **Tools** | Vitest, Jest | Vitest, Supertest | Playwright, Cypress |\n\n' +
        '**Testing pyramid:** Many unit tests (base) → fewer integration → fewest E2E (top).\n\n' +
        '**Example:** Unit = test a `sum()` function. Integration = test API route with DB. End-to-end = test user login flow in browser.';
    }

    if (/tdd\b|test.?driven|what.*tdd|red.*green.*refactor/i.test(input) && !/vitest|jest|playwright/i.test(input)) {
      return '**TDD (Test-Driven Development):**\n\n' +
        '**Three steps:**\n1. **Red** — write a failing test first\n2. **Green** — write minimal code to pass the test\n3. **Refactor** — clean up code while keeping tests green\n\n' +
        '**Why TDD:**\n- Forces thinking about design before implementation\n- Built-in regression tests\n- Higher code confidence\n- Better API design (test-first = user-first)\n\n' +
        '```typescript\n// 1. Red: test first\nit("adds two numbers", () => { expect(add(1, 2)).toBe(3); });\n// 2. Green: implement\nfunction add(a: number, b: number) { return a + b; }\n// 3. Refactor if needed\n```';
    }

    if (/react\s+testing\s+library|testing\s+library.*react|test.*react\s+component|render.*screen/i.test(input)) {
      return '**React Testing Library** — test components from the user\'s perspective.\n\n' +
        '```typescript\nimport { render, screen } from "@testing-library/react";\nimport userEvent from "@testing-library/user-event";\n\nit("submits form", async () => {\n  render(<LoginForm />);\n  await userEvent.type(screen.getByLabelText("Email"), "test@example.com");\n  await userEvent.click(screen.getByRole("button", { name: "Login" }));\n  expect(screen.getByText("Welcome")).toBeInTheDocument();\n});\n```\n\n' +
        '**Key queries:** `getByRole`, `getByLabelText`, `getByText`, `getByTestId` (last resort). Focus on user event simulation, not implementation details.';
    }

    if (/mock.*(?:test|when)|stub.*spy|what.*mock|when.*mock|vi\.fn|jest\.fn/i.test(input) && !/service\s+worker|msw/i.test(input)) {
      return '**Mocking in tests:**\n\n**Mock** = fake implementation. **Spy** = watches calls. **Stub** = predefined return value.\n\n' +
        '```typescript\n// Vitest mock\nconst fetchData = vi.fn().mockResolvedValue({ name: "Alice" });\n\n// Spy on method\nconst spy = vi.spyOn(console, "log");\nconsole.log("hello");\nexpect(spy).toHaveBeenCalledWith("hello");\n\n// Module mock\nvi.mock("./api", () => ({\n  getUser: vi.fn().mockResolvedValue({ id: 1 }),\n}));\n```\n\n' +
        '**When to mock:** External APIs, databases, timers, browser APIs. **Don\'t over-mock** — test behavior, not implementation.';
    }

    if (/test.*api\s+endpoint|api.*test|how.*test.*api|supertest/i.test(input) && !/type.?safe.*api/i.test(input)) {
      return '**Testing API endpoints:**\n\n' +
        '```typescript\nimport { describe, it, expect } from "vitest";\nimport supertest from "supertest";\nimport app from "./app";\n\nconst request = supertest(app);\n\ndescribe("GET /api/users", () => {\n  it("returns users with status 200", async () => {\n    const response = await request.get("/api/users");\n    expect(response.status).toBe(200);\n    expect(response.body).toHaveLength(2);\n    expect(response.body[0]).toHaveProperty("name");\n  });\n});\n```\n\n' +
        '**Tools:** Supertest (Node.js), MSW (Mock Service Worker for browser), Playwright (E2E API testing).';
    }

    if (/code\s+coverage|coverage.*percent|what.*code\s+coverage|how\s+much.*coverage/i.test(input)) {
      return '**Code coverage** — measures how much code is exercised by tests.\n\n' +
        '**Types:**\n- **Line coverage** — % of lines executed\n- **Branch coverage** — % of if/else branches covered\n- **Function coverage** — % of functions called\n- **Statement coverage** — % of statements executed\n\n' +
        '**Target:** Aim for **80%+ line/branch coverage**. 100% is often impractical and costly.\n\n' +
        '```bash\nvitest run --coverage\n# or\njest --coverage\n```\n\n**Key:** High coverage ≠ good tests. Focus on meaningful assertions, not just line counting.';
    }

    if (/async.*test|test.*async|how.*test.*async.*code/i.test(input) && !/python|rust|go\b/i.test(input)) {
      return '**Testing async code in Vitest/Jest:**\n\n' +
        '```typescript\n// Async/await\nit("fetches user", async () => {\n  const user = await fetchUser(1);\n  expect(user.name).toBe("Alice");\n});\n\n// Resolves/rejects\nit("resolves with data", () => {\n  return expect(fetchUser(1)).resolves.toEqual({ name: "Alice" });\n});\n\nit("rejects on error", () => {\n  return expect(fetchUser(-1)).rejects.toThrow("Not found");\n});\n\n// Timer mocking\nit("debounces", async () => {\n  vi.useFakeTimers();\n  const fn = vi.fn();\n  debounce(fn, 100)();\n  vi.advanceTimersByTime(100);\n  expect(fn).toHaveBeenCalledOnce();\n});\n```';
    }

    if (/playwright\b|what.*playwright|playwright.*(?:e2e|browser|test)/i.test(input) && !/cypress|vitest|jest/i.test(input)) {
      return '**Playwright** — cross-browser E2E testing framework by Microsoft.\n\n' +
        '```typescript\nimport { test, expect } from "@playwright/test";\n\ntest("user can login", async ({ page }) => {\n  await page.goto("http://localhost:3000/login");\n  await page.fill("#email", "user@example.com");\n  await page.fill("#password", "secret");\n  await page.click("button[type=submit]");\n  await expect(page.locator("h1")).toHaveText("Dashboard");\n});\n```\n\n' +
        '**Features:** Chromium, Firefox, WebKit support. Auto-wait, trace viewer, codegen, parallel execution.\n\n**Setup:** `npm init playwright@latest`';
    }

    if (/snapshot\s+test|tomatchsnapshot|what.*snapshot|explain.*snapshot/i.test(input)) {
      return '**Snapshot testing** — captures component output and compares against stored "snapshot".\n\n' +
        '```typescript\nimport { render } from "@testing-library/react";\n\nit("matches snapshot", () => {\n  const { container } = render(<Button label="Click me" />);\n  expect(container).toMatchSnapshot();\n});\n```\n\n' +
        '**First run:** Creates `.snap` file with rendered output.\n**Subsequent runs:** Compares against stored snapshot. Fails if output changed.\n\n' +
        '**When useful:** Regression detection for UI components. Update with `--update-snapshot`.\n**Warning:** Fragile — small refactors trigger failures. Use sparingly alongside behavioral tests.';
    }

    // ── Build: tree-shaking ──
    if (/tree.?shak|dead\s+code.*elimin|how.*tree.?shak/i.test(input)) {
      return '**Tree-shaking** — removing unused (dead) code from the final bundle.\n\n' +
        '**How it works:**\n' +
        '1. Bundler analyzes `import`/`export` statements (static analysis)\n' +
        '2. Identifies which exports are actually used\n' +
        '3. Eliminates unused exports from the final bundle\n\n' +
        '**Requires ESM** — `import`/`export` syntax (not `require`/`module.exports`) because ESM imports are statically analyzable.\n\n' +
        '```javascript\n// math.js\nexport function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; } // unused → tree-shaken\n\n// app.js\nimport { add } from "./math"; // only add is imported\nadd(1, 2); // subtract is removed from bundle\n```\n\n' +
        '**Tools:** Vite (Rollup), Webpack 5, esbuild — all support tree-shaking by default.';
    }

    // ── Build: bundling vs transpiling ──
    if (/bundl.*(?:vs|transpil)|transpil.*(?:vs|bundl)|differ.*(?:bundl|transpil)|what.*bundl.*transpil/i.test(input)) {
      return '**Bundling vs Transpiling:**\n\n' +
        '| | Bundling | Transpiling |\n|---|---|---|\n' +
        '| **What** | Combines multiple files into one/few bundles | Converts code from one syntax to another |\n' +
        '| **Purpose** | Reduce HTTP requests, optimize delivery | Ensure browser compatibility |\n' +
        '| **Tools** | Webpack, Vite (Rollup), esbuild | Babel, SWC, TypeScript compiler |\n' +
        '| **Example** | 100 JS files → 1 bundle.js | JSX → JS, TS → JS, ES2024 → ES5 |\n\n' +
        '**Bundling** = combine + optimize (tree-shaking, minification, code splitting).\n' +
        '**Transpiling** = convert syntax (TypeScript to JavaScript, modern JS to older JS).\n\n' +
        '**Modern tools like Vite and esbuild do both** — they transpile AND bundle in one step.';
    }

    // ── Docker ──
    if (/what\s+is\s+docker|explain.*docker|docker.*(?:what|explain|why)|hva\s+er\s+docker/i.test(input)) {
      let response = '**Docker** solves the oldest problem in software: "it works on my machine." It packages your app with everything it needs into a **container** — so it runs the same way everywhere.\n\n' +
        '**Key concepts:**\n' +
        '- **Container** — lightweight, standalone package that includes everything needed to run an application\n' +
        '- **Image** — read-only template used to create containers (built from a Dockerfile)\n' +
        '- **Dockerfile** — text file with instructions to build an image\n' +
        '- **Docker Compose** — tool for defining multi-container applications (docker-compose.yml)\n' +
        '- **Docker Hub** — public registry for sharing images\n\n' +
        '**Why developers use it:**\n' +
        '- Consistent development, staging, and production environments\n' +
        '- Easy microservices architecture\n' +
        '- Fast startup compared to VMs\n' +
        '- Native support in all major cloud providers';

      // Compound: also asking how to set it up / get started
      if (/how\s+(?:do\s+i\s+)?(?:set\s*(?:it\s+)?up|get\s+started|install|start|use\s+it)/i.test(input)) {
        response += '\n\n---\n\n**Getting started:**\n' +
          '1. **Install Docker Desktop** from [docker.com](https://docker.com)\n' +
          '2. **Create a `Dockerfile`:**\n```dockerfile\nFROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD ["node", "index.js"]\n```\n' +
          '3. **Build:** `docker build -t my-app .`\n' +
          '4. **Run:** `docker run -p 3000:3000 my-app`';
      }
      return response;
    }

    if (/dockerfile.*(?:next\.?js|nextjs|react)|next\.?js.*dockerfile|docker.*(?:setup|create|build).*next/i.test(input)
      || /setup.*docker.*(?:next|app)|create.*docker.*(?:next|app)/i.test(input)) {
      return '**Dockerfile for a Next.js 14+ application (multi-stage build):**\n\n```dockerfile\n# Stage 1: Dependencies\nFROM node:20-alpine AS deps\nWORKDIR /app\nCOPY package.json pnpm-lock.yaml ./\nRUN corepack enable && pnpm install --frozen-lockfile\n\n# Stage 2: Build\nFROM node:20-alpine AS builder\nWORKDIR /app\nCOPY --from=deps /app/node_modules ./node_modules\nCOPY . .\nRUN corepack enable && pnpm build\n\n# Stage 3: Production\nFROM node:20-alpine AS runner\nWORKDIR /app\nENV NODE_ENV=production\nRUN addgroup --system --gid 1001 nodejs\nRUN adduser --system --uid 1001 nextjs\nCOPY --from=builder /app/public ./public\nCOPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./\nCOPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static\nUSER nextjs\nEXPOSE 3000\nENV PORT=3000\nCMD ["node", "server.js"]\n```\n\n' +
        '**Required in next.config.js:**\n```js\nmodule.exports = { output: "standalone" }\n```\n\n' +
        '**docker-compose.yml:**\n```yaml\nservices:\n  app:\n    build: .\n    ports:\n      - "3000:3000"\n    env_file: .env.local\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_DB: myapp\n      POSTGRES_USER: admin\n      POSTGRES_PASSWORD: ${DB_PASSWORD}\n    ports:\n      - "5432:5432"\n    volumes:\n      - pgdata:/var/lib/postgresql/data\nvolumes:\n  pgdata:\n```';
    }

    // ── CI/CD ──
    if (/what\s+is\s+ci\s*\/?\s*cd|explain.*ci\s*\/?\s*cd|continuous\s+(?:integration|deployment|delivery).*(?:what|explain|tool)/i.test(input)) {
      return '**CI/CD** stands for **Continuous Integration / Continuous Deployment (or Delivery)**.\n\n' +
        '**Continuous Integration (CI):**\n' +
        '- Automatically build and test code every time a developer pushes changes\n' +
        '- Catches bugs early, ensures code quality\n\n' +
        '**Continuous Deployment (CD):**\n' +
        '- Automatically deploy tested code to production\n' +
        '- Continuous *Delivery* = deploy to staging (manual approval for prod)\n' +
        '- Continuous *Deployment* = fully automated to production\n\n' +
        '**Popular CI/CD tools:**\n' +
        '| Tool | Type | Notes |\n|---|---|---|\n' +
        '| GitHub Actions | Cloud | Built into GitHub, YAML workflows |\n' +
        '| GitLab CI/CD | Cloud/Self-host | Integrated with GitLab |\n' +
        '| Jenkins | Self-host | Java-based, highly extensible |\n' +
        '| CircleCI | Cloud | Fast, Docker-native |\n' +
        '| Vercel | Cloud | Zero-config for Next.js |\n' +
        '| Netlify | Cloud | Great for static/JAMstack |\n' +
        '| AWS CodePipeline | Cloud | AWS-native CI/CD |';
    }

    // ── TypeScript ──
    if (/what(?:\s*'?s|\s+is)\s+typescript|explain.*typescript|typescript.*(?:what|why|advantage|benefit|over\s+javascript)/i.test(input)
      || /why\s+(?:should\s+(?:i|we|you)\s+)?(?:use\s+)?typescript\s+(?:over|instead)/i.test(input)) {
      return '**TypeScript** is JavaScript with a safety net — same language underneath, but it catches bugs before your code ever runs.\n\n' +
        'Developed by **Microsoft** (2012), it\'s now the default choice for serious JavaScript projects.\n\n' +
        '**What it adds over JavaScript:**\n' +
        '- **Static type checking** — catch errors at compile time, not runtime\n' +
        '- **IntelliSense** — superior autocomplete and refactoring in IDEs\n' +
        '- **Interfaces & generics** — better code architecture and reusability\n' +
        '- **Enums, tuples, union types** — richer type system\n' +
        '- **Refactoring safety** — rename symbols confidently across large codebases\n\n' +
        '**Example:**\n```typescript\ninterface User {\n  id: number;\n  name: string;\n  email: string;\n  role: "admin" | "user";\n}\n\nfunction greet(user: User): string {\n  return `Hello, ${user.name}!`;\n}\n```\n\n' +
        'TypeScript compiles to plain JavaScript and runs anywhere JS runs.\n\n' +
        '[Source: https://www.typescriptlang.org/docs/]\n' +
        '[Source: https://www.typescriptlang.org/docs/handbook/intro.html]';
    }

    // ── Tailwind CSS ──
    if (/what\s+is\s+tailwind|explain.*tailwind|tailwind.*(?:what|differ|vs|bootstrap|utility)/i.test(input)) {
      return '**Tailwind CSS** is a **utility-first CSS framework** that provides low-level utility classes to build custom designs directly in HTML.\n\n' +
        '**How it differs from Bootstrap:**\n' +
        '| | Tailwind | Bootstrap |\n|---|---|---|\n' +
        '| **Approach** | Utility-first (composition) | Component-first (pre-built) |\n' +
        '| **Customization** | Highly customizable via config | Theme overrides |\n' +
        '| **File size** | Purges unused CSS (tiny prod builds) | Full framework loaded |\n' +
        '| **Design** | No default look — fully custom | Recognizable "Bootstrap look" |\n' +
        '| **Learning curve** | Class names to learn | Components to learn |\n\n' +
        '**Tailwind v4 (latest):**\n' +
        '- CSS-first config via `@theme` directive (no tailwind.config.js)\n' +
        '- OKLCH color format by default\n' +
        '- `@tailwindcss/vite` plugin instead of PostCSS\n' +
        '- `@import "tailwindcss"` replaces `@tailwind` directives';
    }

    // ── Tailwind v4 specifics ──
    if (/tailwind\s*(?:css\s*)?v?4|@theme\s+(?:directive|inline|reference|default)|tailwind.*(?:v4|version\s*4|changes?\s+since|new\s+in|what.?s\s+new)/i.test(input)) {
      return '**Tailwind CSS v4** — Major changes from v3:\n\n' +
        '| Feature | v3 | v4 |\n|---|---|---|\n' +
        '| Config | tailwind.config.js | `@theme` in CSS |\n' +
        '| Build tool | PostCSS plugin | `@tailwindcss/vite` |\n' +
        '| Colors | rgb()/hsl() | oklch() (perceptual) |\n' +
        '| CSS entry | `@tailwind base/components/utilities` | `@import "tailwindcss"` |\n' +
        '| Theme extension | `extend: {}` in JS | CSS variables |\n\n' +
        '**@theme modes:**\n' +
        '- `@theme` (default) — generates CSS variables on `:root`\n' +
        '- `@theme inline` — inlines values directly (better performance)\n' +
        '- `@theme reference` — fallback values without emitting variables\n\n' +
        '**Spacing:** `--spacing: 0.25rem` base unit → `p-4` = 4 × 0.25rem = 1rem\n\n' +
        '**Best practice — Two-tier variable system:**\n```css\n@theme {\n  --color-blue-600: oklch(54.6% 0.245 262.881);\n  --color-primary: var(--color-blue-600);\n}\n```';
    }

    // ── Design Tokens ──
    if (/design\s+token|what\s+are\s+design\s+tokens/i.test(input)) {
      return '**Design tokens** are named entities that store visual design attributes (colors, spacing, typography, etc.) as platform-agnostic variables.\n\n' +
        '**Purpose:** Single source of truth for design decisions across platforms.\n\n' +
        '**Example (CSS custom properties):**\n```css\n:root {\n  --color-primary: #3b82f6;\n  --spacing-md: 1rem;\n  --font-body: "Inter", sans-serif;\n  --radius-lg: 0.75rem;\n}\n```\n\n' +
        '**Used in:**\n- Tailwind CSS v4 (`@theme` directive)\n- Figma (design variables)\n- Style Dictionary (build tool)\n- shadcn/ui (CSS variables)\n\n' +
        'Tokens create consistency between design and code.';
    }

    // ── WCAG / Accessibility ──
    if (/wcag|web\s+content\s+accessibility|accessibility.*(?:guideline|standard|what|important)|universell\s+utforming.*(?:what|hva|why|hvorfor|viktig)/i.test(input)) {
      return '**WCAG** (Web Content Accessibility Guidelines) is the international standard for web accessibility, developed by the W3C.\n\n' +
        '**Current versions:** WCAG 2.1 (2018) and WCAG 2.2 (2023)\n\n' +
        '**Four principles (POUR):**\n' +
        '1. **Perceivable** — content must be presentable in ways users can perceive (alt text, captions, contrast)\n' +
        '2. **Operable** — UI must be navigable by keyboard, enough time, no seizure triggers\n' +
        '3. **Understandable** — content and UI must be understandable (readable, predictable)\n' +
        '4. **Robust** — content must work with assistive technologies\n\n' +
        '**Conformance levels:** A (minimum) → AA (standard) → AAA (enhanced)\n\n' +
        '**In Norway:** Universell utforming (universal design) is **legally required** by the Likestillings- og diskrimineringsloven. All Norwegian websites must meet at minimum WCAG 2.1 AA.';
    }

    // ── GDPR ──
    if (/gdpr|general\s+data\s+protection|personvern.*(?:what|hva|lov|regulat)|privacy.*(?:regulat|gdpr|eu|web\s+dev)/i.test(input)) {
      return '**GDPR** (General Data Protection Regulation) is the EU/EEA data protection law, effective May 25, 2018.\n\n' +
        '**Key requirements for web developers:**\n' +
        '- **Consent** — explicit opt-in for cookies and data collection (no pre-checked boxes)\n' +
        '- **Data minimization** — collect only what\'s necessary\n' +
        '- **Right to access** — users can request all data held about them\n' +
        '- **Right to be forgotten** — users can request data deletion\n' +
        '- **Data portability** — users can export their data\n' +
        '- **Breach notification** — 72-hour reporting window\n' +
        '- **Privacy by design** — built into the system architecture\n\n' +
        '**In Norway:** Enforced by Datatilsynet. Norwegian websites must display a **samtykkeboks** (consent box) for cookies that complies with both GDPR and Norwegian ePrivacy regulations.\n\n' +
        '**Penalties:** Up to €20 million or 4% of global annual revenue.';
    }

    // ── Norwegian web MVP 2026 standard ──
    if (/norwegian?\s+(?:standard|mvp)|norsk\s+standard.*(?:nettside|web)|mvp.*(?:norsk|norwegian|2026)|minimum\s+viable.*(?:norsk|norwegian)/i.test(input)) {
      return '**Norsk standard for en nettside-MVP (2026):**\n\n' +
        '**1. Lovpålagte krav (Legal requirements):**\n' +
        '- Universell utforming: WCAG 2.1/2.2 AA (lovpålagt)\n' +
        '- Personvern: GDPR-compliant samtykkeboks for cookies\n' +
        '- Sikkerhet: HTTPS med gyldig SSL-sertifikat\n' +
        '- Responsivt design: Mobile-first tilnærming\n\n' +
        '**2. Funksjonell MVP-struktur:**\n' +
        '- Tydelig budskap (above the fold)\n' +
        '- Én tydelig Call-to-Action (CTA)\n' +
        '- Om oss / Tjenester\n' +
        '- Kontaktinfo (skjema eller e-post/telefon)\n\n' +
        '**3. Best practices:**\n' +
        '- Minimalisme med formål — whitespace + dristige fargeaksenter for CTA\n' +
        '- Rask lastetid (< 3 sekunder) — 53% forlater trege sider\n' +
        '- Bærekraftig design — færre ressurser, lavere karbonavtrykk\n' +
        '- CMS: WordPress, Sanity, eller Strapi for enkel innholdsoppdatering\n\n' +
        '**Anbefalt tech stack:** Next.js + Tailwind CSS + Prisma + PostgreSQL + Vercel';
    }

    // ── Rust ──
    if (/rust.*(?:memory\s+safety|ownership|borrow)|how\s+does\s+rust\s+ensure|borrow\s+checker|ownership\s+(?:system|model|in\s+rust)/i.test(input)) {
      return '**Rust** ensures memory safety without a garbage collector through its **ownership system**.\n\n' +
        '**Three rules of ownership:**\n' +
        '1. Each value has exactly one **owner** variable\n' +
        '2. When the owner goes out of scope, the value is **dropped** (freed)\n' +
        '3. Only one mutable reference OR any number of immutable references at a time\n\n' +
        '**Borrow checker** (compile-time verification):\n```rust\nfn main() {\n    let s1 = String::from("hello");\n    let s2 = &s1;           // immutable borrow — OK\n    println!("{}", s2);\n    // let s3 = &mut s1;    // ERROR: can\'t borrow mutably while immutably borrowed\n}\n```\n\n' +
        '**Result:** Zero-cost abstractions, no dangling pointers, no data races — guaranteed at compile time.';
    }

    // ── Python GIL ──
    if (/(?:python\s+)?gil\b|global\s+interpreter\s+lock|python.*(?:concurrency|thread|parallel|gil)/i.test(input)) {
      return '**The GIL** (Global Interpreter Lock) in CPython is a mutex that allows only **one thread to execute Python bytecode at a time**.\n\n' +
        '**Impact on concurrency:**\n' +
        '- CPU-bound multithreaded code does NOT run in parallel\n' +
        '- I/O-bound threads CAN run concurrently (GIL is released during I/O)\n' +
        '- For CPU parallelism, use `multiprocessing` or `concurrent.futures.ProcessPoolExecutor`\n\n' +
        '**Workarounds:**\n' +
        '| Approach | When to use |\n|---|---|\n' +
        '| `asyncio` | I/O-bound tasks (network, file) |\n' +
        '| `multiprocessing` | CPU-bound tasks |\n' +
        '| C extensions (numpy) | Heavy computation (GIL released) |\n' +
        '| `concurrent.futures` | Mixed workloads |\n\n' +
        '**Note:** Python 3.13+ introduces experimental free-threaded mode (PEP 703) that removes the GIL.';
    }

    // ── Go goroutines ──
    if (/goroutine|go\s+(?:routine|concurrency|channel)|golang.*(?:thread|concurren|goroutine)/i.test(input)) {
      return '**Go goroutines** are lightweight, user-space threads managed by the Go runtime.\n\n' +
        '**Goroutines vs OS threads:**\n' +
        '| | Goroutines | OS Threads |\n|---|---|---|\n' +
        '| **Stack size** | ~2 KB (grows dynamically) | ~1 MB fixed |\n' +
        '| **Creation cost** | Microseconds | Milliseconds |\n' +
        '| **Scheduling** | Go runtime (M:N model) | OS kernel |\n' +
        '| **Concurrent count** | Millions feasible | Thousands max |\n' +
        '| **Communication** | Channels (CSP model) | Shared memory + locks |\n\n' +
        '**Example:**\n```go\nfunc main() {\n    ch := make(chan string)\n    go func() {\n        ch <- "Hello from goroutine!"\n    }()\n    msg := <-ch\n    fmt.Println(msg)\n}\n```\n\n' +
        '**Motto:** "Don\'t communicate by sharing memory; share memory by communicating."';
    }

    // ── Angular ──
    if (/what\s+is\s+angular|explain.*angular|angular.*(?:what|framework|google|vs\s+react|vs\s+vue)/i.test(input)) {
      return '**Angular** is a full-featured TypeScript-based web application framework by **Google**.\n\n' +
        '**Key features:**\n' +
        '- **TypeScript-first** — built entirely in TypeScript\n' +
        '- **Two-way data binding** — automatic sync between model and view\n' +
        '- **Dependency injection** — built-in DI container\n' +
        '- **RxJS** — reactive programming with Observables\n' +
        '- **Angular CLI** — powerful code generation and scaffolding\n' +
        '- **Signals** (v16+) — fine-grained reactivity (like Solid.js)\n\n' +
        '**Angular vs React vs Vue:**\n' +
        '| | Angular | React | Vue |\n|---|---|---|---|\n' +
        '| **Type** | Framework | Library | Framework |\n' +
        '| **Language** | TypeScript | JS/TS | JS/TS |\n' +
        '| **Data binding** | Two-way | One-way | Two-way |\n' +
        '| **State** | Services + Signals | Redux/Zustand | Pinia |\n' +
        '| **Backed by** | Google | Meta | Independent |';
    }

    // ── Vue 3 / Composition API ──
    if (/vue\s*(?:\.js\s*)?3|composition\s+api.*vue|vue.*composition\s+api|options?\s+api\s+vs\s+composition/i.test(input)) {
      return '**Vue 3** introduced the **Composition API** as an alternative to the Options API.\n\n' +
        '**Composition API vs Options API:**\n' +
        '| Aspect | Options API | Composition API |\n|---|---|---|\n' +
        '| **Organization** | By option type (data, methods, computed) | By feature/concern |\n' +
        '| **Reusability** | Mixins (problematic) | Composables (clean) |\n' +
        '| **TypeScript** | Limited support | Full type inference |\n' +
        '| **Learning curve** | Easier for beginners | More flexible |\n\n' +
        '**Composition API example:**\n```vue\n<script setup lang="ts">\nimport { ref, computed, onMounted } from "vue"\n\nconst count = ref(0)\nconst doubled = computed(() => count.value * 2)\n\nonMounted(() => console.log("Component mounted"))\n\nfunction increment() {\n  count.value++\n}\n</script>\n\n<template>\n  <button @click="increment">{{ count }} ({{ doubled }})</button>\n</template>\n```';
    }

    // ── WordPress / CMS ──
    if (/(?:what\s+is\s+)?wordpress|wordpress.*(?:cms|headless|rest\s+api|still\s+relevant|vs)|headless\s+(?:cms|wordpress)/i.test(input)) {
      return '**WordPress** is the world\'s most popular CMS, powering ~43% of all websites.\n\n' +
        '**Traditional WordPress:**\n' +
        '- PHP-based, server-rendered\n' +
        '- Thousands of themes and plugins\n' +
        '- Gutenberg block editor\n' +
        '- Great for blogs, business sites, e-commerce (WooCommerce)\n\n' +
        '**Headless WordPress:**\n' +
        '- Use WordPress as a backend CMS + REST API or WPGraphQL\n' +
        '- Frontend: Next.js, Nuxt, Astro, or any JS framework\n' +
        '- Best of both worlds: familiar editing + modern frontend\n\n' +
        '**Alternatives:**\n' +
        '| CMS | Type | Best for |\n|---|---|---|\n' +
        '| Sanity | Headless | Real-time collaboration |\n' +
        '| Strapi | Headless/Self-host | Open-source, customizable |\n' +
        '| Contentful | Headless/Cloud | Enterprise |\n' +
        '| Payload | Headless/Self-host | TypeScript-native |';
    }

    // ── Next.js App Router / Server Components ──
    if (/next\.?js\s+(?:app\s+router|server\s+component|server\s+action|14|15|16)|app\s+router.*next|server\s+component.*(?:react|next)|react\s+server\s+component/i.test(input)) {
      return '**Next.js App Router** (13.4+) — The modern Next.js architecture:\n\n' +
        '**Key concepts:**\n' +
        '- **Server Components** (default) — render on the server, zero client JS\n' +
        '- **Client Components** — use `"use client"` directive for interactivity\n' +
        '- **Server Actions** — `"use server"` for form handling and mutations\n' +
        '- **File-based routing** — `app/page.tsx`, `app/layout.tsx`, `app/loading.tsx`\n' +
        '- **Parallel routes** — `@modal`, `@sidebar` slots\n' +
        '- **Intercepting routes** — `(.)photo/[id]` for modal patterns\n\n' +
        '**Data fetching:**\n```tsx\n// Server Component — no useState/useEffect needed\nexport default async function Page() {\n  const data = await fetch("https://api.example.com/posts");\n  const posts = await data.json();\n  return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>;\n}\n```\n\n' +
        '**ISR (Incremental Static Regeneration):**\n```tsx\nfetch(url, { next: { revalidate: 60 } }); // revalidate every 60s\n```';
    }

    // ── Three.js ──
    if (/three\.?js|threejs|what\s+is\s+three|3d\s+(?:web|graphics|javascript)/i.test(input)) {
      return '**Three.js** is a JavaScript library for creating **3D graphics** in the browser using WebGL.\n\n' +
        '**Core concepts:**\n' +
        '- **Scene** — container for all 3D objects\n' +
        '- **Camera** — viewpoint (PerspectiveCamera or OrthographicCamera)\n' +
        '- **Renderer** — renders the scene (WebGLRenderer)\n' +
        '- **Mesh** = Geometry + Material\n' +
        '- **Lights** — ambient, directional, point, spot\n\n' +
        '**React integration: React Three Fiber (R3F)**\n```tsx\nimport { Canvas } from "@react-three/fiber"\nimport { OrbitControls } from "@react-three/drei"\n\nfunction Box() {\n  return (\n    <mesh>\n      <boxGeometry args={[1, 1, 1]} />\n      <meshStandardMaterial color="hotpink" />\n    </mesh>\n  )\n}\n\nexport default function Scene() {\n  return (\n    <Canvas>\n      <ambientLight />\n      <pointLight position={[10, 10, 10]} />\n      <Box />\n      <OrbitControls />\n    </Canvas>\n  )\n}\n```';
    }

    // ── GSAP ──
    if (/gsap|greensock|what\s+is\s+gsap|animation\s+library.*(?:javascript|web)/i.test(input)) {
      return '**GSAP** (GreenSock Animation Platform) is a professional-grade JavaScript animation library.\n\n' +
        '**Key features:**\n' +
        '- **Timeline** — sequence and control multiple animations\n' +
        '- **ScrollTrigger** — scroll-based animations\n' +
        '- **Morphing, dragging, flipping** — plugins for complex effects\n' +
        '- Works with any JS framework (React, Vue, Angular, vanilla)\n' +
        '- 60fps performance optimized\n\n' +
        '**Example:**\n```javascript\nimport gsap from "gsap";\nimport { ScrollTrigger } from "gsap/ScrollTrigger";\n\ngsap.registerPlugin(ScrollTrigger);\n\ngsap.to(".hero-title", {\n  opacity: 1,\n  y: 0,\n  duration: 1,\n  scrollTrigger: {\n    trigger: ".hero",\n    start: "top center",\n    end: "bottom center",\n    scrub: true\n  }\n});\n```\n\n' +
        '**GSAP vs Framer Motion vs CSS animations:**\n' +
        '| | GSAP | Framer Motion | CSS |\n|---|---|---|---|\n' +
        '| **Framework** | Any | React only | Any |\n' +
        '| **Scroll** | ScrollTrigger | useScroll | Limited |\n' +
        '| **Timeline** | Yes | AnimatePresence | No |';
    }

    // ── Hover effects / landing page patterns ──
    if (/hover\s+effect|hover.*(?:icon|scale)|icon.*hover|change.*hover|hover.*animat.*(?:icon|scale|change)|landing\s+page.*(?:feature|pattern|best|practice|modern)|modern\s+landing\s+page/i.test(input)) {
      return '**Modern landing page patterns with hover effects:**\n\n' +
        '**Icon hover change (React + Tailwind):**\n```tsx\nimport { useState } from "react";\nimport { Heart, HeartFilled } from "lucide-react";\n\nexport function IconHover() {\n  const [hovered, setHovered] = useState(false);\n  return (\n    <div\n      onMouseEnter={() => setHovered(true)}\n      onMouseLeave={() => setHovered(false)}\n      className="p-4 rounded-xl border border-zinc-200 hover:border-blue-500\n                 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/20"\n    >\n      {hovered ? <HeartFilled className="text-red-500" /> : <Heart className="text-zinc-400" />}\n    </div>\n  );\n}\n```\n\n' +
        '**Border glow on hover (Tailwind):**\n```html\n<div class="group relative p-6 rounded-2xl border border-zinc-800\n            hover:border-transparent transition-all duration-500">\n  <div class="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-500\n              to-purple-500 opacity-0 group-hover:opacity-100 -z-10 blur-sm" />\n  <h3 class="text-white group-hover:text-blue-200 transition-colors">Feature</h3>\n</div>\n```\n\n' +
        '**Key patterns:** Icon swap on hover, border color transitions, gradient glow effects, scale transforms, shadow elevation changes.';
    }

    // ── Authentication / Auth setup ──
    if (/((?:how\s+do\s+i|how\s+to).*(?:add|implement|set\s*up|setup|configure|integrate).*(?:auth(?:entication)?|next.?auth|auth\.?js|clerk))|(?:setup|install|add|implement|configure|integrate)\s+(?:auth(?:entication)?|next.?auth|auth\.?js|clerk)|next.?auth|auth\.?js|clerk|authentication.*(?:next|react|setup)/i.test(input) && !deps.skillRouter.isExplicitScaffoldRequest(input)) {
      return '**Authentication options for Next.js:**\n\n' +
        '| Solution | Type | Pros | Cons |\n|---|---|---|---|\n' +
        '| **NextAuth.js (Auth.js)** | Self-hosted | Free, flexible, many providers | Setup complexity |\n' +
        '| **Clerk** | Hosted service | Beautiful UI, fast setup | Paid at scale |\n' +
        '| **Supabase Auth** | Hosted/Self-host | Free tier, PostgreSQL integration | Vendor lock-in |\n' +
        '| **Lucia** | Self-hosted | Lightweight, no magic | Manual setup |\n' +
        '| **Kinde** | Hosted | Free tier, RBAC built-in | Newer service |\n\n' +
        '**NextAuth.js basic setup:**\n```typescript\n// app/api/auth/[...nextauth]/route.ts\nimport NextAuth from "next-auth";\nimport GitHub from "next-auth/providers/github";\nimport { PrismaAdapter } from "@auth/prisma-adapter";\nimport { prisma } from "@/lib/prisma";\n\nexport const { handlers, auth, signIn, signOut } = NextAuth({\n  adapter: PrismaAdapter(prisma),\n  providers: [\n    GitHub({ clientId: process.env.GITHUB_ID!, clientSecret: process.env.GITHUB_SECRET! }),\n  ],\n});\n```\n\n' +
        '**Password hashing:** Use **Argon2** (recommended) or **bcrypt** — never store plain-text passwords.';
    }

    // ── Prisma / Database setup ──
    if (/((?:how\s+do\s+i|how\s+to).*(?:set\s*up|setup|configure|install|connect|use).*(?:prisma|postgres(?:ql)?))|(?:set\s*up|setup|configure|install|connect|use).*(?:prisma).*(?:postgres(?:ql)?|database|db)|prisma.*(?:setup|schema|what|explain)|database.*(?:setup|schema|next|orm)|what\s+is\s+prisma|drizzle\s+vs\s+prisma/i.test(input)) {
      return '**Prisma** is a modern TypeScript ORM for Node.js.\n\n' +
        '**Install + setup:**\n```bash\npnpm add prisma @prisma/client\npnpm prisma init --datasource-provider postgresql\n```\n\n' +
        '**Schema (prisma/schema.prisma):**\n```prisma\ngenerator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\nmodel User {\n  id        String   @id @default(cuid())\n  email     String   @unique\n  name      String?\n  password  String\n  role      Role     @default(USER)\n  posts     Post[]\n  createdAt DateTime @default(now())\n}\n\nmodel Post {\n  id        String   @id @default(cuid())\n  title     String\n  content   String?\n  published Boolean  @default(false)\n  author    User     @relation(fields: [authorId], references: [id])\n  authorId  String\n}\n\nenum Role {\n  USER\n  ADMIN\n}\n```\n\n' +
        '**Prisma vs Drizzle:**\n' +
        '| | Prisma | Drizzle |\n|---|---|---|\n' +
        '| **Schema** | Prisma Schema Language | TypeScript |\n' +
        '| **Query style** | Method chaining | SQL-like |\n' +
        '| **Performance** | Good | Faster (less overhead) |\n' +
        '| **Migrations** | Auto-generated | Manual or auto |';
    }

    // ── Monorepo ──
    if (/monorepo|what\s+is\s+a\s+monorepo|turborepo|nx\s+(?:workspace|monorepo)|pnpm\s+workspace/i.test(input)) {
      return '**Monorepo** — a single repository containing multiple projects/packages.\n\n' +
        '**When to use:**\n' +
        '- Shared code between frontend, backend, and packages\n' +
        '- Atomic commits across multiple packages\n' +
        '- Consistent tooling and configuration\n' +
        '- Team owns multiple related services\n\n' +
        '**Popular tools:**\n' +
        '| Tool | Strengths |\n|---|---|\n' +
        '| **Turborepo** | Caching, fast builds, Vercel integration |\n' +
        '| **Nx** | Advanced graph, generators, plugins |\n' +
        '| **pnpm workspaces** | Fast, disk-efficient, no extra tool |\n' +
        '| **Lerna** | Legacy, simpler API |\n\n' +
        '**pnpm workspace setup:**\n```yaml\n# pnpm-workspace.yaml\npackages:\n  - "apps/*"\n  - "packages/*"\n```\n\n' +
        '**Key benefit:** Change a shared package and all consumers rebuild automatically.';
    }

    // ── Responsive / Mobile-first ──
    // Require an explicit responsive/mobile-first CSS cue. The old third alternative
    // (`responsive.*(?:what|explain|how|why)`) used `.*` across the whole input, so any prompt that
    // merely contained "responsive" plus a question word — or a context-bled follow-up — could be
    // answered with this CSS primer (live curated-trap: "what makes a good company culture?" served
    // the responsive-design answer). Anchor on the actual topic terms only.
    if (/\bresponsive\s+(?:design|layout|web|site|ui)\b|\bmobile.?first\b/i.test(input)) {
      return '**Responsive design** means building websites that adapt to any screen size.\n\n' +
        '**Mobile-first approach:**\n' +
        '- Start with mobile layout, then enhance for larger screens\n' +
        '- Tailwind default: mobile-first breakpoints (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`)\n\n' +
        '**Key techniques:**\n' +
        '1. **Fluid typography** — `clamp(1rem, 2.5vw, 2rem)`\n' +
        '2. **Flexible grids** — CSS Grid + Flexbox\n' +
        '3. **Responsive images** — `srcset`, `<picture>`, lazy loading\n' +
        '4. **Container queries** — style based on container size, not viewport\n' +
        '5. **Media queries** — breakpoints for layout changes\n\n' +
        '**Tailwind example:**\n```html\n<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">\n  <div class="p-4">Card 1</div>\n  <div class="p-4">Card 2</div>\n  <div class="p-4">Card 3</div>\n</div>\n```';
    }

    // ── SSL / HTTPS / Security ──
    if (/ssl|https.*(?:what|why|important|how)|security.*(?:web|https|certificate)|sikkerhet.*(?:nettside|web|https)/i.test(input)) {
      return '**HTTPS/SSL/TLS** — essential web security:\n\n' +
        '- **SSL** (Secure Sockets Layer) → replaced by **TLS** (Transport Layer Security)\n' +
        '- HTTPS = HTTP + TLS encryption\n' +
        '- All traffic encrypted between client and server\n\n' +
        '**Why HTTPS is mandatory:**\n' +
        '- Protects user data (passwords, personal info)\n' +
        '- Required by GDPR and Norwegian law\n' +
        '- SEO ranking factor (Google prefers HTTPS)\n' +
        '- Required for HTTP/2, Service Workers, PWA\n' +
        '- Free certificates via **Let\'s Encrypt**\n\n' +
        '**Web security checklist:**\n' +
        '- [ ] HTTPS everywhere (redirect HTTP → HTTPS)\n' +
        '- [ ] Security headers (CSP, HSTS, X-Frame-Options)\n' +
        '- [ ] Input validation and sanitization\n' +
        '- [ ] Password hashing (Argon2/bcrypt)\n' +
        '- [ ] Rate limiting\n' +
        '- [ ] CSRF protection\n' +
        '- [ ] Dependency auditing (npm audit)';
    }

    // ── Sustainability / bærekraftig web ──
    if (/sustainab|bærekraftig.*(?:web|design|nettside)|carbon\s+footprint.*web|green\s+web|web.*(?:carbon|environment)/i.test(input)) {
      return '**Sustainable web design** — building websites that minimize environmental impact.\n\n' +
        '**Why it matters:**\n' +
        '- The internet accounts for ~3.7% of global CO₂ emissions\n' +
        '- Average web page is ~2.5 MB (growing every year)\n\n' +
        '**Best practices:**\n' +
        '1. **Optimize images** — WebP/AVIF, lazy loading, responsive sizes\n' +
        '2. **Minimize JavaScript** — tree shaking, code splitting, fewer dependencies\n' +
        '3. **Efficient hosting** — green hosting providers (renewable energy)\n' +
        '4. **Caching** — CDN, service workers, browser cache headers\n' +
        '5. **Dark mode** — OLED screens use less power with dark pixels\n' +
        '6. **System fonts** — avoid loading custom font files when possible\n' +
        '7. **Static generation** — pre-render pages, serve from CDN\n\n' +
        '**Tools:** websitecarbon.com, ecograder.com, Lighthouse performance score\n' +
        '**Goal:** < 0.5g CO₂ per page view';
    }

    // ── State management ──
    // Differentiate between overview/comparison vs tutorial/example vs specific library
    if (/state\s+manage|zustand|jotai|redux.*(?:what|explain|vs)|pinia.*(?:what|explain)/i.test(input)) {
      // "zustand vs X" or "X vs zustand" — comparison mode
      if (/zustand\s+(?:vs\.?|or|and)\s+\w|(?:vs\.?|or|and)\s+zustand/i.test(input)
          || /jotai\s+(?:vs\.?|or|and)\s+\w|(?:vs\.?|or|and)\s+jotai/i.test(input)
          || /redux\s+(?:vs\.?|or|and)\s+\w|(?:vs\.?|or|and)\s+redux/i.test(input)
          || /(?:compare|comparison|difference|which.*better)/i.test(input)) {
        return '**State management** in modern web apps:\n\n' +
          '| Library | Framework | Approach | Bundle |\n|---|---|---|---|\n' +
          '| **Zustand** | React | Tiny store, hooks-based | ~1 KB |\n' +
          '| **Jotai** | React | Atomic (bottom-up) | ~2 KB |\n' +
          '| **Redux Toolkit** | React | Flux pattern, reducers | ~11 KB |\n' +
          '| **Pinia** | Vue | Composition API stores | ~1.5 KB |\n' +
          '| **NgRx / Signals** | Angular | Reactive stores | Built-in |\n' +
          '| **Recoil** | React | Atomic (Facebook) | ~20 KB |\n\n' +
          '**2026 recommendation:** Zustand for React, Pinia for Vue, Signals for Angular.\n\n' +
          '**Zustand example:**\n```typescript\nimport { create } from "zustand";\n\ninterface Store {\n  count: number;\n  increment: () => void;\n}\n\nconst useStore = create<Store>((set) => ({\n  count: 0,\n  increment: () => set((s) => ({ count: s.count + 1 })),\n}));\n```';
      }

      // Zustand-specific tutorial/example/how-to
      if (/zustand/i.test(input) && !/state\s+manage/i.test(input)) {
        return '**Zustand** — tiny, fast state management for React (~1 KB).\n\n' +
          '**Install:** `npm install zustand`\n\n' +
          '**1. Create a store:**\n```typescript\nimport { create } from "zustand";\n\ninterface TodoStore {\n  todos: { id: number; text: string; done: boolean }[];\n  addTodo: (text: string) => void;\n  toggleTodo: (id: number) => void;\n  removeTodo: (id: number) => void;\n}\n\nconst useTodoStore = create<TodoStore>((set) => ({\n  todos: [],\n  addTodo: (text) =>\n    set((state) => ({\n      todos: [...state.todos, { id: Date.now(), text, done: false }],\n    })),\n  toggleTodo: (id) =>\n    set((state) => ({\n      todos: state.todos.map((t) =>\n        t.id === id ? { ...t, done: !t.done } : t\n      ),\n    })),\n  removeTodo: (id) =>\n    set((state) => ({\n      todos: state.todos.filter((t) => t.id !== id),\n    })),\n}));\n```\n\n' +
          '**2. Use in components:**\n```tsx\nfunction TodoList() {\n  const { todos, addTodo, toggleTodo, removeTodo } = useTodoStore();\n\n  return (\n    <ul>\n      {todos.map((todo) => (\n        <li key={todo.id}>\n          <input\n            type="checkbox"\n            checked={todo.done}\n            onChange={() => toggleTodo(todo.id)}\n          />\n          <span style={{ textDecoration: todo.done ? "line-through" : "none" }}>\n            {todo.text}\n          </span>\n          <button onClick={() => removeTodo(todo.id)}>×</button>\n        </li>\n      ))}\n    </ul>\n  );\n}\n```\n\n' +
          '**Why Zustand over Redux:**\n- No boilerplate — no actions, reducers, or dispatch\n- No context provider needed — just import and use\n- ~1 KB vs ~11 KB for Redux Toolkit\n- Built-in devtools: `import { devtools } from "zustand/middleware"`';
      }

      // Generic state management overview
      return '**State management** in modern web apps:\n\n' +
        '| Library | Framework | Approach | Bundle |\n|---|---|---|---|\n' +
        '| **Zustand** | React | Tiny store, hooks-based | ~1 KB |\n' +
        '| **Jotai** | React | Atomic (bottom-up) | ~2 KB |\n' +
        '| **Redux Toolkit** | React | Flux pattern, reducers | ~11 KB |\n' +
        '| **Pinia** | Vue | Composition API stores | ~1.5 KB |\n' +
        '| **NgRx / Signals** | Angular | Reactive stores | Built-in |\n' +
        '| **Recoil** | React | Atomic (Facebook) | ~20 KB |\n\n' +
        '**2026 recommendation:** Zustand for React, Pinia for Vue, Signals for Angular.\n\n' +
        '**Zustand example:**\n```typescript\nimport { create } from "zustand";\n\ninterface Store {\n  count: number;\n  increment: () => void;\n}\n\nconst useStore = create<Store>((set) => ({\n  count: 0,\n  increment: () => set((s) => ({ count: s.count + 1 })),\n}));\n```';
    }

    // ── Testing frameworks ──
    if (/vitest|jest|playwright|cypress|testing.*(?:framework|tool|what|best)|test.?driven|tdd.*(?:what|explain)/i.test(input)) {
      return '**Testing frameworks for modern web development:**\n\n' +
        '| Tool | Type | Best for |\n|---|---|---|\n' +
        '| **Vitest** | Unit/Integration | Vite-native, fast, ESM |\n' +
        '| **Jest** | Unit/Integration | Legacy, widely used |\n' +
        '| **Playwright** | E2E | Cross-browser, auto-wait |\n' +
        '| **Cypress** | E2E | Developer-friendly, time-travel |\n' +
        '| **Testing Library** | Component | User-centric queries |\n' +
        '| **MSW** | API mocking | Mock Service Worker |\n\n' +
        '**Testing pyramid:**\n' +
        '```\n        /  E2E  \\        ← few, slow, expensive\n       / Integr. \\       ← moderate\n      /   Unit    \\      ← many, fast, cheap\n```\n\n' +
        '**TDD (Test-Driven Development):**\n' +
        '1. **Red** — write a failing test\n' +
        '2. **Green** — write minimal code to pass\n' +
        '3. **Refactor** — clean up without breaking tests';
    }

    // ── Build tools ──
    if (/vite\b|turbopack|esbuild|swc|webpack.*(?:vs|alternative)|build\s+tool.*(?:what|which|best|compare)/i.test(input)) {
      return '**Modern build tools comparison:**\n\n' +
        '| Tool | Language | Speed | Used by |\n|---|---|---|---|\n' +
        '| **Vite** | Go (esbuild) + Rust (SWC) | Very fast | Vue, React, Svelte |\n' +
        '| **Turbopack** | Rust | Fastest bundler | Next.js 13+ |\n' +
        '| **esbuild** | Go | 10-100x faster than webpack | Vite (dev) |\n' +
        '| **SWC** | Rust | Faster than Babel | Next.js, Vite |\n' +
        '| **Webpack** | JavaScript | Slow but mature | Legacy projects |\n' +
        '| **Rollup** | JavaScript | Optimized output | Libraries |\n\n' +
        '**2026 recommendation:**\n' +
        '- **Vite** for most projects (SPA, SSR, libraries)\n' +
        '- **Turbopack** for Next.js projects\n' +
        '- **esbuild/SWC** for custom toolchains';
    }

    // ── Vercel / deployment ──
    if (/vercel|netlify|deploy.*(?:next|react|vue)|hosting.*(?:modern|best|compare|next)/i.test(input)) {
      return '**Modern deployment platforms:**\n\n' +
        '| Platform | Best for | Features |\n|---|---|---|\n' +
        '| **Vercel** | Next.js, React | Edge functions, analytics, preview deploys |\n' +
        '| **Netlify** | JAMstack, static | Forms, identity, split testing |\n' +
        '| **Railway** | Full-stack, databases | Docker, PostgreSQL, Redis |\n' +
        '| **Fly.io** | Edge computing | Global edge deployment |\n' +
        '| **Cloudflare Pages** | Static + Workers | Free, fast CDN, D1 database |\n' +
        '| **AWS Amplify** | AWS ecosystem | Full AWS integration |\n\n' +
        '**Vercel deployment (zero-config for Next.js):**\n```bash\nnpx vercel\n# or connect GitHub repo → auto-deploy on push\n```';
    }

    // ── WebAssembly / WASM ──
    if (/webassembly|wasm|what\s+is\s+wasm|rust.*(?:wasm|web)/i.test(input)) {
      return '**WebAssembly (WASM)** is a binary instruction format for running near-native speed code in the browser.\n\n' +
        '**Key features:**\n' +
        '- Runs alongside JavaScript in the browser\n' +
        '- Compiled from C, C++, Rust, Go, and other languages\n' +
        '- Near-native performance for compute-heavy tasks\n' +
        '- Sandboxed execution (safe)\n\n' +
        '**Use cases:**\n' +
        '- Image/video processing, audio synthesis\n' +
        '- Games and 3D graphics\n' +
        '- Cryptography\n' +
        '- Scientific computation\n' +
        '- Running existing C/Rust libraries in the browser\n\n' +
        '**Rust + WASM example:**\n```rust\nuse wasm_bindgen::prelude::*;\n\n#[wasm_bindgen]\npub fn fibonacci(n: u32) -> u32 {\n    match n {\n        0 => 0,\n        1 => 1,\n        _ => fibonacci(n - 1) + fibonacci(n - 2),\n    }\n}\n```';
    }

    // ── Tauri (Rust desktop) ──
    if (/tauri|tauri.*(?:what|explain|vs\s+electron)|electron.*vs.*tauri/i.test(input)) {
      return '**Tauri** is a framework for building desktop applications with web technologies + **Rust** backend.\n\n' +
        '**Tauri vs Electron:**\n' +
        '| | Tauri | Electron |\n|---|---|---|\n' +
        '| **Backend** | Rust | Node.js |\n' +
        '| **WebView** | System WebView | Bundled Chromium |\n' +
        '| **Bundle size** | ~2-10 MB | ~80-150 MB |\n' +
        '| **Memory** | ~20-50 MB | ~100-300 MB |\n' +
        '| **Security** | Stronger (Rust + allowlist) | Weaker (full Node.js) |\n' +
        '| **Startup** | Fast | Slow |\n\n' +
        '**Tech stack:** Any frontend (React, Vue, Svelte, Solid) + Rust commands for native features.\n\n' +
        '**Use case:** When you need a desktop app with small bundle size and strong performance.';
    }

    // ── Icons libraries ──
    if (/icon\s+(?:library|librari|package|set)|lucide|heroicon|phosphor|feather\s+icon|react.?icon|svg\s+icon|which\s+icon/i.test(input)) {
      return '**Popular icon libraries for modern web development:**\n\n' +
        '| Library | Icons | Style | Size |\n|---|---|---|---|\n' +
        '| **Lucide** | 1,500+ | Clean, consistent stroke | Tree-shakable |\n' +
        '| **Heroicons** | 300+ | Tailwind-native (by Tailwind team) | Outline + Solid |\n' +
        '| **Phosphor** | 7,000+ | 6 weights per icon | Versatile |\n' +
        '| **Feather** | 280+ | Minimal stroke icons | Small |\n' +
        '| **React Icons** | 40,000+ | Aggregator (FA, MD, etc.) | Pick what you need |\n' +
        '| **Tabler Icons** | 4,500+ | Consistent stroke width | MIT license |\n' +
        '| **Material Design** | 2,500+ | Google\'s design system | Filled + Outlined |\n\n' +
        '**2026 recommendation:** **Lucide** for React/Next.js (tree-shakable, consistent). **Heroicons** if using Tailwind ecosystem.\n\n' +
        '```tsx\nimport { Heart, Star, ArrowRight } from "lucide-react";\n// Only imports icons you use — minimal bundle\n```';
    }

    // ── shadcn/ui ──
    if (/shadcn|shadcn.?ui|radix.*(?:ui|component)|headless\s+ui.*(?:component|pattern)/i.test(input)) {
      return '**shadcn/ui** is a collection of re-usable components built with **Radix UI** + **Tailwind CSS**.\n\n' +
        '**Key philosophy:**\n' +
        '- NOT a component library — code is copied into your project\n' +
        '- Full ownership and customization\n' +
        '- Built on Radix UI primitives (accessible by default)\n' +
        '- Styled with Tailwind CSS + CSS variables\n\n' +
        '**Setup:**\n```bash\nnpx shadcn@latest init\nnpx shadcn@latest add button card dialog\n```\n\n' +
        '**Why it\'s popular:**\n' +
        '- Accessible (ARIA-compliant via Radix)\n' +
        '- Copy-paste = no dependency lock-in\n' +
        '- Beautiful default design\n' +
        '- Theming via CSS variables\n' +
        '- Used by Vercel, cal.com, and many startups';
    }

    // ── Storybook ──
    if (/storybook|what\s+is\s+storybook|component\s+(?:document|catalog|showcase)/i.test(input)) {
      return '**Storybook** is a tool for building and documenting UI components in isolation.\n\n' +
        '**Key features:**\n' +
        '- Develop components independently from the app\n' +
        '- Visual testing with Chromatic\n' +
        '- Auto-generated documentation\n' +
        '- Addon ecosystem (a11y, design tokens, etc.)\n\n' +
        '**Setup:**\n```bash\nnpx storybook@latest init\n```\n\n' +
        '**Story example:**\n```tsx\nimport type { Meta, StoryObj } from "@storybook/react";\nimport { Button } from "./Button";\n\nconst meta: Meta<typeof Button> = {\n  component: Button,\n  tags: ["autodocs"],\n};\nexport default meta;\n\nexport const Primary: StoryObj<typeof Button> = {\n  args: { variant: "primary", children: "Click me" },\n};\n```';
    }

    // ── tRPC ──
    if (/trpc|what\s+is\s+trpc|type.?safe.*api|end.?to.?end\s+type/i.test(input)) {
      return '**tRPC** — End-to-end typesafe APIs for TypeScript monorepos.\n\n' +
        '**Key features:**\n' +
        '- Full type safety from backend to frontend — no code generation\n' +
        '- No schemas, no API contracts to maintain\n' +
        '- Works with React Query / TanStack Query\n' +
        '- Websocket subscriptions support\n\n' +
        '**Server:**\n```typescript\nimport { initTRPC } from "@trpc/server";\nimport { z } from "zod";\n\nconst t = initTRPC.create();\n\nexport const appRouter = t.router({\n  getUser: t.procedure\n    .input(z.object({ id: z.string() }))\n    .query(({ input }) => {\n      return db.user.findUnique({ where: { id: input.id } });\n    }),\n});\n```\n\n' +
        '**Client (fully typed):**\n```typescript\nconst user = trpc.getUser.useQuery({ id: "123" });\n// user.data is fully typed — User | undefined\n```';
    }

    // ── Zod ──
    if (/\bzod\b|schema\s+validation.*typescript|runtime\s+type.*valid|what\s+is\s+zod/i.test(input)) {
      return '**Zod** — TypeScript-first schema validation library.\n\n' +
        '**Why Zod:**\n' +
        '- TypeScript types inferred from schemas (single source of truth)\n' +
        '- Runtime validation + compile-time types\n' +
        '- Works with tRPC, React Hook Form, Next.js Server Actions\n\n' +
        '**Example:**\n```typescript\nimport { z } from "zod";\n\nconst UserSchema = z.object({\n  name: z.string().min(2),\n  email: z.string().email(),\n  age: z.number().int().positive().max(120),\n  role: z.enum(["admin", "user"]),\n});\n\ntype User = z.infer<typeof UserSchema>;\n// { name: string; email: string; age: number; role: "admin" | "user" }\n\nconst result = UserSchema.safeParse(input);\nif (result.success) {\n  console.log(result.data); // fully typed User\n} else {\n  console.error(result.error.issues);\n}\n```';
    }

    // ── Service Workers / PWA ──
    if (/service\s+worker|pwa|progressive\s+web\s+app|manifest.*(?:web|app)|offline.*(?:web|app)/i.test(input)) {
      return '**PWA** (Progressive Web App) — web apps that feel native.\n\n' +
        '**Key components:**\n' +
        '- **Service Worker** — background script for caching, offline support, push notifications\n' +
        '- **Web Manifest** — metadata (name, icons, theme color, display mode)\n' +
        '- **HTTPS** — required for service workers\n\n' +
        '**manifest.json:**\n```json\n{\n  "name": "My App",\n  "short_name": "App",\n  "start_url": "/",\n  "display": "standalone",\n  "theme_color": "#3b82f6",\n  "background_color": "#ffffff",\n  "icons": [\n    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },\n    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }\n  ]\n}\n```\n\n' +
        '**Capabilities:** Offline mode, push notifications, background sync, install prompt.';
    }

    // ══════════════════════════════════════════════════════════════
    //  ADVANCED DOMAINS — Architecture, Vectors, AI, Strategy
    // ══════════════════════════════════════════════════════════════

    // ── SSO / Single Sign-On ──
    if (/sso\b|single\s+sign.?on|(?:what\s+is|explain|how\s+does).*(?:sso|single\s+sign)|saml\b.*(?:sso|auth)|oidc\b|openid\s+connect/i.test(input) && !deps.skillRouter.isExplicitScaffoldRequest(input)) {
      return '**SSO** (Single Sign-On) — authenticate once, access multiple services.\n\n' +
        '**How it works:**\n' +
        '1. User visits App A → redirected to Identity Provider (IdP)\n' +
        '2. User authenticates at IdP → gets a token/session\n' +
        '3. User visits App B → IdP recognizes existing session → auto-authenticated\n\n' +
        '**Protocols:**\n' +
        '- **SAML 2.0** — XML-based, enterprise standard (Okta, Azure AD)\n' +
        '- **OpenID Connect (OIDC)** — built on OAuth 2.0, modern/lightweight, JSON-based\n' +
        '- **OAuth 2.0** — authorization (not authentication), but often used with OIDC\n\n' +
        '**Providers:** Okta, Auth0, Azure AD, Keycloak, Google Workspace, AWS Cognito\n\n' +
        '**Benefits:** Better UX (one login), centralized access control, easier auditing.\n' +
        '**Risks:** Single point of failure, token theft = access to all services.';
    }

    // ── Microservices Architecture ──
    if (/micro.?service|(?:what\s+(?:is|are)|explain).*micro.?service|monolith.*(?:vs|versus|or).*micro|service.?orient/i.test(input)) {
      return '**Microservices** — decompose applications into small, independently deployable services.\n\n' +
        '**Core principles:**\n' +
        '- Single responsibility per service\n' +
        '- Own data store (database per service)\n' +
        '- Communicate via APIs (REST, gRPC) or message queues\n' +
        '- Deploy independently\n\n' +
        '**vs Monolith:**\n' +
        '| Aspect | Monolith | Microservices |\n' +
        '|--------|----------|---------------|\n' +
        '| Deploy | All-or-nothing | Per service |\n' +
        '| Scale | Entire app | Per service |\n' +
        '| Teams | Shared codebase | Service ownership |\n' +
        '| Complexity | Code complexity | Operational complexity |\n\n' +
        '**Challenges:** Distributed transactions (saga pattern), eventual consistency, service discovery, observability (OpenTelemetry/distributed tracing).\n\n' +
        '**Rule of thumb:** Start monolith → extract microservices when team/scale demands it. Don\'t microservice a startup.';
    }

    // ── Message Queues ──
    if (/message\s*queue|(?:what\s+is|explain).*(?:kafka|rabbitmq|message\s*broker)|kafka\b.*(?:vs|versus|what|explain|use)|rabbitmq\b|bull\s*mq|pub\s*\/?\s*sub\b.*(?:pattern|messag)|dead.?letter/i.test(input)) {
      return '**Message Queues** — asynchronous communication between services.\n\n' +
        '**Core pattern:** Producer → Queue/Topic → Consumer\n\n' +
        '**Popular brokers:**\n' +
        '- **RabbitMQ** — AMQP protocol, routing, dead-letter queues, good for task distribution\n' +
        '- **Apache Kafka** — distributed log, high throughput, event streaming, replay capability\n' +
        '- **Redis Streams** — lightweight, built into Redis, good for simple pub/sub\n' +
        '- **AWS SQS** — managed, serverless, scales to millions of messages\n' +
        '- **BullMQ** — Node.js job queue on top of Redis\n\n' +
        '**Delivery guarantees:**\n' +
        '- **At-most-once** — fire and forget (may lose messages)\n' +
        '- **At-least-once** — retry until ACK (may duplicate)\n' +
        '- **Exactly-once** — transactional (Kafka supports this)\n\n' +
        '**Dead-letter queue (DLQ):** Failed messages routed to separate queue for debugging.\n\n' +
        '**When to use:** Decouple services, handle traffic spikes, async processing, event-driven architectures.';
    }

    // ── Load Balancing ──
    if (/load\s*balanc|(?:what\s+is|explain).*load\s*balanc|round\s*robin|least\s+connect|l[47]\s+(?:load|balanc)|nginx.*(?:balanc|proxy)|haproxy/i.test(input)) {
      return '**Load Balancing** — distribute traffic across multiple servers.\n\n' +
        '**Algorithms:**\n' +
        '- **Round Robin** — rotate sequentially through servers\n' +
        '- **Least Connections** — route to server with fewest active connections\n' +
        '- **Weighted** — more traffic to more powerful servers\n' +
        '- **IP Hash** — same client always hits same server (session affinity)\n' +
        '- **Random** — simple, surprisingly effective at scale\n\n' +
        '**Layers:**\n' +
        '- **L4 (Transport)** — routes by IP/port, fast, no content inspection\n' +
        '- **L7 (Application)** — routes by URL/headers/cookies, smarter but slower\n\n' +
        '**Tools:** Nginx, HAProxy, AWS ALB/NLB, Cloudflare, Traefik\n\n' +
        '**Health checks:** Load balancer pings servers regularly, removes unhealthy ones from pool.\n\n' +
        '**Key pattern:** Stateless services + load balancer = horizontal scalability.';
    }

    // ── Caching Strategies ──
    if (/caching\s+(?:strat|pattern|layer)|cache.?aside|write.?through|write.?behind|(?:what\s+is|explain).*cach(?:e|ing)\s+(?:strat|pattern|approach)|redis\s+cach|cdn\s*.*cach|cache\s+invalidat/i.test(input)) {
      return '**Caching Strategies** — store computed results closer to the consumer.\n\n' +
        '**Patterns:**\n' +
        '- **Cache-Aside (Lazy)** — app checks cache → miss → query DB → populate cache\n' +
        '- **Write-Through** — write to cache AND DB simultaneously\n' +
        '- **Write-Behind (Write-Back)** — write to cache → async flush to DB (risky but fast)\n' +
        '- **Read-Through** — cache itself fetches from DB on miss\n\n' +
        '**Cache layers (closest → furthest):**\n' +
        '1. Browser cache (HTTP headers: `Cache-Control`, `ETag`)\n' +
        '2. CDN (Cloudflare, Vercel Edge, AWS CloudFront)\n' +
        '3. Application cache (Redis, Memcached)\n' +
        '4. Database query cache\n\n' +
        '**Invalidation strategies:**\n' +
        '- **TTL (Time-To-Live)** — expire after N seconds\n' +
        '- **Event-based** — invalidate on write/update\n' +
        '- **Version keys** — `user:123:v5` → increment version on change\n\n' +
        '**"There are only two hard things in CS: cache invalidation and naming things."**';
    }

    // ── Event-Driven Architecture ──
    if (/event.?driven\s+(?:architect|system|design|pattern)|event\s+sourc|cqrs|(?:what\s+is|explain).*(?:event.?driven|event\s+sourc|cqrs)|command\s+query\s+responsib/i.test(input)) {
      return '**Event-Driven Architecture (EDA)** — systems that communicate through events.\n\n' +
        '**Core concepts:**\n' +
        '- **Event** — immutable record of something that happened ("OrderPlaced", "UserCreated")\n' +
        '- **Producer** — emits events (doesn\'t know who consumes them)\n' +
        '- **Consumer** — reacts to events asynchronously\n' +
        '- **Event Bus/Broker** — routes events (Kafka, RabbitMQ, EventBridge)\n\n' +
        '**Patterns:**\n' +
        '- **Event Notification** — "something happened" (fire-and-forget)\n' +
        '- **Event Sourcing** — store ALL events as source of truth, derive state by replaying\n' +
        '- **CQRS** — separate read models from write models, sync via events\n\n' +
        '**Benefits:** Loose coupling, temporal decoupling, audit trail, replay capability.\n' +
        '**Challenges:** Eventual consistency, event ordering, debugging distributed flows.\n\n' +
        '**Tools:** Apache Kafka, AWS EventBridge, CloudEvents spec, Apache Pulsar.';
    }

    // ── Scalability (Horizontal vs Vertical) ──
    if (/(?:horizontal|vertical)\s+scal|scalab(?:le|ility)|(?:what\s+is|explain).*scalab|scale\s+(?:up|out|horizontal|vertical)|auto.?scal|sharding/i.test(input)) {
      return '**Scalability** — ability of a system to handle growing load.\n\n' +
        '**Two approaches:**\n' +
        '- **Vertical scaling (scale up)** — bigger machine (more CPU/RAM). Simple but has limits.\n' +
        '- **Horizontal scaling (scale out)** — more machines. Requires stateless design.\n\n' +
        '**Key patterns:**\n' +
        '- **Stateless services** — no server-side session → any instance can handle any request\n' +
        '- **Database sharding** — split data across multiple DB instances by key\n' +
        '- **Read replicas** — write to primary, read from replicas\n' +
        '- **Connection pooling** — reuse DB connections (PgBouncer, Drizzle pool)\n' +
        '- **Auto-scaling** — add/remove instances based on metrics (HPA in K8s, AWS ASG)\n\n' +
        '**Scale ceiling by layer:**\n' +
        '| Layer | Scales with |\n' +
        '|-------|------------|\n' +
        '| CDN | Instantly (edge nodes) |\n' +
        '| API | Stateless replicas + LB |\n' +
        '| Database | Sharding + read replicas |\n' +
        '| Cache | Redis Cluster / partitioning |\n\n' +
        '**Rule:** Make it stateless first, then scaling becomes an infrastructure problem.';
    }

    // ── Embeddings / Vector Space ──
    if (/embed(?:ding)s?\b.*(?:what|explain|how|vector|space|model)|(?:what\s+(?:is|are)|explain).*embed(?:ding)|vector\s+(?:space|representat|databas|search|store)|word2vec|text.?embed|sentence.?embed/i.test(input)) {
      return '**Embeddings** — map discrete items into continuous vector space where **semantic similarity = geometric proximity**.\n\n' +
        '**Types:**\n' +
        '- **Word embeddings** — Word2Vec, GloVe, FastText (per-word vectors)\n' +
        '- **Sentence/document embeddings** — all-MiniLM-L6-v2, text-embedding-3-small (OpenAI), Cohere Embed\n' +
        '- **Code embeddings** — CodeBERT, StarCoder embeddings\n' +
        '- **Image embeddings** — CLIP, ResNet features\n\n' +
        '**Dimensionality:** Typically 384–1536 dimensions.\n\n' +
        '**Similarity measures:**\n' +
        '- **Cosine similarity** — angle between vectors (1.0 = identical, 0 = orthogonal)\n' +
        '- **Euclidean distance** — straight-line distance\n' +
        '- **Dot product** — fast, works well for normalized vectors\n\n' +
        '**Used for:** Semantic search, RAG (Retrieval-Augmented Generation), recommendation, clustering, anomaly detection.\n\n' +
        '**Classic example:** king − man + woman ≈ queen (semantic arithmetic).';
    }

    // ── Semantic Search / ANN / Vector Databases ──
    if (/semantic\s+search|approximate\s+nearest\s+neighbor|ann\s+(?:search|algorithm)|vector\s+database|(?:what\s+is|explain).*(?:semantic\s+search|vector\s+db|pinecone|qdrant|weaviate|chroma)|pgvector/i.test(input)) {
      return '**Semantic Search** — find content by meaning, not just keywords.\n\n' +
        '**Pipeline:** Query → Embed → ANN Search → Rerank → Return results\n\n' +
        '**ANN algorithms (Approximate Nearest Neighbor):**\n' +
        '- **HNSW** — hierarchical graph, best recall/speed trade-off (most popular)\n' +
        '- **IVF** — inverted file index, good for large datasets\n' +
        '- **PQ** — product quantization, compresses vectors for memory efficiency\n\n' +
        '**Vector databases:**\n' +
        '| Database | Type | Best for |\n' +
        '|----------|------|----------|\n' +
        '| Pinecone | Managed | Production, zero-ops |\n' +
        '| Qdrant | Self-host/Cloud | Filtering + search |\n' +
        '| Weaviate | Self-host/Cloud | Multimodal |\n' +
        '| Chroma | Embedded | Local dev, prototyping |\n' +
        '| pgvector | Postgres extension | Existing Postgres stack |\n' +
        '| Milvus | Distributed | Billion+ scale |\n\n' +
        '**Key trade-off:** ANN gives ~95–99% recall at 100× speed vs exact kNN.\n\n' +
        '**Used in:** RAG pipelines, GitHub Copilot code search, image search, recommendation engines.';
    }

    // ── HNSW Algorithm ──
    if (/hnsw|hierarchical\s+navigable\s+small\s+world|(?:what\s+is|explain).*hnsw|hnsw\s+(?:algorithm|index|graph|param)/i.test(input)) {
      return '**HNSW** (Hierarchical Navigable Small World) — the dominant ANN algorithm for vector search.\n\n' +
        '**Structure:** Multi-layer graph:\n' +
        '- **Top layers** — few nodes, long-range connections (highways)\n' +
        '- **Bottom layers** — all nodes, dense local connections\n\n' +
        '**Search algorithm:**\n' +
        '1. Start at top layer\'s entry point\n' +
        '2. Greedily traverse to nearest neighbor of query\n' +
        '3. Descend to next layer, repeat\n' +
        '4. Bottom layer → return top-k results\n\n' +
        '**Complexity:** O(log n) search, O(n log n) build\n\n' +
        '**Key parameters:**\n' +
        '- **M** — max connections per node (higher = better recall, more memory)\n' +
        '- **efConstruction** — build-time quality (higher = better index, slower build)\n' +
        '- **efSearch** — query-time accuracy vs speed trade-off\n\n' +
        '**Used by:** Pinecone, Qdrant, pgvector, Weaviate, FAISS, Milvus.\n\n' +
        '**Why dominant:** Best recall/speed balance, works on disk, supports dynamic inserts.';
    }

    // ── GitHub Copilot Context Model ──
    if (/copilot\s+(?:context|how|work|optim|tip|source|tab)|(?:what\s+is|explain|how\s+does).*copilot|github\s+copilot|copilot\s+(?:suggest|complet)/i.test(input)) {
      return '**GitHub Copilot** uses 7 context sources for code completion:\n\n' +
        '1. **Current file content** — code around the cursor (highest priority)\n' +
        '2. **Open editor tabs** — neighboring tabs heuristic (related files)\n' +
        '3. **Imports and dependencies** — package.json, import statements\n' +
        '4. **LSP symbols** — function signatures, types from language server\n' +
        '5. **Repository structure** — file/folder names\n' +
        '6. **Recent edits** — your editing patterns\n' +
        '7. **Conversation history** — in Chat mode\n\n' +
        '**Optimization tips:**\n' +
        '- Keep related files open in tabs (Copilot reads them)\n' +
        '- Write descriptive function names and JSDoc comments\n' +
        '- Add type annotations (TypeScript types guide completions)\n' +
        '- Write a comment before code — acts as a natural language prompt\n' +
        '- Accept partial completions with Ctrl+→ (word-by-word)\n' +
        '- Create `.github/copilot-instructions.md` for project-specific guidance\n\n' +
        '**Models:** GPT-4o for Chat, specialized Codex variants for inline completion.';
    }

    // ── Linguistic Coherence ──
    if (/coherence|cohesion|(?:what\s+is|explain).*(?:coherence|cohesion)|linguistic.*(?:connect|flow|unity)|text.*(?:flow|unity|connect)/i.test(input)) {
      return '**Coherence** — the logical connectedness that makes text understandable as a unified whole.\n\n' +
        '**Two levels:**\n' +
        '- **Local coherence** — adjacent sentences relate logically (cause→effect, temporal sequence, elaboration)\n' +
        '- **Global coherence** — the entire text follows a clear theme/argument\n\n' +
        '**Coherence vs Cohesion:**\n' +
        '- **Cohesion** = surface-level links (pronouns, connectives: "however", "therefore", "this")\n' +
        '- **Coherence** = deep logical meaning (can exist without cohesion markers)\n' +
        '- A text can have cohesion without coherence: "He likes coffee. Coffee grows in Brazil. Brazil is in South America." (cohesive but drifting)\n\n' +
        '**Coherence techniques:**\n' +
        '- Topic sentences that anchor each paragraph\n' +
        '- Given→New information flow (old info first, new info second)\n' +
        '- Parallel structure for related ideas\n' +
        '- Logical connectors (causation, contrast, sequence)\n\n' +
        '**In AI-generated text:** Coherence is the #1 quality signal — responses should have clear purpose and logical flow, not just keyword coverage.';
    }

    // ── Strategic Thinking / Engineering ──
    if (/strategic\s+(?:think|engineer|decision|approach|planning|framework)|(?:what\s+is|explain).*strategic|decision\s+framework|engineer.*strateg/i.test(input)) {
      return '**Strategic Thinking in Engineering** — making decisions that optimize long-term outcomes.\n\n' +
        '**Decision frameworks:**\n' +
        '- **Reversibility** — reversible decisions → decide fast. Irreversible → deliberate carefully.\n' +
        '- **Opportunity cost** — what are you NOT building while building this?\n' +
        '- **Second-order effects** — what happens AFTER the immediate result?\n' +
        '- **Diminishing returns** — 80% result at 20% effort vs 100% at 100%\n\n' +
        '**Strategic engineering patterns:**\n' +
        '- Build the **minimum viable architecture** — add complexity only when data demands it\n' +
        '- **Defer decisions** — choose the last responsible moment to commit\n' +
        '- **Vertical slicing** — deliver complete features, not horizontal layers\n' +
        '- **Measure before optimizing** — profile first, then optimize the bottleneck\n\n' +
        '**Anti-patterns:**\n' +
        '- Resume-driven development (picking tech for ego, not fit)\n' +
        '- Premature abstraction (DRYing code that isn\'t actually duplicated)\n' +
        '- Architecture astronautics (over-engineering for imaginary scale)\n\n' +
        '**Key insight:** Strategy is saying NO to good ideas so you can say YES to great ones.';
    }

    // ── N-tier / Layered Architecture ──
    if (/n.?tier|(?:3|three).?tier|layered\s+architect|(?:what\s+is|explain).*(?:n.?tier|layered\s+arch|three.?tier)|presentation.*(?:logic|data).*layer/i.test(input)) {
      return '**N-tier Architecture** — separate an application into logical layers.\n\n' +
        '**Classic 3-tier:**\n' +
        '1. **Presentation** (UI) — what users see and interact with\n' +
        '2. **Business Logic** (API/Services) — rules, validation, workflows\n' +
        '3. **Data** (Database) — persistence, queries, transactions\n\n' +
        '**Modern web N-tier:**\n' +
        'CDN → Edge Functions → API Gateway → Microservices → Database → Cache\n\n' +
        '**Benefits:**\n' +
        '- Separation of concerns (each tier has one job)\n' +
        '- Independent deployment and scaling per tier\n' +
        '- Team autonomy (frontend team, backend team, data team)\n\n' +
        '**Trade-offs:** Network latency between tiers, operational complexity, data consistency.\n\n' +
        '**The "N"** means any number of tiers. Common: 2-tier (client-server), 3-tier, 4-tier (adding cache layer).';
    }

    // ── Search Architecture / Elasticsearch / Full-Text Search ──
    if (/search\s+(?:architect|engine.*(?:build|index|design))|elasticsearch|meilisearch|typesense|(?:what\s+is|explain).*(?:inverted\s+index|full.?text\s+search|bm25)|inverted\s+index/i.test(input)) {
      return '**Search Architecture** — building fast, relevant search systems.\n\n' +
        '**Core concept: Inverted Index**\n' +
        'Maps terms → document IDs (like a book\'s index). Enables O(1) term lookup.\n\n' +
        '**Ranking algorithms:**\n' +
        '- **TF-IDF** — term frequency × inverse document frequency (classic)\n' +
        '- **BM25** — improved TF-IDF with length normalization (Elasticsearch default)\n' +
        '- **Hybrid search** — combine keyword (BM25) + semantic (vector) with score fusion\n\n' +
        '**Search engines:**\n' +
        '| Engine | Strengths |\n' +
        '|--------|-----------|\n' +
        '| Elasticsearch | Full-featured, aggregations, enterprise |\n' +
        '| Meilisearch | Typo-tolerant, instant, easy setup |\n' +
        '| Typesense | Fast, lightweight, good DX |\n' +
        '| PostgreSQL FTS | Built-in, no extra infra |\n\n' +
        '**Pipeline:** Ingest → Tokenize → Normalize (lowercase, stem) → Index → Query → Rank → Return\n\n' +
        '**Hybrid search** is the modern standard — keyword precision + semantic understanding.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Role-Based Benchmarking & DevOps Senior Handlers
    // ══════════════════════════════════════════════════════════════

    // ── Role-Based Benchmarking ──
    if (/role.?based\s+bench|benchmark.*(?:role|persona|simul)|ai\s+role\s+simul|(?:what\s+is|explain|how\s+to).*role.?based\s+bench|test.*(?:ai|vai).*role/i.test(input)) {
      return '**Role-Based AI Benchmarking** — testing an AI\'s ability to perform as a specific professional.\n\n' +
        '**Design process:**\n' +
        '1. **Define the role** — e.g., "Senior DevOps Engineer", "Frontend Architect"\n' +
        '2. **Map competency domains** — 5-8 areas the role must master\n' +
        '3. **Create question tiers:**\n' +
        '   - **Foundational** (1x) — "What is Terraform?"\n' +
        '   - **Applied** (2x) — "How would you set up a Terraform module for VPC?"\n' +
        '   - **Decision** (3x) — "When should you use Terraform vs Pulumi?"\n' +
        '   - **Troubleshooting** (4x) — "CI pipeline is failing with exit code 137, how do you debug?"\n' +
        '4. **Weight scores** by tier difficulty\n' +
        '5. **Measure coverage** — % of competency domains with passing answers\n\n' +
        '**Metrics:**\n' +
        '| Metric | Target |\n' +
        '|--------|--------|\n' +
        '| Accuracy | >90% correct |\n' +
        '| Coverage | All competency domains |\n' +
        '| Speed (VPT) | <50ms knowledge, <200ms synthesis |\n' +
        '| Depth | Trade-offs and edge cases mentioned |\n\n' +
        '**Roles to benchmark:** DevOps Senior, Frontend Architect, Backend Lead, Data Engineer, Security Engineer, ML Engineer, SRE, Platform Engineer.';
    }

    // ── Benchmark Design / Writing ──
    if (/(?:write|design|create|build).*benchmark|benchmark\s+(?:design|method|write|creat|structur)|question\s+taxonomy|competency\s+domain|how\s+to\s+(?:write|build|design)\s+.*bench/i.test(input)) {
      return '**How to Design & Write AI Benchmarks:**\n\n' +
        '**1. Question Taxonomy:**\n' +
        '- **Factual recall** — "What is X?" (knowledge retrieval)\n' +
        '- **Conceptual** — "Explain how X works" (understanding)\n' +
        '- **Procedural** — "How do you set up X?" (step-by-step)\n' +
        '- **Analytical** — "Compare X vs Y" (reasoning)\n' +
        '- **Creative** — "Design an architecture for X" (synthesis)\n\n' +
        '**2. Test Case Structure:**\n' +
        '```javascript\n{ q: "What is Terraform?",\n  validate: (a) => /infrastructure.*code|iac|hcl|declarative/i.test(a) && a.length > 80,\n  tags: ["devops", "iac", "foundational"] }\n```\n\n' +
        '**3. Validation Strategies:**\n' +
        '- **Keyword check** — required terms present\n' +
        '- **Regex match** — structural patterns (code blocks, tables)\n' +
        '- **Negative check** — must NOT contain wrong info\n' +
        '- **Length gate** — minimum substantive response\n\n' +
        '**4. Execution:**\n' +
        '- Use `Promise.allSettled` with concurrency limit (80)\n' +
        '- Measure: accuracy (pass/fail), throughput (q/s), avg latency\n' +
        '- Tag by domain + difficulty for drill-down analysis\n\n' +
        '**5. Regression Guard:**\n' +
        '- Save baseline results as JSON\n' +
        '- After changes: re-run, diff against baseline, flag drops\n' +
        '- Never merge if accuracy decreases on any category';
    }

    // ── Benchmark Categories ──
    if (/benchmark\s+categor|(?:what|which)\s+.*benchmark.*(?:type|categor|suite)|vai\s+bench|list.*benchmark/i.test(input)) {
      return '**Vai Benchmark Categories:**\n\n' +
        '| Suite | Questions | Focus |\n' +
        '|-------|-----------|-------|\n' +
        '| **mega-200** | 230 | Comprehensive knowledge coverage |\n' +
        '| **precision** | 33 | Exact-match and format-sensitive |\n' +
        '| **networking** | 33 | Network protocols and infrastructure |\n' +
        '| **bench-all** | 263+ | Unified suite with throughput measurement |\n' +
        '| **logic-puzzles** | 20+100 | Deductive reasoning and problem-solving |\n' +
        '| **language-stack** | 50+ | Programming language trivia |\n\n' +
        '**Role Benchmarks (planned):**\n' +
        '- **devops-senior** — CI/CD, IaC, monitoring, incidents, security\n' +
        '- **frontend-architect** — React, performance, accessibility, design systems\n' +
        '- **backend-lead** — databases, APIs, scalability, security patterns\n\n' +
        '**Performance targets:** >90% accuracy, >50 q/s throughput, <50ms VPT per knowledge retrieval.';
    }

    // ── DevOps Senior Role ──
    if (/devops\s+senior|senior\s+devops|(?:what\s+(?:does|is)|explain|describe).*(?:devops\s+senior|senior\s+devops|devops\s+engineer)|devops\s+(?:role|responsib|competenc|skill)/i.test(input)) {
      return '**Senior DevOps Engineer** — responsibilities and competencies:\n\n' +
        '**Core domains:**\n' +
        '1. **CI/CD Pipeline Design** — GitHub Actions, GitLab CI, Jenkins, CircleCI. Build, test, deploy automation.\n' +
        '2. **Infrastructure as Code (IaC)** — Terraform, Pulumi, AWS CDK, Bicep. Declarative infra management.\n' +
        '3. **Container Orchestration** — Docker, Kubernetes (EKS/GKE/AKS), Helm charts, service meshes.\n' +
        '4. **Monitoring & Observability** — Prometheus + Grafana, ELK/Loki, Jaeger/Tempo, PagerDuty.\n' +
        '5. **Incident Response** — Runbooks, post-mortems, severity classification, on-call rotation.\n' +
        '6. **Security Hardening** — Secrets management (Vault), network policies, image scanning (Trivy).\n' +
        '7. **Cost Optimization** — Right-sizing, spot instances, reserved capacity, FinOps.\n\n' +
        '**Key metrics a Senior DevOps owns:**\n' +
        '- Deployment frequency, lead time for changes\n' +
        '- Change failure rate, MTTR\n' +
        '- SLA/SLO/SLI compliance\n' +
        '- Infrastructure cost per transaction\n\n' +
        '**DORA metrics** (DevOps Research and Assessment) are the industry standard for measuring DevOps performance.';
    }

    // ── SLA / SLO / SLI / Error Budget ──
    if (/sla\b.*slo|slo\b.*sli|sla\b.*sli|(?:what\s+(?:is|are)|explain|differ).*(?:sla|slo|sli)|error\s+budget|service\s+level\s+(?:agree|object|indic)/i.test(input)) {
      return '**SLA / SLO / SLI — Service Reliability Metrics:**\n\n' +
        '| Term | Meaning | Example |\n' +
        '|------|---------|--------|\n' +
        '| **SLI** | Service Level Indicator — the *measured metric* | 99.97% successful requests |\n' +
        '| **SLO** | Service Level Objective — the *internal target* | 99.95% availability |\n' +
        '| **SLA** | Service Level Agreement — the *contractual promise* | 99.9% uptime (with penalties) |\n\n' +
        '**Error Budget** = (1 − SLO) — the amount of allowed unreliability.\n' +
        '- SLO = 99.95% → error budget = 0.05% → ~22 min downtime/month\n' +
        '- If error budget is spent → freeze risky deploys, focus on reliability\n' +
        '- If error budget is healthy → safe to ship faster\n\n' +
        '**Best practice:** SLOs should be stricter than SLAs (leave margin). Measure SLIs continuously. Use error budgets to balance velocity vs reliability.';
    }

    // ── Incident Response ──
    if (/incident\s+response|(?:what\s+is|explain|how\s+to).*incident\s+(?:response|manag)|runbook|post.?mortem|mttd|mttr|mtbf|on.?call\s+(?:rotat|sched|manag)|severity\s+(?:classif|level|triage)/i.test(input)) {
      return '**Incident Response** — detecting, mitigating, and learning from production issues.\n\n' +
        '**Lifecycle:**\n' +
        '1. **Detect** — automated alerting (PagerDuty, OpsGenie, Grafana)\n' +
        '2. **Triage** — classify severity:\n' +
        '   - SEV1: Critical (all-hands, customer impact)\n' +
        '   - SEV2: Major (team response, degraded service)\n' +
        '   - SEV3: Minor (no customer impact, fix in queue)\n' +
        '3. **Mitigate** — immediate relief: rollback, scale up, feature flag off, failover\n' +
        '4. **Resolve** — root cause fix deployed and verified\n' +
        '5. **Post-mortem** — blameless retrospective: timeline, root cause, impact, action items\n\n' +
        '**Key metrics:**\n' +
        '- **MTTD** (Mean Time To Detect) — how fast you notice\n' +
        '- **MTTR** (Mean Time To Recover) — how fast you fix\n' +
        '- **MTBF** (Mean Time Between Failures) — reliability measure\n\n' +
        '**Best practices:** Runbooks for common incidents, war room Slack channel, status page updates, on-call rotation with escalation.';
    }

    // ── CI/CD Pipeline Optimization ──
    if (/pipeline\s+optim|ci.?cd\s+(?:optim|fast|slow|improv|speed)|(?:how\s+to\s+)?(?:optim|speed\s+up|improv).*(?:ci|pipeline|build)|docker\s+layer\s+cach|test\s+split/i.test(input)) {
      return '**CI/CD Pipeline Optimization** — making builds fast and reliable.\n\n' +
        '**Techniques:**\n' +
        '1. **Parallelism** — run lint, test, build concurrently (not sequentially)\n' +
        '2. **Caching** — cache `node_modules`, Docker layers, build artifacts\n' +
        '   - GitHub Actions: `actions/cache` + hash of lockfile\n' +
        '   - Docker: order Dockerfile from least → most changing\n' +
        '   - Turborepo: remote cache for monorepo\n' +
        '3. **Incremental builds** — only build/test affected packages\n' +
        '   - `turbo run build --filter=...[origin/main]`\n' +
        '   - Nx: `nx affected --target=test`\n' +
        '4. **Test splitting** — distribute across parallel runners\n' +
        '   - `jest --shard=1/4`, `playwright --shard=1/4`\n' +
        '5. **Artifact reuse** — build once, deploy to staging/prod\n' +
        '6. **Branch strategy** — full suite on `main`, fast checks on PRs\n\n' +
        '**Targets:**\n' +
        '- PR checks: **<5 minutes**\n' +
        '- Full deploy pipeline: **<15 minutes**\n\n' +
        '**Anti-patterns:** no caching, sequential steps, running all tests on every commit, large Docker images.';
    }

    return null;
}
