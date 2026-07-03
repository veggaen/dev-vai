/**
 * GlobalDictationOverlay — the visible half of Win+Alt-anywhere dictation.
 *
 * Three surfaces, all transform/opacity-animated and reduced-motion-safe:
 *  - a floating pill while listening (live interim words) / transcribing;
 *  - a "pasted ✓" toast when the words landed in another app;
 *  - a clean modal when there was nowhere to type — transcript + copy, Escape closes.
 */

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Loader2, Mic, X } from 'lucide-react';
import { useGlobalDictation, type GlobalDictationPhase } from '../../hooks/useGlobalDictation.js';

interface GlobalDictationOverlayProps {
  readonly phase: GlobalDictationPhase;
  readonly onDismiss: () => void;
}

const spring = { type: 'spring', stiffness: 380, damping: 30 } as const;

export function GlobalDictationOverlay({ phase, onDismiss }: GlobalDictationOverlayProps) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard already holds it from the Rust side */ }
  }, []);

  // Escape closes the modal; reset the copied flag whenever the surface changes.
  useEffect(() => {
    setCopied(false);
    if (phase.kind !== 'modal') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onDismiss]);

  return (
    <>
      {/* ── Listening / transcribing pill ── */}
      <AnimatePresence>
        {(phase.kind === 'listening' || phase.kind === 'transcribing') && (
          <motion.div
            key="dictation-pill"
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 bottom-28 z-[90] flex justify-center"
            initial={{ opacity: 0, y: 14, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={spring}
          >
            <div className="flex max-w-[min(560px,90vw)] items-center gap-2.5 rounded-full border border-white/10 bg-[color:var(--chat-surface,#17171d)]/95 px-4 py-2.5 shadow-2xl backdrop-blur-xl">
              {phase.kind === 'listening' ? (
                <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                  <motion.span
                    className="absolute inset-0 rounded-full bg-[color:var(--accent,#7c3aed)]/30"
                    animate={{ scale: [1, 1.7], opacity: [0.7, 0] }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
                    aria-hidden="true"
                  />
                  <Mic className="h-3.5 w-3.5 text-[color:var(--accent-text,#c4b5fd)]" aria-hidden="true" />
                </span>
              ) : (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[color:var(--accent-text,#c4b5fd)]" aria-hidden="true" />
              )}
              <span className="truncate text-sm text-[color:var(--chat-body,#d4d4d8)]">
                {phase.kind === 'listening'
                  ? (phase.interim || 'Listening — release Win+Alt to finish')
                  : 'Transcribing…'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Pasted-into-target toast ── */}
      <AnimatePresence>
        {phase.kind === 'pasted' && (
          <motion.div
            key="dictation-pasted"
            role="status"
            className="pointer-events-none fixed inset-x-0 bottom-28 z-[90] flex justify-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-[color:var(--chat-surface,#17171d)]/95 px-4 py-2 shadow-xl backdrop-blur-xl">
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span className="text-[13px] text-[color:var(--chat-body,#d4d4d8)]">
                Pasted — it's on your clipboard too
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Nowhere-to-type modal ── */}
      <AnimatePresence>
        {phase.kind === 'modal' && (
          <motion.div
            key="dictation-modal"
            className="fixed inset-0 z-[95] flex items-center justify-center p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
              onClick={onDismiss}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Dictated text"
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[color:var(--chat-surface,#17171d)] shadow-2xl"
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={spring}
            >
              <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
                <Mic className="h-4 w-4 text-[color:var(--accent-text,#c4b5fd)]" aria-hidden="true" />
                <span className="flex-1 text-sm font-medium text-[color:var(--chat-strong,#fff)]">
                  Here's what you said
                </span>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={onDismiss}
                  className="rounded-lg p-1.5 text-[color:var(--chat-muted,#a1a1aa)] transition-colors hover:bg-white/[0.06] hover:text-[color:var(--chat-strong,#fff)]"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto px-4 py-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--chat-body,#d4d4d8)]">
                  {phase.text}
                </p>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] px-4 py-3">
                <span className="text-[11px] text-[color:var(--chat-muted,#a1a1aa)]">
                  No text field was focused — copy it wherever you need.
                </span>
                <button
                  type="button"
                  onClick={() => void copy(phase.text)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[color:var(--accent,#7c3aed)] px-3 py-1.5 text-[13px] font-medium text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
                >
                  {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default GlobalDictationOverlay;

/**
 * Drop-in mount: owns the global-dictation session + renders its overlay. Renders
 * nothing outside the Tauri shell or when speech recognition is unavailable.
 */
export function GlobalDictation() {
  const deviceId = (() => {
    try { return localStorage.getItem('vai-voice-device') || undefined; } catch { return undefined; }
  })();
  const { phase, dismiss, enabled, supported } = useGlobalDictation({ deviceId });
  if (!enabled || !supported) return null;
  return <GlobalDictationOverlay phase={phase} onDismiss={dismiss} />;
}
