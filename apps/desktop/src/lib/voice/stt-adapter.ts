/**
 * Speech-to-text adapter contract.
 *
 * Voice→text is built against THIS interface, never a concrete engine, so the
 * capture/insert/correction pipeline never changes when the engine does. The
 * zero-dependency default ({@link WebSpeechAdapter}) uses the browser's built-in
 * SpeechRecognition — already present in the Tauri WebView2 on Windows — so the
 * feature ships without pulling in any third-party STT library. A local Whisper
 * sidecar (or a council-model-backed transcriber with web tools) can later be
 * dropped in behind this same interface with no UI change.
 */

export interface SttPartial {
  /** Best-so-far transcript for the current utterance (interim or final). */
  readonly transcript: string;
  /** True once the engine considers this segment finalized. */
  readonly isFinal: boolean;
}

export type SttErrorCode =
  | 'unsupported'      // no engine available in this environment
  | 'not-allowed'      // mic permission denied
  | 'no-speech'        // engine heard nothing
  | 'aborted'          // we stopped it on purpose
  | 'network'          // engine backend unreachable
  | 'unknown';

export interface SttError {
  readonly code: SttErrorCode;
  readonly message: string;
}

export interface SttSession {
  /** Stop listening and resolve with the final transcript (best-effort). */
  stop(): Promise<string>;
  /** Abort without using the result (e.g. user cancelled with Escape). */
  abort(): void;
}

export interface SttStartOptions {
  readonly lang?: string;
  /** Called as interim/final transcripts arrive, so the UI can show live text. */
  readonly onPartial?: (partial: SttPartial) => void;
  /**
   * Called ~20×/sec with the current mic loudness (0–1) while capturing, so the UI
   * can render a live bouncing level meter instead of a spinner. Cosmetic — never
   * affects the transcript.
   */
  readonly onLevel?: (level: number) => void;
  readonly onError?: (error: SttError) => void;
  /**
   * Preferred input device (from {@link enumerateMicrophones}). When set, the OS-permission
   * pre-flight pins capture to this mic. Omit to use the system default.
   */
  readonly deviceId?: string;
}

/** A selectable audio input, surfaced by {@link enumerateMicrophones} for the device picker. */
export interface MicDevice {
  readonly deviceId: string;
  /** Human label (empty until mic permission is granted — the OS hides labels otherwise). */
  readonly label: string;
}

export interface SttAdapter {
  readonly id: string;
  /** Whether this adapter can run right now (engine present, etc.). */
  isAvailable(): boolean;
  /** Begin a listening session. Throws an {@link SttError} if it cannot start. */
  start(options?: StartOptions): Promise<SttSession>;
}

type StartOptions = SttStartOptions;
