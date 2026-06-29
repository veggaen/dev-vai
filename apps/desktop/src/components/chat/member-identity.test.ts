import { describe, it, expect } from 'vitest';
import { Brain, Code2, Scale, Search } from 'lucide-react';
import { memberIdentity } from './member-identity.js';

describe('memberIdentity', () => {
  it('cleans the model name (drops local: / Local prefixes)', () => {
    expect(memberIdentity('local:qwen3:8b').label).toBe('qwen3:8b');
    expect(memberIdentity('Local deepseek-r1:8b').label).toBe('deepseek-r1:8b');
  });

  it('lets the assigned topic/role seat win over model family', () => {
    const i = memberIdentity('qwen2.5:7b', 'reasoning');
    expect(i.role).toBe('reasoning');
    expect(i.Icon).toBe(Brain);
    expect(i.accentVar).toBe('var(--phase-route)');
  });

  it('maps code / evidence / review seats to distinct glyphs + tokens', () => {
    expect(memberIdentity('qwen3:8b', 'code').Icon).toBe(Code2);
    expect(memberIdentity('qwen3:8b', 'factual').Icon).toBe(Search);
    expect(memberIdentity('qwen3:8b', 'review').Icon).toBe(Scale);
  });

  it('falls back to model family when no seat is named', () => {
    expect(memberIdentity('deepseek-r1:8b').role).toBe('reasoning');
    expect(memberIdentity('qwen3:8b').role).toBe('generalist');
    expect(memberIdentity('grok-2').roleChip).toBe('wide context');
  });

  it('always returns a usable identity for unknown models (never empty/crash)', () => {
    const i = memberIdentity('some-new-model:32b');
    expect(i.label).toBe('some-new-model:32b');
    expect(i.role).toBeTruthy();
    expect(i.accentVar).toMatch(/^var\(--/);
  });

  it('only ever uses CSS-variable tokens for accent (no hardcoded colors)', () => {
    for (const seat of ['reasoning', 'code', 'factual', 'review', undefined]) {
      expect(memberIdentity('qwen3:8b', seat).accentVar).toMatch(/^var\(--[a-z-]+\)$/);
    }
  });
});
