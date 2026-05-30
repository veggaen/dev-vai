import { buildReactViteTsApp } from '../compose-builder-app.js';

/**
 * Vai's shared app-shell capability.
 *
 * Any recipe (or any future generation path) can produce a polished,
 * responsive, landing-style app by supplying only its own interactive body.
 * The hero, design system, typography, and responsive breakpoints are owned
 * here so improvements propagate to every app Vai generates.
 */

export interface AppShellHero {
  readonly badge?: string;
  readonly title: string;
  readonly accentWord?: string;
  readonly subtitle: string;
  readonly pills?: readonly string[];
}

export interface AppShellTheme {
  readonly accent?: string;
  readonly accent2?: string;
}

export interface AppShellInput {
  readonly packageName: string;
  readonly title: string;
  readonly hero: AppShellHero;
  /** JSX string for the app body, rendered inside the shell `<main>` after the hero. */
  readonly bodyJsx: string;
  /** Optional extra import lines / hook code injected at top of App.tsx (above `export default`). */
  readonly topMatter?: string;
  /** Optional extra hook / function code injected inside App() before `return`. */
  readonly setupCode?: string;
  /** Optional recipe-specific CSS appended after the design system. */
  readonly extraCss?: string;
  readonly theme?: AppShellTheme;
}

function escapeJsxText(text: string): string {
  return text.replace(/[{}]/g, (m) => `{'${m}'}`);
}

function renderHero(hero: AppShellHero): string {
  const titleSafe = escapeJsxText(hero.title);
  let titleJsx: string;
  if (hero.accentWord && hero.title.includes(hero.accentWord)) {
    const [before, ...rest] = hero.title.split(hero.accentWord);
    const after = rest.join(hero.accentWord);
    titleJsx = `${escapeJsxText(before)}<span className="vai-hero-accent">${escapeJsxText(hero.accentWord)}</span>${escapeJsxText(after)}`;
  } else {
    titleJsx = titleSafe;
  }

  const badgeJsx = hero.badge
    ? `        <div className="vai-eyebrow"><span className="vai-eyebrow-dot" />${escapeJsxText(hero.badge)}</div>\n`
    : '';

  const pillsJsx = hero.pills && hero.pills.length > 0
    ? `        <p className="vai-hero-meta">${hero.pills.map((p) => escapeJsxText(p)).join(' · ')}</p>\n`
    : '';

  return [
    '      <header className="vai-hero">',
    badgeJsx.trimEnd(),
    `        <h1 className="vai-hero-title">${titleJsx}</h1>`,
    `        <p className="vai-hero-sub">${escapeJsxText(hero.subtitle)}</p>`,
    pillsJsx.trimEnd(),
    '      </header>',
  ].filter(Boolean).join('\n');
}

function getDesignSystemCss(theme: AppShellTheme): string {
  const accent = theme.accent ?? '#7c5cff';
  const accent2 = theme.accent2 ?? '#ff5ca8';
  return `:root {
  color-scheme: dark;
  --vai-bg: #07070a;
  --vai-bg-soft: #0d0d12;
  --vai-surface: #131318;
  --vai-surface-2: #1a1a22;
  --vai-border: #23232c;
  --vai-border-strong: #34343f;
  --vai-text: #f5f5f7;
  --vai-muted: #8b8b95;
  --vai-accent: ${accent};
  --vai-accent-2: ${accent2};
  --vai-success: #4ade80;
  --vai-danger: #f0566f;
  --vai-radius: 10px;
  --vai-radius-sm: 6px;
}

* { box-sizing: border-box; }
html, body, #root { margin: 0; padding: 0; min-height: 100vh; }
body {
  font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  background: var(--vai-bg);
  color: var(--vai-text);
  -webkit-font-smoothing: antialiased;
  background-image:
    radial-gradient(60% 40% at 50% 0%, ${accent}1f 0%, ${accent}00 60%),
    radial-gradient(40% 30% at 90% 10%, ${accent2}1a 0%, ${accent2}00 60%);
  background-attachment: fixed;
  background-repeat: no-repeat;
}
button { font-family: inherit; }
input, textarea, select { font-family: inherit; }
:focus-visible { outline: 2px solid var(--vai-accent); outline-offset: 2px; border-radius: 4px; }

.vai-app {
  max-width: 760px;
  margin: 0 auto;
  padding: clamp(28px, 6vw, 80px) clamp(16px, 4vw, 28px) 96px;
  display: flex;
  flex-direction: column;
  gap: clamp(20px, 3vw, 32px);
  animation: vaiAppIn 480ms cubic-bezier(.2,.7,.2,1) both;
}
@keyframes vaiAppIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

.vai-hero { text-align: left; display: flex; flex-direction: column; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--vai-border); }
.vai-eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--vai-muted);
}
.vai-eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vai-accent); box-shadow: 0 0 10px ${accent}80; }
.vai-hero-title {
  margin: 0; font-size: clamp(30px, 5.2vw, 46px); font-weight: 700;
  letter-spacing: -0.025em; line-height: 1.08;
}
.vai-hero-accent {
  background: linear-gradient(135deg, var(--vai-accent) 0%, var(--vai-accent-2) 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.vai-hero-sub {
  margin: 0; max-width: 560px; color: var(--vai-muted);
  font-size: clamp(14px, 1.5vw, 15px); line-height: 1.55;
}
.vai-hero-meta {
  margin: 4px 0 0; color: var(--vai-muted);
  font-size: 12px; letter-spacing: 0.01em;
}

.vai-card {
  background: var(--vai-surface);
  border: 1px solid var(--vai-border);
  border-radius: var(--vai-radius);
}
`;
}

/**
 * Compose a polished, responsive app from a body. Vai's standard shell.
 */
export function composeAppShell(input: AppShellInput): string {
  const heroJsx = renderHero(input.hero);
  const appTsx = `import { useEffect, useMemo, useRef, useState } from 'react';
${input.topMatter ?? ''}
export default function App() {
${input.setupCode ?? ''}
  return (
    <main className="vai-app">
${heroJsx}
${input.bodyJsx}
    </main>
  );
}
`;
  const stylesCss = getDesignSystemCss(input.theme ?? {})
    + (input.extraCss ? `\n${input.extraCss}` : '');
  return buildReactViteTsApp({
    packageName: input.packageName,
    title: input.title,
    appTsx,
    stylesCss,
  });
}
