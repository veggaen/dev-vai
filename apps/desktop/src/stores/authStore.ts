import { create } from 'zustand';
import { apiFetch, API_BASE, setApiSessionToken } from '../lib/api.js';

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

/** Sync with server `VAI_OWNER_EMAIL` — set `VITE_VAI_OWNER_EMAIL` at desktop build time if you override the server default. */
const OWNER_EMAIL = (import.meta.env.VITE_VAI_OWNER_EMAIL?.trim() || 'v3ggat@gmail.com').toLowerCase();

/** Admin emails — add here or derive from backend in the future */
const ADMIN_EMAILS: string[] = [];
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
          setApiSessionToken(payload.sessionToken);
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

function matchesOwner(user: AuthUser | null): boolean {
  return user?.email?.trim().toLowerCase() === OWNER_EMAIL;
}

function deriveRole(user: AuthUser | null): AppRole {
  if (!user) return 'builder';
  const email = user.email?.trim().toLowerCase();
  if (email === OWNER_EMAIL) return 'owner';
  if (ADMIN_EMAILS.includes(email ?? '')) return 'admin';
  return 'builder';
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
    const isOwner = matchesOwner(auth.user);
    const role = deriveRole(auth.user);
    const providerId = resolveProviderId(auth);
    set({
      enabled: auth.enabled,
      providerId,
      providerLabel: providerId ? auth.providers[providerId].label : null,
      user: auth.user,
      role,
      isOwner,
      ownerFeaturesHidden: isOwner ? readOwnerFeaturesHidden() : false,
      browserLinking: false,
      status: auth.enabled
        ? (auth.authenticated ? 'authenticated' : 'anonymous')
        : 'idle',
      error: null,
    });
  },

  fetchSession: async () => {
    set((state) => ({
      status: state.enabled ? 'loading' : state.status,
      error: null,
    }));

    try {
      const response = await apiFetch('/api/auth/me');
      const payload = await response.json() as AuthBootstrap;
      const isOwner = matchesOwner(payload.user);
      const role = deriveRole(payload.user);
      const providerId = resolveProviderId(payload);

      set({
        enabled: payload.enabled,
        providerId,
        providerLabel: providerId ? payload.providers[providerId].label : null,
        user: payload.user,
        role,
        isOwner,
        ownerFeaturesHidden: isOwner ? readOwnerFeaturesHidden() : false,
        browserLinking: false,
        status: payload.enabled
          ? (payload.authenticated ? 'authenticated' : 'anonymous')
          : 'idle',
        error: null,
      });
    } catch {
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
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setApiSessionToken(null);
    set({
      user: null,
      role: 'builder',
      isOwner: false,
      ownerFeaturesHidden: false,
      browserLinking: false,
      status: 'anonymous',
      error: null,
    });
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