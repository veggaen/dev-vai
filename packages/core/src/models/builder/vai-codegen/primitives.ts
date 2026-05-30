import type { Primitive, PrimitivePick, BuildSpec } from './types.js';

/** Escape a string for embedding in single-line JS source. */
function jsStr(text: string): string {
  return JSON.stringify(text);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

// ─── Background tier ──────────────────────────────────────────────────────

const orbBackground: Primitive = {
  id: 'orb-background',
  capability: 'animated blurred color orbs in the background',
  matchPatterns: [/\borb/i, /\bblurred?\b/i, /\bglow\b/i, /\bambient\b/i, /\bgradient\s+background/i],
  emit: (_pick, _spec) => ({
    jsx: `      <div className="orb orb-a" />\n      <div className="orb orb-b" />`,
    background: true,
    css: [
      `.orb { position: absolute; border-radius: 50%; filter: blur(120px); pointer-events: none; will-change: transform; }`,
      `.orb-a { top: -180px; left: -120px; width: 520px; height: 520px; background: var(--orb-a); animation: floatA 14s ease-in-out infinite alternate; }`,
      `.orb-b { bottom: -220px; right: -140px; width: 620px; height: 620px; background: var(--orb-b); animation: floatB 20s ease-in-out infinite alternate; }`,
      `@keyframes floatA { from { transform: translate3d(-20px, -10px, 0) scale(1); } to { transform: translate3d(40px, 60px, 0) scale(1.1); } }`,
      `@keyframes floatB { from { transform: translate3d(20px, 0, 0) scale(1); } to { transform: translate3d(-50px, -40px, 0) scale(1.08); } }`,
    ],
  }),
};

const grainOverlay: Primitive = {
  id: 'grain-overlay',
  capability: 'subtle film-grain noise overlay',
  matchPatterns: [/\bgrain\b/i, /\bnoise\b/i, /\btexture\b/i, /\bfilm\s+grain/i],
  emit: () => ({
    jsx: `      <div className="grain" aria-hidden="true" />`,
    background: true,
    css: [
      `.grain { position: absolute; inset: 0; pointer-events: none; opacity: 0.06; mix-blend-mode: overlay; background-image: radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px); background-size: 3px 3px; }`,
    ],
  }),
};

// ─── Content tier ─────────────────────────────────────────────────────────

const gradientTitle: Primitive = {
  id: 'gradient-title',
  capability: 'large animated gradient headline',
  matchPatterns: [/\bheadline\b/i, /\bhero\b/i, /\btitle\b/i, /\bgradient\s+(?:title|headline|text)/i],
  emit: (_pick, spec) => ({
    jsx:
      `      <header className="hero">\n` +
      `        <p className="eyebrow">Vai · live preview</p>\n` +
      `        <h1 className="title">{${jsStr(spec.title)}}</h1>\n` +
      `      </header>`,
    css: [
      `.hero { position: relative; max-width: 960px; }`,
      `.eyebrow { margin: 0 0 14px; color: var(--accent-2); font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }`,
      `.title { margin: 0; font-size: clamp(2.6rem, 7vw, 5.6rem); line-height: 0.96; letter-spacing: -0.04em; font-weight: 700; background: linear-gradient(120deg, var(--text) 0%, var(--accent) 50%, var(--accent-2) 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }`,
    ],
  }),
};

const kineticType: Primitive = {
  id: 'kinetic-type',
  capability: 'kinetic typography — letters that wave/bob individually',
  matchPatterns: [/\bkinetic\b/i, /\banimated\s+(?:letters?|text|type|typography)/i, /\bwaving\s+letters/i, /\btypography\b/i],
  emit: (_pick, spec) => ({
    helpers: [
      `  const letters = ${jsStr(spec.title)}.split('');`,
    ],
    jsx:
      `      <header className="hero">\n` +
      `        <p className="eyebrow">Vai · kinetic preview</p>\n` +
      `        <h1 className="title kinetic" aria-label={${jsStr(spec.title)}}>\n` +
      `          {letters.map((ch, i) => (\n` +
      `            <span key={i} className="ch" style={{ animationDelay: \`\${i * 0.06}s\` }}>{ch === ' ' ? '\\u00A0' : ch}</span>\n` +
      `          ))}\n` +
      `        </h1>\n` +
      `      </header>`,
    css: [
      `.hero { position: relative; max-width: 960px; }`,
      `.eyebrow { margin: 0 0 14px; color: var(--accent-2); font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }`,
      `.title.kinetic { margin: 0; font-size: clamp(2.6rem, 8vw, 6.2rem); line-height: 0.96; letter-spacing: -0.04em; font-weight: 800; background: linear-gradient(120deg, var(--text) 0%, var(--accent) 45%, var(--accent-2) 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }`,
      `.title.kinetic .ch { display: inline-block; animation: chWave 2.4s ease-in-out infinite; transform-origin: 50% 100%; }`,
      `@keyframes chWave { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-14px) rotate(-1.2deg); } }`,
    ],
  }),
};

const tagline: Primitive = {
  id: 'tagline',
  capability: 'short supporting paragraph under the headline',
  matchPatterns: [/\btagline\b/i, /\bsubtitle\b/i, /\bsubhead/i, /\bdescription\b/i],
  emit: (_pick, spec) => ({
    jsx: `      <p className="tagline">{${jsStr(spec.tagline)}}</p>`,
    css: [
      `.tagline { margin: 18px 0 28px; max-width: 60ch; color: var(--muted); font-size: clamp(15px, 1.4vw, 18px); line-height: 1.65; }`,
    ],
  }),
};

const ctaButton: Primitive = {
  id: 'cta-button',
  capability: 'primary call-to-action button',
  matchPatterns: [/\bcta\b/i, /\bbutton\b/i, /\baction\b/i, /\bprimary\b/i],
  emit: (pick) => {
    const label = asString(pick.params.label, 'Try the surface');
    return {
      jsx:
        `      <div className="hero-actions">\n` +
        `        <button type="button" className="cta" onClick={() => setPulses((c) => c + 1)}>{${jsStr(label)}}</button>\n` +
        `        <span className="counter">{pulses} pulses</span>\n` +
        `      </div>`,
      css: [
        `.hero-actions { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-top: 6px; }`,
        `.cta { padding: 12px 22px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.12); background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #0b0b14; font-weight: 600; box-shadow: 0 18px 48px rgba(0,0,0,0.35); transition: transform 180ms ease, box-shadow 180ms ease; cursor: pointer; }`,
        `.cta:hover { transform: translateY(-2px); box-shadow: 0 24px 56px rgba(0,0,0,0.45); }`,
        `.counter { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 14px; }`,
      ],
    };
  },
};

const counter: Primitive = {
  // Counter state is provided by ctaButton; this primitive is implicit and
  // matched only as a fallback so we always have shared state available.
  id: 'counter',
  capability: 'shared interaction counter',
  matchPatterns: [/\bcounter\b/i, /\btally\b/i, /\bclicks?\b/i],
  emit: () => ({
    jsx: '',
    css: [],
  }),
};

const hueSlider: Primitive = {
  id: 'hue-slider',
  capability: 'live hue/color rotation slider',
  matchPatterns: [/\bhue\b/i, /\bcolor\s+slider/i, /\btint\s+slider/i, /\brecolor/i, /\blive\s+color/i],
  emit: (pick) => {
    const label = asString(pick.params.label, 'Hue shift');
    return {
      jsx:
        `        <label className="control">\n` +
        `          <span>{${jsStr(label)}}</span>\n` +
        `          <input type="range" min={-180} max={180} value={hue} onChange={(e) => setHue(Number(e.target.value))} />\n` +
        `          <small>{hue}°</small>\n` +
        `        </label>`,
      css: [
        `.control { display: grid; gap: 8px; }`,
        `.control > span { font-size: 13px; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; }`,
        `.control input[type='range'] { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 999px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); outline: none; }`,
        `.control input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--text); border: 2px solid var(--accent); box-shadow: 0 4px 10px rgba(0,0,0,0.4); cursor: pointer; }`,
        `.control input[type='range']::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: var(--text); border: 2px solid var(--accent); cursor: pointer; }`,
        `.control small { color: var(--muted); font-size: 12px; }`,
      ],
    };
  },
};

const moodToggle: Primitive = {
  id: 'mood-toggle',
  capability: 'segmented mood/intensity toggle that affects motion',
  matchPatterns: [/\bmood\b/i, /\bsegmented\b/i, /\bintensity\s+toggle/i, /\bmotion\s+toggle/i, /\b(?:quiet|focus|pulse)\b/i],
  emit: () => ({
    jsx:
      `        <div className="control">\n` +
      `          <span>Mood</span>\n` +
      `          <div className="segmented">\n` +
      `            {(['Quiet','Focus','Pulse'] as const).map((m) => (\n` +
      `              <button key={m} type="button" className={m === mood ? 'seg active' : 'seg'} onClick={() => setMood(m)}>{m}</button>\n` +
      `            ))}\n` +
      `          </div>\n` +
      `        </div>`,
      css: [
        `.segmented { display: inline-flex; padding: 4px; border-radius: 999px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); }`,
        `.seg { padding: 8px 14px; border-radius: 999px; border: none; background: transparent; color: var(--muted); font-size: 13px; font-weight: 500; transition: background 180ms ease, color 180ms ease; cursor: pointer; }`,
        `.seg.active { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #0b0b14; }`,
      ],
  }),
};

const colorSwatches: Primitive = {
  id: 'color-swatches',
  capability: 'clickable color swatches that re-theme the page',
  matchPatterns: [/\bswatch/i, /\bpalette\s+picker/i, /\btheme\s+picker/i, /\bcolor\s+chips?/i],
  emit: () => ({
    helpers: [
      `  const swatches = [`,
      `    { name: 'Violet', a: '#a78bfa', b: '#22d3ee' },`,
      `    { name: 'Emerald', a: '#34d399', b: '#bef264' },`,
      `    { name: 'Amber', a: '#fbbf24', b: '#fb7185' },`,
      `    { name: 'Indigo', a: '#818cf8', b: '#e879f9' },`,
      `  ] as const;`,
    ],
    jsx:
      `        <div className="control">\n` +
      `          <span>Palette</span>\n` +
      `          <div className="swatches">\n` +
      `            {swatches.map((s) => (\n` +
      `              <button key={s.name} type="button" className="swatch" title={s.name} onClick={() => { document.documentElement.style.setProperty('--accent', s.a); document.documentElement.style.setProperty('--accent-2', s.b); }} style={{ background: \`linear-gradient(135deg, \${s.a}, \${s.b})\` }} />\n` +
      `            ))}\n` +
      `          </div>\n` +
      `        </div>`,
    css: [
      `.swatches { display: flex; gap: 10px; }`,
      `.swatch { width: 28px; height: 28px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.18); cursor: pointer; transition: transform 160ms ease; }`,
      `.swatch:hover { transform: scale(1.1); }`,
    ],
  }),
};

const featureList: Primitive = {
  id: 'feature-list',
  capability: 'numbered feature list inside a card',
  matchPatterns: [/\bfeatures?\b/i, /\bbullets?\b/i, /\blist\b/i, /\bsections?\b/i],
  emit: (pick) => {
    const itemsParam = pick.params.items;
    const items: string[] = Array.isArray(itemsParam)
      ? (itemsParam as unknown[]).map((v) => String(v))
      : ['Live in the preview', 'Tunable from chat', 'Iterates with one message'];
    const safe = items.slice(0, 6);
    return {
      helpers: [
        `  const features: readonly { label: string; hint: string }[] = [`,
        ...safe.map((label, i) => `    { label: ${jsStr(label)}, hint: ${jsStr(['Editable from chat.', 'Tunable via controls.', 'Refine with one message.'][i % 3])} },`),
        `  ];`,
      ],
      jsx:
        `        <div className="card features">\n` +
        `          <p className="card-eyebrow">In this preview</p>\n` +
        `          <ul>\n` +
        `            {features.map((f, i) => (\n` +
        `              <li key={f.label}>\n` +
        `                <span className="bullet">{String(i + 1).padStart(2, '0')}</span>\n` +
        `                <div><strong>{f.label}</strong><p>{f.hint}</p></div>\n` +
        `              </li>\n` +
        `            ))}\n` +
        `          </ul>\n` +
        `        </div>`,
      css: [
        `.features ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 14px; }`,
        `.features li { display: grid; grid-template-columns: 40px 1fr; gap: 14px; padding: 14px; border-radius: 16px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); transition: transform 180ms ease, background 180ms ease; }`,
        `.features li:hover { transform: translateY(-2px); background: rgba(255,255,255,0.05); }`,
        `.bullet { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--accent); }`,
        `.features strong { display: block; margin-bottom: 4px; font-size: 16px; }`,
        `.features p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.55; }`,
      ],
    };
  },
};

const glassCard: Primitive = {
  id: 'glass-card',
  capability: 'frosted-glass control card that hosts interactive controls',
  matchPatterns: [/\bglass(?:y)?\b/i, /\bfrosted\b/i, /\bcommand\s+card/i, /\bcontrol\s+card/i, /\bcontrols?\s+panel/i],
  emit: () => ({
    // Glass card is a *container* — the composer detects it and wraps
    // interactive primitives (hue-slider, mood-toggle, color-swatches) inside.
    jsx: '',
    css: [
      `.card { position: relative; padding: 28px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); box-shadow: 0 22px 64px rgba(0,0,0,0.32); }`,
      `.card-eyebrow { margin: 0 0 14px; color: var(--accent-2); font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }`,
      `.controls { display: grid; gap: 18px; align-content: start; }`,
    ],
  }),
};

export const PRIMITIVES: readonly Primitive[] = [
  orbBackground,
  grainOverlay,
  gradientTitle,
  kineticType,
  tagline,
  ctaButton,
  counter,
  hueSlider,
  moodToggle,
  colorSwatches,
  featureList,
  glassCard,
];

export const PRIMITIVES_BY_ID = new Map<string, Primitive>(PRIMITIVES.map((p) => [p.id, p] as const));

/** Pick params placeholder helper. */
export function pickWithDefaults(id: PrimitivePick['id'], params: PrimitivePick['params'] = {}): PrimitivePick {
  return { id, params };
}

/** Re-export for the composer. */
export type { Primitive, PrimitivePick, BuildSpec };
