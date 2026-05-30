import { describe, expect, it } from 'vitest';
import { evaluateBuilderPreviewQuality } from './preview-quality.js';

describe('evaluateBuilderPreviewQuality', () => {
  it('passes when rendered preview satisfies required heading, CTA, colors, and motion', () => {
    const report = evaluateBuilderPreviewQuality({
      prompt: 'Build a neon fitness page with exact heading Kinetic Pulse, a CTA button labeled Start Training, hot pink #ff2ea6, deep navy #020617, and kinetic animation.',
      renderedText: 'Kinetic Pulse Start Training Elite training plans',
      sourceText: 'import { useState } from "react"; <h1 className="kinetic-heading">Kinetic Pulse</h1><button onClick={() => setStarted(true)}>Start Training</button>',
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

  it('flags placeholder copy and inert app surfaces', () => {
    const report = evaluateBuilderPreviewQuality({
      prompt: 'Build a task app for an operations team.',
      renderedText: 'Template App Card title Item 1 View',
      sourceText: '<main><h1>Template App</h1><button>View</button></main>',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.map((requirement) => requirement.label)).toEqual(expect.arrayContaining([
      'no template language',
      'stateful interaction',
    ]));
  });
});
