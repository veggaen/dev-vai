import { describe, expect, it } from 'vitest';
import {
  decideCodePolicy,
  detectOverEngineering,
  looksLikeCodeRequest,
  renderQualityBrief,
} from './code-quality-policy.js';

describe('decideCodePolicy', () => {
  it('defaults to standard when no complexity is specified', () => {
    const policy = decideCodePolicy('Build me a todo app in React');
    expect(policy.tier).toBe('standard');
    expect(policy.tierIsExplicit).toBe(false);
  });

  it('pins minimal when the user asks for simple', () => {
    const policy = decideCodePolicy('Give me a minimal hello world snippet');
    expect(policy.tier).toBe('minimal');
    expect(policy.tierIsExplicit).toBe(true);
  });

  it('pins advanced for production language', () => {
    const policy = decideCodePolicy('Build a production-ready API with observability');
    expect(policy.tier).toBe('advanced');
    expect(policy.tierIsExplicit).toBe(true);
  });

  it('defaults to standard when signals conflict', () => {
    const policy = decideCodePolicy('Build a simple production-ready todo app');
    expect(policy.tier).toBe('standard');
    expect(policy.tierIsExplicit).toBe(false);
  });
});

describe('detectOverEngineering', () => {
  it('flags heavy infra on trivial domains', () => {
    const note = detectOverEngineering(
      'Build a todo list with microservices and kubernetes',
      'standard',
    );
    expect(note).toMatch(/doesn't need that infrastructure/i);
  });

  it('ignores heavy infra on non-trivial domains', () => {
    expect(
      detectOverEngineering('Build a payments platform with kafka and k8s', 'advanced'),
    ).toBeUndefined();
  });
});

describe('renderQualityBrief', () => {
  it('includes tier contract lines', () => {
    const brief = renderQualityBrief(decideCodePolicy('Build a dashboard'));
    expect(brief).toMatch(/Quality bar \(standard\)/);
    expect(brief).toMatch(/Must satisfy:/);
    expect(brief).toMatch(/Deliberately avoid:/);
  });
});

describe('looksLikeCodeRequest', () => {
  it('matches build-ish prompts', () => {
    expect(looksLikeCodeRequest('Scaffold a Next.js app')).toBe(true);
    expect(looksLikeCodeRequest('What is the capital of France?')).toBe(false);
  });
});
