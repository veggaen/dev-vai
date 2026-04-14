const DEV_AUTH_BYPASS_QUERY_PARAM = 'devAuthBypass';

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

interface LocationLike {
  readonly hostname: string;
  readonly search: string;
}

export function canUseDevAuthBypass(location: LocationLike): boolean {
  if (!LOCAL_HOSTS.has(location.hostname)) {
    return false;
  }

  const params = new URLSearchParams(location.search);
  return params.get(DEV_AUTH_BYPASS_QUERY_PARAM) === '1';
}

export function isDevAuthBypassEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return canUseDevAuthBypass(window.location);
}

export { DEV_AUTH_BYPASS_QUERY_PARAM };