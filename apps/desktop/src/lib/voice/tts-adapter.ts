/**
 * Text-to-speech adapter contract (the OUTPUT mirror of {@link ../voice/stt-adapter}).
 *
 * Voice OUT is built against this interface, never a concrete engine. The zero-dependency
 * default ({@link WebSpeechTtsAdapter}) uses the browser's built-in speechSynthesis — present in
 * the Tauri WebView2 on Windows — so it is FREE and local, no third-party TTS. A higher-quality
 * local voice can later drop in behind this same interface with no caller change.
 *
 * HONESTY: this reads TEXT aloud (the presence channel's voice layer). It is NOT a synthetic
 * Claude voice — it speaks the text blocks Vai/the council produce.
 */

export interface TtsUtterance {
  readonly text: string;
  readonly lang?: string;
  /** 0..1; default voice rate otherwise. */
  readonly rate?: number;
}

export interface TtsAdapter {
  readonly id: string;
  isAvailable(): boolean;
  /** Queue an utterance (utterances play in order). Resolves when it finishes speaking. */
  speak(utterance: TtsUtterance): Promise<void>;
  /** Stop everything immediately and clear the queue. */
  cancel(): void;
}
