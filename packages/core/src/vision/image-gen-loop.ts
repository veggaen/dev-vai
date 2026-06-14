/**
 * Produce → verify → regenerate-on-flaws loop.
 *
 * The producer+verifier pattern you asked for: Vai generates an image, then the council's VISION
 * member audits it against the original prompt and lists concrete flaws; if flaws are found, we
 * regenerate with those flaws folded into the negative prompt + a corrected positive prompt, and
 * keep the best result. Capped iterations so it can never spin.
 *
 * Fact-quarantine analogue: the verifier POINTS at flaws ("only 2 cats, prompt asked for 3";
 * "text is garbled"), it does not draw — the producer redraws. Pure orchestration; the GPU work
 * is inside ComfyUI and the audit inside the vision adapter, both injected.
 */

import type { ImageProducer, GeneratedImage } from './image-producer.js';
import type { VisionAdapter } from './adapter.js';
import type { ModelAdapter } from '../models/adapter.js';

/**
 * Build a `confirmWantsImage` gate backed by a model (Grok/council member). Asks, in text, whether
 * the user's message is actually a request to GENERATE an image — the "did the user even ask for an
 * image?" axis. Fail-open: any error/parse-miss returns wantsImage:true so a flaky verifier never
 * blocks a legitimate request. Returns undefined when no adapter is given (no gate).
 */
export function modelBackedWantsImageGate(
  adapter: ModelAdapter | undefined,
  userMessage: string,
): ((signal?: AbortSignal) => Promise<{ wantsImage: boolean; reason?: string }>) | undefined {
  if (!adapter) return undefined;
  return async (signal?: AbortSignal) => {
    try {
      const res = await adapter.chat({
        messages: [
          { role: 'system', content: 'You judge intent only. Reply STRICT JSON: {"wantsImage": boolean, "reason": "short"}. wantsImage=true ONLY if the user is asking to CREATE/GENERATE/DRAW a NEW image (not to read/analyze an existing one).' },
          { role: 'user', content: `User message: ${JSON.stringify(userMessage)}\nReturn the JSON now.` },
        ],
        temperature: 0,
        maxTokens: 80,
        signal,
      });
      const m = /\{[\s\S]*\}/.exec(res.message.content);
      if (!m) return { wantsImage: true };
      const parsed = JSON.parse(m[0]) as { wantsImage?: boolean; reason?: string };
      return { wantsImage: parsed.wantsImage !== false, reason: parsed.reason };
    } catch {
      return { wantsImage: true }; // fail-open
    }
  };
}

export interface ImageGenLoopOptions {
  /** Max total generation attempts (including the first). Default 3. */
  readonly maxAttempts?: number;
  /** Below this verifier match score (0..1) we regenerate. Default 0.7. */
  readonly acceptThreshold?: number;
  /**
   * Multi-axis gate run BEFORE producing: confirm the user actually wants an image (catches an
   * auto-detect false positive). Returns false → the loop declines without generating. Injected
   * so it can be backed by Grok / the council (not just the regex detector). Optional.
   */
  readonly confirmWantsImage?: (signal?: AbortSignal) => Promise<{ wantsImage: boolean; reason?: string }>;
  /** Called as each attempt completes — lets the caller stream live progress to the UI. */
  readonly onAttempt?: (attempt: ImageGenAttempt) => void;
  /** Called once before producing each attempt — lets the caller stream "generating…" first. */
  readonly onProduceStart?: (attempt: number) => void;
  readonly signal?: AbortSignal;
}

/** One attempt's outcome. */
export interface ImageGenAttempt {
  readonly attempt: number;
  readonly image: GeneratedImage;
  /** Verifier's prompt-match score (0..1). */
  readonly matchScore: number;
  /** Concrete flaws the verifier found (empty when clean). */
  readonly flaws: readonly string[];
  /** Whether this attempt was accepted (no regenerate). */
  readonly accepted: boolean;
}

export interface ImageGenLoopResult {
  /** The best image produced, or null when production failed entirely. */
  readonly image: GeneratedImage | null;
  /** Every attempt, in order — the inspectable trace for the UI. */
  readonly attempts: readonly ImageGenAttempt[];
  /** True when the final image met the accept threshold. */
  readonly accepted: boolean;
  /** Set when the pre-gate decided NOT to generate (the user didn't actually want an image). */
  readonly declinedReason?: string;
}

/** Ask the vision verifier to score a produced image against the prompt and list flaws. */
async function verify(
  vision: VisionAdapter,
  image: GeneratedImage,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ matchScore: number; flaws: string[] }> {
  const question = [
    `This image was generated for the request: "${prompt}".`,
    'Audit it. Reply in this exact form:',
    'SCORE: <0-100 how well it matches the request>',
    'FLAWS: <comma-separated concrete problems, or "none">',
  ].join('\n');
  const seen = await vision.describe({ dataBase64: image.dataBase64, mime: image.mime, question, signal });
  if (!seen?.text) return { matchScore: 0.5, flaws: [] }; // verifier blind → neutral, don't loop forever
  const scoreMatch = /SCORE:\s*(\d{1,3})/i.exec(seen.text);
  const flawsMatch = /FLAWS:\s*(.+)/is.exec(seen.text);
  const matchScore = scoreMatch ? Math.min(1, Math.max(0, Number(scoreMatch[1]) / 100)) : 0.5;
  const flawsRaw = flawsMatch?.[1]?.trim() ?? '';
  const flaws = /^none\b/i.test(flawsRaw) ? [] : flawsRaw.split(/[,;]/).map((f) => f.trim()).filter(Boolean);
  return { matchScore, flaws };
}

/**
 * Run the produce→verify→regenerate loop. Returns the best image + the full attempt trace.
 * When no vision verifier is supplied (or it can't see), the first produced image is returned
 * unverified (single attempt) — verification is an enhancement, not a hard dependency.
 */
export async function generateWithVerification(
  producer: ImageProducer,
  vision: VisionAdapter | undefined,
  request: { prompt: string; negativePrompt?: string; width?: number; height?: number },
  options: ImageGenLoopOptions = {},
): Promise<ImageGenLoopResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const acceptThreshold = options.acceptThreshold ?? 0.7;

  // Pre-gate (axis: did the user even ask for an image?). Backed by Grok/council when injected.
  // Guards against an auto-detect false positive producing an unwanted image.
  if (options.confirmWantsImage) {
    try {
      const gate = await options.confirmWantsImage(options.signal);
      if (!gate.wantsImage) {
        return { image: null, attempts: [], accepted: false, declinedReason: gate.reason ?? 'verifier judged the request did not ask for an image' };
      }
    } catch {
      // gate failure → proceed (fail-open: don't block generation on a flaky verifier)
    }
  }

  const attempts: ImageGenAttempt[] = [];
  let negativePrompt = request.negativePrompt ?? '';
  let best: ImageGenAttempt | null = null;

  for (let i = 1; i <= maxAttempts; i++) {
    if (options.signal?.aborted) break;
    options.onProduceStart?.(i);
    const image = await producer.generate({
      prompt: request.prompt, negativePrompt, width: request.width, height: request.height, signal: options.signal,
    });
    if (!image) break; // producer failed / dormant → stop (caller declines honestly)

    // No verifier (or it can't see) → accept the first image as-is.
    if (!vision?.canSee) {
      const attempt: ImageGenAttempt = { attempt: i, image, matchScore: 0.5, flaws: [], accepted: true };
      attempts.push(attempt);
      options.onAttempt?.(attempt);
      return { image, attempts, accepted: true };
    }

    const { matchScore, flaws } = await verify(vision, image, request.prompt, options.signal);
    const accepted = matchScore >= acceptThreshold && flaws.length === 0;
    const attempt: ImageGenAttempt = { attempt: i, image, matchScore, flaws, accepted };
    attempts.push(attempt);
    options.onAttempt?.(attempt);
    if (!best || matchScore > best.matchScore) best = attempt;
    if (accepted) return { image, attempts, accepted: true };

    // Fold the flaws into the next attempt: add them to the negative prompt so the model avoids them.
    if (flaws.length > 0) {
      negativePrompt = [negativePrompt, ...flaws].filter(Boolean).join(', ');
    }
  }

  return { image: best?.image ?? attempts[attempts.length - 1]?.image ?? null, attempts, accepted: false };
}
