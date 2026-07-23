/**
 * Global release-targeted dictation — Wispr-Flow style, anywhere on the machine.
 *
 * The Rust side owns a configurable RegisterHotKey chord and relays hold/release
 * into this window as `vai:global-dictation` DOM events (via webview eval — no plugin
 * ACL needed). This hook drives one dictation session per hold and DELIVERS the groomed
 * transcript by target:
 *
 *   - Vai itself focused  → inserted straight into the composer ('vai:dictation-insert');
 *   - another app focused → Rust puts it on the clipboard and injects Ctrl+V there;
 *   - no typing target    → a clean modal with the text + copy button (also pre-copied).
 *
 * The transcript is always left on the clipboard as a fallback, so even a missed paste
 * is one Ctrl+V away.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVoiceDictation } from './useVoiceDictation.js';
import {
  COMPOSER_DICTATION_LIVE_EVENT,
  type ComposerDictationLiveEvent,
} from './useComposerDictationLive.js';
import type { AppliedReplacement } from '../lib/voice/speech-profile.js';
import type { SttAdapter, SttError } from '../lib/voice/stt-adapter.js';
import { useShortcutsStore } from '../stores/shortcutsStore.js';
import { useGameDictationStore } from '../stores/gameDictationStore.js';

export type GlobalDictationPhase =
  | { kind: 'idle' }
  | { kind: 'listening'; interim: string; level?: number }
  | { kind: 'transcribing' }
  | { kind: 'polishing'; raw: string }
  | { kind: 'pasted'; text: string; via: 'paste' | 'clipboard' }
  | { kind: 'modal'; text: string }
  | { kind: 'error'; message: string };

interface DeliveryReport {
  readonly route: 'self' | 'sendinput-accepted' | 'open-and-paste-input-accepted' | 'no-target'
    | 'clipboard-ready-no-field' | 'clipboard-ready-focus-changed'
    | 'clipboard-ready-field-closed' | 'clipboard-ready-latency-exceeded'
    | 'clipboard-ready-input-changed' | 'clipboard-ready-modifiers-held'
    | 'clipboard-ready-chat-open-failed' | 'clipboard-ready-chat-field-unproved'
    | 'clipboard-ready-clipboard-changed' | 'clipboard-ready-sendinput-failed'
    | 'clipboard-unavailable';
  readonly releaseId: number;
  readonly releaseToPasteMs: number;
  readonly latencyBudgetMet: boolean;
  readonly sttQuality: string;
  readonly game: boolean;
  readonly textFieldPlausible: boolean;
  readonly fieldDetection: string;
  readonly clipboardRestoreScheduled: boolean;
}

interface NativeChordEvent {
  readonly phase: 'down' | 'hold' | 'up';
  readonly releaseId?: number;
  readonly targetSelf?: boolean;
  readonly textFieldPlausible?: boolean;
  readonly fieldDetection?: string;
  readonly shortcut?: string;
}

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function createAcceptanceSttAdapter(text: string): SttAdapter {
  return {
    id: 'native-acceptance-fixture',
    isAvailable: () => true,
    start: async (options) => {
      let aborted = false;
      options?.onLevel?.(0.65);
      options?.onPartial?.({ transcript: text, isFinal: false });
      return {
        stop: async () => aborted ? '' : text,
        abort: () => { aborted = true; },
      };
    },
  };
}

/**
 * Deliver a composer lifecycle event. Gated on whether THIS hold targets Vai's own
 * composer (decided once, when the chord went down) — NOT on live focus. Using live
 * focus dropped begin/end/cancel whenever Vai flickered out of focus mid-hold, which
 * stranded the composer anchor and left the next hold unable to record. When the hold
 * targets another app, the composer isn't the destination, so we stay silent.
 */
function emitComposerLive(detail: ComposerDictationLiveEvent, toComposer: boolean): void {
  if (!toComposer) return;
  window.dispatchEvent(new CustomEvent(COMPOSER_DICTATION_LIVE_EVENT, { detail }));
}

async function pasteIntoForeground(
  releaseId: number,
  text: string,
  leagueOpenAndPaste: boolean,
): Promise<DeliveryReport> {
  const { invoke } = await import('@tauri-apps/api/core');
  // The Rust command writes the clipboard and injects Ctrl+V — if anything over there
  // stalls (clipboard lock, keyboard hook), don't let it freeze the UI forever: the
  // caller's catch shows the modal and the words survive on the clipboard.
  return await Promise.race([
    invoke<DeliveryReport>('paste_into_foreground', {
      releaseId,
      text,
      sttQuality: 'fast',
      leagueOpenAndPaste,
    }),
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error('paste_into_foreground timed out')), 5_000)),
  ]);
}

async function completeRelease(releaseId: number, outcome: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('complete_dictation_release', { releaseId, outcome });
  } catch { /* diagnostic cleanup is best-effort */ }
}

/**
 * Mirror the dictation phase into the standalone bubble window when the user
 * is working in ANOTHER app (Vai unfocused/minimized — the in-app overlay is
 * invisible there). Best-effort: bubble failures never affect dictation.
 */
function syncBubble(phase: GlobalDictationPhase, releaseId: number | null): void {
  if (!isTauri()) return;
  void (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (phase.kind === 'idle' || document.hasFocus()) {
        await invoke('dictation_bubble_hide');
        return;
      }
      await invoke('dictation_bubble_update', { phase: JSON.stringify(phase), releaseId });
    } catch { /* bubble is auxiliary — never let it break delivery */ }
  })();
}

export function useGlobalDictation(options?: { readonly deviceId?: string }) {
  const [phase, setPhase] = useState<GlobalDictationPhase>({ kind: 'idle' });
  const [acceptanceFixtureText, setAcceptanceFixtureText] = useState<string | null>(null);
  const enabled = isTauri();
  const shortcutOverride = useShortcutsStore((state) => state.overrides.globalDictation);
  const setShortcutOverride = useShortcutsStore((state) => state.setOverride);
  const leagueOpenAndPaste = useGameDictationStore((state) => state.leagueOpenAndPaste);
  const shortcut = shortcutOverride ?? 'Win+Alt';
  const pastedTimer = useRef(0);
  const errorTimer = useRef(0);
  const holdActiveRef = useRef(false);
  const lastHeldHeartbeatRef = useRef(0);
  const lastInterimRef = useRef('');
  const lastLevelPushRef = useRef(0);
  /**
   * Where the words belong — decided the moment the chord goes DOWN (Wispr
   * semantics: text lands where the cursor was when you started speaking).
   * Never re-evaluated at delivery time: switching apps while the model is
   * finishing must NOT redirect the text into the newly focused window.
   */
  const targetSelfRef = useRef(false);
  const releaseIdRef = useRef<number | null>(null);
  const bubbleReleaseIdRef = useRef<number | null>(null);
  const supersededReleaseIdsRef = useRef<number[]>([]);
  const hotkeyErrorRef = useRef(false);
  const acceptanceAdapter = useMemo(
    () => acceptanceFixtureText ? createAcceptanceSttAdapter(acceptanceFixtureText) : undefined,
    [acceptanceFixtureText],
  );
  /**
   * The last transcript we delivered into ANOTHER app, and when. Consecutive
   * dictations into a foreign app are independent pastes — the target has no notion
   * that one followed another, so without glue "…saying." + "Even" lands as
   * "…saying.Even". If we delivered recently and it didn't end in whitespace, we join
   * the next paste with a single leading space (the composer path already spaces
   * itself; this is the external-target equivalent).
   */
  const deliver = useCallback(async (text: string, applied: readonly AppliedReplacement[]) => {
    const releaseId = releaseIdRef.current;
    releaseIdRef.current = null;
    if (releaseId == null) {
      setPhase({ kind: 'modal', text });
      return;
    }
    try {
      const report = await pasteIntoForeground(releaseId, text, leagueOpenAndPaste);
      if (report.route === 'self') {
        window.dispatchEvent(new CustomEvent('vai:dictation-insert', { detail: { text, applied } }));
        setPhase({ kind: 'idle' });
        return;
      }
      if (report.route === 'sendinput-accepted'
        || report.route === 'open-and-paste-input-accepted'
        || report.route.startsWith('clipboard-ready')) {
        const via = report.route.endsWith('input-accepted') ? 'paste' : 'clipboard';
        setPhase({ kind: 'pasted', text, via });
        window.clearTimeout(pastedTimer.current);
        // Successful delivery needs only a blink. Clipboard fallback is an
        // actionable card now, so it remains until its real Close button is used.
        if (via === 'paste') {
          pastedTimer.current = window.setTimeout(() => setPhase({ kind: 'idle' }), 1_200);
        }
        return;
      }
      setPhase({ kind: 'modal', text });
    } catch {
      // Rust side unavailable (dev in a plain browser) — fall back to the modal so the
      // words are never lost.
      try { await navigator.clipboard.writeText(text); } catch { /* best-effort */ }
      setPhase({ kind: 'modal', text });
    }
  }, [leagueOpenAndPaste]);

  const dictation = useVoiceDictation({
    adapter: acceptanceAdapter,
    deviceId: options?.deviceId,
    holdChord: () => false, // driven purely by the Rust watcher events below
    keyboardHold: false,
    polishBeforeFinal: false,
    preserveRawFinal: acceptanceAdapter !== undefined,
    sttQuality: 'fast',
    onInterim: (interim) => {
      lastInterimRef.current = interim;
      // After release the recording is OVER — a late partial must not re-light
      // the composer's listening effects.
      if (holdActiveRef.current) emitComposerLive({ kind: 'interim', text: interim }, targetSelfRef.current);
      setPhase((p) => (p.kind === 'listening' ? { ...p, interim } : p));
    },
    onLevel: (level) => {
      if (holdActiveRef.current) emitComposerLive({ kind: 'level', level }, targetSelfRef.current);
      // Feed the bubble's voice bars while dictating into another app — the
      // level updates arrive ~30/s; throttle so the IPC bridge stays light.
      if (document.hasFocus()) return;
      const now = Date.now();
      if (now - lastLevelPushRef.current < 90) return;
      lastLevelPushRef.current = now;
      setPhase((p) => (p.kind === 'listening' ? { ...p, level } : p));
    },
    onRawFinal: (raw) => setPhase((p) => (holdActiveRef.current ? p : { kind: 'polishing', raw })),
    onPolishing: (raw) => setPhase((p) => (holdActiveRef.current ? p : { kind: 'polishing', raw })),
    onFinal: (text, meta) => {
      const applied = meta?.applied ?? [];
      setPhase({ kind: 'polishing', raw: text });
      void deliver(text, applied);
    },
    onPolishUpdate: () => { /* global PTT deliberately skips model polish */ },
    onDiscardedFinal: () => {
      // A newer hold superseded this session before its words landed — no 'groomed'
      // will follow it. Tell the composer to release the pending slot it reserved on
      // release so the late-final routing for the NEXT hold can't be poisoned. Always
      // emitted (the composer clamps its counters at zero, so a spurious one is inert).
      window.dispatchEvent(new CustomEvent(COMPOSER_DICTATION_LIVE_EVENT, {
        detail: { kind: 'discard' } satisfies ComposerDictationLiveEvent,
      }));
      const discardedId = supersededReleaseIdsRef.current.shift();
      if (discardedId != null) void completeRelease(discardedId, 'superseded');
    },
    onError: (error: SttError) => {
      const wasSelf = targetSelfRef.current;
      holdActiveRef.current = false;
      lastHeldHeartbeatRef.current = 0;
      emitComposerLive({ kind: 'cancel' }, wasSelf);
      const releaseId = releaseIdRef.current;
      releaseIdRef.current = null;
      if (releaseId != null) void completeRelease(releaseId, error.code);
      window.clearTimeout(errorTimer.current);
      if (error.code === 'no-speech') {
        setPhase({ kind: 'idle' });
        return;
      }
      setPhase({ kind: 'error', message: error.message });
      errorTimer.current = window.setTimeout(() => setPhase({ kind: 'idle' }), 5_500);
    },
    onCancel: () => {
      const wasSelf = targetSelfRef.current;
      holdActiveRef.current = false;
      lastHeldHeartbeatRef.current = 0;
      emitComposerLive({ kind: 'cancel' }, wasSelf);
      const releaseId = releaseIdRef.current;
      releaseIdRef.current = null;
      if (releaseId != null) void completeRelease(releaseId, 'cancelled');
      setPhase({ kind: 'idle' });
    },
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const text = await invoke<string | null>('dictation_acceptance_fixture_text');
        if (!cancelled && text) setAcceptanceFixtureText(text);
      } catch { /* release builds and ordinary sessions deliberately have no fixture */ }
    })();
    return () => { cancelled = true; };
  }, [enabled]);
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;

  useEffect(() => {
    if (!enabled || !acceptanceAdapter || !acceptanceFixtureText) return;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const ready = await invoke<boolean>('dictation_acceptance_adapter_ready', {
          textLength: acceptanceFixtureText.length,
        });
        if (!ready) {
          setPhase({ kind: 'error', message: 'Native acceptance adapter could not be armed.' });
        }
      } catch {
        setPhase({ kind: 'error', message: 'Native acceptance adapter readiness could not be proven.' });
      }
    })();
  }, [acceptanceAdapter, acceptanceFixtureText, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onStatus = (event: Event) => {
      const status = (event as CustomEvent<{
        registered?: boolean;
        error?: string;
        activeShortcut?: string | null;
      }>).detail;
      if (status?.registered === false) {
        hotkeyErrorRef.current = true;
        if (status.activeShortcut && status.activeShortcut !== shortcut) {
          setShortcutOverride('globalDictation', status.activeShortcut);
        }
        setPhase({
          kind: 'error',
          message: status.error ?? 'The global dictation shortcut is already in use.',
        });
      } else if (status?.registered === true && hotkeyErrorRef.current) {
        hotkeyErrorRef.current = false;
        setPhase({ kind: 'idle' });
      }
    };
    window.addEventListener('vai:dictation-hotkey-status', onStatus);
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('configure_dictation_hotkey', { shortcut });
      } catch (error) {
        setPhase({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => window.removeEventListener('vai:dictation-hotkey-status', onStatus);
  }, [enabled, setShortcutOverride, shortcut]);

  useEffect(() => {
    if (!enabled) return;
    const endHold = (release?: NativeChordEvent) => {
      if (!holdActiveRef.current) return;
      const composerWasArmed = targetSelfRef.current;
      const releaseTargetsSelf = release?.targetSelf ?? composerWasArmed;
      if (typeof release?.releaseId === 'number') {
        releaseIdRef.current = release.releaseId;
        bubbleReleaseIdRef.current = release.releaseId;
      }
      holdActiveRef.current = false;
      lastHeldHeartbeatRef.current = 0;
      // The press-time value is only a visual composer anchor. Native release-time
      // routing is authoritative; if focus moved away, explicitly cancel that anchor.
      emitComposerLive(
        releaseTargetsSelf ? { kind: 'end' } : { kind: 'cancel' },
        composerWasArmed,
      );
      targetSelfRef.current = releaseTargetsSelf;
      setPhase((p) => (
        p.kind === 'listening'
          ? lastInterimRef.current
            ? { kind: 'polishing', raw: lastInterimRef.current }
            : { kind: 'transcribing' }
          : p
      ));
      void dictationRef.current.stop();
    };
    const startHold = () => {
      if (releaseIdRef.current != null) {
        supersededReleaseIdsRef.current.push(releaseIdRef.current);
        releaseIdRef.current = null;
      }
      holdActiveRef.current = true;
      bubbleReleaseIdRef.current = null;
      lastHeldHeartbeatRef.current = Date.now();
      lastInterimRef.current = '';
      targetSelfRef.current = document.hasFocus();
      emitComposerLive({ kind: 'begin' }, targetSelfRef.current);
      setPhase({ kind: 'listening', interim: '' });
      void dictationRef.current.start();
    };
    const onChord = (e: Event) => {
      const raw = (e as CustomEvent<string | NativeChordEvent>).detail;
      const detail: NativeChordEvent = typeof raw === 'string' ? { phase: raw } as NativeChordEvent : raw;
      if (detail.phase === 'up') {
        endHold(detail);
        return;
      }
      if (detail.phase === 'down') {
        // Rising edge = a genuine fresh press. If a hold is somehow still active, we
        // never received its release edge (a dropped 'up') — tear the stale session
        // down and start clean so a press ALWAYS resets dictation. This is what kills
        // the "it won't reset / the second hold records nothing" hang without waiting
        // on the 2s watchdog or spam-pressing the key.
        if (holdActiveRef.current) endHold();
        startHold();
        return;
      }
      if (detail.phase === 'hold') {
        // Heartbeat while the keys stay down. Normally just feeds the watchdog; if we
        // somehow aren't active, we missed the 'down' edge, so recover by starting.
        lastHeldHeartbeatRef.current = Date.now();
        if (!holdActiveRef.current) startHold();
      }
    };
    window.addEventListener('vai:global-dictation', onChord);
    // The Rust watcher heartbeats 'hold' every ~250ms. Allow several missed
    // beats before force-ending: a busy renderer frame (layout, GC) used to
    // trip the old 900ms cutoff MID-SPEECH and silently truncate sentences.
    const watchdog = window.setInterval(() => {
      if (!holdActiveRef.current) return;
      if (Date.now() - lastHeldHeartbeatRef.current > 2_000) endHold();
    }, 200);
    return () => {
      window.removeEventListener('vai:global-dictation', onChord);
      window.clearInterval(watchdog);
    };
  }, [enabled]);

  // Watchdog: release must ALWAYS resolve (deliver, error, or this). Belt &
  // braces over the adapter/paste timeouts — no code path may strand the overlay.
  useEffect(() => {
    if (phase.kind !== 'transcribing' && phase.kind !== 'polishing') return;
    const timer = window.setTimeout(() => {
      setPhase((p) => (
        p.kind === 'transcribing' || p.kind === 'polishing'
          ? {
              kind: 'error',
              message: `Dictation timed out. Hold ${shortcut} a little longer, then check Settings → Voice for mic + transcription.`,
            }
          : p
      ));
    }, 35_000);
    return () => window.clearTimeout(timer);
  }, [phase.kind, shortcut]);

  // Mirror every phase into the standalone bubble (visible when Vai is not the
  // focused app — the whole point of global dictation).
  useEffect(() => { syncBubble(phase, bubbleReleaseIdRef.current); }, [phase]);

  useEffect(() => {
    const onBubbleDismissed = () => {
      window.clearTimeout(pastedTimer.current);
      window.clearTimeout(errorTimer.current);
      setPhase({ kind: 'idle' });
    };
    window.addEventListener('vai:dictation-bubble-dismissed', onBubbleDismissed);
    return () => window.removeEventListener('vai:dictation-bubble-dismissed', onBubbleDismissed);
  }, []);

  const dismiss = useCallback(() => {
    holdActiveRef.current = false;
    lastHeldHeartbeatRef.current = 0;
    window.clearTimeout(pastedTimer.current);
    window.clearTimeout(errorTimer.current);
    setPhase({ kind: 'idle' });
  }, []);

  return { phase, dismiss, enabled, supported: dictation.supported };
}
