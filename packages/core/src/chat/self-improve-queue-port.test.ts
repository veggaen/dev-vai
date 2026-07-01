import { describe, expect, it } from 'vitest';
import { isActionableCapability, jobsFromConsensus, type CouncilConsensusLike } from './self-improve-queue-port.js';

describe('isActionableCapability', () => {
  it('accepts a substantive capability', () => {
    expect(isActionableCapability('a route that answers business-idea prompts with opportunities')).toBe(true);
  });
  it('rejects empty / vague / boilerplate strings', () => {
    for (const v of ['', '   ', 'none', 'N/A', 'unknown', 'nothing', 'improve', 'be better', 'more context', 'short']) {
      expect(isActionableCapability(v)).toBe(false);
    }
  });
});

describe('jobsFromConsensus', () => {
  const prompt = 'what software business could I start in Norway?';

  it('produces a job per actionable missingCapability on a non-ship consensus', () => {
    const consensus: CouncilConsensusLike = {
      outcome: 'needs-work',
      missingCapabilities: ['a business-opportunity route that suggests concrete ideas', 'live market-size data lookup'],
      methodLessons: ['route business-idea intent to the opportunity handler, not country facts'],
      realIntent: 'wants software business ideas for Norway',
    };
    const jobs = jobsFromConsensus(consensus, prompt);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].missingCapability).toMatch(/opportunity route/);
    expect(jobs[0].realIntent).toMatch(/software business ideas/);
    expect(jobs[0].methodLesson).toMatch(/opportunity handler/);
    expect(jobs[0].prompt).toBe(prompt);
    expect(typeof jobs[0].intent).toBe('string');
  });

  it('does NOT enqueue when the council shipped (a good answer needs no code change)', () => {
    const consensus: CouncilConsensusLike = { outcome: 'ship', missingCapabilities: ['something'] };
    expect(jobsFromConsensus(consensus, prompt)).toEqual([]);
  });

  it('filters vague capabilities and keeps only actionable ones', () => {
    const consensus: CouncilConsensusLike = {
      outcome: 'needs-work',
      missingCapabilities: ['none', 'improve', 'a syntax-highlighted diff viewer for code review'],
    };
    const jobs = jobsFromConsensus(consensus, prompt);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].missingCapability).toMatch(/diff viewer/);
  });

  it('de-duplicates identical capabilities within one consensus', () => {
    const consensus: CouncilConsensusLike = {
      outcome: 'needs-work',
      missingCapabilities: ['a currency conversion helper', 'A Currency Conversion Helper', 'a currency conversion helper'],
    };
    expect(jobsFromConsensus(consensus, prompt)).toHaveLength(1);
  });

  it('returns [] when there are no missing capabilities', () => {
    expect(jobsFromConsensus({ outcome: 'needs-work', missingCapabilities: [] }, prompt)).toEqual([]);
    expect(jobsFromConsensus({ outcome: 'needs-work' }, prompt)).toEqual([]);
  });

  it('carries the memberId attribution when provided', () => {
    const consensus: CouncilConsensusLike = { outcome: 'needs-work', missingCapabilities: ['a markdown table renderer for chat answers'] };
    const jobs = jobsFromConsensus(consensus, prompt, { memberId: 'frontend-engineer' });
    expect(jobs[0].memberId).toBe('frontend-engineer');
  });
});
