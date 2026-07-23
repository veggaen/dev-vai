import { describe, expect, it } from 'vitest';
import { buildEditMessages, buildStylistMessages } from './prompts.js';

describe('Council relational visual prompt contract', () => {
  it('teaches the stylist to reason about surface relationships, media fit, and semantic art', () => {
    const [system] = buildStylistMessages(
      {
        title: 'Book Tracker',
        packageName: 'book-tracker',
        summary: 'Track reading.',
        features: ['search books'],
        fromArchitect: true,
      },
      ['stats-header', 'search-bar', 'book-cover'],
      '<main><header className="stats-header"/><div className="search-bar"/><svg className="book-cover"/></main>',
    );

    expect(system?.content).toContain('two independently rounded panels touching at 0px is a failure');
    expect(system?.content).toContain('must fit their containers at desktop, tablet, and mobile');
    expect(system?.content).toContain('Repeating the same line/path/rectangle/template does not satisfy meaning');
  });

  it('adds the contract to visual edits without bloating unrelated maintenance prompts', () => {
    const edit = {
      projectName: 'book-tracker',
      files: [{ path: 'src/styles.css', content: '.search-bar { display: flex; }' }],
    };
    const [visualSystem] = buildEditMessages('Fix the missing gap between the rounded header and search panel.', edit);
    const [logicSystem] = buildEditMessages('Rename the exported parser function without changing behavior.', edit);

    expect(visualSystem?.content).toContain('RELATIONAL SPACING');
    expect(logicSystem?.content).not.toContain('RELATIONAL SPACING');
  });
});
