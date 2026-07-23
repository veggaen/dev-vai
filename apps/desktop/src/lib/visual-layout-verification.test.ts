import { describe, expect, it } from 'vitest';
import { blockingVisualLayoutEvidence, isVisualLayoutCandidate } from './visual-layout-verification.js';

describe('visual layout verification helpers', () => {
  it('turns multi-viewport error evidence into a concise deduplicated repair contract', () => {
    const evidence = blockingVisualLayoutEvidence({
      url: 'http://localhost:4100',
      verdict: 'fail',
      runs: [
        {
          viewport: { name: 'desktop', width: 1440, height: 1000 },
          verdict: 'fail',
          spacingRhythmPx: 16,
          browserErrors: [],
          issues: [{
            rule: 'touching-autonomous-surfaces',
            severity: 'error',
            message: '.stats-header and .search-bar are only 0px apart; expected 16px.',
            selectors: ['.stats-header', '.search-bar'],
            measuredPx: 0,
            expectedPx: 16,
          }],
        },
      ],
    });

    expect(evidence).toEqual(['desktop: .stats-header and .search-bar are only 0px apart; expected 16px.']);
  });

  it('only spends a browser audit on files that can affect the rendered UI', () => {
    expect(isVisualLayoutCandidate(['src/App.tsx', 'src/styles.css'])).toBe(true);
    expect(isVisualLayoutCandidate(['README.md', 'server/db.sql'])).toBe(false);
  });
});
