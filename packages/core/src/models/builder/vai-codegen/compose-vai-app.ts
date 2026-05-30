import { buildReactViteTsApp } from '../compose-builder-app.js';
import { parseBrief } from './parse-brief.js';
import { PRIMITIVES_BY_ID } from './primitives.js';
import type { BuildSpec, PrimitiveEmit, PrimitiveId } from './types.js';

const INTERACTIVE_IDS: ReadonlySet<PrimitiveId> = new Set<PrimitiveId>(['hue-slider', 'mood-toggle', 'color-swatches']);

interface EmittedPrimitive {
  readonly id: PrimitiveId;
  readonly emit: PrimitiveEmit;
}

function emitAll(spec: BuildSpec): readonly EmittedPrimitive[] {
  const out: EmittedPrimitive[] = [];
  for (const pick of spec.primitives) {
    const prim = PRIMITIVES_BY_ID.get(pick.id);
    if (!prim) continue;
    out.push({ id: pick.id, emit: prim.emit(pick, spec) });
  }
  return out;
}

function dedupe<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

/** Build the App.tsx source by stitching primitive emissions together. */
function buildAppTsx(spec: BuildSpec, emitted: readonly EmittedPrimitive[]): string {
  const hasInteractive = emitted.some((e) => INTERACTIVE_IDS.has(e.id));
  const hasMood = emitted.some((e) => e.id === 'mood-toggle');
  const hasHue = emitted.some((e) => e.id === 'hue-slider');
  const hasCta = emitted.some((e) => e.id === 'cta-button');
  const hasGlass = emitted.some((e) => e.id === 'glass-card');
  const hasFeatures = emitted.some((e) => e.id === 'feature-list');

  // Imports — `useState`/`useEffect`/`useMemo` driven by what's actually used.
  const reactImports: string[] = ['useState'];
  if (hasMood) reactImports.push('useEffect');
  if (hasHue) reactImports.push('useMemo');
  const dedupedReact = dedupe(reactImports);

  const extraImports = dedupe(emitted.flatMap((e) => e.emit.imports ?? []));
  const importBlock = [
    `import { ${dedupedReact.join(', ')} } from 'react';`,
    ...extraImports,
  ].join('\n');

  // State init
  const stateInit: string[] = [];
  if (hasHue) stateInit.push('  const [hue, setHue] = useState(0);');
  if (hasMood) stateInit.push("  const [mood, setMood] = useState<'Quiet' | 'Focus' | 'Pulse'>('Focus');");
  if (hasCta) stateInit.push('  const [pulses, setPulses] = useState(0);');
  for (const e of emitted) {
    for (const line of e.emit.stateInit ?? []) stateInit.push(line);
  }

  // Effects
  const effects: string[] = [];
  if (hasMood && hasCta) {
    effects.push(
      `  useEffect(() => {`,
      `    if (mood !== 'Pulse') return;`,
      `    const id = window.setInterval(() => setPulses((c) => c + 1), 1200);`,
      `    return () => window.clearInterval(id);`,
      `  }, [mood]);`,
    );
  }
  for (const e of emitted) {
    for (const line of e.emit.effects ?? []) effects.push(line);
  }

  // Helpers
  const helpers: string[] = [];
  if (hasHue) helpers.push('  const accentShift = useMemo(() => `hue-rotate(${hue}deg)`, [hue]);');
  if (hasMood) helpers.push("  const moodSpeed = mood === 'Quiet' ? 22 : mood === 'Focus' ? 14 : 7;");
  for (const e of emitted) {
    for (const line of e.emit.helpers ?? []) helpers.push(line);
  }

  // Render order: background tier first, then content tier.
  const backgroundJsx = emitted.filter((e) => e.emit.background && e.emit.jsx).map((e) => e.emit.jsx);
  const contentEmitted = emitted.filter((e) => !e.emit.background && e.emit.jsx);

  // Content split: hero (gradient/kinetic title), tagline, cta, then a grid
  // of (features card | glass-controls card).
  const heroIds = new Set<PrimitiveId>(['gradient-title', 'kinetic-type']);
  const heroBlocks = contentEmitted.filter((e) => heroIds.has(e.id)).map((e) => e.emit.jsx);
  const taglineBlocks = contentEmitted.filter((e) => e.id === 'tagline').map((e) => e.emit.jsx);
  const ctaBlocks = contentEmitted.filter((e) => e.id === 'cta-button').map((e) => e.emit.jsx);
  const featureBlocks = contentEmitted.filter((e) => e.id === 'feature-list').map((e) => e.emit.jsx);
  const interactiveBlocks = contentEmitted.filter((e) => INTERACTIVE_IDS.has(e.id)).map((e) => e.emit.jsx);

  // Compose the grid section. When we have a glass card with interactive
  // controls, wrap them. When we have a feature list, place it side-by-side.
  let gridJsx = '';
  const hasGrid = featureBlocks.length > 0 || interactiveBlocks.length > 0;
  if (hasGrid) {
    const controlsCard = interactiveBlocks.length > 0
      ? [
        `        <div className="card controls">`,
        `          <p className="card-eyebrow">Live controls</p>`,
        ...interactiveBlocks,
        `        </div>`,
      ].join('\n')
      : '';
    void hasGlass; // glass-card CSS already imported via emitAll
    const sections = [
      featureBlocks.length > 0 ? featureBlocks.join('\n') : '',
      controlsCard,
    ].filter((s) => s.length > 0);
    gridJsx = [
      `      <section className="grid">`,
      ...sections,
      `      </section>`,
    ].join('\n');
  }

  const mainStyle = hasHue ? ' style={{ filter: accentShift }}' : '';
  const orbStyleProp = hasMood ? ` style={{ animationDuration: \`\${moodSpeed}s\` }}` : '';
  // If mood toggle is present, reparent orb JSX with mood-driven duration.
  const backgroundJsxFinal = orbStyleProp
    ? backgroundJsx.map((jsx) => jsx.replace('className="orb orb-a"', `className="orb orb-a"${orbStyleProp}`).replace('className="orb orb-b"', `className="orb orb-b"${orbStyleProp.replace('${moodSpeed}', '${moodSpeed * 1.4}')}`))
    : backgroundJsx;

  const renderBody = [
    `    <main className="stage"${mainStyle}>`,
    ...backgroundJsxFinal,
    ...heroBlocks,
    ...taglineBlocks,
    ...ctaBlocks,
    gridJsx,
    `    </main>`,
  ].filter((line) => line.length > 0).join('\n');

  return [
    importBlock,
    '',
    'export default function App() {',
    ...stateInit,
    ...(stateInit.length > 0 ? [''] : []),
    ...effects,
    ...(effects.length > 0 ? [''] : []),
    ...helpers,
    ...(helpers.length > 0 ? [''] : []),
    '  return (',
    renderBody,
    '  );',
    '}',
  ].join('\n');
}

function buildStylesCss(spec: BuildSpec, emitted: readonly EmittedPrimitive[]): string {
  const baseRules = [
    `:root { color-scheme: ${spec.themeMode}; --bg: ${spec.palette.bg}; --text: ${spec.palette.text}; --muted: ${spec.palette.muted}; --accent: ${spec.palette.accent}; --accent-2: ${spec.palette.accent2}; --orb-a: ${spec.palette.orbA}; --orb-b: ${spec.palette.orbB}; }`,
    `* { box-sizing: border-box; }`,
    `html, body, #root { margin: 0; padding: 0; min-height: 100vh; }`,
    `body { font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); overflow-x: hidden; }`,
    `button, input { font: inherit; }`,
    `.stage { position: relative; min-height: 100vh; padding: clamp(28px, 6vw, 80px) clamp(20px, 6vw, 96px); display: flex; flex-direction: column; gap: clamp(28px, 4vw, 56px); transition: filter 280ms ease; }`,
    `.grid { position: relative; display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 24px; }`,
    `@media (max-width: 880px) { .grid { grid-template-columns: 1fr; } }`,
  ];
  const primitiveCss = dedupe(emitted.flatMap((e) => e.emit.css));
  return [...baseRules, ...primitiveCss].join('\n');
}

/**
 * Try to compose a runnable React+Vite+TS app from a free-form brief using
 * Vai's primitive registry. Returns null when the brief is too thin to
 * compose anything meaningful — caller should fall back honestly instead of
 * pretending to build.
 */
export function tryComposeVaiApp(brief: string): string | null {
  const spec = parseBrief(brief);
  if (!spec) return null;

  // Honesty check: if the only primitives are baseline (orbs, grain, title,
  // tagline, cta), the brief named nothing concrete. Refuse so Vai can ask
  // for specifics instead of shipping a generic shell.
  const concreteIds = spec.primitives.filter((p) =>
    p.id !== 'orb-background'
    && p.id !== 'grain-overlay'
    && p.id !== 'gradient-title'
    && p.id !== 'kinetic-type'
    && p.id !== 'tagline'
    && p.id !== 'cta-button'
    && p.id !== 'counter',
  );
  if (concreteIds.length === 0) return null;

  const emitted = emitAll(spec);
  const appTsx = buildAppTsx(spec, emitted);
  const stylesCss = buildStylesCss(spec, emitted);
  const packageName = (spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'vai-app').slice(0, 40);

  return buildReactViteTsApp({
    packageName,
    title: spec.title,
    appTsx,
    stylesCss,
  });
}

/** List the human-readable capabilities Vai currently has. */
export function vaiCodegenCapabilities(): readonly string[] {
  return Array.from(PRIMITIVES_BY_ID.values()).map((p) => p.capability);
}
