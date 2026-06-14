/**
 * API base URL — adapts to environment:
 * - Dev (Vite on 5173/5174): empty string → requests go through Vite proxy (no CORS)
 * - Tauri / production: direct to localhost:3006
 */
import { DEV_AUTH_BYPASS_QUERY_PARAM, isDevAuthBypassEnabled } from './dev-auth-bypass.js';

const SESSION_TOKEN_KEY = 'vai-platform-session-token';
const DEV_AUTH_BYPASS_HEADER = 'x-vai-dev-auth-bypass';

/** Ports served by Vite (dev 5173/5174, preview 4173) — these proxy the runtime, so relative URLs avoid CORS. */
const VITE_PROXIED_PORTS = new Set(['5173', '5174', '4173']);

function getApiBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:3006';
  if (VITE_PROXIED_PORTS.has(window.location.port)) return '';
  return 'http://localhost:3006';
}

function getWsBase(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3006';
  const port = window.location.port;
  // `vite preview` (4173) proxies HTTP but not WebSockets — connect WS directly.
  if (port === '5173' || port === '5174') return `ws://${window.location.host}`;
  return 'ws://localhost:3006';
}

export const API_BASE = getApiBase();
export const WS_BASE = getWsBase();

export function buildChatWebSocketUrl(): string {
  const url = `${WS_BASE}/api/chat`;
  const params = new URLSearchParams();

  // Browsers can't set an Authorization header on a WebSocket, so the session
  // token rides as a query param. Without this, an authenticated desktop chat
  // socket connects anonymously and every send fails with
  // "Sign in to update this conversation".
  const sessionToken = getApiSessionToken();
  if (sessionToken) params.set('access_token', sessionToken);

  if (isDevAuthBypassEnabled()) params.set(DEV_AUTH_BYPASS_QUERY_PARAM, '1');

  const query = params.toString();
  return query ? `${url}?${query}` : url;
}

export function getApiSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  // Browser OAuth uses the httpOnly cookie. This persisted bearer token is
  // reserved for desktop device-link sessions until native secure storage lands.
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

  return fetch(`${API_BASE}${input}`, {
    credentials: 'include',
    ...init,
    headers,
  });
}
