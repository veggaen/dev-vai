/**
 * Global Vai cursor + overlay store — operates at the app root level.
 *
 * This allows the AI cursor, virtual keyboard, radial menu, and action
 * log to render on TOP of the entire application layout. Vai can click
 * sidebar items, navigate templates, interact with the chat — not just
 * the sandbox iframe.
 *
 * Exposes window.__vai_cursor and window.__vai_demo globally.
 */

import { create } from 'zustand';
import type { CursorState } from '../components/sandbox/VaiCursor.js';
import type { ActionEntry, ActionType } from '../components/sandbox/ActionLog.js';

export const CURSOR_INITIAL: CursorState = {
  x: 0, y: 0, visible: false,
  clicking: false, hovering: false, typing: false,
};

interface CursorStore {
  /* ── Cursor ── */
  cursor: CursorState;

  /* ── Virtual Keyboard ── */
  kbVisible: boolean;
  kbActiveKey: string | null;

  /* ── Radial Menu ── */
  radialOpen: boolean;
  radialPos: { x: number; y: number };
  radialActiveId: string | null;

  /* ── Action Log ── */
  actions: ActionEntry[];
  screenshotCount: number;
  screenshotFlash: boolean;

  /* ── Demo ── */
  demoRunning: boolean;

  /* ── Arrow Keys overlay ── */
  arrowKeyActive: string | null; // 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | null

  /* ── Recording indicator ── */
  recording: boolean;
  recordingStartTime: number;

  /* ── Lite Keyboard overlay ── */
  liteKbVisible: boolean;
  liteKbActiveKeys: string[];     // Currently held/pressed keys
  liteKbComboText: string | null; // Human-readable combo, e.g. "Ctrl+O"

  /* ── Scroll indicator ── */
  scrollIndicatorActive: boolean;
  scrollIndicatorDeltaY: number;
  scrollIndicatorX: number;
  scrollIndicatorY: number;

  /* ── Overlay visibility ── */
  overlayVisible: boolean;

  /* ── Internal counter ── */
  _actionId: number;

  /* ── Actions ── */
  setLabel: (label: string) => void;
  moveTo: (x: number, y: number) => void;
  click: (x: number, y: number) => void;
  hover: (x: number, y: number) => void;
  focus: (x: number, y: number, label?: string) => void;
  type: (x: number, y: number, text: string) => void;
  scroll: (deltaY: number) => void;
  navigateTo: (url: string) => void;
  screenshot: () => void;
  hide: () => void;
  openRadialMenu: (x: number, y: number) => void;
  closeRadialMenu: () => void;
  selectRadialItem: (id: string) => void;
  log: (type: ActionType, message: string, detail?: string) => void;
  assertVisible: (selector: string) => void;
  assertText: (selector: string, expected: string) => void;
  toggleDemo: () => void;
  setOverlayVisible: (visible: boolean) => void;
  arrowKey: (key: string) => void;
  setRecording: (active: boolean) => void;
  pressKeys: (keys: string[], comboText?: string) => void;
  releaseKeys: () => void;
  showScroll: (deltaY: number, x: number, y: number) => void;
}

/* ── Helper: push action to the log ── */
function pushAction(
  get: () => CursorStore,
  set: (partial: Partial<CursorStore>) => void,
  type: ActionType,
  message: string,
  detail?: string,
) {
  const id = `act_${++get()._actionId}`;
  const entry: ActionEntry = { id, type, message, timestamp: Date.now(), detail };
  set({ actions: [...get().actions.slice(-200), entry] });
}

export const useCursorStore = create<CursorStore>((set, get) => ({
  cursor: { ...CURSOR_INITIAL },
  kbVisible: false,
  kbActiveKey: null,
  radialOpen: false,
  radialPos: { x: 0, y: 0 },
  radialActiveId: null,
  actions: [],
  screenshotCount: 0,
  screenshotFlash: false,
  demoRunning: false,
  arrowKeyActive: null,
  recording: false,
  recordingStartTime: 0,
  liteKbVisible: false,
  liteKbActiveKeys: [],
  liteKbComboText: null,
  scrollIndicatorActive: false,
  scrollIndicatorDeltaY: 0,
  scrollIndicatorX: 0,
  scrollIndicatorY: 0,
  overlayVisible: false,
  _actionId: 0,

  setLabel: (label: string) => {
    set({ cursor: { ...get().cursor, label } });
    pushAction(get, set, 'info', `🏷️ Cursor → ${label}`);
  },

  moveTo: (x, y) => {
    set({ cursor: { ...get().cursor, x, y, visible: true, clicking: false, hovering: false } });
    pushAction(get, set, 'move', `Move to (${Math.round(x)}, ${Math.round(y)})`);
  },

  click: (x, y) => {
    set({ cursor: { ...get().cursor, x, y, visible: true, clicking: true, hovering: false } });
    setTimeout(() => set({ cursor: { ...get().cursor, clicking: false } }), 300);
    pushAction(get, set, 'click', `Click at (${Math.round(x)}, ${Math.round(y)})`);
  },

  hover: (x, y) => {
    set({ cursor: { ...get().cursor, x, y, visible: true, hovering: true, clicking: false } });
    pushAction(get, set, 'hover', `Hover at (${Math.round(x)}, ${Math.round(y)})`);
  },

  focus: (x, y, label) => {
    set({ cursor: { ...get().cursor, x, y, visible: true, hovering: true, clicking: false, label } });
    pushAction(get, set, 'focus', label ? `Focus: ${label}` : `Focus at (${Math.round(x)}, ${Math.round(y)})`);
  },

  type: (x, y, text) => {
    set({
      cursor: { ...get().cursor, x, y, visible: true, typing: true, hovering: false },
      kbVisible: true,
    });
    pushAction(get, set, 'type', `Typing "${text.length > 30 ? text.slice(0, 30) + '…' : text}"`);

    let i = 0;
    const interval = setInterval(() => {
      if (i >= text.length) {
        clearInterval(interval);
        set({
          kbActiveKey: null,
          kbVisible: false,
          cursor: { ...get().cursor, typing: false },
        });
        return;
      }
      set({ kbActiveKey: text[i] || null });
      i++;
    }, 80);
  },

  scroll: (deltaY) => {
    pushAction(get, set, 'scroll', `Scroll ${deltaY > 0 ? 'down' : 'up'} ${Math.abs(deltaY)}px`);
  },

  navigateTo: (url) => {
    // Find the iframe in PreviewPanel if it exists
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="App Preview"]');
    if (iframe) iframe.src = url;
    pushAction(get, set, 'navigate', `Navigate to ${url}`);
  },

  screenshot: () => {
    set({ screenshotFlash: true, screenshotCount: get().screenshotCount + 1 });
    setTimeout(() => set({ screenshotFlash: false }), 300);
    pushAction(get, set, 'screenshot', 'Screenshot captured');
  },

  hide: () => {
    set({
      cursor: { ...get().cursor, visible: false },
      kbVisible: false,
    });
  },

  openRadialMenu: (x, y) => {
    set({ radialPos: { x, y }, radialOpen: true });
    pushAction(get, set, 'tool', 'Radial menu opened');
  },

  closeRadialMenu: () => {
    set({ radialOpen: false });
  },

  selectRadialItem: (id) => {
    set({ radialActiveId: id });
    pushAction(get, set, 'tool', `Selected tool: ${id}`);
    setTimeout(() => set({ radialOpen: false, radialActiveId: null }), 500);
  },

  log: (type, message, detail) => {
    pushAction(get, set, type, message, detail);
  },

  assertVisible: (selector) => {
    pushAction(get, set, 'validate', `Assert visible: ${selector}`);
  },

  assertText: (selector, expected) => {
    pushAction(get, set, 'validate', `Assert text "${expected}"`, `Selector: ${selector}`);
  },

  toggleDemo: () => {
    const state = get();
    if (state.demoRunning) {
      set({ demoRunning: false });
    } else {
      set({ demoRunning: true });
    }
  },

  setOverlayVisible: (visible) => set({ overlayVisible: visible }),

  arrowKey: (key) => {
    set({ arrowKeyActive: key });
    pushAction(get, set, 'move', `⌨ ${key.replace('Arrow', '↕ ').replace('Up', '↑').replace('Down', '↓').replace('Left', '←').replace('Right', '→')}`);
    setTimeout(() => {
      if (get().arrowKeyActive === key) set({ arrowKeyActive: null });
    }, 250);
  },

  setRecording: (active) => {
    set({ recording: active, recordingStartTime: active ? Date.now() : 0 });
    pushAction(get, set, 'info', active ? '🔴 Recording started' : '⏹ Recording stopped');
  },

  pressKeys: (keys, comboText) => {
    const displayText = comboText || keys.join('+');
    set({ liteKbVisible: true, liteKbActiveKeys: keys, liteKbComboText: displayText });
    pushAction(get, set, 'move', `⌨ ${displayText}`);
    // Auto-release after 600ms if not manually released (skip if cursor is typing)
    setTimeout(() => {
      const s = get();
      if (s.cursor.typing) return; // Don't auto-hide during typing sequences
      if (s.liteKbActiveKeys.length > 0 && s.liteKbActiveKeys[0] === keys[0]) {
        set({ liteKbVisible: false, liteKbActiveKeys: [], liteKbComboText: null });
      }
    }, 600);
  },

  releaseKeys: () => {
    if (get().cursor.typing) return; // Don't hide during typing sequences
    set({ liteKbVisible: false, liteKbActiveKeys: [], liteKbComboText: null });
  },

  showScroll: (deltaY, x, y) => {
    set({ scrollIndicatorActive: true, scrollIndicatorDeltaY: deltaY, scrollIndicatorX: x, scrollIndicatorY: y });
    pushAction(get, set, 'scroll', `${deltaY > 0 ? '↓' : '↑'} Scroll ${Math.abs(deltaY)}px at (${Math.round(x)}, ${Math.round(y)})`);
    setTimeout(() => set({ scrollIndicatorActive: false }), 800);
  },
}));

/* ══════════════════════════════════════════════════════
   Global API — window.__vai_cursor + window.__vai_demo
   ══════════════════════════════════════════════════════ */

function exposeGlobalAPI() {
  const store = useCursorStore.getState;
  const api = {
    setLabel: (label: string) => store().setLabel(label),
    moveTo: (x: number, y: number) => store().moveTo(x, y),
    click: (x: number, y: number) => store().click(x, y),
    hover: (x: number, y: number) => store().hover(x, y),
    focus: (x: number, y: number, label?: string) => store().focus(x, y, label),
    type: (x: number, y: number, text: string) => store().type(x, y, text),
    scroll: (deltaY: number) => store().scroll(deltaY),
    navigateTo: (url: string) => store().navigateTo(url),
    screenshot: () => store().screenshot(),
    hide: () => store().hide(),
    openRadialMenu: (x: number, y: number) => store().openRadialMenu(x, y),
    closeRadialMenu: () => store().closeRadialMenu(),
    selectRadialItem: (id: string) => store().selectRadialItem(id),
    log: (type: ActionType, message: string, detail?: string) => store().log(type, message, detail),
    assertVisible: (selector: string) => store().assertVisible(selector),
    assertText: (selector: string, expected: string) => store().assertText(selector, expected),
    arrowKey: (key: string) => store().arrowKey(key),
    setRecording: (active: boolean) => store().setRecording(active),
    pressKeys: (keys: string[], comboText?: string) => store().pressKeys(keys, comboText),
    releaseKeys: () => store().releaseKeys(),
    showScroll: (deltaY: number, x: number, y: number) => store().showScroll(deltaY, x, y),
    getState: () => {
      const s = store();
      return {
        cursor: s.cursor,
        kbVisible: s.kbVisible,
        radialOpen: s.radialOpen,
        actionCount: s.actions.length,
        screenshotCount: s.screenshotCount,
        arrowKeyActive: s.arrowKeyActive,
        recording: s.recording,
        recordingStartTime: s.recordingStartTime,
        liteKbVisible: s.liteKbVisible,
        liteKbActiveKeys: s.liteKbActiveKeys,
        liteKbComboText: s.liteKbComboText,
        scrollIndicatorActive: s.scrollIndicatorActive,
      };
    },
  };

  (window as unknown as Record<string, unknown>).__vai_cursor = api;
  // Expose store directly for demo system (realTypeInEl needs setState access)
  (window as unknown as Record<string, unknown>).__vai_cursor_store = useCursorStore;
}

// Expose immediately on module load — always available
exposeGlobalAPI();

// Re-expose on HMR to keep the API alive during development
if ((import.meta as unknown as { hot?: { accept: (cb: () => void) => void } }).hot) {
  (import.meta as unknown as { hot: { accept: (cb: () => void) => void } }).hot.accept(() => exposeGlobalAPI());
}
