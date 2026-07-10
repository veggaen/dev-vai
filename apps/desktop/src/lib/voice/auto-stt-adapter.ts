import type { SttAdapter, SttSession, SttStartOptions } from './stt-adapter.js';
import { WebSpeechAdapter } from './web-speech-adapter.js';
import { hybridSttAdapter } from './hybrid-stt-adapter.js';
import { recorderSttAdapter, getServerSttStatus } from './recorder-stt-adapter.js';

/**
 * Engine picker: hybrid live preview + local Whisper final when the runtime
 * has STT configured; otherwise Web Speech alone in a plain browser.
 */
class AutoSttAdapter implements SttAdapter {
  readonly id = 'auto';
  private readonly webSpeech = new WebSpeechAdapter();

  isAvailable(): boolean {
    return recorderSttAdapter.isAvailable() || this.webSpeech.isAvailable();
  }

  async start(options?: SttStartOptions): Promise<SttSession> {
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const server = recorderSttAdapter.isAvailable()
      ? await getServerSttStatus()
      : { configured: false };
    if (recorderSttAdapter.isAvailable() && (isTauri || server.configured)) {
      return hybridSttAdapter.start(options);
    }
    if (!this.webSpeech.isAvailable()) {
      throw {
        code: 'unsupported',
        message: server.configured === false
          ? 'Local speech-to-text is not ready yet, and Web Speech is unavailable in this shell.'
          : 'No speech-to-text engine is available.',
      };
    }
    return this.webSpeech.start(options);
  }
}

export const autoSttAdapter: SttAdapter = new AutoSttAdapter();
