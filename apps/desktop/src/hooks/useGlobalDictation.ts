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
import type { AppliedReplacement } from '../lib/voice/speech-profile.js';

export type GlobalDictationPhase =
  | { kind: 'idle' }
  | { kind: 'listening'; interim: string }
  | { kind: 'transcribing' }
  | { kind: 'pasted'; text: string }
  | { kind: 'modal'; text: string };

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function pasteIntoForeground(text: string): Promise<'self' | 'pasted' | 'no-target'> {
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<'self' | 'pasted' | 'no-target'>('paste_into_foreground', { text });
}

export function useGlobalDictation(options?: { readonly deviceId?: string }) {
  const [phase, setPhase] = useState<GlobalDictationPhase>({ kind: 'idle' });
  const enabled = isTauri();
  const pastedTimer = useRef(0);

  const deliver = useCallback(async (text: string, applied: readonly AppliedReplacement[]) => {
    try {
      const route = await pasteIntoForeground(text);
      if (route === 'self') {
        window.dispatchEvent(new CustomEvent('vai:dictation-insert', { detail: { text, applied } }));
        setPhase({ kind: 'idle' });
        return;
      }
      if (route === 'pasted') {
        setPhase({ kind: 'pasted', text });
        window.clearTimeout(pastedTimer.current);
        pastedTimer.current = window.setTimeout(() => setPhase({ kind: 'idle' }), 2600);
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
    onInterim: (interim) => setPhase((p) => (p.kind === 'listening' ? { kind: 'listening', interim } : p)),
    onFinal: (text, meta) => { void deliver(text, meta?.applied ?? []); },
    onError: () => setPhase({ kind: 'idle' }),
  });
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;

  useEffect(() => {
    if (!enabled) return;
    const onChord = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === 'down') {
        setPhase({ kind: 'listening', interim: '' });
        void dictationRef.current.start();
      } else if (detail === 'up') {
        setPhase((p) => (p.kind === 'listening' ? { kind: 'transcribing' } : p));
        void dictationRef.current.stop();
      }
    };
    window.addEventListener('vai:global-dictation', onChord);
    return () => window.removeEventListener('vai:global-dictation', onChord);
  }, [enabled]);

  const dismiss = useCallback(() => {
    window.clearTimeout(pastedTimer.current);
    setPhase({ kind: 'idle' });
  }, []);

  return { phase, dismiss, enabled, supported: dictation.supported };
}
