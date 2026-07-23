import { describe, expect, it } from 'vitest';
import { buildTimelineModel, phaseForStage } from './Timeline.logic.js';
import type { ChatProgressStep } from '../../stores/chatStore.js';

describe('phaseForStage', () => {
  it('maps real backend stages onto the diagram phases', () => {
    expect(phaseForStage('understand')).toBe('understand');
    expect(phaseForStage('search')).toBe('gather');
    expect(phaseForStage('council-vai-round-1')).toBe('deliberate');
    expect(phaseForStage('vai-draft')).toBe('compose');
    expect(phaseForStage('vai-redraft')).toBe('redraft');
    expect(phaseForStage('quality-check')).toBe('gate');
    expect(phaseForStage('build-apply')).toBe('build');
  });
});

describe('buildTimelineModel', () => {
  const councilStep = (stage: string, good: number, total: number): ChatProgressStep => ({
    stage,
    label: 'Council reviewed',
    status: 'done',
    councilMembers: Array.from({ length: total }, (_, i) => ({
      memberId: `m${i}`,
      name: `Member ${i}`,
      topic: 'reasoning',
      verdict: i < good ? 'good' : 'needs-work',
      confidence: 0.8,
      missingCapability: i === 0 ? 'live web read' : '',
      methodLesson: i === 0 ? 'verify with a fresh fetch' : '',
      concerns: i === 0 ? ['unsourced number'] : [],
    })),
  });

  it('derives an approved gate when a majority of members vote good', () => {
    const steps: ChatProgressStep[] = [
      { stage: 'vai-draft', label: 'Vai proposed', status: 'done' },
      councilStep('council-vai-round-1', 3, 4),
    ];
    const model = buildTimelineModel(steps);
    expect(model.approved).toBe(true);
    const gatePhase = model.phases.find((p) => p.gate?.kind === 'council');
    expect(gatePhase?.gate?.approved).toBe(true);
    expect(gatePhase?.gate?.reason).toContain('3/4');
  });

  it('marks best-so-far when the final gate did not approve', () => {
    const steps: ChatProgressStep[] = [
      { stage: 'vai-draft', label: 'Vai proposed', status: 'done' },
      councilStep('council-vai-round-1', 1, 4),
    ];
    const model = buildTimelineModel(steps);
    expect(model.approved).toBe(false);
  });

  it('counts loop rounds from council/redraft stage suffixes', () => {
    const steps: ChatProgressStep[] = [
      { stage: 'vai-draft', label: 'Vai proposed', status: 'done' },
      councilStep('council-vai-round-1', 1, 4),
      { stage: 'vai-redraft', label: 'Vai revised', status: 'done' },
      councilStep('council-vai-round-2', 3, 4),
    ];
    const model = buildTimelineModel(steps);
    expect(model.rounds).toBe(2);
  });

  it('lifts feature-notes (missing capability, lesson, concern) into the self-improvement lane', () => {
    const steps: ChatProgressStep[] = [councilStep('council-vai-round-1', 2, 4)];
    const model = buildTimelineModel(steps);
    const kinds = model.featureNotes.map((n) => n.kind);
    expect(kinds).toContain('missing-capability');
    expect(kinds).toContain('method-lesson');
    expect(kinds).toContain('concern');
    expect(model.featureNotes.find((n) => n.kind === 'missing-capability')?.text).toBe('live web read');
  });

  it('returns an empty model for no steps (no crash)', () => {
    const model = buildTimelineModel([]);
    expect(model.phases).toEqual([]);
    expect(model.approved).toBe(true);
    expect(model.rounds).toBe(1);
  });

  it('uses structured outcomes instead of optimistic detail-text inference', () => {
    const model = buildTimelineModel([{
      stage: 'verify',
      label: 'Verification finished',
      detail: 'Everything looked normal before the connection ended.',
      status: 'done',
      outcome: 'interrupted',
    }]);

    expect(model.approved).toBe(false);
    expect(model.phases[0]?.status).toBe('bad');
    expect(model.phases[0]?.gate?.approved).toBe(false);
  });
});


describe('phaseForStage honesty (self-improve job #1)', () => {
  it('pure reasoning is never labeled evidence gathering', () => {
    expect(phaseForStage('reason')).toBe('understand');
    expect(phaseForStage('search')).toBe('gather');
    expect(phaseForStage('escalate')).toBe('deliberate');
  });
});
