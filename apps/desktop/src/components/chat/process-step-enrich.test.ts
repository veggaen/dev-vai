import { describe, expect, it } from 'vitest';
import { deriveLiveCouncilFromProgressSteps, enrichProgressStepsWithCouncil } from './process-step-enrich.js';

describe('deriveLiveCouncilFromProgressSteps', () => {
  it('returns in-progress council while streaming before thinking.council exists', () => {
    const live = deriveLiveCouncilFromProgressSteps([{
      stage: 'council-vai-round-1',
      label: 'Council reviewing Vai\'s proposal',
      status: 'running',
    }], true);
    expect(live?.topic).toBe('review in progress');
    expect(live?.summary).toContain('Council reviewing');
  });

  it('maps council members from progress steps during streaming', () => {
    const live = deriveLiveCouncilFromProgressSteps([{
      stage: 'council-vai-round-1',
      label: 'Council asked Vai to revise',
      status: 'running',
      councilMembers: [{
        name: 'Qwen',
        topic: 'factual',
        verdict: 'needs-work',
        confidence: 0.4,
        note: 'Needs official source',
      }],
    }], true);
    expect(live?.members).toHaveLength(1);
    expect(live?.members[0]?.note).toContain('official source');
  });
});

describe('enrichProgressStepsWithCouncil', () => {
  it('attaches council members and consensus to the council step from thinking', () => {
    const steps = [{
      stage: 'council-vai-round-1',
      label: 'Council asked Vai to revise',
      status: 'done' as const,
    }];
    const enriched = enrichProgressStepsWithCouncil(steps, {
      outcome: 'act',
      agreement: 0.8,
      confidence: 0.7,
      topic: 'code',
      summary: 'Needs a concrete example',
      realIntent: 'wants runnable code',
      recommendedAction: 'reread-intent',
      missingCapabilities: ['concrete code sample'],
      methodLessons: ['lead with an example'],
      members: [{
        name: 'Qwen Code',
        topic: 'code',
        verdict: 'needs-work' as const,
        confidence: 0.82,
        action: 'reread-intent',
        note: 'Missing runnable example',
      }],
    });
    expect(enriched[0]?.councilMembers).toHaveLength(1);
    expect(enriched[0]?.processLog?.[0]?.body).toContain('Needs a concrete example');
  });
});
