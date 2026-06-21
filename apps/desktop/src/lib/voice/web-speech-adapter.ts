import type {
  SttAdapter,
  SttSession,
  SttStartOptions,
  SttError,
  SttErrorCode,
} from './stt-adapter.js';

/**
 * Zero-dependency STT adapter over the browser SpeechRecognition API.
 *
 * Present in the Tauri WebView2 (Chromium) on Windows, so it needs no extra
 * library or model download. It is the DEFAULT engine; swapping in a local
 * Whisper sidecar later means writing another {@link SttAdapter}, not touching
 * any caller. (Note: on Chromium this transcribes via a Google backend — fine
 * per the user's "doesn't need to be true-local" call, and isolated here so a
 * private engine can replace it cleanly.)
 */

// Minimal typings — the standard DOM lib does not ship SpeechRecognition.
interface SpeechRecognitionAlternative { readonly transcript: string }
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Map the engine's error strings to our stable codes. */
function mapError(raw: string): SttErrorCode {
  switch (raw) {
    case 'not-allowed':
    case 'service-not-allowed': return 'not-allowed';
    case 'no-speech': return 'no-speech';
    case 'aborted': return 'aborted';
    case 'network': return 'network';
    default: return 'unknown';
  }
}

export class WebSpeechAdapter implements SttAdapter {
  readonly id = 'web-speech';

  isAvailable(): boolean {
    return getCtor() !== null;
  }

  start(options?: SttStartOptions): Promise<SttSession> {
    const Ctor = getCtor();
    if (!Ctor) {
      const err: SttError = { code: 'unsupported', message: 'SpeechRecognition is not available in this environment.' };
      return Promise.reject(err);
    }

    const recog = new Ctor();
    recog.lang = options?.lang ?? 'en-US';
    recog.continuous = true;
    recog.interimResults = true;

    let finalTranscript = '';
    let stopResolve: ((value: string) => void) | null = null;
    let aborted = false;

    recog.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) finalTranscript += text;
        else interim += text;
      }
      options?.onPartial?.({
        transcript: (finalTranscript + interim).trim(),
        isFinal: interim.length === 0 && finalTranscript.length > 0,
      });
    };

    recog.onerror = (event) => {
      const code = mapError(event.error);
      // `no-speech`/`aborted` are normal session ends, not user-facing failures.
      if (code !== 'no-speech' && code !== 'aborted') {
        options?.onError?.({ code, message: `Speech recognition error: ${event.error}` });
      }
    };

    recog.onend = () => {
      if (stopResolve) {
        stopResolve(finalTranscript.trim());
        stopResolve = null;
      }
    };

    try {
      recog.start();
    } catch (e) {
      const err: SttError = { code: 'unknown', message: `Could not start microphone: ${String(e)}` };
      return Promise.reject(err);
    }

    const session: SttSession = {
      stop() {
        if (aborted) return Promise.resolve(finalTranscript.trim());
        return new Promise<string>((resolve) => {
          stopResolve = resolve;
          try { recog.stop(); } catch { resolve(finalTranscript.trim()); }
        });
      },
      abort() {
        aborted = true;
        stopResolve = null;
        try { recog.abort(); } catch { /* already stopped */ }
      },
    };
    return Promise.resolve(session);
  }
}

/** Shared default instance — the app's current STT engine. */
export const defaultSttAdapter: SttAdapter = new WebSpeechAdapter();
