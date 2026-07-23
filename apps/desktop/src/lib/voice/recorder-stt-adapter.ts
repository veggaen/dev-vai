import type {
  SttAdapter,
  SttSession,
  SttStartOptions,
  SttError,
} from './stt-adapter.js';
import { apiFetch } from '../api.js';
import { buildMicConstraints } from './audio-constraints.js';
import { prepareTranscribePayload } from './audio-pcm.js';
import { builtinModelForQuality, loadSttQuality, type SttQuality } from './stt-quality.js';
import { loadVocabulary } from './stt-vocabulary.js';

/**
 * Recorder STT adapter — the reliable engine for the desktop app.
 *
 * Records mic audio with MediaRecorder (webm/opus) and transcribes it through
 * the runtime's `/api/stt/transcribe` (local Whisper / Ollama / optional cloud). This
 * replaces WebView2's SpeechRecognition as the primary engine because that API
 * is broken inside Tauri (sessions that never end, silent empty transcripts) —
 * the "Transcribing… forever" bug.
 *
 * Tradeoff vs Web Speech: no word-by-word interim transcript while speaking
 * (the recorder shows a level-driven "listening" state instead), in exchange
 * for transcription that actually completes, with real errors. The composite
 * adapter below still uses Web Speech for live preview WHEN it works, but the
 * recorded audio is always the source of truth.
 */

/** First local Whisper load can take a while (turbo is a one-time ~600 MB download
 * + session init) — dictation must not abort too early. Warm loads answer in seconds. */
const TRANSCRIBE_TIMEOUT_MS = 180_000;
/**
 * Live streaming partials: re-transcribe everything recorded so far on this cadence
 * so words appear in the overlay AS YOU SPEAK (Wispr-style), instead of only on
 * release. Self-throttled — a slow pass skips the next tick — so it can't back up.
 */
const PARTIAL_INTERVAL_MS = 1_300;
/** First partial fires fast so the very first words show almost immediately. */
const PARTIAL_KICKOFF_MS = 500;
/** Skip partials until there's enough audio to be worth a pass (~sub-quarter-second). */
const PARTIAL_MIN_BYTES = 2_400;
/** Partials always use the FAST model (base.en ≈ 0.9s) regardless of the final quality —
 *  live text must be snappy; the accurate final still runs at the chosen quality on release. */
const PARTIAL_QUALITY = 'fast' as const;
/** Bound each encoded blob and transcribe completed speech while a long hold continues. */
const LONG_HOLD_SEGMENT_MS = 45_000;

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'audio/webm';
}


async function acquireStream(deviceId?: string): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) {
    throw { code: 'unsupported', message: 'mediaDevices.getUserMedia is unavailable.' } satisfies SttError;
  }
  try {
    try {
      return await md.getUserMedia(buildMicConstraints(deviceId));
    } catch {
      return await md.getUserMedia(buildMicConstraints());
    }
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const notAllowed = name === 'NotAllowedError' || name === 'SecurityError';
    throw {
      code: notAllowed ? 'not-allowed' : 'unknown',
      message: notAllowed
        ? 'Microphone access was denied. Enable it in Windows Settings → Privacy → Microphone.'
        : `Could not open the microphone: ${name || String(e)}`,
    } satisfies SttError;
  }
}

async function transcribe(
  blob: Blob,
  mimeType: string,
  lang?: string,
  quality: SttQuality = loadSttQuality(),
  externalSignal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = window.setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
  const language = lang ?? 'en-US';
  try {
    const payload = await prepareTranscribePayload(blob, mimeType);
    const response = await apiFetch('/api/stt/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: payload.data,
        mimeType: payload.mimeType,
        language,
        quality,
        model: builtinModelForQuality(quality, language),
        preferOllama: quality === 'best',
        // Decode-time biasing for prompt-capable engines (cloud/Ollama); the
        // builtin path ignores it and keeps cleanup-layer vocab restoration.
        vocabulary: loadVocabulary(),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
      throw {
        code: response.status === 501 ? 'unsupported' : 'network',
        message: body.error ?? `Transcription failed (HTTP ${response.status})`,
      } satisfies SttError;
    }
    const parsed = await response.json() as { text?: string };
    return (parsed.text ?? '').trim();
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Join independently decoded long-hold segments without inventing punctuation. */
export function mergeTranscriptionSegments(segments: readonly string[]): string {
  return segments.map((segment) => segment.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export interface ServerSttStatus {
  readonly configured: boolean;
  readonly engine: string | null;
  readonly source?: 'builtin' | 'ollama' | 'cloud' | null;
  readonly builtin?: {
    readonly configured: boolean;
    readonly engine: string;
    readonly model: string;
    readonly error?: string;
  };
  readonly ollama?: {
    readonly configured: boolean;
    readonly engine: string | null;
    readonly model: string | null;
    readonly pullHint: string;
    readonly error?: string;
  };
  readonly cloud?: {
    readonly configured: boolean;
    readonly engine: string | null;
    readonly userKeyConfigured?: boolean;
    readonly envKeyConfigured?: boolean;
  };
  /** The signed-in user has stored their OWN transcription key. */
  readonly userKeyConfigured?: boolean;
  /** The operator set a server-wide env key (user relies on it, cannot remove it). */
  readonly envKeyConfigured?: boolean;
  readonly envFile?: string | null;
  readonly cleanup?: {
    readonly configured: boolean;
    readonly engine: string | null;
    readonly error?: string;
  };
  readonly error?: string;
}

/** Whether the runtime has a transcription engine configured (short TTL cache). */
let serverStatus: { value: ServerSttStatus; checkedAt: number } | null = null;
const SERVER_STATUS_TTL_MS = 5_000;

export async function getServerSttStatus(force = false): Promise<ServerSttStatus> {
  if (!force && serverStatus && Date.now() - serverStatus.checkedAt < SERVER_STATUS_TTL_MS) {
    return serverStatus.value;
  }
  try {
    const response = await apiFetch('/api/stt/status');
    const body = await response.json() as Partial<ServerSttStatus>;
    serverStatus = {
      value: {
        configured: Boolean(body.configured),
        engine: typeof body.engine === 'string' ? body.engine : null,
        source: body.source === 'builtin' || body.source === 'ollama' || body.source === 'cloud' ? body.source : null,
        builtin: body.builtin && typeof body.builtin === 'object'
          ? {
              configured: Boolean(body.builtin.configured),
              engine: typeof body.builtin.engine === 'string' ? body.builtin.engine : 'builtin',
              model: typeof body.builtin.model === 'string' ? body.builtin.model : '',
              error: typeof body.builtin.error === 'string' ? body.builtin.error : undefined,
            }
          : undefined,
        ollama: body.ollama && typeof body.ollama === 'object'
          ? {
              configured: Boolean(body.ollama.configured),
              engine: typeof body.ollama.engine === 'string' ? body.ollama.engine : null,
              model: typeof body.ollama.model === 'string' ? body.ollama.model : null,
              pullHint: typeof body.ollama.pullHint === 'string' ? body.ollama.pullHint : 'ollama pull whisper-large-v3-turbo',
              error: typeof body.ollama.error === 'string' ? body.ollama.error : undefined,
            }
          : undefined,
        cloud: body.cloud && typeof body.cloud === 'object'
          ? {
              configured: Boolean(body.cloud.configured),
              engine: typeof body.cloud.engine === 'string' ? body.cloud.engine : null,
              userKeyConfigured: Boolean(body.cloud.userKeyConfigured),
              envKeyConfigured: Boolean(body.cloud.envKeyConfigured),
            }
          : undefined,
        userKeyConfigured: Boolean(body.userKeyConfigured),
        envKeyConfigured: Boolean(body.envKeyConfigured),
        envFile: typeof body.envFile === 'string' ? body.envFile : null,
        cleanup: body.cleanup && typeof body.cleanup === 'object'
          ? {
              configured: Boolean(body.cleanup.configured),
              engine: typeof body.cleanup.engine === 'string' ? body.cleanup.engine : null,
              error: typeof body.cleanup.error === 'string' ? body.cleanup.error : undefined,
            }
          : undefined,
      },
      checkedAt: Date.now(),
    };
  } catch {
    serverStatus = {
      value: {
        configured: false,
        engine: null,
        error: 'Runtime STT status is unreachable.',
      },
      checkedAt: Date.now(),
    };
  }
  return serverStatus.value;
}

export async function isServerSttConfigured(force = false): Promise<boolean> {
  return (await getServerSttStatus(force)).configured;
}

/** Save the current user's own transcription API key. Invalidates the status cache. */
export async function saveServerSttKey(apiKey: string): Promise<void> {
  const response = await apiFetch('/api/stt/key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Could not save key (HTTP ${response.status})`);
  }
  serverStatus = null; // force the next status read to reflect the new key
}

/** Remove the current user's own transcription API key. Invalidates the status cache. */
export async function deleteServerSttKey(): Promise<void> {
  const response = await apiFetch('/api/stt/key', { method: 'DELETE' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Could not remove key (HTTP ${response.status})`);
  }
  serverStatus = null;
}

export class RecorderSttAdapter implements SttAdapter {
  readonly id = 'recorder-server';

  isAvailable(): boolean {
    return typeof MediaRecorder !== 'undefined'
      && typeof navigator !== 'undefined'
      && !!navigator.mediaDevices?.getUserMedia;
  }

  async start(options?: SttStartOptions): Promise<SttSession> {
    let stream = await acquireStream(options?.deviceId);
    const mimeType = pickMimeType();
    const finalQuality = options?.quality ?? loadSttQuality();
    const captureCtx = new AudioContext();
    const captureDestination = captureCtx.createMediaStreamDestination();
    let captureSource = captureCtx.createMediaStreamSource(stream);
    captureSource.connect(captureDestination);
    await captureCtx.resume().catch(() => undefined);
    const graphActive = captureCtx.state === 'running';
    const recorderStream = graphActive ? captureDestination.stream : stream;
    type CaptureSegment = { recorder: MediaRecorder; chunks: Blob[] };
    const createCaptureSegment = (): CaptureSegment => {
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(recorderStream, { mimeType, audioBitsPerSecond: 128_000 });
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      return { recorder, chunks };
    };
    let activeCapture: CaptureSegment | null = createCaptureSegment();
    let aborted = false;
    let finalizing = false;

    activeCapture.recorder.start(250); // timesliced so a crash mid-hold still has audio

    // Live loudness meter: drive a bouncing UI element while the user speaks. Purely
    // cosmetic — it reads the SAME stream, never touches the recorded audio, and any
    // failure here must not affect capture.
    let levelRaf = 0;
    let levelAnalyser: AnalyserNode | null = null;
    if (options?.onLevel) {
      try {
        const analyser = captureCtx.createAnalyser();
        levelAnalyser = analyser;
        analyser.fftSize = 256;
        captureSource.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        let lastEmit = 0;
        const loop = () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          const now = performance.now();
          if (now - lastEmit > 45) { // ~22fps — smooth without flooding IPC
            lastEmit = now;
            options.onLevel?.(Math.min(1, peak / 96));
          }
          levelRaf = requestAnimationFrame(loop);
        };
        loop();
      } catch { /* metering is cosmetic — ignore */ }
    }

    // MediaRecorder consumes a stable AudioContext destination, allowing the
    // physical microphone to be replaced mid-hold without losing earlier chunks.
    let captureReleased = false;
    let deviceSwitchInFlight = false;
    let desiredDeviceId = options?.deviceId;
    const switchInput = async (nextDeviceId?: string) => {
      if (captureReleased || deviceSwitchInFlight) return;
      if (!graphActive) {
        options?.onError?.({
          code: 'unknown',
          message: 'Microphone changed during this hold. Release and hold again to use the new device.',
        });
        return;
      }
      deviceSwitchInFlight = true;
      try {
        const nextStream = await acquireStream(nextDeviceId);
        if (captureReleased) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        const nextSource = captureCtx.createMediaStreamSource(nextStream);
        nextSource.connect(captureDestination);
        if (levelAnalyser) nextSource.connect(levelAnalyser);
        for (const track of stream.getTracks()) track.onended = null;
        captureSource.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        stream = nextStream;
        captureSource = nextSource;
        armTrackEnd();
      } catch (error) {
        options?.onError?.({
          code: 'unknown',
          message: `Microphone changed, but Vai could not reconnect: ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        deviceSwitchInFlight = false;
        // Coalesce rapid picker/devicechange events. If another device was chosen
        // while getUserMedia was still opening, immediately perform the newest
        // request instead of silently leaving the intermediate microphone active.
        if (!captureReleased && desiredDeviceId !== nextDeviceId) {
          void switchInput(desiredDeviceId);
        }
      }
    };
    const armTrackEnd = () => {
      for (const track of stream.getAudioTracks()) {
        track.onended = () => { void switchInput(desiredDeviceId); };
      }
    };
    const onSelectedDeviceChanged = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      desiredDeviceId = typeof detail === 'string' && detail ? detail : undefined;
      void switchInput(desiredDeviceId);
    };
    const onSystemDeviceChanged = () => {
      if (stream.getAudioTracks().some((track) => track.readyState === 'ended')) {
        void switchInput(desiredDeviceId);
      }
    };
    armTrackEnd();
    window.addEventListener('vai:voice-device-changed', onSelectedDeviceChanged);
    navigator.mediaDevices.addEventListener?.('devicechange', onSystemDeviceChanged);

    const release = () => {
      captureReleased = true;
      window.removeEventListener('vai:voice-device-changed', onSelectedDeviceChanged);
      navigator.mediaDevices.removeEventListener?.('devicechange', onSystemDeviceChanged);
      if (levelRaf) cancelAnimationFrame(levelRaf);
      levelAnalyser?.disconnect();
      levelAnalyser = null;
      captureSource.disconnect();
      for (const track of stream.getTracks()) track.onended = null;
      stream.getTracks().forEach((t) => t.stop());
      captureDestination.stream.getTracks().forEach((t) => t.stop());
      void captureCtx.close().catch(() => undefined);
    };

    // Live caption: periodically transcribe everything recorded so far, so the bubble
    // shows words while the user is still talking instead of just "Listening…". Best
    // effort and skippable — a slow/failed partial must never affect the final result.
    let partialTimer = 0;
    let partialKickoff = 0;
    let partialAbort: AbortController | null = null;
    let partialTask: Promise<void> = Promise.resolve();
    const segmentTexts: string[] = [];
    let segmentTranscriptionPending = 0;
    if (PARTIAL_INTERVAL_MS > 0 && options?.onPartial) {
      let partialInFlight = false;
      let lastPartialText = '';
      const runPartial = () => {
        const capture = activeCapture;
        if (partialInFlight || segmentTranscriptionPending > 0 || aborted || !capture || capture.chunks.length === 0) return;
        const snapshot = new Blob(capture.chunks, { type: mimeType });
        if (snapshot.size < PARTIAL_MIN_BYTES) return;
        partialInFlight = true;
        partialAbort = new AbortController();
        // Fast model on localhost → cheap enough to run repeatedly while holding.
        partialTask = transcribe(snapshot, mimeType, options?.lang, PARTIAL_QUALITY, partialAbort.signal)
          .then((text) => {
            const trimmed = text.trim();
            const combined = mergeTranscriptionSegments([...segmentTexts, trimmed]);
            if (!aborted && combined && combined !== lastPartialText) {
              lastPartialText = combined;
              options.onPartial?.({ transcript: combined, isFinal: false });
            }
          })
          .catch(() => { /* interim is best-effort — the final transcript is authoritative */ })
          .finally(() => { partialInFlight = false; partialAbort = null; });
      };
      partialTimer = window.setInterval(runPartial, PARTIAL_INTERVAL_MS);
      partialKickoff = window.setTimeout(runPartial, PARTIAL_KICKOFF_MS);
    }

    const stopRecorder = (capture: CaptureSegment): Promise<void> => new Promise((resolve) => {
      if (capture.recorder.state === 'inactive') { resolve(); return; }
      const done = () => resolve();
      capture.recorder.onstop = done;
      // MediaRecorder.stop() can miss its onstop in edge cases — never hang the UI on it.
      window.setTimeout(done, 250);
      try { capture.recorder.stop(); } catch { resolve(); }
    });

    let segmentError: SttError | null = null;
    let transcriptionQueue = Promise.resolve();
    const asSttError = (error: unknown): SttError => (
      error && typeof error === 'object' && 'code' in error
        ? error as SttError
        : { code: 'network', message: error instanceof Error ? error.message : String(error) }
    );
    const enqueueSegment = (capture: CaptureSegment) => {
      const blob = new Blob(capture.chunks, { type: mimeType });
      if (blob.size < 1_000) return;
      segmentTranscriptionPending += 1;
      transcriptionQueue = transcriptionQueue.then(async () => {
        if (aborted) return;
        try {
          const text = await transcribe(blob, mimeType, options?.lang, finalQuality);
          if (text.trim()) segmentTexts.push(text.trim());
        } catch (error) {
          const sttError = asSttError(error);
          if (sttError.code !== 'no-speech') segmentError ??= sttError;
        }
      }).finally(() => { segmentTranscriptionPending -= 1; });
    };

    // Keep long holds bounded. Completed segments transcribe serially while the
    // microphone continues, respecting the one-heavy-GPU-task rule.
    let rotationQueue = Promise.resolve();
    const rotateCapture = () => {
      rotationQueue = rotationQueue.then(async () => {
        if (finalizing || aborted || !activeCapture) return;
        partialAbort?.abort();
        await partialTask;
        const finished = activeCapture;
        activeCapture = null;
        await stopRecorder(finished);
        enqueueSegment(finished);
        if (!finalizing && !aborted) {
          activeCapture = createCaptureSegment();
          activeCapture.recorder.start(250);
        }
      });
    };
    const rotationTimer = window.setInterval(rotateCapture, LONG_HOLD_SEGMENT_MS);

    return {
      stop: async (): Promise<string> => {
        finalizing = true;
        window.clearInterval(rotationTimer);
        if (partialTimer) window.clearInterval(partialTimer);
        if (partialKickoff) window.clearTimeout(partialKickoff);
        partialAbort?.abort();
        await partialTask;
        await rotationQueue;
        if (activeCapture) {
          const finished = activeCapture;
          activeCapture = null;
          await stopRecorder(finished);
          enqueueSegment(finished);
        }
        release();
        if (aborted) return '';
        await transcriptionQueue;
        const text = mergeTranscriptionSegments(segmentTexts);
        if (text) return text;
        options?.onError?.(segmentError ?? { code: 'no-speech', message: 'No speech was captured.' });
        return '';
      },
      abort: () => {
        aborted = true;
        finalizing = true;
        window.clearInterval(rotationTimer);
        if (partialTimer) window.clearInterval(partialTimer);
        if (partialKickoff) window.clearTimeout(partialKickoff);
        partialAbort?.abort();
        try { activeCapture?.recorder.stop(); } catch { /* already stopped */ }
        activeCapture = null;
        release();
      },
    };
  }
}

export const recorderSttAdapter = new RecorderSttAdapter();
