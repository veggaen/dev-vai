import { create } from 'zustand';
import { environmentSchema, type SavedEnvironment } from '@vai/contracts/adoption';
import { apiFetch, refreshApiConnectionBase } from '../lib/api.js';
import { PERSISTED_NAMES } from '@vai/constants';

const ACTIVE_ENVIRONMENT_KEY = PERSISTED_NAMES.activeEnvironment;
const ACTIVE_ENVIRONMENT_RECORD_KEY = PERSISTED_NAMES.activeEnvironmentRecord;

function locallySelectedEnvironment(): SavedEnvironment[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ACTIVE_ENVIRONMENT_RECORD_KEY);
    if (!raw) return [];
    const parsed = environmentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? [parsed.data] : [];
  } catch { return []; }
}
interface EnvironmentState {
  environments: SavedEnvironment[];
  activeEnvironmentId: string | null;
  loading: boolean;
  fetchEnvironments: () => Promise<void>;
  setActiveEnvironment: (id: string | null) => void;
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  environments: locallySelectedEnvironment(),
  activeEnvironmentId: typeof localStorage === 'undefined' ? null : localStorage.getItem(ACTIVE_ENVIRONMENT_KEY),
  loading: false,
  fetchEnvironments: async () => {
    set({ loading: true });
    try {
      const response = await apiFetch('/api/environments');
      if (!response.ok) throw new Error(`Environment request failed (${response.status})`);
      const body = await response.json() as { environments?: unknown[] };
      const environments = (body.environments ?? []).flatMap((value) => {
        const parsed = environmentSchema.safeParse(value); return parsed.success ? [parsed.data] : [];
      });
      const selected = locallySelectedEnvironment()[0];
      set({ environments: selected && !environments.some((item) => item.id === selected.id) ? [selected, ...environments] : environments, loading: false });
    } catch { set({ loading: false }); }
  },
  setActiveEnvironment: (activeEnvironmentId) => {
    if (typeof localStorage !== 'undefined') {
      const environment = get().environments.find((item) => item.id === activeEnvironmentId);
      if (activeEnvironmentId && environment) {
        localStorage.setItem(ACTIVE_ENVIRONMENT_KEY, activeEnvironmentId);
        localStorage.setItem(ACTIVE_ENVIRONMENT_RECORD_KEY, JSON.stringify(environment));
      } else {
        localStorage.removeItem(ACTIVE_ENVIRONMENT_KEY);
        localStorage.removeItem(ACTIVE_ENVIRONMENT_RECORD_KEY);
      }
    }
    refreshApiConnectionBase();
    set({ activeEnvironmentId });
  },
}));
