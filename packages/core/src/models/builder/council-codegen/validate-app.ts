import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppValidationReport } from './types.js';

/**
 * Static validation gate for council-generated apps. Two layers:
 *
 * 1. Extraction — pull src/App.tsx + src/styles.css out of the coder's reply,
 *    tolerating the format misses small local models actually make (untitled
 *    fences, `tsx` vs `typescript` info strings, prose around the blocks).
 * 2. Validation — a real TypeScript syntax pass (`ts.transpileModule` with
 *    reportDiagnostics) when the compiler is importable, plus structural
 *    checks the compiler can't express (react-only imports, default export,
 *    non-empty CSS). Heuristics take over if `typescript` isn't resolvable at
 *    runtime so the gate degrades instead of throwing into the chat turn.
 */

export interface ExtractedAppFiles {
  readonly appTsx: string | null;
  readonly stylesCss: string | null;
}

const FENCE = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
const TITLE_ATTR = /\b(?:title|path|file|filename)=["']([^"']+)["']/i;

/** Every titled code fence in the reply, first occurrence per path. */
export function extractTitledFiles(text: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const match of (text ?? '').matchAll(FENCE)) {
    const info = (match[1] ?? '').trim();
    const body = (match[2] ?? '').trim();
    if (!body) continue;
    const title = TITLE_ATTR.exec(info)?.[1]?.trim();
    if (title && !files.has(title)) files.set(title, body);
  }
  return files;
}

export function extractAppFiles(text: string): ExtractedAppFiles {
  let appTsx: string | null = null;
  let stylesCss: string | null = null;
  let firstTsx: string | null = null;
  let firstCss: string | null = null;

  for (const match of (text ?? '').matchAll(FENCE)) {
    const info = (match[1] ?? '').trim();
    const body = (match[2] ?? '').trim();
    if (!body) continue;
    const lang = (info.split(/\s+/)[0] ?? '').toLowerCase();
    const title = TITLE_ATTR.exec(info)?.[1]?.toLowerCase() ?? '';

    if (title.endsWith('app.tsx')) {
      appTsx = appTsx ?? body;
    } else if (title.endsWith('.css')) {
      stylesCss = stylesCss ?? body;
    } else if (!title && (lang === 'tsx' || lang === 'jsx' || lang === 'typescript' || lang === 'ts')) {
      firstTsx = firstTsx ?? body;
    } else if (!title && lang === 'css') {
      firstCss = firstCss ?? body;
    }
  }

  return {
    appTsx: appTsx ?? firstTsx,
    stylesCss: stylesCss ?? firstCss,
  };
}

// Lazy compiler handle. `typescript` is a devDependency of @vai/core — present
// in this workspace's runtime (tsx) but not guaranteed in a packaged build, so
// a failed import downgrades the gate rather than failing the turn.
let tsModulePromise: Promise<typeof import('typescript') | null> | null = null;

function loadTypescript(): Promise<typeof import('typescript') | null> {
  tsModulePromise ??= import('typescript').then(
    (m) => (m as { default?: typeof import('typescript') }).default ?? m,
    () => null,
  );
  return tsModulePromise;
}

/**
 * Semantic diagnostics worth surfacing WITHOUT react's type definitions on
 * hand. The check program can't resolve 'react' (module-resolution noise like
 * 2307/7026 is expected and ignored), so only codes that are reliable
 * independent of import types are reported — these are the strict-mode errors
 * that fail the user's real `tsc -b` and the undefined-name class that crashes
 * at runtime (live eval artifacts: TS2304 `setCurrentCard`, TS18004 shorthand
 * `cook`, TS7053 indexing an untyped `{}`).
 */
const SEMANTIC_ERROR_CODES = new Set([
  2304, // cannot find name
  2552, // cannot find name, did you mean
  2448, // used before declaration
  2451, // cannot redeclare block-scoped variable
  2588, // cannot assign to const
  2695, // left side of comma operator unused
  2339, // property does not exist on type
  7053, // element implicitly has an 'any' type (index signature)
  18004, // no value exists in scope for shorthand property
]);

/** Module-resolution / JSX-runtime noise that is expected when react types are absent. */
const TYPELESS_NOISE_CODES = new Set([2307, 2792, 2875, 7016, 7026]);

// Resolved once per process. With this workspace's shamefully-hoist setup the
// hoisted @types/react is reachable from core; a packaged build without it
// just drops to the curated typeless mode.
let reactTypesCache: { reactDts: string; jsxRuntimeDts: string } | null | undefined;

function resolveReactTypes(): { reactDts: string; jsxRuntimeDts: string } | null {
  if (reactTypesCache !== undefined) return reactTypesCache;
  try {
    // The .d.ts files aren't in the package's `exports` map, so resolve the
    // (always-exported) package.json and join from its directory.
    const require = createRequire(import.meta.url);
    const packageDir = dirname(require.resolve('@types/react/package.json'));
    const reactDts = join(packageDir, 'index.d.ts');
    const jsxRuntimeDts = join(packageDir, 'jsx-runtime.d.ts');
    reactTypesCache = existsSync(reactDts) && existsSync(jsxRuntimeDts)
      ? { reactDts, jsxRuntimeDts }
      : null;
  } catch {
    reactTypesCache = null;
  }
  return reactTypesCache;
}

/**
 * Type-check App.tsx as strictly as the generated scaffold's own `tsc -b`.
 * With real react types resolvable, every semantic error is reported — this is
 * what catches a `cook` vs `cookTime` setState property mismatch (TS2353, a
 * live eval miss). Without them, only the curated type-independent codes are
 * trusted; everything else is resolution noise.
 */
function semanticErrors(ts: typeof import('typescript'), appTsx: string, fileName = 'App.tsx'): string[] {
  const reactTypes = resolveReactTypes();
  const options: import('typescript').CompilerOptions = {
    strict: true,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    noEmit: true,
    skipLibCheck: true,
    ...(reactTypes
      ? { paths: { react: [reactTypes.reactDts], 'react/jsx-runtime': [reactTypes.jsxRuntimeDts] } }
      : {}),
  };
  const host = ts.createCompilerHost(options);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);
  const baseReadFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) => name === fileName
    ? ts.createSourceFile(fileName, appTsx, languageVersion, true, ts.ScriptKind.TSX)
    : baseGetSourceFile(name, languageVersion, ...rest);
  host.fileExists = (name) => name === fileName || baseFileExists(name);
  host.readFile = (name) => (name === fileName ? appTsx : baseReadFile(name));

  const program = ts.createProgram([fileName], options, host);
  const errors: string[] = [];
  for (const diag of program.getSemanticDiagnostics()) {
    if (diag.category !== ts.DiagnosticCategory.Error) continue;
    const include = reactTypes
      ? !TYPELESS_NOISE_CODES.has(diag.code) && (!diag.file || diag.file.fileName === fileName)
      : SEMANTIC_ERROR_CODES.has(diag.code);
    if (!include) continue;
    const message = ts.flattenDiagnosticMessageText(diag.messageText, ' ');
    const line = diag.file && diag.start !== undefined
      ? `:${diag.file.getLineAndCharacterOfPosition(diag.start).line + 1}`
      : '';
    errors.push(`${fileName}${line} — ${message}`);
    if (errors.length >= 6) break;
  }
  return errors;
}

const CLASS_ATTR = /className=["']([^"']+)["']/g;

/**
 * Every class name App.tsx can render — from plain string attributes AND
 * string literals inside `className={…}` expressions (ternaries, templates).
 * This is the stylist stage's mechanical input.
 */
export function extractClassNames(appTsx: string): string[] {
  const names = new Set<string>();
  for (const attr of (appTsx ?? '').matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{((?:[^{}]|\{[^{}]*\})*)\})/g)) {
    const direct = attr[1] ?? attr[2];
    const candidates: string[] = [];
    if (direct !== undefined) {
      candidates.push(direct);
    } else {
      for (const lit of (attr[3] ?? '').matchAll(/["'`]([^"'`]+)["'`]/g)) candidates.push(lit[1]);
    }
    for (const chunk of candidates) {
      for (const cls of chunk.split(/\s+/)) {
        if (/^[A-Za-z][\w-]*$/.test(cls)) names.add(cls);
      }
    }
  }
  return [...names];
}

const UTILITY_CLASS_RE = /^(?:flex|grid|block|inline(?:-block|-flex|-grid)?|hidden|relative|absolute|fixed|sticky|container|(?:p|m)[trblxy]?-[\w.\[\]-]+|gap-[\w.\[\]-]+|space-[xy]-[\w.\[\]-]+|(?:min-|max-)?[wh]-[\w.\[\]-]+|bg-[\w.\[\]/-]+|text-[\w.\[\]/-]+|font-[\w.-]+|leading-[\w.-]+|tracking-[\w.-]+|rounded(?:-[\w.-]+)?|shadow(?:-[\w.-]+)?|border(?:-[\w./-]+)?|items-[\w.-]+|justify-[\w.-]+|grid-cols-[\w.-]+|col-span-[\w.-]+|row-span-[\w.-]+|overflow-[\w.-]+|object-[\w.-]+|transition(?:-[\w.-]+)?|duration-[\w.-]+)$/i;

function classTokens(appTsx: string): string[] {
  const tokens = new Set<string>();
  for (const attr of (appTsx ?? '').matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{((?:[^{}]|\{[^{}]*\})*)\})/g)) {
    const direct = attr[1] ?? attr[2];
    const candidates = direct !== undefined
      ? [direct]
      : [...(attr[3] ?? '').matchAll(/["'`]([^"'`]+)["'`]/g)].map((match) => match[1]);
    for (const candidate of candidates) {
      for (const token of candidate.split(/\s+/).filter(Boolean)) {
        if (/^[A-Za-z][\w:./\[\]-]*$/.test(token)) tokens.add(token);
      }
    }
  }
  return [...tokens];
}

/** The generated sandbox has plain CSS, so framework utilities are inert. */
function checkUtilityClasses(appTsx: string, errors: string[]): void {
  const utilityClasses = classTokens(appTsx).filter((token) => /^[A-Za-z][\w-]*:/.test(token) || UTILITY_CLASS_RE.test(token));
  if (utilityClasses.length === 0) return;
  errors.push(`App.tsx uses utility-framework class names that the plain-CSS sandbox cannot execute (${utilityClasses.slice(0, 10).join(', ')}). Replace them with descriptive kebab-case component classes and let the stylist define every rule.`);
}

function checkRequestedPersistence(appTsx: string, brief: string | undefined, errors: string[]): void {
  if (!brief || !/\b(?:persist(?:ent|ence)?|local\s+(?:state|storage)|remember|survive\s+(?:a\s+)?reload)\b/i.test(brief)) return;
  const hasLocalStorage = /localStorage\s*\.\s*getItem\s*\(/.test(appTsx)
    && /localStorage\s*\.\s*setItem\s*\(/.test(appTsx);
  const hasIndexedDb = /\bindexedDB\s*\.\s*open\s*\(/.test(appTsx);
  if (!hasLocalStorage && !hasIndexedDb) {
    errors.push('The brief requires persistent local state, but App.tsx never reads and writes browser storage. Initialize state from localStorage (or IndexedDB) and save changes so they survive reloads.');
  } else if (hasLocalStorage && appTsx.indexOf('localStorage.setItem') < appTsx.indexOf('localStorage.getItem')) {
    errors.push('App.tsx writes default state to localStorage before reading saved state, so reload overwrites the user’s data. Hydrate in the useState initializer (or read before enabling the save effect).');
  }
}

/**
 * Cross-check that App.tsx's classes are actually styled. The common failure
 * is a model emitting Tailwind utility classes (`text-green-600`) into a
 * plain-CSS scaffold — the app compiles but renders unstyled. Mostly-missing
 * styling is a blocking error so the repair pass rewrites it; a few stragglers
 * are only a warning.
 */
function checkCssCoverage(appTsx: string, stylesCss: string, errors: string[], softErrors: string[], warnings: string[]): void {
  const used = new Set<string>();
  for (const match of appTsx.matchAll(CLASS_ATTR)) {
    for (const cls of (match[1] ?? '').split(/\s+/)) {
      if (cls) used.add(cls);
    }
  }
  if (used.size === 0) {
    softErrors.push('App.tsx uses no className at all — the app renders as unstyled browser text.');
    return;
  }
  const missing = [...used].filter((cls) => !stylesCss.includes(`.${cls}`));
  if (missing.length === 0) return;
  const ratio = missing.length / used.size;
  const sample = missing.slice(0, 6).join(', ');
  if (ratio > 0.8 && missing.length > 10) {
    // The two files don't connect at all (live case: Tailwind-utility App.tsx
    // + custom-class styles.css → a completely unstyled page). Shipping that
    // is shipping a visually broken app — HARD error, never soft.
    errors.push(`App.tsx and styles.css do not connect: ${missing.length}/${used.size} classes have no CSS rule (${sample}). Rewrite App.tsx classNames to the custom classes styles.css defines — do NOT use Tailwind utility names; they do not exist here.`);
  } else if (ratio > 0.5 && missing.length > 5) {
    softErrors.push(`Most App.tsx classes are unstyled in styles.css (${missing.length}/${used.size}: ${sample}) — write plain-CSS rules for your own class names; utility-framework classes like Tailwind do not exist here.`);
  } else {
    warnings.push(`${missing.length}/${used.size} classes lack CSS rules (${sample}).`);
  }
}

function checkImports(appTsx: string, errors: string[]): void {
  for (const match of appTsx.matchAll(/^\s*import\s+(?:[^;'"]+from\s+)?['"]([^'"]+)['"]/gm)) {
    const source = match[1] ?? '';
    if (source !== 'react') {
      errors.push(`App.tsx imports "${source}" — only 'react' is available in the sandbox scaffold.`);
    }
  }
}

/**
 * The sandbox preview is offline: external asset URLs render as broken images
 * (live case: randomuser.me portraits in a "tinder clone"). Visuals must be
 * CSS gradients / inline SVG / initials avatars.
 */
function checkExternalAssets(code: string, fileLabel: string, errors: string[]): void {
  const matches = [...code.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)]
    .map((m) => m[1].toLowerCase())
    // W3C namespace URIs in inline SVG are not network fetches.
    .filter((host) => host !== 'www.w3.org');
  if (matches.length > 0) {
    const hosts = [...new Set(matches)].slice(0, 3).join(', ');
    errors.push(`${fileLabel} references external URLs (${hosts}) — the sandbox is offline; use CSS gradients, inline SVG, or initials avatars instead.`);
  }
}

function checkBrokenImagePlaceholders(appTsx: string, errors: string[]): void {
  if (/<img\b[^>]*\bsrc\s*=\s*(?:["']\s*#?\s*["']|\{\s*["']\s*#?\s*["']\s*\})/i.test(appTsx)
    || /\b(?:coverImage|imageUrl|imageSrc)\s*:\s*["']\s*#\s*["']/i.test(appTsx)) {
    errors.push('App.tsx contains an empty or "#" image source, which renders a broken-image icon. Use a self-contained CSS/inline-SVG visual or omit the <img> element.');
  }
  if (/<img\b[^>]*\bsrc\s*=\s*\{\s*`data:image\/svg\+xml[^`]*`\s*\}/i.test(appTsx)) {
    errors.push('App.tsx puts raw SVG markup in an <img> data URL; quoting/encoding can render a broken image. Render inline <svg> markup or a CSS cover element instead.');
  }
}

function checkRequestedProgressBounds(appTsx: string, brief: string | undefined, errors: string[]): void {
  if (!brief || !/\bprogress\b/i.test(brief) || !/\bcurrentPage\b/.test(appTsx) || !/\btotalPages\b/.test(appTsx)) return;
  const clampsInCode = /Math\s*\.\s*(?:min|max)\s*\(/.test(appTsx);
  const clampsBothBounds = /Math\s*\.\s*max\s*\([^)]*Math\s*\.\s*min\s*\(/s.test(appTsx)
    || /Math\s*\.\s*min\s*\([^)]*Math\s*\.\s*max\s*\(/s.test(appTsx);
  const boundedInput = /\bmax\s*=\s*\{[^}]*totalPages[^}]*\}/.test(appTsx);
  if (/\bclamp\b/i.test(brief) && !clampsBothBounds) {
    errors.push('The brief explicitly requires clamping every progress update, but the state update does not clamp both lower and upper bounds with Math.min/Math.max.');
  } else if (!clampsInCode && !boundedInput) {
    errors.push('Progress controls update currentPage without clamping to totalPages. Add an input max bound and clamp every state update so progress cannot exceed 100%.');
  }
}

function checkFilteredIndexMutation(appTsx: string, errors: string[]): void {
  if (/\.filter\([\s\S]{0,900}\.map\(\([^,]+,\s*index\)[\s\S]{0,1200}\[index\]\s*\./.test(appTsx)) {
    errors.push('App.tsx mutates source state by the index of a filtered list. Filtering changes indexes, so edits can update the wrong item; update by a stable id with state.map instead.');
  }
}

/** Brace balance that ignores string/template/comment contents — JSX-safe enough as a fallback. */
function roughlyBalanced(code: string): boolean {
  const stripped = code
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\r\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\r\n])*"/g, '""')
    .replace(/\/\/[^\r\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  for (const ch of stripped) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

export async function validateGeneratedApp(files: ExtractedAppFiles): Promise<AppValidationReport> {
  const errors: string[] = [];
  const softErrors: string[] = [];
  const warnings: string[] = [];

  const appTsx = files.appTsx ?? '';
  const stylesCss = files.stylesCss ?? '';

  if (!appTsx) errors.push('No src/App.tsx code block was produced.');
  if (!stylesCss) errors.push('No src/styles.css code block was produced.');

  if (appTsx) {
    if (appTsx.length < 300) errors.push('App.tsx is too short to implement the requested features.');
    if (!/export\s+default\s+function\s+App\b|export\s+default\s+App\b/.test(appTsx)) {
      errors.push('App.tsx must contain `export default function App()`.');
    }
    if (/```/.test(appTsx)) errors.push('App.tsx contains a leaked markdown fence.');
    checkImports(appTsx, errors);
    checkExternalAssets(appTsx, 'App.tsx', errors);
    checkBrokenImagePlaceholders(appTsx, errors);
    checkUtilityClasses(appTsx, errors);
    if (!/useState|useReducer/.test(appTsx)) {
      warnings.push('App.tsx has no state hook — the app may be a static mockup.');
    }
  }

  if (stylesCss) {
    const opens = (stylesCss.match(/\{/g) ?? []).length;
    const closes = (stylesCss.match(/\}/g) ?? []).length;
    if (opens !== closes) errors.push(`styles.css braces are unbalanced (${opens} "{" vs ${closes} "}") — likely truncated output.`);
    if (/```/.test(stylesCss)) errors.push('styles.css contains a leaked markdown fence.');
    checkExternalAssets(stylesCss, 'styles.css', errors);
  }

  let checker: AppValidationReport['checker'] = 'heuristic';
  if (appTsx) {
    const ts = await loadTypescript();
    if (ts) {
      checker = 'tsc';
      const result = ts.transpileModule(appTsx, {
        reportDiagnostics: true,
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
        },
        fileName: 'App.tsx',
      });
      for (const diag of result.diagnostics ?? []) {
        if (diag.category !== ts.DiagnosticCategory.Error) continue;
        const message = ts.flattenDiagnosticMessageText(diag.messageText, ' ');
        const line = diag.file && diag.start !== undefined
          ? `:${diag.file.getLineAndCharacterOfPosition(diag.start).line + 1}`
          : '';
        errors.push(`App.tsx${line} — ${message}`);
        if (errors.length >= 8) break; // a truncated file produces dozens; the first few are what repair needs
      }
      // Only type-check syntactically sound code — semantic diagnostics on a
      // broken parse tree are noise the repair prompt doesn't need.
      if (errors.length === 0) {
        try {
          errors.push(...semanticErrors(ts, appTsx));
        } catch {
          // The semantic program is best-effort: a host/lib loading failure
          // must not block the build turn.
        }
      }
    } else if (!roughlyBalanced(appTsx)) {
      errors.push('App.tsx braces look unbalanced — likely truncated output.');
    }
  }

  if (appTsx && stylesCss) {
    checkCssCoverage(appTsx, stylesCss, errors, softErrors, warnings);
    checkCssRichness(stylesCss, softErrors);
  }

  return { ok: errors.length === 0, errors, softErrors, warnings, checker };
}

/**
 * Minimum visual bar for a fresh build (live feedback: "the ui is shit" —
 * native unstyled buttons, no hover states, default fonts). Soft errors:
 * they drive a repair pass, not a rejection.
 */
function checkCssRichness(stylesCss: string, softErrors: string[]): void {
  const misses: string[] = [];
  const ruleCount = (stylesCss.match(/\{/g) ?? []).length;
  if (ruleCount < 10) misses.push(`only ${ruleCount} CSS rules — style the whole app, not fragments`);
  if (!/:hover|:focus/.test(stylesCss)) misses.push('no :hover/:focus states on interactive elements');
  if (!/font-family/.test(stylesCss)) misses.push('no font-family set (default browser font looks unfinished)');
  if (!/\bbackground(?:-color|-image)?\s*:/.test(stylesCss)) misses.push('no page/background styling');
  if (!/box-sizing\s*:\s*border-box/.test(stylesCss)) misses.push('no global border-box sizing (padded controls can overflow)');
  if (!/@media\b/.test(stylesCss)) misses.push('no narrow-screen @media layout');
  if (misses.length > 0) {
    softErrors.push(`The styling is below the visual bar: ${misses.join('; ')}.`);
  }
}

/** Files the scaffold owns — an edit turn must never rewrite these. */
const SCAFFOLD_OWNED_PATH = /(?:^|\/)(?:package(?:-lock)?\.json|index\.html|tsconfig[^/]*\.json|vite\.config\.[jt]s|src\/main\.tsx)$/i;

/**
 * Validate an edit-mode reply: only allowed project files, each one complete
 * and compilable. `allowedPaths` are the snapshot paths shown to the coder.
 */
export interface ValidateEditOptions {
  /** True for user-opened real project folders — own deps/conventions. */
  readonly external?: boolean;
  /** Original snapshots — module specifiers already used by the project. */
  readonly referenceFiles?: readonly { path: string; content: string }[];
  /** Config/script removal is destructive and must be explicit in the brief. */
  readonly allowConfigKeyRemoval?: boolean;
  /** Explicit setup/scaffold requests may add a small safe set of source/config files. */
  readonly allowNewFiles?: boolean;
  /** Original user contract for deterministic checks of explicitly requested versions and tooling. */
  readonly brief?: string;
}

const SAFE_NEW_PROJECT_FILE = /\.(?:tsx?|jsx?|mjs|cjs|sol|json|md|ya?ml)$/i;

function isSafeNewProjectFile(path: string): boolean {
  if (!path || path.length > 240 || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return false;
  if (parts.some((part) => /^(?:node_modules|\.git)$/i.test(part))) return false;
  if (/(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(path)) return false;
  return SAFE_NEW_PROJECT_FILE.test(path);
}

/** Module specifiers imported anywhere in the reference snapshots. */
function collectKnownImports(referenceFiles: readonly { path: string; content: string }[]): Set<string> {
  const known = new Set<string>();
  for (const file of referenceFiles) {
    for (const match of file.content.matchAll(/^\s*import\s+(?:[^;'"]+from\s+)?['"]([^'"]+)['"]/gm)) {
      if (match[1]) known.add(match[1]);
    }
  }
  return known;
}

function packageEntries(value: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const entries = value[section];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    for (const [name, version] of Object.entries(entries)) {
      if (typeof version === 'string') out[name] = version;
    }
  }
  return out;
}

function parseJsonObject(body: string | undefined): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function requestedExactVersion(brief: string, packageName: string): string | null {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return brief.match(new RegExp(`${escaped}\\s+(?:version\\s+)?(\\d+\\.\\d+\\.\\d+)`, 'i'))?.[1] ?? null;
}

function relativeModuleExists(sourcePath: string, specifier: string, availablePaths: ReadonlySet<string>): boolean {
  const sourceParts = sourcePath.replace(/\\/g, '/').split('/');
  sourceParts.pop();
  for (const part of specifier.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') sourceParts.pop();
    else sourceParts.push(part);
  }
  const base = sourceParts.join('/');
  const withoutRuntimeExtension = base.replace(/\.(?:js|mjs|cjs)$/i, '');
  const candidates = [
    base,
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}.cjs`,
    `${withoutRuntimeExtension}.ts`, `${withoutRuntimeExtension}.tsx`, `${withoutRuntimeExtension}.js`,
    `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`,
  ];
  return candidates.some((candidate) => availablePaths.has(candidate));
}

function validateHardhat3Lane(
  emitted: ReadonlyMap<string, string>,
  options: ValidateEditOptions,
  errors: string[],
): void {
  const brief = options.brief ?? '';
  if (!/\bhardhat\s+3(?:\b|\.)/i.test(brief) || !/\bchain\//i.test(brief)) return;

  const chainPackage = parseJsonObject(emitted.get('chain/package.json'));
  const rootPackage = parseJsonObject(emitted.get('package.json'));
  const config = emitted.get('chain/hardhat.config.ts') ?? '';
  const entry = emitted.get('chain/contracts/MMM_UnifiedEntry.sol') ?? '';
  const ignition = emitted.get('chain/ignition/modules/MMM.ts') ?? '';
  const test = emitted.get('chain/test/MMM_Unified.ts') ?? '';

  if (!chainPackage) {
    errors.push('Hardhat 3 lane is missing a valid chain/package.json.');
  } else {
    const dependencies = packageEntries(chainPackage);
    for (const name of ['hardhat', '@nomicfoundation/hardhat-toolbox-viem', '@openzeppelin/contracts']) {
      const requested = requestedExactVersion(brief, name);
      if (!requested) continue;
      if (dependencies[name] !== requested) {
        errors.push(`chain/package.json must pin ${name} to the requested ${requested}; received ${dependencies[name] ?? 'missing'}.`);
      }
    }
    if (chainPackage.type !== 'module') {
      errors.push('chain/package.json must set "type": "module" for the isolated Hardhat 3 ESM workspace.');
    }
    const scripts = chainPackage.scripts && typeof chainPackage.scripts === 'object' && !Array.isArray(chainPackage.scripts)
      ? chainPackage.scripts as Record<string, unknown>
      : {};
    if (typeof scripts.compile !== 'string' || !/\bhardhat\s+build\b/.test(scripts.compile)) {
      errors.push('chain/package.json compile must use the Hardhat 3 build command.');
    }
    if (typeof scripts['deploy:local'] !== 'string' || !/hardhat\s+ignition\s+deploy[\s\S]*--network\s+localhost/.test(scripts['deploy:local'])) {
      errors.push('chain/package.json deploy:local must deploy the Ignition module to localhost.');
    }
  }

  if (rootPackage && /all\s+using\s+npm\s+--prefix\s+chain/i.test(brief)) {
    const scripts = rootPackage.scripts && typeof rootPackage.scripts === 'object' && !Array.isArray(rootPackage.scripts)
      ? rootPackage.scripts as Record<string, unknown>
      : {};
    for (const name of ['chain:install', 'chain:compile', 'chain:test', 'chain:node', 'chain:deploy:local']) {
      if (!brief.includes(name)) continue;
      if (typeof scripts[name] !== 'string' || !/^npm\s+--prefix\s+(?:\.\/)?chain\b/.test(scripts[name])) {
        errors.push(`package.json script ${name} must use npm --prefix chain as requested.`);
      }
    }
  }

  if (!/import\s*\{\s*defineConfig\s*\}\s*from\s*["']hardhat\/config["']/.test(config)) {
    errors.push('chain/hardhat.config.ts must use Hardhat 3 defineConfig().');
  }
  if (!/from\s*["']@nomicfoundation\/hardhat-toolbox-viem["']/.test(config) || !/plugins\s*:\s*\[[^\]]+\]/s.test(config)) {
    errors.push('chain/hardhat.config.ts must import and register hardhat-toolbox-viem in plugins[].');
  }
  if (/hardhat\/plugins|\bHardhatUserConfig\b|\bviem\s*:\s*\{/.test(config)) {
    errors.push('chain/hardhat.config.ts contains Hardhat 2-style or nonexistent plugin configuration.');
  }
  if (/localhost/i.test(brief) && (!/localhost\s*:\s*\{[\s\S]*?type\s*:\s*["']http["']/i.test(config) || !/127\.0\.0\.1:8545/.test(config))) {
    errors.push('chain/hardhat.config.ts localhost must be an explicit Hardhat 3 HTTP network at 127.0.0.1:8545.');
  }
  if (/chain\s*id\s*31337/i.test(brief) && !/chainId\s*:\s*31337/.test(config)) {
    errors.push('chain/hardhat.config.ts must preserve the requested localhost chainId 31337.');
  }

  if (/without\s+copying\s+(?:its\s+)?logic/i.test(brief)) {
    if (!/import\s+["']\.\.\/\.\.\/MMM_Unified\.sol["']/.test(entry)) {
      errors.push('MMM_UnifiedEntry.sol must import ../../MMM_Unified.sol.');
    }
    if (/\bcontract\s+[A-Za-z_$][\w$]*/.test(entry)) {
      errors.push('MMM_UnifiedEntry.sol must remain import-only; declaring a derived copy changes the requested contract surface.');
    }
  }

  if (!/buildModule\s*\(/.test(ignition) || !/@nomicfoundation\/hardhat-ignition\/modules/.test(ignition)) {
    errors.push('chain/ignition/modules/MMM.ts must be a declarative Hardhat Ignition buildModule.');
  }
  if (/\bhre\.|\bethers\b|\bclass\s+MMM\s+extends\s+Module/.test(ignition)) {
    errors.push('chain/ignition/modules/MMM.ts uses an ambient ethers/HRE deployment pattern instead of Hardhat 3 Ignition.');
  }
  const contractReference = options.referenceFiles?.find((file) => /(?:^|\/)MMM_Unified\.sol$/i.test(file.path))?.content ?? '';
  const contractName = contractReference.match(/\bcontract\s+([A-Za-z_$][\w$]*)/)?.[1];
  if (contractName && !new RegExp(`m\\.contract\\(\\s*["']${contractName}["']`).test(ignition)) {
    errors.push(`chain/ignition/modules/MMM.ts must deploy the referenced ${contractName} contract.`);
  }

  if (!/from\s+["']node:test["']/.test(test) || !/\bnetwork\s*\.\s*connect\s*\(/.test(test)) {
    errors.push('chain/test/MMM_Unified.ts must use the requested Hardhat 3 Node test runner + explicit viem network connection.');
  }
  if (/from\s+["']chai["']|\bethers\b|\.receive\s*\(/.test(test)) {
    errors.push('chain/test/MMM_Unified.ts contains an ethers/Chai or callable receive() pattern incompatible with the requested viem lane.');
  }
  if (!/sendTransaction\s*\(/.test(test)) {
    errors.push('chain/test/MMM_Unified.ts must test payable receive() behavior by sending a transaction to the contract address.');
  }
  for (const getter of ['TOTAL_SUPPLY', 'PRE_MINT_AMOUNT', 'PHASE_COUNT', 'MIN_CONTRIBUTION_WEI']) {
    if (!test.includes(getter)) errors.push(`chain/test/MMM_Unified.ts must verify the real ${getter} getter from MMM_Unified.sol.`);
  }
}

export async function validateEditedFiles(
  emitted: ReadonlyMap<string, string>,
  allowedPaths: readonly string[],
  options: ValidateEditOptions = {},
): Promise<AppValidationReport> {
  const errors: string[] = [];
  const softErrors: string[] = [];
  const warnings: string[] = [];
  let checker: AppValidationReport['checker'] = 'heuristic';
  const external = options.external === true;
  const knownImports = external ? collectKnownImports(options.referenceFiles ?? []) : null;
  const availablePaths = new Set([
    ...[...emitted.keys()].map((path) => path.replace(/\\/g, '/')),
    ...(options.referenceFiles ?? []).map((file) => file.path.replace(/\\/g, '/')),
  ]);
  const proposedPackages = new Set<string>();
  for (const [path, body] of emitted) {
    if (!/(?:^|\/)package\.json$/i.test(path.replace(/\\/g, '/'))) continue;
    const parsed = parseJsonObject(body);
    if (parsed) Object.keys(packageEntries(parsed)).forEach((name) => proposedPackages.add(name));
  }

  if (emitted.size === 0) {
    errors.push('No titled file blocks were produced — re-emit each changed file in a fenced block with title="path".');
  }
  if (emitted.size > 12) {
    errors.push(`Edit emits ${emitted.size} files — split the change into a reviewable batch of at most 12 files.`);
  }

  const allowed = new Set(allowedPaths.map((p) => p.replace(/\\/g, '/')));
  if (!external) {
    allowed.add('src/App.tsx');
    allowed.add('src/styles.css');
  }

  const ts = await loadTypescript();
  for (const [path, body] of emitted) {
    const norm = path.replace(/\\/g, '/');
    if (!external && SCAFFOLD_OWNED_PATH.test(norm)) {
      errors.push(`${path} is scaffold-owned — an edit may only change project source files (src/App.tsx, src/styles.css, …).`);
      continue;
    }
    if (!allowed.has(norm)) {
      const allowedNewFile = external && options.allowNewFiles && isSafeNewProjectFile(norm);
      if (!allowedNewFile) {
        errors.push(`${path} is not part of the active project — only re-emit shown files, or safe new source/config files explicitly requested by the user.`);
        continue;
      }
    }
    if (body.length > 180_000) {
      errors.push(`${path} is too large for one reviewable edit (${body.length} characters).`);
      continue;
    }
    if (/```/.test(body)) errors.push(`${path} contains a leaked markdown fence.`);
    if (!external) checkExternalAssets(body, path, errors);
    if (!external && norm === 'src/App.tsx') {
      checkUtilityClasses(body, errors);
      checkRequestedPersistence(body, options.brief, errors);
      checkBrokenImagePlaceholders(body, errors);
      checkRequestedProgressBounds(body, options.brief, errors);
      checkFilteredIndexMutation(body, errors);
    }

    if (/\.json$/i.test(norm)) {
      let parsed: Record<string, unknown> | null = null;
      if (/(?:^|\/)tsconfig[^/]*\.json$/i.test(norm) && ts) {
        const result = ts.parseConfigFileTextToJson(path, body);
        if (result.error) {
          errors.push(`${path} is invalid JSON/JSONC — ${ts.flattenDiagnosticMessageText(result.error.messageText, ' ')}`);
        } else if (result.config && typeof result.config === 'object') {
          parsed = result.config as Record<string, unknown>;
        }
      } else {
        try {
          const value = JSON.parse(body) as unknown;
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            errors.push(`${path} must contain a JSON object.`);
          } else {
            parsed = value as Record<string, unknown>;
          }
        } catch (error) {
          errors.push(`${path} is invalid JSON — ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (parsed && /(?:^|\/)package\.json$/i.test(norm)) {
        const sections = ['dependencies', 'devDependencies'] as const;
        const packages = Object.assign(
          {},
          ...sections.map((section) => {
            const value = parsed![section];
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
          }),
        ) as Record<string, unknown>;
        const storybookMajors = new Map<string, number>();
        for (const [name, version] of Object.entries(packages)) {
          if (!/^@storybook\/(?:react|addons|addon-)/.test(name) || typeof version !== 'string') continue;
          const major = version.match(/\d+/)?.[0];
          if (major) storybookMajors.set(name, Number(major));
        }
        if (new Set(storybookMajors.values()).size > 1) {
          errors.push(`${path} mixes Storybook major versions (${[...storybookMajors.entries()].map(([name, major]) => `${name}@${major}`).join(', ')}). Keep core and add-ons on one compatible major.`);
        }

        if (!options.allowConfigKeyRemoval) {
          const original = options.referenceFiles?.find((file) => file.path.replace(/\\/g, '/') === norm)?.content;
          if (original) {
            try {
              const before = JSON.parse(original) as Record<string, unknown>;
              const removedTopLevel = Object.keys(before).filter((key) => !(key in parsed!));
              if (removedTopLevel.length > 0) {
                errors.push(`${path} removes existing top-level key(s) without an explicit remove request: ${removedTopLevel.join(', ')}.`);
              }
              const beforeScripts = before.scripts && typeof before.scripts === 'object' && !Array.isArray(before.scripts)
                ? before.scripts as Record<string, unknown>
                : {};
              const afterScripts = parsed.scripts && typeof parsed.scripts === 'object' && !Array.isArray(parsed.scripts)
                ? parsed.scripts as Record<string, unknown>
                : {};
              const removedScripts = Object.keys(beforeScripts).filter((key) => !(key in afterScripts));
              if (removedScripts.length > 0) {
                errors.push(`${path} removes existing script(s) without an explicit remove request: ${removedScripts.join(', ')}.`);
              }
              for (const section of ['dependencies', 'devDependencies'] as const) {
                const beforeEntries = before[section] && typeof before[section] === 'object' && !Array.isArray(before[section])
                  ? before[section] as Record<string, unknown>
                  : {};
                const afterEntries = parsed[section] && typeof parsed[section] === 'object' && !Array.isArray(parsed[section])
                  ? parsed[section] as Record<string, unknown>
                  : {};
                const removed = Object.keys(beforeEntries).filter((key) => !(key in afterEntries));
                if (removed.length > 0) {
                  errors.push(`${path} removes existing ${section} entries without an explicit remove request: ${removed.join(', ')}.`);
                }
              }
            } catch {
              // The original project snapshot is trusted as the user's source;
              // if it is non-standard JSON we still validate the emitted file.
            }
          }
        }
      }
    }

    if (/\.(?:tsx|ts)$/i.test(norm)) {
      for (const match of body.matchAll(/^\s*import\s+(?:[^;'"]+from\s+)?['"]([^'"]+)['"]/gm)) {
        const source = match[1] ?? '';
        if (source.startsWith('./') || source.startsWith('../')) {
          if (!relativeModuleExists(norm, source, availablePaths)) {
            errors.push(`${path} imports missing local module "${source}".`);
          }
          continue;
        }
        if (source.startsWith('@/')) continue;
        if (external) {
          // Real projects have real dependency trees. Only flag imports the
          // project has never used anywhere — and softly, not blocking: the
          // package may be installed but absent from the snapshots we saw.
          const packageName = source.startsWith('@') ? source.split('/').slice(0, 2).join('/') : source.split('/')[0];
          if (knownImports && !knownImports.has(source) && !proposedPackages.has(packageName)) {
            softErrors.push(`${path} adds a new import "${source}" — confirm the package is installed.`);
          }
          continue;
        }
        if (source !== 'react') {
          errors.push(`${path} imports "${source}" — only 'react' and local project files are available.`);
        }
      }
      if (ts) {
        checker = 'tsc';
        const fileName = norm.split('/').pop() ?? 'App.tsx';
        const result = ts.transpileModule(body, {
          reportDiagnostics: true,
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.ESNext,
          },
          fileName,
        });
        let sawSyntaxError = false;
        for (const diag of result.diagnostics ?? []) {
          if (diag.category !== ts.DiagnosticCategory.Error) continue;
          sawSyntaxError = true;
          const message = ts.flattenDiagnosticMessageText(diag.messageText, ' ');
          const line = diag.file && diag.start !== undefined
            ? `:${diag.file.getLineAndCharacterOfPosition(diag.start).line + 1}`
            : '';
          errors.push(`${path}${line} — ${message}`);
          if (errors.length >= 8) break;
        }
        if (!sawSyntaxError && !external) {
          // Semantic pass resolves against OUR hoisted @types/react — meaningless
          // for external projects with their own dependency trees; syntax + fence
          // + truncation checks still guard those.
          try {
            errors.push(...semanticErrors(ts, body, fileName).map((e) => e.replace(fileName, path)));
          } catch {
            // best-effort; never block the turn on the checker itself
          }
        }
      } else if (!roughlyBalanced(body)) {
        errors.push(`${path} braces look unbalanced — likely truncated output.`);
      }
    } else if (/\.css$/i.test(norm)) {
      const opens = (body.match(/\{/g) ?? []).length;
      const closes = (body.match(/\}/g) ?? []).length;
      if (opens !== closes) errors.push(`${path} braces are unbalanced (${opens} "{" vs ${closes} "}") — likely truncated output.`);
    } else if (/\.sol$/i.test(norm)) {
      if (!/^\s*\/\/\s*SPDX-License-Identifier:/m.test(body)) warnings.push(`${path} has no SPDX license identifier.`);
      if (!/^\s*pragma\s+solidity\s+[^;]+;/m.test(body)) errors.push(`${path} has no complete Solidity pragma.`);
      const importOnlyRequested = /without\s+copying\s+(?:its\s+)?logic/i.test(options.brief ?? '')
        && /^\s*import\s+["'][^"']+\.sol["']\s*;/m.test(body);
      if (!importOnlyRequested && !/\b(?:contract|abstract\s+contract|interface|library)\s+[A-Za-z_$][\w$]*/.test(body)) {
        errors.push(`${path} has no Solidity contract, interface, or library declaration.`);
      }
      if (!roughlyBalanced(body)) errors.push(`${path} braces look unbalanced — likely truncated Solidity output.`);
    }
  }

  const app = emitted.get('src/App.tsx');
  const css = emitted.get('src/styles.css');
  if (app && css) {
    checkCssCoverage(app, css, errors, softErrors, warnings);
    checkCssRichness(css, softErrors);
  }

  validateHardhat3Lane(emitted, options, errors);

  return { ok: errors.length === 0, errors, softErrors, warnings, checker };
}
