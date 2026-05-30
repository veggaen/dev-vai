/**
 * Vai codegen — internal, primitive-based code generation for builder mode.
 *
 * This layer is NOT a template selector. It parses a free-form brief into a
 * BuildSpec, then composes a runnable React+Vite+TS app from a registry of
 * UI primitives. Adding a new primitive permanently expands what Vai can
 * build from scratch; the same brief never produces the same shell when it
 * names different features.
 */

export type ThemeMode = 'dark' | 'light';

export type AccentPaletteId =
  | 'violet-cyan'
  | 'emerald-lime'
  | 'amber-rose'
  | 'indigo-fuchsia'
  | 'cyan-sky'
  | 'rose-orange';

export interface AccentPalette {
  readonly id: AccentPaletteId;
  readonly bg: string;
  readonly orbA: string;
  readonly orbB: string;
  readonly accent: string;
  readonly accent2: string;
  readonly text: string;
  readonly muted: string;
}

/** A single concrete UI primitive selected for the app. */
export interface PrimitivePick {
  readonly id: PrimitiveId;
  /** Free-form params extracted from the brief (e.g. a label, count, target). */
  readonly params: Record<string, string | number | boolean | undefined>;
}

export type PrimitiveId =
  | 'gradient-title'
  | 'tagline'
  | 'cta-button'
  | 'counter'
  | 'hue-slider'
  | 'mood-toggle'
  | 'color-swatches'
  | 'glass-card'
  | 'feature-list'
  | 'orb-background'
  | 'grain-overlay'
  | 'kinetic-type';

/** The structured spec produced by `parseBrief`. */
export interface BuildSpec {
  readonly title: string;
  readonly tagline: string;
  readonly themeMode: ThemeMode;
  readonly palette: AccentPalette;
  /** Primitives in render order. */
  readonly primitives: readonly PrimitivePick[];
  /** Raw brief, retained for debugging. */
  readonly brief: string;
}

/** Code emitted by a primitive. */
export interface PrimitiveEmit {
  /** Lines to add to the top-level `import` block. */
  readonly imports?: readonly string[];
  /** `useState`/const declarations to add to the App component body. */
  readonly stateInit?: readonly string[];
  /** `useEffect` blocks (or other effect-time code) to add. */
  readonly effects?: readonly string[];
  /** Helper consts/functions to inject inside App but above the return. */
  readonly helpers?: readonly string[];
  /**
   * JSX node to render. The composer interleaves these in primitive order
   * inside the top-level <main>. Background-tier primitives (orbs, grain)
   * are rendered first, then content-tier primitives.
   */
  readonly jsx: string;
  /** CSS rules (joined with newlines). */
  readonly css: readonly string[];
  /** If true, render before the content tier. */
  readonly background?: boolean;
}

export interface Primitive {
  readonly id: PrimitiveId;
  /** Human-friendly capability label, used in honest "I don't know how to ___" replies. */
  readonly capability: string;
  /** Regex patterns; if any match the brief, the primitive is a candidate. */
  readonly matchPatterns: readonly RegExp[];
  /** Returns emit code parameterized by the BuildSpec and the chosen params. */
  readonly emit: (pick: PrimitivePick, spec: BuildSpec) => PrimitiveEmit;
}
