import { create } from 'zustand';
import {
  DEFAULT_SHORTCUTS,
  getDefaultShortcut,
  type ShortcutDefinition,
  type ShortcutId,
} from '../lib/keyboard-shortcuts.js';

const STORAGE_KEY = 'vai-keyboard-shortcuts';

type Overrides = Partial<Record<ShortcutId, string>>;

function loadOverrides(): Overrides {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) as Overrides : {};
  } catch {
    return {};
  }
}

function saveOverrides(overrides: Overrides): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    }
  } catch {
    // ignore
  }
}

interface ShortcutsState {
  overrides: Overrides;
  getKeys: (id: ShortcutId) => string;
  getAll: () => ShortcutDefinition[];
  setOverride: (id: ShortcutId, keys: string) => void;
  clearOverride: (id: ShortcutId) => void;
  resetAll: () => void;
}

export const useShortcutsStore = create<ShortcutsState>((set, get) => ({
  overrides: loadOverrides(),

  getKeys: (id) => get().overrides[id] ?? getDefaultShortcut(id).keys,

  getAll: () => DEFAULT_SHORTCUTS.map((def) => ({
    ...def,
    keys: get().overrides[def.id] ?? def.keys,
  })),

  setOverride: (id, keys) => {
    set((state) => {
      const overrides = { ...state.overrides, [id]: keys };
      saveOverrides(overrides);
      return { overrides };
    });
  },

  clearOverride: (id) => {
    set((state) => {
      const overrides = { ...state.overrides };
      delete overrides[id];
      saveOverrides(overrides);
      return { overrides };
    });
  },

  resetAll: () => {
    saveOverrides({});
    set({ overrides: {} });
  },
}));
