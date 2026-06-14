/**
 * Tests for the produce→verify→regenerate-on-flaws loop + the boundary + the hardware probe.
 * Fully GPU-free / network-free: producer and vision verifier are fakes.
 */
import { describe, it, expect } from 'vitest';
import { generateWithVerification } from '../src/vision/image-gen-loop.js';
import { NullImageProducer, type ImageProducer, type GeneratedImage } from '../src/vision/image-producer.js';
import type { VisionAdapter } from '../src/vision/adapter.js';
import { recommendImageGenDefaults } from '../src/vision/hardware-probe.js';

function fakeImage(seed: number): GeneratedImage {
  return { dataBase64: `img-${seed}`, mime: 'image/png', width: 512, height: 512, seed, source: 'fake' };
}

/** A producer that records the negative prompts it was called with. */
function recordingProducer(): ImageProducer & { negatives: string[] } {
  const negatives: string[] = [];
  return {
    id: 'fake', canProduce: true, negatives,
    async generate(req) { negatives.push(req.negativePrompt ?? ''); return fakeImage(negatives.length); },
  };
}

/** A vision verifier scripted to return a sequence of (score, flaws) audits. */
function scriptedVision(audits: { score: number; flaws: string[] }[]): VisionAdapter {
  let i = 0;
  return {
    id: 'fake-vision', canSee: true,
    async describe() {
      const a = audits[Math.min(i++, audits.length - 1)];
      return { text: `SCORE: ${a.score}\nFLAWS: ${a.flaws.length ? a.flaws.join(', ') : 'none'}`, confidence: 0.8, source: 'fake-vision' };
    },
  };
}

describe('hardware probe', () => {
  it('recommends SDXL for a 12GB card', () => {
    const d = recommendImageGenDefaults(12_288);
    expect(d.recommendedModel).toBe('sdxl');
    expect(d.lowVram).toBe(false);
  });
  it('recommends Flux-schnell for a 24GB card', () => {
    expect(recommendImageGenDefaults(24_000).recommendedModel).toBe('flux-schnell-q');
  });
  it('falls back to SD1.5 with offload when VRAM is unknown', () => {
    const d = recommendImageGenDefaults(null);
    expect(d.recommendedModel).toBe('sd15');
    expect(d.lowVram).toBe(true);
  });
});

describe('NullImageProducer', () => {
  it('cannot produce and returns null', async () => {
    expect(NullImageProducer.canProduce).toBe(false);
    expect(await NullImageProducer.generate({ prompt: 'a cat' })).toBeNull();
  });
});

describe('generateWithVerification', () => {
  it('accepts a clean first image (high score, no flaws) — single attempt', async () => {
    const producer = recordingProducer();
    const vision = scriptedVision([{ score: 95, flaws: [] }]);
    const res = await generateWithVerification(producer, vision, { prompt: '3 cats' });
    expect(res.accepted).toBe(true);
    expect(res.attempts).toHaveLength(1);
    expect(res.image).not.toBeNull();
  });

  it('regenerates on flaws and folds them into the negative prompt', async () => {
    const producer = recordingProducer();
    const vision = scriptedVision([
      { score: 40, flaws: ['only 2 cats', 'blurry'] }, // attempt 1: flawed
      { score: 92, flaws: [] },                          // attempt 2: clean
    ]);
    const res = await generateWithVerification(producer, vision, { prompt: '3 cats' });
    expect(res.accepted).toBe(true);
    expect(res.attempts).toHaveLength(2);
    // The 2nd generation must have received the 1st attempt's flaws as negatives.
    expect(producer.negatives[1]).toContain('only 2 cats');
    expect(producer.negatives[1]).toContain('blurry');
  });

  it('stops at maxAttempts and returns the best-scoring attempt when never clean', async () => {
    const producer = recordingProducer();
    const vision = scriptedVision([
      { score: 30, flaws: ['wrong'] },
      { score: 65, flaws: ['still off'] },
      { score: 50, flaws: ['nope'] },
    ]);
    const res = await generateWithVerification(producer, vision, { prompt: 'x' }, { maxAttempts: 3 });
    expect(res.accepted).toBe(false);
    expect(res.attempts).toHaveLength(3);
    expect(res.image!.seed).toBe(2); // attempt 2 had the best score (65)
  });

  it('returns the first image unverified when no vision verifier is available', async () => {
    const producer = recordingProducer();
    const res = await generateWithVerification(producer, undefined, { prompt: 'x' });
    expect(res.accepted).toBe(true);
    expect(res.attempts).toHaveLength(1);
  });

  it('declines (null image) when the producer cannot produce', async () => {
    const res = await generateWithVerification(NullImageProducer, undefined, { prompt: 'x' });
    expect(res.image).toBeNull();
    expect(res.attempts).toHaveLength(0);
  });

  it('PRE-GATE: declines without generating when the verifier says the user did not ask for an image', async () => {
    const producer = recordingProducer();
    const res = await generateWithVerification(producer, undefined, { prompt: 'how are you?' }, {
      confirmWantsImage: async () => ({ wantsImage: false, reason: 'just a greeting' }),
    });
    expect(res.image).toBeNull();
    expect(res.attempts).toHaveLength(0);
    expect(res.declinedReason).toContain('greeting');
    expect(producer.negatives).toHaveLength(0); // never even called the producer
  });

  it('PRE-GATE: proceeds when the verifier confirms the user wants an image', async () => {
    const producer = recordingProducer();
    const res = await generateWithVerification(producer, undefined, { prompt: 'draw a cat' }, {
      confirmWantsImage: async () => ({ wantsImage: true }),
    });
    expect(res.image).not.toBeNull();
    expect(producer.negatives).toHaveLength(1);
  });

  it('PRE-GATE: fails open (still generates) when the gate throws', async () => {
    const producer = recordingProducer();
    const res = await generateWithVerification(producer, undefined, { prompt: 'draw a cat' }, {
      confirmWantsImage: async () => { throw new Error('gate down'); },
    });
    expect(res.image).not.toBeNull();
  });
});
