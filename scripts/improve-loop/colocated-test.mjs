/**
 * Resolve the co-located unit test for an edited source file, so the apply gate can run it.
 *
 * WHY: the loop auto-applies a fix when tsc is green + the class's failing prompts recover. But
 * tsc-green + prompt-recovery does NOT prove the edit kept the file's OWN unit tests passing. On
 * 2026-06-28 the loop's edits to build-execution-intent.ts (4 thrash commits) broke
 * build-execution-intent.test.ts — tsc stayed green, so it shipped. Running the source file's
 * sibling `*.test.ts` in the verify step closes that hole: a fix that breaks the file's contract
 * is reverted before it lands.
 *
 * Convention in this repo: src/foo/bar.ts ↔ src/foo/bar.test.ts (and .mjs ↔ .test.mjs). We only
 * return a path that actually EXISTS on disk — no test file ⇒ null ⇒ caller falls back to tsc-only.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * @param {string} sourceFile  repo-relative path of the edited file, e.g. packages/core/src/chat/x.ts
 * @param {{root?: string, exists?: (abs: string) => boolean}} [deps]  injectable for tests
 * @returns {string|null}  repo-relative path of the sibling test file, or null if none exists
 */
export function colocatedTestPath(sourceFile, deps = {}) {
  if (!sourceFile || typeof sourceFile !== 'string') return null;
  const root = deps.root ?? resolve(import.meta.dirname, '../..');
  const exists = deps.exists ?? ((abs) => existsSync(abs));

  // Already a test file — run it directly.
  if (/\.test\.(?:ts|tsx|mjs|js|jsx)$/.test(sourceFile)) {
    return exists(resolve(root, sourceFile)) ? sourceFile : null;
  }

  const m = sourceFile.match(/^(.*)\.(ts|tsx|mjs|js|jsx)$/);
  if (!m) return null;
  const [, base, ext] = m;
  // Try the same extension first, then common test extensions (a .ts file may have a .test.ts).
  const candidates = [`${base}.test.${ext}`, `${base}.test.ts`, `${base}.test.tsx`, `${base}.test.mjs`];
  for (const cand of [...new Set(candidates)]) {
    if (exists(resolve(root, cand))) return cand;
  }
  return null;
}
