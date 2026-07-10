/**
 * Popout panels — "Lego UI". Any workspace panel can detach into its own
 * OS window (multi-monitor: chat on one screen, app on another, console on a third).
 *
 * Coordination is a BroadcastChannel: popout windows announce open/close;
 * the main window hides the detached panel and restores it when the popout dies.
 * State itself needs no syncing — every window talks to the same runtime and
 * shares the same per-origin persisted stores.
 */

import { create } from 'zustand';

export type PopoutPanel = 'chat' | 'app' | 'code' | 'diff' | 'console';

export const POPOUT_PANELS: Record<PopoutPanel, { title: string; features: string }> = {
  chat: { title: 'Vai — Chat', features: 'width=900,height=1000' },
  app: { title: 'Vai — App', features: 'width=1200,height=900' },
  code: { title: 'Vai — Code', features: 'width=1100,height=900' },
  diff: { title: 'Vai — Diff', features: 'width=980,height=900' },
  console: { title: 'Vai — Console', features: 'width=980,height=460' },
};

const CHANNEL_NAME = 'vai-popout';

interface PopoutState {
  /** Panels currently living in their own window (main-window view). */
  popped: PopoutPanel[];
  /** Open a panel as a separate window. */
  openPopout: (panel: PopoutPanel, params?: Record<string, string | null | undefined>) => void;
  /** Ask a popout window to close and return the panel home. */
  reclaim: (panel: PopoutPanel) => void;
  /** @internal */
  _setPopped: (panel: PopoutPanel, popped: boolean) => void;
}

function channel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(CHANNEL_NAME);
}

/** Long-lived channel for the current window. */
const bus = channel();

export function getPopoutPanelFromUrl(): PopoutPanel | null {
  const value = new URLSearchParams(window.location.search).get('popout');
  return value === 'chat' || value === 'app' || value === 'code' || value === 'diff' || value === 'console' ? value : null;
}

export const usePopoutStore = create<PopoutState>((set, get) => ({
  popped: [],

  openPopout: (panel, extraParams = {}) => {
    if (get().popped.includes(panel)) {
      // Already out — ping it so the OS focuses the window.
      bus?.postMessage({ type: 'focus', panel });
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set('popout', panel);
    for (const [key, value] of Object.entries(extraParams)) {
      if (value == null || value === '') params.delete(key);
      else params.set(key, value);
    }
    const url = `${window.location.pathname}?${params.toString()}`;
    const win = window.open(url, `vai-popout-${panel}`, POPOUT_PANELS[panel].features);
    if (!win) return; // popup blocked — panel stays docked
    set((s) => ({ popped: s.popped.includes(panel) ? s.popped : [...s.popped, panel] }));
  },

  reclaim: (panel) => {
    bus?.postMessage({ type: 'reclaim', panel });
    set((s) => ({ popped: s.popped.filter((p) => p !== panel) }));
  },

  _setPopped: (panel, popped) =>
    set((s) => ({
      popped: popped
        ? s.popped.includes(panel) ? s.popped : [...s.popped, panel]
        : s.popped.filter((p) => p !== panel),
    })),
}));

/** Main window: listen for popout lifecycle announcements. Call once. */
export function initPopoutMainWindow(): void {
  if (!bus) return;
  bus.onmessage = (event: MessageEvent) => {
    const msg = event.data as { type?: string; panel?: PopoutPanel };
    if (!msg?.panel) return;
    if (msg.type === 'popout-open') usePopoutStore.getState()._setPopped(msg.panel, true);
    if (msg.type === 'popout-close') usePopoutStore.getState()._setPopped(msg.panel, false);
  };
  // Ask any surviving popouts (from a previous session/reload) to re-announce.
  bus.postMessage({ type: 'roll-call' });
}

/** Popout window: announce lifecycle + honor reclaim/focus/roll-call. Call once. */
export function initPopoutChildWindow(panel: PopoutPanel): void {
  document.title = POPOUT_PANELS[panel].title;
  if (!bus) return;
  bus.postMessage({ type: 'popout-open', panel });
  bus.onmessage = (event: MessageEvent) => {
    const msg = event.data as { type?: string; panel?: PopoutPanel };
    if (msg?.type === 'roll-call') bus.postMessage({ type: 'popout-open', panel });
    if (msg?.panel !== panel) return;
    if (msg.type === 'reclaim') window.close();
    if (msg.type === 'focus') window.focus();
  };
  window.addEventListener('pagehide', () => {
    bus.postMessage({ type: 'popout-close', panel });
  });
}
