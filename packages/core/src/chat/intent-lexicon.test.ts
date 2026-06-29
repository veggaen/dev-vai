import { describe, expect, it } from 'vitest';
import {
  extractLexicalTokens,
  salientLexicalTokens,
  summarizeLexicalSignals,
} from './intent-lexicon.js';

describe('intent lexicon', () => {
  it('extracts and normalizes tokens while preserving technology spellings', () => {
    expect(extractLexicalTokens('Compare C#, C++, node.js, and x.com.')).toEqual([
      'compare',
      'c#',
      'c++',
      'node.js',
      'and',
      'x.com',
    ]);
  });

  it('drops structural glue but keeps intent and domain words', () => {
    expect(salientLexicalTokens('what is the difference between docker and kubernetes')).toEqual([
      'difference',
      'docker',
      'kubernetes',
    ]);
  });

  it('preserves short technical tokens that carry real meaning', () => {
    const tokens = salientLexicalTokens('compare c# and c++ with node.js for UI work');
    expect(tokens).toContain('c#');
    expect(tokens).toContain('c++');
    expect(tokens).toContain('node.js');
    expect(tokens).toContain('ui');
  });

  it('summarizes request starts, intent words, and uniqueness hints', () => {
    const summary = summarizeLexicalSignals('Please audit whether this idea has a unique defensible angle');
    expect(summary.startsWithRequestAction).toBe(true);
    expect(summary.startWords).toContain('please');
    expect(summary.intentWords).toContain('audit');
    expect(summary.hasUniquenessHint).toBe(true);
    expect(summary.uniquenessHints).toEqual(expect.arrayContaining(['unique', 'defensible', 'angle']));
  });

  it('detects one-of-a-kind as a uniqueness phrase', () => {
    const summary = summarizeLexicalSignals('Is this one of a kind or just another clone?');
    expect(summary.hasUniquenessHint).toBe(true);
    expect(summary.uniquenessHints).toContain('one-of-a-kind');
  });
});
