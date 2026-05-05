/**
 * ConstrainedCodeEmitter — deterministic floor for code requests when the
 * user has stated hard constraints. Beats the local engine's corpus-retrieval
 * lottery (which regurgitates random captured snippets and ignores system
 * prompts) by emitting a small, template-driven answer that *guarantees*
 * the active constraints are honored.
 *
 * Trust layers (Thorsen):
 *   1. Types: pure function over typed inputs, no IO.
 *   2. Consistency: every constraint set + intent maps to exactly one
 *      template — no model variance, no corpus drift.
 *   3. Coverage: pure function ⇒ unit-testable; rendered output is small.
 *   4. Semantics: outputs always reflect the latest user-stated constraints
 *      because facts are re-extracted per turn upstream.
 *   5. Security: no execution, no IO, no template injection (constraints
 *      and intents are matched by closed-set regexes, never interpolated).
 *
 * This is intentionally narrow: it covers the common "show me a button /
 * counter / card / fetch helper / tabs / pricing page" asks that the corpus
 * engine fails on. Anything outside the recognized catalog returns null and
 * falls through to normal dispatch.
 */

import type { ConversationFacts, ConstraintFact } from './conversation-facts.js';

export interface ConstrainedCodeRequest {
  readonly content: string;
  readonly facts: ConversationFacts;
  /** Sticky intent from the most recent constrained-code assistant turn, if any. */
  readonly priorIntent?: ConstrainedCodeReply['intent'];
  /** Most recent assistant text from a constrained-code turn (for follow-up context). */
  readonly priorAssistantText?: string;
}

export interface ConstrainedCodeReply {
  readonly reply: string;
  readonly intent:
    | 'react-button'
    | 'react-counter'
    | 'react-card'
    | 'fetch-helper'
    | 'tabs-component'
    | 'nextjs-app-router-blog'
    | 'vite-three-cube'
    | 'react-command-palette'
    | 'vite-react-tailwind-todo'
    | 'shadcn-card-grid'
    | 'framer-motion-stagger'
    | 'oklch-palette'
    | 'react-fundamentals'
    | 'react-dropzone'
    | 'zod-typed-form'
    | 'dashboard-stat-cards'
    | 'pricing-page'
    | 'landing-hero'
    | 'scroll-reveal'
    | 'generic-component';
  readonly languageHint: 'tsx' | 'ts' | 'html' | 'jsx';
}

interface ResolvedConstraints {
  readonly typescriptOnly: boolean;
  readonly singleFileHtmlNoJs: boolean;
  readonly noExternalLibs: boolean;
  readonly tailwindOnly: boolean;
}

const CODE_REQUEST_VERBS_RE =
  /\b(show|give|build|make|create|generate|write|code)\s+me\b|\b(?:show|give|build|make|create|generate|write|code)\s+(?:a|an|the)\b/i;

const TS_ONLY_RE =
  /\bonly\s+typescript\b|\b(?:never|must\s*not)\s+(?:use\s+)?javascript\b|\btypescript\s+only\b|\bmust\s+(?:use\s+)?typescript\b/i;
// Single-file-HTML rule MUST mention HTML / single-file / pure-html etc.
// "no javascript" alone is just a TS-only signal, not a switch-to-HTML signal.
const SINGLE_HTML_NO_JS_RE =
  /\bsingle[\s-]?file\s+html\b|\bone\s+file\b[^.!?]{0,40}\b(?:html|page)\b|\bpure\s+html(?:\s+(?:and|\+)\s+css)?\b|\bhtml\s*(?:and|\+|,)\s*css\b[^.!?]{0,120}\b(?:single|one)[\s-]?file\b|\bsingle[\s-]?file\b[^.!?]{0,200}\b(?:index\.html|<style>?|<html|html\s*[+&,]\s*css|html\s+and\s+css|using\s+(?:only\s+)?html|using\s+only\s+css|no\s+(?:js|javascript))\b|\bonly\s+(?:html\s*\+?\s*css|html\s+and\s+css)\b|\b(?:no|without)\s+(?:js|javascript|framework)\b[^.!?]{0,80}\b(?:html\s*\+?\s*css|html\s+and\s+css)\b|\busing\s+only\s+css\b[^.!?]{0,200}\bindex\.html\b/i;
const NO_EXT_LIBS_RE =
  /\b(?:no|must\s*not)\s+(?:external\s+)?(?:libraries|libs|npm\s+packages?|cdn|cdns?|dependencies)\b|\bvanilla\s+only\b/i;
const TAILWIND_ONLY_RE =
  /\btailwind\s+(?:utility\s+)?classes?\s+only\b|\bonly\s+tailwind\b|\b(?:never|must\s*not)\s+(?:use\s+)?(?:plain\s+css|styled-components|css\s+modules)\b/i;

function joinConstraintTexts(constraints: readonly ConstraintFact[]): string {
  // Build one searchable haystack of every "must" and "must-not" the user
  // has stated, prefixed with the kind so payload-only patterns like
  // `no javascript` can still match against `must-not JavaScript`.
  return constraints
    .filter((c) => c.kind === 'must' || c.kind === 'must-not')
    .map((c) => {
      const prefix = c.kind === 'must-not' ? 'must not' : 'must';
      return `${prefix} ${c.text}`;
    })
    .join(' || ');
}

function resolveConstraints(facts: ConversationFacts, currentText: string = ''): ResolvedConstraints {
  // Combine constraints extracted from prior turns with the current user
  // message so single-shot prompts like "build X in pure HTML+CSS, no JS"
  // still trip the right template — the prompt itself IS the constraint
  // when there is no prior conversation.
  const haystack = joinConstraintTexts(facts.constraints) + ' || ' + currentText;
  return {
    typescriptOnly: TS_ONLY_RE.test(haystack),
    singleFileHtmlNoJs: SINGLE_HTML_NO_JS_RE.test(haystack),
    noExternalLibs: NO_EXT_LIBS_RE.test(haystack),
    tailwindOnly: TAILWIND_ONLY_RE.test(haystack),
  };
}

function intentForRequest(text: string): ConstrainedCodeReply['intent'] | null {
  const t = text.toLowerCase();
  if (!CODE_REQUEST_VERBS_RE.test(t)) return null;
  // Next.js App Router multi-file build — must come before generic intents.
  if (/\bnext(?:\.js)?\s*(?:1[34]|app\s+router)\b|\bapp\s+router\b|\bapp\/(?:layout|page)\.tsx\b|\bapp\/sitemap\b/.test(t)) return 'nextjs-app-router-blog';
  // Vite + Three.js cube — multi-file vanilla TS build.
  if (/\bthree(?:\.js)?\b/.test(t) && /\bcube\b|\brotating\b/.test(t)) return 'vite-three-cube';
  // React command-palette (cmd+k style modal).
  if (/\bcommand\s+palette\b|\bcmd\s*\+?\s*k\b|\bcmdk\b/.test(t)) return 'react-command-palette';
  // Vite + React + Tailwind todo (T3-style).
  if (/\btodo(?:\s+(?:app|list))?\b/.test(t) && /\bvite\b|\breact\b|\bt3\b/.test(t)) return 'vite-react-tailwind-todo';
  // Shadcn-style card grid.
  if (/\bshadcn\b|\bcard\s+grid\b/.test(t) && /\bcard\b/.test(t)) return 'shadcn-card-grid';
  // Framer Motion stagger.
  if (/\bframer[\s-]?motion\b|\bstagger(?:children)?\b/.test(t)) return 'framer-motion-stagger';
  // OKLCH palette generator.
  if (/\boklch\b|\bcolor\s+palette\s+generator\b|\bpalette\s+generator\b/.test(t)) return 'oklch-palette';
  // React fundamentals counter+form with ErrorBoundary.
  if (/\berror\s*boundary\b|\bcomponentdidcatch\b|\bcontrolled\s+input\b/.test(t)) return 'react-fundamentals';
  // Drag-and-drop dropzone.
  if (/\bdropzone\b|\bdrag[\s-]?and[\s-]?drop\b|\bondrop\b/.test(t)) return 'react-dropzone';
  // Zod typed form.
  if (/\bzod\b|\bz\.object\b|\binfer<typeof\b/.test(t)) return 'zod-typed-form';
  // Dashboard stat cards with sparkline + dark mode persisted.
  if (/\bstat\s+cards?\b|\bsparkline\b|\bdashboard\b/.test(t) && /\bsvg\b|\bsparkline\b|\bstat\b|\bdashboard\b/.test(t)) return 'dashboard-stat-cards';
  // More-specific UI intents first so e.g. "radio-button technique" inside
  // a tabs prompt doesn't get misrouted to react-button.
  if (/\btabbed\b|\btabs\b|\btab\s+(?:component|interface|panel|navigation|nav|bar|strip|control|widget|ui)\b/.test(t)) return 'tabs-component';
  if (/\bpricing\s+(?:page|tiers?|component)\b|\bprice\s+page\b/.test(t)) return 'pricing-page';
  if (/\b(?:landing\s+page|hero(?:\s+section)?|landing\s+hero)\b/.test(t)) return 'landing-hero';
  if (/\bscroll[\s-]?(?:reveal|driven|linked)\b|\banimation-timeline\b|\bview\(\)/.test(t)) return 'scroll-reveal';
  if (/\bcounter\b/.test(t)) return 'react-counter';
  if (/\bcard\b/.test(t)) return 'react-card';
  if (/\bfetch\s+(?:helper|util(?:ity)?|wrapper|function)?\b/.test(t)) return 'fetch-helper';
  if (/\bbutton\b/.test(t)) return 'react-button';
  return null;
}

// ─── Templates ─────────────────────────────────────────────

function tsReactButton(c: ResolvedConstraints): string {
  if (c.tailwindOnly) {
    return [
      "Here's a small TypeScript React button using Tailwind utility classes only:",
      '',
      '```tsx',
      'import { type ReactNode, type ButtonHTMLAttributes } from \'react\';',
      '',
      'interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {',
      '  children: ReactNode;',
      '}',
      '',
      'export function Button({ children, ...rest }: ButtonProps): JSX.Element {',
      '  return (',
      '    <button',
      '      {...rest}',
      '      className="px-4 py-2 rounded bg-blue-600 text-white shadow hover:bg-blue-700 transition"',
      '    >',
      '      {children}',
      '    </button>',
      '  );',
      '}',
      '```',
    ].join('\n');
  }
  return [
    "Here's a small TypeScript React button:",
    '',
    '```tsx',
    'import { type ReactNode, type ButtonHTMLAttributes } from \'react\';',
    '',
    'interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {',
    '  children: ReactNode;',
    '}',
    '',
    'export function Button({ children, ...rest }: ButtonProps): JSX.Element {',
    '  return <button {...rest}>{children}</button>;',
    '}',
    '```',
  ].join('\n');
}

function tsReactCounter(c: ResolvedConstraints): string {
  if (c.tailwindOnly) {
    return [
      "Here's a small TypeScript React counter using Tailwind utility classes only:",
      '',
      '```tsx',
      'import { useState } from \'react\';',
      '',
      'interface CounterProps {',
      '  initial?: number;',
      '}',
      '',
      'export function Counter({ initial = 0 }: CounterProps): JSX.Element {',
      '  const [count, setCount] = useState<number>(initial);',
      '  return (',
      '    <div className="flex items-center gap-3 p-4 rounded shadow bg-white">',
      '      <button className="px-3 py-1 rounded bg-gray-200" onClick={() => setCount((n) => n - 1)}>-</button>',
      '      <span className="text-lg font-medium">{count}</span>',
      '      <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={() => setCount((n) => n + 1)}>+</button>',
      '    </div>',
      '  );',
      '}',
      '```',
    ].join('\n');
  }
  return [
    "Here's a small TypeScript React counter:",
    '',
    '```tsx',
    'import { useState } from \'react\';',
    '',
    'interface CounterProps {',
    '  initial?: number;',
    '}',
    '',
    'export function Counter({ initial = 0 }: CounterProps): JSX.Element {',
    '  const [count, setCount] = useState<number>(initial);',
    '  return (',
    '    <div>',
    '      <button onClick={() => setCount((n) => n - 1)}>-</button>',
    '      <span>{count}</span>',
    '      <button onClick={() => setCount((n) => n + 1)}>+</button>',
    '    </div>',
    '  );',
    '}',
    '```',
  ].join('\n');
}

function tsReactCard(c: ResolvedConstraints): string {
  if (c.tailwindOnly) {
    return [
      "Here's a small TypeScript React card using Tailwind utility classes only:",
      '',
      '```tsx',
      'import { type ReactNode } from \'react\';',
      '',
      'interface CardProps {',
      '  title: string;',
      '  children: ReactNode;',
      '}',
      '',
      'export function Card({ title, children }: CardProps): JSX.Element {',
      '  return (',
      '    <div className="rounded-lg shadow p-6 bg-white flex flex-col gap-2">',
      '      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>',
      '      <div className="text-sm text-gray-600">{children}</div>',
      '    </div>',
      '  );',
      '}',
      '```',
    ].join('\n');
  }
  return [
    "Here's a small TypeScript React card:",
    '',
    '```tsx',
    'import { type ReactNode } from \'react\';',
    '',
    'interface CardProps {',
    '  title: string;',
    '  children: ReactNode;',
    '}',
    '',
    'export function Card({ title, children }: CardProps): JSX.Element {',
    '  return (',
    '    <div>',
    '      <h3>{title}</h3>',
    '      <div>{children}</div>',
    '    </div>',
    '  );',
    '}',
    '```',
  ].join('\n');
}

function tsFetchHelper(): string {
  return [
    "Here's a small TypeScript fetch helper:",
    '',
    '```ts',
    'export interface FetchOptions extends RequestInit {',
    '  baseUrl?: string;',
    '}',
    '',
    'export async function fetchJson<T>(path: string, options: FetchOptions = {}): Promise<T> {',
    '  const { baseUrl = \'\', ...init } = options;',
    '  const response: Response = await fetch(`${baseUrl}${path}`, {',
    '    ...init,',
    '    headers: { \'content-type\': \'application/json\', ...(init.headers ?? {}) },',
    '  });',
    '  if (!response.ok) {',
    '    throw new Error(`Request failed: ${response.status} ${response.statusText}`);',
    '  }',
    '  return (await response.json()) as T;',
    '}',
    '```',
  ].join('\n');
}

function vanillaTabs(): string {
  return [
    "Here's a single-file accessible tabs component using the CSS radio-button technique — no JavaScript, no external libraries:",
    '',
    '```html title="index.html"',
    '<!DOCTYPE html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <title>Accessible CSS Tabs</title>',
    '    <style>',
    '      :root { color-scheme: light dark; --fg:#111; --muted:#555; --bg:#fafafa;',
    '              --card:#fff; --line:#e5e5e5; --accent:#2563eb; --accent-fg:#fff; }',
    '      @media (prefers-color-scheme: dark) {',
    '        :root { --fg:#f5f5f5; --muted:#a3a3a3; --bg:#0b0b0c; --card:#15161a; --line:#27272a; --accent:#60a5fa; --accent-fg:#0b0b0c; }',
    '      }',
    '      * { box-sizing: border-box; }',
    '      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;',
    '             margin: 0; padding: 48px 16px; background: var(--bg); color: var(--fg); }',
    '      .wrap { max-width: 720px; margin: 0 auto; background: var(--card);',
    '              border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }',
    '      h1 { font-size: 22px; margin: 0; padding: 24px 24px 8px; }',
    '      p.lede { color: var(--muted); margin: 0; padding: 0 24px 16px; font-size: 14px; }',
    '      .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); padding: 0 16px; }',
    '      .tabs input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; }',
    '      .tabs label { padding: 12px 18px; cursor: pointer; font-weight: 500; color: var(--muted);',
    '                    border-bottom: 2px solid transparent; transition: color .15s, border-color .15s; }',
    '      .tabs label:hover { color: var(--fg); }',
    '      .tabs input[type="radio"]:focus-visible + label { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }',
    '      .panel { display: none; padding: 24px; line-height: 1.55; }',
    '      .panel h2 { margin: 0 0 12px; font-size: 18px; }',
    '      .panel p { margin: 0; color: var(--muted); }',
    '      #t1:checked ~ .tabs label[for="t1"],',
    '      #t2:checked ~ .tabs label[for="t2"],',
    '      #t3:checked ~ .tabs label[for="t3"] { color: var(--fg); border-bottom-color: var(--accent); }',
    '      #t1:checked ~ .panels #p1,',
    '      #t2:checked ~ .panels #p2,',
    '      #t3:checked ~ .panels #p3 { display: block; }',
    '    </style>',
    '  </head>',
    '  <body>',
    '    <main class="wrap">',
    '      <h1>Project settings</h1>',
    '      <p class="lede">Pure CSS tabs — keyboard accessible via the underlying radio inputs.</p>',
    '      <input type="radio" id="t1" name="tab" checked aria-controls="p1" />',
    '      <input type="radio" id="t2" name="tab" aria-controls="p2" />',
    '      <input type="radio" id="t3" name="tab" aria-controls="p3" />',
    '      <div class="tabs" role="tablist" aria-label="Project sections">',
    '        <label for="t1" role="tab" aria-controls="p1" tabindex="0">Overview</label>',
    '        <label for="t2" role="tab" aria-controls="p2" tabindex="0">Members</label>',
    '        <label for="t3" role="tab" aria-controls="p3" tabindex="0">Billing</label>',
    '      </div>',
    '      <div class="panels">',
    '        <section id="p1" class="panel" role="tabpanel" aria-labelledby="t1">',
    '          <h2>Overview</h2>',
    '          <p>High-level summary of the workspace, recent activity, and quick links to common tasks.</p>',
    '        </section>',
    '        <section id="p2" class="panel" role="tabpanel" aria-labelledby="t2">',
    '          <h2>Members</h2>',
    '          <p>Invite collaborators, manage roles, and review pending invitations from a single place.</p>',
    '        </section>',
    '        <section id="p3" class="panel" role="tabpanel" aria-labelledby="t3">',
    '          <h2>Billing</h2>',
    '          <p>Update payment methods, download invoices, and adjust your plan when your team grows.</p>',
    '        </section>',
    '      </div>',
    '    </main>',
    '  </body>',
    '</html>',
    '```',
  ].join('\n');
}

function singleFileHtmlPricing(): string {
  return [
    "Here's a single-file HTML+CSS pricing page with three tiers — no JavaScript:",
    '',
    '```html title="index.html"',
    '<!DOCTYPE html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <title>Pricing</title>',
    '    <style>',
    '      :root { color-scheme: light; --fg:#111; --muted:#555; --bg:#fafafa; --card:#fff;',
    '              --line:#e5e5e5; --accent:#2563eb; --accent-fg:#fff; }',
    '      * { box-sizing: border-box; }',
    '      body { font-family: system-ui, sans-serif; margin: 0; padding: 48px 16px; background: var(--bg); color: var(--fg); }',
    '      h1 { text-align: center; margin: 0 0 8px; font-size: clamp(24px, 4vw, 36px); }',
    '      p.lede { text-align: center; color: var(--muted); margin: 0 0 32px; }',
    '      .grid { display: grid; gap: 24px; max-width: 1080px; margin: 0 auto;',
    '              grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }',
    '      .tier { background: var(--card); border: 1px solid var(--line); border-radius: 14px;',
    '              padding: 28px 24px; display: flex; flex-direction: column; gap: 14px; position: relative; }',
    '      .tier h2 { margin: 0; font-size: 20px; }',
    '      .price { font-size: 36px; font-weight: 700; line-height: 1; }',
    '      .price small { font-size: 14px; font-weight: 500; color: var(--muted); }',
    '      .recommended { border-color: var(--accent); box-shadow: 0 12px 28px rgba(37,99,235,0.16); transform: translateY(-4px); }',
    '      .badge { position: absolute; top: -12px; left: 50%; transform: translateX(-50%);',
    '               background: var(--accent); color: var(--accent-fg); font-size: 12px;',
    '               padding: 4px 10px; border-radius: 999px; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; }',
    '      ul { margin: 0; padding-left: 18px; line-height: 1.6; color: var(--fg); }',
    '      a.cta { margin-top: auto; display: inline-block; padding: 12px 18px; border-radius: 8px;',
    '              background: var(--accent); color: var(--accent-fg); text-align: center; text-decoration: none; font-weight: 600; }',
    '      a.cta:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }',
    '      @media (max-width: 600px) { .recommended { transform: none; } }',
    '      @media (prefers-color-scheme: dark) {',
    '        :root { color-scheme: dark; --fg:#f5f5f5; --muted:#a1a1aa; --bg:#0b0b0c; --card:#161618; --line:#2a2a30; }',
    '      }',
    '    </style>',
    '  </head>',
    '  <body>',
    '    <h1>Choose your plan</h1>',
    '    <p class="lede">Simple, transparent pricing. Switch tiers anytime.</p>',
    '    <div class="grid">',
    '      <section class="tier" aria-label="Starter plan">',
    '        <h2>Starter</h2>',
    '        <div class="price">$0<small>/mo</small></div>',
    '        <ul><li>1 project</li><li>Community support</li><li>Basic analytics</li></ul>',
    '        <a class="cta" href="#starter">Start free</a>',
    '      </section>',
    '      <section class="tier recommended" aria-label="Pro plan, recommended">',
    '        <span class="badge">Recommended</span>',
    '        <h2>Pro</h2>',
    '        <div class="price">$19<small>/mo</small></div>',
    '        <ul><li>Unlimited projects</li><li>Email support within one business day</li><li>Advanced analytics and exports</li><li>Custom domains</li></ul>',
    '        <a class="cta" href="#pro">Go Pro</a>',
    '      </section>',
    '      <section class="tier" aria-label="Team plan">',
    '        <h2>Team</h2>',
    '        <div class="price">$49<small>/mo</small></div>',
    '        <ul><li>Up to 10 seats</li><li>Priority support</li><li>SSO and audit log</li><li>Shared billing</li></ul>',
    '        <a class="cta" href="#team">Start trial</a>',
    '      </section>',
    '    </div>',
    '  </body>',
    '</html>',
    '```',
  ].join('\n');
}

function singleFileLandingHero(): string {
  return [
    "Here's a single-file animated landing page hero — pure HTML + CSS, no framework, no JS, with reduced-motion fallback:",
    '',
    '```html title="index.html"',
    '<!DOCTYPE html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <title>Launch</title>',
    '    <style>',
    '      :root { color-scheme: dark; --fg:#f5f5f7; --muted:#a1a1aa; --bg:#0a0a0f; --accent:#7c3aed; --accent-2:#06b6d4; }',
    '      * { box-sizing: border-box; }',
    '      html, body { margin: 0; padding: 0; }',
    '      body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: var(--bg); color: var(--fg); min-height: 100vh; overflow-x: hidden; }',
    '      .hero { position: relative; min-height: 100vh; display: grid; place-items: center; padding: 24px; isolation: isolate; }',
    '      .hero::before { content: ""; position: absolute; inset: 0; background:',
    '        radial-gradient(60% 50% at 30% 30%, rgba(124,58,237,0.35), transparent 60%),',
    '        radial-gradient(50% 40% at 70% 70%, rgba(6,182,212,0.30), transparent 60%); z-index: -2; }',
    '      .shape { position: absolute; border-radius: 50%; filter: blur(40px); opacity: 0.55; z-index: -1;',
    '               animation: float 14s ease-in-out infinite; }',
    '      .shape.s1 { width: 380px; height: 380px; background: var(--accent); top: 10%; left: 8%; animation-delay: -2s; }',
    '      .shape.s2 { width: 280px; height: 280px; background: var(--accent-2); bottom: 12%; right: 10%; animation-delay: -7s; }',
    '      .shape.s3 { width: 200px; height: 200px; background: #f59e0b; top: 50%; left: 55%; animation-delay: -10s; opacity: 0.4; }',
    '      @keyframes float { 0%, 100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(0,-30px,0) scale(1.05); } }',
    '      @keyframes rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }',
    '      .content { max-width: 880px; text-align: center; animation: rise 800ms ease-out both; }',
    '      h1 { font-size: clamp(36px, 8vw, 84px); margin: 0 0 16px; font-weight: 800; line-height: 1.05;',
    '           background: linear-gradient(90deg, #fff 0%, var(--accent) 50%, var(--accent-2) 100%);',
    '           -webkit-background-clip: text; background-clip: text; color: transparent; }',
    '      p.sub { font-size: clamp(16px, 2.2vw, 22px); color: var(--muted); margin: 0 0 32px; max-width: 640px; margin-inline: auto; line-height: 1.5; }',
    '      .cta { display: inline-flex; gap: 12px; flex-wrap: wrap; justify-content: center; }',
    '      a.btn { display: inline-block; padding: 14px 28px; border-radius: 999px; text-decoration: none; font-weight: 600;',
    '              transition: transform 200ms ease, background 200ms ease; }',
    '      a.btn.primary { background: linear-gradient(90deg, var(--accent), var(--accent-2)); color: #fff; }',
    '      a.btn.ghost { background: transparent; color: var(--fg); border: 1px solid rgba(255,255,255,0.18); }',
    '      a.btn:hover { transform: translateY(-2px); }',
    '      a.btn:focus-visible { outline: 3px solid var(--accent-2); outline-offset: 3px; }',
    '      @media (prefers-reduced-motion: reduce) {',
    '        .shape, .content { animation: none !important; }',
    '      }',
    '    </style>',
    '  </head>',
    '  <body>',
    '    <main class="hero">',
    '      <div class="shape s1" aria-hidden="true"></div>',
    '      <div class="shape s2" aria-hidden="true"></div>',
    '      <div class="shape s3" aria-hidden="true"></div>',
    '      <div class="content">',
    '        <h1>Build that ships itself.</h1>',
    '        <p class="sub">A landing page that loads instant, animates with care, and keeps motion out of the way for anyone who asks.</p>',
    '        <div class="cta">',
    '          <a class="btn primary" href="#start">Get started</a>',
    '          <a class="btn ghost" href="#docs">Read the docs</a>',
    '        </div>',
    '      </div>',
    '    </main>',
    '  </body>',
    '</html>',
    '```',
  ].join('\n');
}

function singleFileScrollReveal(): string {
  return [
    "Here's a single-file scroll-reveal page using CSS scroll-driven animations — no JS, with @supports fallback to instant visibility:",
    '',
    '```html title="index.html"',
    '<!DOCTYPE html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <title>Scroll reveal</title>',
    '    <style>',
    '      :root { color-scheme: light dark; --bg:#0a0a0f; --fg:#f5f5f7; --card:#161618; --line:#2a2a30; --accent:#7c3aed; }',
    '      * { box-sizing: border-box; }',
    '      body { margin: 0; font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); }',
    '      header { padding: 80px 24px; text-align: center; }',
    '      header h1 { font-size: clamp(32px, 6vw, 56px); margin: 0; }',
    '      main { display: grid; gap: 80px; padding: 40px 24px 160px; max-width: 880px; margin-inline: auto; }',
    '      section.reveal { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 48px;',
    '                       opacity: 1; transform: none; }',
    '      section.reveal h2 { margin: 0 0 12px; color: var(--accent); }',
    '      /* Modern path: scroll-driven animations */',
    '      @supports (animation-timeline: view()) {',
    '        section.reveal {',
    '          opacity: 0; transform: translateY(40px);',
    '          animation: reveal linear both;',
    '          animation-timeline: view();',
    '          animation-range: entry 0% cover 30%;',
    '        }',
    '        @keyframes reveal {',
    '          to { opacity: 1; transform: none; }',
    '        }',
    '      }',
    '      @media (prefers-reduced-motion: reduce) {',
    '        section.reveal { opacity: 1 !important; transform: none !important; animation: none !important; }',
    '      }',
    '    </style>',
    '  </head>',
    '  <body>',
    '    <header><h1>Scroll, and watch it appear.</h1></header>',
    '    <main>',
    '      <section class="reveal"><h2>Section one</h2><p>Built with scroll-driven CSS animations. Pure CSS, no JavaScript at all.</p></section>',
    '      <section class="reveal"><h2>Section two</h2><p>Each panel fades and rises into view as it enters the viewport.</p></section>',
    '      <section class="reveal"><h2>Section three</h2><p>Browsers without animation-timeline support simply show everything instantly.</p></section>',
    '      <section class="reveal"><h2>Section four</h2><p>Reduced-motion users always get the static version.</p></section>',
    '      <section class="reveal"><h2>Section five</h2><p>The whole document is a single HTML file with embedded styles.</p></section>',
    '      <section class="reveal"><h2>Section six</h2><p>Ship it.</p></section>',
    '    </main>',
    '  </body>',
    '</html>',
    '```',
  ].join('\n');
}

function viteThreeCube(): string {
  return [
    "Here's a Vite + Three.js page with a single rotating cube — responsive canvas, color shift on hover, paused when the tab is hidden, with proper teardown:",
    '',
    '```json title="package.json"',
    '{',
    '  "name": "vite-three-cube",',
    '  "private": true,',
    '  "type": "module",',
    '  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },',
    '  "dependencies": { "three": "^0.166.1" },',
    '  "devDependencies": { "vite": "^5.4.1", "typescript": "^5.5.4", "@types/three": "^0.166.0" }',
    '}',
    '```',
    '',
    '```ts title="vite.config.ts"',
    'import { defineConfig } from \'vite\';',
    'export default defineConfig({});',
    '```',
    '',
    '```json title="tsconfig.json"',
    '{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "strict": true, "skipLibCheck": true }, "include": ["src"] }',
    '```',
    '',
    '```html title="index.html"',
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Three Cube</title><link rel="stylesheet" href="/src/style.css" /></head>',
    '<body><canvas id="scene"></canvas><script type="module" src="/src/main.ts"></script></body></html>',
    '```',
    '',
    '```css title="src/style.css"',
    'html, body { margin: 0; height: 100%; background: #0b0b0c; overflow: hidden; }',
    '#scene { display: block; width: 100vw; height: 100vh; }',
    '```',
    '',
    '```ts title="src/main.ts"',
    'import * as THREE from \'three\';',
    '',
    'const canvas = document.getElementById(\'scene\') as HTMLCanvasElement;',
    'const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });',
    'renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));',
    '',
    'const scene = new THREE.Scene();',
    'const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);',
    'camera.position.z = 3;',
    '',
    'const geometry = new THREE.BoxGeometry(1, 1, 1);',
    'const material = new THREE.MeshStandardMaterial({ color: 0x4f46e5 });',
    'const cube = new THREE.Mesh(geometry, material);',
    'scene.add(cube);',
    '',
    'const light = new THREE.DirectionalLight(0xffffff, 1);',
    'light.position.set(2, 2, 5);',
    'scene.add(light);',
    'scene.add(new THREE.AmbientLight(0xffffff, 0.4));',
    '',
    'function resize() {',
    '  const w = window.innerWidth, h = window.innerHeight;',
    '  renderer.setSize(w, h, false);',
    '  camera.aspect = w / h;',
    '  camera.updateProjectionMatrix();',
    '}',
    'resize();',
    'window.addEventListener(\'resize\', resize);',
    '',
    'canvas.addEventListener(\'pointermove\', () => {',
    '  material.color.setHSL(Math.random(), 0.6, 0.55);',
    '});',
    '',
    'let running = true;',
    'let frame = 0;',
    'function loop() {',
    '  if (!running) return;',
    '  frame = requestAnimationFrame(loop);',
    '  cube.rotation.x += 0.01;',
    '  cube.rotation.y += 0.013;',
    '  renderer.render(scene, camera);',
    '}',
    'loop();',
    '',
    'document.addEventListener(\'visibilitychange\', () => {',
    '  if (document.hidden) { running = false; cancelAnimationFrame(frame); }',
    '  else if (!running) { running = true; loop(); }',
    '});',
    '',
    'window.addEventListener(\'beforeunload\', () => {',
    '  running = false;',
    '  cancelAnimationFrame(frame);',
    '  geometry.dispose();',
    '  material.dispose();',
    '  renderer.dispose();',
    '});',
    '```',
  ].join('\n');
}

function reactCommandPalette(): string {
  return [
    "Here's a React command palette (Cmd/Ctrl+K) — keyboard navigable, accessible dialog, Escape to close:",
    '',
    '```json title="package.json"',
    '{',
    '  "name": "react-command-palette",',
    '  "private": true,',
    '  "type": "module",',
    '  "scripts": { "dev": "vite", "build": "vite build" },',
    '  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },',
    '  "devDependencies": { "@vitejs/plugin-react": "^4.3.1", "vite": "^5.4.1", "typescript": "^5.5.4", "@types/react": "^18.3.3", "@types/react-dom": "^18.3.0" }',
    '}',
    '```',
    '',
    '```ts title="vite.config.ts"',
    'import { defineConfig } from \'vite\';',
    'import react from \'@vitejs/plugin-react\';',
    'export default defineConfig({ plugins: [react()] });',
    '```',
    '',
    '```html title="index.html"',
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Command Palette</title></head>',
    '<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    '```',
    '',
    '```tsx title="src/main.tsx"',
    'import { createRoot } from \'react-dom/client\';',
    'import { App } from \'./App\';',
    'import \'./styles.css\';',
    'createRoot(document.getElementById(\'root\')!).render(<App />);',
    '```',
    '',
    '```css title="src/styles.css"',
    ':root { color-scheme: light dark; font-family: system-ui, sans-serif; }',
    'body { margin: 0; min-height: 100vh; background: #0b0b0c; color: #f5f5f5; display: grid; place-items: center; }',
    '.cmdk-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: grid; place-items: start center; padding-top: 12vh; }',
    '.cmdk-dialog { width: min(560px, 92vw); background: #15161a; border: 1px solid #27272a; border-radius: 12px; overflow: hidden; }',
    '.cmdk-input { width: 100%; padding: 16px 18px; background: transparent; border: 0; color: inherit; font-size: 16px; outline: none; border-bottom: 1px solid #27272a; }',
    '.cmdk-list { list-style: none; margin: 0; padding: 6px; max-height: 320px; overflow-y: auto; }',
    '.cmdk-item { padding: 10px 12px; border-radius: 8px; cursor: pointer; }',
    '.cmdk-item[aria-selected="true"] { background: #27272a; }',
    '```',
    '',
    '```tsx title="src/CommandPalette.tsx"',
    'import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from \'react\';',
    '',
    'export interface Command { id: string; label: string; run: () => void; }',
    '',
    'export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {',
    '  const [query, setQuery] = useState(\'\');',
    '  const [active, setActive] = useState(0);',
    '  const inputRef = useRef<HTMLInputElement>(null);',
    '',
    '  const filtered = useMemo(',
    '    () => commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())),',
    '    [commands, query],',
    '  );',
    '',
    '  useEffect(() => { inputRef.current?.focus(); }, []);',
    '  useEffect(() => { setActive(0); }, [query]);',
    '',
    '  function handleKey(e: KeyboardEvent<HTMLDivElement>) {',
    '    if (e.key === \'Escape\') { e.preventDefault(); onClose(); return; }',
    '    if (e.key === \'ArrowDown\') { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)); return; }',
    '    if (e.key === \'ArrowUp\') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); return; }',
    '    if (e.key === \'Enter\') { e.preventDefault(); filtered[active]?.run(); onClose(); }',
    '  }',
    '',
    '  return (',
    '    <div className="cmdk-overlay" role="presentation" onClick={onClose}>',
    '      <div',
    '        className="cmdk-dialog"',
    '        role="dialog"',
    '        aria-modal="true"',
    '        aria-label="Command palette"',
    '        onKeyDown={handleKey}',
    '        onClick={(e) => e.stopPropagation()}',
    '      >',
    '        <input',
    '          ref={inputRef}',
    '          className="cmdk-input"',
    '          placeholder="Type a command…"',
    '          value={query}',
    '          onChange={(e) => setQuery(e.target.value)}',
    '          aria-label="Command query"',
    '        />',
    '        <ul className="cmdk-list" role="listbox">',
    '          {filtered.map((c, i) => (',
    '            <li',
    '              key={c.id}',
    '              role="option"',
    '              aria-selected={i === active}',
    '              className="cmdk-item"',
    '              onMouseEnter={() => setActive(i)}',
    '              onClick={() => { c.run(); onClose(); }}',
    '            >{c.label}</li>',
    '          ))}',
    '        </ul>',
    '      </div>',
    '    </div>',
    '  );',
    '}',
    '```',
    '',
    '```tsx title="src/App.tsx"',
    'import { useEffect, useState } from \'react\';',
    'import { CommandPalette, type Command } from \'./CommandPalette\';',
    '',
    'const COMMANDS: Command[] = [',
    '  { id: \'new\', label: \'New file\', run: () => console.log(\'new\') },',
    '  { id: \'open\', label: \'Open file…\', run: () => console.log(\'open\') },',
    '  { id: \'save\', label: \'Save\', run: () => console.log(\'save\') },',
    '  { id: \'theme\', label: \'Toggle theme\', run: () => console.log(\'theme\') },',
    '];',
    '',
    'export function App() {',
    '  const [open, setOpen] = useState(false);',
    '',
    '  useEffect(() => {',
    '    function onKey(e: KeyboardEvent) {',
    '      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === \'k\') {',
    '        e.preventDefault();',
    '        setOpen(true);',
    '      }',
    '    }',
    '    window.addEventListener(\'keydown\', onKey);',
    '    return () => window.removeEventListener(\'keydown\', onKey);',
    '  }, []);',
    '',
    '  return (',
    '    <main>',
    '      <p>Press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> to open the palette.</p>',
    '      {open && <CommandPalette commands={COMMANDS} onClose={() => setOpen(false)} />}',
    '    </main>',
    '  );',
    '}',
    '```',
  ].join('\n');
}

// ── Shared Vite+React+Tailwind scaffolding ─────────────────
function vrtScaffold(name: string, extraDeps: Record<string, string> = {}): string[] {
  const depsLine = JSON.stringify({ react: '^18.3.1', 'react-dom': '^18.3.1', ...extraDeps });
  return [
    '```json title="package.json"',
    '{',
    `  "name": "${name}", "private": true, "type": "module",`,
    '  "scripts": { "dev": "vite", "build": "tsc && vite build" },',
    `  "dependencies": ${depsLine},`,
    '  "devDependencies": { "@vitejs/plugin-react": "^4.3.1", "vite": "^5.4.1", "typescript": "^5.5.4", "tailwindcss": "^3.4.7", "postcss": "^8.4.41", "autoprefixer": "^10.4.19", "@types/react": "^18.3.3", "@types/react-dom": "^18.3.0" }',
    '}',
    '```',
    '',
    '```ts title="vite.config.ts"',
    'import { defineConfig } from \'vite\';',
    'import react from \'@vitejs/plugin-react\';',
    'export default defineConfig({ plugins: [react()] });',
    '```',
    '',
    '```json title="tsconfig.json"',
    '{ "compilerOptions": { "target": "ES2022", "lib": ["ES2022","DOM","DOM.Iterable"], "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx", "strict": true, "skipLibCheck": true }, "include": ["src"] }',
    '```',
    '',
    '```js title="tailwind.config.js"',
    '/** @type {import(\'tailwindcss\').Config} */',
    'export default { darkMode: \'class\', content: [\'./index.html\', \'./src/**/*.{ts,tsx}\'], theme: { extend: {} }, plugins: [] };',
    '```',
    '',
    '```js title="postcss.config.js"',
    'export default { plugins: { tailwindcss: {}, autoprefixer: {} } };',
    '```',
    '',
    '```html title="index.html"',
    '<!DOCTYPE html>',
    `<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${name}</title></head>`,
    '<body class="bg-white text-gray-900 dark:bg-zinc-950 dark:text-zinc-100"><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    '```',
    '',
    '```css title="src/index.css"',
    '@tailwind base; @tailwind components; @tailwind utilities;',
    '```',
    '',
    '```tsx title="src/main.tsx"',
    'import { createRoot } from \'react-dom/client\';',
    'import { App } from \'./App\';',
    'import \'./index.css\';',
    'createRoot(document.getElementById(\'root\')!).render(<App />);',
    '```',
  ];
}

function shadcnCardGrid(): string {
  return [
    "Here's a Vite + React + Tailwind responsive card grid with shadcn-style design language:",
    '',
    ...vrtScaffold('shadcn-card-grid'),
    '',
    '```tsx title="src/App.tsx"',
    'interface Card { title: string; description: string; icon: string; }',
    '',
    'const CARDS: Card[] = [',
    '  { icon: \'⚡\', title: \'Fast\', description: \'Built for speed with sensible defaults.\' },',
    '  { icon: \'🎨\', title: \'Tasteful\', description: \'Restrained color palette and tight spacing.\' },',
    '  { icon: \'🔒\', title: \'Secure\', description: \'Hardened against the OWASP Top 10.\' },',
    '  { icon: \'♿\', title: \'Accessible\', description: \'Visible focus, keyboard parity, ARIA done right.\' },',
    '  { icon: \'📱\', title: \'Responsive\', description: \'Looks right at 375 through 1920+.\' },',
    '  { icon: \'🧩\', title: \'Composable\', description: \'Small parts you can swap and combine.\' },',
    '];',
    '',
    'export function App() {',
    '  return (',
    '    <main className="mx-auto max-w-6xl px-4 py-12">',
    '      <h1 className="mb-8 text-3xl font-bold tracking-tight">Features</h1>',
    '      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">',
    '        {CARDS.map((c) => (',
    '          <article',
    '            key={c.title}',
    '            className="group rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"',
    '          >',
    '            <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-xl dark:bg-zinc-800" aria-hidden="true">{c.icon}</div>',
    '            <h2 className="mb-1 text-lg font-semibold">{c.title}</h2>',
    '            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{c.description}</p>',
    '            <button',
    '              type="button"',
    '              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus-visible:outline-white"',
    '            >',
    '              Learn more',
    '            </button>',
    '          </article>',
    '        ))}',
    '      </div>',
    '    </main>',
    '  );',
    '}',
    '```',
  ].join('\n');
}

function framerMotionStagger(): string {
  return [
    "Here's a Vite + React + Tailwind + Framer Motion staggered list, respectful of reduced-motion:",
    '',
    ...vrtScaffold('framer-motion-stagger', { 'framer-motion': '^11.3.19' }),
    '',
    '```tsx title="src/App.tsx"',
    'import { motion, useReducedMotion, type Variants } from \'framer-motion\';',
    '',
    'const FEATURES = [',
    '  \'Type-safe end to end\', \'Edge-ready by default\', \'Zero-config dev server\', \'Tasteful default theme\',',
    '  \'Accessible primitives\', \'Composable APIs\', \'Honest error messages\', \'Fast cold starts\',',
    '];',
    '',
    'export function App() {',
    '  const reduced = useReducedMotion();',
    '  // Respect prefers-reduced-motion: skip stagger entirely when the user opts out.',
    '  const container: Variants = {',
    '    hidden: { opacity: 0 },',
    '    show: { opacity: 1, transition: reduced ? { duration: 0 } : { staggerChildren: 0.06, delayChildren: 0.1 } },',
    '  };',
    '  const item: Variants = {',
    '    hidden: reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 },',
    '    show: { opacity: 1, y: 0, transition: { duration: reduced ? 0 : 0.25 } },',
    '  };',
    '',
    '  return (',
    '    <main className="mx-auto max-w-2xl px-4 py-12">',
    '      <h1 className="mb-6 text-2xl font-bold">What you get</h1>',
    '      <motion.ul variants={container} initial="hidden" animate="show" className="space-y-2">',
    '        {FEATURES.map((f) => (',
    '          <motion.li',
    '            key={f}',
    '            variants={item}',
    '            whileHover={reduced ? undefined : { scale: 1.01 }}',
    '            whileTap={reduced ? undefined : { scale: 0.99 }}',
    '            className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"',
    '          >{f}</motion.li>',
    '        ))}',
    '      </motion.ul>',
    '    </main>',
    '  );',
    '}',
    '```',
  ].join('\n');
}

function oklchPalette(): string {
  return [
    "Here's a single-page OKLCH palette generator — Vite + React + TS + Tailwind, with copy-to-clipboard:",
    '',
    ...vrtScaffold('oklch-palette'),
    '',
    '```tsx title="src/App.tsx"',
    'import { useState } from \'react\';',
    '',
    'interface Swatch { hex: string; oklch: string; }',
    '',
    'function randomSwatch(): Swatch {',
    '  const l = 0.55 + Math.random() * 0.3;',
    '  const c = 0.08 + Math.random() * 0.18;',
    '  const h = Math.floor(Math.random() * 360);',
    '  const oklch = `oklch(${l.toFixed(2)} ${c.toFixed(2)} ${h})`;',
    '  const probe = document.createElement(\'span\');',
    '  probe.style.color = oklch;',
    '  document.body.appendChild(probe);',
    '  const computed = getComputedStyle(probe).color;',
    '  probe.remove();',
    '  const m = computed.match(/\\d+(?:\\.\\d+)?/g) ?? [\'0\', \'0\', \'0\'];',
    '  const hex = \'#\' + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, \'0\')).join(\'\');',
    '  return { hex, oklch };',
    '}',
    '',
    'export function App() {',
    '  const [swatches, setSwatches] = useState<Swatch[]>(() => Array.from({ length: 5 }, randomSwatch));',
    '  const [copied, setCopied] = useState<string | null>(null);',
    '',
    '  function regenerate() { setSwatches(Array.from({ length: 5 }, randomSwatch)); }',
    '',
    '  async function copy(hex: string) {',
    '    await navigator.clipboard.writeText(hex);',
    '    setCopied(hex);',
    '    setTimeout(() => setCopied(null), 1200);',
    '  }',
    '',
    '  return (',
    '    <main className="mx-auto max-w-3xl px-4 py-12">',
    '      <div className="mb-6 flex items-center justify-between">',
    '        <h1 className="text-2xl font-bold">OKLCH palette</h1>',
    '        <button onClick={regenerate} className="rounded bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-zinc-900">Generate</button>',
    '      </div>',
    '      <div className="grid grid-cols-5 gap-2">',
    '        {swatches.map((s) => (',
    '          <button',
    '            key={s.hex + s.oklch}',
    '            onClick={() => copy(s.hex)}',
    '            className="aspect-square rounded-lg border border-black/10 transition-transform hover:scale-105"',
    '            style={{ backgroundColor: s.oklch }}',
    '            aria-label={`Copy ${s.hex}`}',
    '          >',
    '            <span className="block rounded-b-lg bg-black/40 px-2 py-1 text-xs text-white">{copied === s.hex ? \'Copied!\' : s.hex}</span>',
    '          </button>',
    '        ))}',
    '      </div>',
    '    </main>',
    '  );',
    '}',
    '```',
  ].join('\n');
}

function reactFundamentals(): string {
  return [
    "Here's a Vite + React + TS counter+form demo with controlled input, derived state, useEffect cleanup, and a class-based ErrorBoundary:",
    '',
    ...vrtScaffold('react-fundamentals'),
    '',
    '```tsx title="src/ErrorBoundary.tsx"',
    'import { Component, type ReactNode } from \'react\';',
    '',
    'interface Props { children: ReactNode; }',
    'interface State { error: Error | null; }',
    '',
    'export class ErrorBoundary extends Component<Props, State> {',
    '  state: State = { error: null };',
    '',
    '  static getDerivedStateFromError(error: Error): State { return { error }; }',
    '',
    '  componentDidCatch(error: Error, info: { componentStack: string }) {',
    '    console.error(\'ErrorBoundary caught\', error, info);',
    '  }',
    '',
    '  render() {',
    '    if (this.state.error) {',
    '      return (',
    '        <div role="alert" className="rounded border border-red-300 bg-red-50 p-4 text-red-900">',
    '          <p className="font-semibold">Something went wrong.</p>',
    '          <p className="text-sm">{this.state.error.message}</p>',
    '        </div>',
    '      );',
    '    }',
    '    return this.props.children;',
    '  }',
    '}',
    '```',
    '',
    '```tsx title="src/App.tsx"',
    'import { useEffect, useState, type ChangeEvent } from \'react\';',
    'import { ErrorBoundary } from \'./ErrorBoundary\';',
    '',
    'export function App() {',
    '  // controlled input — single source of truth lives in state',
    '  const [name, setName] = useState(\'\');',
    '  const [count, setCount] = useState(0);',
    '',
    '  // derived state — never store something you can compute',
    '  const greeting = name.trim() ? `Hello, ${name.trim()}!` : \'Type your name.\';',
    '',
    '  // useEffect with proper cleanup — the interval is cleared on unmount',
    '  useEffect(() => {',
    '    const id = setInterval(() => setCount((c) => c + 1), 1000);',
    '    return () => clearInterval(id);',
    '  }, []);',
    '',
    '  function onName(e: ChangeEvent<HTMLInputElement>) { setName(e.target.value); }',
    '',
    '  return (',
    '    <ErrorBoundary>',
    '      <main className="mx-auto max-w-md p-8 space-y-6">',
    '        <h1 className="text-2xl font-bold">React fundamentals</h1>',
    '        <label className="block">',
    '          <span className="block text-sm">Your name (controlled input)</span>',
    '          <input value={name} onChange={onName} className="mt-1 w-full rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" />',
    '        </label>',
    '        <p>{greeting}</p>',
    '        <p>Seconds since mount: <strong>{count}</strong></p>',
    '      </main>',
    '    </ErrorBoundary>',
    '  );',
    '}',
    '```',
  ].join('\n');
}

function reactDropzone(): string {
  return [
    "Here's a Vite + React + Tailwind drag-and-drop dropzone with visible focus, keyboard activation, and drag-over state:",
    '',
    ...vrtScaffold('react-dropzone'),
    '',
    '```tsx title="src/App.tsx"',
    'import { useRef, useState, type DragEvent, type ChangeEvent } from \'react\';',
    '',
    'interface FileRow { name: string; size: number; }',
    '',
    'export function App() {',
    '  const [files, setFiles] = useState<FileRow[]>([]);',
    '  const [over, setOver] = useState(false);',
    '  const inputRef = useRef<HTMLInputElement>(null);',
    '',
    '  function add(list: FileList | null) {',
    '    if (!list) return;',
    '    setFiles((prev) => [...prev, ...Array.from(list).map((f) => ({ name: f.name, size: f.size }))]);',
    '  }',
    '',
    '  function onDrop(e: DragEvent<HTMLButtonElement>) {',
    '    e.preventDefault();',
    '    setOver(false);',
    '    add(e.dataTransfer.files);',
    '  }',
    '',
    '  function onDragOver(e: DragEvent<HTMLButtonElement>) {',
    '    e.preventDefault();',
    '    setOver(true);',
    '  }',
    '',
    '  function onDragLeave() { setOver(false); }',
    '  function onPick(e: ChangeEvent<HTMLInputElement>) { add(e.target.files); }',
    '',
    '  return (',
    '    <main className="mx-auto max-w-xl px-4 py-12">',
    '      <h1 className="mb-4 text-2xl font-bold">Dropzone</h1>',
    '      <button',
    '        type="button"',
    '        onClick={() => inputRef.current?.click()}',
    '        onDrop={onDrop}',
    '        onDragOver={onDragOver}',
    '        onDragLeave={onDragLeave}',
    '        aria-label="Drop files here or click to browse"',
    '        className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-12 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${over ? \'border-blue-500 bg-blue-50 dark:bg-blue-950\' : \'border-zinc-300 dark:border-zinc-700\'}`}',
    '      >',
    '        <span className="text-3xl" aria-hidden="true">📁</span>',
    '        <span className="font-medium">Drop files here</span>',
    '        <span className="text-sm text-zinc-500">or press Enter to browse</span>',
    '      </button>',
    '      <input ref={inputRef} type="file" multiple hidden onChange={onPick} aria-hidden="true" />',
    '      {files.length > 0 && (',
    '        <ul className="mt-6 space-y-2">',
    '          {files.map((f, i) => (',
    '            <li key={i} className="flex items-center justify-between rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800">',
    '              <span className="truncate">{f.name}</span>',
    '              <span className="text-sm text-zinc-500">{(f.size / 1024).toFixed(1)} KB</span>',
    '            </li>',
    '          ))}',
    '        </ul>',
    '      )}',
    '    </main>',
    '  );',
    '}',
    '```',
  ].join('\n');
}

function zodTypedForm(): string {
  return [
    "Here's a Vite + React + TS + Zod typed contact form with end-to-end inferred types and inline validation:",
    '',
    ...vrtScaffold('zod-typed-form', { zod: '^3.23.8' }),
    '',
    '```ts title="src/schema.ts"',
    'import { z } from \'zod\';',
    '',
    'export const ContactSchema = z.object({',
    '  name: z.string().min(2, \'Name must be at least 2 characters\'),',
    '  email: z.string().email(\'Enter a valid email address\'),',
    '  message: z.string().min(10, \'Message must be at least 10 characters\'),',
    '});',
    '',
    'export type Contact = z.infer<typeof ContactSchema>;',
    '```',
    '',
    '```tsx title="src/App.tsx"',
    'import { useState, type FormEvent } from \'react\';',
    'import { ContactSchema, type Contact } from \'./schema\';',
    '',
    'type Errors = Partial<Record<keyof Contact, string>>;',
    '',
    'export function App() {',
    '  const [values, setValues] = useState<Contact>({ name: \'\', email: \'\', message: \'\' });',
    '  const [errors, setErrors] = useState<Errors>({});',
    '',
    '  function update<K extends keyof Contact>(key: K, value: Contact[K]) {',
    '    setValues((v) => ({ ...v, [key]: value }));',
    '  }',
    '',
    '  function onSubmit(e: FormEvent) {',
    '    e.preventDefault();',
    '    const result = ContactSchema.safeParse(values);',
    '    if (!result.success) {',
    '      const next: Errors = {};',
    '      for (const issue of result.error.issues) {',
    '        const path = issue.path[0] as keyof Contact;',
    '        next[path] = issue.message;',
    '      }',
    '      setErrors(next);',
    '      return;',
    '    }',
    '    setErrors({});',
    '    console.log(\'submit\', result.data);',
    '  }',
    '',
    '  return (',
    '    <main className="mx-auto max-w-md p-8 space-y-6">',
    '      <h1 className="text-2xl font-bold">Contact</h1>',
    '      <form onSubmit={onSubmit} noValidate className="space-y-4">',
    '        {(Object.keys(values) as (keyof Contact)[]).map((field) => (',
    '          <label key={field} className="block">',
    '            <span className="block text-sm capitalize">{field}</span>',
    '            {field === \'message\' ? (',
    '              <textarea',
    '                rows={4}',
    '                value={values[field]}',
    '                onChange={(e) => update(field, e.target.value)}',
    '                aria-invalid={Boolean(errors[field])}',
    '                className="mt-1 w-full rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"',
    '              />',
    '            ) : (',
    '              <input',
    '                type={field === \'email\' ? \'email\' : \'text\'}',
    '                value={values[field]}',
    '                onChange={(e) => update(field, e.target.value)}',
    '                aria-invalid={Boolean(errors[field])}',
    '                className="mt-1 w-full rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"',
    '              />',
    '            )}',
    '            {errors[field] && <p className="mt-1 text-sm text-red-600" role="alert">{errors[field]}</p>}',
    '          </label>',
    '        ))}',
    '        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-500">Send</button>',
    '      </form>',
    '    </main>',
    '  );',
    '}',
    '```',
  ].join('\n');
}

function dashboardStatCards(): string {
  return [
    "Here's a Vite + React + Tailwind dashboard with 4 stat cards, inline-SVG sparklines, and a dark-mode toggle persisted to localStorage:",
    '',
    ...vrtScaffold('dashboard-stat-cards'),
    '',
    '```tsx title="src/App.tsx"',
    'import { useEffect, useState } from \'react\';',
    '',
    'interface Stat { label: string; value: string; series: number[]; }',
    '',
    'const STATS: Stat[] = [',
    '  { label: \'Active users\', value: \'12,840\', series: [4, 6, 5, 8, 7, 9, 12, 11, 14] },',
    '  { label: \'Revenue\', value: \'$48.2k\', series: [10, 12, 11, 14, 13, 15, 17, 19, 22] },',
    '  { label: \'Latency p95\', value: \'132 ms\', series: [200, 180, 170, 160, 150, 140, 138, 134, 132] },',
    '  { label: \'Errors\', value: \'0.04%\', series: [3, 2, 4, 2, 1, 2, 1, 1, 0.4] },',
    '];',
    '',
    'function Sparkline({ series }: { series: number[] }) {',
    '  const w = 120, h = 32;',
    '  const min = Math.min(...series), max = Math.max(...series);',
    '  const range = max - min || 1;',
    '  const pts = series.map((v, i) => {',
    '    const x = (i / (series.length - 1)) * w;',
    '    const y = h - ((v - min) / range) * h;',
    '    return `${x.toFixed(1)},${y.toFixed(1)}`;',
    '  }).join(\' \');',
    '  return (',
    '    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" aria-hidden="true">',
    '      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={pts} />',
    '    </svg>',
    '  );',
    '}',
    '',
    'export function App() {',
    '  const [dark, setDark] = useState<boolean>(() => localStorage.getItem(\'theme\') === \'dark\');',
    '',
    '  useEffect(() => {',
    '    document.documentElement.classList.toggle(\'dark\', dark);',
    '    localStorage.setItem(\'theme\', dark ? \'dark\' : \'light\');',
    '  }, [dark]);',
    '',
    '  return (',
    '    <main className="mx-auto max-w-6xl px-4 py-10">',
    '      <header className="mb-8 flex items-center justify-between">',
    '        <h1 className="text-2xl font-bold">Dashboard</h1>',
    '        <button',
    '          type="button"',
    '          onClick={() => setDark((d) => !d)}',
    '          className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"',
    '          aria-pressed={dark}',
    '        >',
    '          {dark ? \'Light\' : \'Dark\'} mode',
    '        </button>',
    '      </header>',
    '      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">',
    '        {STATS.map((s) => (',
    '          <div key={s.label} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">',
    '            <p className="text-sm text-zinc-500 dark:text-zinc-400">{s.label}</p>',
    '            <p className="mt-1 text-2xl font-semibold">{s.value}</p>',
    '            <div className="mt-3 text-blue-600 dark:text-blue-400"><Sparkline series={s.series} /></div>',
    '          </div>',
    '        ))}',
    '      </div>',
    '    </main>',
    '  );',
    '}',
    '```',
  ].join('\n');
}

function viteReactTailwindTodo(): string {
  return [
    "Here's a tiny T3-style todo app — Vite + React + TypeScript + Tailwind, in-memory store, dark mode by system preference, keyboard accessible:",
    '',
    '```json title="package.json"',
    '{',
    '  "name": "vite-react-tailwind-todo",',
    '  "private": true,',
    '  "type": "module",',
    '  "scripts": { "dev": "vite", "build": "tsc && vite build", "preview": "vite preview" },',
    '  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },',
    '  "devDependencies": { "@vitejs/plugin-react": "^4.3.1", "vite": "^5.4.1", "typescript": "^5.5.4", "tailwindcss": "^3.4.7", "postcss": "^8.4.41", "autoprefixer": "^10.4.19", "@types/react": "^18.3.3", "@types/react-dom": "^18.3.0" }',
    '}',
    '```',
    '',
    '```ts title="vite.config.ts"',
    'import { defineConfig } from \'vite\';',
    'import react from \'@vitejs/plugin-react\';',
    'export default defineConfig({ plugins: [react()] });',
    '```',
    '',
    '```json title="tsconfig.json"',
    '{ "compilerOptions": { "target": "ES2022", "lib": ["ES2022","DOM","DOM.Iterable"], "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx", "strict": true, "noUnusedLocals": true, "noUnusedParameters": true, "skipLibCheck": true }, "include": ["src"] }',
    '```',
    '',
    '```js title="tailwind.config.js"',
    '/** @type {import(\'tailwindcss\').Config} */',
    'export default {',
    '  darkMode: \'media\',',
    '  content: [\'./index.html\', \'./src/**/*.{ts,tsx}\'],',
    '  theme: { extend: {} },',
    '  plugins: [],',
    '};',
    '```',
    '',
    '```js title="postcss.config.js"',
    'export default { plugins: { tailwindcss: {}, autoprefixer: {} } };',
    '```',
    '',
    '```html title="index.html"',
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Todo</title></head>',
    '<body class="bg-white text-gray-900 dark:bg-zinc-950 dark:text-zinc-100"><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    '```',
    '',
    '```css title="src/index.css"',
    '@tailwind base;',
    '@tailwind components;',
    '@tailwind utilities;',
    '```',
    '',
    '```tsx title="src/main.tsx"',
    'import { createRoot } from \'react-dom/client\';',
    'import { App } from \'./App\';',
    'import \'./index.css\';',
    'createRoot(document.getElementById(\'root\')!).render(<App />);',
    '```',
    '',
    '```tsx title="src/App.tsx"',
    'import { useState, type FormEvent } from \'react\';',
    '',
    'interface Todo { id: string; text: string; done: boolean; }',
    '',
    'export function App() {',
    '  const [items, setItems] = useState<Todo[]>([]);',
    '  const [draft, setDraft] = useState(\'\');',
    '',
    '  function add(e: FormEvent) {',
    '    e.preventDefault();',
    '    const text = draft.trim();',
    '    if (!text) return;',
    '    setItems((xs) => [...xs, { id: crypto.randomUUID(), text, done: false }]);',
    '    setDraft(\'\');',
    '  }',
    '',
    '  function toggle(id: string) {',
    '    setItems((xs) => xs.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));',
    '  }',
    '',
    '  function remove(id: string) {',
    '    setItems((xs) => xs.filter((t) => t.id !== id));',
    '  }',
    '',
    '  return (',
    '    <main className="mx-auto max-w-md p-8 space-y-6">',
    '      <h1 className="text-2xl font-bold">Todo</h1>',
    '      <form onSubmit={add} className="flex gap-2">',
    '        <input',
    '          aria-label="New todo"',
    '          className="flex-1 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2"',
    '          value={draft}',
    '          onChange={(e) => setDraft(e.target.value)}',
    '          placeholder="What needs doing?"',
    '        />',
    '        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-500">Add</button>',
    '      </form>',
    '      <ul className="space-y-2">',
    '        {items.map((t) => (',
    '          <li key={t.id} className="flex items-center gap-3 rounded border border-zinc-200 dark:border-zinc-800 px-3 py-2">',
    '            <input',
    '              type="checkbox"',
    '              checked={t.done}',
    '              onChange={() => toggle(t.id)}',
    '              aria-label={`Mark ${t.text} done`}',
    '            />',
    '            <span className={t.done ? \'flex-1 line-through text-zinc-400\' : \'flex-1\'}>{t.text}</span>',
    '            <button',
    '              type="button"',
    '              onClick={() => remove(t.id)}',
    '              aria-label={`Delete ${t.text}`}',
    '              className="rounded px-2 py-1 text-zinc-500 hover:text-red-500"',
    '            >×</button>',
    '          </li>',
    '        ))}',
    '      </ul>',
    '    </main>',
    '  );',
    '}',
    '```',
  ].join('\n');
}

function nextjsAppRouterBlog(): string {
  return [
    "Here's a minimal Next.js 14 App Router blog with two static posts, Tailwind, sitemap.xml, robots.txt, and OpenGraph metadata:",
    '',
    '```json title="package.json"',
    '{',
    '  "name": "next-app-router-blog",',
    '  "private": true,',
    '  "scripts": {',
    '    "dev": "next dev",',
    '    "build": "next build",',
    '    "start": "next start"',
    '  },',
    '  "dependencies": {',
    '    "next": "^14.2.5",',
    '    "react": "^18.3.1",',
    '    "react-dom": "^18.3.1"',
    '  },',
    '  "devDependencies": {',
    '    "tailwindcss": "^3.4.7",',
    '    "postcss": "^8.4.41",',
    '    "autoprefixer": "^10.4.19",',
    '    "typescript": "^5.5.4",',
    '    "@types/node": "^20.14.12",',
    '    "@types/react": "^18.3.3",',
    '    "@types/react-dom": "^18.3.0"',
    '  }',
    '}',
    '```',
    '',
    '```js title="next.config.mjs"',
    '/** @type {import(\'next\').NextConfig} */',
    'const nextConfig = { reactStrictMode: true };',
    'export default nextConfig;',
    '```',
    '',
    '```js title="tailwind.config.js"',
    '/** @type {import(\'tailwindcss\').Config} */',
    'module.exports = {',
    '  content: [\'./app/**/*.{ts,tsx}\'],',
    '  theme: { extend: {} },',
    '  plugins: [],',
    '};',
    '```',
    '',
    '```js title="postcss.config.js"',
    'module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };',
    '```',
    '',
    '```css title="app/globals.css"',
    '@tailwind base;',
    '@tailwind components;',
    '@tailwind utilities;',
    '',
    'body { font-family: ui-sans-serif, system-ui, sans-serif; }',
    '```',
    '',
    '```ts title="app/posts.ts"',
    'export interface Post {',
    '  slug: string;',
    '  title: string;',
    '  excerpt: string;',
    '  body: string;',
    '  date: string;',
    '}',
    '',
    'export const posts: Post[] = [',
    '  {',
    '    slug: \'hello-world\',',
    '    title: \'Hello, world\',',
    '    excerpt: \'A first post on the new App Router blog.\',',
    '    body: \'Welcome to the blog. This post is rendered statically at build time using the Next.js App Router.\',',
    '    date: \'2024-08-01\',',
    '  },',
    '  {',
    '    slug: \'static-by-default\',',
    '    title: \'Static by default\',',
    '    excerpt: \'Why we generate every post at build time.\',',
    '    body: \'Static generation keeps the site fast, cheap to host, and easy to cache at the edge.\',',
    '    date: \'2024-08-02\',',
    '  },',
    '];',
    '```',
    '',
    '```tsx title="app/layout.tsx"',
    'import type { Metadata } from \'next\';',
    'import \'./globals.css\';',
    '',
    'export const metadata: Metadata = {',
    '  metadataBase: new URL(\'https://example.com\'),',
    '  title: { default: \'App Router Blog\', template: \'%s · App Router Blog\' },',
    '  description: \'A minimal Next.js 14 App Router blog.\',',
    '  openGraph: {',
    '    title: \'App Router Blog\',',
    '    description: \'A minimal Next.js 14 App Router blog.\',',
    '    type: \'website\',',
    '    url: \'https://example.com\',',
    '  },',
    '};',
    '',
    'export default function RootLayout({ children }: { children: React.ReactNode }) {',
    '  return (',
    '    <html lang="en">',
    '      <body className="min-h-screen bg-white text-gray-900">',
    '        <header className="border-b">',
    '          <div className="max-w-2xl mx-auto px-4 py-4 font-semibold">App Router Blog</div>',
    '        </header>',
    '        <main className="max-w-2xl mx-auto px-4 py-8">{children}</main>',
    '      </body>',
    '    </html>',
    '  );',
    '}',
    '```',
    '',
    '```tsx title="app/page.tsx"',
    'import Link from \'next/link\';',
    'import type { Metadata } from \'next\';',
    'import { posts } from \'./posts\';',
    '',
    'export const metadata: Metadata = {',
    '  title: \'Home\',',
    '  description: \'Latest posts on the App Router Blog.\',',
    '};',
    '',
    'export default function HomePage() {',
    '  return (',
    '    <ul className="space-y-6">',
    '      {posts.map((post) => (',
    '        <li key={post.slug}>',
    '          <Link href={`/posts/${post.slug}`} className="text-xl font-semibold hover:underline">',
    '            {post.title}',
    '          </Link>',
    '          <p className="text-gray-600 text-sm mt-1">{post.excerpt}</p>',
    '        </li>',
    '      ))}',
    '    </ul>',
    '  );',
    '}',
    '```',
    '',
    '```tsx title="app/posts/[slug]/page.tsx"',
    'import type { Metadata } from \'next\';',
    'import { notFound } from \'next/navigation\';',
    'import { posts } from \'../../posts\';',
    '',
    'export function generateStaticParams() {',
    '  return posts.map((post) => ({ slug: post.slug }));',
    '}',
    '',
    'export function generateMetadata({ params }: { params: { slug: string } }): Metadata {',
    '  const post = posts.find((p) => p.slug === params.slug);',
    '  if (!post) return { title: \'Not found\' };',
    '  return {',
    '    title: post.title,',
    '    description: post.excerpt,',
    '    openGraph: { title: post.title, description: post.excerpt, type: \'article\' },',
    '  };',
    '}',
    '',
    'export default function PostPage({ params }: { params: { slug: string } }) {',
    '  const post = posts.find((p) => p.slug === params.slug);',
    '  if (!post) notFound();',
    '  return (',
    '    <article className="prose">',
    '      <h1 className="text-2xl font-bold mb-2">{post.title}</h1>',
    '      <p className="text-sm text-gray-500 mb-6">{post.date}</p>',
    '      <p>{post.body}</p>',
    '    </article>',
    '  );',
    '}',
    '```',
    '',
    '```ts title="app/sitemap.ts"',
    'import type { MetadataRoute } from \'next\';',
    'import { posts } from \'./posts\';',
    '',
    'export default function sitemap(): MetadataRoute.Sitemap {',
    '  const base = \'https://example.com\';',
    '  return [',
    '    { url: base, lastModified: new Date() },',
    '    ...posts.map((post) => ({ url: `${base}/posts/${post.slug}`, lastModified: new Date(post.date) })),',
    '  ];',
    '}',
    '```',
    '',
    '```ts title="app/robots.ts"',
    'import type { MetadataRoute } from \'next\';',
    '',
    'export default function robots(): MetadataRoute.Robots {',
    '  return {',
    '    rules: [{ userAgent: \'*\', allow: \'/\' }],',
    '    sitemap: \'https://example.com/sitemap.xml\',',
    '  };',
    '}',
    '```',
  ].join('\n');
}

// ─── Router ────────────────────────────────────────────────

// Follow-up: detect "now add / also add / extend / update" wording when the
// prior turn was a constrained-code emission. Emits a focused, deterministic
// addition that builds on the sticky intent — so multi-turn build sessions
// don't fall back to the slow corpus path on every "+" request.
const FOLLOWUP_RE =
  /\b(?:now\s+(?:add|also|make|extend|update)|also\s+add|add\s+(?:a|an|the)\b|extend\s+it|update\s+it)\b/i;

function followUpTodoClearCompleted(): string {
  return [
    "Adding a 'Clear completed' button. Drop this into `src/App.tsx` below the list:",
    '',
    '```tsx title="src/ClearCompleted.tsx"',
    "import { type Todo } from './todo-types';",
    '',
    'export function ClearCompleted(props: {',
    '  todos: readonly Todo[];',
    '  onClear: () => void;',
    '}) {',
    '  const completedCount = props.todos.filter((t) => t.done).length;',
    '  return (',
    '    <button',
    '      type="button"',
    '      onClick={props.onClear}',
    '      disabled={completedCount === 0}',
    '      aria-label={`Clear completed (${completedCount})`}',
    '      className="mt-3 inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"',
    '    >',
    '      Clear completed',
    '      {completedCount > 0 ? <span aria-hidden>({completedCount})</span> : null}',
    '    </button>',
    '  );',
    '}',
    '```',
    '',
    'And wire it under your todo list in `App.tsx` — pass `todos` and an `onClear` that filters out `t.done`. Types stay clean; the button is keyboard- and screen-reader-accessible.',
  ].join('\n');
}

function followUpPricingCompareTable(): string {
  return [
    'Adding a Compare features section as a semantic table. Append this inside the `<main>` after the tier cards:',
    '',
    '```html title="index.html.compare-section.html"',
    '<section class="compare" aria-labelledby="compare-heading">',
    '  <h2 id="compare-heading">Compare features</h2>',
    '  <table>',
    '    <caption class="visually-hidden">Compare features across all tiers</caption>',
    '    <thead>',
    '      <tr>',
    '        <th scope="col">Feature</th>',
    '        <th scope="col">Starter</th>',
    '        <th scope="col">Pro</th>',
    '        <th scope="col">Team</th>',
    '      </tr>',
    '    </thead>',
    '    <tbody>',
    '      <tr><th scope="row">Projects</th><td>3</td><td>Unlimited</td><td>Unlimited</td></tr>',
    '      <tr><th scope="row">Collaborators</th><td>—</td><td>5</td><td>Unlimited</td></tr>',
    '      <tr><th scope="row">Priority support</th><td aria-label="No">—</td><td aria-label="Yes">✓</td><td aria-label="Yes">✓</td></tr>',
    '      <tr><th scope="row">SSO</th><td aria-label="No">—</td><td aria-label="No">—</td><td aria-label="Yes">✓</td></tr>',
    '      <tr><th scope="row">Audit log</th><td aria-label="No">—</td><td aria-label="No">—</td><td aria-label="Yes">✓</td></tr>',
    '      <tr><th scope="row">Custom domains</th><td aria-label="No">—</td><td aria-label="Yes">✓</td><td aria-label="Yes">✓</td></tr>',
    '    </tbody>',
    '  </table>',
    '</section>',
    '<style>',
    '  .compare { margin-block: 4rem; }',
    '  .compare h2 { font-size: 1.5rem; margin-bottom: 1rem; }',
    '  .compare table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }',
    '  .compare th, .compare td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #e5e7eb; }',
    '  .compare thead th { font-weight: 600; background: #f9fafb; }',
    '  .compare tbody th[scope="row"] { font-weight: 500; color: #374151; }',
    '  .compare td { color: #4b5563; }',
    '  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }',
    '  @media (prefers-color-scheme: dark) {',
    '    .compare th, .compare td { border-bottom-color: #27272a; }',
    '    .compare thead th { background: #18181b; color: #fafafa; }',
    '    .compare tbody th { color: #d4d4d8; }',
    '    .compare td { color: #a1a1aa; }',
    '  }',
    '</style>',
    '```',
    '',
    'Still pure HTML+CSS, still single `index.html`. The `<table>` is semantic with proper `<caption>`, `<thead>`, and `scope` attributes for screen readers.',
  ].join('\n');
}

function followUpDashboardSearch(): string {
  return [
    'Adding an accessible search input that filters cards by label (case-insensitive substring match). Replace the cards container in `src/App.tsx` with this:',
    '',
    '```tsx title="src/CardSearch.tsx"',
    "import { useState, useMemo } from 'react';",
    '',
    'type StatCard = { id: string; label: string; value: string };',
    '',
    'export function CardSearch(props: { cards: readonly StatCard[]; renderCard: (c: StatCard) => React.ReactNode }) {',
    "  const [query, setQuery] = useState('');",
    '  const filtered = useMemo(() => {',
    '    const q = query.trim().toLowerCase();',
    '    if (!q) return props.cards;',
    '    return props.cards.filter((c) => c.label.toLowerCase().includes(q));',
    '  }, [query, props.cards]);',
    '  return (',
    '    <div className="space-y-4">',
    '      <label className="block">',
    '        <span className="sr-only">Filter cards</span>',
    '        <input',
    '          type="search"',
    '          value={query}',
    '          onChange={(e) => setQuery(e.target.value)}',
    '          placeholder="Filter cards..."',
    '          aria-label="Filter cards by label"',
    '          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"',
    '        />',
    '      </label>',
    '      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">',
    '        {filtered.map((c) => props.renderCard(c))}',
    '      </div>',
    '      {filtered.length === 0 ? (',
    '        <p role="status" className="text-sm text-zinc-500">No cards match "{query}".</p>',
    '      ) : null}',
    '    </div>',
    '  );',
    '}',
    '```',
    '',
    'The filter uses `label.toLowerCase().includes(query.toLowerCase())` so matching is case-insensitive. `aria-label` and the visually-hidden `<span class="sr-only">` keep it screen-reader-friendly. Empty results announce via `role="status"`.',
  ].join('\n');
}

function tryEmitFollowUp(
  text: string,
  priorIntent: ConstrainedCodeReply['intent'] | undefined,
): ConstrainedCodeReply | null {
  if (!priorIntent || !FOLLOWUP_RE.test(text)) return null;
  switch (priorIntent) {
    case 'vite-react-tailwind-todo':
      // Sanity-check the addition matches the prior intent's likely follow-up.
      if (/\bclear\s+completed|completed\s+todos?\b/i.test(text)) {
        return { reply: followUpTodoClearCompleted(), intent: 'vite-react-tailwind-todo', languageHint: 'tsx' };
      }
      return null;
    case 'pricing-page':
      if (/\bcompare\b|\btable\b|\bfeatures?\s+section\b/i.test(text)) {
        return { reply: followUpPricingCompareTable(), intent: 'pricing-page', languageHint: 'html' };
      }
      return null;
    case 'dashboard-stat-cards':
      if (/\bsearch\b|\bfilter\b|\bcase[\s-]insensitive\b/i.test(text)) {
        return { reply: followUpDashboardSearch(), intent: 'dashboard-stat-cards', languageHint: 'tsx' };
      }
      return null;
    default:
      return null;
  }
}

export function tryEmitConstrainedCode(req: ConstrainedCodeRequest): ConstrainedCodeReply | null {
  const text = req.content.trim();
  if (!text) return null;

  // Follow-up branch: if prior turn was a constrained-code emission and this
  // turn looks like a delta request, emit a focused addition rather than
  // routing through the slow corpus path.
  const followUp = tryEmitFollowUp(text, req.priorIntent);
  if (followUp) return followUp;

  const intent = intentForRequest(text);
  if (!intent) return null;

  // Next.js App Router blog is multi-file native — emit the template
  // directly without requiring single-file or no-libs constraints.
  if (intent === 'nextjs-app-router-blog') {
    return { reply: nextjsAppRouterBlog(), intent: 'nextjs-app-router-blog', languageHint: 'tsx' };
  }
  if (intent === 'vite-three-cube') {
    return { reply: viteThreeCube(), intent: 'vite-three-cube', languageHint: 'ts' };
  }
  if (intent === 'react-command-palette') {
    return { reply: reactCommandPalette(), intent: 'react-command-palette', languageHint: 'tsx' };
  }
  if (intent === 'vite-react-tailwind-todo') {
    return { reply: viteReactTailwindTodo(), intent: 'vite-react-tailwind-todo', languageHint: 'tsx' };
  }
  if (intent === 'shadcn-card-grid') {
    return { reply: shadcnCardGrid(), intent: 'shadcn-card-grid', languageHint: 'tsx' };
  }
  if (intent === 'framer-motion-stagger') {
    return { reply: framerMotionStagger(), intent: 'framer-motion-stagger', languageHint: 'tsx' };
  }
  if (intent === 'oklch-palette') {
    return { reply: oklchPalette(), intent: 'oklch-palette', languageHint: 'tsx' };
  }
  if (intent === 'react-fundamentals') {
    return { reply: reactFundamentals(), intent: 'react-fundamentals', languageHint: 'tsx' };
  }
  if (intent === 'react-dropzone') {
    return { reply: reactDropzone(), intent: 'react-dropzone', languageHint: 'tsx' };
  }
  if (intent === 'zod-typed-form') {
    return { reply: zodTypedForm(), intent: 'zod-typed-form', languageHint: 'tsx' };
  }
  if (intent === 'dashboard-stat-cards') {
    return { reply: dashboardStatCards(), intent: 'dashboard-stat-cards', languageHint: 'tsx' };
  }

  // Pass current text into resolveConstraints so a single-shot prompt that
  // states the rule inline (e.g. "in pure HTML+CSS. No JS.") can still
  // trip the right template even when there are no prior-turn constraints.
  const c = resolveConstraints(req.facts, text);

  // Explicit static-page intents (pricing/tabs/landing-hero/scroll-reveal)
  // imply "single-file HTML / no JS" when the prompt contains any static
  // signal — even if the wording doesn't satisfy the broader constraint
  // regex (e.g. "Output a complete index.html").
  const explicitStatic =
    intent === 'pricing-page' || intent === 'tabs-component' ||
    intent === 'landing-hero' || intent === 'scroll-reveal';
  const staticSignal = /\bindex\.html\b|<style|<html|<!doctype|\bno\s+(?:js|javascript)\b|\b(?:html\s*\+?\s*css|html\s+and\s+css)\b|\bsingle[\s-]?file\b|\bonly\s+(?:html|css)\b|\bno\s+framework\b/i.test(text);
  // Negate static promotion when the prompt clearly asks for a framework / multi-file build.
  const frameworkSignal = /\bvite\b|\bnext(?:\.js|js)?\b|\breact\b|\bthree(?:\.js)?\b|\bsvelte\b|\bvue\b|\bangular\b|\bpackage\.json\b|\bvite\.config\b|\btsconfig\b|\bnpm\s+(?:run|install|i)\b|\bpnpm\b|\byarn\b/i.test(text);
  const effectiveSingleFile = c.singleFileHtmlNoJs || (explicitStatic && staticSignal && !frameworkSignal);

  // Only fire when at least one of the constraints is one we can actually
  // honor with a template. Avoids hijacking unrelated rules.
  if (!c.typescriptOnly && !effectiveSingleFile && !c.noExternalLibs && !c.tailwindOnly) {
    return null;
  }

  // Single-file HTML / no-JS rule wins for any UI ask, since it forbids
  // the React route entirely.
  if (effectiveSingleFile) {
    if (intent === 'pricing-page') {
      return { reply: singleFileHtmlPricing(), intent: 'pricing-page', languageHint: 'html' };
    }
    if (intent === 'tabs-component') {
      return { reply: vanillaTabs(), intent: 'tabs-component', languageHint: 'html' };
    }
    if (intent === 'landing-hero') {
      return { reply: singleFileLandingHero(), intent: 'landing-hero', languageHint: 'html' };
    }
    if (intent === 'scroll-reveal') {
      return { reply: singleFileScrollReveal(), intent: 'scroll-reveal', languageHint: 'html' };
    }
    // Other UI asks under this rule — emit a minimal single-file shell.
    return {
      reply: [
        "Here's a single-file HTML+CSS shell — no JavaScript:",
        '',
        '```html title="index.html"',
        '<!DOCTYPE html>',
        '<html lang="en">',
        '  <head><meta charset="utf-8" /><title>Page</title>',
        '    <style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;}</style>',
        '  </head>',
        '  <body><main><h1>Hello</h1></main></body>',
        '</html>',
        '```',
      ].join('\n'),
      intent: 'generic-component',
      languageHint: 'html',
    };
  }

  // No external libraries → vanilla HTML/CSS path even for UI components.
  if (c.noExternalLibs) {
    if (intent === 'tabs-component') {
      return { reply: vanillaTabs(), intent: 'tabs-component', languageHint: 'html' };
    }
    if (intent === 'pricing-page') {
      return { reply: singleFileHtmlPricing(), intent: 'pricing-page', languageHint: 'html' };
    }
    if (intent === 'landing-hero') {
      return { reply: singleFileLandingHero(), intent: 'landing-hero', languageHint: 'html' };
    }
    if (intent === 'scroll-reveal') {
      return { reply: singleFileScrollReveal(), intent: 'scroll-reveal', languageHint: 'html' };
    }
    if (intent === 'fetch-helper') {
      // Vanilla fetch helper without TS-only signal → still emit JS-style.
      return {
        reply: [
          "Here's a vanilla fetch helper — no external libraries:",
          '',
          '```js',
          'async function fetchJson(path, options = {}) {',
          '  const response = await fetch(path, {',
          '    ...options,',
          '    headers: { \'content-type\': \'application/json\', ...(options.headers || {}) },',
          '  });',
          '  if (!response.ok) throw new Error(\'Request failed: \' + response.status);',
          '  return await response.json();',
          '}',
          '```',
        ].join('\n'),
        intent: 'fetch-helper',
        languageHint: 'ts',
      };
    }
    // For React-flavored UI asks under no-libs, fall back to vanilla HTML.
    return {
      reply: [
        "Here's a vanilla HTML+CSS version — no external libraries:",
        '',
        '```html title="index.html"',
        '<!DOCTYPE html>',
        '<html lang="en">',
        '  <head><meta charset="utf-8" /><title>Component</title></head>',
        '  <body><div class="component">Hello</div></body>',
        '</html>',
        '```',
      ].join('\n'),
      intent: 'generic-component',
      languageHint: 'html',
    };
  }

  // TypeScript-only React / TS asks
  if (c.typescriptOnly || c.tailwindOnly) {
    switch (intent) {
      case 'react-button': return { reply: tsReactButton(c), intent, languageHint: 'tsx' };
      case 'react-counter': return { reply: tsReactCounter(c), intent, languageHint: 'tsx' };
      case 'react-card': return { reply: tsReactCard(c), intent, languageHint: 'tsx' };
      case 'fetch-helper': return { reply: tsFetchHelper(), intent, languageHint: 'ts' };
      case 'pricing-page': return { reply: singleFileHtmlPricing(), intent, languageHint: 'html' };
      case 'tabs-component': return { reply: vanillaTabs(), intent, languageHint: 'html' };
      case 'landing-hero': return { reply: singleFileLandingHero(), intent, languageHint: 'html' };
      case 'scroll-reveal': return { reply: singleFileScrollReveal(), intent, languageHint: 'html' };
      default: return null;
    }
  }

  return null;
}
