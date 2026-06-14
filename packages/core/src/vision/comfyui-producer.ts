/**
 * ComfyUI-backed image producer (free / open-source, no API key).
 *
 * Talks to a local ComfyUI server (default http://127.0.0.1:8188) over its HTTP API:
 *   POST /prompt          → queue a workflow graph, returns prompt_id
 *   GET  /history/{id}    → poll until the node outputs an image
 *   GET  /view?...        → fetch the PNG bytes
 *
 * Configurable, no hard-baked model: the checkpoint comes from config/env (VAI_IMAGEGEN_MODEL),
 * else the per-hardware probe's recommendation. Backend is DORMANT until a server is reachable —
 * `isComfyUiReachable()` lets the caller fall back to NullImageProducer (honest decline) when
 * ComfyUI isn't running, with no code change once the user installs + starts it.
 *
 * Pure HTTP — no GPU code here. The GPU work happens inside the user's ComfyUI process, which
 * keeps image-gen isolated from Vai's own process (and lets the user manage VRAM contention with
 * the local council on their terms — the crash-safe "one heavy task at a time" rule).
 */

import type { GeneratedImage, ImageGenRequest, ImageProducer } from './image-producer.js';
import { recommendImageGenDefaults } from './hardware-probe.js';

export interface ComfyUiOptions {
  readonly baseUrl?: string;
  /** Checkpoint filename as it appears in ComfyUI (e.g. "sd_xl_base_1.0.safetensors"). */
  readonly model?: string;
  /** Overall wall-clock cap for one generation (ms). Default 120_000. */
  readonly timeoutMs?: number;
  readonly id?: string;
}

const DEFAULT_BASE_URL = process.env.VAI_COMFYUI_URL?.trim() || 'http://127.0.0.1:8188';

/** Best-effort: is a ComfyUI server reachable right now? */
export async function isComfyUiReachable(baseUrl = DEFAULT_BASE_URL, timeoutMs = 2_000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${baseUrl}/system_stats`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Map our model family hint → a conventional checkpoint filename (overridable by config). */
function defaultCheckpointFor(model: string | undefined): string {
  if (model) return model;
  const rec = recommendImageGenDefaults().recommendedModel;
  switch (rec) {
    case 'flux-schnell-q': return 'flux1-schnell-Q8_0.gguf';
    case 'sd15': return 'v1-5-pruned-emaonly.safetensors';
    case 'sdxl':
    default: return 'sd_xl_base_1.0.safetensors';
  }
}

/** Build a minimal txt2img ComfyUI graph. */
function buildWorkflow(req: ImageGenRequest, checkpoint: string, seed: number): Record<string, unknown> {
  const defaults = recommendImageGenDefaults();
  const width = req.width ?? defaults.width;
  const height = req.height ?? defaults.height;
  const steps = req.steps ?? defaults.steps;
  return {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: req.prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: req.negativePrompt ?? '', clip: ['4', 1] } },
    '3': {
      class_type: 'KSampler',
      inputs: { seed, steps, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1,
        model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'vai', images: ['8', 0] } },
  };
}

async function pollHistory(baseUrl: string, promptId: string, deadline: number, signal?: AbortSignal): Promise<{ filename: string; subfolder: string; type: string } | null> {
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('image generation aborted');
    const res = await fetch(`${baseUrl}/history/${promptId}`);
    if (res.ok) {
      const hist = (await res.json()) as Record<string, { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }>;
      const entry = hist[promptId];
      if (entry?.outputs) {
        for (const node of Object.values(entry.outputs)) {
          const img = node.images?.[0];
          if (img) return img;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

/** Create a ComfyUI image producer. Reachability is checked per-call inside generate(). */
export function createComfyUiProducer(options: ComfyUiOptions = {}): ImageProducer {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const id = options.id ?? 'imagegen:comfyui';
  const timeoutMs = options.timeoutMs ?? 120_000;
  const checkpoint = defaultCheckpointFor(options.model ?? process.env.VAI_IMAGEGEN_MODEL);

  return {
    id,
    canProduce: true,
    async generate(req: ImageGenRequest): Promise<GeneratedImage | null> {
      if (!(await isComfyUiReachable(baseUrl))) return null; // dormant until server is up → caller declines
      const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31);
      const workflow = buildWorkflow(req, checkpoint, seed);
      const deadline = Date.now() + timeoutMs;
      try {
        const queued = await fetch(`${baseUrl}/prompt`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: workflow }), signal: req.signal,
        });
        if (!queued.ok) return null;
        const { prompt_id: promptId } = (await queued.json()) as { prompt_id?: string };
        if (!promptId) return null;

        const out = await pollHistory(baseUrl, promptId, deadline, req.signal);
        if (!out) return null;

        const params = new URLSearchParams({ filename: out.filename, subfolder: out.subfolder, type: out.type });
        const imgRes = await fetch(`${baseUrl}/view?${params}`, { signal: req.signal });
        if (!imgRes.ok) return null;
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const defaults = recommendImageGenDefaults();
        return {
          dataBase64: buf.toString('base64'),
          mime: 'image/png',
          width: req.width ?? defaults.width,
          height: req.height ?? defaults.height,
          seed,
          source: `${id}:${checkpoint}`,
        };
      } catch {
        return null; // never throws into a turn
      }
    },
  };
}
