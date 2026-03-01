/**
 * VCUS Interview Knowledge — Prepare VAI for senior developer interviews
 *
 * Teaches VAI about:
 * - OWASP Top 10 security (for OWASP expert interviewer)
 * - Engineering best practices (for Altibox senior dev interviewer)
 * - Correct package/cargo versions (no deprecated APIs)
 *
 * Usage: tsx src/interview-knowledge.ts
 */

const BASE = process.env.VAI_URL || 'http://localhost:3006';

interface KnowledgeEntry {
  title: string;
  content: string;
  url: string;
}

async function teach(entry: KnowledgeEntry): Promise<{ tokens: number }> {
  const patterns = extractPatterns(entry.title, entry.content);
  if (patterns.length > 0) {
    const pRes = await fetch(`${BASE}/api/teach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries: patterns.map(p => ({
          pattern: p.pattern,
          response: p.response,
          source: 'vcus-interview',
        })),
      }),
    });
    if (!pRes.ok) console.warn(`  ⚠️ Pattern teach failed: ${pRes.status}`);
  }

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

function extractPatterns(title: string, content: string): Array<{ pattern: string; response: string }> {
  const patterns: Array<{ pattern: string; response: string }> = [];
  patterns.push({ pattern: title.toLowerCase(), response: content });

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

// ─── Interview Knowledge Entries ────────────────────────────────

const KNOWLEDGE: KnowledgeEntry[] = [

  // ═══════════════════════════════════════════════════════════════
  //  OWASP SECURITY KNOWLEDGE
  // ═══════════════════════════════════════════════════════════════

  {
    title: 'OWASP Top 10 2021 Web Application Security Risks',
    url: 'https://owasp.org/Top10/',
    content: `# OWASP Top 10 2021 — Web Application Security Risks

## What is the OWASP Top 10

The **OWASP Top 10** is the most widely recognized document for web application security awareness, published by the Open Web Application Security Project (OWASP). It represents a broad consensus about the most critical security risks to web applications. The 2021 edition reflects modern threats and attack patterns.

The OWASP Top 10 is used globally as a baseline standard for web application security testing, secure development training, and compliance requirements.

## The Complete OWASP Top 10 2021 List

1. **A01:2021 — Broken Access Control** — The #1 risk. 94% of applications tested had some form of broken access control. Includes IDOR (Insecure Direct Object References), missing function-level access control, CORS misconfiguration, and privilege escalation.

2. **A02:2021 — Cryptographic Failures** — Previously "Sensitive Data Exposure". Covers weak encryption, plaintext data transmission, deprecated hash algorithms (MD5, SHA-1), missing TLS, and exposed sensitive data.

3. **A03:2021 — Injection** — Includes SQL injection, NoSQL injection, OS command injection, LDAP injection, and Cross-Site Scripting (XSS). An application is vulnerable when user-supplied data is not validated, filtered, or sanitized.

4. **A04:2021 — Insecure Design** — NEW in 2021. Focuses on design flaws rather than implementation bugs. Requires threat modeling, secure design patterns, and reference architectures.

5. **A05:2021 — Security Misconfiguration** — Includes default credentials, unnecessary features enabled, missing security headers, verbose error messages, and misconfigured cloud permissions.

6. **A06:2021 — Vulnerable and Outdated Components** — Using libraries, frameworks, or dependencies with known vulnerabilities. Requires regular dependency auditing with tools like \`npm audit\`, Snyk, or Dependabot.

7. **A07:2021 — Identification and Authentication Failures** — Weak passwords, missing multi-factor authentication, session fixation, credential stuffing, and improper session management.

8. **A08:2021 — Software and Data Integrity Failures** — NEW in 2021. Includes CI/CD pipeline insecurity, unsigned updates, and supply chain attacks through compromised dependencies.

9. **A09:2021 — Security Logging and Monitoring Failures** — Insufficient logging, missing audit trails, no alerting on suspicious activity, and inability to detect breaches.

10. **A10:2021 — Server-Side Request Forgery (SSRF)** — NEW in 2021. When an application fetches a remote resource without validating the user-supplied URL, allowing attackers to access internal services.

## Most Critical Risks for Modern Web Applications

For a modern web application using React, Fastify, and Tauri:

- **Broken Access Control** (A01): Ensure API endpoints validate authorization, not just authentication. Use role-based access control (RBAC).
- **Injection/XSS** (A03): React escapes JSX output by default, but \`dangerouslySetInnerHTML\` bypasses this. Always sanitize user input server-side.
- **Vulnerable Components** (A06): Run \`npm audit\` regularly, keep dependencies updated, use lockfiles for reproducible builds.
- **SSRF** (A10): When your backend fetches URLs (e.g., for ingestion), validate and whitelist allowed destinations.
- **Security Misconfiguration** (A05): Configure CORS properly, set security headers (CSP, HSTS), disable verbose errors in production.`,
  },

  {
    title: 'XSS Cross-Site Scripting Prevention in React',
    url: 'https://owasp.org/www-community/attacks/xss/',
    content: `# XSS (Cross-Site Scripting) Prevention in React

## How React Prevents XSS by Default

React provides built-in XSS protection through automatic output escaping. When you render data in JSX, React automatically escapes it before inserting into the DOM:

\`\`\`tsx
// ✅ Safe — React escapes the HTML automatically
const userInput = '<script>alert("xss")</script>';
return <div>{userInput}</div>;
// Renders as text: <script>alert("xss")</script>
\`\`\`

React's JSX compiler converts expressions to \`React.createElement()\` calls which use \`textContent\` (not \`innerHTML\`), preventing script execution.

## dangerouslySetInnerHTML Risks and Safe Usage

The \`dangerouslySetInnerHTML\` prop bypasses React's XSS protection and directly sets HTML:

\`\`\`tsx
// ❌ DANGEROUS — never use with unsanitized user input
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// ✅ Safe — sanitize with DOMPurify first
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userInput) }} />
\`\`\`

When rendering Markdown (e.g., with react-markdown), ensure the renderer sanitizes HTML. react-markdown uses remark/rehype plugins which are safe by default.

## XSS Prevention Best Practices

1. **Never use \`dangerouslySetInnerHTML\` with raw user input** — always sanitize with DOMPurify or similar
2. **Validate and sanitize on the server side** — client-side validation is bypassable
3. **Use Content Security Policy (CSP) headers** — prevents inline script execution
4. **Escape URL parameters** — \`javascript:\` URLs in href attributes can execute scripts
5. **Use \`httpOnly\` cookies** — prevents JavaScript from accessing session cookies
6. **Sanitize rich text input** — use allowlists for HTML tags and attributes
7. **Review third-party components** — ensure they don't use \`innerHTML\` directly
8. **Use React's built-in escaping** — prefer JSX expressions over manual DOM manipulation

## Types of XSS Attacks

- **Stored XSS**: Malicious script persisted in database, executed when other users view the page
- **Reflected XSS**: Script injected via URL parameters, reflected back in the response
- **DOM-based XSS**: Script manipulates the DOM directly via client-side JavaScript

In a React SPA (Single Page Application), DOM-based XSS is the most common risk, especially with \`dangerouslySetInnerHTML\`, \`window.location\` parsing, and URL hash manipulation.`,
  },

  {
    title: 'CSRF Cross-Site Request Forgery Protection',
    url: 'https://owasp.org/www-community/attacks/csrf',
    content: `# CSRF (Cross-Site Request Forgery) Protection

## What is CSRF and How It Works

**CSRF** (Cross-Site Request Forgery) is an attack that forces authenticated users to perform unwanted actions on a web application. The attacker creates a malicious page that submits requests to the target application, using the victim's existing session cookies.

Example: A user is logged into their bank. They visit a malicious site that contains:
\`\`\`html
<img src="https://bank.com/transfer?to=attacker&amount=1000" />
\`\`\`
The browser sends the request with the user's session cookie, authorizing the transfer.

## SameSite Cookies for CSRF Prevention

The **SameSite** cookie attribute is the modern primary defense against CSRF:

- \`SameSite=Strict\` — Cookie only sent for same-site requests. Maximum protection but breaks legitimate cross-site navigation.
- \`SameSite=Lax\` — Cookie sent for top-level navigations (GET) but not for cross-site POST/PUT/DELETE. The recommended default.
- \`SameSite=None; Secure\` — Cookie sent for all cross-site requests (requires HTTPS). Use only when cross-site cookies are actually needed.

\`\`\`ts
// Fastify cookie example
reply.setCookie('session', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
});
\`\`\`

## CSRF Token Implementation

For applications that need cross-origin POST requests, use CSRF tokens:

1. **Synchronizer Token Pattern**: Server generates a random token per session, embeds it in forms, validates on submission
2. **Double Submit Cookie**: Token set as both a cookie and a request header/body — attacker can't read cookies from another domain
3. **Custom Request Headers**: \`X-CSRF-Token\` or \`X-Requested-With\` headers — browsers don't add these to cross-site requests

For **SPA (Single Page Applications)** with API backends:
- Use \`SameSite=Lax\` cookies + JSON \`Content-Type\` header (browsers block cross-origin JSON POST without CORS)
- Verify \`Origin\` or \`Referer\` headers server-side
- Use JWT in \`Authorization\` header instead of cookies (not vulnerable to CSRF)

## CSRF in Modern SPAs

In a modern SPA like the VAI desktop app:
- API requests use \`fetch()\` with JSON content type
- CORS blocks cross-origin requests from unauthorized origins
- If using JWT tokens in headers (not cookies), CSRF is not applicable
- If using session cookies, always set \`SameSite=Lax\` at minimum`,
  },

  {
    title: 'SQL Injection Prevention with Drizzle ORM and SQLite',
    url: 'https://owasp.org/www-community/attacks/SQL_Injection',
    content: `# SQL Injection Prevention with Drizzle ORM and SQLite

## How Drizzle ORM Prevents SQL Injection

**Drizzle ORM** (version 0.38) prevents SQL injection by using parameterized queries (prepared statements) under the hood. When you use Drizzle's query builders, values are always passed as parameters, never interpolated into the SQL string:

\`\`\`ts
import { eq } from 'drizzle-orm';
import { users } from './schema';

// ✅ Safe — Drizzle uses parameterized query
// Generated SQL: SELECT * FROM users WHERE name = ?
const result = db.select().from(users).where(eq(users.name, userInput)).all();

// ✅ Safe — insert with parameters
db.insert(users).values({ name: userInput, email: userEmail }).run();

// ✅ Safe — update with parameters
db.update(users).set({ name: newName }).where(eq(users.id, userId)).run();
\`\`\`

Drizzle ORM with **better-sqlite3** (version 11.8) uses SQLite's native prepared statement API, which completely separates SQL structure from data.

## Parameterized Queries vs String Interpolation

\`\`\`ts
// ❌ VULNERABLE — string interpolation (SQL injection!)
db.run(\`SELECT * FROM users WHERE name = '\${userInput}'\`);
// If userInput = "'; DROP TABLE users; --", the table is deleted!

// ✅ SAFE — parameterized query
db.prepare('SELECT * FROM users WHERE name = ?').get(userInput);
// The ? placeholder ensures userInput is treated as data, never as SQL
\`\`\`

Parameterized queries (also called prepared statements) tell the database "here is the SQL structure, and here are the data values separately". The database engine never parses the data values as SQL code.

## SQL Injection Prevention Best Practices with Drizzle

1. **Always use Drizzle's query builder API** — never build SQL strings manually
2. **Use \`eq()\`, \`and()\`, \`or()\`, \`like()\` operators** — they generate safe parameterized queries
3. **For raw SQL, use \`sql\` template literal** — \`sql\\\`SELECT * FROM users WHERE id = \${userId}\\\`\` — Drizzle parameterizes template interpolations
4. **never use string concatenation for SQL** — always use the ORM or parameterized queries
5. **Validate input with Zod** — validate and transform input before it reaches the database layer
6. **Use Drizzle's type-safe schema** — TypeScript catches many errors at compile time

## SQLite-Specific Security with better-sqlite3

better-sqlite3 (version 11.8) is synchronous and runs in the main thread, providing:
- Native prepared statement caching
- WAL (Write-Ahead Logging) mode for concurrent reads
- No network exposure — the database is a local file
- No SQL injection risk when using the \`.prepare().get()\` API correctly`,
  },

  {
    title: 'Secure Authentication JWT Sessions Password Hashing',
    url: 'https://owasp.org/www-project-web-security-testing-guide/',
    content: `# Secure Authentication — JWT, Sessions, and Password Hashing

## JWT vs Session-Based Authentication

**JWT (JSON Web Tokens)**:
- Stateless — token contains all user info, no server-side session store needed
- Self-contained — includes claims (user ID, roles, expiry)
- Stored client-side (localStorage or memory, NOT cookies if possible)
- Good for: microservices, API-first architectures, mobile apps
- Risk: tokens can't be easily revoked (use short expiry + refresh tokens)

**Session-Based**:
- Stateful — server stores session data, client gets a session ID cookie
- Session ID is opaque — no user info in the cookie itself
- Stored server-side (memory, Redis, or database)
- Good for: traditional web apps, when you need instant revocation
- Risk: requires session storage at scale, vulnerable to CSRF if not using SameSite cookies

For a desktop application (Tauri), JWT in memory is preferred because:
- No cross-origin cookie issues
- Token stored in app memory (not localStorage)
- Can refresh tokens without full re-authentication

## Password Hashing Security

**Never store plaintext passwords.** Use a slow, salted hash:

- **bcrypt** — Adaptive cost factor, built-in salt, industry standard. Cost factor 10-12 recommended.
- **Argon2** — Winner of the Password Hashing Competition (PHC). Memory-hard, resistant to GPU attacks.
- **scrypt** — Memory-hard alternative. Used by some cryptocurrency systems.

\`\`\`ts
// Example with bcrypt
import bcrypt from 'bcrypt';
const saltRounds = 12;
const hash = await bcrypt.hash(password, saltRounds);
const match = await bcrypt.compare(inputPassword, storedHash);
\`\`\`

**Never use**: MD5, SHA-1, SHA-256 alone for passwords — they're too fast and unsalted.

## OAuth 2.0 and OpenID Connect

For third-party authentication:
- **OAuth 2.0** — Authorization framework (gives access to resources)
- **OpenID Connect (OIDC)** — Authentication layer on top of OAuth 2.0 (proves identity)
- Use **Authorization Code Flow with PKCE** for all clients (including SPAs and mobile apps)
- **Never** use Implicit Flow — it's deprecated and insecure

## Authentication Best Practices

1. Use **multi-factor authentication (MFA)** where possible
2. Implement **account lockout** after failed attempts (with progressive delay)
3. Use **secure password policies** — minimum length (12+), check against breached password lists
4. Set proper **token expiry** — access tokens: 15-60 min, refresh tokens: 7-30 days
5. Rotate **refresh tokens** on each use (refresh token rotation)
6. Log all **authentication events** — login, logout, failed attempts, password changes
7. Use **HTTPS only** — never transmit credentials over HTTP
8. Validate **email addresses** before granting full access`,
  },

  {
    title: 'Content Security Policy CSP and Security Headers',
    url: 'https://owasp.org/www-project-secure-headers/',
    content: `# Content Security Policy (CSP) and Security Headers

## Content Security Policy CSP Explained

**Content Security Policy (CSP)** is a security header that prevents XSS, clickjacking, and other code injection attacks by specifying which sources of content are allowed to load.

\`\`\`
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ws: wss:;
\`\`\`

Key CSP Directives:
- \`default-src\` — Fallback for all resource types
- \`script-src\` — Controls script loading (most important for XSS prevention)
- \`style-src\` — Controls stylesheet loading
- \`img-src\` — Controls image loading
- \`connect-src\` — Controls fetch/XHR/WebSocket destinations
- \`frame-ancestors\` — Prevents clickjacking (replaces X-Frame-Options)
- \`report-uri\` / \`report-to\` — Sends CSP violation reports to a server

Use \`'nonce-{random}'\` or \`'strict-dynamic'\` instead of \`'unsafe-inline'\` for scripts.

## Essential Security Headers for Web Applications

Every web application should set these security headers:

\`\`\`
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self'
\`\`\`

In Fastify, set headers with a hook:
\`\`\`ts
app.addHook('onRequest', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});
\`\`\`

## HSTS Strict Transport Security

**HSTS** (HTTP Strict Transport Security) forces browsers to use HTTPS only:
- \`max-age=31536000\` — Remember for 1 year
- \`includeSubDomains\` — Apply to all subdomains
- \`preload\` — Submit to browser preload list for maximum protection

Without HSTS, even with a redirect from HTTP to HTTPS, the first request is unencrypted and vulnerable to man-in-the-middle attacks.

## Security Headers in Tauri Desktop Applications

Tauri 2 has its own security model:
- CSP is configured in \`tauri.conf.json\` under \`security.csp\`
- Default CSP restricts loading resources to the app bundle
- The \`tauri://\` and \`asset://\` protocols are allowed by default
- External connections must be explicitly allowed in capabilities`,
  },

  {
    title: 'CORS Cross-Origin Resource Sharing Configuration in Fastify',
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS',
    content: `# CORS (Cross-Origin Resource Sharing) Configuration

## How CORS Works

**CORS** (Cross-Origin Resource Sharing) is a browser security mechanism that controls which origins can access resources from your API. Browsers block cross-origin requests by default (Same-Origin Policy).

When a frontend at \`http://localhost:5173\` makes a request to an API at \`http://localhost:3006\`, the browser:
1. Checks if the request is "simple" (GET/POST with standard Content-Type)
2. For non-simple requests, sends a **preflight** OPTIONS request first
3. The server responds with \`Access-Control-Allow-Origin\` headers
4. The browser allows or blocks the request based on the response headers

## Fastify CORS Configuration with @fastify/cors

The project uses **@fastify/cors** (version 10) for CORS handling:

\`\`\`ts
import cors from '@fastify/cors';

await app.register(cors, {
  origin: true, // Reflects the request origin (for development)
  // For production, use specific origins:
  // origin: ['https://yourdomain.com', 'tauri://localhost'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
\`\`\`

Key @fastify/cors options:
- \`origin\`: \`true\` (reflect request), string, array, or function
- \`credentials\`: Allow cookies/auth headers in cross-origin requests
- \`methods\`: Allowed HTTP methods
- \`allowedHeaders\`: Allowed request headers
- \`exposedHeaders\`: Headers exposed to the browser
- \`maxAge\`: How long preflight results are cached (seconds)

## CORS Security Best Practices

1. **Never use \`origin: '*'\` with \`credentials: true\`** — browsers reject this combination
2. **Whitelist specific origins in production** — don't reflect all origins
3. **Limit allowed methods** — only allow methods your API actually uses
4. **Set \`maxAge\`** — cache preflight results to reduce OPTIONS requests (e.g., 86400 for 24h)
5. **Validate Origin header server-side** — for sensitive endpoints, check Origin against allowlist
6. **Don't expose internal endpoints** — CORS doesn't prevent access from non-browser clients (curl, Postman)

## CORS for Tauri Desktop Applications

Tauri apps make requests from \`tauri://localhost\` or \`https://tauri.localhost\`. The backend must allow this origin:

\`\`\`ts
origin: ['http://localhost:5173', 'tauri://localhost', 'https://tauri.localhost']
\`\`\``,
  },

  {
    title: 'Dependency Security npm audit Supply Chain Protection',
    url: 'https://docs.npmjs.com/auditing-package-dependencies-for-security-vulnerabilities',
    content: `# Dependency Security — npm audit and Supply Chain Protection

## npm audit and Dependency Vulnerability Scanning

\`npm audit\` (or \`pnpm audit\`) scans your dependency tree for known vulnerabilities:

\`\`\`bash
# Check for vulnerabilities
pnpm audit

# Fix vulnerabilities automatically
pnpm audit --fix

# Check only production dependencies
pnpm audit --prod
\`\`\`

Additional tools for dependency security:
- **Snyk** — Comprehensive vulnerability database, CI/CD integration
- **Dependabot** (GitHub) — Automatic PRs for dependency updates
- **Socket.dev** — Detects supply chain attacks (typosquatting, dependency confusion)
- **npm-check-updates** (\`ncu\`) — Shows available updates for all dependencies

## Supply Chain Attacks and Prevention

**Supply chain attacks** target the software dependency chain:
- **Typosquatting**: Publishing \`lodas\` instead of \`lodash\` to npm
- **Dependency confusion**: Publishing a public package with the same name as an internal package
- **Account takeover**: Compromising a maintainer's npm account
- **Malicious update**: A trusted package pushes a compromised version

Prevention:
1. **Use a lockfile** — \`pnpm-lock.yaml\` pins exact versions and integrity hashes
2. **Review dependency diffs before updating** — use \`pnpm update --interactive\`
3. **Pin major versions** — use \`^5.0.0\` not \`*\` or \`latest\`
4. **Audit frequently** — add \`pnpm audit\` to CI/CD pipeline
5. **Use scoped packages** — \`@vai/core\` is harder to typosquat than \`vai-core\`
6. **Enable 2FA on npm** — protect your publishing credentials
7. **Check package provenance** — npm now supports attestation signatures

## Lockfile Security and Reproducible Builds

The \`pnpm-lock.yaml\` lockfile ensures:
- Exact versions of every dependency (including transitive)
- Integrity hashes (SHA-512) to detect tampering
- Reproducible installs across environments
- **Always commit lockfiles to git** — never add them to .gitignore
- Run \`pnpm install --frozen-lockfile\` in CI to catch lockfile drift

## Keeping Dependencies Updated

This project uses these key packages at these versions:
- React ^19.0.0, react-dom ^19.0.0
- Fastify ^5.2.0, @fastify/cors ^10.0.0, @fastify/websocket ^11.0.0
- Drizzle ORM ^0.38.0, better-sqlite3 ^11.8.0
- Zustand ^5.0.0, Zod ^3.24.0
- TypeScript ^5.7.0, Vite ^6.0.0, Vitest ^3.0.0
- Tailwind CSS ^3.4.0, wxt ^0.20.0
- Tauri 2, tauri-plugin-shell 2
- esbuild ^0.27.3, tsx ^4.19.0`,
  },

  // ═══════════════════════════════════════════════════════════════
  //  ENGINEERING & ARCHITECTURE KNOWLEDGE
  // ═══════════════════════════════════════════════════════════════

  {
    title: 'React 19 New Features and Migration from React 18',
    url: 'https://react.dev/blog/2024/12/05/react-19',
    content: `# React 19 — New Features and Changes

## React 19 use() Hook

The \`use()\` hook is a new React 19 API for reading resources (promises and context) during render:

\`\`\`tsx
import { use } from 'react';

function Comments({ commentsPromise }) {
  // use() can read promises — suspends until resolved
  const comments = use(commentsPromise);
  return comments.map(c => <p key={c.id}>{c.text}</p>);
}

// use() can also read context (replaces useContext)
function Theme() {
  const theme = use(ThemeContext);
  return <div style={{ color: theme.color }}>{theme.name}</div>;
}
\`\`\`

Unlike other hooks, \`use()\` can be called inside conditionals and loops — it doesn't follow the Rules of Hooks.

## ref as a Regular Prop in React 19 — No More forwardRef

In React 19, function components receive \`ref\` as a regular prop. You **no longer need** \`React.forwardRef\`:

\`\`\`tsx
// ✅ React 19 — ref is just a prop
function MyInput({ ref, ...props }) {
  return <input ref={ref} {...props} />;
}

// Use it directly
<MyInput ref={inputRef} />

// ❌ React 18 (old way) — forwardRef was required
const MyInput = React.forwardRef((props, ref) => {
  return <input ref={ref} {...props} />;
});
\`\`\`

\`React.forwardRef\` still works in React 19 for backward compatibility but is no longer necessary and will be deprecated in a future version.

## useActionState Hook in React 19

\`useActionState\` is a new hook (replaces the experimental \`useFormState\`):

\`\`\`tsx
import { useActionState } from 'react';

function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    async (prevState, formData) => {
      const result = await login(formData);
      if (result.error) return { error: result.error };
      redirect('/dashboard');
    },
    { error: null }
  );

  return (
    <form action={formAction}>
      <input name="email" type="email" />
      {state.error && <p>{state.error}</p>}
      <button disabled={isPending}>
        {isPending ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
}
\`\`\`

## React 19 Server Components and Actions

**React Server Components (RSC)** are stable in React 19:
- Components marked with \`"use server"\` run on the server only
- They can access databases, file systems, and secrets directly
- Zero client-side JavaScript — not included in the bundle
- Use \`"use client"\` boundary to mark interactive components

**Server Actions**: Functions that run on the server, called from client components via form \`action\` prop or \`startTransition\`.

## Other React 19 Features

- **\`<Context>\` as provider** — Use \`<ThemeContext value={theme}>\` instead of \`<ThemeContext.Provider value={theme}>\`
- **\`useOptimistic\`** — Optimistic UI updates while async operations are pending
- **Document metadata** — Render \`<title>\`, \`<meta>\`, \`<link>\` directly in components
- **Ref cleanup functions** — Return a cleanup function from ref callbacks (like useEffect)
- **Stylesheet support** — \`<link rel="stylesheet" precedence="default">\` with deduplication
- **Async scripts** — \`<script async>\` with deduplication and ordering`,
  },

  {
    title: 'Fastify 5 Web Framework Architecture and Features',
    url: 'https://fastify.dev/docs/latest/',
    content: `# Fastify 5 — Web Framework Architecture

## Why Fastify Over Express

**Fastify** (version 5.2) is chosen over Express for several reasons:

1. **Performance**: Fastify is 2-3x faster than Express in benchmarks. Uses a radix tree for routing and efficient JSON serialization.
2. **Schema validation**: Built-in JSON Schema / TypeBox validation for request/response. Express requires external middleware (express-validator, joi).
3. **Plugin system**: Encapsulated plugins with proper dependency injection. No global middleware pollution.
4. **TypeScript-first**: Excellent TypeScript support with generic route typing. Express TypeScript types are maintained separately and often incomplete.
5. **Lifecycle hooks**: Rich hook system (onRequest, preParsing, preValidation, preHandler, preSerialization, onSend, onResponse, onError).
6. **Logging**: Built-in Pino logger (high-performance, structured JSON logging).
7. **Async/await**: Natively supports async handlers — no callback hell or next() patterns.

Express is still widely used but is considered legacy for new projects. Fastify is the modern choice for Node.js APIs.

## Fastify 5 Key Changes and Features

Fastify 5.2 improvements:
- **Modern Node.js** — Requires Node.js 20+ for full ESM support
- **Better ESM support** — Native ES modules alongside CommonJS
- **Improved TypeScript generics** — Better type inference for routes
- **Streamlined plugin API** — Clearer encapsulation boundaries
- **JSON Schema draft-2020-12** — Updated schema specification support
- **Performance improvements** — Further optimizations to the router and serializer

## Fastify Plugin System and Encapsulation

Fastify's plugin system provides true encapsulation:

\`\`\`ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';

const app = Fastify({ logger: false, bodyLimit: 15 * 1024 * 1024 });

// Plugins are registered with await
await app.register(cors, { origin: true });
await app.register(websocket);

// Routes are encapsulated — decorators and hooks in one plugin
// don't leak to sibling plugins
app.register(async function authRoutes(fastify) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.get('/profile', getProfileHandler);
});
\`\`\`

Key Fastify plugins used in this project:
- **@fastify/cors** (v10) — CORS handling
- **@fastify/websocket** (v11) — WebSocket support for real-time chat

## Fastify Schema Validation with TypeBox and Zod

Fastify validates request/response with JSON Schema or TypeBox:

\`\`\`ts
// TypeBox schema validation
import { Type, Static } from '@sinclair/typebox';

const ChatBody = Type.Object({
  model: Type.String(),
  messages: Type.Array(Type.Object({
    role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
    content: Type.String(),
  })),
});

app.post<{ Body: Static<typeof ChatBody> }>('/api/chat', {
  schema: { body: ChatBody },
  handler: async (request, reply) => {
    const { model, messages } = request.body; // fully typed
  },
});
\`\`\`

Alternatively, use Zod (v3.24) for validation outside of Fastify schema:
\`\`\`ts
import { z } from 'zod';
const chatSchema = z.object({ model: z.string(), messages: z.array(...) });
\`\`\``,
  },

  {
    title: 'Tauri 2 Desktop Application Framework vs Electron',
    url: 'https://v2.tauri.app/start/',
    content: `# Tauri 2 — Desktop Application Framework

## Why Tauri 2 Instead of Electron

**Tauri 2** is chosen over Electron for building the VAI desktop application:

| Feature | Tauri 2 | Electron |
|---------|---------|----------|
| Binary size | ~3-10 MB | ~150+ MB |
| Memory usage | ~30-50 MB | ~150-300 MB |
| Backend language | Rust | Node.js |
| Rendering engine | System WebView | Bundled Chromium |
| Security model | Capability-based permissions | Full Node.js access |
| Startup time | <1 second | 2-5 seconds |
| Mobile support | iOS and Android | No |

Key advantages of Tauri 2:
1. **Much smaller binaries** — Uses the system's WebView instead of bundling Chromium
2. **Better performance** — Rust backend is faster and uses less memory
3. **Stronger security** — Capability-based permission system, no Node.js in the frontend
4. **Mobile support** — Tauri 2 supports iOS and Android builds
5. **Modern Rust ecosystem** — Access to Rust's memory safety and concurrency

## Tauri 2 Security and Permission System

Tauri 2 uses a **capability-based permission system** instead of Electron's unrestricted Node.js access:

\`\`\`json
// tauri.conf.json — security configuration
{
  "security": {
    "csp": "default-src 'self'; connect-src 'self' http://localhost:3006 ws://localhost:3006"
  }
}
\`\`\`

Capabilities in Tauri 2:
- **File system** — Must declare which paths the app can access
- **Shell** — Must explicitly enable command execution via \`tauri-plugin-shell\`
- **HTTP** — Must whitelist allowed URLs for external requests
- **Clipboard, Dialog, Notification** — Each requires its own plugin permission

This is fundamentally more secure than Electron where the renderer process has full Node.js access by default.

## Tauri 2 IPC and Invoke System

Tauri 2's IPC (Inter-Process Communication) connects the JavaScript frontend to the Rust backend:

\`\`\`rust
// src-tauri/src/main.rs — Rust command handler
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
\`\`\`

\`\`\`ts
// Frontend — invoke Rust commands
import { invoke } from '@tauri-apps/api/core';
const greeting = await invoke('greet', { name: 'World' });
\`\`\`

## Tauri 2 Rust Configuration

The project's Cargo.toml:
- **Edition**: Rust 2021
- **tauri**: Version 2 with features for desktop
- **tauri-plugin-shell**: Version 2 for command execution
- **serde**: Version 1 with derive feature for serialization
- **Release profile**: \`strip = true, lto = true, codegen-units = 1, panic = "abort"\` for optimized release builds`,
  },

  {
    title: 'pnpm Monorepo Workspace Architecture and Shared Packages',
    url: 'https://pnpm.io/workspaces',
    content: `# pnpm Monorepo with Workspace Architecture

## Why pnpm Over npm or yarn

**pnpm** is chosen as the package manager for several reasons:

1. **Disk space efficiency** — Uses a content-addressable store and hard links. If 10 packages use lodash, it's stored once on disk. npm duplicates it 10 times.
2. **Strict dependency resolution** — Prevents phantom dependencies (packages that work by accident because a sibling installed them). Creates a strict \`node_modules\` structure.
3. **Fast installs** — Up to 2x faster than npm, especially with warm cache.
4. **Built-in workspace support** — \`pnpm-workspace.yaml\` defines workspace packages. No extra tools needed (unlike npm which added workspaces later).
5. **Lockfile integrity** — \`pnpm-lock.yaml\` with content integrity hashes for reproducible builds.
6. **Peer dependency handling** — Strict by default, catches peer dependency issues early.

## pnpm Workspace Structure

The project's workspace is defined in \`pnpm-workspace.yaml\`:

\`\`\`yaml
packages:
  - 'apps/*'
  - 'packages/*'
\`\`\`

Directory structure:
\`\`\`
apps/
  desktop/     — Tauri + React desktop app
  extension/   — Browser extension (wxt)
  vcus/        — VCUS knowledge sandbox
packages/
  core/        — @vai/core — Engine, DB, chat service, models
  runtime/     — @vai/runtime — Fastify server, API routes
  ui/          — @vai/ui — Shared React components
\`\`\`

## Shared Packages in the Monorepo

The monorepo shares code through internal packages:

\`\`\`json
// packages/core/package.json
{ "name": "@vai/core", "version": "0.0.1" }

// packages/runtime/package.json — depends on core
{ "dependencies": { "@vai/core": "workspace:*" } }

// apps/desktop/package.json — depends on ui
{ "dependencies": { "@vai/ui": "workspace:*" } }
\`\`\`

The \`workspace:*\` protocol tells pnpm to use the local package instead of fetching from npm. Benefits:
- Changes in \`@vai/core\` are immediately available in \`@vai/runtime\`
- TypeScript paths resolve through the workspace
- Single \`tsconfig.base.json\` shared via \`references\`
- Run scripts across all packages: \`pnpm -r build\`, \`pnpm -r test\`

## Monorepo Build and Development

Development commands:
\`\`\`bash
pnpm dev          # Start all dev servers (concurrently)
pnpm build        # Build all packages
pnpm test         # Run tests across all packages
pnpm -r typecheck # Type-check all packages
\`\`\`

The root \`package.json\` uses \`concurrently\` (v9.2) to run the runtime server and Vite dev server in parallel.`,
  },

  {
    title: 'Zustand 5 State Management for React',
    url: 'https://zustand-demo.pmnd.rs/',
    content: `# Zustand 5 — State Management for React

## Why Zustand Over Redux

**Zustand** (version 5.0) is chosen over Redux for state management:

1. **Minimal boilerplate** — No action types, action creators, reducers, or dispatch. Just a store with state and functions.
2. **No provider needed** — Unlike Redux (or React Context), Zustand doesn't require wrapping your app in a \`<Provider>\`. Less nesting, simpler tree.
3. **Small bundle** — ~1KB gzipped vs Redux Toolkit's ~11KB. Zustand is tiny.
4. **Selective re-renders** — Components only re-render when the specific state they select changes. Built-in selector support.
5. **Middleware** — Supports \`persist\`, \`devtools\`, \`immer\`, and \`subscribeWithSelector\` middleware.
6. **Works outside React** — Can access state in non-React code (event handlers, API calls).
7. **TypeScript-first** — Excellent type inference out of the box.

## Zustand 5 Store Creation and Usage

\`\`\`ts
import { create } from 'zustand';

// Define a store with state and actions
interface ChatStore {
  messages: Message[];
  isLoading: boolean;
  addMessage: (msg: Message) => void;
  setLoading: (loading: boolean) => void;
  clearMessages: () => void;
}

const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isLoading: false,
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  setLoading: (loading) => set({ isLoading: loading }),
  clearMessages: () => set({ messages: [] }),
}));

// Usage in React component — selective subscription
function MessageList() {
  const messages = useChatStore((state) => state.messages);
  return messages.map(m => <MessageBubble key={m.id} message={m} />);
}

// Access state outside React
const currentMessages = useChatStore.getState().messages;
\`\`\`

## Zustand Middleware (persist, devtools, immer)

\`\`\`ts
import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

const useSettingsStore = create<SettingsStore>()(
  devtools(
    persist(
      immer((set) => ({
        theme: 'dark',
        fontSize: 14,
        setTheme: (theme) => set((state) => { state.theme = theme }),
        setFontSize: (size) => set((state) => { state.fontSize = size }),
      })),
      { name: 'settings-storage' } // localStorage key
    )
  )
);
\`\`\`

Middleware in Zustand:
- **persist** — Saves state to localStorage/sessionStorage, hydrates on load
- **devtools** — Integrates with Redux DevTools for debugging
- **immer** — Allows mutable state updates (Immer produces immutable result)
- **subscribeWithSelector** — Subscribe to specific state slices

## Zustand 5 Changes from Version 4

Zustand 5 key changes:
- Requires **React 18+** as peer dependency
- Better TypeScript type inference
- Improved middleware typing
- \`create\` still works the same way — \`create<T>()((set) => ({...}))\`
- Zustand stores are still accessed via hooks or \`getState()\``,
  },

  {
    title: 'Drizzle ORM with SQLite Schema Migrations and Type-Safe Queries',
    url: 'https://orm.drizzle.team/docs/overview',
    content: `# Drizzle ORM with SQLite — Schema, Migrations, and Queries

## Drizzle ORM Schema Definition

**Drizzle ORM** (version 0.38) provides a TypeScript-first schema definition:

\`\`\`ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  modelId: text('model_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
\`\`\`

Drizzle schemas are pure TypeScript — no decorators, no classes, just functions. The schema is both the database definition and the TypeScript type.

## Drizzle Migrations with drizzle-kit

**drizzle-kit** (version 0.30) handles schema migrations:

\`\`\`bash
# Generate migration SQL from schema changes
npx drizzle-kit generate

# Apply pending migrations
npx drizzle-kit migrate

# Open Drizzle Studio (database GUI)
npx drizzle-kit studio
\`\`\`

drizzle-kit configuration:
\`\`\`ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: { url: './vai.db' },
});
\`\`\`

Migrations are stored as SQL files, version controlled, and applied in order. This is safer than auto-sync (which can lose data).

## Drizzle Type-Safe Query Builders

Drizzle provides fully type-safe query builders:

\`\`\`ts
import { eq, and, desc, like } from 'drizzle-orm';
import { conversations, messages } from './schema';

// Select with conditions
const convos = db.select().from(conversations)
  .where(eq(conversations.modelId, 'vai:v0'))
  .orderBy(desc(conversations.createdAt))
  .all();

// Insert
db.insert(messages).values({
  id: ulid(),
  conversationId: convId,
  role: 'user',
  content: text,
  createdAt: new Date(),
}).run();

// Update
db.update(conversations)
  .set({ title: newTitle })
  .where(eq(conversations.id, convId))
  .run();

// Delete
db.delete(messages)
  .where(eq(messages.conversationId, convId))
  .run();
\`\`\`

All queries are type-safe — TypeScript knows the exact shape of the result based on the schema definition. Column names, types, and relations are all inferred.

## Drizzle with better-sqlite3

The project uses **better-sqlite3** (version 11.8) as the SQLite driver:

\`\`\`ts
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

const sqlite = new Database('./vai.db');
const db = drizzle(sqlite);
\`\`\`

better-sqlite3 is synchronous (not async like node-sqlite3), which:
- Simplifies error handling (no callback or promise chains)
- Is faster for typical queries (no event loop overhead)
- Works well with Drizzle's synchronous .all(), .get(), .run() methods`,
  },

  {
    title: 'Vite 6 Build System Dev Server and Configuration',
    url: 'https://vite.dev/guide/',
    content: `# Vite 6 — Build System and Dev Server

## Vite 6 Features and Advantages

**Vite** (version 6.0) is the build system for the frontend:

1. **Instant HMR** — Hot Module Replacement in milliseconds, not seconds. Uses native ES modules in development.
2. **ESBuild for transforms** — Uses esbuild (written in Go) for TypeScript/JSX transformation during development. 10-100x faster than Babel.
3. **Rollup for production** — Uses Rollup for optimized production builds with tree-shaking, code splitting, and minification.
4. **Native ESM** — Serves source files as native ES modules during development. No bundling needed for dev.
5. **Rich plugin API** — Extends Rollup's plugin interface with Vite-specific hooks.
6. **CSS handling** — Built-in PostCSS, CSS modules, and preprocessor support.

## Vite HMR and Dev Server Configuration

\`\`\`ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:3006',
      '/api': 'http://localhost:3006',
    },
  },
  build: {
    target: 'ES2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
\`\`\`

The dev server proxies \`/api\` and \`/health\` requests to the Fastify backend at port 3006. This avoids CORS issues during development.

Vite's HMR preserves component state during edits — you can modify a React component and only that component re-renders, without losing form inputs or scroll position.

## Vite 6 Build Optimization

Production build optimizations:
- **Code splitting** — Dynamic \`import()\` creates separate chunks loaded on demand
- **Tree shaking** — Removes unused exports from bundles
- **CSS code splitting** — CSS is extracted per async chunk
- **Asset hashing** — Files include content hash for cache busting
- **Minification** — esbuild minifies JavaScript, CSS is minified with Lightning CSS

\`\`\`ts
build: {
  target: 'ES2022',      // Modern browsers only
  minify: 'esbuild',     // Fast minification
  sourcemap: true,        // Debug production issues
  rollupOptions: {
    output: {
      manualChunks: {
        vendor: ['react', 'react-dom'],
      },
    },
  },
},
\`\`\`

## Vite 6 Environment API

Vite 6 introduced the **Environment API**:
- Allows different configuration for different build targets (client, server, SSR)
- Enables frameworks to configure Vite for server-side and client-side builds differently
- Foundation for universal Vite features (Remix, Astro, SvelteKit integration)

The project uses **@vitejs/plugin-react** (v4.3) which uses esbuild for Fast Refresh during development.`,
  },

  {
    title: 'Vitest 3 Testing Framework Workspace and Coverage',
    url: 'https://vitest.dev/guide/',
    content: `# Vitest 3 — Testing Framework

## Vitest 3 vs Jest — Why Vitest

**Vitest** (version 3.0) is chosen over Jest:

1. **Vite-native** — Uses Vite's transform pipeline, so TypeScript, JSX, and ESM work without extra config. Jest requires ts-jest or @swc/jest.
2. **ESM-first** — Native ES module support. Jest still has issues with ESM imports.
3. **HMR for tests** — Tests re-run instantly on file changes (like Vite's HMR for components).
4. **Compatible API** — Same \`describe\`, \`it\`, \`expect\` API as Jest. Migration is nearly zero-effort.
5. **Workspace support** — Run tests across multiple packages in a monorepo with one config.
6. **Faster** — Uses esbuild for transforms, worker threads for parallelism.
7. **Built-in coverage** — Uses v8 or istanbul for coverage reporting.
8. **Browser mode** — Can run tests in a real browser (via Playwright or WebDriverIO).

## Vitest 3 Workspace Configuration for Monorepo

The project uses Vitest workspaces to test all packages:

\`\`\`ts
// vitest.workspace.ts (root)
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/core/vitest.config.ts',
  'packages/runtime/vitest.config.ts',
]);
\`\`\`

Each package has its own Vitest config:
\`\`\`ts
// packages/core/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
});
\`\`\`

Run tests across the entire workspace:
\`\`\`bash
pnpm test              # Run all tests
pnpm -r test           # Run tests in each package
vitest run             # Single run (CI mode)
vitest watch           # Watch mode (development)
vitest --coverage      # With coverage report
\`\`\`

## Testing Strategies with Vitest

The project uses multiple testing levels:

1. **Unit tests** — Test individual functions and modules in isolation
   - \`chat-service.test.ts\` — Tests chat message handling
   - \`model-registry.test.ts\` — Tests model registration and lookup
   - \`tool-registry.test.ts\` — Tests tool registration

2. **Integration tests** — Test modules working together
   - \`vai-engine.test.ts\` — Tests the VAI engine end-to-end
   - \`ingest-pipeline.test.ts\` — Tests the ingestion pipeline
   - \`db.test.ts\` — Tests database operations with real SQLite

3. **E2E tests** — Test the full system via HTTP API
   - \`e2e.test.ts\` — 22 end-to-end tests through the Fastify server

Test files are in \`__tests__/\` directories within each package, following the convention \`*.test.ts\`.

## Vitest Coverage Configuration

\`\`\`ts
test: {
  coverage: {
    provider: 'v8',        // Fast, native coverage
    reporter: ['text', 'json', 'html'],
    include: ['src/**/*.ts'],
    exclude: ['**/*.test.ts', '**/*.d.ts'],
  },
},
\`\`\``,
  },

  {
    title: 'WebSocket Security Authentication and Real-Time Chat Architecture',
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API',
    content: `# WebSocket Security and Real-Time Chat Architecture

## WebSocket Security Best Practices

The project uses **@fastify/websocket** (version 11) for real-time chat. Key security considerations:

1. **Use WSS (WebSocket Secure)** — Always use \`wss://\` in production (WebSocket over TLS). In development, \`ws://\` is acceptable for localhost.

2. **Authentication before upgrade** — Validate the user's identity BEFORE upgrading to WebSocket:
\`\`\`ts
app.get('/ws', { websocket: true }, (socket, request) => {
  // Validate auth token from query string or cookie
  const token = request.query.token;
  if (!validateToken(token)) {
    socket.close(4001, 'Unauthorized');
    return;
  }
  // Proceed with authenticated connection
});
\`\`\`

3. **Rate limiting** — Limit message frequency per connection to prevent abuse:
\`\`\`ts
let messageCount = 0;
const resetInterval = setInterval(() => { messageCount = 0 }, 60000);
socket.on('message', (data) => {
  if (++messageCount > 30) { // Max 30 messages per minute
    socket.close(4029, 'Rate limited');
    return;
  }
  // Process message
});
\`\`\`

4. **Input validation** — Validate ALL incoming WebSocket messages with schemas
5. **Connection limits** — Limit total concurrent connections per user
6. **Heartbeat/ping-pong** — Detect and clean up dead connections
7. **Message size limits** — Set maximum payload size to prevent memory exhaustion

## WebSocket Authentication Patterns

Three common patterns for authenticating WebSocket connections:

1. **Token in query parameter**: \`ws://host/chat?token=jwt_here\`
   - Simple but token visible in logs
   - Token should be short-lived

2. **Cookie-based**: WebSocket upgrade request includes cookies automatically
   - Works when frontend and backend are same origin
   - Subject to CSRF considerations

3. **First-message auth**: Connect first, send auth token as first message
   - Most flexible, works across origins
   - Must handle unauthenticated state

## Real-Time Chat Architecture

The VAI chat architecture uses WebSockets for streaming responses:

\`\`\`
Client (React) → WebSocket → Fastify Server → VaiEngine
                                    ↓
Client (React) ← WebSocket ← Stream Response ← Pattern Match
\`\`\`

1. Client opens WebSocket connection to \`/api/chat\`
2. Client sends message as JSON: \`{ content: "question", conversationId: "..." }\`
3. Server processes through VaiEngine (TF-IDF + knowledge matching)
4. Server streams response back token-by-token via WebSocket
5. Client renders tokens as they arrive (Markdown rendering with react-markdown)

Also supports HTTP fallback:
- \`POST /api/conversations/:id/messages\` — Send message, get complete response
- \`POST /api/chat/completions\` — OpenAI-compatible chat API

## @fastify/websocket Integration

\`\`\`ts
import websocket from '@fastify/websocket';

await app.register(websocket);

app.get('/api/chat', { websocket: true }, (connection, request) => {
  connection.on('message', async (message) => {
    const data = JSON.parse(message.toString());
    // Process and respond
    connection.send(JSON.stringify({ type: 'token', content: '...' }));
  });
});
\`\`\``,
  },

  {
    title: 'TypeScript 5.7 Strict Mode and Modern Configuration',
    url: 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html',
    content: `# TypeScript 5.7 — Strict Mode and Configuration

## TypeScript 5.7 Features

**TypeScript** (version 5.7) is used across the entire monorepo with these key features:

1. **Strict mode** — \`"strict": true\` enables all strict type-checking options:
   - \`strictNullChecks\` — Forces handling of null/undefined
   - \`strictFunctionTypes\` — Contravariant function parameter checking
   - \`strictBindCallApply\` — Stricter bind, call, and apply
   - \`noImplicitAny\` — No implicit \`any\` types
   - \`noImplicitThis\` — Errors when \`this\` is implicitly \`any\`

2. **ES2022 target** — Emits modern JavaScript with class fields, top-level await, and \`Array.at()\`
3. **ESNext module** — Modern module system with full ESM support
4. **Bundler module resolution** — \`"moduleResolution": "bundler"\` — designed for Vite, esbuild, and other modern bundlers

## TypeScript Configuration for Monorepo

The project uses a shared base configuration:

\`\`\`json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx"
  }
}
\`\`\`

Each package extends this:
\`\`\`json
// packages/core/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
\`\`\`

## TypeScript Best Practices Used in This Project

1. **Zod for runtime validation** — TypeScript types are compile-time only. Use Zod (v3.24) for runtime validation of API inputs:
\`\`\`ts
import { z } from 'zod';
const MessageSchema = z.object({
  content: z.string().min(1),
  role: z.enum(['user', 'assistant']),
});
type Message = z.infer<typeof MessageSchema>; // Type from schema
\`\`\`

2. **Discriminated unions** for type-safe error handling:
\`\`\`ts
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
\`\`\`

3. **Branded types** for IDs:
\`\`\`ts
type ConversationId = string & { __brand: 'ConversationId' };
\`\`\`

4. **\`satisfies\`** operator for type validation without widening:
\`\`\`ts
const config = { port: 3006, host: 'localhost' } satisfies ServerConfig;
\`\`\``,
  },

  {
    title: 'Project Technology Stack Versions and Package Configuration',
    url: 'https://github.com/user/vai-project',
    content: `# Project Technology Stack — Package Versions

## Frontend Technology Versions

The desktop application (apps/desktop/) uses:
- **React** ^19.0.0 — Latest stable, with use() hook, ref as prop, useActionState
- **react-dom** ^19.0.0 — React DOM renderer
- **Zustand** ^5.0.0 — State management (stores: chatStore, engineStore, settingsStore)
- **react-markdown** ^9.0.0 — Markdown rendering for chat messages
- **Tailwind CSS** ^3.4.0 — Utility-first CSS framework
- **PostCSS** ^8.5.0 — CSS processing
- **autoprefixer** ^10.4.0 — Vendor prefix handling

Build tools for frontend:
- **Vite** ^6.0.0 — Dev server and build tool
- **@vitejs/plugin-react** ^4.3.0 — React Fast Refresh for Vite
- **TypeScript** ^5.7.0 — Type safety across all packages

## Backend Technology Versions

The runtime server (packages/runtime/) uses:
- **Fastify** ^5.2.0 — High-performance web framework
- **@fastify/cors** ^10.0.0 — CORS middleware
- **@fastify/websocket** ^11.0.0 — WebSocket support
- **dotenv** ^16.4.0 — Environment variable loading
- **tsx** ^4.19.0 — TypeScript execution for development
- **esbuild** ^0.27.3 — JavaScript/TypeScript bundler

The core package (packages/core/) uses:
- **Drizzle ORM** ^0.38.0 — TypeScript-first SQL ORM
- **drizzle-kit** ^0.30.0 — Migration tooling
- **better-sqlite3** ^11.8.0 — Synchronous SQLite driver
- **ulid** ^2.3.0 — Universally Unique Lexicographically Sortable Identifiers
- **Zod** ^3.24.0 — Runtime schema validation

## Desktop Application Versions

The Tauri desktop app (apps/desktop/src-tauri/) uses:
- **Tauri** 2 — Desktop application framework (Rust-based)
- **tauri-plugin-shell** 2 — Shell command execution plugin
- **serde** 1 — Rust serialization (with derive feature)
- **Rust edition** 2021 — Modern Rust language features

Release build profile: strip = true, lto = true, codegen-units = 1, panic = "abort"

## Browser Extension Versions

The browser extension (apps/extension/) uses:
- **wxt** ^0.20.0 — Browser extension framework (built on Vite)
- **React** ^19.0.0 — Same React version as desktop
- **Tailwind CSS** ^3.4.0 — Same styles as desktop

## Developer Tooling Versions

Root monorepo tooling:
- **TypeScript** ^5.7.0 — Strict mode, ES2022 target, bundler resolution
- **Vitest** ^3.0.0 — Testing framework with workspace support
- **ESLint** ^10.0.2 — Code linting
- **concurrently** ^9.2.1 — Run multiple scripts in parallel
- **pnpm** — Package manager with workspace support

TSConfig: target ES2022, module ESNext, moduleResolution bundler, strict true, jsx react-jsx

## Why These Specific Versions

- React 19: Latest stable, no longer need forwardRef, use() hook, Server Components
- Fastify 5: Performance, plugin system, TypeBox validation
- Tauri 2: Mobile support, smaller binaries, better security model
- Zustand 5: Minimal boilerplate, TypeScript-first, tiny bundle
- Vite 6: Instant HMR, Environment API, esbuild transforms
- Drizzle 0.38: Type-safe SQL, no decorators, lightweight
- Vitest 3: Vite-native testing, workspace support, fast
- TypeScript 5.7: Latest strictness features, bundler resolution`,
  },

  {
    title: 'Error Handling Patterns in TypeScript and React',
    url: 'https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary',
    content: `# Error Handling Patterns in TypeScript and React

## React Error Boundaries

**Error Boundaries** catch JavaScript errors during rendering, in lifecycle methods, and in constructors of the whole tree below them:

\`\`\`tsx
import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error boundary caught:', error, info.componentStack);
    // Send to error reporting service
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

// Usage
<ErrorBoundary fallback={<div>Something went wrong</div>}>
  <ChatWindow />
</ErrorBoundary>
\`\`\`

Error boundaries do NOT catch errors in event handlers, async code, or server-side rendering. For those, use try/catch.

## Result Type Pattern for TypeScript

Instead of throwing exceptions, use a discriminated union Result type:

\`\`\`ts
type Result<T, E = Error> =
  | { ok: true; data: T }
  | { ok: false; error: E };

async function fetchUser(id: string): Promise<Result<User>> {
  try {
    const user = await db.select().from(users).where(eq(users.id, id)).get();
    if (!user) return { ok: false, error: new Error('User not found') };
    return { ok: true, data: user };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

// Usage — forces error handling
const result = await fetchUser('123');
if (!result.ok) {
  console.error(result.error);
  return;
}
console.log(result.data.name); // Type-safe access
\`\`\`

## API Error Handling in Fastify

Fastify provides structured error handling:

\`\`\`ts
// Custom error handler
app.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode ?? 500;
  reply.status(statusCode).send({
    error: error.name,
    message: error.message,
    statusCode,
  });
});

// Schema validation errors return 400 automatically
// Unhandled promise rejections return 500

// Route-level error handling
app.post('/api/chat', async (request, reply) => {
  try {
    const response = await chatService.process(request.body);
    return response;
  } catch (error) {
    request.log.error(error);
    reply.status(500).send({ error: 'Internal server error' });
  }
});
\`\`\`

## Async Error Handling Best Practices

1. **Always use try/catch with async/await** — unhandled rejections crash Node.js
2. **Validate inputs early** — use Zod to parse and validate before processing
3. **Use AbortSignal for timeouts** — \`AbortSignal.timeout(30000)\` for fetch requests
4. **Log errors with context** — include request ID, user ID, and stack trace
5. **Fail fast, fail loudly** — don't silently swallow errors
6. **Graceful degradation** — show fallback UI when non-critical features fail`,
  },

  {
    title: 'Performance Optimization in React and Vite Applications',
    url: 'https://react.dev/reference/react/memo',
    content: `# Performance Optimization in React and Vite

## React Performance Optimization Techniques

1. **React.memo** — Skip re-rendering when props haven't changed:
\`\`\`tsx
const MessageBubble = React.memo(function MessageBubble({ message }: Props) {
  return <div className="p-3 rounded-lg">{message.content}</div>;
});
\`\`\`

2. **useMemo** — Memoize expensive computations:
\`\`\`tsx
const filteredMessages = useMemo(
  () => messages.filter(m => m.content.includes(searchTerm)),
  [messages, searchTerm]
);
\`\`\`

3. **useCallback** — Memoize callback functions to prevent child re-renders:
\`\`\`tsx
const handleSend = useCallback((content: string) => {
  chatStore.addMessage({ role: 'user', content });
}, []);
\`\`\`

4. **Zustand selectors** — Only subscribe to needed state:
\`\`\`tsx
// ✅ Only re-renders when messages change
const messages = useChatStore(state => state.messages);

// ❌ Re-renders on ANY store change
const store = useChatStore();
\`\`\`

## Code Splitting and Lazy Loading

\`\`\`tsx
import { lazy, Suspense } from 'react';

// Lazy load heavy components
const KnowledgePanel = lazy(() => import('./components/KnowledgePanel'));
const MarkdownRenderer = lazy(() => import('@vai/ui').then(m => ({ default: m.MarkdownRenderer })));

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <KnowledgePanel />
    </Suspense>
  );
}
\`\`\`

Vite automatically code-splits on dynamic \`import()\`, creating separate chunks loaded on demand.

## Bundle Size Optimization with Vite

1. **Tree shaking** — Vite/Rollup removes unused exports. Use named imports:
\`\`\`ts
// ✅ Tree-shakeable
import { eq, and } from 'drizzle-orm';

// ❌ Imports everything
import * as drizzle from 'drizzle-orm';
\`\`\`

2. **Manual chunks** — Split vendor code for better caching:
\`\`\`ts
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        vendor: ['react', 'react-dom'],
        markdown: ['react-markdown', 'remark-gfm'],
      },
    },
  },
},
\`\`\`

3. **Compression** — Use \`vite-plugin-compression\` for gzip/brotli
4. **Image optimization** — Use WebP/AVIF, lazy load images

## Measuring Performance

- **React DevTools Profiler** — Identify slow components and unnecessary re-renders
- **Lighthouse** — Overall web performance audit
- **\`React.Profiler\` component** — Programmatic performance measurement
- **Bundle analyzer** — \`rollup-plugin-visualizer\` to visualize bundle composition
- **Web Vitals** — Track LCP, FID, CLS metrics`,
  },

  {
    title: 'wxt Browser Extension Framework for Chrome and Firefox',
    url: 'https://wxt.dev/guide/installation.html',
    content: `# wxt — Browser Extension Framework

## What is wxt and How It Works

**wxt** (version 0.20) is a modern browser extension framework built on Vite:

1. **File-based entrypoints** — Automatically generates the extension manifest from file names:
   - \`src/entrypoints/background.ts\` → Background service worker
   - \`src/entrypoints/popup/\` → Extension popup UI
   - \`src/entrypoints/youtube.content.ts\` → YouTube content script
   - \`src/entrypoints/google-search.content.ts\` → Google Search content script

2. **Auto-imports** — Common browser extension APIs are auto-imported
3. **HMR in development** — Hot reload for content scripts and popup
4. **Cross-browser** — Build for Chrome, Firefox, Safari, Edge from one codebase
5. **TypeScript-first** — Full TypeScript support with type-safe APIs
6. **Vite-powered** — Uses Vite for bundling, same ecosystem as the main app

## Browser Extension Architecture

The extension has multiple entrypoints:

- **Background script** (\`background.ts\`) — Runs persistently, handles events, manages state
- **Content scripts** — Injected into web pages:
  - \`youtube.content.ts\` — Enhances YouTube pages
  - \`github.content.ts\` — Enhances GitHub pages
  - \`google-search.content.ts\` — Enhances Google search results
- **Popup** (\`popup/\`) — UI shown when clicking the extension icon (React + Tailwind)

Content scripts use the Chrome Extension API to:
- Access the page DOM
- Communicate with the background script via \`browser.runtime.sendMessage()\`
- Inject UI elements into existing web pages

## Extension Privacy and Security

Browser extensions have access to sensitive user data. Security measures:

1. **Minimal permissions** — Only request permissions the extension actually needs
2. **Content script isolation** — Content scripts run in an isolated world by default
3. **CSP for popup** — Strict Content Security Policy for the popup UI
4. **No remote code execution** — Never fetch and execute JavaScript from remote servers
5. **Privacy module** (\`lib/privacy.ts\`) — Handles user data with explicit consent
6. **Manifest V3** — Uses the modern extension manifest format

## wxt Configuration

\`\`\`ts
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: ['activeTab', 'storage'],
    host_permissions: ['https://github.com/*', 'https://www.youtube.com/*'],
  },
});
\`\`\``,
  },

  {
    title: 'Rate Limiting and DDoS Protection for Web APIs',
    url: 'https://owasp.org/www-community/controls/Blocking_Brute_Force_Attacks',
    content: `# Rate Limiting and DDoS Protection

## Why Rate Limiting Is Essential

Rate limiting protects your API from:
- **Brute force attacks** — Automated password guessing
- **DDoS attacks** — Overwhelming the server with requests
- **Resource exhaustion** — Preventing one client from consuming all resources
- **Scraping** — Automated content extraction
- **API abuse** — Exceeding intended usage patterns

## Rate Limiting Strategies

### Fixed Window
Count requests in fixed time windows (e.g., 100 requests per minute per IP):
\`\`\`ts
// @fastify/rate-limit plugin
import rateLimit from '@fastify/rate-limit';

await app.register(rateLimit, {
  max: 100,           // 100 requests
  timeWindow: '1 minute',
  keyGenerator: (request) => request.ip,
});
\`\`\`

### Sliding Window
Smoother than fixed window — counts requests in a rolling time period.

### Token Bucket
Allows burst traffic up to a limit, then enforces a steady rate.

## Rate Limiting in Fastify

Using **@fastify/rate-limit**:
\`\`\`ts
// Global rate limit
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// Route-specific rate limit
app.post('/api/auth/login', {
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  handler: loginHandler,
});
\`\`\`

## DDoS Protection Best Practices

1. **Use a reverse proxy** — nginx, Cloudflare, or AWS WAF in front of your application
2. **Set request body limits** — Fastify's \`bodyLimit\` option prevents large payload attacks
3. **Connection timeouts** — Set aggressive timeouts for idle connections
4. **IP allowlisting/blocklisting** — Block known malicious IPs
5. **CAPTCHA for sensitive endpoints** — Prevent automated form submissions
6. **Circuit breaker pattern** — Stop forwarding requests when a downstream service is overwhelmed

## WebSocket Rate Limiting

WebSocket connections bypass HTTP rate limiters. Implement per-connection rate limiting:
- Track messages per connection per time window
- Disconnect clients that exceed the limit
- Use heartbeat/ping-pong to detect and clean up idle connections
- Set maximum concurrent connection limits per IP`,
  },

  {
    title: 'SSRF Server-Side Request Forgery Prevention',
    url: 'https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/',
    content: `# SSRF (Server-Side Request Forgery) Prevention

## What is SSRF

**Server-Side Request Forgery (SSRF)** is an attack where the attacker makes the server send requests to unintended destinations. This is A10 in the OWASP Top 10 2021 (new entry).

Example: A web app has a feature to fetch a URL preview:
\`\`\`
POST /api/fetch-preview
{ "url": "http://169.254.169.254/latest/meta-data/" }
\`\`\`
If the server doesn't validate the URL, it fetches AWS instance metadata, exposing credentials and secrets.

## SSRF Prevention Best Practices

1. **URL allowlisting** — Only allow requests to known, whitelisted domains:
\`\`\`ts
const ALLOWED_DOMAINS = ['github.com', 'api.github.com', 'youtube.com'];
function isAllowedUrl(url: string): boolean {
  const parsed = new URL(url);
  return ALLOWED_DOMAINS.includes(parsed.hostname);
}
\`\`\`

2. **Block internal IPs** — Reject requests to private IP ranges:
   - 10.0.0.0/8
   - 172.16.0.0/12
   - 192.168.0.0/16
   - 127.0.0.0/8 (localhost)
   - 169.254.0.0/16 (link-local, AWS metadata)
   - ::1 (IPv6 localhost)

3. **DNS rebinding protection** — Resolve DNS before making the request and verify the IP
4. **Disable HTTP redirects** — Or validate each redirect destination
5. **Use a proxy** — Route outbound requests through a restricted proxy
6. **Network segmentation** — The application server shouldn't have direct access to internal services

## SSRF in the VAI Ingestion Pipeline

The VAI ingestion pipeline fetches URLs for content ingestion (GitHub repos, web pages, YouTube). This is a potential SSRF vector:

\`\`\`ts
// packages/core/src/ingest/web.ts — must validate URLs
// Only allow known sources
const ALLOWED_PATTERNS = [
  /^https:\/\/github\.com\//,
  /^https:\/\/www\.youtube\.com\//,
  /^https:\/\/raw\.githubusercontent\.com\//,
];

function validateIngestUrl(url: string): boolean {
  return ALLOWED_PATTERNS.some(pattern => pattern.test(url));
}
\`\`\`

Always validate and sanitize URLs before the server fetches them, especially in ingestion or preview features.`,
  },

  // ═══════════════════════════════════════════════════════════════
  //  TARGETED FIX ENTRIES — match failing question patterns
  // ═══════════════════════════════════════════════════════════════

  {
    title: 'Which OWASP Top 10 Risks Are Most Relevant to React Fastify Tauri Application',
    url: 'https://owasp.org/Top10/',
    content: `# OWASP Top 10 Risks Most Relevant to React Fastify Tauri

## Broken Access Control in React Fastify Tauri Apps

**Broken Access Control** (A01:2021) is the #1 OWASP risk. In a React + Fastify + Tauri application:
- API endpoints must validate authorization, not just authentication
- Fastify routes must check user roles before returning data
- Use role-based access control (RBAC) on every API endpoint
- Tauri IPC commands must verify the caller's permissions

## Injection and XSS Risks

**Injection** (A03:2021) includes SQL injection and Cross-Site Scripting (XSS):
- React escapes JSX output by default, preventing most XSS
- Never use \`dangerouslySetInnerHTML\` with unsanitized input
- Drizzle ORM uses parameterized queries, preventing SQL injection
- Always validate user input with Zod on the Fastify backend

## Other Relevant OWASP Risks

- **Security Misconfiguration** (A05): Configure CORS properly in @fastify/cors, set security headers, disable verbose errors
- **Vulnerable Components** (A06): Run \`pnpm audit\` regularly, keep React 19, Fastify 5, and Tauri 2 updated
- **SSRF** (A10): The ingestion pipeline fetches URLs — validate and whitelist allowed destinations
- **Cryptographic Failures** (A02): Use HTTPS/WSS in production, hash passwords with bcrypt, never store secrets in code`,
  },

  {
    title: 'What is dangerouslySetInnerHTML in React When Should It Be Used Safely',
    url: 'https://react.dev/reference/react-dom/components/common',
    content: `# dangerouslySetInnerHTML in React — Risks and Safe Usage

## What is dangerouslySetInnerHTML

\`dangerouslySetInnerHTML\` is a React prop that sets raw HTML on a DOM element, bypassing React's automatic XSS escaping. It is the React equivalent of \`innerHTML\`. The name is intentionally scary because it can introduce Cross-Site Scripting vulnerabilities.

\`\`\`tsx
// What dangerouslySetInnerHTML does
<div dangerouslySetInnerHTML={{ __html: htmlContent }} />
\`\`\`

## How to Sanitize dangerouslySetInnerHTML Safely

**Never pass unsanitized user input** to dangerouslySetInnerHTML. Always sanitize with DOMPurify:

\`\`\`tsx
import DOMPurify from 'dompurify';

// ✅ SAFE — sanitize HTML before rendering
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />

// ❌ DANGEROUS — raw user input enables XSS attacks
<div dangerouslySetInnerHTML={{ __html: userContent }} />
\`\`\`

Safe alternatives:
- **react-markdown** (v9) — Renders Markdown without using innerHTML, safe by default
- **DOMPurify** — Sanitizes HTML, strips malicious scripts and attributes
- **Server-side sanitization** — Always sanitize on the backend before storing

Only use dangerouslySetInnerHTML when you have trusted, sanitized HTML content (e.g., from your own CMS after server-side sanitization).`,
  },

  {
    title: 'How to Protect Against CSRF Attacks in Single-Page Application',
    url: 'https://owasp.org/www-community/attacks/csrf',
    content: `# CSRF Protection in Single-Page Applications

## CSRF Attack in SPA Context

**CSRF** (Cross-Site Request Forgery) tricks a user's browser into making unwanted requests using their existing session. In a Single-Page Application with an API backend:

The primary defense is the **SameSite cookie attribute**:
- \`SameSite=Lax\` (recommended default) — Cookies sent for same-site requests and top-level GET navigations, but NOT for cross-site POST/PUT/DELETE
- \`SameSite=Strict\` — Cookies only sent for same-site requests (maximum CSRF protection)

## SameSite Cookies and CSRF Tokens

\`\`\`ts
// Setting SameSite cookies in Fastify
reply.setCookie('session', token, {
  httpOnly: true,    // Prevents JavaScript access
  secure: true,      // HTTPS only
  sameSite: 'lax',   // CSRF protection
  path: '/',
});
\`\`\`

Additional CSRF protections for SPAs:
1. **JSON Content-Type** — Browsers block cross-origin JSON POST without CORS approval
2. **CORS validation** — Only allow your own origin via @fastify/cors
3. **Origin/Referer header checking** — Verify the request came from your domain
4. **JWT in Authorization header** — Tokens in headers (not cookies) are not vulnerable to CSRF
5. **CSRF tokens** — Include a random token in requests, verify server-side

For the VAI desktop app (Tauri), CSRF is less of a concern because the app doesn't use browser cookies — API calls use fetch() from the Tauri WebView.`,
  },

  {
    title: 'How to Secure WebSocket Connections Authentication and Rate Limiting',
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API',
    content: `# Securing WebSocket Connections

## WebSocket Authentication Methods

WebSocket authentication should happen BEFORE the connection upgrade:

1. **Token-based authentication** — Pass a JWT or session token in the connection URL or first message:
\`\`\`ts
app.get('/ws', { websocket: true }, (socket, request) => {
  const token = request.query.token;
  if (!validateToken(token)) {
    socket.close(4001, 'Unauthorized');
    return;
  }
  // Connection is now authenticated
});
\`\`\`

2. **Cookie-based authentication** — The WebSocket upgrade request includes cookies automatically
3. **First-message authentication** — Client sends authentication credentials as the first WebSocket message

## WebSocket Rate Limiting and Security

Rate limiting prevents abuse of WebSocket connections:
\`\`\`ts
let msgCount = 0;
setInterval(() => { msgCount = 0 }, 60000);
socket.on('message', (data) => {
  if (++msgCount > 30) {
    socket.close(4029, 'Rate limited');
    return;
  }
});
\`\`\`

Additional security measures:
- Use **WSS** (WebSocket Secure) over TLS in production
- **Validate all incoming messages** with schemas (Zod)
- Set **maximum payload size** limits
- Implement **heartbeat/ping-pong** to detect dead connections
- Limit **concurrent connections** per IP address
- The project uses **@fastify/websocket** (v11) for WebSocket support`,
  },

  {
    title: 'Content Security Policy CSP Prevents XSS Configured in Tauri',
    url: 'https://owasp.org/www-project-secure-headers/',
    content: `# Content Security Policy (CSP) — XSS Prevention and Tauri Configuration

## How Content Security Policy Prevents XSS

**Content Security Policy (CSP)** is a security header that prevents XSS (Cross-Site Scripting) and other code injection attacks by controlling which sources of content are allowed to load:

\`\`\`
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:;
\`\`\`

CSP prevents XSS because:
1. **Blocks inline scripts** — \`script-src 'self'\` prevents \`<script>alert('xss')</script>\` from executing
2. **Blocks eval()** — Prevents dynamic code execution
3. **Restricts script sources** — Only allows scripts from whitelisted origins
4. **Reports violations** — \`report-uri\` sends violation reports to your server

## Content Security Policy in Tauri 2

Tauri 2 configures CSP in \`tauri.conf.json\`:

\`\`\`json
{
  "security": {
    "csp": "default-src 'self'; connect-src 'self' http://localhost:3006 ws://localhost:3006"
  }
}
\`\`\`

Tauri's CSP is stricter than web browsers by default:
- Only allows loading resources from the app bundle (\`'self'\`  = \`tauri://\` and \`asset://\`)
- External connections must be explicitly allowed
- This prevents XSS payloads from loading external malicious scripts

Key CSP directives:
- \`default-src\` — Fallback for all resource types
- \`script-src\` — Controls JavaScript loading (most important for XSS)
- \`connect-src\` — Controls fetch/XHR/WebSocket destinations
- \`frame-ancestors\` — Prevents clickjacking (replaces X-Frame-Options)`,
  },

  {
    title: 'How to Test Application with Vitest Testing Strategy',
    url: 'https://vitest.dev/guide/',
    content: `# Testing with Vitest — Strategy and Configuration

## Vitest Testing Strategy

**Vitest** (version 3.0) is the testing framework used across the entire monorepo. The testing strategy uses multiple levels:

1. **Unit tests with Vitest** — Test individual functions in isolation:
   - \`chat-service.test.ts\` — Tests chat message handling with Vitest
   - \`model-registry.test.ts\` — Tests model registration with Vitest
   - \`vai-engine.test.ts\` — Tests the VAI engine with Vitest

2. **Integration tests with Vitest** — Test modules working together:
   - \`ingest-pipeline.test.ts\` — Tests ingestion pipeline with Vitest
   - \`db.test.ts\` — Tests database operations with Vitest

3. **E2E tests with Vitest** — Full system tests through HTTP API:
   - \`e2e.test.ts\` — 22 end-to-end tests through the Fastify server with Vitest

## Why Vitest Over Jest

Vitest is chosen because:
- **Vite-native** — Uses the same Vite transform pipeline, no extra config needed
- **ESM-first** — Native ES module support (Jest struggles with ESM)
- **Jest-compatible API** — Same \`describe\`, \`it\`, \`expect\` syntax
- **Workspace support** — Tests across all monorepo packages with one config
- **Faster** — esbuild transforms + worker threads for parallelism
- **Built-in coverage** — v8 coverage provider, no extra setup

## Vitest Workspace Configuration

\`\`\`ts
// vitest.workspace.ts
export default defineWorkspace([
  'packages/core/vitest.config.ts',
  'packages/runtime/vitest.config.ts',
]);
\`\`\`

Run Vitest tests: \`pnpm test\` (all packages), \`vitest run\` (single run), \`vitest --coverage\` (with coverage)`,
  },

  {
    title: 'Handle Errors in React and Fastify Application Error Patterns',
    url: 'https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary',
    content: `# How to Handle Errors in React and Fastify

## Error Boundaries in React

React **Error Boundaries** catch JavaScript errors during rendering and display a fallback UI instead of crashing:

\`\`\`tsx
class ErrorBoundary extends Component<Props, { hasError: boolean }> {
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error boundary caught:', error);
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

// Usage — catches rendering errors in ChatWindow
<ErrorBoundary fallback={<div>Something went wrong</div>}>
  <ChatWindow />
</ErrorBoundary>
\`\`\`

Error boundaries do NOT catch errors in event handlers or async code — use try/catch for those.

## Error Handling in Fastify

Fastify handles errors with a custom error handler:

\`\`\`ts
app.setErrorHandler((error, request, reply) => {
  reply.status(error.statusCode ?? 500).send({
    error: error.name,
    message: error.message,
  });
});
\`\`\`

- Schema validation errors automatically return 400
- Unhandled errors return 500
- Use try/catch in async route handlers

## Error Handling Best Practices

- Use **Result pattern** (\`{ ok: true, data } | { ok: false, error }\`) for type-safe error handling in TypeScript
- Use **Zod validation** to parse and validate input before processing
- Use **AbortSignal.timeout()** for fetch request timeouts
- Log errors with context (request ID, stack trace)
- Implement **graceful degradation** — show fallback UI for non-critical errors`,
  },

  {
    title: 'React Performance Optimization with memo useMemo useCallback Lazy Loading',
    url: 'https://react.dev/reference/react/memo',
    content: `# React Performance Optimization

## React.memo for Component Memoization

**React.memo** skips re-rendering a component when props haven't changed:

\`\`\`tsx
const MessageBubble = React.memo(function MessageBubble({ message }: Props) {
  return <div className="p-3 rounded-lg">{message.content}</div>;
});
\`\`\`

## useMemo and useCallback Hooks

**useMemo** memoizes expensive computations:
\`\`\`tsx
const filtered = useMemo(() => messages.filter(m => m.includes(search)), [messages, search]);
\`\`\`

**useCallback** memoizes functions to prevent child re-renders:
\`\`\`tsx
const handleSend = useCallback((msg: string) => addMessage(msg), []);
\`\`\`

## Lazy Loading and Code Splitting

\`\`\`tsx
const KnowledgePanel = lazy(() => import('./KnowledgePanel'));
<Suspense fallback={<Loading />}><KnowledgePanel /></Suspense>
\`\`\`

## Zustand Selectors for Performance

Use selectors to avoid unnecessary re-renders:
\`\`\`tsx
// ✅ Only re-renders when messages change
const messages = useChatStore(state => state.messages);
// ❌ Re-renders on any store change  
const store = useChatStore();
\`\`\`

## Bundle Optimization with Vite

- **Tree shaking** removes unused imports
- **Manual chunks** split vendor code for caching
- **React.memo + useMemo + useCallback** reduce rendering overhead
- Use named imports for tree-shaking: \`import { eq } from 'drizzle-orm'\``,
  },

  {
    title: 'What Version of React Are You Using Key Features of React 19',
    url: 'https://react.dev/blog/2024/12/05/react-19',
    content: `# React Version — React 19.0.0

## React 19 Version and Key Features

The project uses **React 19** (^19.0.0) and **react-dom 19** (^19.0.0). React 19 is the latest stable version, released December 2024.

Key features of React 19:
- **use() hook** — Read promises and context during render, can be used in conditionals
- **ref as a prop** — Function components receive ref as a regular prop, no more forwardRef needed
- **useActionState** — New hook replacing useFormState for form handling with pending state
- **useOptimistic** — Optimistic UI updates during async operations
- **Server Components** — Stable server-side rendering with zero client JS
- **\`<Context>\` as provider** — Use \`<ThemeContext value={theme}>\` directly
- **Document metadata** — Render \`<title>\`, \`<meta>\`, \`<link>\` in components
- **Ref cleanup functions** — Return cleanup from ref callbacks

React 19 eliminates the need for forwardRef in most cases, simplifies form handling with useActionState, and makes the use() hook available for reading resources during render.`,
  },

  {
    title: 'What Version of Fastify Does the Project Use Fastify 5',
    url: 'https://fastify.dev/docs/latest/',
    content: `# Fastify Version — Fastify 5.2.0

## Fastify 5 Version and Key Features

The project uses **Fastify 5** (^5.2.0). Fastify 5 is a high-performance Node.js web framework.

Key features of Fastify 5:
- **Performance** — 2-3x faster than Express, uses radix tree routing
- **Plugin system** — Encapsulated plugins with dependency injection
- **Schema validation** — Built-in JSON Schema / TypeBox validation
- **TypeScript-first** — Excellent generic typing for routes
- **Lifecycle hooks** — onRequest, preHandler, onSend, onResponse, onError
- **Built-in Pino logger** — High-performance structured JSON logging
- **Modern Node.js** — Requires Node.js 20+ for full ESM support

Fastify plugins used in this project:
- **@fastify/cors** (v10) — CORS handling
- **@fastify/websocket** (v11) — WebSocket support for real-time chat

Fastify 5 is chosen over Express because of its superior performance, built-in schema validation, proper plugin encapsulation, and native TypeScript support.`,
  },

  {
    title: 'What TypeScript Version Configuration Target Does Project Use TypeScript 5.7',
    url: 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html',
    content: `# TypeScript Version — TypeScript 5.7.0

## TypeScript 5.7 Configuration

The project uses **TypeScript 5.7** (^5.7.0) with strict mode enabled across the entire monorepo.

TypeScript 5.7 configuration in tsconfig.base.json:
- **target**: ES2022 — Modern JavaScript with class fields, top-level await
- **module**: ESNext — Modern ES module system
- **moduleResolution**: bundler — Designed for Vite, esbuild, and modern bundlers
- **strict**: true — Enables all strict type-checking:
  - strictNullChecks, noImplicitAny, strictFunctionTypes
  - strictBindCallApply, noImplicitThis

TypeScript 5.7 is the latest stable version, providing:
- Better type inference for TypeBox and Zod schemas
- Support for ES2022+ features
- Bundler-style module resolution (resolves correctly with Vite)
- Declaration maps for monorepo cross-package navigation

Each package extends the shared tsconfig.base.json. TypeScript strict mode catches bugs at compile time, while Zod (v3.24) provides runtime validation for API inputs.`,
  },

  {
    title: 'What Performance Optimizations Do You Use in React Application memo useMemo',
    url: 'https://react.dev/reference/react/memo',
    content: `# Performance Optimizations in React Application

## React.memo for Skipping Re-renders

**React.memo** wraps a component to skip re-rendering when props haven't changed. This is one of the most important React performance optimizations:

\`\`\`tsx
// React.memo prevents unnecessary re-renders
const MessageBubble = React.memo(function MessageBubble({ message }: Props) {
  return <div className="p-3 rounded-lg">{message.content}</div>;
});
\`\`\`

## useMemo and useCallback Performance Hooks

**useMemo** — memoize expensive computations:
\`\`\`tsx
const filtered = useMemo(() => messages.filter(m => m.includes(term)), [messages, term]);
\`\`\`

**useCallback** — memoize callback functions to prevent child re-renders:
\`\`\`tsx
const handleSend = useCallback((msg: string) => addMessage(msg), []);
\`\`\`

## Code Splitting with React.lazy and Suspense

\`\`\`tsx
const KnowledgePanel = lazy(() => import('./KnowledgePanel'));
<Suspense fallback={<Spinner />}><KnowledgePanel /></Suspense>
\`\`\`

Vite automatically creates separate chunks for dynamic imports.

## Zustand Selectors for Performance Optimization

\`\`\`tsx
// ✅ Only re-renders when messages change
const messages = useChatStore(state => state.messages);
\`\`\`

## Tree Shaking and Bundle Optimization

- Named imports enable tree shaking: \`import { eq } from 'drizzle-orm'\`
- Manual chunks split vendor code for caching
- React.memo + useMemo + useCallback reduce rendering overhead`,
  },

  {
    title: 'What Version of Vite Is Used Key Features Vite 6',
    url: 'https://vite.dev/guide/',
    content: `# Vite Version — Vite 6.0.0

## Vite 6 Version and Key Features

The project uses **Vite 6** (^6.0.0) as the build system and dev server.

Key features of Vite 6:
- **Instant HMR** — Hot Module Replacement in milliseconds using native ES modules
- **ESBuild for development** — 10-100x faster TypeScript/JSX transforms than Babel
- **Rollup for production** — Optimized builds with tree-shaking, code splitting, minification
- **Native ESM** — Serves source files as ES modules in development (no bundling needed)
- **Environment API** — New in Vite 6, allows different configs for client/server/SSR
- **CSS handling** — Built-in PostCSS, CSS modules, and preprocessor support
- **Rich plugin API** — Extends Rollup's plugin interface

Vite 6 configuration in this project:
- Dev server port: 5173
- Proxy: /api and /health → http://localhost:3006 (Fastify backend)
- Build target: ES2022
- Plugin: @vitejs/plugin-react (v4.3) for React Fast Refresh`,
  },

  {
    title: 'What Testing Framework and Version Do You Use Vitest 3',
    url: 'https://vitest.dev/guide/',
    content: `# Testing Framework — Vitest 3.0.0

## Vitest 3 Version and Features

The project uses **Vitest 3** (^3.0.0) as the testing framework across the entire monorepo.

Key features of Vitest 3:
- **Vite-native** — Uses Vite's transform pipeline, TypeScript and JSX work without extra config
- **ESM-first** — Native ES module support (unlike Jest which struggles with ESM)
- **Jest-compatible API** — Same describe, it, expect syntax for easy migration
- **Workspace support** — Tests all monorepo packages with a single vitest.workspace.ts config
- **Fast execution** — esbuild transforms + worker threads for parallelism
- **Built-in coverage** — Uses v8 provider for fast coverage reporting
- **Watch mode** — Tests re-run instantly on file changes (HMR for tests)

Vitest 3 is used for:
- Unit tests: chat-service.test.ts, model-registry.test.ts, vai-engine.test.ts
- Integration tests: ingest-pipeline.test.ts, db.test.ts
- E2E tests: e2e.test.ts (22 end-to-end tests through Fastify server)

Run with: \`pnpm test\` (all), \`vitest run\` (CI), \`vitest --coverage\` (coverage report)`,
  },

  {
    title: 'What Framework Version Do You Use for Browser Extension wxt 0.20',
    url: 'https://wxt.dev/',
    content: `# Browser Extension Framework — wxt 0.20

## wxt 0.20 for Browser Extension Development

The project uses **wxt** (version ^0.20.0) as the framework for the browser extension.

**wxt** is a modern browser extension framework built on Vite. Version 0.20 features:
- **File-based entrypoints** — Automatically generates the extension manifest from file names
- **Hot Module Replacement** — HMR for content scripts and popup during development
- **Cross-browser** — Build for Chrome, Firefox, Safari, Edge from one codebase
- **TypeScript-first** — Full TypeScript support with type-safe APIs
- **Vite-powered** — Uses Vite for bundling (same ecosystem as the desktop app)
- **Auto-imports** — Common browser extension APIs are auto-imported

The extension has multiple entrypoints:
- \`background.ts\` — Background service worker
- \`popup/\` — Extension popup UI (React 19 + Tailwind CSS 3.4)
- \`youtube.content.ts\` — YouTube content script
- \`github.content.ts\` — GitHub content script
- \`google-search.content.ts\` — Google Search content script

wxt 0.20 is configured in \`wxt.config.ts\` with the @wxt-dev/module-react module for React support.`,
  },
];

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  try {
    await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error('❌ VAI server not running at', BASE);
    process.exit(1);
  }

  // Note: We do NOT clear taught entries here — this supplements the base knowledge
  // The base teach-knowledge.ts should be run first, then this file adds interview knowledge
  // If you want a fresh start, run: fetch('http://localhost:3006/api/teach', { method: 'DELETE' })

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  🎓 Teaching VAI Interview Knowledge — ${KNOWLEDGE.length} entries`);
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
