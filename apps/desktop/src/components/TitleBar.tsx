/**
 * TitleBar — the app's own window chrome, replacing the OS titlebar.
 *
 * Renders ONLY inside the Tauri shell (web builds keep the browser chrome). One slim,
 * token-bound strip: the Vai mark + product name on the left (whole strip is a drag
 * region), min/max/close on the right. Buttons follow the app's hover language —
 * close gets the red treatment, everything else a quiet wash. Double-click the drag
 * region toggles maximize, matching platform muscle memory.
 */

import { useCallback, useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function TitleBar() {
  const [inTauri] = useState(isTauri);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!inTauri) return;
    // Let the layout shell subtract the bar's height from its own (100dvh - …) budget.
    document.documentElement.style.setProperty('--titlebar-height', '34px');
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      setMaximized(await win.isMaximized().catch(() => false));
      unlisten = await win.onResized(async () => {
        setMaximized(await win.isMaximized().catch(() => false));
      });
    }).catch(() => { /* window API unavailable — keep the bar functional-less */ });
    return () => unlisten?.();
  }, [inTauri]);

  const control = useCallback(async (action: 'minimize' | 'toggle' | 'close') => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (action === 'minimize') await win.minimize();
    else if (action === 'toggle') await win.toggleMaximize();
    else await win.close();
  }, []);

  if (!inTauri) return null;

  return (
    <header className="vai-titlebar" data-tauri-drag-region onDoubleClick={() => { void control('toggle'); }}>
      <div className="vai-titlebar__brand" data-tauri-drag-region>
        {/* Miniature solid-ink mark — same geometry as the hero glyph */}
        <svg width="14" height="14" viewBox="0 0 64 64" fill="none" aria-hidden>
          <path d="M14 13 L32 51 L46 23" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="51.5" cy="12.5" r="7" fill="var(--accent)" />
        </svg>
        <span data-tauri-drag-region>VeggaAI</span>
      </div>

      <div className="vai-titlebar__controls">
        <button type="button" aria-label="Minimize window" className="vai-titlebar__btn" onClick={() => { void control('minimize'); }}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label={maximized ? 'Restore window' : 'Maximize window'} className="vai-titlebar__btn" onClick={() => { void control('toggle'); }}>
          {maximized ? <Copy className="h-3 w-3 -scale-x-100" /> : <Square className="h-3 w-3" />}
        </button>
        <button type="button" aria-label="Close window" className="vai-titlebar__btn vai-titlebar__btn--close" onClick={() => { void control('close'); }}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}

export default TitleBar;
