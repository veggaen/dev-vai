import { describe, expect, it } from 'vitest';
import {
  extractLexicalTokens,
  salientLexicalTokens,
  summarizeLexicalSignals,
  wantsExplicitSourceReferences,
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

  it('detects explicit source-reference requests as shared lexical intent', () => {
    expect(wantsExplicitSourceReferences('give me the answer with sources')).toBe(true);
    expect(wantsExplicitSourceReferences('cite the official docs please')).toBe(true);
    expect(wantsExplicitSourceReferences('according to the research, what changed?')).toBe(true);

    const summary = summarizeLexicalSignals('Please compare these claims with citations and links');
    expect(summary.hasSourceReferenceRequest).toBe(true);
    expect(summary.sourceReferenceHints).toEqual(expect.arrayContaining(['citations', 'links']));
  });

  it('does not confuse source-code language with citation requests', () => {
    expect(wantsExplicitSourceReferences('show me the source code for this widget')).toBe(false);
    expect(wantsExplicitSourceReferences('search references in the source tree')).toBe(false);

    const summary = summarizeLexicalSignals('find references in the source files');
    expect(summary.hasSourceReferenceRequest).toBe(false);
    expect(summary.sourceReferenceHints).toEqual([]);
  });
});
