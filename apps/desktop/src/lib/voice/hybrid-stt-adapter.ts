import type { SttAdapter, SttSession, SttStartOptions } from './stt-adapter.js';
import { recorderSttAdapter } from './recorder-stt-adapter.js';
import { loadLivePreviewEnabled } from './stt-quality.js';

/**
 * Recorder-first dictation with LOCAL Whisper live preview.
 *
 * While the key is held, the recorder re-transcribes the audio so far on a short
 * cadence with the fast base.en model — words stream into the overlay as you speak
 * (Wispr-style). The accurate final pass at the chosen quality runs on release and
 * is always authoritative. Web Speech is no longer used: it is unreliable in
 * WebView2 (drops/garbles words), which is exactly what made live text feel broken.
 *
 * Live preview honours {@link loadLivePreviewEnabled}: when the user turns it off,
 * partials are suppressed and only the final transcript is delivered.
 */
class HybridSttAdapter implements SttAdapter {
  readonly id = 'hybrid-preview-recorder';

  isAvailable(): boolean {
    return recorderSttAdapter.isAvailable();
  }

  async start(options?: SttStartOptions): Promise<SttSession> {
    const previewEnabled = loadLivePreviewEnabled();
    return recorderSttAdapter.start({
      lang: options?.lang,
      deviceId: options?.deviceId,
      // Stream local-Whisper partials only when live preview is on.
      onPartial: previewEnabled ? options?.onPartial : undefined,
      // The mic-level meter is always live — it's the primary "listening" affordance.
      onLevel: options?.onLevel,
      onError: options?.onError,
    });
  }
}

export const hybridSttAdapter = new HybridSttAdapter();
