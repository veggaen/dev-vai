import manifest from './platform-values.json';

export const PLATFORM_VALUES = Object.freeze({
  ports: Object.freeze({ ...manifest.ports }),
  publicEndpoints: Object.freeze({ ...manifest.publicEndpoints }),
  persistedNames: Object.freeze({ ...manifest.persistedNames }),
  limits: Object.freeze({ ...manifest.limits }),
  timeoutsMs: Object.freeze({ ...manifest.timeoutsMs }),
});

export const PORTS = PLATFORM_VALUES.ports;
export const PUBLIC_ENDPOINTS = PLATFORM_VALUES.publicEndpoints;
export const PERSISTED_NAMES = PLATFORM_VALUES.persistedNames;
export const LIMITS = PLATFORM_VALUES.limits;
export const TIMEOUTS_MS = PLATFORM_VALUES.timeoutsMs;

export const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1'] as const);
export const VITE_PROXIED_PORTS = Object.freeze([
  PORTS.viteDev,
  PORTS.viteDevAlternate,
  PORTS.vitePreview,
] as const);

export function loopbackHttpUrl(port: number = PORTS.runtime): string {
  return `http://127.0.0.1:${port}`;
}

export function loopbackWebSocketUrl(port: number = PORTS.runtime): string {
  return `ws://127.0.0.1:${port}`;
}
