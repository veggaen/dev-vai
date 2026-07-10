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
): Promise<string> {
  const controller = new AbortController();
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
  }
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
    const stream = await acquireStream(options?.deviceId);
    const mimeType = pickMimeType();
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128_000 });
    let aborted = false;

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start(250); // timesliced so a crash mid-hold still has audio

    // Live loudness meter: drive a bouncing UI element while the user speaks. Purely
    // cosmetic — it reads the SAME stream, never touches the recorded audio, and any
    // failure here must not affect capture.
    let levelRaf = 0;
    let levelCtx: AudioContext | null = null;
    if (options?.onLevel) {
      try {
        levelCtx = new AudioContext();
        const analyser = levelCtx.createAnalyser();
        analyser.fftSize = 256;
        levelCtx.createMediaStreamSource(stream).connect(analyser);
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

    const release = () => {
      if (levelRaf) cancelAnimationFrame(levelRaf);
      void levelCtx?.close().catch(() => undefined);
      levelCtx = null;
      stream.getTracks().forEach((t) => t.stop());
    };

    // Live caption: periodically transcribe everything recorded so far, so the bubble
    // shows words while the user is still talking instead of just "Listening…". Best
    // effort and skippable — a slow/failed partial must never affect the final result.
    let partialTimer = 0;
    let partialKickoff = 0;
    if (PARTIAL_INTERVAL_MS > 0 && options?.onPartial) {
      let partialInFlight = false;
      let lastPartialText = '';
      const runPartial = () => {
        if (partialInFlight || aborted || chunks.length === 0) return;
        const snapshot = new Blob(chunks, { type: mimeType });
        if (snapshot.size < PARTIAL_MIN_BYTES) return;
        partialInFlight = true;
        // Fast model on localhost → cheap enough to run repeatedly while holding.
        void transcribe(snapshot, mimeType, options?.lang, PARTIAL_QUALITY)
          .then((text) => {
            const trimmed = text.trim();
            if (!aborted && trimmed && trimmed !== lastPartialText) {
              lastPartialText = trimmed;
              options.onPartial?.({ transcript: trimmed, isFinal: false });
            }
          })
          .catch(() => { /* interim is best-effort — the final transcript is authoritative */ })
          .finally(() => { partialInFlight = false; });
      };
      partialTimer = window.setInterval(runPartial, PARTIAL_INTERVAL_MS);
      partialKickoff = window.setTimeout(runPartial, PARTIAL_KICKOFF_MS);
    }

    const stopRecorder = (): Promise<void> => new Promise((resolve) => {
      if (recorder.state === 'inactive') { resolve(); return; }
      const done = () => resolve();
      recorder.onstop = done;
      // MediaRecorder.stop() can miss its onstop in edge cases — never hang the UI on it.
      window.setTimeout(done, 1_500);
      try { recorder.stop(); } catch { resolve(); }
    });

    return {
      stop: async (): Promise<string> => {
        if (partialTimer) window.clearInterval(partialTimer);
        if (partialKickoff) window.clearTimeout(partialKickoff);
        await stopRecorder();
        release();
        if (aborted) return '';
        const blob = new Blob(chunks, { type: mimeType });
        // Sub-250ms of audio is a tap, not speech — skip the round-trip.
        if (blob.size < 1_000) {
          options?.onError?.({ code: 'no-speech', message: 'No speech was captured.' });
          return '';
        }
        try {
          const text = await transcribe(blob, mimeType, options?.lang);
          if (!text) options?.onError?.({ code: 'no-speech', message: 'Nothing was transcribed.' });
          return text;
        } catch (e) {
          const err = (e && typeof e === 'object' && 'code' in e)
            ? e as SttError
            : { code: 'network', message: e instanceof Error ? e.message : String(e) } satisfies SttError;
          options?.onError?.(err);
          return '';
        }
      },
      abort: () => {
        aborted = true;
        if (partialTimer) window.clearInterval(partialTimer);
        if (partialKickoff) window.clearTimeout(partialKickoff);
        try { recorder.stop(); } catch { /* already stopped */ }
        release();
      },
    };
  }
}

export const recorderSttAdapter = new RecorderSttAdapter();
