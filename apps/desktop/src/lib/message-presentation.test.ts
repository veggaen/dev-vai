import { describe, expect, it } from 'vitest';
import type { GroundedBuildBriefUI, SearchSourceUI } from '../stores/chatStore.js';
import { hasStructuredSources, shouldUseResearchMessageLayout } from './message-presentation.js';

const demoSources: SearchSourceUI[] = [
  {
    url: 'https://example.com/source',
    title: 'Example Source',
    domain: 'example.com',
    snippet: 'A useful evidence snippet.',
    favicon: 'https://example.com/favicon.ico',
    trustTier: 'high',
    trustScore: 0.9,
  },
];

const demoBrief: GroundedBuildBriefUI = {
  intent: 'build',
  focusLabel: 'Calendar app',
  summary: 'Build a focused calendar app from the researched constraints.',
  recommendation: 'Use the existing app-builder flow.',
  nextStep: 'Create the runnable baseline.',
  reasons: ['The request is a build handoff.'],
  sourceDomains: ['example.com'],
  sourceCount: 1,
  confidence: 0.86,
};

describe('message presentation', () => {
  it('detects structured sources only when evidence exists', () => {
    expect(hasStructuredSources(demoSources)).toBe(true);
    expect(hasStructuredSources([])).toBe(false);
    expect(hasStructuredSources(undefined)).toBe(false);
  });

  it('does not render research chrome for source-less research metadata', () => {
    expect(shouldUseResearchMessageLayout({
      role: 'assistant',
      sources: [],
      sourcePresentation: 'research',
      turnKind: 'research',
    })).toBe(false);
  });

  it('renders research chrome for real research evidence', () => {
    expect(shouldUseResearchMessageLayout({
      role: 'assistant',
      sources: demoSources,
      sourcePresentation: 'research',
      turnKind: 'research',
    })).toBe(true);
  });

  it('keeps supporting citations out of the research layout', () => {
    expect(shouldUseResearchMessageLayout({
      role: 'assistant',
      sources: demoSources,
      sourcePresentation: 'supporting',
      turnKind: 'research',
    })).toBe(false);
  });

  it('uses the richer layout for grounded build briefs even without source cards', () => {
    expect(shouldUseResearchMessageLayout({
      role: 'assistant',
      groundedBuildBrief: demoBrief,
    })).toBe(true);
  });
});
