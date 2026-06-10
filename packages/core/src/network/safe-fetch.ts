import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const LOCAL_HOST_SUFFIXES = ['.home', '.internal', '.lan', '.local', '.localhost'];

export interface LookupAddress {
  address: string;
  family: number;
}

export type LookupAll = (hostname: string) => Promise<readonly LookupAddress[]>;

export interface SafeFetchOptions {
  checkDns?: boolean;
  maxRedirects?: number;
  resolver?: LookupAll;
}

const defaultLookupAll: LookupAll = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized)
  );
}

export function isPrivateNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

export function validatePublicUrl(raw: string | URL): URL {
  const url = raw instanceof URL ? new URL(raw) : new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP(S) URLs are allowed');
  }
  if (url.username || url.password) {
    throw new Error('Credentialed URLs are not allowed');
  }

  const hostname = normalizedHostname(url);
  if (
    !hostname ||
    hostname === 'localhost' ||
    LOCAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    (isIP(hostname) > 0 && isPrivateNetworkAddress(hostname))
  ) {
    throw new Error('Private or local URLs are not allowed');
  }

  return url;
}

export async function assertPublicHostname(
  raw: string | URL,
  resolver: LookupAll = defaultLookupAll,
): Promise<URL> {
  const url = validatePublicUrl(raw);
  const hostname = normalizedHostname(url);
  if (isIP(hostname) > 0) return url;

  const addresses = await resolver(hostname);
  if (addresses.length === 0) {
    throw new Error('URL hostname did not resolve');
  }
  if (addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
    throw new Error('URL hostname resolves to a private or local address');
  }

  return url;
}

export async function safeFetch(
  raw: string | URL,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3;
  const resolver = options.resolver ?? defaultLookupAll;
  const checkDns = options.checkDns ?? true;
  let currentUrl = validatePublicUrl(raw);
  let requestInit: RequestInit = { ...init, redirect: 'manual' };

  for (let redirects = 0; ; redirects += 1) {
    if (checkDns) {
      currentUrl = await assertPublicHostname(currentUrl, resolver);
    }

    const response = await fetch(currentUrl, requestInit);
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      return response;
    }
    if (redirects >= maxRedirects) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Too many URL redirects');
    }

    await response.body?.cancel().catch(() => undefined);
    currentUrl = validatePublicUrl(new URL(location, currentUrl));
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        requestInit.method?.toUpperCase() === 'POST')
    ) {
      requestInit = { ...requestInit, method: 'GET', body: undefined };
    }
  }
}
