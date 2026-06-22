/**
 * Production dependency injection for applyVerifiedFix — the real fs / verify / git side of
 * the audit→fix→verify loop. apply-fix.mjs is pure and takes these as `deps`; here we build
 * the concrete ones. Kept separate so the harness stays unit-testable (apply-fix.test.mjs
 * injects fakes) while the real I/O lives here.
 *
 * SAFETY (the autonomy contract, enforced in CODE not just convention):
 *   - commit() REFUSES to commit unless HEAD is the dedicated branch (default
 *     council/auto-improve). It NEVER commits to main or a feature branch. It stages ONLY the
 *     one changed file (never `git add -A`), so it can't sweep unrelated working-tree changes.
 *   - verify() runs the strongest practical check (tsc + a scoped vitest) and reports green/red;
 *     applyVerifiedFix reverts on red, so a failed verify never reaches commit().
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
export const AUTO_IMPROVE_BRANCH = 'council/auto-improve';

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: opts.timeoutMs ?? 300_000, ...opts });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), error: r.error };
}

/** The git branch HEAD is currently on (or '' if undetectable). */
export function currentBranch() {
  const r = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.code === 0 ? r.out.trim() : '';
}

/**
 * Build the real deps for applyVerifiedFix.
 * @param opts {
 *   pkgTsconfig?: string,  // tsconfig to typecheck (default core — most self-improve fixes live there)
 *   testPath?: string,     // optional scoped vitest path; omitted → tsc-only verify
 *   branch?: string,       // dedicated branch the committer is allowed to touch
 *   verifyTimeoutMs?: number,
 * }
 */
export function realApplyDeps(opts = {}) {
  const branch = opts.branch ?? AUTO_IMPROVE_BRANCH;
  const pkgTsconfig = opts.pkgTsconfig ?? 'packages/core/tsconfig.json';

  return {
    branch,
    readFile: (file) => (existsSync(resolve(ROOT, file)) ? readFileSync(resolve(ROOT, file), 'utf8') : null),
    writeFile: (file, contents) => writeFileSync(resolve(ROOT, file), contents),

    verify: async () => {
      // 1) Typecheck — the cheapest strong signal that the edit didn't break the build.
      const tsc = sh('npx', ['tsc', '-p', pkgTsconfig, '--noEmit'], { timeoutMs: opts.verifyTimeoutMs ?? 240_000 });
      if (tsc.code !== 0) {
        const firstErr = tsc.out.split('\n').find((l) => /error TS\d+/.test(l)) ?? tsc.out.slice(0, 200);
        return { ok: false, detail: `tsc failed: ${firstErr}` };
      }
      // 2) Optional scoped tests — only when the caller names a test path (keeps verify fast).
      if (opts.testPath) {
        const vt = sh('npx', ['vitest', 'run', opts.testPath], { timeoutMs: opts.verifyTimeoutMs ?? 240_000 });
        if (vt.code !== 0) {
          const fail = vt.out.split('\n').find((l) => /FAIL|✗|failed/i.test(l)) ?? vt.out.slice(-200);
          return { ok: false, detail: `tests failed: ${fail}` };
        }
        return { ok: true, detail: `tsc + ${opts.testPath} green` };
      }
      return { ok: true, detail: 'tsc green (tsc-only verify)' };
    },

    commit: async (message, file) => {
      // HARD branch guard — the autonomy contract in code.
      const head = currentBranch();
      if (head !== branch) {
        throw new Error(`refusing to commit: HEAD is '${head}', auto-improve only commits to '${branch}'`);
      }
      // Stage ONLY the changed file (never `git add -A`) so we can't sweep unrelated changes.
      if (file) {
        const add = sh('git', ['add', '--', file]);
        if (add.code !== 0) throw new Error(`git add failed: ${add.out}`);
      }
      const commit = sh('git', ['commit', '-m', message]);
      if (commit.code !== 0) throw new Error(`git commit failed: ${commit.out}`);
    },
  };
}
