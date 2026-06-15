import { describe, expect, it } from 'vitest';
import {
  applyToolExecution,
  buildToolBatchProgress,
  formatToolInput,
  toolRunsFromCalls,
} from '../src/tools/tool-progress.js';

describe('tool-progress', () => {
  it('formats tool input as pretty JSON', () => {
    expect(formatToolInput('{"path":"src/a.ts"}')).toContain('"path"');
  });

  it('builds running then done batch progress with nested tool runs', () => {
    const calls = [
      { id: '1', name: 'read_file', arguments: '{"path":"App.tsx"}' },
      { id: '2', name: 'grep', arguments: '{"pattern":"foo"}' },
    ];
    let runs = toolRunsFromCalls(calls);
    const running = buildToolBatchProgress(0, runs, 'running');
    expect(running.label).toBe('Vai called 2 tools (round 1)');
    expect(running.toolRuns).toHaveLength(2);

    runs = applyToolExecution(runs, {
      toolCall: calls[0],
      success: true,
      output: 'file contents',
      durationMs: 12,
    });
    runs = applyToolExecution(runs, {
      toolCall: calls[1],
      success: true,
      output: 'matches: 3',
      durationMs: 8,
    });
    const done = buildToolBatchProgress(0, runs, 'done');
    expect(done.status).toBe('done');
    expect(done.toolRuns[0]?.output).toBe('file contents');
    expect(done.toolRuns[1]?.name).toBe('grep');
  });
});
