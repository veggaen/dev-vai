import { useCallback, useEffect, useRef, useState } from 'react';
import type { SttAdapter, SttSession, SttError } from '../lib/voice/stt-adapter.js';
import { defaultSttAdapter } from '../lib/voice/web-speech-adapter.js';
import {
  applyProfile,
  loadProfile,
  prettifyTranscript,
  type AppliedReplacement,
} from '../lib/voice/speech-profile.js';

export type DictationStatus = 'idle' | 'listening' | 'transcribing' | 'error' | 'unsupported';

export interface DictationMeta {
  /** The raw transcript exactly as the engine heard it (pre-groom). */
  readonly raw: string;
  /** Speech-profile rules that auto-applied — needed for self-heal learning at send. */
  readonly applied: readonly AppliedReplacement[];
}

export interface UseVoiceDictationOptions {
  /** Receives the live (interim) transcript while listening — for a preview. */
  readonly onInterim?: (text: string) => void;
  /**
   * Receives the final transcript on release — GROOMED: the user's learned speech
   * profile is applied first (auto-corrections they've taught us), then the
   * deterministic prettify pass (casing, punctuation, fillers). `meta` carries the
   * raw text + applied rules so the caller can feed the correction learner.
   */
  readonly onFinal: (text: string, meta?: DictationMeta) => void;
  readonly onError?: (error: SttError) => void;
  /** Engine override (defaults to the zero-dep Web Speech adapter). */
  readonly adapter?: SttAdapter;
  readonly lang?: string;
  /** Preferred mic (from the device picker). Omit to use the system default. */
  readonly deviceId?: string;
  /**
   * Hold-to-talk hotkey. Default: Alt+Meta (Win) held together — Wispr-Flow style.
   * The Win key alone is unreliable in a webview, so we gate on BOTH modifiers.
   */
  readonly holdChord?: (e: KeyboardEvent) => boolean;
  /** Don't start dictation while a turn is streaming (composer is busy steering). */
  readonly disabled?: boolean;
}

const defaultHoldChord = (e: KeyboardEvent): boolean => e.altKey && e.metaKey;

/**
 * Hold-to-talk voice dictation for the composer.
 *
 * Press-and-hold the hotkey (or the mic button) → mic opens and the live
 * transcript streams; release → the final transcript is handed to `onFinal` for
 * insertion. Escape aborts without inserting. Engine-agnostic (see SttAdapter) so
 * the browser SpeechRecognition default can be swapped for a local/private engine
 * with no change here or in the UI.
 */
export function useVoiceDictation(options: UseVoiceDictationOptions) {
  const { onInterim, onFinal, onError, adapter = defaultSttAdapter, lang, deviceId, holdChord = defaultHoldChord, disabled = false } = options;
  const [status, setStatus] = useState<DictationStatus>(() => (adapter.isAvailable() ? 'idle' : 'unsupported'));
  const sessionRef = useRef<SttSession | null>(null);
  const startingRef = useRef(false);
  // Keep latest callbacks without re-binding the global key listeners each render.
  const cbRef = useRef({ onInterim, onFinal, onError });
  cbRef.current = { onInterim, onFinal, onError };

  const supported = adapter.isAvailable();

  const start = useCallback(async () => {
    if (disabled || !supported) return;
    if (sessionRef.current || startingRef.current) return; // already listening
    startingRef.current = true;
    setStatus('listening');
    try {
      const session = await adapter.start({
        lang,
        deviceId,
        onPartial: (p) => cbRef.current.onInterim?.(p.transcript),
        onError: (err) => {
          cbRef.current.onError?.(err);
          setStatus('error');
        },
      });
      sessionRef.current = session;
    } catch (e) {
      cbRef.current.onError?.(e as SttError);
      setStatus(supported ? 'error' : 'unsupported');
    } finally {
      startingRef.current = false;
    }
  }, [adapter, disabled, lang, deviceId, supported]);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    setStatus('transcribing');
    try {
      const finalText = await session.stop();
      const raw = finalText.trim();
      if (raw) {
        // Groom: learned corrections first (so prettify sees the right words), then
        // the deterministic prettify pass. Zero latency, model-free — the council/
        // model hook point for a deeper groom sits AFTER this baseline.
        const { text: corrected, applied } = applyProfile(raw, loadProfile());
        const groomed = prettifyTranscript(corrected);
        cbRef.current.onFinal(groomed || raw, { raw, applied });
      }
    } finally {
      setStatus(supported ? 'idle' : 'unsupported');
    }
  }, [supported]);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.abort();
    setStatus(supported ? 'idle' : 'unsupported');
  }, [supported]);

  // Hold-to-talk via the keyboard. Keydown on the chord starts; releasing either
  // modifier (or any keyup that breaks the chord) stops. Escape cancels.
  useEffect(() => {
    if (!supported || disabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sessionRef.current) { cancel(); return; }
      if (holdChord(e) && !sessionRef.current && !startingRef.current) {
        e.preventDefault();
        void start();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      // Any release that breaks the hold chord ends the utterance.
      if (sessionRef.current && (e.key === 'Alt' || e.key === 'Meta' || !holdChord(e))) {
        void stop();
      }
    };
    // A lost window (alt-tab) must not leave the mic hot.
    const onBlur = () => { if (sessionRef.current) void stop(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [supported, disabled, holdChord, start, stop, cancel]);

  // Safety: never leave a session open if the component unmounts mid-utterance.
  useEffect(() => () => { sessionRef.current?.abort(); sessionRef.current = null; }, []);

  return { status, supported, start, stop, cancel, listening: status === 'listening' };
}
