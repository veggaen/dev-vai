/**
 * Image PRODUCTION boundary — the mirror of {@link VisionAdapter} (which READS images).
 *
 * Vai should be able to make images, not just inspect them. This is the typed seam so backends
 * swap freely (local ComfyUI / SDXL / Flux today, anything later) with no caller change, and so
 * the produce→verify→regenerate loop is testable without a GPU or a running server.
 *
 * Design commitments (per project direction):
 *  - Free / open-source first: the shipping backend is local ComfyUI (no API key).
 *  - Configurable, no hard-baked model: the model + sampler params come from config, with a
 *    per-hardware probe choosing sensible defaults.
 *  - NullImageProducer is the honest default: it produces nothing, so a generation request with
 *    no backend declines honestly ("I can't generate images yet") rather than pretending.
 *  - The produced image is then VERIFIED by the council's vision member and regenerated on flaws
 *    (the producer+verifier loop) — see `image-gen-loop.ts`.
 */

/** A request to produce an image. */
export interface ImageGenRequest {
  /** What to draw. */
  readonly prompt: string;
  /** What to avoid (negative prompt), optional. */
  readonly negativePrompt?: string;
  /** Pixel dimensions; backend may clamp to supported sizes. */
  readonly width?: number;
  readonly height?: number;
  /** Reproducibility seed; omit for random. */
  readonly seed?: number;
  /** Diffusion steps; backend picks a hardware-appropriate default when omitted. */
  readonly steps?: number;
  readonly signal?: AbortSignal;
}

/** A produced image. */
export interface GeneratedImage {
  /** Base64-encoded image bytes (no data: prefix). */
  readonly dataBase64: string;
  readonly mime: string;
  readonly width: number;
  readonly height: number;
  /** The seed actually used (so a result can be reproduced / iterated). */
  readonly seed: number;
  /** Which backend/model produced this. */
  readonly source: string;
}

/** A pluggable image generator. */
export interface ImageProducer {
  readonly id: string;
  /** True when this backend can actually produce pixels (NullImageProducer is false). */
  readonly canProduce: boolean;
  generate(request: ImageGenRequest): Promise<GeneratedImage | null>;
}

/** The honest no-op. Produces nothing, returns null → caller declines honestly. Always present. */
export const NullImageProducer: ImageProducer = {
  id: 'imagegen:null',
  canProduce: false,
  async generate(): Promise<GeneratedImage | null> {
    return null;
  },
};
