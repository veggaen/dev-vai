/**
 * Stage C — Vision boundary.
 *
 * Vai stores image pixels (base64) but historically never sent them to any model, so it would
 * fabricate descriptions of screenshots it could not see. This is the typed seam that fixes
 * that honestly:
 *
 *  - `VisionAdapter.describe(...)` returns a grounded reading of an image (text + optional OCR
 *    + confidence), or null when it cannot read it.
 *  - `NullVisionAdapter` is the always-available default: it reads nothing and returns null, so
 *    a turn that needs pixels DECLINES honestly instead of hallucinating. (Fixes RC3.)
 *  - A real adapter (e.g. `createGrokVisionAdapter`, or a future local Ollama vision model) plugs
 *    in behind the same interface with no caller change.
 *
 * The describe() output is treated as VISUAL EVIDENCE the council can review and correct — it is
 * not blindly trusted as fact. Fact-quarantine holds: vision points at what the image contains;
 * Vai's grounded tools (live search / cross-check) own any value the user finally sees.
 */

/** Input to a vision describe call. */
export interface VisionDescribeInput {
  /** Base64-encoded image bytes (no data: prefix). */
  readonly dataBase64: string;
  /** MIME type, e.g. "image/png". */
  readonly mime: string;
  /** Optional focused question ("what is the price shown?"). */
  readonly question?: string;
  readonly signal?: AbortSignal;
}

/** A grounded reading of an image. */
export interface VisionDescription {
  /** Natural-language description / answer about the image. */
  readonly text: string;
  /** Extracted text (OCR), when the adapter performs it. */
  readonly ocrText?: string;
  /** Adapter's confidence in this reading, 0..1. */
  readonly confidence: number;
  /** Which adapter produced this (provenance for the evidence log). */
  readonly source: string;
}

/** A pluggable image reader. */
export interface VisionAdapter {
  readonly id: string;
  /** True when this adapter can actually read pixels (NullVisionAdapter is false). */
  readonly canSee: boolean;
  describe(input: VisionDescribeInput): Promise<VisionDescription | null>;
}

/**
 * The honest no-op. Reads nothing, returns null. Used as the default so an image-content turn
 * declines honestly ("I can't read the image directly") rather than fabricating. Always present.
 */
export const NullVisionAdapter: VisionAdapter = {
  id: 'vision:null',
  canSee: false,
  async describe(): Promise<VisionDescription | null> {
    return null;
  },
};
