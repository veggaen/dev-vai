/**
 * CouncilContextTools — the "pull model" for council deliberation.
 *
 * V3gga's design: instead of the orchestrator flattening all context into the prompt (push),
 * each council member is handed POINTERS plus a set of read-only tools and decides for itself
 * which context its lens needs, fetches it, and VERIFIES it before grounding a note. The
 * skeptic might read the live regexes; the type specialist reads the actual `any` sites; the
 * pragmatist reads the test suite. Each member curates and validates its own evidence — which
 * scales (context can be huge; pointers stay small) and closes the orchestrator's blind spots.
 *
 * Safety is non-negotiable: these tools are READ-ONLY and SANDBOXED to the repo root. No
 * writes, no process execution, no path escape (`..` / absolute paths outside root are
 * rejected). A member can look, never touch. Every result is bounded so a member can't blow
 * the context window with one call.
 */

import { readFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** A bounded slice of a file the member asked to read. */
export interface ReadFileResult {
  readonly path: string;
  readonly found: boolean;
  /** The returned text (possibly a line range), or an error explanation when !found. */
  readonly content: string;
  /** Total line count of the file (so the member knows if it got a partial view). */
  readonly totalLines?: number;
  /** The 1-based inclusive line range actually returned. */
  readonly range?: { readonly start: number; readonly end: number };
}

/** One grep hit: file + line number + the matching line (trimmed/bounded). */
export interface GrepHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface GrepResult {
  readonly pattern: string;
  readonly hits: readonly GrepHit[];
  /** True when the hit list was truncated to the cap. */
  readonly truncated: boolean;
}

export interface ListFilesResult {
  readonly glob: string;
  readonly files: readonly string[];
  readonly truncated: boolean;
}

/** The read-only surface a council member may call. All paths are repo-relative. */
export interface CouncilContextTools {
  readFile(relPath: string, range?: { start: number; end: number }): ReadFileResult;
  grep(pattern: string, glob?: string): GrepResult;
  listFiles(glob: string): ListFilesResult;
}

export interface ContextToolLimits {
  /** Max lines returned by a single readFile (default 200). */
  readonly maxReadLines: number;
  /** Max characters per returned line (default 400 — keeps minified/data lines bounded). */
  readonly maxLineChars: number;
  /** Max grep hits returned (default 40). */
  readonly maxGrepHits: number;
  /** Max files returned by listFiles (default 100). */
  readonly maxListFiles: number;
  /** Max bytes a file may be to be grep'd/read (default 2 MB — skip giant blobs). */
  readonly maxFileBytes: number;
}

const DEFAULT_LIMITS: ContextToolLimits = {
  maxReadLines: 200,
  maxLineChars: 400,
  maxGrepHits: 40,
  maxListFiles: 100,
  maxFileBytes: 2 * 1024 * 1024,
};

/** Directories never worth surfacing to a member (noise / huge). */
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.turbo']);

/**
 * Resolve a repo-relative path safely under `root`. Returns null if the path escapes the
 * sandbox (absolute outside root, or `..` traversal). This is the security boundary.
 */
export function resolveSandboxed(root: string, relPath: string): string | null {
  if (typeof relPath !== 'string' || relPath.length === 0) return null;
  // Reject explicit absolute paths and Windows drive paths up front.
  if (path.isAbsolute(relPath)) return null;
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relPath);
  const rel = path.relative(resolvedRoot, target);
  // `rel` starting with '..' (or being absolute) means the target is outside root.
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

function boundLine(line: string, maxChars: number): string {
  return line.length > maxChars ? `${line.slice(0, maxChars)}…` : line;
}

function isIgnored(relPath: string): boolean {
  return relPath.split(/[\\/]/).some((seg) => IGNORED_DIRS.has(seg));
}

/**
 * Compile a simple glob to a RegExp. Supports `**` (any path incl. `/`), `*` (any non-slash
 * run), `?` (one non-slash char), and `{a,b}` alternation — enough for the patterns a member
 * realistically asks for (e.g. `packages/core/src/**\/*.ts`). Native, no glob dependency.
 */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { re += '(?:'; }
    else if (c === '}') { re += ')'; }
    else if (c === ',') { re += '|'; }
    else if ('.+^$()|[]\\'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

/** Recursively collect repo-relative file paths under root, skipping ignored dirs. */
function walkFiles(root: string, cap: number): string[] {
  const out: string[] = [];
  const stack: string[] = [''];
  while (stack.length > 0 && out.length < cap) {
    const relDir = stack.pop()!;
    const absDir = path.resolve(root, relDir);
    let entries;
    try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name)) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(rel);
      else if (e.isFile()) {
        out.push(rel);
        if (out.length >= cap) break;
      }
    }
  }
  return out;
}

/**
 * Build the read-only tool surface rooted at `root` (the repo). Pure factory — no shared
 * mutable state; safe to create per council run.
 */
export function createCouncilContextTools(
  root: string,
  limits: Partial<ContextToolLimits> = {},
): CouncilContextTools {
  const lim = { ...DEFAULT_LIMITS, ...limits };

  const readFile: CouncilContextTools['readFile'] = (relPath, range) => {
    const abs = resolveSandboxed(root, relPath);
    if (!abs) return { path: relPath, found: false, content: 'Rejected: path escapes the repo sandbox or is invalid.' };
    if (isIgnored(relPath)) return { path: relPath, found: false, content: 'Rejected: path is in an ignored directory (node_modules/dist/etc).' };
    let stat;
    try { stat = statSync(abs); } catch { return { path: relPath, found: false, content: 'Not found.' }; }
    if (!stat.isFile()) return { path: relPath, found: false, content: 'Not a file.' };
    if (stat.size > lim.maxFileBytes) return { path: relPath, found: false, content: `Too large to read (${stat.size} bytes > ${lim.maxFileBytes}). Grep it instead.` };

    let raw: string;
    try { raw = readFileSync(abs, 'utf8'); } catch { return { path: relPath, found: false, content: 'Unreadable.' }; }
    const lines = raw.split('\n');
    const totalLines = lines.length;

    let start = 1;
    let end = Math.min(totalLines, lim.maxReadLines);
    if (range) {
      start = Math.max(1, Math.floor(range.start));
      end = Math.min(totalLines, Math.max(start, Math.floor(range.end)));
      if (end - start + 1 > lim.maxReadLines) end = start + lim.maxReadLines - 1;
    }
    const slice = lines.slice(start - 1, end).map((l) => boundLine(l, lim.maxLineChars));
    return {
      path: relPath,
      found: true,
      content: slice.join('\n'),
      totalLines,
      range: { start, end },
    };
  };

  // Generous walk cap so grep/list see the repo without unbounded work on a pathological tree.
  const WALK_CAP = 20_000;

  const grep: CouncilContextTools['grep'] = (pattern, glob = '**/*.{ts,tsx,js,jsx,json,css,md}') => {
    let re: RegExp;
    try { re = new RegExp(pattern); } catch { return { pattern, hits: [], truncated: false }; }
    const globRe = globToRegExp(glob);
    const hits: GrepHit[] = [];
    let truncated = false;
    for (const rel of walkFiles(root, WALK_CAP)) {
      if (!globRe.test(rel)) continue;
      const abs = path.resolve(root, rel);
      let stat;
      try { stat = statSync(abs); } catch { continue; }
      if (stat.size > lim.maxFileBytes) continue;
      let raw: string;
      try { raw = readFileSync(abs, 'utf8'); } catch { continue; }
      const lines = raw.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          if (hits.length >= lim.maxGrepHits) { truncated = true; break; }
          hits.push({ path: rel, line: i + 1, text: boundLine(lines[i].trim(), lim.maxLineChars) });
        }
      }
      if (truncated) break;
    }
    return { pattern, hits, truncated };
  };

  const listFiles: CouncilContextTools['listFiles'] = (glob) => {
    const globRe = globToRegExp(glob);
    const matched = walkFiles(root, WALK_CAP).filter((f) => globRe.test(f));
    const truncated = matched.length > lim.maxListFiles;
    return { glob, files: matched.slice(0, lim.maxListFiles), truncated };
  };

  return { readFile, grep, listFiles };
}
