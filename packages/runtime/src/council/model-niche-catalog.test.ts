import { describe, it, expect } from 'vitest';
import { nicheTopicForModel, isNicheSpecialist } from './model-niche-catalog.js';

/**
 * model-niche-catalog — a niche model must seat on its STRENGTH, not a positional guess.
 * These pin the mapping so a freshly-pulled specialist lands in the right council seat.
 */

describe('nicheTopicForModel', () => {
  it('seats DeepSeek-R1 on reasoning', () => {
    expect(nicheTopicForModel('local:deepseek-r1:8b')?.topic).toBe('reasoning');
    expect(nicheTopicForModel('local:deepseek-r1-distill-qwen:7b')?.topic).toBe('reasoning');
  });

  it('seats coder models on code', () => {
    expect(nicheTopicForModel('local:qwen2.5-coder:14b')?.topic).toBe('code');
    expect(nicheTopicForModel('local:codestral:22b')?.topic).toBe('code');
    expect(nicheTopicForModel('local:codellama:13b')?.topic).toBe('code');
  });

  it('seats Mistral-small on reasoning', () => {
    expect(nicheTopicForModel('local:mistral-small:24b')?.topic).toBe('reasoning');
    expect(nicheTopicForModel('local:mixtral:8x7b')?.topic).toBe('reasoning');
  });

  it('seats vision models on factual', () => {
    expect(nicheTopicForModel('local:llava:13b')?.topic).toBe('factual');
    expect(nicheTopicForModel('local:moondream:latest')?.topic).toBe('factual');
  });

  it('seats Gemma on factual', () => {
    expect(nicheTopicForModel('local:gemma2:9b')?.topic).toBe('factual');
  });

  it('returns null for a generalist (no known niche) so the caller falls back positionally', () => {
    expect(nicheTopicForModel('local:qwen3:8b')).toBeNull();
    expect(nicheTopicForModel('local:qwen2.5:7b')).toBeNull();
    expect(nicheTopicForModel('local:llama3.1:8b')).toBeNull();
  });

  it('is case-insensitive and tolerant of empty input', () => {
    expect(nicheTopicForModel('LOCAL:DeepSeek-R1:8B')?.topic).toBe('reasoning');
    expect(nicheTopicForModel('')).toBeNull();
  });
});

describe('isNicheSpecialist', () => {
  it('flags specialists vs generalists', () => {
    expect(isNicheSpecialist('local:deepseek-r1:8b')).toBe(true);
    expect(isNicheSpecialist('local:qwen3:8b')).toBe(false);
  });
});
