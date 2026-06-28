import type {
  SttAdapter,
  SttSession,
  SttStartOptions,
  SttError,
  SttErrorCode,
  MicDevice,
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

/** Map a getUserMedia DOMException name to our stable codes. */
function mapMediaError(name: string): SttErrorCode {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError': return 'not-allowed';
    case 'NotFoundError':
    case 'OverconstrainedError': return 'unsupported';
    default: return 'unknown';
  }
}

/**
 * Acquire the mic via getUserMedia BEFORE handing off to SpeechRecognition.
 *
 * This is the fix for the "mic never captures in the desktop app" bug: in Tauri's WebView2 the
 * Web Speech API does NOT implicitly prompt for / hold the OS microphone permission the way it
 * does in a full Chrome build, so recog.start() silently produced nothing. Explicitly opening a
 * MediaStream here forces the WebView2 permission prompt, pins capture to the chosen device, and
 * turns a denied/absent mic into a real {@link SttError} instead of dead silence. The stream is
 * returned so the session can release it (and turn the mic-in-use light off) on stop/abort.
 */
async function acquireMicStream(deviceId?: string): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) {
    throw { code: 'unsupported', message: 'mediaDevices.getUserMedia is unavailable in this environment.' } satisfies SttError;
  }
  const audio: MediaTrackConstraints | boolean = deviceId ? { deviceId: { exact: deviceId } } : true;
  try {
    return await md.getUserMedia({ audio });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const code = mapMediaError(name);
    throw {
      code,
      message: code === 'not-allowed'
        ? 'Microphone access was denied. Enable it for this app in Windows Settings → Privacy → Microphone.'
        : `Could not open the microphone: ${name || String(e)}`,
    } satisfies SttError;
  }
}

/**
 * List selectable audio inputs for the device-picker menu. Labels are only populated after mic
 * permission has been granted (the OS hides them otherwise) — the picker requests a one-shot
 * stream first so the user sees real device names, not "Microphone 1/2".
 */
export async function enumerateMicrophones(): Promise<MicDevice[]> {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) return [];
  // Prime permission so labels are visible; ignore failure (we still return id-only entries).
  try {
    const probe = await md.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
  } catch { /* keep going — labels may be blank but ids are still useful */ }
  const devices = await md.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone' }));
}

export class WebSpeechAdapter implements SttAdapter {
  readonly id = 'web-speech';

  isAvailable(): boolean {
    // Need BOTH the recognizer and a way to acquire the mic. The recognizer constructor can
    // exist while capture is impossible (no getUserMedia) — reporting available in that case is
    // what made the button look live while silently failing.
    return getCtor() !== null && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async start(options?: SttStartOptions): Promise<SttSession> {
    const Ctor = getCtor();
    if (!Ctor) {
      const err: SttError = { code: 'unsupported', message: 'SpeechRecognition is not available in this environment.' };
      throw err;
    }

    // Pre-flight: hold the OS mic permission ourselves. This is what makes capture work in
    // WebView2 (where Web Speech does not implicitly prompt) and gives an honest error on denial.
    const stream = await acquireMicStream(options?.deviceId);
    const releaseStream = () => stream.getTracks().forEach((t) => t.stop());

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
      // Recognition ended → free the mic so the OS "in use" indicator clears.
      releaseStream();
      if (stopResolve) {
        stopResolve(finalTranscript.trim());
        stopResolve = null;
      }
    };

    try {
      recog.start();
    } catch (e) {
      releaseStream();
      const err: SttError = { code: 'unknown', message: `Could not start microphone: ${String(e)}` };
      throw err;
    }

    const session: SttSession = {
      stop() {
        if (aborted) return Promise.resolve(finalTranscript.trim());
        return new Promise<string>((resolve) => {
          stopResolve = resolve;
          // onend (fired by recog.stop) releases the stream and resolves; guard the throw path.
          try { recog.stop(); } catch { releaseStream(); resolve(finalTranscript.trim()); }
        });
      },
      abort() {
        aborted = true;
        stopResolve = null;
        try { recog.abort(); } catch { /* already stopped */ }
        releaseStream();
      },
    };
    return session;
  }
}

/** Shared default instance — the app's current STT engine. */
export const defaultSttAdapter: SttAdapter = new WebSpeechAdapter();
