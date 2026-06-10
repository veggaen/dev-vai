/**
 * CI floor gate for the dimension-cluster benchmark.
 *
 * Runs the same in-process baseline-vs-augmented benchmark used by
 * scripts/vai-dimension-cluster-bench.mjs and asserts the user-confirmed
 * success bar: ≥50% combined failure-rate reduction across the three failure
 * families (constraint degradation, output-format drift, prompt injection).
 *
 * It also asserts that the AUGMENTED build leaves no scenario failing, which is
 * the stronger property we actually want from this loop.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runDimensionClusterBench,
  type DimensionClusterScenario,
} from '../src/eval/dimension-cluster-bench.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_PATH = join(__dirname, '..', '..', '..', 'eval', 'dimension-clusters', 'scenarios.json');

const COMBINED_REDUCTION_FLOOR = 50;

function loadScenarios(): DimensionClusterScenario[] {
  const pack = JSON.parse(readFileSync(SCENARIOS_PATH, 'utf8'));
  return pack.scenarios as DimensionClusterScenario[];
}

describe('dimension-cluster benchmark', () => {
  it(`reduces combined failure rate by at least ${COMBINED_REDUCTION_FLOOR}% vs the prompt-only baseline`, async () => {
    const report = await runDimensionClusterBench(loadScenarios());

    // The baseline must actually fail things, otherwise the test is vacuous.
    expect(report.baselineFailures).toBeGreaterThan(0);
    expect(report.combinedReductionPct).toBeGreaterThanOrEqual(COMBINED_REDUCTION_FLOOR);
  }, 30_000);

  it('leaves no scenario failing in the augmented build, per failure family', async () => {
    const report = await runDimensionClusterBench(loadScenarios());
    const stillFailing = report.results
      .filter((r) => !r.augmented.passed)
      .map((r) => `${r.cluster}/${r.id} [handler=${r.augmented.handler}]: ${r.augmented.failures.join('; ')}`);
    expect(stillFailing).toEqual([]);
  }, 30_000);
});
