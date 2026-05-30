import type { AccentPalette, AccentPaletteId, BuildSpec, PrimitivePick, PrimitiveId, ThemeMode } from './types.js';
import { PRIMITIVES } from './primitives.js';

/** Cycle-through palette catalog. Picked from the brief; defaults by hash. */
const PALETTES: Record<AccentPaletteId, AccentPalette> = {
  'violet-cyan': { id: 'violet-cyan', bg: '#08070f', orbA: 'rgba(139,92,246,0.55)', orbB: 'rgba(34,211,238,0.45)', accent: '#a78bfa', accent2: '#22d3ee', text: '#f5f3ff', muted: '#a1a1aa' },
  'emerald-lime': { id: 'emerald-lime', bg: '#06100c', orbA: 'rgba(16,185,129,0.55)', orbB: 'rgba(190,242,100,0.40)', accent: '#34d399', accent2: '#bef264', text: '#ecfdf5', muted: '#94a3b8' },
  'amber-rose': { id: 'amber-rose', bg: '#120808', orbA: 'rgba(251,191,36,0.50)', orbB: 'rgba(244,114,182,0.50)', accent: '#fbbf24', accent2: '#fb7185', text: '#fff7ed', muted: '#a8a29e' },
  'indigo-fuchsia': { id: 'indigo-fuchsia', bg: '#0a0814', orbA: 'rgba(99,102,241,0.55)', orbB: 'rgba(232,121,249,0.45)', accent: '#818cf8', accent2: '#e879f9', text: '#eef2ff', muted: '#a5b4fc' },
  'cyan-sky': { id: 'cyan-sky', bg: '#04101a', orbA: 'rgba(34,211,238,0.55)', orbB: 'rgba(96,165,250,0.45)', accent: '#22d3ee', accent2: '#60a5fa', text: '#ecfeff', muted: '#94a3b8' },
  'rose-orange': { id: 'rose-orange', bg: '#1a0812', orbA: 'rgba(244,114,182,0.55)', orbB: 'rgba(251,146,60,0.45)', accent: '#fb7185', accent2: '#fb923c', text: '#fff1f2', muted: '#a8a29e' },
};

const PALETTE_KEYWORD_HITS: ReadonlyArray<readonly [RegExp, AccentPaletteId]> = [
  [/\bviolet|purple|lavender\b/i, 'violet-cyan'],
  [/\bemerald|green|lime|forest\b/i, 'emerald-lime'],
  [/\bamber|gold|yellow|warm\b/i, 'amber-rose'],
  [/\bindigo|fuchsia|magenta\b/i, 'indigo-fuchsia'],
  [/\bcyan|sky|blue|ice|aqua\b/i, 'cyan-sky'],
  [/\brose|pink|orange|peach|sunset\b/i, 'rose-orange'],
];

function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function pickPalette(brief: string): AccentPalette {
  for (const [re, id] of PALETTE_KEYWORD_HITS) {
    if (re.test(brief)) return PALETTES[id];
  }
  const ids = Object.keys(PALETTES) as AccentPaletteId[];
  return PALETTES[ids[hashString(brief) % ids.length]];
}

function pickThemeMode(brief: string): ThemeMode {
  if (/\b(light|bright|white|paper|airy)\b/i.test(brief) && !/\bdark\b/i.test(brief)) return 'light';
  return 'dark';
}

const TITLE_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'with', 'without', 'for', 'of', 'to', 'in', 'on',
  'at', 'is', 'are', 'be', 'build', 'builds', 'make', 'create', 'generate', 'app', 'application',
  'site', 'website', 'page', 'mvp', 'project', 'tool', 'platform', 'small', 'simple',
  'fancy', 'nice', 'clean', 'modern', 'me', 'my', 'i', 'we', 'us', 'that', 'this',
  'please', 'can', 'you', 'using', 'use', 'just', 'really', 'very', 'gorgeous', 'polished',
  'dark', 'light', 'subtle', 'motion', 'finish', 'beautiful',
]);

function deriveTitle(brief: string): string {
  const tokens = brief
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !TITLE_STOPWORDS.has(t.toLowerCase()));
  const picked = tokens.slice(0, 4);
  if (picked.length === 0) return 'Vai Surface';
  return picked.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function deriveTagline(brief: string, title: string): string {
  if (/\b(?:booking|appointment|appointments|calendar|scheduler|schedule|reservation)\b/i.test(brief)) {
    return 'A studio scheduler with clients, appointment slots, and clear booking actions in one previewable flow.';
  }
  if (/\b(?:crm|relationships?|follow[-\s]?up|contacts?|warm\/cold)\b/i.test(brief)) {
    return 'A relationship workspace for contacts, notes, follow-ups, and next-contact decisions.';
  }
  if (/\b(?:dashboard|analytics|metrics?|kpi|revenue|traffic)\b/i.test(brief)) {
    return 'A focused dashboard surface with visible signals, controls, and operator-ready next actions.';
  }
  if (/\b(?:shopping|grocery|household|roommates?)\b/i.test(brief)) {
    return 'A shared household list with grouped items, ownership, and activity close to the shopping flow.';
  }
  if (/\b(?:social|feed|blog|post|community)\b/i.test(brief)) {
    return 'A publishing surface with compose, feed, and community activity working together.';
  }
  if (!brief.trim()) return `An open surface for ${title.toLowerCase()}.`;
  const trimmed = brief.length > 200 ? brief.slice(0, 197).trimEnd() + '…' : brief;
  void trimmed;
  const features = extractFeatureItems(brief).slice(0, 3);
  if (features.length >= 2) {
    return `A focused ${title.toLowerCase()} surface with ${features.join(', ').toLowerCase()}, and clear next actions.`;
  }
  return `A focused ${title.toLowerCase()} surface with real content, visible controls, and room to iterate.`;
}

/**
 * Extract feature labels for a feature-list primitive when one is matched.
 * Splits on natural separators and normalizes each fragment.
 */
function extractFeatureItems(brief: string): readonly string[] {
  const raw = brief
    .split(/,|;|\band\b|\bwith\b|\bplus\b|\balso\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  return raw
    .map((s) => s.replace(/^(?:a|an|the|with|and|plus|also|that|which)\s+/i, ''))
    .map((s) => s.replace(/^(?:build|make|create|generate|add|include|show|render)\s+/i, ''))
    .map((s) => s.split(/\s+/).slice(0, 5).join(' '))
    .filter((s) => s.length >= 3 && s.length <= 60)
    .slice(0, 6);
}

/**
 * Parse a free-form brief into a BuildSpec. Returns null only when the brief
 * is so empty there's nothing to compose.
 *
 * Selection rules:
 *  - Always include orb-background + grain-overlay + a title primitive +
 *    tagline (these are the visual baseline of a "polished MVP").
 *  - Each interactive primitive (hue slider, mood toggle, color swatches)
 *    is included only when its keywords appear in the brief.
 *  - feature-list is included when the brief explicitly mentions features
 *    OR when we extracted at least 2 feature fragments.
 *  - glass-card is included whenever any interactive primitive is selected
 *    (it's the container that hosts them).
 *  - cta-button is included by default to give the app a tactile beat
 *    (and to anchor the shared `pulses` counter state).
 */
export function parseBrief(brief: string): BuildSpec | null {
  const trimmed = brief.trim();
  if (trimmed.length < 4) return null;

  const palette = pickPalette(trimmed);
  const themeMode = pickThemeMode(trimmed);
  const title = deriveTitle(trimmed);
  const tagline = deriveTagline(trimmed, title);

  const picks: PrimitivePick[] = [];

  // Background tier — always on.
  const wantsOrbs = PRIMITIVES.find((p) => p.id === 'orb-background')!.matchPatterns.some((re) => re.test(trimmed));
  if (wantsOrbs) picks.push({ id: 'orb-background', params: {} });
  picks.push({ id: 'grain-overlay', params: {} });

  // Title — kinetic if the brief asks for it, else gradient.
  const wantsKinetic = PRIMITIVES.find((p) => p.id === 'kinetic-type')!.matchPatterns.some((re) => re.test(trimmed));
  picks.push({ id: wantsKinetic ? 'kinetic-type' : 'gradient-title', params: {} });

  // Tagline — always on, since briefs always have *something* to say.
  picks.push({ id: 'tagline', params: {} });

  // CTA — default on so the preview has a tactile beat.
  picks.push({ id: 'cta-button', params: {} });

  // Interactive controls — each is included only on match.
  const interactiveCandidates: PrimitiveId[] = ['hue-slider', 'mood-toggle', 'color-swatches'];
  const interactivePicks: PrimitivePick[] = [];
  for (const id of interactiveCandidates) {
    const prim = PRIMITIVES.find((p) => p.id === id)!;
    if (prim.matchPatterns.some((re) => re.test(trimmed))) {
      interactivePicks.push({ id, params: {} });
    }
  }

  // Feature list — included when explicitly mentioned OR we got >=2 fragments.
  const featureRegex = /\bfeatures?\b|\bsections?\b|\bbullets?\b|\blist\b/i;
  const features = extractFeatureItems(trimmed);
  if (featureRegex.test(trimmed) || features.length >= 2) {
    picks.push({ id: 'feature-list', params: { items: features as readonly string[] as unknown as string } });
  }

  // Glass card hosts the interactive controls when any are present.
  if (interactivePicks.length > 0) {
    picks.push({ id: 'glass-card', params: {} });
    picks.push(...interactivePicks);
  }

  return {
    title,
    tagline,
    themeMode,
    palette,
    primitives: picks,
    brief: trimmed,
  };
}
