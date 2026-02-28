import { create } from 'zustand';
import { API_BASE } from '../lib/api.js';

interface ModelInfo {
  id: string;
  displayName: string;
  supportsStreaming: boolean;
  supportsToolUse: boolean;
}

interface SettingsState {
  apiBase: string;
  selectedModelId: string | null;
  models: ModelInfo[];
  setSelectedModelId: (id: string) => void;
  fetchModels: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  apiBase: API_BASE,
  selectedModelId: null,
  models: [],

  setSelectedModelId: (id) => set({ selectedModelId: id }),

  fetchModels: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/models`);
      const models = (await res.json()) as ModelInfo[];
      set({
        models,
        selectedModelId: models.length > 0 ? models[0].id : null,
      });
    } catch {
      console.error('Failed to fetch models');
    }
  },
}));
