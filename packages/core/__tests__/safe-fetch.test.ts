import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertPublicHostname,
  safeFetch,
  validatePublicUrl,
  type LookupAll,
} from '../src/network/safe-fetch.js';

const publicResolver: LookupAll = async () => [{ address: '93.184.216.34', family: 4 }];

describe('safeFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    'http://127.0.0.2/private',
    'http://10.0.0.1/private',
    'http://[::1]/private',
    'http://service.local/private',
    'file:///etc/passwd',
    'https://user:secret@example.com/private',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => validatePublicUrl(url)).toThrow();
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    await expect(assertPublicHostname(
      'https://example.com/private',
      async () => [{ address: '10.0.0.1', family: 4 }],
    )).rejects.toThrow(/resolves to a private/i);
  });

  it('rejects a redirect to a private destination before fetching it', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/private' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(safeFetch('https://example.com/start', {}, {
      resolver: publicResolver,
    })).rejects.toThrow(/private or local/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows validated public redirects', async () => {
    const fetchMock = vi.fn(async (url: URL) =>
      url.hostname === 'example.com'
        ? new Response(null, {
          status: 302,
          headers: { location: 'https://www.example.com/article' },
        })
        : new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await safeFetch('https://example.com/start', {}, {
      resolver: publicResolver,
    });
    expect(await response.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
