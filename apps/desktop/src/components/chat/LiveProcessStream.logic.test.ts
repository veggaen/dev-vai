import { describe, expect, it } from 'vitest';
import { flattenStepsForLive, partitionLiveRows } from './LiveProcessStream.logic.js';

describe('flattenStepsForLive', () => {
  it('maps progress steps to flat rows without tree nesting', () => {
    const rows = flattenStepsForLive([
      { stage: 'reason', label: 'Working through it', status: 'done' },
      { stage: 'council-vai-round-1', label: 'Council reviewing', status: 'running', councilMembers: [{
        name: 'Qwen',
        topic: 'factual',
        verdict: 'needs-work',
        confidence: 0.4,
      }] },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.subLines).toHaveLength(1);
  });

  it('surfaces process kinds and ready tool responses in live sublines', () => {
    const rows = flattenStepsForLive([{
      stage: 'inspect',
      label: 'Inspecting workspace',
      status: 'done',
      processLog: [{ kind: 'read', label: 'Read ProcessTree', body: 'ProcessTree.tsx' }],
      toolRuns: [{
        id: 'read-1',
        name: 'read_file',
        status: 'done',
        success: true,
        output: 'file body',
      }],
    }]);

    expect(rows[0]?.subLines[0]?.label).toBe('Read · Read ProcessTree');
    expect(rows[0]?.subLines[1]?.detail).toBe('ok · response ready');
  });
});

describe('partitionLiveRows', () => {
  it('reveals only up to visibleCount with latest row active', () => {
    const rows = flattenStepsForLive([
      { stage: 'reason', label: 'Step 1', status: 'done' },
      { stage: 'vai-draft', label: 'Step 2', status: 'done' },
      { stage: 'council-vai-round-1', label: 'Step 3', status: 'running' },
    ]);
    const p = partitionLiveRows(rows, 2);
    expect(p.visibleDone).toHaveLength(1);
    expect(p.active?.label).toBe('Step 2');
  });

  it('folds older done rows when history exceeds cap', () => {
    const rows = flattenStepsForLive([
      { stage: 'a', label: 'A', status: 'done' },
      { stage: 'b', label: 'B', status: 'done' },
      { stage: 'c', label: 'C', status: 'done' },
      { stage: 'd', label: 'D', status: 'done' },
      { stage: 'e', label: 'E', status: 'running' },
    ]);
    const p = partitionLiveRows(rows, 5);
    expect(p.foldedCount).toBe(1);
    expect(p.visibleDone.map((r) => r.label)).toEqual(['B', 'C', 'D']);
    expect(p.active?.label).toBe('E');
  });
});
