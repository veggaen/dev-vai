import { describe, expect, it } from 'vitest';
import { buildSearchPlan } from './pipeline.js';

describe('buildSearchPlan normalization', () => {
  it('strips web-search study preambles and trailing build instructions', () => {
    const plan = buildSearchPlan(
      'Use web search to study Base44 and Perplexity, then build the first grounded slice of a hybrid product I can preview.',
    );

    const entities = plan.entities.map((entity) => entity.toLowerCase());
    const fanOut = plan.fanOutQueries.join(' ').toLowerCase();

    expect(entities).toContain('base44');
    expect(entities).toContain('perplexity');
    expect(entities).not.toContain('study');
    expect(fanOut).not.toContain('to study');
    expect(fanOut).not.toContain('grounded slice');
  });
});