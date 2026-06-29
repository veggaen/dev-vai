import { describe, it, expect } from 'vitest';
import {
  accumulateProgressStep,
  serializeProgressTrace,
  deserializeProgressTrace,
  TRACE_BLOB_MAX,
} from '../src/chat/progress-trace.js';
import type { ChatProgressStep } from '@vai/api-types/chat-ws';

const step = (over: Partial<ChatProgressStep> = {}): ChatProgressStep => ({
  stage: 'council-vai-round-1',
  label: 'Council reviewed the draft',
  status: 'done',
  ...over,
});

describe('accumulateProgressStep', () => {
  it('appends new stages and settles the previous running step', () => {
    let trace: ChatProgressStep[] = [];
    trace = accumulateProgressStep(trace, step({ stage: 'search', label: 'Searched', status: 'running' }));
    trace = accumulateProgressStep(trace, step({ stage: 'vai-draft', label: 'Proposed', status: 'running' }));
    expect(trace).toHaveLength(2);
    expect(trace[0].status).toBe('done'); // prior running step settled
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
    expect(back).toHaveLength(2);
    expect(back![0].processLog?.[0].label).toBe('read coindesk');
    expect(back![1].councilMembers?.[0].note).toBe('tighten the claim');
  });

  it('settles running steps/tools to a terminal state on persist', () => {
    const blob = serializeProgressTrace([
      step({ stage: 'x', status: 'running', toolRuns: [{ id: 't1', name: 'grep', status: 'running' }] }),
    ]);
    const back = deserializeProgressTrace(blob)!;
    expect(back[0].status).toBe('done');
    expect(back[0].toolRuns?.[0].status).toBe('done');
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
});
