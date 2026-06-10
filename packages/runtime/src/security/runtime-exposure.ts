const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function resolveRuntimeHost(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.VAI_HOST?.trim() || '127.0.0.1';
}

export function isLoopbackBindHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

export function assertSecureRuntimeExposure(host: string, apiAuthEnabled: boolean): void {
  if (isLoopbackBindHost(host) || apiAuthEnabled) {
    return;
  }

  throw new Error(
    `[VAI] Refusing to bind runtime to ${host} without API authentication. ` +
      'Configure VAI_API_KEYS or use the default loopback-only VAI_HOST.',
  );
}
