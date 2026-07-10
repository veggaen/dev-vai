import { describe, expect, it } from 'vitest';
import { extractReplaceActions, stripSandboxActionMarkers } from './sandbox-actions.js';

describe('replace sandbox actions', () => {
  it('extracts and hides a guarded exact replacement action', () => {
    const action = {
      query: 'Participate in a decentralized ecosystem',
      replacement: 'Join the decentralized future',
      paths: ['app/page.tsx'],
      expectedReplacements: 1,
      summary: 'Complete — updated app/page.tsx.',
      details: ['Replaced one exact text match.'],
    };
    const marker = `{{replace:${encodeURIComponent(JSON.stringify(action))}}}`;
    expect(extractReplaceActions(marker)).toEqual([action]);
    expect(stripSandboxActionMarkers(`Applying edit.\n\n${marker}`)).toBe('Applying edit.');
  });

  it('ignores actions without the one-match guard', () => {
    const marker = `{{replace:${encodeURIComponent(JSON.stringify({
      query: 'old',
      replacement: 'new',
      paths: ['a.ts'],
    }))}}}`;
    expect(extractReplaceActions(marker)).toEqual([]);
  });
});
