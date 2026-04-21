import { create } from 'zustand';
import { API_BASE, apiFetch } from '../lib/api.js';
import type { ChatMode } from './layoutStore.js';

interface ModelInfo {
  id: string;
  displayName: string;
  provider: string;
  supportsStreaming: boolean;
  supportsToolUse: boolean;
}

interface FrontendInfo {
  id: string;
  framework: string;
  role: string;
  sharesRuntime: boolean;
  backedByStack?: string;
}

interface InvitePreset {
  peerKey: string;
  displayName: string;
  model: string;
  recommended: boolean;
}

interface IdeTargetInfo {
  id: string;
  label: string;
  directLaunch: boolean;
  collaborationMode: string;
  invitePresets: InvitePreset[];
}

type AuthProviderId = 'google' | 'workos';

interface AuthProviderInfo {
  enabled: boolean;
  label: string;
}

interface PlatformBootstrap {
  product: {
    name: string;
    defaultFrontend: string;
    frontendAlternatives: string[];
    runtime: string;
  };
  frontends: FrontendInfo[];
  models: {
    defaultModelId: string;
    available: ModelInfo[];
  };
  workflow: {
    defaultMode: ChatMode;
    modes: ChatMode[];
  };
  auth: {
    enabled: boolean;
    defaultProvider?: AuthProviderId | null;
    providers: {
      google: AuthProviderInfo;
      workos: AuthProviderInfo;
    };
    authenticated: boolean;
    user: null | {
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
    };
  };
  collaboration: {
    ideTargets: IdeTargetInfo[];
    auditPolicy: {
      implemented: boolean;
      note: string;
    };
  };
}

const FRONTEND_STORAGE_KEY = 'vai-selected-frontend';
const FALLBACK_MODEL_ID = 'vai:v0';
const FALLBACK_FRONTEND_ID = 'vite-web';

const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: FALLBACK_MODEL_ID,
    displayName: 'VeggaAI v0',
    provider: 'vai',
    supportsStreaming: true,
    supportsToolUse: false,
  },
];

const FALLBACK_FRONTENDS: FrontendInfo[] = [
  {
    id: FALLBACK_FRONTEND_ID,
    framework: 'vite',
    role: 'current-primary-web-shell',
    sharesRuntime: true,
  },
  {
    id: 'vinext-web',
    framework: 'vinext',
    role: 'alternate-web-shell',
    sharesRuntime: true,
    backedByStack: 'vinext',
  },
];

interface SettingsState {
  apiBase: string;
  selectedModelId: string | null;
  models: ModelInfo[];
  selectedFrontendId: string | null;
  frontends: FrontendInfo[];
  ideTargets: IdeTargetInfo[];
  workflowModes: ChatMode[];
  defaultConversationMode: ChatMode;
  bootstrap: PlatformBootstrap | null;
  setSelectedModelId: (id: string) => void;
  setSelectedFrontendId: (id: string) => void;
  fetchBootstrap: () => Promise<PlatformBootstrap | null>;
  fetchModels: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  apiBase: API_BASE,
  selectedModelId: null,
  models: [],
  selectedFrontendId: null,
  frontends: [],
  ideTargets: [],
  workflowModes: ['chat', 'agent', 'builder', 'plan', 'debate'],
  defaultConversationMode: 'chat',
  bootstrap: null,

  setSelectedModelId: (id) => set({ selectedModelId: id }),
  setSelectedFrontendId: (id) => {
    localStorage.setItem(FRONTEND_STORAGE_KEY, id);
    set({ selectedFrontendId: id });
  },

  fetchBootstrap: async () => {
    try {
      const res = await apiFetch('/api/platform/bootstrap');
      if (!res.ok) {
        throw new Error(`Bootstrap failed with status ${res.status}`);
      }
      const bootstrap = (await res.json()) as PlatformBootstrap;
      const models = bootstrap.models.available.length > 0 ? bootstrap.models.available : FALLBACK_MODELS;
      const frontends = bootstrap.frontends.length > 0 ? bootstrap.frontends : FALLBACK_FRONTENDS;
      const savedFrontendId = localStorage.getItem(FRONTEND_STORAGE_KEY);
      const nextFrontendId = frontends.some((frontend) => frontend.id === savedFrontendId)
        ? savedFrontendId
        : (bootstrap.product.defaultFrontend || FALLBACK_FRONTEND_ID);

      set({
        bootstrap,
        models,
        frontends,
        ideTargets: bootstrap.collaboration.ideTargets,
        workflowModes: bootstrap.workflow.modes,
        defaultConversationMode: bootstrap.workflow.defaultMode,
        selectedModelId: models.some((model) => model.id === bootstrap.models.defaultModelId)
          ? bootstrap.models.defaultModelId
          : (models[0]?.id ?? FALLBACK_MODEL_ID),
        selectedFrontendId: nextFrontendId,
      });
      return bootstrap;
    } catch {
      set((state) => ({
        models: state.models.length > 0 ? state.models : FALLBACK_MODELS,
        frontends: state.frontends.length > 0 ? state.frontends : FALLBACK_FRONTENDS,
        selectedModelId: state.selectedModelId ?? FALLBACK_MODEL_ID,
        selectedFrontendId: state.selectedFrontendId ?? FALLBACK_FRONTEND_ID,
      }));
      console.error('Failed to fetch platform bootstrap');
      return null;
    }
  },

  fetchModels: async () => {
    await useSettingsStore.getState().fetchBootstrap();
  },
}));
