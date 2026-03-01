/**
 * VCUS Knowledge Teacher — Feed explicit knowledge entries to VAI
 *
 * This script creates structured teaching content for topics
 * where VAI failed tests, then ingests them via the capture API.
 *
 * Usage: tsx src/teach-knowledge.ts
 */

const BASE = process.env.VAI_URL || 'http://localhost:3006';

interface KnowledgeEntry {
  title: string;
  content: string;
  url: string;
}

async function teach(entry: KnowledgeEntry): Promise<{ tokens: number }> {
  // Use /api/teach to add as pattern-response entries (Strategy 2: findBestMatch)
  // Also use /api/train to add as TF-IDF documents (Strategy 3: synthesize)
  // This ensures the content is accessible via both retrieval paths.

  // 1. Add as pattern-response entry (most important — direct match)
  const patterns = extractPatterns(entry.title, entry.content);
  if (patterns.length > 0) {
    const pRes = await fetch(`${BASE}/api/teach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries: patterns.map(p => ({
          pattern: p.pattern,
          response: p.response,
          source: 'vcus-teaching',
        })),
      }),
    });
    if (!pRes.ok) console.warn(`  ⚠️ Pattern teach failed: ${pRes.status}`);
  }

  // 2. Also train as full text (TF-IDF + n-grams)
  const tRes = await fetch(`${BASE}/api/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: entry.content,
      source: entry.url,
      language: 'en',
    }),
  });
  if (!tRes.ok) throw new Error(`Train failed: ${tRes.status}`);

  return { tokens: patterns.length * 100 + Math.round(entry.content.length / 4) };
}

/**
 * Extract pattern-response pairs from teaching content.
 * Creates multiple patterns for each entry to improve matching.
 */
function extractPatterns(title: string, content: string): Array<{ pattern: string; response: string }> {
  const patterns: Array<{ pattern: string; response: string }> = [];

  // The whole content keyed by the title
  patterns.push({ pattern: title.toLowerCase(), response: content });

  // Extract H2 sections as individual patterns
  const sections = content.split(/^## /m).filter(s => s.length > 30);
  for (const section of sections) {
    const lines = section.split('\n');
    const heading = lines[0]?.trim();
    if (heading && heading.length > 5 && heading.length < 100) {
      const body = lines.slice(1).join('\n').trim();
      if (body.length > 50) {
        patterns.push({ pattern: heading.toLowerCase(), response: body });
      }
    }
  }

  return patterns;
}

// ─── Knowledge Entries ──────────────────────────────────────────

const KNOWLEDGE: KnowledgeEntry[] = [
  // ═══ Component Variants & CVA ═══
  {
    title: 'React Component Variant Pattern with CVA',
    url: 'https://cva.style/docs',
    content: `# React Component Variant Pattern

## What is a variant prop?

A **variant prop** is a prop passed to a React component that controls its visual style. Instead of passing individual style-related props (color, size, etc.), you pass a single "variant" prop that maps to a predefined set of styles.

\`\`\`tsx
// variant prop example
<Button variant="destructive" size="lg">Delete</Button>
<Button variant="outline" size="sm">Cancel</Button>
<Button variant="ghost">Menu</Button>
\`\`\`

## class-variance-authority (CVA)

**CVA** (class-variance-authority) is a library for creating type-safe component variants with Tailwind CSS. Instead of writing manual className conditionals:

\`\`\`tsx
// ❌ Without CVA - messy conditional classNames
const Button = ({ variant, size }) => (
  <button className={\`
    \${variant === 'default' ? 'bg-primary text-white' : ''}
    \${variant === 'destructive' ? 'bg-red-500 text-white' : ''}
    \${variant === 'outline' ? 'border border-input bg-transparent' : ''}
    \${size === 'sm' ? 'h-8 px-3 text-xs' : ''}
    \${size === 'lg' ? 'h-12 px-8 text-lg' : ''}
  \`}>
  </button>
);
\`\`\`

You use CVA:

\`\`\`tsx
// ✅ With CVA - clean, type-safe, reusable
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
);
\`\`\`

## How shadcn/ui uses CVA

shadcn/ui implements ALL its components using CVA for variant management:
- **Button**: variant (default, destructive, outline, secondary, ghost, link) + size (default, sm, lg, icon)
- **Badge**: variant (default, secondary, destructive, outline)
- **Alert**: variant (default, destructive)
- **Input**: size variants
- **Toggle**: variant + size

The pattern is always the same:
1. Define variants with \`cva()\`
2. Create TypeScript interface using \`VariantProps<typeof variants>\`
3. Use \`cn()\` to merge with custom className
4. Export variants object for reuse

## Why use CVA?
- **Type-safe**: TypeScript knows all valid variant values
- **No runtime conditionals**: Variants map directly to class strings
- **Composable**: Works with \`cn()\` and Tailwind Merge
- **Reusable**: Export variant definitions for use across components
- **DX**: Autocomplete shows all valid variant options`,
  },

  // ═══ cn() Utility ═══
  {
    title: 'cn() Utility Function for Tailwind CSS',
    url: 'https://ui.shadcn.com/docs/installation',
    content: `# cn() Utility Function

## What is cn()?

\`cn()\` is a utility function that combines **clsx** (conditional class joining) with **tailwind-merge** (Tailwind class deduplication). It's the standard way to handle className merging in Tailwind projects.

\`\`\`ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
\`\`\`

## Why cn() is needed

Without cn(), Tailwind classes can conflict:

\`\`\`tsx
// ❌ Problem: both p-4 and p-2 are applied, unpredictable result
<div className={\`p-4 \${someCondition ? 'p-2' : ''}\`} />

// ✅ With cn(): tailwind-merge resolves conflicts, p-2 wins
<div className={cn("p-4", someCondition && "p-2")} />
\`\`\`

## How it works

1. **clsx** handles conditionals: \`cn("base", isActive && "active", { hidden: !visible })\`
2. **tailwind-merge** resolves conflicts: \`cn("p-4 text-red-500", "p-2")\` → \`"text-red-500 p-2"\`

## Usage with component variants

\`\`\`tsx
const Button = ({ className, variant, size, ...props }) => (
  <button
    className={cn(buttonVariants({ variant, size }), className)}
    {...props}
  />
);

// Consumer can override styles while keeping variant classes
<Button variant="outline" className="w-full mt-4">Full Width</Button>
\`\`\`

cn() is used in: shadcn/ui, every T3 stack project, and most modern Tailwind component libraries.

## cn utility function tailwind merge

The \`cn()\` utility function combines **clsx** for conditional class joining with **tailwind-merge** for class deduplication. Usage: \`cn("p-4 text-red-500", isActive && "bg-blue-500", "p-2")\` → resolves to \`"text-red-500 bg-blue-500 p-2"\`. The merge step ensures that conflicting Tailwind classes like \`p-4\` and \`p-2\` are resolved correctly (last one wins). This is essential for component libraries where consumers pass custom className props.`,
  },

  // ═══ Next.js App Router ═══
  {
    title: 'Next.js App Router - File-Based Routing and Layouts',
    url: 'https://nextjs.org/docs/app',
    content: `# Next.js App Router

## Pages Directory vs App Directory

| Feature | Pages Directory (/pages) | App Directory (/app) |
|---|---|---|
| Released | Next.js 1+ | Next.js 13+ |
| Components | Client by default | Server by default |
| Routing | File = route | Folder = route segment |
| Layouts | _app.tsx only | Nested layout.tsx per route |
| Data fetching | getServerSideProps, getStaticProps | async components, fetch() |
| Loading UI | Manual | loading.tsx file convention |
| Error handling | _error.tsx | error.tsx per route |
| Streaming | No | Yes, with Suspense |

## File-Based Routing in App Directory

In the app directory, **folders define routes** and **special files define UI**:

\`\`\`
app/
├── layout.tsx          # Root layout (wraps ALL pages)
├── page.tsx            # Home page (/)
├── loading.tsx         # Loading UI for /
├── error.tsx           # Error UI for /
├── about/
│   └── page.tsx        # /about
├── blog/
│   ├── layout.tsx      # Blog layout (wraps blog pages)
│   ├── page.tsx        # /blog
│   └── [slug]/
│       └── page.tsx    # /blog/:slug (dynamic route)
├── api/
│   └── users/
│       └── route.ts    # GET/POST /api/users (API route)
└── (marketing)/        # Route group (no URL segment)
    ├── pricing/
    │   └── page.tsx    # /pricing
    └── features/
        └── page.tsx    # /features
\`\`\`

### Special files:
- **page.tsx** — makes a route segment publicly accessible
- **layout.tsx** — shared UI that wraps children, preserves state across navigations
- **loading.tsx** — Suspense boundary, shown while page loads
- **error.tsx** — Error boundary for that route segment
- **template.tsx** — like layout but re-mounts on navigation
- **not-found.tsx** — 404 UI for that segment
- **route.ts** — API endpoint (GET, POST, PUT, DELETE handlers)

## Layout Example

\`\`\`tsx
// app/layout.tsx — Root layout
import type { ReactNode } from 'react';

export const metadata = {
  title: 'My App',
  description: 'Built with Next.js',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="flex items-center gap-4 p-4 border-b">
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/blog">Blog</a>
        </nav>
        <header className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6">
          <h1 className="text-2xl font-bold">My Application</h1>
        </header>
        <main className="max-w-7xl mx-auto p-6">
          {children}
        </main>
        <footer className="border-t p-4 text-center text-sm text-gray-500">
          © 2024 My App
        </footer>
      </body>
    </html>
  );
}
\`\`\`

## API Routes in App Directory

API routes use route.ts files with named exports for HTTP methods:

\`\`\`ts
// app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const users = await db.user.findMany();
  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const user = await db.user.create({ data: body });
  return NextResponse.json(user, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  await db.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
\`\`\`

## React Server Components (RSC)

In the app directory, all components are **Server Components** by default:
- They run on the server only
- Can use async/await directly
- Can access the database, file system, env vars
- Cannot use hooks (useState, useEffect)
- Cannot use browser APIs
- Smaller client bundle (server code not sent to browser)

To make a component a Client Component, add \`"use client"\` at the top:
\`\`\`tsx
"use client";
import { useState } from 'react';
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
\`\`\`

## Next.js App Router Layout with Navigation Header

A layout.tsx wraps children with shared UI. Here is a layout that includes a navigation header:

\`\`\`tsx
// app/layout.tsx
import type { ReactNode } from 'react';
import Link from 'next/link';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="flex items-center gap-6 px-6 h-16 border-b bg-white">
          <Link href="/" className="font-bold text-xl">MyApp</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
\`\`\`

The layout receives \`children\` as a prop. All pages within that route segment are rendered as children. Layouts persist across navigations (no re-mount).

## Next.js API Route Handler POST Request

To create an API route that accepts POST requests with JSON body in the Next.js App Router:

\`\`\`ts
// app/api/items/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.json();
  // Validate body
  if (!body.name) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 });
  }
  // Create item in database
  const item = await db.item.create({ data: body });
  return NextResponse.json(item, { status: 201 });
}
\`\`\`

Key points: Export named functions matching HTTP methods (GET, POST, PUT, DELETE). Use \`request.json()\` to parse the JSON body. Return \`NextResponse.json()\` for JSON responses.`,
  },

  // ═══ T3 Stack ═══
  {
    title: 'T3 Stack - Full-Stack TypeScript',
    url: 'https://create.t3.gg',
    content: `# T3 Stack (create-t3-app)

## What is the T3 Stack?

The **T3 Stack** is a full-stack TypeScript web development stack focused on type safety and developer experience. It was created by Theo (t3.gg) and uses:

- **Next.js** — React framework with SSR/SSG
- **tRPC** — End-to-end type-safe APIs
- **Prisma** or **Drizzle** — Type-safe database ORM
- **Tailwind CSS** — Utility-first CSS framework
- **NextAuth.js** (Auth.js) — Authentication
- **TypeScript** — Everywhere, always

## Why T3 is typesafe from database to frontend

The T3 stack achieves **end-to-end type safety** because:

1. **Database → Schema**: Prisma/Drizzle generates TypeScript types from your database schema
2. **Schema → Server**: tRPC procedures use Zod for runtime validation and infer TypeScript types
3. **Server → Client**: tRPC client automatically infers return types from server procedures — no codegen needed
4. **Client → UI**: React components get fully typed data from tRPC hooks

\`\`\`
Database → Prisma types → tRPC router → tRPC client → React component
   ^           ^              ^              ^              ^
   All TypeScript types flow automatically through the stack
\`\`\`

## Project Structure

\`\`\`
src/
├── app/                # Next.js app directory
│   ├── layout.tsx      # Root layout
│   ├── page.tsx        # Home page
│   └── api/
│       └── trpc/
│           └── [trpc]/
│               └── route.ts  # tRPC HTTP handler
├── server/
│   ├── api/
│   │   ├── root.ts      # tRPC app router (combines sub-routers)
│   │   ├── trpc.ts      # tRPC initialization + context
│   │   └── routers/
│   │       ├── post.ts  # Post router with CRUD procedures
│   │       └── user.ts  # User router
│   └── db.ts           # Prisma/Drizzle client
├── trpc/
│   ├── react.tsx       # tRPC React provider + hooks
│   └── server.ts       # Server-side tRPC caller
├── env.mjs             # Validated environment variables (Zod)
└── styles/
    └── globals.css     # Tailwind imports
\`\`\`

## T3 Stack API Example: tRPC with Prisma

\`\`\`ts
// src/server/api/routers/post.ts
import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "~/server/api/trpc";

export const postRouter = createTRPCRouter({
  getAll: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.post.findMany({
      orderBy: { createdAt: "desc" },
      include: { author: true },
    });
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.post.findUnique({ where: { id: input.id } });
    }),

  create: protectedProcedure
    .input(z.object({ title: z.string().min(1), content: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.post.create({
        data: {
          ...input,
          authorId: ctx.session.user.id,
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.post.delete({ where: { id: input.id } });
    }),
});
\`\`\`

## T3 Principles
- **Typesafety is not optional** — the whole stack is typed
- **Modularity** — only add what you need
- **Developer experience** — great DX with autocomplete and zero codegen`,
  },

  // ═══ REST API Basics ═══
  {
    title: 'REST API and HTTP Methods',
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods',
    content: `# REST API and HTTP Methods

## What is REST?

**REST** (Representational State Transfer) is an architectural style for designing web APIs. A RESTful API uses standard HTTP methods to perform CRUD operations on resources identified by URLs.

## HTTP Methods

| Method | Purpose | Idempotent | Has Body | Example |
|--------|---------|-----------|----------|---------|
| **GET** | Read/retrieve data | Yes | No | GET /api/users |
| **POST** | Create new resource | No | Yes | POST /api/users |
| **PUT** | Replace entire resource | Yes | Yes | PUT /api/users/1 |
| **PATCH** | Update partial resource | No | Yes | PATCH /api/users/1 |
| **DELETE** | Remove resource | Yes | Optional | DELETE /api/users/1 |

## REST Principles
- **Resources** are identified by URLs: \`/api/users\`, \`/api/posts/123\`
- **HTTP methods** define the action (GET, POST, PUT, DELETE)
- **Status codes** indicate results: 200 OK, 201 Created, 404 Not Found, 500 Internal Server Error
- **Stateless**: each request contains all needed information
- **JSON** is the standard response format

## Example: REST API in Express/Fastify

\`\`\`ts
// GET /api/users — list all users
app.get('/api/users', async (req, res) => {
  const users = await db.user.findMany();
  return res.json(users);
});

// POST /api/users — create a user
app.post('/api/users', async (req, res) => {
  const { name, email } = req.body;
  const user = await db.user.create({ data: { name, email } });
  return res.status(201).json(user);
});

// GET /api/users/:id — get one user
app.get('/api/users/:id', async (req, res) => {
  const user = await db.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  return res.json(user);
});

// PUT /api/users/:id — replace user
app.put('/api/users/:id', async (req, res) => {
  const user = await db.user.update({
    where: { id: req.params.id },
    data: req.body,
  });
  return res.json(user);
});

// DELETE /api/users/:id — delete user
app.delete('/api/users/:id', async (req, res) => {
  await db.user.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});
\`\`\``,
  },

  // ═══ Turborepo Caching ═══
  {
    title: 'Turborepo Caching and Task Dependencies',
    url: 'https://turbo.build/repo/docs',
    content: `# Turborepo Caching and Task Dependencies

## How Turborepo Caching Works

Turborepo uses **content-addressable caching** to avoid repeating work:

1. **Hash inputs**: For each task, Turbo creates a hash of all inputs (source files, env vars, dependencies, config)
2. **Check cache**: If the hash matches a previous run, skip the task and use cached outputs
3. **Store outputs**: After running a task, store its outputs (files, logs) keyed by the hash
4. **Remote cache**: Optionally share cache across team members and CI via Vercel Remote Cache

## Cache Hit vs Miss

\`\`\`bash
# First run — builds everything
$ turbo build
 Tasks:    3 successful, 3 total
 Cached:   0 cached, 3 total     # all cache MISS
 Time:     45.2s

# Second run — if nothing changed, everything is cached
$ turbo build
 Tasks:    3 successful, 3 total
 Cached:   3 cached, 3 total     # all cache HIT!
 Time:     0.3s                   # 150x faster!
\`\`\`

## turbo.json Configuration

\`\`\`json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"],
      "env": ["NODE_ENV"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
\`\`\`

## Task Dependencies

- \`"dependsOn": ["^build"]\` — run \`build\` in all dependencies FIRST (topological)
- \`"dependsOn": ["build"]\` — run this package's \`build\` task first
- \`"outputs": ["dist/**"]\` — what files to cache
- \`"cache": false\` — disable caching for this task (e.g., dev server)
- \`"persistent": true\` — task runs indefinitely (e.g., watch mode)

## Parallel Execution

Turbo runs independent tasks in parallel automatically. If package A and B don't depend on each other, their \`build\` tasks run simultaneously.`,
  },

  // ═══ Headless Commerce ═══
  {
    title: 'Headless E-Commerce Architecture and Medusa.js',
    url: 'https://medusajs.com/blog/headless-commerce',
    content: `# Headless E-Commerce Architecture

## What is Headless Commerce?

**Headless commerce** is an architecture where the frontend (storefront) is completely decoupled from the backend (commerce engine). They communicate via APIs.

\`\`\`
Traditional (Monolithic):
[Frontend + Backend + Admin] — all in one system (Shopify)

Headless:
[Storefront (Next.js)]  ←API→  [Commerce Engine (Medusa/etc)]
[Mobile App]            ←API→  [Commerce Engine]
[Kiosk/POS]            ←API→  [Commerce Engine]
[Admin Dashboard]       ←API→  [Commerce Engine]
\`\`\`

## Key Components
- **Storefront**: Next.js, Gatsby, or any frontend framework
- **Commerce API**: Products, cart, checkout, orders, customers
- **Admin Panel**: Manage products, inventory, orders
- **Payment Gateway**: Stripe, PayPal integration
- **CMS**: Contentful, Sanity for content management

## Medusa.js

**Medusa.js** is an open-source headless commerce engine built with Node.js + TypeScript.

**vs Shopify:**
| Feature | Medusa | Shopify |
|---------|--------|---------|
| **Type** | Open-source, self-hosted | SaaS, hosted |
| **Customization** | Full code access, plugins | Limited, Liquid templates |
| **Cost** | Free (host yourself) | Monthly subscription + fees |
| **API** | REST + Events | GraphQL Storefront API |
| **Database** | PostgreSQL | Proprietary |
| **Extensibility** | Custom plugins, modules | Shopify Apps marketplace |
| **Multi-region** | Built-in support | Shopify Markets |

## Medusa Architecture
\`\`\`
packages/
├── medusa/           # Core commerce engine
│   ├── src/
│   │   ├── api/      # REST API routes
│   │   ├── models/   # Database entities (Product, Order, Cart)
│   │   ├── services/ # Business logic
│   │   ├── strategies/ # Fulfillment, payment, tax
│   │   └── loaders/  # Plugin system
├── medusa-js/        # JavaScript client SDK
├── medusa-react/     # React hooks for storefront
└── create-medusa-app/ # CLI scaffolding
\`\`\`

Features: Products, variants, collections, cart, checkout, orders, customers, discounts, gift cards, returns, swaps, claims, fulfillment, payments, taxes, regions, currencies, notifications, plugins.`,
  },

  // ═══ Chat Application Architecture ═══
  {
    title: 'Chat Application Architecture and Streaming',
    url: 'https://chat.openai.com',
    content: `# Chat Application Architecture

## Key Components of a Chat Application

1. **Message Store**: Database/state that holds conversations and messages
2. **Real-time Transport**: WebSocket, SSE (Server-Sent Events), or long-polling
3. **Message Processing**: Parsing, formatting, markdown rendering
4. **Conversation Management**: Create, list, delete, rename conversations
5. **Streaming Engine**: Token-by-token response delivery
6. **UI Components**: Message bubble, input box, sidebar, model selector

## Architecture Layers

\`\`\`
┌─────────────────────────────────────┐
│           UI Layer                  │
│  ChatWindow, MessageBubble, Input   │
│  Sidebar, ModelSelector             │
├─────────────────────────────────────┤
│           State Layer               │
│  chatStore (Zustand/Redux)          │
│  conversations[], messages[]        │
├─────────────────────────────────────┤
│           Transport Layer           │
│  WebSocket / SSE / HTTP Streaming   │
├─────────────────────────────────────┤
│           Server Layer              │
│  Chat Service, Model Router         │
│  Conversation CRUD, Message History │
├─────────────────────────────────────┤
│           AI/Model Layer            │
│  LLM API (OpenAI, local model)      │
│  Token-by-token streaming           │
└─────────────────────────────────────┘
\`\`\`

## ChatGPT-Style Streaming Response

Streaming works by sending tokens one at a time as the AI model generates them:

### Server-Sent Events (SSE)

\`\`\`ts
// Server: stream tokens via SSE
app.post('/api/chat', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');

  const stream = model.generateStream(req.body.messages);

  for await (const chunk of stream) {
    // Each chunk is a token or partial token
    res.write(\`data: \${JSON.stringify({ token: chunk.text })}\\n\\n\`);
  }

  res.write('data: [DONE]\\n\\n');
  res.end();
});

// Client: read SSE stream
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ messages }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value);
  // Parse SSE format: "data: {...}\\n\\n"
  const token = JSON.parse(text.replace('data: ', ''));
  appendToMessage(token.text); // Update UI with each token
}
\`\`\`

### WebSocket Streaming

\`\`\`ts
// Server
ws.on('message', async (data) => {
  const { conversationId, content } = JSON.parse(data);

  for await (const chunk of model.stream(content)) {
    ws.send(JSON.stringify({
      type: 'text_delta',
      textDelta: chunk,
    }));
  }

  ws.send(JSON.stringify({ type: 'done' }));
});

// Client
const ws = new WebSocket('ws://localhost:3006');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'text_delta') {
    setMessage(prev => prev + data.textDelta);
  }
};
\`\`\`

## Key Design Decisions
- **SSE vs WebSocket**: SSE is simpler (HTTP-based, auto-reconnect); WebSocket is bidirectional
- **Token-by-token**: Each token (~4 chars) is sent immediately for responsive UX
- **Markdown rendering**: Messages are rendered as markdown (code blocks, lists, bold)
- **Conversation history**: The full message history is sent to the model for context
- **Message format**: { role: "user"|"assistant"|"system", content: string }`,
  },

  // ═══ Authentication Protection ═══
  {
    title: 'Next.js Authentication with Session Protection',
    url: 'https://next-auth.js.org/configuration/nextjs',
    content: `# Protecting Pages and API Routes with Authentication in Next.js

## Using NextAuth.js (Auth.js) Sessions

### Protecting a Server Component (App Router)

\`\`\`tsx
// app/dashboard/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  return (
    <div>
      <h1>Welcome, {session.user.name}</h1>
      <p>Email: {session.user.email}</p>
    </div>
  );
}
\`\`\`

### Protecting an API Route

\`\`\`ts
// app/api/protected/route.ts
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ data: "secret data", user: session.user });
}
\`\`\`

### Using Middleware for Route Protection

\`\`\`ts
// middleware.ts (root of project)
import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login",
  },
});

// Protect specific routes
export const config = {
  matcher: ["/dashboard/:path*", "/api/protected/:path*"],
};
\`\`\`

### Client-Side Session Check

\`\`\`tsx
"use client";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";

export default function ProtectedPage() {
  const { data: session, status } = useSession();

  if (status === "loading") return <p>Loading...</p>;
  if (!session) redirect("/login");

  return <p>Signed in as {session.user.email}</p>;
}
\`\`\`

## Session Management
- \`getServerSession()\` — server-side session access (no extra request)
- \`useSession()\` — client-side React hook for session state
- Session stored as JWT (default) or in database (with adapter)
- Session includes: user.name, user.email, user.image, expires

## Protecting Page API Route Authentication Next.js

To protect pages and API routes with authentication in Next.js, use NextAuth.js session checks. Server-side: call \`getServerSession(authOptions)\` and redirect if no session. API routes: return 401 if no session. Middleware: use \`withAuth\` from NextAuth to protect entire route patterns. Client-side: use \`useSession()\` hook.`,
  },

  // ═══ Short Questions for Search ═══
  {
    title: 'Short Questions for Search Engines',
    url: 'https://support.google.com/websearch/answer/2466433',
    content: `# Short Questions for Search Engines

## What is a "short question"?

A **short question** is a concise, focused search query optimized for search engines like Google. Instead of writing a natural language sentence, you distill your intent into 3-8 keywords.

## Rules for Short Questions
1. **Remove filler words**: "I want to know how to..." → just the topic
2. **Use keywords**: Pick the most specific 3-5 words
3. **One topic per query**: Don't combine multiple questions
4. **Include technology name**: "React hooks" not just "hooks"
5. **Be specific**: "Next.js app router layout" not "how to make layouts"

## Examples

| Natural Language (verbose) | Short Question (Google-friendly) |
|---|---|
| "I want to know how to set up authentication in a Next.js application using NextAuth" | "NextAuth Next.js setup" |
| "Can you tell me about the differences between REST and GraphQL APIs?" | "REST vs GraphQL comparison" |
| "How do I deploy a Next.js application to Vercel?" | "deploy Next.js Vercel" |
| "What is the best way to handle state management in React?" | "React state management 2024" |
| "I would like to learn about monorepo tooling options" | "monorepo tools turborepo pnpm" |
| "Please explain how server-side rendering works in Next.js" | "Next.js SSR how it works" |
| "Can you help me understand TypeScript generics?" | "TypeScript generics explained" |

## Why Short Questions Matter
- **Better search results**: Search engines work best with keywords, not sentences
- **Faster answers**: Less noise = more relevant results
- **Reusable**: Can be used across Google, DuckDuckGo, YouTube, StackOverflow

## Convert to Short Google Search Query

To convert a verbose question to a short Google query, extract the key technical terms and remove filler. Examples:
- "I want to know how to set up authentication in a Next.js application using NextAuth" → **"NextAuth Next.js setup"**
- "Can you tell me about the differences between REST and GraphQL?" → **"REST vs GraphQL"**
- "How do I make server-side rendering work?" → **"SSR setup tutorial"**

Key technique: strip "I want to know", "Can you tell me", "How do I", etc. Keep technology names + core action.`,
  },

  // ═══ Tailwind Code Generation ═══
  {
    title: 'Tailwind CSS Component Examples',
    url: 'https://tailwindui.com/components',
    content: `# Tailwind CSS Component Examples

## Responsive Card Component

\`\`\`tsx
function Card({ title, description, image, href }: {
  title: string;
  description: string;
  image?: string;
  href?: string;
}) {
  return (
    <div className="group rounded-xl border bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      {image && (
        <div className="aspect-video overflow-hidden">
          <img
            src={image}
            alt={title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        </div>
      )}
      <div className="p-4 md:p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 line-clamp-2 mb-4">{description}</p>
        {href && (
          <a href={href} className="text-sm font-medium text-blue-600 hover:text-blue-800">
            Read more →
          </a>
        )}
      </div>
    </div>
  );
}

// Responsive Grid Layout
function CardGrid({ cards }: { cards: CardProps[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6 p-4">
      {cards.map(card => <Card key={card.title} {...card} />)}
    </div>
  );
}
\`\`\`

## Button Component with Variants

\`\`\`tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-blue-600 text-white hover:bg-blue-700',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        outline: 'border border-gray-300 bg-transparent hover:bg-gray-100',
        ghost: 'hover:bg-gray-100',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-10 px-4',
        lg: 'h-12 px-8 text-base',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
\`\`\``,
  },
];

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  // Check server
  try {
    await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error('❌ VAI server not running at', BASE);
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  📚 Teaching VAI — ${KNOWLEDGE.length} knowledge entries`);
  console.log(`${'═'.repeat(60)}\n`);

  let totalTokens = 0;

  for (const entry of KNOWLEDGE) {
    try {
      const { tokens } = await teach(entry);
      totalTokens += tokens;
      console.log(`  ✅ ${entry.title} — ${tokens} tokens`);
    } catch (err) {
      console.log(`  ❌ ${entry.title} — ${(err as Error).message}`);
    }
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  📊 Total: ${KNOWLEDGE.length} entries, ${totalTokens} tokens taught`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(console.error);
