import { describe, it, expect } from 'vitest';
import { execCapability, isExecQuery } from './exec-capability.js';
import type { TurnContext } from '../turn-pipeline.js';
import type { RunEvidence } from '../../tools/run-evidence.js';

function ctx(text: string, run?: RunEvidence): TurnContext {
  return {
    content: text,
    understood: text,
    history: [],
    classification: {
      kind: 'standalone-question',
      confidence: 1,
      signals: [],
      referencesPriorTurn: false,
      isShortAnaphoric: false,
      wordCount: text.split(/\s+/).length,
    },
    intent: 'action-yesno',
    guidance: [],
    evidence: run ? { run } : undefined,
  };
}

function run(partial: Partial<RunEvidence> = {}): RunEvidence {
  return {
    ok: true,
    id: 'run:vitest:1718000000000',
    command: 'vitest',
    args: ['run'],
    exitCode: 0,
    passed: true,
    stdout: 'Tests 12 passed',
    stderr: '',
    durationMs: 1500,
    timedOut: false,
    truncated: false,
    ranAt: '2026-06-14T00:00:00Z',
    ...partial,
  };
}

describe('isExecQuery', () => {
  it('detects run/verify phrasing', () => {
    expect(isExecQuery('run the tests')).toBe(true);
    expect(isExecQuery('does it build?')).toBe(true);
    expect(isExecQuery('did the tests pass?')).toBe(true);
    expect(isExecQuery('is the build green?')).toBe(true);
  });
  it('ignores unrelated turns', () => {
    expect(isExecQuery('what is the capital of France?')).toBe(false);
    expect(isExecQuery('write a poem')).toBe(false);
  });
});

describe('execCapability.estimate', () => {
  it('is inapplicable for non-exec turns', () => {
    expect(execCapability.estimate(ctx('tell me a joke'))).toBeNull();
  });
  it('scores higher with attached run evidence', () => {
    const withEv = execCapability.estimate(ctx('run the tests', run()))!;
    const without = execCapability.estimate(ctx('run the tests'))!;
    expect(withEv.evidence).toBeGreaterThan(without.evidence);
  });
});

describe('execCapability.resolve', () => {
  it('composes a grounded answer for a passing run', () => {
    const r = execCapability.resolve(ctx('did the tests pass?', run()))!;
    expect(r.text).toContain('Run evidence');
    expect(r.text).toMatch(/passed \(exit code 0\)/);
  });
  it('reports a failing run with the exit code and stderr tail', () => {
    const r = execCapability.resolve(ctx('run the tests', run({ exitCode: 1, passed: false, stderr: 'AssertionError: 1 failed' })))!;
    expect(r.text).toMatch(/failed \(exit code 1\)/);
    expect(r.text).toContain('AssertionError');
  });
  it('honestly declines when no run is attached', () => {
    const r = execCapability.resolve(ctx('run the tests'))!;
    expect(r.text).toContain('no command was run');
  });
});

describe('execCapability.verify — bind pass/fail to the REAL exit code', () => {
  it('passes a grounded "passed" answer when exit code is 0', () => {
    const c = ctx('did the tests pass?', run());
    const r = execCapability.resolve(c)!;
    const v = execCapability.verify(r, c);
    expect(v.ok).toBe(true);
    expect(v.boundEvidence).toContain('run:vitest:1718000000000');
  });

  it('REFUSES a "passed" claim when the real exit code is non-zero (the core guard)', () => {
    const failing = run({ exitCode: 1, passed: false });
    const c = ctx('did the tests pass?', failing);
    // Fabricate a green answer over a red run.
    const tampered = { text: '**Run evidence (`vitest run`, 1ms):**\n\n- **Outcome:** passed (exit code 0)', confidence: 0.9 } as never;
    const v = execCapability.verify(tampered, c);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/claims the run passed/i);
  });

  it('REFUSES a "failed" claim when the run actually passed', () => {
    const c = ctx('run the tests', run());
    const tampered = { text: '**Run evidence (`vitest run`, 1ms):**\n\n- **Outcome:** failed (exit code 1)', confidence: 0.9 } as never;
    const v = execCapability.verify(tampered, c);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/claims the run failed/i);
  });

  it('REFUSES a timeout claim when the run completed', () => {
    const c = ctx('run the tests', run());
    const tampered = { text: '**Run evidence (`vitest run`, 1ms):**\n\n- **Outcome:** timed out', confidence: 0.9 } as never;
    const v = execCapability.verify(tampered, c);
    expect(v.ok).toBe(false);
  });

  it('binds a timed-out outcome to real evidence', () => {
    const c = ctx('run the tests', run({ exitCode: null, passed: false, timedOut: true }));
    const r = execCapability.resolve(c)!;
    const v = execCapability.verify(r, c);
    expect(v.ok).toBe(true);
  });

  it('always releases the honest no-run decline', () => {
    const c = ctx('run the tests');
    const r = execCapability.resolve(c)!;
    expect(execCapability.verify(r, c).ok).toBe(true);
  });

  it('refuses run-authoritative text with no evidence header', () => {
    const c = ctx('run the tests', run());
    const v = execCapability.verify({ text: 'Yep, all green, trust me.', confidence: 0.9 } as never, c);
    expect(v.ok).toBe(false);
  });
});
