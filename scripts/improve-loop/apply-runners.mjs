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
  // shell:true ONLY for npx — on Windows spawnSync('npx', …) without it returns ENOENT (npx is
  // npx.cmd). This is why tsc verify NEVER ran here: every apply hit ENOENT and the loop could never
  // land a fix. But shell:true makes spawnSync re-parse args through the shell, so a commit -m message
  // with spaces would split (git saw "Exclude" as a pathspec). git/node resolve WITHOUT a shell, so
  // we keep them shell:false (args passed literally, spaces safe). Only npx needs the shell.
  const useShell = /^npx(\.cmd)?$/i.test(cmd);
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: opts.timeoutMs ?? 300_000, shell: useShell, ...opts });
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
    readFile: (file) => (existsSync(resolve(ROOT, file)) ? readFileSync(resolve(ROOT, file), 'utf8') : null),
    writeFile: (file, contents) => writeFileSync(resolve(ROOT, file), contents),

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
