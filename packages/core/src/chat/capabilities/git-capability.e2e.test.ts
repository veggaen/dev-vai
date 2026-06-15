import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatherGitEvidence } from '../../tools/git-evidence.js';
import { gitCapability } from './git-capability.js';
import { synthesizeFromEvidence } from '../../synthesis/synthesize.js';
import { gitEvidenceToItems } from '../../synthesis/git-adapter.js';
import type { TurnContext } from '../turn-pipeline.js';
import type { GitEvidence } from '../../tools/git-evidence.js';

const exec = promisify(execFile);

/**
 * END-TO-END: build a REAL throwaway git repo, make a real commit + a real working
 * change, then drive the full chain gatherGitEvidence → gitCapability → verify with
 * actual git. This proves the deterministic capability answers correctly from real
 * git output (not just from mocked runner stdout), and that verify passes the grounded
 * answer but REFUSES a fabricated SHA.
 */

let repoDir: string;
let headSha = '';
let available = true;

function ctx(text: string, git?: GitEvidence): TurnContext {
  return {
    content: text,
    understood: text,
    history: [],
    classification: {
      kind: 'standalone-question',
      confidence: 1,
      signals: [],
      referencesPriorTurn: false,
      isShortAnaphoric: false,
      wordCount: text.split(/\s+/).length,
    },
    intent: 'action-yesno',
    guidance: [],
    evidence: git ? { git } : undefined,
  };
}

beforeAll(async () => {
  try {
    await exec('git', ['--version']);
  } catch {
    available = false;
    return;
  }
  repoDir = await mkdtemp(join(tmpdir(), 'vai-git-e2e-'));
  const run = (args: string[]) => exec('git', args, { cwd: repoDir });
  await run(['init', '-q']);
  await run(['config', 'user.email', 'e2e@vai.test']);
  await run(['config', 'user.name', 'E2E Tester']);
  await run(['config', 'commit.gpgsign', 'false']);
  // First commit: a tracked file.
  await writeFile(join(repoDir, 'app.ts'), 'export const version = 1;\n', 'utf8');
  await run(['add', 'app.ts']);
  await run(['commit', '-q', '-m', 'feat: initial app']);
  const { stdout } = await run(['rev-parse', '--short', 'HEAD']);
  headSha = stdout.trim();
  // Now a real working-tree change (unstaged) + a brand-new untracked-then-staged file.
  await writeFile(join(repoDir, 'app.ts'), 'export const version = 2;\nexport const name = "vai";\n', 'utf8');
  await writeFile(join(repoDir, 'added.ts'), 'export const fresh = true;\n', 'utf8');
  await run(['add', 'added.ts']);
}, 30_000);

afterAll(async () => {
  if (repoDir) await rm(repoDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('gitCapability — end-to-end against a real repo', () => {
  it('gathers real diff + log + branch evidence', async () => {
    if (!available) return; // git not installed in this environment — skip gracefully
    const ev = await gatherGitEvidence({ cwd: repoDir });
    expect(ev.ok).toBe(true);
    // Real working-tree modification to app.ts + staged add of added.ts.
    const paths = ev.changedFiles.map((f) => f.path).sort();
    expect(paths).toContain('app.ts');
    expect(paths).toContain('added.ts');
    expect(ev.changedFiles.find((f) => f.path === 'added.ts')).toMatchObject({ status: 'added', staged: true });
    // Real commit in the log with the SHA we captured.
    expect(ev.log.some((c) => c.sha === headSha)).toBe(true);
    expect(ev.log[0].subject).toContain('initial app');
    expect(ev.branch?.current).toBeTruthy();
  }, 30_000);

  it('composes a grounded answer whose SHA matches the real repo and PASSES verify', async () => {
    if (!available) return;
    const ev = await gatherGitEvidence({ cwd: repoDir });
    const c = ctx('what changed in my repo and what are the recent commits?', ev);
    const r = gitCapability.resolve(c);
    expect(r).not.toBeNull();
    expect(r!.text).toContain('`app.ts`');
    expect(r!.text).toContain(headSha); // the REAL commit sha
    const v = gitCapability.verify(r!, c);
    expect(v.ok).toBe(true);
    expect(v.boundEvidence && v.boundEvidence.length).toBeGreaterThan(0);
  }, 30_000);

  it('REFUSES a fabricated SHA injected into a real grounded answer', async () => {
    if (!available) return;
    const ev = await gatherGitEvidence({ cwd: repoDir });
    const c = ctx('show me recent commits', ev);
    const r = gitCapability.resolve(c)!;
    const tampered = { ...r, text: r.text + '\n  - `0000000` invented commit — Ghost' };
    const v = gitCapability.verify(tampered, c);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/0000000/);
  }, 30_000);

  it('blames a real committed line to a real author (HEAD revision)', async () => {
    if (!available) return;
    // Blame the committed file (HEAD), not the working-tree copy whose modified
    // lines git honestly attributes to "Not Committed Yet".
    const ev = await gatherGitEvidence({ cwd: repoDir, blamePath: 'app.ts', blameRev: 'HEAD' });
    expect(ev.blame.length).toBeGreaterThan(0);
    expect(ev.blame[0].author).toBe('E2E Tester');
    const c = ctx('who wrote line 1 of app.ts?', ev);
    const r = gitCapability.resolve(c)!;
    expect(r.text).toContain('E2E Tester');
    expect(gitCapability.verify(r, c).ok).toBe(true);
  }, 30_000);

  it('feeds real git evidence into deterministic synthesis (no model)', async () => {
    if (!available) return;
    const ev = await gatherGitEvidence({ cwd: repoDir });
    const items = gitEvidenceToItems(ev);
    expect(items.length).toBeGreaterThan(0);
    const res = synthesizeFromEvidence(items, 'what do I know about app.ts', { filterByQuery: true });
    // app.ts claims surface and every claim is source-bound.
    expect(res.claims.some((cl) => cl.subject === 'app.ts')).toBe(true);
    expect(res.claims.every((cl) => cl.sources.length >= 1)).toBe(true);
    expect(res.sourceCount).toBeGreaterThan(0);
  }, 30_000);
});
