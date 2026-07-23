import { useCallback, useEffect, useRef, useState } from 'react';
import type { SttAdapter, SttSession, SttError } from '../lib/voice/stt-adapter.js';
import { autoSttAdapter } from '../lib/voice/auto-stt-adapter.js';
import {
  applyProfile,
  loadProfile,
  prettifyTranscript,
  type AppliedReplacement,
} from '../lib/voice/speech-profile.js';
import { shouldAcceptPolishedTranscript, stripNonSpeechAnnotations } from '@vai/core/browser';
import { polishTranscript } from '../lib/voice/polish-transcript.js';

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
  readonly onRawFinal?: (text: string) => void;
  readonly onPolishing?: (text: string) => void;
  /**
   * Receives the final transcript on release — GROOMED: the user's learned speech
   * profile is applied first (auto-corrections they've taught us), then the
   * deterministic prettify pass (casing, punctuation, fillers). `meta` carries the
   * raw text + applied rules so the caller can feed the correction learner.
   */
  readonly onFinal: (text: string, meta?: DictationMeta) => void;
  /** Optional upgrade after local prettify — e.g. Ollama cleanup. Never blocks {@link onFinal}. */
  readonly onPolishUpdate?: (text: string, meta?: DictationMeta) => void;
  /**
   * A newer hold superseded this session before its transcript could land, so
   * {@link onFinal} is deliberately skipped. Fired exactly once in that case so the
   * caller can release any per-release bookkeeping it reserved (e.g. the composer's
   * pending late-final counter) — without it, that counter leaks and mis-routes the
   * next hold's words (the duplication bug).
   */
  readonly onDiscardedFinal?: () => void;
  /** Live mic loudness (0–1) while capturing — for a bouncing level meter. */
  readonly onLevel?: (level: number) => void;
  readonly onError?: (error: SttError) => void;
  readonly onCancel?: () => void;
  /** Engine override (defaults to the zero-dep Web Speech adapter). */
  readonly adapter?: SttAdapter;
  readonly lang?: string;
  /** Pin the STT tier. Global/game PTT uses `fast` to keep release latency bounded. */
  readonly sttQuality?: 'fast' | 'balanced' | 'best';
  /** Preferred mic (from the device picker). Omit to use the system default. */
  readonly deviceId?: string;
  /**
   * Hold-to-talk hotkey. Default: Alt+Meta (Win) held together — Wispr-Flow style.
   * The Win key alone is unreliable in a webview, so we gate on BOTH modifiers.
   */
  readonly holdChord?: (e: KeyboardEvent) => boolean;
  /**
   * Wire keydown/keyup listeners for {@link holdChord}. Off when dictation is driven
   * elsewhere (Tauri global watcher, mic-button-only) so random key releases do not
   * end an active pointer-held session.
   */
  readonly keyboardHold?: boolean;
  /** Skip model polish on latency-critical global/game PTT. */
  readonly polishBeforeFinal?: boolean;
  /**
   * Preserve the adapter's final text byte-for-byte after non-speech annotation
   * removal. This exists only for deterministic native acceptance fixtures: it
   * prevents a persisted speech profile, casing, fillers, or punctuation rules
   * from changing the predeclared nonce that the target must observe exactly.
   */
  readonly preserveRawFinal?: boolean;
  /** Don't start dictation while a turn is streaming (composer is busy steering). */
  readonly disabled?: boolean;
}

export function prepareBaselineTranscript(
  raw: string,
  preserveRawFinal = false,
): { readonly text: string; readonly applied: readonly AppliedReplacement[] } {
  if (preserveRawFinal) return { text: raw, applied: [] };
  const { text: corrected, applied } = applyProfile(raw, loadProfile());
  return { text: prettifyTranscript(corrected) || raw, applied };
}

const defaultHoldChord = (e: KeyboardEvent): boolean => e.altKey && e.metaKey;

/**
 * How long, after the transcript is ready, we wait for the model polish before
 * landing text. Text lands EXACTLY ONCE (polished if it arrives in time, groomed
 * otherwise) and is never rewritten afterwards — so the words never change under
 * the user's eyes. Tuned so the final still appears within ~2.5s of release.
 */
const POLISH_LAND_CAP_MS = 2_500;

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
  const {
    onInterim,
    onRawFinal,
    onPolishing,
    onFinal,
    onPolishUpdate,
    onDiscardedFinal,
    onLevel,
    onError,
    onCancel,
    adapter = autoSttAdapter,
    lang = 'en-US',
    sttQuality,
    deviceId,
    holdChord = defaultHoldChord,
    keyboardHold = true,
    polishBeforeFinal = true,
    preserveRawFinal = false,
    disabled = false,
  } = options;
  const [status, setStatus] = useState<DictationStatus>(() => (adapter.isAvailable() ? 'idle' : 'unsupported'));
  const sessionRef = useRef<SttSession | null>(null);
  const startingRef = useRef(false);
  /** Monotonic session counter — a new hold invalidates every callback still in
   *  flight from the previous one (late model polish re-inserting old text was
   *  the "it pastes what I just said all over again" duplication bug). */
  const generationRef = useRef(0);
  /** Release arrived while getUserMedia was still opening — finish as soon as the session exists. */
  const stopPendingRef = useRef(false);
  // True once the engine reported a real error this session (e.g. "no transcription
  // key configured"). Stops the generic "No speech was captured." from overwriting
  // the actionable message when the transcript comes back empty as a side effect.
  const sessionErroredRef = useRef(false);
  // Keep latest callbacks without re-binding the global key listeners each render.
  const cbRef = useRef({ onInterim, onRawFinal, onPolishing, onFinal, onPolishUpdate, onDiscardedFinal, onLevel, onError, onCancel });
  cbRef.current = { onInterim, onRawFinal, onPolishing, onFinal, onPolishUpdate, onDiscardedFinal, onLevel, onError, onCancel };

  const supported = adapter.isAvailable();

  const finalizeSession = useCallback(async (session: SttSession) => {
    const generation = generationRef.current;
    setStatus('transcribing');
    try {
      const finalText = await session.stop();
      // "[BLANK_AUDIO]"-style Whisper annotations are not speech — a hold that
      // produced only annotations must end as no-speech, never as pasted junk.
      const raw = stripNonSpeechAnnotations(finalText.trim());
      if (raw) {
        cbRef.current.onRawFinal?.(raw);
        // Groom: learned corrections first (so prettify sees the right words), then
        // the deterministic prettify pass. Zero latency, model-free — the council/
        // model hook point for a deeper groom sits AFTER this baseline.
        const { text: groomedText, applied } = prepareBaselineTranscript(raw, preserveRawFinal);
        cbRef.current.onPolishing?.(groomedText);
        // Wait BRIEFLY for the model polish, then land the text EXACTLY ONCE. The old
        // behavior landed groomed text instantly and rewrote it seconds later, which
        // read as "the words changed after I already read them". Now nothing lands
        // until the final text is ready — bounded so it still appears within ~2.5s of
        // release; if polish is slow, groomed lands and is never mutated afterwards.
        let landed = groomedText;
        if (!preserveRawFinal && polishBeforeFinal) try {
          const polished = await Promise.race([
            polishTranscript(groomedText),
            new Promise<null>((resolve) => window.setTimeout(() => resolve(null), POLISH_LAND_CAP_MS)),
          ]);
          if (polished && shouldAcceptPolishedTranscript(groomedText, polished.text || groomedText)) {
            // Re-run the deterministic groom over the MODEL's output so it lands with
            // our spacing/casing rules enforced. The polish model occasionally returns
            // e.g. "engineer.Currently" (no space after a sentence period) or a
            // lowercased sentence start; prettify is idempotent on already-clean text,
            // so this only ever repairs those seams — it never fights a good polish.
            const polishedText = polished.text || groomedText;
            landed = prettifyTranscript(polishedText) || polishedText;
          }
        } catch { /* fall back to the groomed text */ }
        // A newer hold may own the composer now — never land a stale session's text.
        if (generationRef.current === generation) {
          cbRef.current.onFinal(landed, { raw, applied });
        } else {
          // Superseded before landing: release whatever the caller reserved for this
          // release so its late-final bookkeeping can't drift (duplication fix).
          cbRef.current.onDiscardedFinal?.();
        }
      } else if (generationRef.current !== generation) {
        // Empty AND superseded — still release the reserved slot.
        cbRef.current.onDiscardedFinal?.();
      } else if (!sessionErroredRef.current) {
        // Empty transcript (WebView2 frequently hears nothing) — report it instead of
        // going silent, so callers can clear their "Transcribing…" state. Skipped when
        // the engine already surfaced the real reason (e.g. no key configured), so the
        // actionable message isn't overwritten by a generic one.
        cbRef.current.onError?.({ code: 'no-speech', message: 'No speech was captured.' });
      }
    } finally {
      setStatus(supported ? 'idle' : 'unsupported');
    }
  }, [polishBeforeFinal, preserveRawFinal, supported]);

  const start = useCallback(async () => {
    if (disabled || !supported) return;
    if (sessionRef.current || startingRef.current) return; // already listening
    generationRef.current += 1;
    startingRef.current = true;
    stopPendingRef.current = false;
    sessionErroredRef.current = false;
    setStatus('listening');
    const generation = generationRef.current;
    try {
      const session = await adapter.start({
        lang,
        quality: sttQuality,
        deviceId,
        onPartial: (p) => {
          if (generationRef.current === generation) cbRef.current.onInterim?.(p.transcript);
        },
        onLevel: (l) => {
          if (generationRef.current === generation) cbRef.current.onLevel?.(l);
        },
        onError: (err) => {
          sessionErroredRef.current = true;
          // Errors from a session the user has already moved past (a new hold is
          // live) must not cancel or overwrite the new session's UI.
          if (generationRef.current !== generation) return;
          cbRef.current.onError?.(err);
          setStatus('error');
        },
      });
      if (stopPendingRef.current) {
        stopPendingRef.current = false;
        await finalizeSession(session);
        return;
      }
      sessionRef.current = session;
    } catch (e) {
      stopPendingRef.current = false;
      cbRef.current.onError?.(e as SttError);
      setStatus(supported ? 'error' : 'unsupported');
    } finally {
      startingRef.current = false;
    }
  }, [adapter, disabled, lang, sttQuality, deviceId, supported, finalizeSession]);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    if (session) {
      sessionRef.current = null;
      stopPendingRef.current = false;
      await finalizeSession(session);
      return;
    }
    if (startingRef.current) {
      stopPendingRef.current = true;
      setStatus('transcribing');
    }
  }, [finalizeSession]);

  const cancel = useCallback(() => {
    stopPendingRef.current = false;
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.abort();
    cbRef.current.onCancel?.();
    setStatus(supported ? 'idle' : 'unsupported');
  }, [supported]);

  // Hold-to-talk via the keyboard. Keydown on the chord starts; releasing either
  // modifier (or any keyup that breaks the chord) stops. Escape cancels.
  useEffect(() => {
    if (!supported || disabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (sessionRef.current || startingRef.current)) { cancel(); return; }
      if (!keyboardHold) return;
      if (holdChord(e) && !sessionRef.current && !startingRef.current) {
        e.preventDefault();
        void start();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!keyboardHold) return;
      // Any release that breaks the hold chord ends the utterance.
      if ((sessionRef.current || startingRef.current) && (e.key === 'Alt' || e.key === 'Meta' || !holdChord(e))) {
        void stop();
      }
    };
    // A lost window (alt-tab) must not leave the mic hot.
    const onBlur = () => {
      if (keyboardHold && (sessionRef.current || startingRef.current)) void stop();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [supported, disabled, keyboardHold, holdChord, start, stop, cancel]);

  // Safety: never leave a session open if the component unmounts mid-utterance.
  useEffect(() => () => { sessionRef.current?.abort(); sessionRef.current = null; }, []);

  return { status, supported, start, stop, cancel, listening: status === 'listening' };
}
