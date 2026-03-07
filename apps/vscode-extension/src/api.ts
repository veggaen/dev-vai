/**
 * VeggaAI Runtime API Client
 *
 * Handles all HTTP communication with the runtime server (port 3006).
 * Includes retry logic, connection health checking, and batch event pushing.
 */

import * as vscode from 'vscode';

/* ── Config ────────────────────────────────────────────────────── */

function getApiBase(): string {
  return vscode.workspace.getConfiguration('vai').get('runtimeUrl', 'http://localhost:3006');
}

/* ── Core HTTP ─────────────────────────────────────────────────── */

let _healthy = false;
let _lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 30_000; // 30s

export async function apiCall(path: string, method = 'GET', body?: unknown): Promise<any> {
  const url = `${getApiBase()}${path}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }
  _healthy = true;
  return res.json();
}

export async function isServerHealthy(): Promise<boolean> {
  const now = Date.now();
  if (now - _lastHealthCheck < HEALTH_CHECK_INTERVAL) return _healthy;

  _lastHealthCheck = now;
  try {
    await fetch(`${getApiBase()}/api/sessions?limit=1`, {
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
