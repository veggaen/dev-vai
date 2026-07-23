import { describe, expect, it } from 'vitest';
import { tryReliableJobDesign } from './reliable-job-design.js';

describe('tryReliableJobDesign', () => {
  it.each([
    'Design the smallest reliable background-job system for a desktop AI app. Jobs must survive restarts, avoid duplicate side effects, expose progress, and stop overload. Give the architecture, failure handling, metrics, and rollout.',
    'Architect the smallest reliable document-indexing worker. Index jobs must persist across restarts, avoid duplicate embeddings, report progress, and resist overload. Cover failures, metrics, and a safe rollout.',
    'Design a minimal reliable email-delivery job runner: durable after process crashes, no duplicate sends, visible progress, bounded overload, failure recovery, metrics, and staged rollout.',
  ])('composes the same reliability invariants for different workloads', (prompt) => {
    const result = tryReliableJobDesign(prompt);
    expect(result?.reply).toMatch(/persist|durable/i);
    expect(result?.reply).toMatch(/idempoten/i);
    expect(result?.reply).toMatch(/checkpoint/i);
    expect(result?.reply).toMatch(/backpressure/i);
    expect(result?.reply).toMatch(/retry/i);
    expect(result?.reply).toMatch(/queue depth and age/i);
    expect(result?.reply).toMatch(/kill switch/i);
    expect(result?.matchedInvariants.length).toBeGreaterThanOrEqual(6);
  });

  it('does not steal a vague app build request', () => {
    expect(tryReliableJobDesign('Build me a queue dashboard app.')).toBeNull();
  });
});

