import { describe, expect, it } from 'vitest';
import dataset from '../../../eval/retrieval/memory-golden.json';
import { runMemoryRetrievalEval, type MemoryRetrievalDataset } from '../src/eval/retrieval-flywheel.js';

describe('Memory Retrieval Flywheel', () => {
  it('meets the golden retrieval thresholds for browsing-memory queries', async () => {
    const report = await runMemoryRetrievalEval(dataset as MemoryRetrievalDataset);

    expect(report.ok).toBe(true);
    expect(report.metrics.engineRecallAtK).toBeGreaterThanOrEqual(report.thresholds.engineRecallAtK);
    expect(report.metrics.engineTop1Accuracy).toBeGreaterThanOrEqual(report.thresholds.engineTop1Accuracy);
    expect(report.metrics.apiRecallAtK).toBeGreaterThanOrEqual(report.thresholds.apiRecallAtK);
    expect(report.metrics.groundedPassRate).toBeGreaterThanOrEqual(report.thresholds.groundedPassRate);
  }, 30_000);
});
