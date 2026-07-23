import { create } from 'zustand';
import { apiFetch, API_BASE, persistApiSessionToken } from '../lib/api.js';

interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

type AuthProviderId = 'google' | 'workos';

interface AuthProviderInfo {
  enabled: boolean;
  label: string;
}

interface AuthBootstrap {
  enabled: boolean;
  defaultProvider?: AuthProviderId | null;
  providers: {
    google: AuthProviderInfo;
    workos: AuthProviderInfo;
  };
  authenticated: boolean;
  role?: AppRole;
  user: AuthUser | null;
}

interface DeviceLinkStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
}

interface DeviceLinkPollResponse {
  status: 'pending' | 'approved';
  expiresAt: string;
  sessionToken?: string;
}

type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'anonymous' | 'error';

/** Platform role — determines navigation scope and permissions */
export type AppRole = 'builder' | 'admin' | 'owner';

const OWNER_FEATURES_HIDDEN_KEY = 'vai-owner-features-hidden';

function readOwnerFeaturesHidden(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(OWNER_FEATURES_HIDDEN_KEY) === '1';
}

function writeOwnerFeaturesHidden(hidden: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(OWNER_FEATURES_HIDDEN_KEY, hidden ? '1' : '0');
}

interface AuthState {
  status: AuthStatus;
  enabled: boolean;
  providerId: AuthProviderId | null;
  providerLabel: string | null;
  user: AuthUser | null;
  /** Derived platform role: owner > admin > builder */
  role: AppRole;
  isOwner: boolean;
  ownerFeaturesHidden: boolean;
  browserLinking: boolean;
  error: string | null;
  syncBootstrap: (auth: AuthBootstrap | null | undefined) => void;
  fetchSession: () => Promise<void>;
  startLogin: () => void;
  startLoginInBrowser: () => Promise<void>;
  logout: () => Promise<void>;
  setOwnerFeaturesHidden: (hidden: boolean) => void;
  toggleOwnerFeaturesHidden: () => void;
}

function isTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function resolveProviderId(auth: AuthBootstrap): AuthProviderId | null {
  if (auth.defaultProvider && auth.providers[auth.defaultProvider].enabled) {
    return auth.defaultProvider;
  }

  if (auth.providers.workos.enabled) {
    return 'workos';
  }

  if (auth.providers.google.enabled) {
    return 'google';
  }

  return null;
}

function buildLoginUrl(providerId?: AuthProviderId | null): string {
  const currentUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}${window.location.search}`
    : '/';
  const basePath = providerId ? `/api/auth/${providerId}/start` : '/api/auth/start';
  return `${API_BASE}${basePath}?returnTo=${encodeURIComponent(currentUrl)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function pollForDeviceApproval(deviceCode: string, intervalSeconds: number, expiresAt: string): Promise<void> {
  const deadline = Date.parse(expiresAt);

  while (!Number.isNaN(deadline) && Date.now() < deadline) {
    const response = await apiFetch('/api/auth/device/poll', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ deviceCode }),
    });

    if (response.ok) {
      const payload = await response.json() as DeviceLinkPollResponse;
      if (payload.status === 'approved') {
        if (payload.sessionToken) {
          await persistApiSessionToken(payload.sessionToken);
        }
        return;
      }
    } else if (response.status === 410) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error || 'Browser sign-in expired. Start again.');
    } else {
      throw new Error('Desktop sign-in polling failed.');
    }

    await sleep(Math.max(intervalSeconds, 1) * 1000);
  }

  throw new Error('Browser sign-in timed out. Start again.');
}

function deriveRole(auth: AuthBootstrap): AppRole {
  return auth.authenticated ? (auth.role ?? 'builder') : 'builder';
}

function resolveBootstrap(auth: AuthBootstrap) {
  const role = deriveRole(auth);
  const isOwner = role === 'owner';
  const providerId = resolveProviderId(auth);

  return {
    enabled: auth.enabled,
    providerId,
    providerLabel: providerId ? auth.providers[providerId].label : null,
    user: auth.user,
    role,
    isOwner,
    ownerFeaturesHidden: isOwner ? readOwnerFeaturesHidden() : false,
    browserLinking: false,
    status: auth.enabled
      ? (auth.authenticated ? 'authenticated' as const : 'anonymous' as const)
      : 'idle' as const,
    error: null,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  enabled: false,
  providerId: null,
  providerLabel: null,
  user: null,
  role: 'builder',
  isOwner: false,
  ownerFeaturesHidden: readOwnerFeaturesHidden(),
  browserLinking: false,
  error: null,

  syncBootstrap: (auth) => {
    if (!auth) return;
    set(resolveBootstrap(auth));
  },

  fetchSession: async () => {
    set((state) => ({
      status: state.enabled ? 'loading' : state.status,
      error: null,
    }));

    try {
      const response = await apiFetch('/api/auth/me');
      const payload = await response.json() as AuthBootstrap;
      // Preserve the protected desktop credential when one runtime reports
      // anonymous. Debug/release secret mismatches can make a valid token
      // temporarily unverifiable. A new login replaces it; only logout clears it.
      set(resolveBootstrap(payload));
    } catch {
      // Network failure — the runtime is unreachable (starting up / restarting).
      // This is NOT "signed out": keep the user's auth intact and let the gate
      // show a reconnect state. The 4s poll self-heals when the runtime returns.
      set({
        browserLinking: false,
        status: 'error',
        error: 'Unable to load platform session state.',
      });
    }
  },

  startLogin: () => {
    const url = buildLoginUrl(get().providerId);
    window.location.assign(url);
  },

  startLoginInBrowser: async () => {
    set({
      browserLinking: true,
      error: null,
    });

    try {
      const response = await apiFetch('/api/auth/device/start', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          clientName: 'VeggaAI Desktop',
          clientType: 'desktop',
          launchTarget: 'desktop',
          capabilities: ['shell-auth'],
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to start browser sign-in.');
      }

      const payload = await response.json() as DeviceLinkStartResponse;

      if (isTauriApp()) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_external', { target: payload.verificationUri });
      } else {
        window.open(payload.verificationUri, '_blank', 'noopener,noreferrer');
      }

      await pollForDeviceApproval(payload.deviceCode, payload.intervalSeconds, payload.expiresAt);
      await useAuthStore.getState().fetchSession();
    } catch (error) {
      set({
        browserLinking: false,
        status: 'anonymous',
        error: error instanceof Error ? error.message : 'Unable to complete browser sign-in.',
      });
    }
  },

  logout: async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      // Logging out this desktop must clear its local protected credential even
      // if the runtime is temporarily unreachable.
      await persistApiSessionToken(null);
      set({
        user: null,
        role: 'builder',
        isOwner: false,
        ownerFeaturesHidden: false,
        browserLinking: false,
        status: 'anonymous',
        error: null,
      });
    }
  },

  setOwnerFeaturesHidden: (hidden) => {
    writeOwnerFeaturesHidden(hidden);
    set((state) => ({
      ownerFeaturesHidden: state.isOwner ? hidden : false,
    }));
  },

  toggleOwnerFeaturesHidden: () => {
    const { isOwner, ownerFeaturesHidden } = useAuthStore.getState();
    if (!isOwner) {
      return;
    }

    const next = !ownerFeaturesHidden;
    writeOwnerFeaturesHidden(next);
    set({ ownerFeaturesHidden: next });
  },
}));
