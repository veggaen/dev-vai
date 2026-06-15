import { describe, it, expect } from 'vitest';
import { gatherGitEvidence, gitEvidenceIds, hasGitEvidence, type GitRunner } from './git-evidence.js';

const SEP = '\x1f';

/**
 * Build a fake git runner from a map of `argv.join(' ')` → stdout. Any unmatched
 * command resolves empty (mirrors git printing nothing), and a `__throw` key lets a
 * test force a specific command to fail. No real git is ever invoked.
 */
function fakeRunner(responses: Record<string, string>, throwOn: string[] = []): GitRunner {
  return async (args) => {
    const key = args.join(' ');
    if (throwOn.includes(key)) throw new Error(`fatal: simulated failure for "${key}"`);
    return { stdout: responses[key] ?? '', stderr: '' };
  };
}

describe('gatherGitEvidence — repo detection', () => {
  it('returns ok:false when not in a git repo (rev-parse fails)', async () => {
    const runner = fakeRunner({}, ['rev-parse --show-toplevel']);
    const ev = await gatherGitEvidence({ runner, cwd: '/nope' });
    expect(ev.ok).toBe(false);
    expect(ev.error).toMatch(/not a git repository/i);
    expect(ev.changedFiles).toEqual([]);
    expect(hasGitEvidence(ev)).toBe(false);
  });

  it('returns ok:false when rev-parse yields an empty root', async () => {
    const runner = fakeRunner({ 'rev-parse --show-toplevel': '   \n' });
    const ev = await gatherGitEvidence({ runner });
    expect(ev.ok).toBe(false);
    expect(ev.error).toMatch(/empty workspace root/i);
  });
});

describe('gatherGitEvidence — diff parsing', () => {
  it('parses changed files (numstat + name-status) for working tree and index', async () => {
    const runner = fakeRunner({
      'rev-parse --show-toplevel': '/repo\n',
      'diff --numstat': '12\t3\tsrc/foo.ts\n0\t5\tsrc/gone.ts\n',
      'diff --cached --numstat': '4\t0\tsrc/staged.ts\n',
      'diff --name-status': 'M\tsrc/foo.ts\nD\tsrc/gone.ts\n',
      'diff --cached --name-status': 'A\tsrc/staged.ts\n',
      'diff --unified=0': '',
      'diff --cached --unified=0': '',
    });
    const ev = await gatherGitEvidence({ runner, skipLog: true, skipBranch: true });
    expect(ev.ok).toBe(true);
    const byPath = Object.fromEntries(ev.changedFiles.map((f) => [f.path, f]));
    expect(byPath['src/foo.ts']).toMatchObject({ status: 'modified', additions: 12, deletions: 3, staged: false });
    expect(byPath['src/gone.ts']).toMatchObject({ status: 'deleted', additions: 0, deletions: 5 });
    expect(byPath['src/staged.ts']).toMatchObject({ status: 'added', additions: 4, staged: true });
    // Stable evidence id shape.
    expect(byPath['src/foo.ts'].id).toBe('git:file:src/foo.ts');
  });

  it('treats binary diff counts (-) as null additions/deletions', async () => {
    const runner = fakeRunner({
      'rev-parse --show-toplevel': '/repo\n',
      'diff --numstat': '-\t-\tassets/logo.png\n',
      'diff --name-status': 'M\tassets/logo.png\n',
    });
    const ev = await gatherGitEvidence({ runner, skipLog: true, skipBranch: true });
    expect(ev.changedFiles[0]).toMatchObject({ path: 'assets/logo.png', additions: null, deletions: null });
  });

  it('parses unified diff hunk headers with new-file line ranges', async () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -41,0 +42,3 @@ function x() {',
      '+  added line',
      '@@ -10 +9,0 @@',
      '-  removed',
    ].join('\n');
    const runner = fakeRunner({
      'rev-parse --show-toplevel': '/repo\n',
      'diff --numstat': '3\t1\tsrc/foo.ts\n',
      'diff --name-status': 'M\tsrc/foo.ts\n',
      'diff --unified=0': diff,
    });
    const ev = await gatherGitEvidence({ runner, skipLog: true, skipBranch: true });
    expect(ev.hunks).toHaveLength(2);
    expect(ev.hunks[0]).toMatchObject({ path: 'src/foo.ts', newStart: 42, newLines: 3, id: 'git:hunk:src/foo.ts:42' });
    expect(ev.hunks[1]).toMatchObject({ newStart: 9, newLines: 0 });
  });
});

describe('gatherGitEvidence — blame parsing', () => {
  it('attributes each line to a commit + author from line-porcelain', async () => {
    const porcelain = [
      'a1b2c3d4e5f6 1 1 2',
      'author Alice Dev',
      'author-time 1700000000',
      'author-tz +0000',
      'summary initial',
      '\tconst x = 1;',
      'a1b2c3d4e5f6 2 2',
      'author Alice Dev',
      'author-time 1700000000',
      '\tconst y = 2;',
      'f6e5d4c3b2a1 3 3',
      'author Bob Coder',
      'author-time 1710000000',
      '\treturn x + y;',
    ].join('\n');
    const runner = fakeRunner({
      'rev-parse --show-toplevel': '/repo\n',
      'blame --line-porcelain -- src/foo.ts': porcelain,
    });
    const ev = await gatherGitEvidence({ runner, blamePath: 'src/foo.ts', skipDiff: true, skipLog: true, skipBranch: true });
    expect(ev.blame).toHaveLength(3);
    expect(ev.blame[0]).toMatchObject({ line: 1, sha: 'a1b2c3d4e5f6', author: 'Alice Dev', content: 'const x = 1;', id: 'git:blame:src/foo.ts:1' });
    expect(ev.blame[2]).toMatchObject({ line: 3, sha: 'f6e5d4c3b2a1', author: 'Bob Coder', content: 'return x + y;' });
    expect(ev.blame[0].authoredAt).toMatch(/^2023-/);
  });
});

describe('gatherGitEvidence — log parsing', () => {
  it('parses recent commits into structured entries', async () => {
    const log = [
      ['abc1234', 'Alice Dev', '2026-06-10T12:00:00Z', 'feat: add thing'].join(SEP),
      ['def5678', 'Bob Coder', '2026-06-11T08:30:00Z', 'fix: a bug with SEP\x1fweird'].join(SEP),
    ].join('\n');
    const runner = fakeRunner({
      'rev-parse --show-toplevel': '/repo\n',
      [`log -10 --pretty=%h${SEP}%an${SEP}%aI${SEP}%s`]: log,
    });
    const ev = await gatherGitEvidence({ runner, skipDiff: true, skipBranch: true });
    expect(ev.log).toHaveLength(2);
    expect(ev.log[0]).toMatchObject({ sha: 'abc1234', author: 'Alice Dev', subject: 'feat: add thing', id: 'git:commit:abc1234' });
    // Subject containing the separator is preserved (rejoined).
    expect(ev.log[1].subject).toContain('weird');
  });

  it('clamps logLimit into [1,100]', async () => {
    let seenArgs: string[] = [];
    const runner: GitRunner = async (args) => {
      seenArgs = [...args];
      if (args[0] === 'rev-parse') return { stdout: '/repo\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    await gatherGitEvidence({ runner, logLimit: 9999, skipDiff: true, skipBranch: true });
    expect(seenArgs).toContain('-100');
  });
});

describe('gatherGitEvidence — branch state', () => {
  it('reports current branch with ahead/behind vs upstream', async () => {
    const runner = fakeRunner({
      'rev-parse --show-toplevel': '/repo\n',
      'branch --show-current': 'main\n',
      'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'origin/main\n',
      'rev-list --left-right --count origin/main...HEAD': '2\t5\n',
    });
    const ev = await gatherGitEvidence({ runner, skipDiff: true, skipLog: true });
    expect(ev.branch).toMatchObject({ current: 'main', upstream: 'origin/main', behind: 2, ahead: 5, id: 'git:branch:main' });
  });

  it('leaves ahead/behind null when there is no upstream', async () => {
    const runner = fakeRunner(
      { 'rev-parse --show-toplevel': '/repo\n', 'branch --show-current': 'feature\n' },
      ['rev-parse --abbrev-ref --symbolic-full-name @{upstream}'],
    );
    const ev = await gatherGitEvidence({ runner, skipDiff: true, skipLog: true });
    expect(ev.branch).toMatchObject({ current: 'feature', upstream: null, ahead: null, behind: null });
  });
});

describe('gitEvidenceIds + hasGitEvidence', () => {
  it('collects every bindable id and reports presence', async () => {
    const runner = fakeRunner({
      'rev-parse --show-toplevel': '/repo\n',
      'diff --numstat': '1\t0\tsrc/a.ts\n',
      'diff --name-status': 'M\tsrc/a.ts\n',
      'branch --show-current': 'main\n',
      [`log -10 --pretty=%h${SEP}%an${SEP}%aI${SEP}%s`]: ['abc1234', 'A', '2026-01-01T00:00:00Z', 's'].join(SEP),
    }, ['rev-parse --abbrev-ref --symbolic-full-name @{upstream}']);
    const ev = await gatherGitEvidence({ runner });
    const ids = gitEvidenceIds(ev);
    expect(ids.has('git:file:src/a.ts')).toBe(true);
    expect(ids.has('git:commit:abc1234')).toBe(true);
    expect(ids.has('git:branch:main')).toBe(true);
    expect(hasGitEvidence(ev)).toBe(true);
  });

  it('hasGitEvidence is false for a failed gather', async () => {
    const runner = fakeRunner({}, ['rev-parse --show-toplevel']);
    const ev = await gatherGitEvidence({ runner });
    expect(hasGitEvidence(ev)).toBe(false);
  });
});
