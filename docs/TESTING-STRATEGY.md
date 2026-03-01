# Testing Strategy for Full-Stack JavaScript Apps

## Vai's Comprehensive Testing Guide — Vitest + Playwright

> This document teaches Vai how to advise developers on testing strategies
> for modern full-stack JS/TS apps (MERN, PERN, T3, Next.js, and similar stacks).

---

## 1. The Testing Pyramid

```
        ┌─────────┐
        │  E2E    │  ← Playwright (5-15 tests)
        │ (slow)  │     Critical user flows only
       ─┴─────────┴─
      ┌──────────────┐
      │ Integration  │  ← Vitest (20-50 tests)
      │  (medium)    │     API routes, DB queries, component + hook combos
     ─┴──────────────┴─
    ┌──────────────────┐
    │   Unit Tests     │  ← Vitest (100-500 tests)
    │   (fast)         │     Pure functions, hooks, components, validators
    └──────────────────┘
```

**Target ratio:** ~70% unit, ~20% integration, ~10% E2E.

---

## 2. What to Test Where

### Vitest (Unit + Integration)

| Layer | What to test | Example |
|-------|-------------|---------|
| **Pure functions** | Validators, formatters, parsers, transformers | `extractFilesFromMarkdown()`, `parseGitHubUrl()` |
| **React components** | Rendered output, user interactions, conditional rendering | Button clicks, form submissions, loading states |
| **Custom hooks** | State transitions, side effects, return values | `useAutoSandbox`, `useChatStore` |
| **API route handlers** | Status codes, response bodies, error handling | `POST /api/conversations` → 200 + ID |
| **DB access layer** | CRUD operations, constraints, migrations | In-memory SQLite for isolation |
| **Business logic** | Permissions, validation rules, state machines | Mode switching, sandbox lifecycle |

### Playwright (E2E)

| Flow | What to test | Notes |
|------|-------------|-------|
| **Auth** | Register → Verify → Login → Logout | Happy path + invalid creds |
| **Core CRUD** | Create → Read → Update → Delete entities | The main thing your app does |
| **Permissions** | User can't access admin routes | Role-based access |
| **Error states** | Invalid input → error shown, 500 → error page | A few unhappy paths |
| **Critical journeys** | Onboarding flow, payment, checkout | Whatever makes money |

---

## 3. Project Structure — Colocate Tests Near Code

```
src/
  components/
    Button/
      Button.tsx
      Button.test.tsx          ← Unit test right next to component
    ChatWindow/
      ChatWindow.tsx
      ChatWindow.test.tsx
  hooks/
    useAuth.ts
    useAuth.test.ts
  lib/
    validators.ts
    validators.test.ts
  server/
    routes/
      user.ts
      user.test.ts             ← Route handler test colocated
    services/
      email.ts
      email.test.ts
  __tests__/                   ← Integration tests that span multiple modules
    chat-service.test.ts
    ingest-pipeline.test.ts
e2e/                           ← Playwright E2E tests (separate top-level)
  auth.spec.ts
  crud.spec.ts
  permissions.spec.ts
```

**Why colocate?**
- Easy to find the test for any file
- Move/delete a feature → tests go with it
- No giant `tests/` folder with hundreds of disconnected files

---

## 4. Vitest Configuration for Monorepos

### Root `vitest.workspace.ts`
```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*/vitest.config.ts',
  'apps/*/vitest.config.ts',
]);
```

### Package-level `vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,                    // describe, it, expect without imports
    environment: 'node',              // or 'jsdom' for React components
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
    },
    setupFiles: ['./test-setup.ts'],  // Optional: global mocks
  },
});
```

### For React component tests, use `jsdom`:
```ts
// apps/web/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test-setup.ts'],
  },
});
```

```ts
// test-setup.ts
import '@testing-library/jest-dom/vitest';
```

---

## 5. Example Tests

### 5.1 Pure Function Test (Arrange-Act-Assert)

```ts
// src/lib/validators.test.ts
import { describe, it, expect } from 'vitest';
import { isValidEmail, sanitizeSlug } from './validators';

describe('isValidEmail', () => {
  it('accepts standard email addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  it('rejects emails without @ symbol', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(isValidEmail('')).toBe(false);
  });
});

describe('sanitizeSlug', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(sanitizeSlug('My Cool Post')).toBe('my-cool-post');
  });

  it('removes special characters', () => {
    expect(sanitizeSlug('Hello @World!')).toBe('hello-world');
  });
});
```

### 5.2 React Component Test (Vitest + Testing Library)

```tsx
// src/components/TodoItem/TodoItem.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TodoItem } from './TodoItem';

describe('TodoItem', () => {
  it('renders the todo text', () => {
    render(<TodoItem text="Buy groceries" completed={false} onToggle={() => {}} />);
    expect(screen.getByText('Buy groceries')).toBeInTheDocument();
  });

  it('shows strikethrough when completed', () => {
    render(<TodoItem text="Done task" completed={true} onToggle={() => {}} />);
    expect(screen.getByText('Done task')).toHaveClass('line-through');
  });

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn();
    render(<TodoItem text="Click me" completed={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
```

**Key patterns:**
- Query by **role** or **text**, not CSS classes or test IDs
- Use `vi.fn()` for callback spies
- Each test is Arrange → Act → Assert

### 5.3 Custom Hook Test

```ts
// src/hooks/useCounter.test.ts
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCounter } from './useCounter';

describe('useCounter', () => {
  it('starts at 0 by default', () => {
    const { result } = renderHook(() => useCounter());
    expect(result.current.count).toBe(0);
  });

  it('increments the count', () => {
    const { result } = renderHook(() => useCounter());
    act(() => result.current.increment());
    expect(result.current.count).toBe(1);
  });

  it('accepts an initial value', () => {
    const { result } = renderHook(() => useCounter(10));
    expect(result.current.count).toBe(10);
  });
});
```

### 5.4 Backend Route Handler Test (Fastify + In-Memory DB)

```ts
// src/server/routes/user.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDb } from '../db/client';
import { UserService } from '../services/user';
import { registerUserRoutes } from './user';

describe('User Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const db = createDb(':memory:');
    const userService = new UserService(db);
    app = Fastify({ logger: false });
    registerUserRoutes(app, userService);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /api/users — creates a user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'Alice', email: 'alice@example.com' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBeTruthy();
  });

  it('GET /api/users/:id — returns 404 for unknown user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/nonexistent',
    });
    expect(res.statusCode).toBe(404);
  });
});
```

**Key pattern:** `app.inject()` simulates HTTP requests without starting a real server. Zero network, fast, deterministic.

### 5.5 Mocking External Services

```ts
// src/services/notification.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from './notification';

// Mock the email client module
vi.mock('./email-client', () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'mock-123' }),
}));

import { sendEmail } from './email-client';

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a welcome email on signup', async () => {
    const service = new NotificationService();
    await service.onUserSignup({ email: 'new@user.com', name: 'Test' });

    expect(sendEmail).toHaveBeenCalledWith({
      to: 'new@user.com',
      subject: expect.stringContaining('Welcome'),
      body: expect.any(String),
    });
  });
});
```

### 5.6 MSW (Mock Service Worker) for API Mocking

```ts
// src/lib/api.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { fetchUserProfile } from './api';

const server = setupServer(
  http.get('/api/profile', () => {
    return HttpResponse.json({ name: 'Alice', role: 'admin' });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchUserProfile', () => {
  it('returns user data from API', async () => {
    const profile = await fetchUserProfile();
    expect(profile.name).toBe('Alice');
    expect(profile.role).toBe('admin');
  });

  it('handles server errors gracefully', async () => {
    server.use(
      http.get('/api/profile', () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    await expect(fetchUserProfile()).rejects.toThrow('Failed to fetch profile');
  });
});
```

---

## 6. Playwright E2E Setup

### `playwright.config.ts`
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',  // Your dev server
    trace: 'on-first-retry',          // Traces only when debugging flakes
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Add more browsers as needed:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'mobile', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
```

### 6.1 E2E Auth Flow
```ts
// e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('user can sign up, log in, and see dashboard', async ({ page }) => {
    // 1. Navigate to signup
    await page.goto('/signup');

    // 2. Fill the form using accessible selectors
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password').fill('SecureP@ss123');
    await page.getByRole('button', { name: 'Sign Up' }).click();

    // 3. Verify redirect to dashboard
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('wrong@email.com');
    await page.getByLabel('Password').fill('badpassword');
    await page.getByRole('button', { name: 'Log In' }).click();

    await expect(page.getByText('Invalid credentials')).toBeVisible();
  });
});
```

### 6.2 E2E CRUD Flow
```ts
// e2e/todos.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Todo CRUD', () => {
  test.beforeEach(async ({ page }) => {
    // Start from clean state (seed or reset)
    await page.goto('/todos');
  });

  test('creates a new todo', async ({ page }) => {
    await page.getByPlaceholder('Add a todo...').fill('Buy milk');
    await page.getByRole('button', { name: 'Add' }).click();

    await expect(page.getByText('Buy milk')).toBeVisible();
  });

  test('marks a todo as complete', async ({ page }) => {
    // Assume a todo exists from DB seed
    const todo = page.getByText('Existing Todo');
    await todo.click();

    await expect(todo).toHaveCSS('text-decoration-line', 'line-through');
  });

  test('deletes a todo', async ({ page }) => {
    const todoRow = page.getByRole('listitem').filter({ hasText: 'Delete me' });
    await todoRow.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Delete me')).not.toBeVisible();
  });
});
```

---

## 7. Stack-Specific Guidance

### MERN (MongoDB + Express + React + Node)

| Layer | Tool | Mock Strategy |
|-------|------|---------------|
| React components | Vitest + Testing Library + jsdom | MSW for API calls |
| Express routes | Vitest + supertest | Mock MongoDB with `mongodb-memory-server` |
| Mongoose models | Vitest | In-memory MongoDB |
| E2E | Playwright | Real app + test DB container |

```ts
// MERN: Express route test with mongodb-memory-server
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
```

### PERN (PostgreSQL + Express + React + Node)

| Layer | Tool | Mock Strategy |
|-------|------|---------------|
| React components | Vitest + Testing Library | MSW for API calls |
| Express routes | Vitest + supertest | Mock DB repository layer (not raw SQL) |
| Prisma/Drizzle queries | Vitest | SQLite in-memory (Drizzle) or Prisma test utils |
| E2E | Playwright | Real app + test Postgres container |

```ts
// PERN: Drizzle test with in-memory SQLite
import { createDb } from '../db/client';

const db = createDb(':memory:');  // No real Postgres needed for unit tests
```

### T3 Stack (Next.js + tRPC + Prisma + Tailwind)

| Layer | Tool | Mock Strategy |
|-------|------|---------------|
| React components | Vitest + Testing Library | Mock tRPC client |
| tRPC procedures | Vitest | Direct procedure call with mock context |
| Prisma queries | Vitest | `@prisma/client/jest-mock` or test DB |
| E2E | Playwright | Full Next.js app |

```ts
// T3: Testing a tRPC procedure directly
import { appRouter } from '../server/routers/_app';
import { createInnerTRPCContext } from '../server/trpc';

const ctx = createInnerTRPCContext({ session: mockSession });
const caller = appRouter.createCaller(ctx);

const result = await caller.todo.getAll();
expect(result).toHaveLength(3);
```

### Next.js (App Router)

| Layer | Tool | Notes |
|-------|------|-------|
| Server Components | Vitest (call as functions) | No DOM needed — just test the returned JSX |
| Client Components | Vitest + Testing Library | jsdom environment |
| Server Actions | Vitest | Mock the DB layer, test the function |
| API Routes | Vitest | Mock `NextRequest`, test handler function |
| Middleware | Vitest | Mock `NextRequest` + `NextResponse` |
| E2E | Playwright | Full `next dev` or `next start` |

---

## 8. CI Pipeline (GitHub Actions)

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test              # vitest run
      - run: pnpm test -- --coverage # coverage report

  e2e:
    runs-on: ubuntu-latest
    needs: unit                      # Only run E2E if unit tests pass
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: npx playwright install --with-deps
      - run: pnpm exec playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-traces
          path: e2e/test-results/
```

### Monorepo CI Optimization

```yaml
# Run tests only for changed packages
- run: |
    CHANGED=$(git diff --name-only HEAD~1 | grep -oP 'packages/\K[^/]+' | sort -u)
    for pkg in $CHANGED; do
      pnpm --filter "@vai/$pkg" test
    done
```

---

## 9. Do's and Don'ts Cheat Sheet

### Vitest Do's
- **Do** test business rules (permissions, validation, state changes) over implementation details
- **Do** colocate tests near source: `Button.test.tsx` next to `Button.tsx`
- **Do** use Testing Library queries: `getByRole`, `getByLabel`, `getByText`
- **Do** mock network calls with MSW or `vi.mock()`
- **Do** mock at the boundary (mock the DB repository, not the ORM internals)
- **Do** use Arrange-Act-Assert format
- **Do** use `beforeEach` for repeated setup, keep tests DRY
- **Do** run in watch mode during dev (`vitest`) and full run in CI (`vitest run`)
- **Do** use `vi.fn()` for spies, `vi.useFakeTimers()` for time-dependent code

### Vitest Don'ts
- **Don't** over-mock React internals (don't test which hook is called)
- **Don't** test implementation details — test rendered output and behavior
- **Don't** hit real external APIs or real DB in unit tests
- **Don't** use fragile selectors (`.css-123`) — prefer roles, labels, text
- **Don't** put all tests in one giant `tests/` folder
- **Don't** snapshot everything — snapshots are for a few stable UI pieces
- **Don't** write test files longer than 200-300 lines — split by concern
- **Don't** forget to clear mocks between tests (`vi.clearAllMocks()`)

### Playwright Do's
- **Do** treat E2E tests as high-value flows only (auth, payments, critical CRUD)
- **Do** keep tests independent — clean state per test (seed DB, reset data)
- **Do** use robust selectors: `getByRole`, `getByLabel`, `getByText`
- **Do** use tracing/screenshots only when debugging CI flakiness
- **Do** tag tests: `@smoke`, `@full` — run smoke on PR, full on main
- **Do** use Playwright's auto-waiting and `locator.waitFor()`
- **Do** test both happy and a few unhappy paths

### Playwright Don'ts
- **Don't** test what Vitest already covers (minor validation details)
- **Don't** use `waitForTimeout` — use Playwright's auto-waiting instead
- **Don't** share global state across tests without resetting
- **Don't** run the full E2E suite on every commit — run selective smoke tests
- **Don't** rely on test execution order
- **Don't** test styling/CSS details with Playwright — that's visual regression territory

---

## 10. Quick Wins — Start Here

1. **Start each new feature with at least:**
   - 2-3 Vitest tests for core logic or components
   - 1 Playwright test if it's a user-critical flow

2. **Add testing to CI early** — even just `pnpm test` on push

3. **Use the same patterns across stacks** so tests feel familiar

4. **When refactoring code, refactor tests too** — stale tests are worse than no tests

5. **Measure coverage** but don't chase 100% — aim for 80% on critical paths

---

## 11. Vai's Current Test Coverage

| Package | Files | Tests | Status |
|---------|-------|-------|--------|
| `@vai/core` | 8 | 89 | ✅ All passing |
| `@vai/runtime` | 2 | 23 | ✅ All passing |
| **Total** | **10** | **112** | **✅ 100% pass rate** |

### What's tested:
- ✅ VaiEngine: chat, streaming, binary decode, code generation, speed
- ✅ KnowledgeStore: learn, generate, match, export/import
- ✅ VaiTokenizer: encode, decode, vocab management
- ✅ ChatService: conversations, messages, streaming, deletion
- ✅ ModelRegistry: register, list, retrieve, error handling
- ✅ ToolRegistry: register, list, retrieve, error handling
- ✅ IngestPipeline: web/youtube ingest, chunking, search, Norwegian
- ✅ YouTube/GitHub helpers: URL parsing, capture creation
- ✅ DB: migrations, CRUD, constraints
- ✅ File extractor: markdown parsing, dedup, edge cases
- ✅ SandboxManager: create, write, list, destroy, templates
- ✅ Conversation routes: POST/GET endpoints, message sending, history

### Suggested next tests:
- [ ] React component tests (ChatWindow, MessageBubble, Sidebar) — needs `jsdom` setup
- [ ] Zustand store tests (chatStore, sandboxStore, layoutStore)
- [ ] WebSocket chat route test (streaming via WS)
- [ ] Playwright E2E: open app → type message → see response
- [ ] Playwright E2E: scaffold template → see preview
