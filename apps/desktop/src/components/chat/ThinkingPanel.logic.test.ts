import { describe, expect, it } from 'vitest';
import { buildThinkingPanelModel } from './ThinkingPanel.logic.js';
import type { TurnThinkingUI } from '../../stores/chatStore.js';

const base: TurnThinkingUI = {
  intent: 'definition',
  strategy: 'research-cited',
  strategyChain: ['research-cited'],
  trustBadge: 'official-docs',
  confidence: 0.82,
  topic: 'docker',
  knowledgeDepth: 'deep',
  durationMs: 140,
};

describe('buildThinkingPanelModel', () => {
  it('humanizes intent, strategy chain, trust, and confidence', () => {
    const m = buildThinkingPanelModel(base);
    expect(m.intentLabel).toBe('Definition');
    expect(m.steps.map((s) => s.label)).toEqual(['Research Cited']);
    expect(m.trustLabel).toBe('Official docs');
    expect(m.confidencePct).toBe(82);
    expect(m.headerLabel).toBe('Definition · 1 step · 82%');
  });

  it('splits a teacher-loop chain into steps', () => {
    const m = buildThinkingPanelModel({ ...base, strategy: 'yesno->teacher->refine', strategyChain: [] });
    expect(m.steps.map((s) => s.label)).toEqual(['Yesno', 'Teacher', 'Refine']);
    expect(m.headerLabel).toContain('3 steps');
  });

  it('does NOT flag a misroute when intent and strategy agree', () => {
    const m = buildThinkingPanelModel(base);
    expect(m.misrouteSuspected).toBe(false);
    expect(m.defaultExpanded).toBe(false);
  });

  it('flags + auto-expands an action yes/no answered by a definition handler', () => {
    const m = buildThinkingPanelModel({ ...base, intent: 'action-yesno', strategy: 'fact-brand' });
    expect(m.misrouteSuspected).toBe(true);
    expect(m.misrouteHint).toMatch(/yes\/no.*definition/i);
    expect(m.defaultExpanded).toBe(true);
  });

  it('flags a factual question routed to the builder', () => {
    const m = buildThinkingPanelModel({ ...base, intent: 'factual-lookup', strategy: 'creative-code' });
    expect(m.misrouteSuspected).toBe(true);
    expect(m.misrouteHint).toMatch(/builder/i);
  });
});
