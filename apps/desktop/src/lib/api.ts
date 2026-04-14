/**
 * API base URL — adapts to environment:
 * - Dev (Vite on 5173/5174): empty string → requests go through Vite proxy (no CORS)
 * - Tauri / production: direct to localhost:3006
 */
const SESSION_TOKEN_KEY = 'vai-platform-session-token';

function getApiBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:3006';
  const port = window.location.port;
  // In Vite dev mode, use relative URLs (proxied)
  if (port === '5173' || port === '5174') return '';
  return 'http://localhost:3006';
}

function getWsBase(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3006';
  const port = window.location.port;
  if (port === '5173' || port === '5174') return `ws://${window.location.host}`;
  return 'ws://localhost:3006';
}

export const API_BASE = getApiBase();
export const WS_BASE = getWsBase();

export function getApiSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(SESSION_TOKEN_KEY);
}

export function setApiSessionToken(token: string | null): void {
  if (typeof window === 'undefined') return;

  if (token) {
    window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    return;
  }

  window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers ?? undefined);
  const sessionToken = getApiSessionToken();

  if (sessionToken) {
    headers.set('authorization', `Bearer ${sessionToken}`);
  }

  return fetch(`${API_BASE}${input}`, {
    credentials: 'include',
    ...init,
    headers,
  });
}
