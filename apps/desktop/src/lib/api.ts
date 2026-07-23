/**
 * API base URL — adapts to environment:
 * - Dev (Vite on 5173/5174): empty string → requests go through Vite proxy (no CORS)
 * - Tauri / production: direct to localhost:3006
 */
import { DEV_AUTH_BYPASS_QUERY_PARAM, isDevAuthBypassEnabled } from './dev-auth-bypass.js';
import { PERSISTED_NAMES, PORTS, VITE_PROXIED_PORTS, loopbackHttpUrl, loopbackWebSocketUrl } from '@vai/constants';

const SESSION_TOKEN_KEY = PERSISTED_NAMES.platformSessionToken;
const DEV_AUTH_BYPASS_HEADER = 'x-vai-dev-auth-bypass';
let sessionTokenMemory: string | null | undefined;
let sessionHydration: Promise<string | null> | null = null;

/** Ports served by Vite (dev 5173/5174, preview 4173) — these proxy the runtime, so relative URLs avoid CORS. */
const VITE_PROXY_PORT_STRINGS = new Set(VITE_PROXIED_PORTS.map(String));

function getApiBase(): string {
  if (typeof window === 'undefined') return loopbackHttpUrl();
  try {
    const raw = window.localStorage.getItem(PERSISTED_NAMES.activeEnvironmentRecord);
    if (raw) {
      const record = JSON.parse(raw) as { endpoint?: unknown };
      if (typeof record.endpoint === 'string' && /^https?:\/\//i.test(record.endpoint)) return record.endpoint.replace(/\/$/, '');
    }
  } catch { /* a corrupt client hint falls back to local */ }
  if (VITE_PROXY_PORT_STRINGS.has(window.location.port)) return '';
  return loopbackHttpUrl();
}

function getWsBase(): string {
  if (typeof window === 'undefined') return loopbackWebSocketUrl();
  const apiBase = getApiBase();
  if (apiBase) return apiBase.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  const port = window.location.port;
  // `vite preview` (4173) proxies HTTP but not WebSockets — connect WS directly.
  if (port === String(PORTS.viteDev) || port === String(PORTS.viteDevAlternate)) return `ws://${window.location.host}`;
  return loopbackWebSocketUrl();
}

export let API_BASE = getApiBase();
export let WS_BASE = getWsBase();

/** Refresh legacy live bindings after the active environment changes. New
 * requests already resolve dynamically; this keeps older consumers on the same
 * selected connection without requiring an application restart. */
export function refreshApiConnectionBase(): void {
  API_BASE = getApiBase();
  WS_BASE = getWsBase();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key === PERSISTED_NAMES.activeEnvironmentRecord) refreshApiConnectionBase();
  });
}

export function buildChatWebSocketUrl(): string {
  const url = `${getWsBase()}/api/chat`;
  const params = new URLSearchParams();

  if (isDevAuthBypassEnabled()) params.set(DEV_AUTH_BYPASS_QUERY_PARAM, '1');

  const query = params.toString();
  return query ? `${url}?${query}` : url;
}

/**
 * Browser WebSockets cannot set Authorization. Desktop device credentials are
 * therefore carried in a private subprotocol token, never in a URL (where they
 * would leak into history, logs, screenshots, and proxy telemetry).
 */
export function buildChatWebSocketProtocols(): string[] {
  const token = getApiSessionToken();
  if (!token) return [];
  const bytes = new TextEncoder().encode(token);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return [`vai.auth.${encoded}`];
}

export function getApiSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  if (sessionTokenMemory !== undefined) return sessionTokenMemory;
  // Browser OAuth uses the httpOnly cookie. This persisted bearer token is
  // reserved for desktop device-link sessions. The localStorage copy also
  // migrates older installs into native protected storage during hydration.
  sessionTokenMemory = window.localStorage.getItem(SESSION_TOKEN_KEY);
  return sessionTokenMemory;
}

export function setApiSessionToken(token: string | null): void {
  if (typeof window === 'undefined') return;

  sessionTokenMemory = token;

  if (token) {
    window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    return;
  }

  window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

function isTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function writeNativeSessionToken(token: string | null): Promise<void> {
  if (!isTauriApp()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('save_desktop_session_token', { token });
}

/** Persist a desktop bearer credential in both the active WebView and the
 * Windows-user-protected native vault. */
export async function persistApiSessionToken(token: string | null): Promise<void> {
  setApiSessionToken(token);
  try {
    await writeNativeSessionToken(token);
  } catch (error) {
    if (token === null && isTauriApp()) throw error;
    // Browser storage remains the cross-platform fallback. A native vault
    // failure must not turn a successful login into a failed login.
  }
}

/** Restore native desktop auth before the first authenticated API request.
 * Existing localStorage-only installs migrate forward without another login. */
export function hydrateApiSessionToken(): Promise<string | null> {
  if (sessionHydration) return sessionHydration;
  sessionHydration = (async () => {
    const webToken = getApiSessionToken();
    if (!isTauriApp()) return webToken;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const nativeToken = await invoke<string | null>('load_desktop_session_token');
      if (nativeToken) {
        setApiSessionToken(nativeToken);
        return nativeToken;
      }
      if (webToken) {
        await writeNativeSessionToken(webToken);
      }
    } catch {
      // Keep the already-loaded WebView token if native storage is unavailable.
    }
    return webToken;
  })();
  return sessionHydration;
}

/** Dev auth bypass applies only to runtime API calls — not fonts, CDN, or sandbox assets. */
function shouldAttachDevAuthBypass(path: string): boolean {
  const normalized = path.startsWith('http')
    ? new URL(path).pathname
    : path.split('?')[0] ?? path;
  return normalized.startsWith('/api');
}

export function buildApiHeaders(headers?: HeadersInit, requestPath?: string): Headers {
  const nextHeaders = new Headers(headers ?? undefined);
  const sessionToken = getApiSessionToken();

  if (sessionToken) {
    nextHeaders.set('authorization', `Bearer ${sessionToken}`);
  }

  if (isDevAuthBypassEnabled() && requestPath && shouldAttachDevAuthBypass(requestPath)) {
    nextHeaders.set(DEV_AUTH_BYPASS_HEADER, '1');
  }

  return nextHeaders;
}

export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = buildApiHeaders(init?.headers, input);

  return fetch(`${getApiBase()}${input}`, {
    credentials: 'include',
    ...init,
    headers,
  });
}
