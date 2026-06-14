import { describe, it, expect } from 'vitest';
import { lineDiffStats } from '../src/routes/sandbox.js';

describe('lineDiffStats — FileChangesBar +added/−removed', () => {
  it('counts every line as added for a new file (before=null)', () => {
    expect(lineDiffStats(null, 'a\nb\nc')).toEqual({ added: 3, removed: 0 });
  });

  it('counts every line as removed for a deleted file (after=null)', () => {
    expect(lineDiffStats('a\nb', null)).toEqual({ added: 0, removed: 2 });
  });

  it('reports zero for an unchanged file', () => {
    expect(lineDiffStats('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0 });
  });

  it('counts added and removed lines on an edit', () => {
    // remove "b", add "x" and "y"
    expect(lineDiffStats('a\nb\nc', 'a\nc\nx\ny')).toEqual({ added: 2, removed: 1 });
  });

  it('treats both-null as no change', () => {
    expect(lineDiffStats(null, null)).toEqual({ added: 0, removed: 0 });
  });

  it('handles duplicate lines via multiset counting', () => {
    // before has 2× "log", after has 1× "log" → one removed
    expect(lineDiffStats('log\nlog\nend', 'log\nend')).toEqual({ added: 0, removed: 1 });
  });
});
