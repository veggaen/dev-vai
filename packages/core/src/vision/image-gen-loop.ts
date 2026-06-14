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

export interface ImageGenLoopOptions {
  /** Max total generation attempts (including the first). Default 3. */
  readonly maxAttempts?: number;
  /** Below this verifier match score (0..1) we regenerate. Default 0.7. */
  readonly acceptThreshold?: number;
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
  const attempts: ImageGenAttempt[] = [];
  let negativePrompt = request.negativePrompt ?? '';
  let best: ImageGenAttempt | null = null;

  for (let i = 1; i <= maxAttempts; i++) {
    if (options.signal?.aborted) break;
    const image = await producer.generate({
      prompt: request.prompt, negativePrompt, width: request.width, height: request.height, signal: options.signal,
    });
    if (!image) break; // producer failed / dormant → stop (caller declines honestly)

    // No verifier (or it can't see) → accept the first image as-is.
    if (!vision?.canSee) {
      const attempt: ImageGenAttempt = { attempt: i, image, matchScore: 0.5, flaws: [], accepted: true };
      attempts.push(attempt);
      return { image, attempts, accepted: true };
    }

    const { matchScore, flaws } = await verify(vision, image, request.prompt, options.signal);
    const accepted = matchScore >= acceptThreshold && flaws.length === 0;
    const attempt: ImageGenAttempt = { attempt: i, image, matchScore, flaws, accepted };
    attempts.push(attempt);
    if (!best || matchScore > best.matchScore) best = attempt;
    if (accepted) return { image, attempts, accepted: true };

    // Fold the flaws into the next attempt: add them to the negative prompt so the model avoids them.
    if (flaws.length > 0) {
      negativePrompt = [negativePrompt, ...flaws].filter(Boolean).join(', ');
    }
  }

  return { image: best?.image ?? attempts[attempts.length - 1]?.image ?? null, attempts, accepted: false };
}
