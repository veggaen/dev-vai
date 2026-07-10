import { describe, expect, it } from 'vitest';
import {
  changeStats,
  isDiffable,
  isProbablyBinaryPath,
  isSafeRelativePath,
  lineDiff,
  makeProposal,
  withStatus,
} from './workspace-edit.js';

const author = { memberId: 'coder' } as const;

describe('workspace-edit', () => {
  it('rejects paths that escape the workspace root', () => {
    expect(isSafeRelativePath('src/app.ts')).toBe(true);
    expect(isSafeRelativePath('../secrets.env')).toBe(false);
    expect(isSafeRelativePath('/etc/passwd')).toBe(false);
    expect(isSafeRelativePath('C:/Windows/system32')).toBe(false);
    expect(isSafeRelativePath('a/../../b')).toBe(false);
  });

  it('flags binary files as not diffable', () => {
    expect(isProbablyBinaryPath('logo.png')).toBe(true);
    expect(isDiffable('logo.png', 'whatever')).toBe(false);
    expect(isDiffable('src/app.ts', 'const x = 1;')).toBe(true);
    // A NUL byte means real binary content.
    expect(isDiffable('data.txt', `a${String.fromCharCode(0)}b`)).toBe(false);
  });

  it('returns null for a no-op proposal', () => {
    expect(makeProposal('a.ts', 'same', 'same', { summary: 's', author })).toBeNull();
  });

  it('builds a pending proposal for a real change', () => {
    const p = makeProposal('a.ts', 'old', 'new', { summary: 'change it', author });
    expect(p).not.toBeNull();
    expect(p?.status).toBe('pending');
    expect(withStatus(p!, 'approved').status).toBe('approved');
  });

  it('counts added and removed lines', () => {
    const p = makeProposal('a.ts', 'one\ntwo\nthree', 'one\ntwo\nTHREE\nfour', { summary: 's', author })!;
    const stats = changeStats(p);
    expect(stats.added).toBe(2); // THREE, four
    expect(stats.removed).toBe(1); // three
    expect(stats.isNew).toBe(false);
    expect(stats.isDelete).toBe(false);
  });

  it('marks new files and deletions', () => {
    expect(changeStats(makeProposal('n.ts', null, 'hello', { summary: 's', author })!).isNew).toBe(true);
    expect(changeStats(makeProposal('d.ts', 'bye', null, { summary: 's', author })!).isDelete).toBe(true);
  });

  it('produces a readable line diff', () => {
    const diff = lineDiff(['a', 'b', 'c'], ['a', 'x', 'c']);
    expect(diff).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'context', text: 'c' },
    ]);
  });
});
