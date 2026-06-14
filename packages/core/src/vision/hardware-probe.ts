/**
 * Per-system image-gen defaults probe.
 *
 * "Configurable, optimize per system" — rather than baking in a model, we detect the GPU's VRAM
 * (via `nvidia-smi` when present) and recommend a model + sampler params that fit. Env/config
 * always override; this only supplies the DEFAULT when nothing is specified. Pure-ish: the only
 * side effect is a cached, best-effort `nvidia-smi` call that never throws.
 *
 * The recommendation is advisory metadata — the actual model must exist in the user's ComfyUI;
 * the backend surfaces a clear error if the configured/recommended checkpoint isn't installed.
 */

import { spawnSync } from 'node:child_process';

export interface ImageGenDefaults {
  /** Suggested checkpoint family for the detected hardware. */
  readonly recommendedModel: 'sdxl' | 'flux-schnell-q' | 'sd15';
  /** A human note explaining the pick. */
  readonly reason: string;
  /** Detected total VRAM in MB, or null when unknown. */
  readonly vramMb: number | null;
  readonly steps: number;
  readonly width: number;
  readonly height: number;
  /** Whether to advise model/VAE offloading (tight VRAM). */
  readonly lowVram: boolean;
}

let cachedVram: number | null | undefined;

/** Best-effort total VRAM (MB) via nvidia-smi. Cached. Returns null when unavailable. */
export function detectVramMb(): number | null {
  if (cachedVram !== undefined) return cachedVram;
  try {
    const res = spawnSync('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], {
      timeout: 4_000, encoding: 'utf8',
    });
    if (res.status === 0 && res.stdout) {
      const first = res.stdout.split(/\r?\n/).map((l) => Number(l.trim())).find((n) => Number.isFinite(n) && n > 0);
      cachedVram = first ?? null;
    } else {
      cachedVram = null;
    }
  } catch {
    cachedVram = null;
  }
  return cachedVram;
}

/**
 * Recommend image-gen defaults for the detected hardware. Thresholds:
 *  - ≥16GB: Flux-schnell (quantized) — best fidelity the card can hold comfortably.
 *  - 8–16GB: SDXL — strong quality, fast, comfortable headroom (the RTX 3080 Ti / 12GB case).
 *  - <8GB or unknown: SD1.5 — smallest, always-runs fallback; low-VRAM offload advised.
 */
export function recommendImageGenDefaults(vramMbOverride?: number | null): ImageGenDefaults {
  // Distinguish "not passed" (probe the GPU) from an explicit null/number (use it verbatim).
  const vramMb = arguments.length > 0 ? vramMbOverride ?? null : detectVramMb();
  if (vramMb !== null && vramMb >= 16_000) {
    return { recommendedModel: 'flux-schnell-q', reason: `${vramMb}MB VRAM — Flux-schnell (quantized) fits with headroom.`, vramMb, steps: 4, width: 1024, height: 1024, lowVram: false };
  }
  if (vramMb !== null && vramMb >= 8_000) {
    return { recommendedModel: 'sdxl', reason: `${vramMb}MB VRAM — SDXL: strong quality, comfortable headroom, leaves room for the local council.`, vramMb, steps: 30, width: 1024, height: 1024, lowVram: false };
  }
  return {
    recommendedModel: 'sd15',
    reason: vramMb === null ? 'No NVIDIA GPU detected — SD1.5 is the safest CPU/low-VRAM fallback.' : `${vramMb}MB VRAM — SD1.5 with offloading is the safe fit.`,
    vramMb, steps: 25, width: 512, height: 512, lowVram: true,
  };
}
