import { create } from 'zustand';

const STORAGE_KEY = 'vai-game-dictation-v1';

interface StoredGameDictationSettings {
  readonly leagueOpenAndPaste?: boolean;
}

export function parseGameDictationSettings(raw: string | null): boolean {
  if (!raw) return true;
  try {
    const value = JSON.parse(raw) as StoredGameDictationSettings;
    return value.leagueOpenAndPaste === true;
  } catch {
    return false;
  }
}

function loadLeagueOpenAndPaste(): boolean {
  try {
    return parseGameDictationSettings(
      typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY),
    );
  } catch {
    return false;
  }
}

function persistLeagueOpenAndPaste(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ leagueOpenAndPaste: enabled }));
    }
  } catch {
    // A preference write must never break dictation.
  }
}

interface GameDictationState {
  leagueOpenAndPaste: boolean;
  setLeagueOpenAndPaste: (enabled: boolean) => void;
}

export const useGameDictationStore = create<GameDictationState>((set) => ({
  leagueOpenAndPaste: loadLeagueOpenAndPaste(),
  setLeagueOpenAndPaste: (enabled) => {
    persistLeagueOpenAndPaste(enabled);
    set({ leagueOpenAndPaste: enabled });
  },
}));
