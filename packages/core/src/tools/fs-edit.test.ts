import { describe, it, expect } from 'vitest';
import { confinePath, lineDiff, contentHash, ABSENT_HASH } from './fs-edit.js';

describe('confinePath — workspace confinement (fs SSRF guard)', () => {
  const root = process.platform === 'win32' ? 'C:\\work\\repo' : '/work/repo';

  it('accepts a normal relative path inside the root', () => {
    expect(confinePath('src/foo.ts', root)).not.toBeNull();
  });

  it('rejects a parent-traversal escape', () => {
    expect(confinePath('../outside.ts', root)).toBeNull();
    expect(confinePath('src/../../escape.ts', root)).toBeNull();
  });

  it('rejects an absolute path outside the root', () => {
    const outside = process.platform === 'win32' ? 'C:\\other\\x.ts' : '/etc/passwd';
    expect(confinePath(outside, root)).toBeNull();
  });

  it('accepts an absolute path that IS inside the root', () => {
    const inside = process.platform === 'win32' ? 'C:\\work\\repo\\a\\b.ts' : '/work/repo/a/b.ts';
    expect(confinePath(inside, root)).not.toBeNull();
  });

  it('rejects the root directory itself (not an editable file)', () => {
    expect(confinePath('.', root)).toBeNull();
  });
});

describe('lineDiff — readable evidence diff', () => {
  it('reports no change for identical content', () => {
    const d = lineDiff('a\nb\n', 'a\nb\n');
    expect(d.diff).toBe('(no change)');
    expect(d.additions).toBe(0);
    expect(d.deletions).toBe(0);
  });

  it('shows only the changed middle, trimming common prefix/suffix', () => {
    const before = 'line1\nline2\nline3\nline4';
    const after = 'line1\nCHANGED\nline3\nline4';
    const d = lineDiff(before, after);
    expect(d.diff).toContain('- line2');
    expect(d.diff).toContain('+ CHANGED');
    expect(d.diff).not.toContain('line1'); // trimmed as common prefix
    expect(d.additions).toBe(1);
    expect(d.deletions).toBe(1);
  });

  it('counts pure additions and pure deletions', () => {
    expect(lineDiff('a', 'a\nb\nc')).toMatchObject({ additions: 2, deletions: 0 });
    expect(lineDiff('a\nb\nc', 'a')).toMatchObject({ additions: 0, deletions: 2 });
  });

  it('handles creating from empty content', () => {
    const d = lineDiff('', 'new\ncontent');
    expect(d.additions).toBe(2);
    expect(d.deletions).toBe(0);
  });
});

describe('contentHash', () => {
  it('is deterministic and content-sensitive', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'));
    expect(contentHash('hello')).not.toBe(contentHash('hello '));
    expect(contentHash('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ABSENT_HASH is a distinct sentinel, not a real hash', () => {
    expect(ABSENT_HASH).toBe('absent');
    expect(ABSENT_HASH).not.toMatch(/^[0-9a-f]{64}$/);
  });
});
