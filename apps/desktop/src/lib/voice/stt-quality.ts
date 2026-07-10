/**
 * Dictation accuracy vs speed — persisted locally.
 *
 * Wispr-Flow defaults: NO text while holding (level bars only) and the fast
 * model on release, so the final transcript lands in ~1s. Live preview and
 * higher-accuracy tiers remain opt-in via Settings → Voice.
 */

export type SttQuality = 'fast' | 'balanced' | 'best';

const QUALITY_KEY = 'vai-voice-stt-quality';
const PREVIEW_KEY = 'vai-voice-live-preview';

export function loadSttQuality(): SttQuality {
  try {
    const stored = localStorage.getItem(QUALITY_KEY);
    if (stored === 'fast' || stored === 'balanced' || stored === 'best') return stored;
  } catch { /* non-fatal */ }
  // Fast by default: release-to-text in about a second (Wispr-Flow feel). The
  // background polish pass still upgrades wording after the words have landed.
  return 'fast';
}

export function saveSttQuality(quality: SttQuality): void {
  try {
    localStorage.setItem(QUALITY_KEY, quality);
  } catch { /* non-fatal */ }
  window.dispatchEvent(new CustomEvent('vai:voice-stt-quality-changed', { detail: quality }));
}

/** ONNX model id sent to the runtime for built-in Whisper.
 *  Measured warm CPU latency for a ~4.5s utterance (RTX 3080 Ti box, 2026-07):
 *  base.en 0.9s · distil-medium.en 4.4s · large-v3-turbo(q4) 9.1s — all 0% WER
 *  on the probe sentence. DirectML GPU is intentionally unused (garbage output). */
export function builtinModelForQuality(quality: SttQuality, language = 'en-US'): string {
  const english = language.toLowerCase().startsWith('en');
  switch (quality) {
    case 'fast':
      // Sub-second responses — dictation feels instant.
      return english ? 'onnx-community/whisper-base.en' : 'Xenova/whisper-small';
    case 'best':
      // Maximum accuracy — near large-v3 WER with a 4-layer decoder.
      return 'onnx-community/whisper-large-v3-turbo';
    default:
      // Balanced: distil-medium.en ≈ turbo accuracy on clean English speech at
      // half the latency. Multilingual speakers get turbo (distil is en-only).
      return english ? 'distil-whisper/distil-medium.en' : 'onnx-community/whisper-large-v3-turbo';
  }
}

export function loadLivePreviewEnabled(): boolean {
  try {
    const stored = localStorage.getItem(PREVIEW_KEY);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    /* non-fatal */
  }
  // OFF by default (Wispr-Flow behavior): while the chord is held only the mic
  // level bars show — no draft words. Re-transcribing the whole recording every
  // ~1.3s also stalled the UI thread on long holds (the base64 re-encode grows
  // with the recording), which tripped the chord watchdog and truncated speech.
  return false;
}

export function saveLivePreviewEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PREVIEW_KEY, enabled ? '1' : '0');
  } catch { /* non-fatal */ }
  window.dispatchEvent(new CustomEvent('vai:voice-live-preview-changed', { detail: enabled }));
}
