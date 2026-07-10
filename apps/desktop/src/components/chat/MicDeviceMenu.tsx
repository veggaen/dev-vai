import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Mic, Volume2, Play, Square, Loader2, GraduationCap, Settings } from 'lucide-react';
import { VaiMark } from '../brand/VaiMark.js';
import '../../styles/voice-menu.css';
import { loadMicTriggerMode, saveMicTriggerMode, type MicTriggerMode } from '../../lib/voice/mic-mode.js';
import { enumerateMicrophones } from '../../lib/voice/web-speech-adapter.js';
import type { MicDevice } from '../../lib/voice/stt-adapter.js';
import { loadProfile, clearProfile, activeRules } from '../../lib/voice/speech-profile.js';

interface MicDeviceMenuProps {
  /** Anchor position (where the user right-clicked), in viewport coordinates. */
  readonly at: { x: number; y: number };
  /** Currently selected input device id ('' = system default). */
  readonly selectedId: string;
  readonly onSelect: (deviceId: string) => void;
  readonly onClose: () => void;
}

const OUTPUT_KEY = 'vai-voice-output';

interface OutDevice { deviceId: string; label: string }

async function enumerateOutputs(): Promise<OutDevice[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'audiooutput' && d.deviceId)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Speaker ${i + 1}` }));
}

/**
 * Right-click mic hovercard — the full voice control surface.
 *
 * Sections: input picker (with a LIVE level meter on the active mic so you can see it
 * hears you), output picker (persisted; playback routes through it via setSinkId), and a
 * record→playback mic test so you can hear exactly how you sound. Footer shows how many
 * corrections the speech profile has learned, with a reset.
 *
 * Per the UI rubric: dismiss on outside-click/Escape, animate transform+opacity only,
 * every row is a real button with an accessible label and a visible selected state.
 */
export function MicDeviceMenu({ at, selectedId, onSelect, onClose }: MicDeviceMenuProps) {
  const [inputs, setInputs] = useState<MicDevice[] | null>(null);
  const [outputs, setOutputs] = useState<OutDevice[]>([]);
  const [outputId, setOutputId] = useState<string>(() => {
    try { return localStorage.getItem(OUTPUT_KEY) ?? ''; } catch { return ''; }
  });
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [test, setTest] = useState<'idle' | 'recording' | 'playing'>('idle');
  const [learned, setLearned] = useState(() => activeRules(loadProfile()).length);
  const [micMode, setMicMode] = useState<MicTriggerMode>(() => loadMicTriggerMode());

  const ref = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);

  // ── Device lists ──
  useEffect(() => {
    let alive = true;
    Promise.all([enumerateMicrophones(), enumerateOutputs()])
      .then(([mics, outs]) => { if (alive) { setInputs(mics); setOutputs(outs); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not list devices.'); });
    return () => { alive = false; };
  }, []);

  // ── Live level meter on the selected mic ──
  useEffect(() => {
    let alive = true;
    const boot = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedId ? { deviceId: { exact: selectedId } } : true,
        });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, peak / 100));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (alive) setLevel(0);
      }
    };
    void boot();
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
    };
  }, [selectedId]);

  // ── Dismiss on outside-click / Escape ──
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const chooseOutput = useCallback((id: string) => {
    setOutputId(id);
    try { localStorage.setItem(OUTPUT_KEY, id); } catch { /* non-fatal */ }
  }, []);

  // ── Record → playback mic test ──
  const runTest = useCallback(() => {
    if (test === 'recording') { recorderRef.current?.stop(); return; }
    if (test === 'playing') { playerRef.current?.pause(); setTest('idle'); return; }
    const stream = streamRef.current;
    if (!stream) return;
    try {
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const audio = new Audio(URL.createObjectURL(blob));
        playerRef.current = audio;
        const sinkable = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        const play = () => {
          setTest('playing');
          audio.onended = () => setTest('idle');
          void audio.play().catch(() => setTest('idle'));
        };
        if (outputId && typeof sinkable.setSinkId === 'function') {
          sinkable.setSinkId(outputId).then(play).catch(play);
        } else {
          play();
        }
      };
      recorder.start();
      setTest('recording');
      // Auto-stop after 4s so a forgotten test never runs the mic hot.
      window.setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 4000);
    } catch {
      setTest('idle');
    }
  }, [test, outputId]);

  useEffect(() => () => { if (recorderRef.current?.stream) playerRef.current?.pause(); }, []);

  const resetLearned = useCallback(() => { clearProfile(); setLearned(0); }, []);

  // Clamp within the viewport so the card never opens off-screen.
  const style: React.CSSProperties = {
    left: Math.min(at.x, window.innerWidth - 312),
    top: Math.min(at.y, window.innerHeight - 430),
  };

  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        role="dialog"
        aria-label="Voice"
        className="vai-voice-menu fixed z-50 w-[300px] overflow-hidden rounded-2xl backdrop-blur-xl"
        style={style}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="vai-voice-menu__header flex items-center gap-2.5 px-3.5 py-3">
          <VaiMark size={22} variant="gradient" animated />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-[color:var(--fg,#f4f4f5)]">Voice</div>
            <div className="truncate text-[11px] text-[color:var(--color-muted,#a1a1aa)]">Mic, speakers &amp; dictation</div>
          </div>
        </div>

        <div className="p-1.5">
        {/* ── Microphone ── */}
        <SectionLabel icon={<Mic className="h-3 w-3" />} text="Microphone" />
        <div className="mx-3 mb-1.5 vai-voice-menu__meter" aria-hidden="true">
          <motion.div
            className="vai-voice-menu__meter-fill"
            animate={{ scaleX: Math.max(0.02, level) }}
            style={{ width: '100%' }}
            transition={{ duration: 0.08, ease: 'linear' }}
          />
        </div>
        <DeviceRow label="System default" selected={selectedId === ''} onClick={() => onSelect('')} />
        {inputs === null && !error && <Hint>Listing devices…</Hint>}
        {error && <Hint tone="error">{error}</Hint>}
        {inputs?.length === 0 && <Hint>No microphones found.</Hint>}
        {inputs?.map((d) => (
          <DeviceRow key={d.deviceId} label={d.label} selected={selectedId === d.deviceId} onClick={() => onSelect(d.deviceId)} />
        ))}

        {/* ── Speakers (playback for the mic test) ── */}
        <SectionLabel icon={<Volume2 className="h-3 w-3" />} text="Speakers" />
        <DeviceRow label="System default" selected={outputId === ''} onClick={() => chooseOutput('')} />
        {outputs.map((d) => (
          <DeviceRow key={d.deviceId} label={d.label} selected={outputId === d.deviceId} onClick={() => chooseOutput(d.deviceId)} />
        ))}

        {/* ── Mic test ── */}
        <div className="mx-1.5 mt-1.5 border-t border-white/[0.07] pt-1.5">
          <button
            type="button"
            onClick={runTest}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[color:var(--chat-body)] transition-colors hover:bg-white/[0.06]"
          >
            {test === 'recording'
              ? <Square className="h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
              : test === 'playing'
                ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--accent-text)]" aria-hidden="true" />
                : <Play className="h-3.5 w-3.5 shrink-0 text-[color:var(--chat-muted)]" aria-hidden="true" />}
            <span className="flex-1">
              {test === 'recording' ? 'Recording… click to stop' : test === 'playing' ? 'Playing back…' : 'Test mic — record & hear yourself'}
            </span>
            {test === 'recording' && (
              <motion.span
                className="h-2 w-2 rounded-full bg-red-400"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                aria-hidden="true"
              />
            )}
          </button>
        </div>

        {/* ── Mic button behavior ── */}
        <div className="mx-1.5 mt-1 border-t border-[color:var(--border)] px-1.5 py-2">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-muted)]">Mic button</div>
          <div className="vai-voice-menu__segment">
            {(['hold', 'toggle'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => { saveMicTriggerMode(mode); setMicMode(mode); }}
                className={`vai-voice-menu__segment-btn ${micMode === mode ? 'is-active' : 'text-[color:var(--color-muted)]'}`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="mx-1.5 border-t border-[color:var(--border)] px-1.5 py-1.5">
          <button
            type="button"
            onClick={() => {
              onClose();
              try { sessionStorage.setItem('vai-settings-tab', 'voice'); } catch { /* non-fatal */ }
              window.dispatchEvent(new CustomEvent('vai:open-voice-settings'));
            }}
            className="vai-voice-menu__row flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[color:var(--fg)]"
          >
            <Settings className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted)]" aria-hidden="true" />
            Voice settings
          </button>
        </div>

        {/* ── Learned speech profile ── */}
        <div className="mx-1.5 mt-1 flex items-center gap-2 border-t border-[color:var(--border)] px-1.5 py-2 text-[11px] text-[color:var(--color-muted)]">
          <GraduationCap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            {learned === 0 ? 'No learned corrections yet' : `${learned} learned correction${learned === 1 ? '' : 's'} auto-apply`}
          </span>
          {learned > 0 && (
            <button
              type="button"
              onClick={resetLearned}
              className="rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[color:var(--chat-muted)] transition-colors hover:bg-white/[0.06] hover:text-[color:var(--chat-body)]"
            >
              Reset
            </button>
          )}
        </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-[color:var(--chat-muted)]">
      {icon}
      {text}
    </div>
  );
}

function Hint({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div className={`px-3 py-1.5 text-xs ${tone === 'error' ? 'text-[color:var(--danger-text,#f88)]' : 'text-[color:var(--chat-muted)]'}`}>
      {children}
    </div>
  );
}

function DeviceRow({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={`vai-voice-menu__row flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
        selected ? 'is-selected text-[color:var(--fg)]' : 'text-[color:var(--fg)] opacity-90'
      }`}
    >
      <span className="flex-1 truncate">{label}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent-text)]" aria-hidden="true" />}
    </button>
  );
}

export default MicDeviceMenu;
