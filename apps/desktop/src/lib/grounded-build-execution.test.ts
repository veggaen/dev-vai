import { describe, expect, it } from 'vitest';
import {
  buildGroundedExecutionRepairPlan,
  shouldTriggerGroundedExecutionRepair,
  type GroundedExecutionBrief,
} from './grounded-build-execution.js';

const brief: GroundedExecutionBrief = {
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
  sourceCount: 2,
  confidence: 0.81,
};

describe('grounded build execution recovery', () => {
  it('triggers for grounded build replies that have no runnable output', () => {
    expect(shouldTriggerGroundedExecutionRepair({
      groundedBrief: brief,
      looksIncomplete: false,
      sandboxIntent: {
        isBuildMode: true,
        explicitStarterRequest: false,
        shouldReportMissingAction: true,
      },
    })).toBe(true);
  });

  it('does not trigger for incomplete streamed replies', () => {
    expect(shouldTriggerGroundedExecutionRepair({
      groundedBrief: brief,
      looksIncomplete: true,
      sandboxIntent: {
        isBuildMode: true,
        explicitStarterRequest: false,
        shouldReportMissingAction: true,
      },
    })).toBe(false);
  });

  it('builds a diff-first repair prompt for active projects', () => {
    const plan = buildGroundedExecutionRepairPlan({
      groundedBrief: { ...brief, intent: 'edit' },
      sandboxIntent: {
        isBuildMode: true,
        explicitStarterRequest: false,
        shouldReportMissingAction: true,
      },
      hasActiveProject: true,
      attempt: 1,
      maxAttempts: 2,
      userPrompt: 'Improve the current app and keep the preview working.',
    });

    expect(plan.repairPrompt).toContain('Output only the changed files');
    expect(plan.repairPrompt).toContain('base44.com, perplexity.ai');
    expect(plan.systemPrompt).toContain('Emit only changed files');
  });

  it('builds a starter-aware prompt for clean rebuild requests', () => {
    const plan = buildGroundedExecutionRepairPlan({
      groundedBrief: brief,
      sandboxIntent: {
        isBuildMode: true,
        explicitStarterRequest: true,
        shouldReportMissingAction: true,
      },
      hasActiveProject: false,
      attempt: 1,
      maxAttempts: 2,
      userPrompt: 'Set up a fresh Next.js app that feels like Base44 plus Perplexity.',
    });

    expect(plan.repairPrompt).toContain('sandbox template or deploy markers');
    expect(plan.buildStatusMessage).toContain('Execution recovery 1/2');
  });
});