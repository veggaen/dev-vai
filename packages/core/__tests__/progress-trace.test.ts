import { describe, it, expect } from 'vitest';
import {
  accumulateProgressStep,
  serializeProgressTrace,
  deserializeProgressTrace,
  resolveProgressTraceOwner,
  TRACE_BLOB_MAX,
  type ChatProgressStep,
} from '../src/chat/progress-trace.js';

const step = (over: Partial<ChatProgressStep> = {}): ChatProgressStep => ({
  stage: 'council-vai-round-1',
  label: 'Council reviewed the draft',
  status: 'done',
  ...over,
});

describe('accumulateProgressStep', () => {
  it('appends new stages without fabricating success for earlier running work', () => {
    let trace: ChatProgressStep[] = [];
    trace = accumulateProgressStep(trace, step({ stage: 'search', label: 'Searched', status: 'running' }));
    trace = accumulateProgressStep(trace, step({ stage: 'vai-draft', label: 'Proposed', status: 'running' }));
    expect(trace).toHaveLength(2);
    expect(trace[0].status).toBe('running');
    expect(trace[1].status).toBe('running');
  });

  it('merges a re-emitted stage, preserving late-arriving council members', () => {
    let trace: ChatProgressStep[] = [];
    trace = accumulateProgressStep(trace, step({ stage: 'council', status: 'running' }));
    trace = accumulateProgressStep(trace, step({
      stage: 'council',
      status: 'done',
      councilMembers: [{ name: 'DeepSeek', verdict: 'good', confidence: 0.8 }],
    }));
    expect(trace).toHaveLength(1);
    expect(trace[0].status).toBe('done');
    expect(trace[0].councilMembers).toHaveLength(1);
  });

  it('does not drop existing nested payloads when a later emit lacks them', () => {
    let trace: ChatProgressStep[] = [];
    trace = accumulateProgressStep(trace, step({
      stage: 'council',
      councilMembers: [{ name: 'Qwen', verdict: 'good', confidence: 0.9 }],
    }));
    trace = accumulateProgressStep(trace, step({ stage: 'council', detail: 'final' }));
    expect(trace[0].councilMembers).toHaveLength(1); // preserved
    expect(trace[0].detail).toBe('final');
  });

  it('preserves repeated observable actions that reuse a generic stage', () => {
    let trace: ChatProgressStep[] = [];
    trace = accumulateProgressStep(trace, step({ stage: 'council-review', label: 'Reviewing edit', status: 'done' }));
    trace = accumulateProgressStep(trace, step({ stage: 'council-review', label: 'Re-reviewing repair', status: 'running' }));
    expect(trace.map((entry) => entry.label)).toEqual(['Reviewing edit', 'Re-reviewing repair']);
  });

  it('does not let a stale running frame overwrite a terminal outcome', () => {
    const trace = accumulateProgressStep([
      step({
        stage: 'verify',
        label: 'Verification failed',
        status: 'done',
        outcome: 'failed',
        evidenceId: 'proof:verify',
      }),
    ], step({ stage: 'verify', label: 'Still checking', status: 'running' }));

    expect(trace[0]).toMatchObject({
      status: 'done',
      outcome: 'failed',
      evidenceId: 'proof:verify',
    });
  });
});

describe('resolveProgressTraceOwner', () => {
  it('owns the one new row whose content exactly matches the streamed answer', () => {
    expect(resolveProgressTraceOwner([
      { id: 'other-turn', content: 'different answer' },
      { id: 'this-turn', content: 'streamed answer' },
    ], 'streamed answer')).toEqual({ kind: 'update', id: 'this-turn' });
  });

  it('inserts a durable row when cancellation happened before the normal insert', () => {
    expect(resolveProgressTraceOwner([], 'partial answer')).toEqual({ kind: 'insert' });
  });

  it('inserts rather than mutating a concurrent non-matching answer', () => {
    expect(resolveProgressTraceOwner([
      { id: 'concurrent-turn', content: 'someone else finished' },
    ], 'my partial answer')).toEqual({ kind: 'insert' });
  });

  it('refuses to guess between duplicate matching concurrent rows', () => {
    expect(resolveProgressTraceOwner([
      { id: 'a', content: 'same' },
      { id: 'b', content: 'same' },
    ], 'same')).toEqual({ kind: 'ambiguous' });
  });
});

describe('serialize/deserialize round-trip', () => {
  it('round-trips structure so the tree can re-expand', () => {
    const trace = [
      step({ stage: 'search', label: 'Searched', detail: 'btc price', processLog: [{ kind: 'read', label: 'read coindesk' }] }),
      step({
        stage: 'council',
        councilMembers: [{ name: 'DeepSeek', verdict: 'needs-work', confidence: 0.6, note: 'tighten the claim' }],
      }),
    ];
    const blob = serializeProgressTrace(trace);
    expect(blob).toBeTypeOf('string');
    const back = deserializeProgressTrace(blob);
    expect(back).toHaveLength(3);
    expect(back![0].processLog?.[0].label).toBe('read coindesk');
    expect(back![1].councilMembers?.[0].note).toBe('tighten the claim');
    expect(back![2]).toMatchObject({
      stage: 'turn-terminal',
      outcome: 'succeeded',
      evidenceId: 'progress:terminal:turn',
    });
  });

  it('marks unfinished steps and tools interrupted when no terminal event was observed', () => {
    const blob = serializeProgressTrace([
      step({ stage: 'x', status: 'running', toolRuns: [{ id: 't1', name: 'grep', status: 'running' }] }),
    ], 'interrupted');
    const back = deserializeProgressTrace(blob)!;
    expect(back[0]).toMatchObject({
      status: 'done',
      outcome: 'interrupted',
      evidenceId: 'progress:1:x',
    });
    expect(back[0].toolRuns?.[0]).toMatchObject({
      status: 'done',
      outcome: 'interrupted',
      evidenceId: 'progress:1:x:tool:t1',
    });
    expect(back.at(-1)).toMatchObject({ stage: 'turn-terminal', outcome: 'interrupted' });
  });

  it('marks unfinished work failed when the terminal event is an error', () => {
    const back = deserializeProgressTrace(serializeProgressTrace([
      step({
        stage: 'verify',
        status: 'running',
        toolRuns: [{ id: 't1', name: 'typecheck', status: 'running' }],
      }),
    ], 'failed'))!;

    expect(back[0].outcome).toBe('failed');
    expect(back[0].toolRuns?.[0]).toMatchObject({ status: 'failed', outcome: 'failed' });
    expect(back.at(-1)).toMatchObject({
      label: 'Turn failed',
      outcome: 'failed',
    });
  });

  it('does not duplicate an existing terminal marker on reserialization', () => {
    const once = deserializeProgressTrace(serializeProgressTrace([step()], 'succeeded'))!;
    const twice = deserializeProgressTrace(serializeProgressTrace(once, 'succeeded'))!;
    expect(twice.filter((entry) => entry.stage === 'turn-terminal')).toHaveLength(1);
  });

  it('clamps long free-text fields', () => {
    const huge = 'x'.repeat(5000);
    const back = deserializeProgressTrace(serializeProgressTrace([
      step({ councilMembers: [{ name: 'M', verdict: 'good', confidence: 1, note: huge }] }),
    ]))!;
    expect(back[0].councilMembers![0].note!.length).toBeLessThan(1300);
  });

  it('keeps the blob under the size cap by dropping trailing steps', () => {
    const fat = Array.from({ length: 40 }, (_, i) =>
      step({ stage: `s${i}`, label: `step ${i}`, detail: 'y'.repeat(1000), processLog: [{ kind: 'event', label: 'e', body: 'z'.repeat(1000) }] }),
    );
    const blob = serializeProgressTrace(fat)!;
    expect(blob.length).toBeLessThanOrEqual(TRACE_BLOB_MAX);
    expect(deserializeProgressTrace(blob)!.length).toBeGreaterThan(0);
  });

  it('returns undefined for empty / null / corrupt input', () => {
    expect(serializeProgressTrace([])).toBeUndefined();
    expect(serializeProgressTrace(undefined)).toBeUndefined();
    expect(deserializeProgressTrace(null)).toBeUndefined();
    expect(deserializeProgressTrace('')).toBeUndefined();
    expect(deserializeProgressTrace('{not json')).toBeUndefined();
    expect(deserializeProgressTrace('[]')).toBeUndefined();
    expect(deserializeProgressTrace('[{"junk":1}]')).toBeUndefined(); // no stage/label/status
  });

  it('keeps a single pathologically nested step under the hard blob cap', () => {
    const blob = serializeProgressTrace([
      step({
        stage: 'huge',
        processLog: Array.from({ length: 4_000 }, (_, index) => ({
          kind: 'event',
          label: `event ${index}`,
          body: 'z'.repeat(2_000),
        })),
        toolRuns: Array.from({ length: 4_000 }, (_, index) => ({
          id: `tool-${index}`,
          name: 'inspect',
          status: 'done',
          output: 'x'.repeat(2_000),
        })),
      }),
    ])!;
    expect(blob.length).toBeLessThanOrEqual(TRACE_BLOB_MAX);
    expect(deserializeProgressTrace(blob)?.at(-1)?.stage).toBe('turn-terminal');
  });

  it('refuses legacy traces whose row ownership cannot be trusted', () => {
    expect(deserializeProgressTrace(JSON.stringify([step({ stage: 'legacy' })]))).toBeUndefined();
  });

  it('still reads version-2 traces and rejects invalid version-3 outcomes', () => {
    expect(deserializeProgressTrace(JSON.stringify({
      version: 2,
      steps: [step({ stage: 'legacy-v2' })],
    }))?.[0].stage).toBe('legacy-v2');
    expect(deserializeProgressTrace(JSON.stringify({
      version: 3,
      turnOutcome: 'probably',
      steps: [step()],
    }))).toBeUndefined();
  });

  it('rejects contradictory or ambiguously evidenced version-3 receipts', () => {
    const valid = JSON.parse(serializeProgressTrace([
      step({
        stage: 'verify',
        toolRuns: [{ id: 'typecheck', name: 'typecheck', status: 'done' }],
      }),
    ])!) as {
      version: number;
      turnOutcome: 'succeeded';
      steps: Array<{
        stage: string;
        evidenceId?: string;
        outcome?: 'succeeded' | 'failed' | 'interrupted' | 'withheld' | 'not-run';
        toolRuns?: Array<{ success?: boolean }>;
      }>;
    };

    const duplicateEvidence = structuredClone(valid);
    duplicateEvidence.steps[0].evidenceId = 'progress:terminal:turn';
    expect(deserializeProgressTrace(JSON.stringify(duplicateEvidence))).toBeUndefined();

    const mismatchedTerminal = structuredClone(valid);
    mismatchedTerminal.steps.at(-1)!.outcome = 'failed';
    expect(deserializeProgressTrace(JSON.stringify(mismatchedTerminal))).toBeUndefined();

    const contradictoryTool = structuredClone(valid);
    contradictoryTool.steps[0].toolRuns![0].success = false;
    expect(deserializeProgressTrace(JSON.stringify(contradictoryTool))).toBeUndefined();

    const duplicateTerminal = structuredClone(valid);
    duplicateTerminal.steps.push(structuredClone(duplicateTerminal.steps.at(-1)!));
    expect(deserializeProgressTrace(JSON.stringify(duplicateTerminal))).toBeUndefined();
  });
});
