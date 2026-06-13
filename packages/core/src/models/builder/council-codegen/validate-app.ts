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
export async function validateEditedFiles(
  emitted: ReadonlyMap<string, string>,
  allowedPaths: readonly string[],
): Promise<AppValidationReport> {
  const errors: string[] = [];
  const softErrors: string[] = [];
  const warnings: string[] = [];
  let checker: AppValidationReport['checker'] = 'heuristic';

  if (emitted.size === 0) {
    errors.push('No titled file blocks were produced — re-emit each changed file in a fenced block with title="path".');
  }

  const allowed = new Set(allowedPaths.map((p) => p.replace(/\\/g, '/')));
  allowed.add('src/App.tsx');
  allowed.add('src/styles.css');

  const ts = await loadTypescript();
  for (const [path, body] of emitted) {
    const norm = path.replace(/\\/g, '/');
    if (SCAFFOLD_OWNED_PATH.test(norm)) {
      errors.push(`${path} is scaffold-owned — an edit may only change project source files (src/App.tsx, src/styles.css, …).`);
      continue;
    }
    if (!allowed.has(norm)) {
      errors.push(`${path} is not part of the active project — only re-emit the files you were shown.`);
      continue;
    }
    if (/```/.test(body)) errors.push(`${path} contains a leaked markdown fence.`);
    checkExternalAssets(body, path, errors);

    if (/\.(?:tsx|ts)$/i.test(norm)) {
      for (const match of body.matchAll(/^\s*import\s+(?:[^;'"]+from\s+)?['"]([^'"]+)['"]/gm)) {
        const source = match[1] ?? '';
        if (source !== 'react' && !source.startsWith('./') && !source.startsWith('../')) {
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
        if (!sawSyntaxError) {
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
    }
  }

  const app = emitted.get('src/App.tsx');
  const css = emitted.get('src/styles.css');
  if (app && css) checkCssCoverage(app, css, errors, softErrors, warnings);

  return { ok: errors.length === 0, errors, softErrors, warnings, checker };
}
