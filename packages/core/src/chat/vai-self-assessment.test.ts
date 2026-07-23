import { describe, expect, it } from 'vitest';
import type { Message } from '../models/adapter.js';
import {
  isVaiSelfAssessmentRequest,
  tryEmitVaiSelfAssessment,
} from './vai-self-assessment.js';

const PROMPT = 'Vai, act as the institution responsible for your own improvement. Based only on what you can actually inspect or remember, name the single most important engineering bottleneck preventing you from becoming more capable without depending on third-party models. Separate evidence from inference, and propose one acceptance test.';

describe('Vai-owned self-assessment', () => {
  it('recognizes the live engineering self-assessment request', () => {
    expect(isVaiSelfAssessmentRequest(PROMPT)).toBe(true);
  });

  it('answers with bounded evidence, inference, and a measurable zero-model acceptance test', () => {
    const history: Message[] = [{ role: 'user', content: PROMPT }];
    const result = tryEmitVaiSelfAssessment({ content: PROMPT, history });

    expect(result?.kind).toBe('operational-introspection-gap');
    expect(result?.reply).toContain('**Evidence**');
    expect(result?.reply).toContain('**Inference**');
    expect(result?.reply).toContain('**Acceptance test**');
    expect(result?.reply).toMatch(/no attached repository, test, runtime-health, or improvement-queue evidence/i);
    expect(result?.reply).toMatch(/zero Council\/response-model calls/i);
    expect(result?.reply).not.toMatch(/capital of Peru|Lima/i);
  });

  it('does not hijack ordinary factual or generic improvement questions', () => {
    expect(isVaiSelfAssessmentRequest('What is the capital of Peru?')).toBe(false);
    expect(isVaiSelfAssessmentRequest('Can you improve this React component?')).toBe(false);
    expect(tryEmitVaiSelfAssessment({
      content: 'What can Vai do?',
      history: [{ role: 'user', content: 'What can Vai do?' }],
    })).toBeNull();
  });

  it('uses an attached operational packet to rank adoption over more proposal generation', () => {
    const result = tryEmitVaiSelfAssessment({
      content: PROMPT,
      history: [{ role: 'user', content: PROMPT }],
      operationalEvidence: {
        schemaVersion: 1,
        capturedAt: '2026-07-19T07:54:13.000Z',
        runtime: { sourceId: 'runtime:process', healthy: true, engine: 'vai:v0' },
        build: {
          sourceId: 'build:source-git', available: true, runtimeKind: 'source',
          commit: 'a'.repeat(40), branch: 'cap/synthesis-page', version: '0.2.0',
          builtAt: null, dirty: true,
        },
        repository: {
          sourceId: 'git:source-status', available: true, branch: 'cap/synthesis-page',
          changedFiles: 103, modifiedFiles: 82, untrackedFiles: 21,
        },
        verification: {
          sourceId: 'verification:source-receipt', available: true, status: 'pass',
          capturedAt: '2026-07-19T07:54:13.000Z', totalTestsPassed: 1179,
          typechecks: ['@vai/core', '@vai/runtime'], stale: false,
        },
        selfImprovement: {
          sourceId: 'self-improve:source-corpus', available: true, queuedFixes: 302,
          qualified: 86, adopted: 0, pendingNominations: 2, integratedNominations: 1,
          latestRunStatus: 'aborted-runtime-down', latestRunAt: '2026-07-02T05:46:56.677Z',
        },
      },
    });

    expect(result?.kind).toBe('verified-adoption-gap');
    expect(result?.reply).toMatch(/verified improvement adoption/i);
    expect(result?.reply).toContain('[git:source-status]');
    expect(result?.reply).toContain('86 qualified proposals; 0 adopted');
    expect(result?.reply).toContain('1 integrated nomination;');
    expect(result?.reply).toMatch(/Proposal generation alone is a failure/i);
  });
});
