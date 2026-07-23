import { describe, expect, it } from 'vitest';
import { hardwareProfileSchema } from '@vai/contracts/adoption';
import { rankModelFit } from './hardware.js';

describe('rankModelFit', () => {
  it('meaningfully separates fit, quantization size, backend, and architecture age', () => {
    const hardware = hardwareProfileSchema.parse({
      platform: 'test', cpu: 'cpu', logicalCores: 8, ramBytes: 32e9,
      gpus: [{ name: 'gpu', vramBytes: 8e9, backend: 'cuda' }], failures: [], scannedAt: 1,
    });
    const ranked = rankModelFit(hardware, [
      { id: 'qwen3:4b', size: 3e9, quantization: 'Q4', family: 'qwen3', backend: 'ollama' },
      { id: 'llama2:13b', size: 11e9, quantization: 'Q8', family: 'llama2', backend: 'ollama' },
    ]);
    expect(ranked[0].modelId).toBe('qwen3:4b');
    expect(ranked[0].score - ranked[1].score).toBeGreaterThan(25);
    expect(ranked[1]).toMatchObject({ fits: false, fitLabel: 'does-not-fit' });
  });
});
