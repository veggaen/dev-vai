/**
 * Unit tests for the KnowledgeConfidenceLedger and dream() consolidation.
 *
 * These cover the two update signals (response and feedback), the offline
 * dream pass (decay / review / promotion), and serialization round-trip.
 */
import { describe, expect, it } from 'vitest';
import {
  KnowledgeConfidenceLedger,
  classifyFeedback,
} from '../src/learning/index.js';

describe('classifyFeedback', () => {
  it('detects positive feedback', () => {
    expect(classifyFeedback('yes')).toBe('positive');
    expect(classifyFeedback('thanks!')).toBe('positive');
    expect(classifyFeedback("that's right")).toBe('positive');
    expect(classifyFeedback('correct')).toBe('positive');
  });

  it('detects negative feedback', () => {
    expect(classifyFeedback('no')).toBe('negative');
    expect(classifyFeedback("that's wrong")).toBe('negative');
    expect(classifyFeedback('actually no, you got it backwards')).toBe('negative');
    expect(classifyFeedback("you're wrong")).toBe('negative');
  });

  it('returns neutral for unrelated input', () => {
    expect(classifyFeedback('what is docker?')).toBe('neutral');
    expect(classifyFeedback('')).toBe('neutral');
  });
});

describe('KnowledgeConfidenceLedger.recordResponse', () => {
  it('creates a new entry on first response', () => {
    const l = new KnowledgeConfidenceLedger();
    l.recordResponse('docker', 'general-knowledge', 0.85);
    const entry = l.get('docker');
    expect(entry).not.toBeNull();
    expect(entry!.responses).toBe(1);
    expect(entry!.confidence).toBeGreaterThan(0.5); // started at 0.5, blended toward 0.85
    expect(entry!.confidence).toBeLessThanOrEqual(1);
    expect(entry!.strategies.has('general-knowledge')).toBe(true);
  });

  it('blends multiple responses with EMA', () => {
    const l = new KnowledgeConfidenceLedger();
    l.recordResponse('react', 'taught-match', 0.9);
    const after1 = l.get('react')!.confidence;
    l.recordResponse('react', 'taught-match', 0.9);
    const after2 = l.get('react')!.confidence;
    expect(after2).toBeGreaterThan(after1);
  });

  it('clamps confidence to [0, 1]', () => {
    const l = new KnowledgeConfidenceLedger();
    l.recordResponse('x', 's', 5);
    expect(l.get('x')!.confidence).toBeLessThanOrEqual(1);
    l.recordResponse('y', 's', -2);
    expect(l.get('y')!.confidence).toBeGreaterThanOrEqual(0);
  });

  it('normalizes topic key (case + whitespace)', () => {
    const l = new KnowledgeConfidenceLedger();
    l.recordResponse('  Docker  ', 's', 0.7);
    expect(l.get('docker')).not.toBeNull();
    expect(l.get('DOCKER')).not.toBeNull();
  });

  it('ignores empty topic', () => {
    const l = new KnowledgeConfidenceLedger();
    l.recordResponse('', 's', 0.7);
    expect(l.size()).toBe(0);
  });
});

describe('KnowledgeConfidenceLedger.recordFeedback', () => {
  it('reinforces on positive feedback', () => {
    const l = new KnowledgeConfidenceLedger({ positiveReward: 0.2 });
    l.recordResponse('docker', 's', 0.6);
    const before = l.get('docker')!.confidence;
    const signal = l.recordFeedback('docker', 'thanks!');
    expect(signal).toBe('positive');
    expect(l.get('docker')!.confidence).toBeGreaterThan(before);
    expect(l.get('docker')!.positiveFeedback).toBe(1);
  });

  it('penalizes on negative feedback', () => {
    const l = new KnowledgeConfidenceLedger({ negativePenalty: 0.3 });
    l.recordResponse('docker', 's', 0.8);
    const before = l.get('docker')!.confidence;
    const signal = l.recordFeedback('docker', "no, that's wrong");
    expect(signal).toBe('negative');
    expect(l.get('docker')!.confidence).toBeLessThan(before);
    expect(l.get('docker')!.negativeFeedback).toBe(1);
  });

  it('returns neutral when topic is unknown', () => {
    const l = new KnowledgeConfidenceLedger();
    expect(l.recordFeedback('unknown-topic', 'no')).toBe('neutral');
  });
});

describe('KnowledgeConfidenceLedger.dream', () => {
  it('flags low-confidence topics for review', () => {
    const l = new KnowledgeConfidenceLedger({ reviewThreshold: 0.5 });
    l.recordResponse('shaky', 's', 0.2);
    l.recordResponse('solid', 's', 0.95);
    l.recordResponse('solid', 's', 0.95);
    l.recordResponse('solid', 's', 0.95);
    const r = l.dream();
    expect(r.scanned).toBe(2);
    expect(r.needsReview).toContain('shaky');
    expect(r.needsReview).not.toContain('solid');
  });

  it('reports promoted topics only once per crossing', () => {
    const l = new KnowledgeConfidenceLedger({ promoteThreshold: 0.7 });
    // Need several responses to push EMA above 0.7.
    for (let i = 0; i < 10; i += 1) l.recordResponse('rust', 's', 1);
    const r1 = l.dream();
    expect(r1.promoted).toContain('rust');
    const r2 = l.dream();
    expect(r2.promoted).not.toContain('rust');
  });

  it('decays stale topics', () => {
    const l = new KnowledgeConfidenceLedger({ staleAfterMs: 10, staleDecay: 0.5 });
    l.recordResponse('stale', 's', 0.9, 0);
    const before = l.get('stale')!.confidence;
    const report = l.dream(1000);
    expect(report.decayed).toContain('stale');
    expect(l.get('stale')!.confidence).toBeLessThan(before);
  });
});

describe('serialize / restore round-trip', () => {
  it('preserves topics and counts', () => {
    const a = new KnowledgeConfidenceLedger();
    a.recordResponse('docker', 'general-knowledge', 0.8);
    a.recordResponse('react', 'taught-match', 0.95);
    a.recordFeedback('docker', 'thanks');

    const snap = a.serialize();
    const b = new KnowledgeConfidenceLedger();
    b.restore(snap);

    expect(b.size()).toBe(2);
    expect(b.get('docker')!.positiveFeedback).toBe(1);
    expect(b.get('react')!.confidence).toBeCloseTo(a.get('react')!.confidence, 5);
  });
});

describe('clear', () => {
  it('wipes everything', () => {
    const l = new KnowledgeConfidenceLedger();
    l.recordResponse('x', 's', 0.5);
    l.clear();
    expect(l.size()).toBe(0);
    expect(l.get('x')).toBeNull();
  });
});
