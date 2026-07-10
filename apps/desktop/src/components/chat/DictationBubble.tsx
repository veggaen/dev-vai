import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Settings, X } from 'lucide-react';

/**
 * Standalone dictation bubble — the UI for dictating while ANOTHER app is
 * focused. Runs in its own tiny always-on-top Tauri window; receives phase
 * payloads via the `vai:bubble-phase` DOM event.
 *
 * Wispr-Flow style: while listening it is a SMALL rounded pill of vertical
 * bars that grow with your voice — instant visual proof the mic hears you.
 * A successful paste shows only a tiny "Pasted" confirmation that vanishes
 * on its own. The copy card appears ONLY when the words could not be
 * delivered (no typing target / injection blocked).
 */

export type BubblePhase =
  | { kind: 'listening'; interim: string; level?: number }
  | { kind: 'transcribing' }
  | { kind: 'polishing'; raw: string }
  | { kind: 'pasted'; text: string; via?: 'paste' | 'type' | 'clipboard' }
  | { kind: 'modal'; text: string }
  | { kind: 'error'; message: string };

const BAR_COUNT = 14;

async function invoke(cmd: string, args?: Record<string, unknown>): Promise<void> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  await tauriInvoke(cmd, args);
}

export function DictationBubble() {
  const [phase, setPhase] = useState<BubblePhase | null>(null);
  const [copied, setCopied] = useState(false);
  // Rolling mic-level history drives the bar heights (newest on the right).
  const [levels, setLevels] = useState<number[]>(() => Array<number>(BAR_COUNT).fill(0));
  const lastKindRef = useRef<string>('');

  useEffect(() => {
    const onPhase = (e: Event) => {
      const next = (e as CustomEvent<BubblePhase>).detail ?? null;
      setPhase(next);
      if (next?.kind !== lastKindRef.current) setCopied(false);
      lastKindRef.current = next?.kind ?? '';
      if (next?.kind === 'listening') {
        setLevels((prev) => [...prev.slice(1), Math.min(1, Math.max(0, next.level ?? 0))]);
      } else if (!next || next.kind === 'pasted' || next.kind === 'error') {
        setLevels(Array<number>(BAR_COUNT).fill(0));
      }
    };
    window.addEventListener('vai:bubble-phase', onPhase);
    return () => window.removeEventListener('vai:bubble-phase', onPhase);
  }, []);

  const close = useCallback(() => {
    setPhase(null);
    void invoke('dictation_bubble_hide');
  }, []);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* text is already on the OS clipboard from the Rust side */ }
  }, []);

  const openSettings = useCallback(() => {
    void invoke('focus_main_window');
    close();
  }, [close]);

  // Escape closes from the keyboard (accessibility-first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // Auto-dismiss the "Pasted"/"Typed" confirmation from HERE, not the main window:
  // this bubble stays visible while another app is focused, so its timer fires on
  // time, whereas the backgrounded main window's timers get throttled by WebView2
  // (the cause of the toast getting stuck). Clipboard-only ("press Ctrl+V") lingers
  // longer so the user has time to paste; modal/error stay until dismissed.
  useEffect(() => {
    if (phase?.kind !== 'pasted') return;
    const ms = phase.via === 'clipboard' ? 4200 : 1200;
    const t = window.setTimeout(() => close(), ms);
    return () => window.clearTimeout(t);
  }, [phase, close]);

  if (!phase) return null;

  // ── Pill states: listening / transcribing / polishing / pasted(ok) ────────
  if (phase.kind === 'listening') {
    return (
      <div className="vai-bubble" role="status" aria-live="polite">
        <div className="vai-bubble-pill" aria-label="Listening">
          <div className="vai-bubble-bars" aria-hidden>
            {levels.map((lv, i) => (
              <span
                key={i}
                className="vai-bubble-bar"
                style={{ height: `${4 + Math.round(lv * 20)}px`, opacity: 0.45 + lv * 0.55 }}
              />
            ))}
          </div>
          {phase.interim && <span className="vai-bubble-draft">{phase.interim}</span>}
        </div>
      </div>
    );
  }

  if (phase.kind === 'transcribing' || phase.kind === 'polishing') {
    return (
      <div className="vai-bubble" role="status" aria-live="polite">
        <div className="vai-bubble-pill" aria-label="Transcribing">
          <div className="vai-bubble-thinking" aria-hidden>
            <span /><span /><span />
          </div>
          {phase.kind === 'polishing' && phase.raw && (
            <span className="vai-bubble-draft">{phase.raw}</span>
          )}
        </div>
      </div>
    );
  }

  if (phase.kind === 'pasted' && phase.via !== 'clipboard') {
    // The words are already in the input the user spoke into — the only UI
    // needed is a small self-dismissing confirmation. No menu, no copy button.
    return (
      <div className="vai-bubble" role="status" aria-live="polite">
        <div className="vai-bubble-pill ok" aria-label="Delivered">
          <Check size={13} className="vai-bubble-ok" aria-hidden />
          <span className="vai-bubble-pill-label">{phase.via === 'type' ? 'Typed' : 'Pasted'}</span>
        </div>
      </div>
    );
  }

  // ── Card states: clipboard fallback / no target / error ───────────────────
  return (
    <div className="vai-bubble" role="status" aria-live="polite">
      <div className="vai-bubble-card">
        <div className="vai-bubble-head">
          {phase.kind === 'error' ? (
            <>
              <AlertTriangle size={14} className="vai-bubble-warn" aria-hidden />
              <span className="vai-bubble-title">Voice needs attention</span>
            </>
          ) : (
            <>
              <Copy size={14} aria-hidden />
              <span className="vai-bubble-title">
                {phase.kind === 'pasted' ? 'Copied — press Ctrl+V to paste' : 'Copied to clipboard — paste anywhere'}
              </span>
            </>
          )}
          <span className="vai-bubble-spacer" />
          <button type="button" className="vai-bubble-icon" title="Voice settings" onClick={openSettings}>
            <Settings size={14} />
          </button>
          <button type="button" className="vai-bubble-icon" title="Close (Esc)" onClick={close}>
            <X size={14} />
          </button>
        </div>

        {phase.kind === 'error' ? (
          <>
            <div className="vai-bubble-text">{phase.message}</div>
            <div className="vai-bubble-actions">
              <button type="button" className="vai-bubble-btn" onClick={openSettings}>
                <Settings size={13} />
                Voice settings
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="vai-bubble-text">{phase.text}</div>
            <div className="vai-bubble-actions">
              <button type="button" className="vai-bubble-btn" onClick={() => void copy(phase.text)}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

