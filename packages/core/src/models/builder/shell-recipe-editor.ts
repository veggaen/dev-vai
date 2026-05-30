/**
 * Vai shell-recipe chat editor.
 *
 * Given the last assistant message that produced an app via composeAppShell,
 * apply a chat-driven edit (text swap, title/subtitle/badge change, accent
 * color, simple style swaps) by patching the existing App.tsx and/or
 * styles.css. Emits ONLY the changed file blocks so the sandbox does a
 * partial update instead of a full re-deploy.
 *
 * Returns null when the edit prompt isn't understood or the prior message
 * isn't a shell-recipe app — caller falls through to the normal builder.
 */

const FENCE = String.fromCharCode(96).repeat(3);
const QUOTE_CLASS = '["\u2018\u2019\u201c\u201d\u2032\u2033\u00ab\u00bb`\u2019\u201a\u201b\u201e\u201f\'\u2039\u203a]';

const COLOR_MAP: Record<string, [string, string]> = {
  red: ['#f0566f', '#ff8a5c'],
  orange: ['#ff6b5c', '#ffb05c'],
  amber: ['#f59e0b', '#fde047'],
  yellow: ['#fde047', '#fbbf24'],
  green: ['#4ade80', '#22c55e'],
  emerald: ['#10b981', '#5ce1ff'],
  teal: ['#14b8a6', '#5ce1ff'],
  cyan: ['#5ce1ff', '#7c5cff'],
  sky: ['#38bdf8', '#7c5cff'],
  blue: ['#3b82f6', '#7c5cff'],
  indigo: ['#6366f1', '#a78bfa'],
  purple: ['#7c5cff', '#ff5ca8'],
  violet: ['#a78bfa', '#7c5cff'],
  pink: ['#ff5ca8', '#7c5cff'],
  rose: ['#fb7185', '#ff8a5c'],
  monochrome: ['#f5f5f7', '#8b8b95'],
  mono: ['#f5f5f7', '#8b8b95'],
  white: ['#f5f5f7', '#8b8b95'],
};

const STYLE_PRESETS: Record<string, { accent: string; accent2: string; bg: string; surface: string; border: string; text: string; muted: string; radius: string; radiusSm: string }> = {
  brutalist: {
    accent: '#ffeb00', accent2: '#ff3366', bg: '#fafaf6', surface: '#ffffff', border: '#000000', text: '#000000', muted: '#444444', radius: '0px', radiusSm: '0px',
  },
  minimal: {
    accent: '#000000', accent2: '#666666', bg: '#ffffff', surface: '#fafafa', border: '#e5e5e5', text: '#111111', muted: '#888888', radius: '4px', radiusSm: '2px',
  },
  terminal: {
    accent: '#00ff88', accent2: '#00ddff', bg: '#000000', surface: '#0a0f0a', border: '#1a2b1a', text: '#00ff88', muted: '#4a7a4a', radius: '0px', radiusSm: '0px',
  },
  glassmorphism: {
    accent: '#7c5cff', accent2: '#ff5ca8', bg: '#0a0a14', surface: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.12)', text: '#f5f5f7', muted: '#a5a5b5', radius: '16px', radiusSm: '10px',
  },
  playful: {
    accent: '#ff5ca8', accent2: '#fde047', bg: '#1a0a2e', surface: '#241640', border: '#3a2860', text: '#fff5e6', muted: '#b89cd6', radius: '20px', radiusSm: '14px',
  },
};

export interface ShellRecipeEdit {
  readonly kind: 'text-swap' | 'subtitle' | 'title' | 'badge' | 'accent' | 'style-preset' | 'add-scroll-animations' | 'add-loading-animation';
  readonly from?: string;
  readonly to: string;
}

function extractCodeBlock(content: string, title: string): { fenceLine: string; body: string } | null {
  const re = new RegExp(`^${FENCE}([a-zA-Z]+)\\s+title=["']${title.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}["']\\s*$`, 'm');
  const m = content.match(re);
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length + 1;
  const closeRe = new RegExp(`^${FENCE}\\s*$`, 'm');
  const rest = content.slice(start);
  const closeMatch = rest.match(closeRe);
  if (!closeMatch || closeMatch.index === undefined) return null;
  return { fenceLine: m[0], body: rest.slice(0, closeMatch.index).replace(/\n$/, '') };
}

function isShellRecipeApp(content: string): boolean {
  return /className="vai-app"/.test(content) && /className="vai-hero"/.test(content);
}

function parseEdit(input: string): ShellRecipeEdit | null {
  const swap = input.match(new RegExp(`(?:change|replace|swap|set|update)\\s+(?:the\\s+)?(?:text\\s+)?${QUOTE_CLASS}([^${QUOTE_CLASS.slice(1, -1)}]{2,200})${QUOTE_CLASS}\\s+(?:to|with|into)\\s+${QUOTE_CLASS}([^${QUOTE_CLASS.slice(1, -1)}]{1,400})${QUOTE_CLASS}`, 'i'));
  if (swap) return { kind: 'text-swap', from: swap[1].trim(), to: swap[2].trim() };

  const subtitle = input.match(new RegExp(`(?:change|set|update|make)\\s+(?:the\\s+)?(?:subtitle|sub[\\s-]?title|tagline|lede|hero\\s+sub(?:title)?|description)\\s+(?:to|read|say)\\s+${QUOTE_CLASS}([^${QUOTE_CLASS.slice(1, -1)}]{1,400})${QUOTE_CLASS}`, 'i'));
  if (subtitle) return { kind: 'subtitle', to: subtitle[1].trim() };

  const title = input.match(new RegExp(`(?:change|set|update|make)\\s+(?:the\\s+)?(?:hero\\s+)?(?:title|headline|h1|main\\s+heading)\\s+(?:to|read|say)\\s+${QUOTE_CLASS}([^${QUOTE_CLASS.slice(1, -1)}]{1,200})${QUOTE_CLASS}`, 'i'));
  if (title) return { kind: 'title', to: title[1].trim() };

  const badge = input.match(new RegExp(`(?:change|set|update|make)\\s+(?:the\\s+)?(?:badge|eyebrow|kicker|tag)\\s+(?:to|read|say)\\s+${QUOTE_CLASS}([^${QUOTE_CLASS.slice(1, -1)}]{1,80})${QUOTE_CLASS}`, 'i'));
  if (badge) return { kind: 'badge', to: badge[1].trim() };

  const preset = input.match(/\b(?:use|switch to|apply|make it|change to)\s+(?:a\s+)?(brutalist|minimal|minimalist|terminal|hacker|glassmorphism|glass|playful|fun)\s+(?:style|theme|look|design|aesthetic|vibe)?/i);
  if (preset) {
    const key = preset[1].toLowerCase();
    const normalized = key === 'minimalist' ? 'minimal' : key === 'hacker' ? 'terminal' : key === 'glass' ? 'glassmorphism' : key === 'fun' ? 'playful' : key;
    return { kind: 'style-preset', to: normalized };
  }

  const accentNamed = input.match(/\b(?:change|set|update|use|make)\s+(?:the\s+)?(?:accent|theme|primary|brand)\s+(?:color|colour)?\s*(?:to|as)\s+(red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|purple|violet|pink|rose|monochrome|mono|white)\b/i);
  if (accentNamed) return { kind: 'accent', to: accentNamed[1].toLowerCase() };

  const accentHex = input.match(/\b(?:change|set|update|use|make)\s+(?:the\s+)?(?:accent|theme|primary|brand)\s+(?:color|colour)?\s*(?:to|as)\s+(#[0-9a-f]{3,8})\b/i);
  if (accentHex) return { kind: 'accent', to: accentHex[1] };

  if (/\b(?:add|enable|include)\s+(?:some\s+|nice\s+)?(?:fade|slide|reveal|scroll|on[-\s]?scroll|in[-\s]?view)\s+(?:in\s+)?animations?\b/i.test(input)
    || /\b(?:add|enable)\s+scroll[-\s]?(?:reveal|in|animations?)\b/i.test(input)) {
    return { kind: 'add-scroll-animations', to: 'scroll' };
  }
  if (/\b(?:add|enable|include|show)\s+(?:a\s+)?(?:loading|loader|spinner|skeleton|splash)\s+(?:animation|state|screen)?\b/i.test(input)) {
    return { kind: 'add-loading-animation', to: 'loading' };
  }

  return null;
}

function escapeJsxText(text: string): string {
  return text.replace(/[{}]/g, (m) => `{'${m}'}`);
}

function applyTextSwap(appTsx: string, cssBody: string | null, from: string, to: string): { appTsx: string; cssBody: string | null } | null {
  // Strict substring (case-sensitive) — safer than regex for arbitrary text.
  if (!appTsx.includes(from) && (!cssBody || !cssBody.includes(from))) return null;
  const newApp = appTsx.split(from).join(to);
  const newCss = cssBody ? cssBody.split(from).join(to) : null;
  return { appTsx: newApp, cssBody: newCss };
}

function applySubtitle(appTsx: string, to: string): string | null {
  const re = /(<p className="vai-hero-sub">)([\s\S]*?)(<\/p>)/;
  if (!re.test(appTsx)) return null;
  return appTsx.replace(re, (_match, open, _inner, close) => `${open}${escapeJsxText(to)}${close}`);
}

function applyTitle(appTsx: string, to: string): string | null {
  const re = /(<h1 className="vai-hero-title">)([\s\S]*?)(<\/h1>)/;
  if (!re.test(appTsx)) return null;
  return appTsx.replace(re, (_match, open, _inner, close) => `${open}${escapeJsxText(to)}${close}`);
}

function applyBadge(appTsx: string, to: string): string | null {
  const re = /(<div className="vai-eyebrow"><span className="vai-eyebrow-dot" \/>)([\s\S]*?)(<\/div>)/;
  if (re.test(appTsx)) {
    return appTsx.replace(re, (_match, open, _inner, close) => `${open}${escapeJsxText(to)}${close}`);
  }
  // Inject if missing.
  const heroOpen = /(<header className="vai-hero">\s*)/;
  if (!heroOpen.test(appTsx)) return null;
  return appTsx.replace(heroOpen, `$1<div className="vai-eyebrow"><span className="vai-eyebrow-dot" />${escapeJsxText(to)}</div>\n        `);
}

function applyAccent(cssBody: string, colorKey: string): string | null {
  let accent: string;
  let accent2: string;
  if (colorKey.startsWith('#')) {
    accent = colorKey;
    accent2 = colorKey;
  } else {
    const pair = COLOR_MAP[colorKey];
    if (!pair) return null;
    [accent, accent2] = pair;
  }
  let out = cssBody.replace(/--vai-accent:\s*[^;]+;/, `--vai-accent: ${accent};`);
  out = out.replace(/--vai-accent-2:\s*[^;]+;/, `--vai-accent-2: ${accent2};`);
  if (out === cssBody) return null;
  // Also patch the inline hex pairs used by the radial-gradient body background.
  out = out.replace(/radial-gradient\(60% 40% at 50% 0%, #[0-9a-fA-F]{3,8}1f 0%, #[0-9a-fA-F]{3,8}00 60%\)/, `radial-gradient(60% 40% at 50% 0%, ${accent}1f 0%, ${accent}00 60%)`);
  out = out.replace(/radial-gradient\(40% 30% at 90% 10%, #[0-9a-fA-F]{3,8}1a 0%, #[0-9a-fA-F]{3,8}00 60%\)/, `radial-gradient(40% 30% at 90% 10%, ${accent2}1a 0%, ${accent2}00 60%)`);
  return out;
}

function applyStylePreset(cssBody: string, key: string): string | null {
  const p = STYLE_PRESETS[key];
  if (!p) return null;
  let out = cssBody;
  out = out.replace(/--vai-bg:\s*[^;]+;/, `--vai-bg: ${p.bg};`);
  out = out.replace(/--vai-surface:\s*[^;]+;/, `--vai-surface: ${p.surface};`);
  out = out.replace(/--vai-surface-2:\s*[^;]+;/, `--vai-surface-2: ${p.surface};`);
  out = out.replace(/--vai-border:\s*[^;]+;/, `--vai-border: ${p.border};`);
  out = out.replace(/--vai-border-strong:\s*[^;]+;/, `--vai-border-strong: ${p.border};`);
  out = out.replace(/--vai-text:\s*[^;]+;/, `--vai-text: ${p.text};`);
  out = out.replace(/--vai-muted:\s*[^;]+;/, `--vai-muted: ${p.muted};`);
  out = out.replace(/--vai-accent:\s*[^;]+;/, `--vai-accent: ${p.accent};`);
  out = out.replace(/--vai-accent-2:\s*[^;]+;/, `--vai-accent-2: ${p.accent2};`);
  out = out.replace(/--vai-radius:\s*[^;]+;/, `--vai-radius: ${p.radius};`);
  out = out.replace(/--vai-radius-sm:\s*[^;]+;/, `--vai-radius-sm: ${p.radiusSm};`);
  // Wipe the radial background gradient for clean style presets that want a flat backdrop.
  if (key === 'brutalist' || key === 'minimal' || key === 'terminal') {
    out = out.replace(/background-image:\s*\n?\s*radial-gradient[^;]+;[\s\S]*?background-repeat:\s*no-repeat;/, 'background-image: none;');
  }
  if (out === cssBody) return null;
  return out;
}

const SCROLL_ANIM_CSS = `

/* vai-scroll-reveal: chat-added scroll-reveal animations */
.vai-scroll-reveal { opacity: 0; transform: translateY(18px); transition: opacity 600ms cubic-bezier(.2,.7,.2,1), transform 600ms cubic-bezier(.2,.7,.2,1); }
.vai-scroll-reveal.is-visible { opacity: 1; transform: none; }
`;

function applyScrollAnimations(appTsx: string, cssBody: string): { appTsx: string; cssBody: string } | null {
  if (/vai-scroll-reveal/.test(appTsx)) return null;
  let out = appTsx;
  out = out.replace(/<section className="/g, '<section className="vai-scroll-reveal ');
  out = out.replace(/<article className="/g, '<article className="vai-scroll-reveal ');
  // Inject IntersectionObserver effect inside App() after the existing useEffect imports.
  if (!/useEffect/.test(out)) {
    out = out.replace(/from 'react';/, "from 'react';\nimport { useEffect as __vaiUseEffect } from 'react';");
  }
  // Add a one-shot effect just before the return.
  const effectBlock = `
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.vai-scroll-reveal'));
    if (els.length === 0) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
`;
  out = out.replace(/(\n\s*return\s*\()/, `${effectBlock}$1`);
  return { appTsx: out, cssBody: cssBody + SCROLL_ANIM_CSS };
}

const LOADING_CSS = `

/* vai-loading: chat-added loading splash */
.vai-loading { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--vai-bg); z-index: 9999; animation: vaiLoadingOut 480ms ease 1100ms forwards; pointer-events: none; }
.vai-loading-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--vai-accent); margin: 0 4px; animation: vaiLoadingBounce 900ms ease-in-out infinite; }
.vai-loading-dot:nth-child(2) { animation-delay: 120ms; }
.vai-loading-dot:nth-child(3) { animation-delay: 240ms; }
@keyframes vaiLoadingBounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-8px); opacity: 1; } }
@keyframes vaiLoadingOut { to { opacity: 0; visibility: hidden; } }
`;

function applyLoadingAnimation(appTsx: string, cssBody: string): { appTsx: string; cssBody: string } | null {
  if (/vai-loading/.test(appTsx)) return null;
  const overlay = `      <div className="vai-loading" aria-hidden="true"><span className="vai-loading-dot" /><span className="vai-loading-dot" /><span className="vai-loading-dot" /></div>\n`;
  const out = appTsx.replace(/(<main className="vai-app">\s*)/, `$1\n${overlay}`);
  if (out === appTsx) return null;
  return { appTsx: out, cssBody: cssBody + LOADING_CSS };
}

function emitChangedFiles(appTsx: string | null, cssBody: string | null, originalApp: string, originalCss: string): string {
  const parts: string[] = [];
  if (appTsx && appTsx !== originalApp) {
    parts.push(`${FENCE}tsx title="src/App.tsx"`);
    parts.push(appTsx);
    parts.push(FENCE);
  }
  if (cssBody && cssBody !== originalCss) {
    if (parts.length > 0) parts.push('');
    parts.push(`${FENCE}css title="src/styles.css"`);
    parts.push(cssBody);
    parts.push(FENCE);
  }
  return parts.join('\n');
}

export function tryEditShellRecipe(input: string, lastAssistantContent: string): string | null {
  if (!isShellRecipeApp(lastAssistantContent)) return null;
  const appBlock = extractCodeBlock(lastAssistantContent, 'src/App.tsx');
  const cssBlock = extractCodeBlock(lastAssistantContent, 'src/styles.css');
  if (!appBlock) return null;
  const edit = parseEdit(input);
  if (!edit) return null;

  const originalApp = appBlock.body;
  const originalCss = cssBlock?.body ?? '';

  let newApp: string | null = originalApp;
  let newCss: string | null = cssBlock ? originalCss : null;

  switch (edit.kind) {
    case 'text-swap': {
      const res = applyTextSwap(originalApp, originalCss || null, edit.from!, edit.to);
      if (!res) return null;
      newApp = res.appTsx;
      newCss = res.cssBody;
      break;
    }
    case 'subtitle':
      newApp = applySubtitle(originalApp, edit.to);
      break;
    case 'title':
      newApp = applyTitle(originalApp, edit.to);
      break;
    case 'badge':
      newApp = applyBadge(originalApp, edit.to);
      break;
    case 'accent': {
      if (!cssBlock) return null;
      const css = applyAccent(originalCss, edit.to);
      if (!css) return null;
      newCss = css;
      newApp = originalApp;
      break;
    }
    case 'style-preset': {
      if (!cssBlock) return null;
      const css = applyStylePreset(originalCss, edit.to);
      if (!css) return null;
      newCss = css;
      newApp = originalApp;
      break;
    }
    case 'add-scroll-animations': {
      if (!cssBlock) return null;
      const res = applyScrollAnimations(originalApp, originalCss);
      if (!res) return null;
      newApp = res.appTsx;
      newCss = res.cssBody;
      break;
    }
    case 'add-loading-animation': {
      if (!cssBlock) return null;
      const res = applyLoadingAnimation(originalApp, originalCss);
      if (!res) return null;
      newApp = res.appTsx;
      newCss = res.cssBody;
      break;
    }
  }

  if (!newApp || (newApp === originalApp && (newCss === null || newCss === originalCss))) return null;
  return emitChangedFiles(newApp, newCss, originalApp, originalCss);
}
