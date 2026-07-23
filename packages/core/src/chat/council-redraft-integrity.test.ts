import { describe, expect, it } from 'vitest';
import { evaluateCouncilRedraftIntegrity } from './council-redraft-integrity.js';

const SELF_ASSESSMENT_PROMPT = 'Vai, act as the institution responsible for your own improvement. Based only on what you can actually inspect or remember, name the single most important engineering bottleneck preventing you from becoming more capable without depending on third-party models. Separate evidence from inference, and propose one acceptance test.';

const RELEVANT_ORIGINAL = JSON.stringify({
  bottleneck: 'Contextual understanding and relevance in responses',
  acceptance_test: 'Given a contextual follow-up, retain the active engineering topic and reject unrelated general-knowledge snippets.',
}, null, 2);

describe('evaluateCouncilRedraftIntegrity', () => {
  it('rejects the live Council regression that replaced Vai self-assessment with Lima', () => {
    const report = evaluateCouncilRedraftIntegrity({
      prompt: SELF_ASSESSMENT_PROMPT,
      originalDraft: RELEVANT_ORIGINAL,
      candidateDraft: 'The capital of Peru is **Lima**.',
    });

    expect(report.accepted).toBe(false);
    expect(report.reason).toMatch(/prompt-focus|quality-regression/);
    expect(report.candidateQuality.score).toBeLessThan(report.originalQuality.score);
  });

  it('accepts a revision that strengthens the same answer contract', () => {
    const report = evaluateCouncilRedraftIntegrity({
      prompt: SELF_ASSESSMENT_PROMPT,
      originalDraft: RELEVANT_ORIGINAL,
      candidateDraft: [
        '**Bottleneck:** context integrity in Vai\'s Council redraft path.',
        '**Evidence:** a revised answer can lose the engineering subject even when the original draft retained it.',
        '**Inference:** Vai needs a deterministic release gate rather than trusting a model score alone.',
        '**Acceptance test:** replay the self-assessment prompt against `packages/core/src/chat/service.ts` and reject any candidate that drops the Vai, engineering, evidence, or acceptance-test contract.',
      ].join('\n'),
    });

    expect(report.accepted).toBe(true);
    expect(report.reason).toBe('preserved');
  });

  it('rejects a revision that drops a previously covered build deliverable', () => {
    const prompt = 'Explain JWT authentication and then build a photographer portfolio app.';
    const explanation = 'JWT authentication uses a signed header, payload, and signature.';
    const build = '```tsx title="src/App.tsx"\nexport default function App(){ return <main>Photographer portfolio</main>; }\n```';
    const report = evaluateCouncilRedraftIntegrity({
      prompt,
      originalDraft: `${explanation}\n\n${build}`,
      candidateDraft: explanation,
    });

    expect(report.accepted).toBe(false);
    expect(report.reason).toBe('dropped-deliverable');
  });
});
