import { describe, expect, it } from 'vitest';
import {
  buildGroundedBuildBriefExecutionPrompt,
  getGroundedBuildBriefActionLabel,
  type GroundedBuildBriefActionInput,
} from './grounded-build-brief-actions.js';

const baseBrief: GroundedBuildBriefActionInput = {
  intent: 'build',
  focusLabel: 'base44 + perplexity',
  summary: 'Use one grounded product loop before broadening the feature surface.',
  recommendation: 'Build the chat-to-preview loop first.',
  nextStep: 'Emit runnable files for the first grounded slice now.',
  reasons: [
    'Most of the supporting evidence came from base44.com and perplexity.ai.',
    'The prompt mixes multiple product ideas, so the first build should choose one canonical loop.',
  ],
  sourceDomains: ['base44.com', 'perplexity.ai'],
  confidence: 0.81,
};

describe('grounded build brief actions', () => {
  it('uses a build label for build briefs', () => {
    expect(getGroundedBuildBriefActionLabel(baseBrief)).toBe('Build first slice');
  });

  it('uses an edit label for edit briefs', () => {
    expect(getGroundedBuildBriefActionLabel({ ...baseBrief, intent: 'edit' })).toBe('Apply to current app');
  });

  it('creates a build execution prompt with the brief content', () => {
    const prompt = buildGroundedBuildBriefExecutionPrompt(baseBrief);

    expect(prompt).toContain('Focus: base44 + perplexity');
    expect(prompt).toContain('Supporting domains: base44.com, perplexity.ai');
    expect(prompt).toContain('Create the first grounded slice now.');
    expect(prompt).toContain('Emit runnable output only.');
  });

  it('creates a diff-first execution prompt for edit briefs', () => {
    const prompt = buildGroundedBuildBriefExecutionPrompt({
      ...baseBrief,
      intent: 'edit',
    });

    expect(prompt).toContain('Update the current app if one exists');
    expect(prompt).toContain('changed files');
  });
});