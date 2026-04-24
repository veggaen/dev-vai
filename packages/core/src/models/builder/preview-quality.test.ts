import { describe, expect, it } from 'vitest';
import { evaluateBuilderPreviewQuality } from './preview-quality.js';

describe('evaluateBuilderPreviewQuality', () => {
  it('passes when rendered preview satisfies required heading, CTA, colors, and motion', () => {
    const report = evaluateBuilderPreviewQuality({
      prompt: 'Build a neon fitness page with exact heading Kinetic Pulse, a CTA button labeled Start Training, hot pink #ff2ea6, deep navy #020617, and kinetic animation.',
      renderedText: 'Kinetic Pulse Start Training Elite training plans',
      sourceText: '<h1 className="kinetic-heading">Kinetic Pulse</h1><button>Start Training</button>',
      cssText: ':root { --accent: #ff2ea6; --page-bg: #020617; } .kinetic-heading { animation: kineticHeadline 4s infinite; } @keyframes kineticHeadline {}',
    });

    expect(report.verdict).toBe('pass');
    expect(report.missing).toEqual([]);
    expect(report.score).toBe(1);
  });

  it('fails when the preview misses explicit product labels', () => {
    const report = evaluateBuilderPreviewQuality({
      prompt: 'The preview must visibly include the heading Shared Shopping List plus separate sections labeled Household and Activity Chat.',
      renderedText: 'Shopping dashboard Members Updates',
      sourceText: '<h1>Shopping dashboard</h1>',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.map((requirement) => requirement.expected)).toEqual([
      'Shared Shopping List',
      'Household',
      'Activity Chat',
    ]);
  });
});
