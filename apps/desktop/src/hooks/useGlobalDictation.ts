/**
 * Global Win+Alt dictation — Wispr-Flow style, anywhere on the machine.
 *
 * The Rust side watches the physical Win+Alt chord system-wide and relays hold/release
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceDictation } from './useVoiceDictation.js';
import {
  COMPOSER_DICTATION_LIVE_EVENT,
  type ComposerDictationLiveEvent,
} from './useComposerDictationLive.js';
import type { AppliedReplacement } from '../lib/voice/speech-profile.js';
import type { SttError } from '../lib/voice/stt-adapter.js';

export type GlobalDictationPhase =
  | { kind: 'idle' }
  | { kind: 'listening'; interim: string; level?: number }
  | { kind: 'transcribing' }
  | { kind: 'polishing'; raw: string }
  | { kind: 'pasted'; text: string; via: 'paste' | 'type' | 'clipboard' }
  | { kind: 'modal'; text: string }
  | { kind: 'error'; message: string };

/** Delivery routes the Rust `paste_into_foreground` command can report. */
type DeliveryRoute = 'self' | 'pasted' | 'typed' | 'copied' | 'no-target';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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

async function pasteIntoForeground(text: string): Promise<DeliveryRoute> {
  const { invoke } = await import('@tauri-apps/api/core');
  // The Rust command writes the clipboard and injects Ctrl+V — if anything over there
  // stalls (clipboard lock, keyboard hook), don't let it freeze the UI forever: the
  // caller's catch shows the modal and the words survive on the clipboard.
  return await Promise.race([
    invoke<DeliveryRoute>('paste_into_foreground', { text }),
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error('paste_into_foreground timed out')), 5_000)),
  ]);
}

/**
 * Mirror the dictation phase into the standalone bubble window when the user
 * is working in ANOTHER app (Vai unfocused/minimized — the in-app overlay is
 * invisible there). Best-effort: bubble failures never affect dictation.
 */
function syncBubble(phase: GlobalDictationPhase): void {
  if (!isTauri()) return;
  void (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (phase.kind === 'idle' || document.hasFocus()) {
        await invoke('dictation_bubble_hide');
        return;
      }
      await invoke('dictation_bubble_update', { phase: JSON.stringify(phase) });
    } catch { /* bubble is auxiliary — never let it break delivery */ }
  })();
}

export function useGlobalDictation(options?: { readonly deviceId?: string }) {
  const [phase, setPhase] = useState<GlobalDictationPhase>({ kind: 'idle' });
  const enabled = isTauri();
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
  /**
   * The last transcript we delivered into ANOTHER app, and when. Consecutive
   * dictations into a foreign app are independent pastes — the target has no notion
   * that one followed another, so without glue "…saying." + "Even" lands as
   * "…saying.Even". If we delivered recently and it didn't end in whitespace, we join
   * the next paste with a single leading space (the composer path already spaces
   * itself; this is the external-target equivalent).
   */
  const lastDeliveredRef = useRef<{ at: number; text: string }>({ at: 0, text: '' });

  const deliver = useCallback(async (text: string, applied: readonly AppliedReplacement[]) => {
    const prev = lastDeliveredRef.current;
    const joinGap = Boolean(prev.text)
      && Date.now() - prev.at < 20_000
      && !/\s$/.test(prev.text)
      && /^[\p{L}\p{N}]/u.test(text);
    const outgoing = joinGap ? ` ${text}` : text;
    try {
      const route = await pasteIntoForeground(outgoing);
      // Remember what we just delivered so the NEXT dictation can space itself off it.
      // (Store the raw words, not the glued form — we only care about the end char.)
      lastDeliveredRef.current = { at: Date.now(), text };
      if (route === 'self') {
        window.dispatchEvent(new CustomEvent('vai:dictation-insert', { detail: { text, applied } }));
        setPhase({ kind: 'idle' });
        return;
      }
      if (route === 'pasted' || route === 'typed' || route === 'copied') {
        // 'typed' = injected as per-character unicode keystrokes (fullscreen games);
        // 'copied' = injection impossible — the words are on the clipboard, show the tip.
        const via = route === 'pasted' ? 'paste' : route === 'typed' ? 'type' : 'clipboard';
        setPhase({ kind: 'pasted', text, via });
        window.clearTimeout(pastedTimer.current);
        pastedTimer.current = window.setTimeout(
          () => setPhase({ kind: 'idle' }),
          // A successful paste needs only a blink of confirmation; the clipboard
          // tip must stay long enough to actually read and act on. (Cross-app, the
          // bubble also self-dismisses on its own timer since this window is throttled.)
          via === 'clipboard' ? 4_200 : 1_200,
        );
        return;
      }
      setPhase({ kind: 'modal', text });
    } catch {
      // Rust side unavailable (dev in a plain browser) — fall back to the modal so the
      // words are never lost.
      try { await navigator.clipboard.writeText(text); } catch { /* best-effort */ }
      setPhase({ kind: 'modal', text });
    }
  }, []);

  const dictation = useVoiceDictation({
    deviceId: options?.deviceId,
    holdChord: () => false, // driven purely by the Rust watcher events below
    keyboardHold: false,
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
      if (targetSelfRef.current) {
        // Deliver into the composer even if Vai lost focus while transcribing —
        // the anchor there is still armed from 'begin'. Bypass the hasFocus gate.
        window.dispatchEvent(new CustomEvent(COMPOSER_DICTATION_LIVE_EVENT, {
          detail: { kind: 'groomed', text, applied } satisfies ComposerDictationLiveEvent,
        }));
        // A newer hold may already be listening — don't stomp its phase.
        setPhase((p) => (holdActiveRef.current ? p : { kind: 'idle' }));
        return;
      }
      setPhase({ kind: 'polishing', raw: text });
      void deliver(text, applied);
    },
    onPolishUpdate: (text, meta) => {
      const applied = meta?.applied ?? [];
      if (targetSelfRef.current) {
        window.dispatchEvent(new CustomEvent(COMPOSER_DICTATION_LIVE_EVENT, {
          detail: { kind: 'polish', text, applied } satisfies ComposerDictationLiveEvent,
        }));
        setPhase((p) => (holdActiveRef.current ? p : { kind: 'idle' }));
        return;
      }
      // External dictation already pasted the locally cleaned final text. A
      // later polish update must not paste a second copy into the foreground app.
    },
    onDiscardedFinal: () => {
      // A newer hold superseded this session before its words landed — no 'groomed'
      // will follow it. Tell the composer to release the pending slot it reserved on
      // release so the late-final routing for the NEXT hold can't be poisoned. Always
      // emitted (the composer clamps its counters at zero, so a spurious one is inert).
      window.dispatchEvent(new CustomEvent(COMPOSER_DICTATION_LIVE_EVENT, {
        detail: { kind: 'discard' } satisfies ComposerDictationLiveEvent,
      }));
    },
    onError: (error: SttError) => {
      const wasSelf = targetSelfRef.current;
      holdActiveRef.current = false;
      lastHeldHeartbeatRef.current = 0;
      emitComposerLive({ kind: 'cancel' }, wasSelf);
      window.clearTimeout(errorTimer.current);
      setPhase({ kind: 'error', message: error.message });
      errorTimer.current = window.setTimeout(() => setPhase({ kind: 'idle' }), 5_500);
    },
    onCancel: () => {
      const wasSelf = targetSelfRef.current;
      holdActiveRef.current = false;
      lastHeldHeartbeatRef.current = 0;
      emitComposerLive({ kind: 'cancel' }, wasSelf);
      setPhase({ kind: 'idle' });
    },
  });
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;

  useEffect(() => {
    if (!enabled) return;
    const endHold = () => {
      if (!holdActiveRef.current) return;
      const wasSelf = targetSelfRef.current;
      holdActiveRef.current = false;
      lastHeldHeartbeatRef.current = 0;
      // Wispr behavior: the instant the keys lift, all "listening" effects stop.
      // The composer keeps its anchor and receives the text via 'groomed'.
      emitComposerLive({ kind: 'end' }, wasSelf);
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
      holdActiveRef.current = true;
      lastHeldHeartbeatRef.current = Date.now();
      lastInterimRef.current = '';
      targetSelfRef.current = document.hasFocus();
      emitComposerLive({ kind: 'begin' }, targetSelfRef.current);
      setPhase({ kind: 'listening', interim: '' });
      void dictationRef.current.start();
    };
    const onChord = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === 'up') {
        endHold();
        return;
      }
      if (detail === 'down') {
        // Rising edge = a genuine fresh press. If a hold is somehow still active, we
        // never received its release edge (a dropped 'up') — tear the stale session
        // down and start clean so a press ALWAYS resets dictation. This is what kills
        // the "it won't reset / the second hold records nothing" hang without waiting
        // on the 2s watchdog or spam-pressing the key.
        if (holdActiveRef.current) endHold();
        startHold();
        return;
      }
      if (detail === 'hold') {
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
              message: 'Dictation timed out. Hold Ctrl+Shift+Space or Win+Alt a little longer, then check Settings → Voice for mic + transcription.',
            }
          : p
      ));
    }, 35_000);
    return () => window.clearTimeout(timer);
  }, [phase.kind]);

  // Mirror every phase into the standalone bubble (visible when Vai is not the
  // focused app — the whole point of global dictation).
  useEffect(() => { syncBubble(phase); }, [phase]);

  const dismiss = useCallback(() => {
    holdActiveRef.current = false;
    lastHeldHeartbeatRef.current = 0;
    window.clearTimeout(pastedTimer.current);
    window.clearTimeout(errorTimer.current);
    setPhase({ kind: 'idle' });
  }, []);

  return { phase, dismiss, enabled, supported: dictation.supported };
}
