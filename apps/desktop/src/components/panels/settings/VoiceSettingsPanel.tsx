import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, KeyRound, Loader2, Mic, Play, RefreshCw, Square, Trash2, Volume2 } from 'lucide-react';
import { SettingsCard, SettingsField, SettingsSection } from './SettingsShell.js';
import { enumerateMicrophones } from '../../../lib/voice/web-speech-adapter.js';
import { getServerSttStatus, recorderSttAdapter, saveServerSttKey, deleteServerSttKey, type ServerSttStatus } from '../../../lib/voice/recorder-stt-adapter.js';
import { loadVocabularyRaw, saveVocabularyRaw } from '../../../lib/voice/stt-vocabulary.js';
import { loadMicTriggerMode, saveMicTriggerMode, type MicTriggerMode } from '../../../lib/voice/mic-mode.js';
import {
  loadLivePreviewEnabled,
  loadSttQuality,
  saveLivePreviewEnabled,
  saveSttQuality,
  type SttQuality,
} from '../../../lib/voice/stt-quality.js';
import type { MicDevice, SttError } from '../../../lib/voice/stt-adapter.js';

const INPUT_KEY = 'vai-voice-device';
const OUTPUT_KEY = 'vai-voice-output';
const VIZ_KEY = 'vai-voice-viz';

/** How the live mic signal is drawn. */
type VizMode = 'bars' | 'wave' | 'pulse';
const VIZ_MODES: readonly { readonly id: VizMode; readonly label: string }[] = [
  { id: 'bars', label: 'Bars' },
  { id: 'wave', label: 'Wave' },
  { id: 'pulse', label: 'Pulse' },
];

/** Resolve the theme accent for canvas drawing (canvas can't read CSS vars directly). */
function readAccent(el: Element): string {
  const raw = getComputedStyle(el).getPropertyValue('--accent').trim();
  return raw || '#7c5cff';
}

/**
 * Draw one frame of the mic visualizer straight to canvas — imperative and
 * off the React render path, so it stays at display refresh rate no matter what
 * the component does. `freq` is byte frequency data, `time` byte time-domain,
 * `level` the current 0–1 loudness.
 */
function drawVisualizer(
  canvas: HTMLCanvasElement,
  freq: Uint8Array,
  time: Uint8Array,
  mode: VizMode,
  accent: string,
  level: number,
): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW === 0 || cssH === 0) return;
  const pxW = Math.round(cssW * dpr);
  const pxH = Math.round(cssH * dpr);
  if (canvas.width !== pxW) canvas.width = pxW;
  if (canvas.height !== pxH) canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (mode === 'wave') {
    // Oscilloscope: the raw waveform as a glowing centered line.
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const n = time.length;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * cssW;
      const y = cssH / 2 + ((time[i] - 128) / 128) * (cssH / 2) * 0.9;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    return;
  }

  if (mode === 'pulse') {
    // A single breathing orb + ring that swells with loudness.
    const cx = cssW / 2;
    const cy = cssH / 2;
    const unit = Math.min(cssW, cssH);
    const baseR = unit * 0.12;
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.3 + level * 0.5;
    ctx.lineWidth = 2 + level * 3;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 4 + level * 16;
    ctx.beginPath();
    ctx.arc(cx, cy, baseR + level * unit * 0.32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.5 + level * 0.5;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, baseR * (0.7 + level * 0.6), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    return;
  }

  // bars (default): a mirrored spectrum, brighter + glowier the louder each band.
  const barCount = Math.max(24, Math.min(64, Math.floor(cssW / 6)));
  const usable = Math.floor(freq.length * 0.7); // skip the mostly-empty high bins
  const gap = 2;
  const barW = (cssW - gap * (barCount - 1)) / barCount;
  ctx.shadowColor = accent;
  ctx.fillStyle = accent;
  for (let i = 0; i < barCount; i++) {
    const bin = Math.floor((i / barCount) * usable);
    const v = freq[bin] / 255;
    const barH = Math.max(2, v * cssH * 0.92);
    const x = i * (barW + gap);
    const y = (cssH - barH) / 2;
    ctx.globalAlpha = 0.3 + v * 0.7;
    ctx.shadowBlur = 6 * v;
    const r = Math.min(barW / 2, 3);
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, r);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, barW, barH);
    }
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

interface OutputDevice {
  readonly deviceId: string;
  readonly label: string;
}

type TestState = 'idle' | 'recording' | 'playing';
type TranscribeState =
  | { kind: 'idle' }
  | { kind: 'recording' }
  | { kind: 'transcribing' }
  | { kind: 'done'; text: string }
  | { kind: 'error'; message: string };

function loadStored(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}

function speechFallbackAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

async function enumerateOutputs(): Promise<OutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'audiooutput' && d.deviceId)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Speaker ${i + 1}` }));
}

function readError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? 'Voice failed.');
  }
  return String(error || 'Voice failed.');
}

export function VoiceSettingsPanel() {
  const [selectedInput, setSelectedInput] = useState(() => loadStored(INPUT_KEY));
  const [selectedOutput, setSelectedOutput] = useState(() => loadStored(OUTPUT_KEY));
  const [inputs, setInputs] = useState<MicDevice[]>([]);
  const [outputs, setOutputs] = useState<OutputDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [server, setServer] = useState<ServerSttStatus | null>(null);
  const [serverLoading, setServerLoading] = useState(true);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<TestState>('idle');
  const [transcribe, setTranscribe] = useState<TranscribeState>({ kind: 'idle' });
  // ── Bring-your-own transcription key ──────────────────────────────────────
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState<false | 'saving' | 'removing'>(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  // Personal dictation vocabulary (custom words the model tends to mishear).
  const [vocab, setVocab] = useState(() => loadVocabularyRaw());

  const [micTriggerMode, setMicTriggerMode] = useState<MicTriggerMode>(() => loadMicTriggerMode());
  const [sttQuality, setSttQuality] = useState<SttQuality>(() => loadSttQuality());
  const [livePreview, setLivePreview] = useState(() => loadLivePreviewEnabled());

  const [vizMode, setVizMode] = useState<VizMode>(() => {
    const stored = loadStored(VIZ_KEY);
    return stored === 'wave' || stored === 'pulse' ? stored : 'bars';
  });

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Read the live viz mode inside the animation loop without re-subscribing the mic.
  const vizModeRef = useRef<VizMode>(vizMode);
  vizModeRef.current = vizMode;
  const rafRef = useRef(0);

  const chooseViz = useCallback((mode: VizMode) => {
    setVizMode(mode);
    try { localStorage.setItem(VIZ_KEY, mode); } catch { /* non-fatal */ }
  }, []);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const transcriptionAbortRef = useRef<(() => void) | null>(null);

  const fallbackAvailable = useMemo(() => speechFallbackAvailable(), []);

  const chooseInput = useCallback((id: string) => {
    setSelectedInput(id);
    try { localStorage.setItem(INPUT_KEY, id); } catch { /* non-fatal */ }
    window.dispatchEvent(new CustomEvent('vai:voice-device-changed', { detail: id }));
  }, []);

  const chooseOutput = useCallback((id: string) => {
    setSelectedOutput(id);
    try { localStorage.setItem(OUTPUT_KEY, id); } catch { /* non-fatal */ }
  }, []);

  const refreshDevices = useCallback(async () => {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const [mics, speakers] = await Promise.all([enumerateMicrophones(), enumerateOutputs()]);
      setInputs(mics);
      setOutputs(speakers);
    } catch (error) {
      setDevicesError(readError(error));
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  const refreshServer = useCallback(async () => {
    setServerLoading(true);
    setServer(await getServerSttStatus(true));
    setServerLoading(false);
  }, []);

  const saveKey = useCallback(async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) { setKeyError('Enter a key first.'); return; }
    setKeyBusy('saving');
    setKeyError(null);
    try {
      await saveServerSttKey(trimmed);
      setKeyInput('');
      await refreshServer();
    } catch (error) {
      setKeyError(readError(error));
    } finally {
      setKeyBusy(false);
    }
  }, [keyInput, refreshServer]);

  const removeKey = useCallback(async () => {
    setKeyBusy('removing');
    setKeyError(null);
    try {
      await deleteServerSttKey();
      await refreshServer();
    } catch (error) {
      setKeyError(readError(error));
    } finally {
      setKeyBusy(false);
    }
  }, [refreshServer]);

  useEffect(() => {
    void refreshDevices();
    void refreshServer();
  }, [refreshDevices, refreshServer]);

  useEffect(() => {
    let alive = true;
    const bootMeter = async () => {
      setMicError(null);
      setLevel(0);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedInput ? { deviceId: { exact: selectedInput } } : true,
        });
        if (!alive) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const timeData = new Uint8Array(analyser.frequencyBinCount);
        const freqData = new Uint8Array(analyser.frequencyBinCount);
        let accent = canvasRef.current ? readAccent(canvasRef.current) : '#7c5cff';
        let lastBucket = -1;
        let frame = 0;
        const tick = () => {
          analyser.getByteTimeDomainData(timeData);
          analyser.getByteFrequencyData(freqData);
          let peak = 0;
          for (const value of timeData) peak = Math.max(peak, Math.abs(value - 128));
          const lvl = Math.min(1, peak / 96);
          // The canvas draws every frame; React only needs a coarse level for the
          // "Hearing input" tile, so we re-render only when the bucket changes.
          const bucket = Math.round(lvl * 20);
          if (bucket !== lastBucket) { lastBucket = bucket; setLevel(lvl); }
          const canvas = canvasRef.current;
          if (canvas) {
            if ((frame++ & 63) === 0) accent = readAccent(canvas); // pick up theme changes
            drawVisualizer(canvas, freqData, timeData, vizModeRef.current, accent, lvl);
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (error) {
        if (alive) setMicError(readError(error));
      }
    };
    void bootMeter();
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      void audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
    };
  }, [selectedInput]);

  const runPlaybackTest = useCallback(() => {
    if (playback === 'recording') {
      recorderRef.current?.stop();
      return;
    }
    if (playback === 'playing') {
      playerRef.current?.pause();
      setPlayback('idle');
      return;
    }
    const stream = streamRef.current;
    if (!stream) {
      setMicError('No microphone stream is active yet.');
      return;
    }
    try {
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const audio = new Audio(URL.createObjectURL(blob));
        playerRef.current = audio;
        const sinkable = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        const play = () => {
          setPlayback('playing');
          audio.onended = () => setPlayback('idle');
          void audio.play().catch(() => setPlayback('idle'));
        };
        if (selectedOutput && typeof sinkable.setSinkId === 'function') {
          sinkable.setSinkId(selectedOutput).then(play).catch(play);
        } else {
          play();
        }
      };
      recorder.start();
      setPlayback('recording');
      window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 4000);
    } catch (error) {
      setPlayback('idle');
      setMicError(readError(error));
    }
  }, [playback, selectedOutput]);

  const runTranscriptionTest = useCallback(async () => {
    if (!server?.configured) {
      setTranscribe({
        kind: 'error',
        message: server?.builtin?.error
          ?? server?.ollama?.error
          ?? 'Local speech-to-text is still starting. The first dictation downloads the built-in Whisper model, then stays offline.',
      });
      return;
    }
    if (!recorderSttAdapter.isAvailable()) {
      setTranscribe({ kind: 'error', message: 'This WebView cannot record microphone audio.' });
      return;
    }
    const errors: SttError[] = [];
    setTranscribe({ kind: 'recording' });
    try {
      const session = await recorderSttAdapter.start({
        deviceId: selectedInput || undefined,
        onError: (error) => { errors.push(error); },
      });
      transcriptionAbortRef.current = () => session.abort();
      window.setTimeout(() => {
        void (async () => {
          setTranscribe({ kind: 'transcribing' });
          const text = await session.stop();
          transcriptionAbortRef.current = null;
          if (text.trim()) setTranscribe({ kind: 'done', text: text.trim() });
          else setTranscribe({ kind: 'error', message: errors[0]?.message ?? 'No speech was captured.' });
        })();
      }, 3500);
    } catch (error) {
      transcriptionAbortRef.current = null;
      setTranscribe({ kind: 'error', message: readError(error) });
    }
  }, [selectedInput, server?.configured]);

  useEffect(() => () => {
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    playerRef.current?.pause();
    transcriptionAbortRef.current?.();
  }, []);

  return (
    <>
      <SettingsSection
        title="Voice input"
        description="Local-first dictation: your mic → built-in Whisper or Ollama → local cleanup. No API key required."
      >
        <SettingsCard className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <StatusTile
              icon={<Mic className="h-4 w-4" />}
              label="Microphone"
              value={micError ? 'Needs access' : level > 0.04 ? 'Hearing input' : 'Listening for signal'}
              tone={micError ? 'warn' : level > 0.04 ? 'good' : 'idle'}
            />
            <StatusTile
              icon={<Cloud className="h-4 w-4" />}
              label="Audio → text"
              value={serverLoading ? 'Checking' : server?.configured ? (server.engine ?? 'Local ready') : 'Starting up'}
              tone={serverLoading ? 'idle' : server?.configured ? 'good' : 'warn'}
            />
            <StatusTile
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Local cleanup"
              value={serverLoading ? 'Checking' : server?.cleanup?.configured ? (server.cleanup.engine ?? 'Ready') : 'Offline'}
              tone={serverLoading ? 'idle' : server?.cleanup?.configured ? 'good' : 'warn'}
            />
            <StatusTile
              icon={<Volume2 className="h-4 w-4" />}
              label="Fallback"
              value={fallbackAvailable ? 'Web Speech present' : 'No fallback'}
              tone={fallbackAvailable ? 'idle' : 'warn'}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-subheader)]">Input level</div>
              <div className="flex items-center gap-1.5">
                <div className="flex overflow-hidden rounded-md border border-[color:var(--border)]">
                  {VIZ_MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => chooseViz(m.id)}
                      aria-pressed={vizMode === m.id}
                      className={`px-2 py-1 text-[11px] transition-colors ${
                        vizMode === m.id
                          ? 'bg-[color:var(--accent-soft)] text-[color:var(--fg)]'
                          : 'text-[color:var(--color-muted)] hover:text-[color:var(--fg)]'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => { void refreshDevices(); void refreshServer(); }}
                  className="flex items-center gap-1.5 rounded-md border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--color-muted)] transition-colors hover:text-[color:var(--fg)]"
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </button>
              </div>
            </div>
            <canvas
              ref={canvasRef}
              className="h-16 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)]"
              aria-hidden
            />
            {level <= 0.04 && !micError && (
              <p className="mt-1.5 text-[11px] leading-4 text-[color:var(--color-muted)]">Speak, and the signal comes alive here.</p>
            )}
            {micError && <p className="mt-2 text-xs leading-5 text-amber-300">{micError}</p>}
          </div>

          <SettingsField label="Microphone">
            <div className="space-y-1.5">
              <DeviceButton label="System default" selected={selectedInput === ''} onClick={() => chooseInput('')} />
              {devicesLoading && <Hint>Listing devices...</Hint>}
              {devicesError && <Hint tone="warn">{devicesError}</Hint>}
              {!devicesLoading && inputs.length === 0 && <Hint>No microphones found.</Hint>}
              {inputs.map((device) => (
                <DeviceButton
                  key={device.deviceId}
                  label={device.label}
                  selected={selectedInput === device.deviceId}
                  onClick={() => chooseInput(device.deviceId)}
                />
              ))}
            </div>
          </SettingsField>

          <SettingsField
            label="Transcription accuracy"
            hint="All tiers run Whisper locally on CPU (verified accurate on this machine). Fast answers in about a second; Balanced uses Distil-Medium for near-Turbo accuracy at half the wait; Best runs Whisper Large-v3 Turbo (one-time ~600 MB download) and also prefers an installed Ollama transcription model."
          >
            <div className="flex gap-1.5">
              {([
                { id: 'fast' as const, label: 'Fast' },
                { id: 'balanced' as const, label: 'Balanced' },
                { id: 'best' as const, label: 'Best' },
              ]).map((tier) => (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() => { saveSttQuality(tier.id); setSttQuality(tier.id); }}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    sttQuality === tier.id
                      ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--fg)]'
                      : 'border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] text-[color:var(--color-muted)] hover:text-[color:var(--fg)]'
                  }`}
                >
                  {tier.label}
                </button>
              ))}
            </div>
          </SettingsField>

          <SettingsField
            label="Live word preview while speaking"
            hint="Shows fast draft words while you speak. Final text still comes from the recorder transcription on release."
          >
            <button
              type="button"
              onClick={() => {
                const next = !livePreview;
                saveLivePreviewEnabled(next);
                setLivePreview(next);
              }}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                livePreview
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--fg)]'
                  : 'border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] text-[color:var(--color-muted)] hover:text-[color:var(--fg)]'
              }`}
            >
              {livePreview ? 'On - fast draft while speaking' : 'Off - final text only on release'}
            </button>
          </SettingsField>

          <SettingsField label="Composer mic button" hint="Hold = press and keep talking. Toggle = click once to start, click again to finish.">
            <div className="flex gap-1.5">
              {(['hold', 'toggle'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { saveMicTriggerMode(mode); setMicTriggerMode(mode); }}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize transition-colors ${
                    micTriggerMode === mode
                      ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--fg)]'
                      : 'border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] text-[color:var(--color-muted)] hover:text-[color:var(--fg)]'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </SettingsField>

          <SettingsField label="Playback device" hint="Used only for the mic playback test.">
            <div className="space-y-1.5">
              <DeviceButton label="System default" selected={selectedOutput === ''} onClick={() => chooseOutput('')} />
              {outputs.map((device) => (
                <DeviceButton
                  key={device.deviceId}
                  label={device.label}
                  selected={selectedOutput === device.deviceId}
                  onClick={() => chooseOutput(device.deviceId)}
                />
              ))}
            </div>
          </SettingsField>

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={runPlaybackTest}
              className="flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-3 py-3 text-left text-sm text-[color:var(--fg)] transition-colors hover:border-[color:var(--selection-border)]"
            >
              {playback === 'recording'
                ? <Square className="h-4 w-4 text-red-400" />
                : playback === 'playing'
                  ? <Loader2 className="h-4 w-4 animate-spin text-[color:var(--accent)]" />
                  : <Play className="h-4 w-4 text-[color:var(--color-muted)]" />}
              <span>{playback === 'recording' ? 'Recording... click to stop' : playback === 'playing' ? 'Playing test...' : 'Record and play mic test'}</span>
            </button>

            <button
              type="button"
              onClick={() => void runTranscriptionTest()}
              disabled={transcribe.kind === 'recording' || transcribe.kind === 'transcribing'}
              className="flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-3 py-3 text-left text-sm text-[color:var(--fg)] transition-colors hover:border-[color:var(--selection-border)] disabled:cursor-wait disabled:opacity-60"
            >
              {transcribe.kind === 'recording' || transcribe.kind === 'transcribing'
                ? <Loader2 className="h-4 w-4 animate-spin text-[color:var(--accent)]" />
                : <Cloud className="h-4 w-4 text-[color:var(--color-muted)]" />}
              <span>{transcribe.kind === 'recording' ? 'Speak now...' : transcribe.kind === 'transcribing' ? 'Transcribing...' : 'Run transcription test'}</span>
            </button>
          </div>

          {transcribe.kind === 'done' && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-sm leading-6 text-[color:var(--fg)]">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Transcription worked
              </div>
              {transcribe.text}
            </div>
          )}
          {transcribe.kind === 'error' && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs leading-5 text-amber-200">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                Voice test failed
              </div>
              {transcribe.message}
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Custom words"
        description="Names and terms Vai tends to mishear — game titles, product names, people, jargon. When a dictation sounds like one of these, it's corrected to the exact spelling you write here. One per line, or comma-separated."
      >
        <SettingsCard className="space-y-2">
          <textarea
            value={vocab}
            onChange={(e) => { setVocab(e.target.value); saveVocabularyRaw(e.target.value); }}
            rows={4}
            placeholder={'League of Legends\nGitHub\nAnthropic\nyour-name'}
            spellCheck={false}
            className="w-full resize-y rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-3 py-2 text-sm text-[color:var(--fg)] outline-none placeholder:text-[color:var(--color-muted)] focus:border-[color:var(--accent)]"
          />
          <p className="text-[11px] leading-4 text-[color:var(--color-muted)]">
            The biggest accuracy win overall is the model tier — set Quality to Best for the sharpest transcription; custom words then fix the names it still misses.
          </p>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Optional cloud fallback"
        description="Not required. Vai already uses your local Whisper/Ollama stack. Add an OpenAI transcription key only if you want a cloud backup engine."
      >
        <SettingsCard className="space-y-3">
          {server?.userKeyConfigured ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-sm text-[color:var(--fg)]">
              <span className="flex items-center gap-2 text-emerald-200">
                <CheckCircle2 className="h-4 w-4" />
                Your key is saved and active.
              </span>
              <button
                type="button"
                onClick={() => void removeKey()}
                disabled={keyBusy !== false}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-60"
              >
                {keyBusy === 'removing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Remove key
              </button>
            </div>
          ) : (
            <>
              {server?.envKeyConfigured && (
                <p className="text-xs leading-5 text-[color:var(--color-muted)]">
                  A shared server key is currently in use. Adding your own key here overrides it for your account.
                </p>
              )}
              <SettingsField label="API key">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-3">
                    <KeyRound className="h-4 w-4 shrink-0 text-[color:var(--color-muted)]" />
                    <input
                      type="password"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void saveKey(); }}
                      placeholder="sk-..."
                      autoComplete="off"
                      spellCheck={false}
                      className="min-w-0 flex-1 bg-transparent py-2 text-sm text-[color:var(--fg)] outline-none placeholder:text-[color:var(--color-muted)]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveKey()}
                    disabled={keyBusy !== false || !keyInput.trim()}
                    className="flex items-center gap-1.5 rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent-soft)] px-3 py-2 text-sm text-[color:var(--fg)] transition-colors hover:opacity-90 disabled:opacity-50"
                  >
                    {keyBusy === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Save key
                  </button>
                </div>
              </SettingsField>
            </>
          )}
          {keyError && <p className="text-xs leading-5 text-amber-300">{keyError}</p>}
        </SettingsCard>
      </SettingsSection>

      {!serverLoading && (
        <SettingsSection title="Local voice stack">
          <SettingsCard className="space-y-2 text-xs leading-5 text-[color:var(--color-muted)]">
            <p>
              Raw speech uses
              <span className="mx-1 text-[color:var(--fg)]">{server?.builtin?.model ?? 'built-in Whisper'}</span>
              on first dictation (downloads once, then stays local). Optional Ollama upgrade:
              <span className="mx-1 font-mono text-[color:var(--fg)]">{server?.ollama?.pullHint ?? 'ollama pull whisper-large-v3-turbo'}</span>
            </p>
            <p>
              After raw text, cleanup runs through
              <span className="mx-1 text-[color:var(--fg)]">{server?.cleanup?.engine ?? 'local Ollama'}</span>
              {server?.cleanup?.configured ? '' : ' (start Ollama if this tile says Offline).'}
            </p>
            {server?.builtin?.error && (
              <p className="text-amber-300">Builtin Whisper: {server.builtin.error}</p>
            )}
            {server?.ollama?.error && !server?.ollama?.configured && (
              <p>{server.ollama.error}</p>
            )}
          </SettingsCard>
        </SettingsSection>
      )}
    </>
  );
}

function StatusTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'idle';
}) {
  const toneClass = tone === 'good'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
    : tone === 'warn'
      ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
      : 'border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] text-[color:var(--fg)]';
  return (
    <div className={`rounded-xl border px-3 py-3 ${toneClass}`}>
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-80">
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function DeviceButton({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
        selected
          ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--fg)]'
          : 'border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] text-[color:var(--color-muted)] hover:text-[color:var(--fg)]'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}

function Hint({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-xs ${tone === 'warn' ? 'text-amber-300' : 'text-[color:var(--color-muted)]'}`}>
      {children}
    </div>
  );
}

export default VoiceSettingsPanel;
