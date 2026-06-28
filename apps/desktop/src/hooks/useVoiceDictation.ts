import { useCallback, useEffect, useRef, useState } from 'react';
import type { SttAdapter, SttSession, SttError } from '../lib/voice/stt-adapter.js';
import { defaultSttAdapter } from '../lib/voice/web-speech-adapter.js';

export type DictationStatus = 'idle' | 'listening' | 'transcribing' | 'error' | 'unsupported';

export interface UseVoiceDictationOptions {
  /** Receives the live (interim) transcript while listening — for a preview. */
  readonly onInterim?: (text: string) => void;
  /** Receives the final transcript on release. The composer inserts it. */
  readonly onFinal: (text: string) => void;
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
      if (finalText.trim()) cbRef.current.onFinal(finalText.trim());
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
