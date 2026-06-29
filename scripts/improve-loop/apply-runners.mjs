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
import { resolve, relative, isAbsolute, win32 as pathWin32 } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
export const AUTO_IMPROVE_BRANCH = 'council/auto-improve';

// Resolve the npx binary by name so we NEVER need shell:true. On Windows the executable is npx.cmd;
// spawnSync can run a .cmd directly (shell:false) as long as it's named explicitly. This removes the
// shell entirely from every call — no metacharacter interpretation, no path-with-spaces splitting
// (the old shell:true for npx was a security + correctness hazard: pkgTsconfig/testPath went through
// shell parsing). git/node were already shell:false; now npx is too.
const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/** Reject a repo-relative path that escapes ROOT (absolute or ../ traversal). The apply path trusts
 *  `file`/`testPath` from model proposals; without this a malformed proposal could read/overwrite or
 *  stage files OUTSIDE the repo. Returns the resolved absolute path, or throws on escape. */
export function resolveInsideRoot(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('path must be a non-empty string');
  // Reject absolute paths in EITHER convention — `C:/…` and `\\server\…` are not absolute under the
  // POSIX isAbsolute() on Linux, so a Windows-absolute path would slip through and be mapped under
  // ROOT (CodeRabbit #25). Check win32 too for a consistent repo-relative contract across platforms.
  if (isAbsolute(value) || pathWin32.isAbsolute(value)) throw new Error(`refusing absolute path outside repo-relative contract: ${value}`);
  const abs = resolve(ROOT, value);
  const rel = relative(ROOT, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`path escapes the checkout root: ${value}`);
  return abs;
}

function sh(cmd, args, opts = {}) {
  // npx is invoked by its platform binary name (npx.cmd on Windows) so we can keep shell:false for
  // EVERY command — no shell parsing of args, paths-with-spaces safe, no metacharacter injection.
  const realCmd = /^npx$/i.test(cmd) ? NPX_BIN : cmd;
  const r = spawnSync(realCmd, args, { cwd: ROOT, encoding: 'utf8', timeout: opts.timeoutMs ?? 300_000, shell: false, ...opts });
  // CRITICAL distinction: r.status===null means the process did NOT exit normally — it timed out
  // (r.error.code==='ETIMEDOUT') or failed to spawn. That is an INFRA failure, NOT a non-zero exit.
  // Conflating them ("code: r.status ?? 1") made a timed-out tsc look like a type error → every patch
  // falsely reverted under GPU load (tsc is slow while the loop runs models). `infra` lets verify
  // tell "your patch is broken" from "tsc couldn't run", so an infra blip never strikes a good fix.
  const infra = r.status === null || !!r.error;
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), error: r.error, infra };
}

/** The git branch HEAD is currently on (or '' if undetectable). */
export function currentBranch() {
  const r = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.code === 0 ? r.out.trim() : '';
}

/** The current HEAD commit sha (short), or '' if undetectable. Captured before a loop commit so a
 *  failed behavioural-acceptance check can revert exactly that commit. */
export function headSha() {
  const r = sh('git', ['rev-parse', '--short', 'HEAD']);
  return r.code === 0 ? r.out.trim() : '';
}

/**
 * Revert a specific commit by sha with `git revert --no-edit` (a NEW commit that undoes it — honest
 * history, never a force-reset that rewrites it). Branch-guarded like commit(). Returns {ok,detail}.
 * Used by the acceptance gate: a fix that passed tsc + committed but did NOT make the class's broken
 * prompts recover is behaviourally wrong and must be backed out, not left to rot in the branch.
 */
export function revertCommit(sha, { branch = AUTO_IMPROVE_BRANCH } = {}) {
  if (!sha) return { ok: false, detail: 'no sha to revert' };
  const head = currentBranch();
  if (head !== branch) return { ok: false, detail: `refusing to revert: HEAD is '${head}', not '${branch}'` };
  const r = sh('git', ['revert', '--no-edit', sha]);
  return r.code === 0 ? { ok: true, detail: `reverted ${sha}` } : { ok: false, detail: `git revert failed: ${r.out.slice(0, 160)}` };
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
    // Resolve through resolveInsideRoot so a malformed proposal path (absolute or ../ traversal)
    // can't read or overwrite host files outside the repo. Throws on escape → applyVerifiedFix
    // treats it as a failed apply (reverted), never touching anything outside the checkout.
    readFile: (file) => { const p = resolveInsideRoot(file); return existsSync(p) ? readFileSync(p, 'utf8') : null; },
    writeFile: (file, contents) => writeFileSync(resolveInsideRoot(file), contents),

    verify: async () => {
      // 1) Typecheck — the cheapest strong signal that the edit didn't break the build. Timeout
      //    raised to 6min: tsc runs SLOW while the loop holds the GPU, and a slow tsc must not be
      //    mistaken for a broken patch.
      const tsc = sh('npx', ['tsc', '-p', pkgTsconfig, '--noEmit'], { timeoutMs: opts.verifyTimeoutMs ?? 360_000 });
      // INFRA failure (timeout / couldn't spawn) is NOT a type error — return ok:false WITH infra:true
      // so the caller skips (doesn't strike/quarantine a good patch). Conflating these falsely reverted
      // every patch under GPU load — the real wall to ever landing a fix.
      if (tsc.infra) return { ok: false, infra: true, detail: `tsc could not complete (infra: ${tsc.error?.code ?? 'timeout/spawn'}) — not a type error` };
      if (tsc.code !== 0) {
        const firstErr = tsc.out.split('\n').find((l) => /error TS\d+/.test(l)) ?? (tsc.out.slice(0, 200) || '(no diagnostic — likely infra)');
        return { ok: false, detail: `tsc failed: ${firstErr}` };
      }
      // 2) Optional scoped tests — only when the caller names a test path (keeps verify fast).
      if (opts.testPath) {
        // Reject a testPath that escapes the repo before handing it to vitest (same untrusted-path
        // contract as readFile/writeFile).
        try { resolveInsideRoot(opts.testPath); }
        catch (e) { return { ok: false, detail: `unsafe testPath rejected: ${String(e.message)}` }; }
        const vt = sh('npx', ['vitest', 'run', opts.testPath], { timeoutMs: opts.verifyTimeoutMs ?? 360_000 });
        if (vt.infra) return { ok: false, infra: true, detail: `tests could not complete (infra) — not a test failure` };
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
      // REQUIRE an explicit single target file. Without it, `git commit -m` would sweep in whatever
      // is already staged, breaking the one-changed-file-only contract (CodeRabbit #25).
      if (!file) throw new Error('refusing to commit: no explicit target file (one-file-only contract)');
      const resolvedFile = resolveInsideRoot(file); // also enforce the repo-relative contract
      // Stage ONLY the changed file (never `git add -A`) so we can't sweep unrelated changes.
      const add = sh('git', ['add', '--', resolvedFile]);
      if (add.code !== 0) throw new Error(`git add failed: ${add.out}`);
      // Commit ONLY that pathspec so anything else already staged is excluded from this commit.
      const commit = sh('git', ['commit', '-m', message, '--', resolvedFile]);
      if (commit.code !== 0) {
        // UNSTAGE the file we just `git add`-ed so a failed commit doesn't leave it staged — a staged
        // blob would otherwise leak into the NEXT auto-commit (CodeRabbit #25). Best-effort reset.
        sh('git', ['reset', '--quiet', 'HEAD', '--', resolvedFile]);
        throw new Error(`git commit failed: ${commit.out}`);
      }
    },

    // Best-effort unstage of a single file — lets apply-fix clean the index if commit fails (#25).
    unstage: (file) => {
      if (!file) return;
      try { sh('git', ['reset', '--quiet', 'HEAD', '--', resolveInsideRoot(file)]); } catch { /* best-effort */ }
    },
  };
}
