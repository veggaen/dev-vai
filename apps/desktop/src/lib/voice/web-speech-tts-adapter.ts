/**
 * WebSpeechTtsAdapter — zero-dependency TTS via the browser's speechSynthesis.
 * Free, local, no third-party library. Queue is serial (one utterance at a time) so speech
 * never overlaps — matching the one-thing-at-a-time presence model.
 */
import type { TtsAdapter, TtsUtterance } from './tts-adapter.js';

export class WebSpeechTtsAdapter implements TtsAdapter {
  readonly id = 'web-speech-tts';

  isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
  }

  speak(utterance: TtsUtterance): Promise<void> {
    if (!this.isAvailable() || !utterance.text.trim()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(utterance.text);
      if (utterance.lang) u.lang = utterance.lang;
      if (utterance.rate) u.rate = utterance.rate;
      u.onend = () => resolve();
      u.onerror = () => resolve(); // observability must never block the queue
      window.speechSynthesis.speak(u); // browser queues serially
    });
  }

  cancel(): void {
    if (this.isAvailable()) window.speechSynthesis.cancel();
  }
}

/** Pick the default available adapter (extension point for a local high-quality voice later). */
export function getDefaultTtsAdapter(): TtsAdapter {
  return new WebSpeechTtsAdapter();
}
