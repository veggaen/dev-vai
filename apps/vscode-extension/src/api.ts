/**
 * VeggaAI Runtime API Client
 *
 * Handles all HTTP communication with the runtime server (port 3006).
 * Includes retry logic, connection health checking, and batch event pushing.
 */

import * as vscode from 'vscode';

/* ── Config ────────────────────────────────────────────────────── */

type AuthTokenProvider = () => string | undefined | Promise<string | undefined>;
type ClientMetadata = {
  installationKey?: string;
  clientName?: string;
  clientType?: string;
  launchTarget?: string;
  capabilities?: string[];
  companionClientId?: string;
};
type ClientMetadataProvider = () => ClientMetadata | undefined | Promise<ClientMetadata | undefined>;

let authTokenProvider: AuthTokenProvider | null = null;
let clientMetadataProvider: ClientMetadataProvider | null = null;

export function getApiBase(): string {
  return vscode.workspace.getConfiguration('vai').get('runtimeUrl', 'http://localhost:3006');
}

export function setAuthTokenProvider(provider: AuthTokenProvider | null): void {
  authTokenProvider = provider;
}

export function setClientMetadataProvider(provider: ClientMetadataProvider | null): void {
  clientMetadataProvider = provider;
}

async function buildHeaders(headers?: RequestInit['headers'], hasBody = true): Promise<Headers> {
  const merged = new Headers(headers);
  if (hasBody && !merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }

  const token = authTokenProvider ? await authTokenProvider() : undefined;
  if (token && !merged.has('Authorization')) {
    merged.set('Authorization', `Bearer ${token}`);
  }

  const metadata = clientMetadataProvider ? await clientMetadataProvider() : undefined;
  if (metadata?.installationKey && !merged.has('x-vai-installation-key')) {
    merged.set('x-vai-installation-key', metadata.installationKey);
  }
  if (metadata?.clientName && !merged.has('x-vai-client-name')) {
    merged.set('x-vai-client-name', metadata.clientName);
  }
  if (metadata?.clientType && !merged.has('x-vai-client-type')) {
    merged.set('x-vai-client-type', metadata.clientType);
  }
  if (metadata?.launchTarget && !merged.has('x-vai-launch-target')) {
    merged.set('x-vai-launch-target', metadata.launchTarget);
  }
  if (metadata?.capabilities?.length && !merged.has('x-vai-client-capabilities')) {
    merged.set('x-vai-client-capabilities', JSON.stringify(metadata.capabilities));
  }
  if (metadata?.companionClientId && !merged.has('x-vai-companion-client-id')) {
    merged.set('x-vai-companion-client-id', metadata.companionClientId);
  }

  return merged;
}

/* ── Core HTTP ─────────────────────────────────────────────────── */

let _healthy = false;
let _lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 30_000; // 30s

export async function apiCall(path: string, method = 'GET', body?: unknown, init?: RequestInit): Promise<any> {
  const url = `${getApiBase()}${path}`;
  const opts: RequestInit = {
    method,
    ...init,
    headers: await buildHeaders(init?.headers, body !== undefined),
    signal: AbortSignal.timeout(5000),
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }
  _healthy = true;
  if (res.status === 204) {
    return null;
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    return text.length ? text : null;
  }
  return res.json();
}

export async function isServerHealthy(): Promise<boolean> {
  const now = Date.now();
  if (now - _lastHealthCheck < HEALTH_CHECK_INTERVAL) return _healthy;

  _lastHealthCheck = now;
  try {
    await fetch(`${getApiBase()}/api/sessions?limit=1`, {
      headers: await buildHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    _healthy = true;
  } catch {
    _healthy = false;
  }
  return _healthy;
}

export function isHealthy(): boolean {
  return _healthy;
}
