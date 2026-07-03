import { describe, expect, it } from 'vitest';
import { buildTimelineModel, phaseForStage, titleForStage } from './Timeline.logic.js';
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

  it('maps every builder-council factory stage to a distinct phase', () => {
    expect(phaseForStage('council-architect')).toBe('deliberate');
    expect(phaseForStage('council-code')).toBe('compose');
    expect(phaseForStage('council-validate')).toBe('gate');
    expect(phaseForStage('council-review')).toBe('deliberate');
    expect(phaseForStage('council-repair')).toBe('redraft');
    expect(phaseForStage('council-style')).toBe('compose');
    expect(phaseForStage('council-assemble')).toBe('build');
    expect(phaseForStage('council-error')).toBe('gate');
    expect(phaseForStage('multi-intent')).toBe('understand');
    expect(phaseForStage('escalate')).toBe('gather');
  });
});

describe('titleForStage', () => {
  it('names the builder-council processes specifically', () => {
    expect(titleForStage('council-architect', 'deliberate')).toBe('Architect plans the app');
    expect(titleForStage('council-code', 'compose')).toBe('Coder writes the app');
    expect(titleForStage('council-validate', 'gate')).toBe('Compile gate');
    expect(titleForStage('council-style', 'compose')).toBe('Stylist paints the UI');
  });

  it('falls back to the generic phase title for ordinary stages', () => {
    expect(titleForStage('understand', 'understand')).toBe('Read the intent');
    expect(titleForStage('council-vai-round-1', 'deliberate')).toBe('Council deliberates');
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
      { stage: 'vai-dra