import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

function storage(initial?: Record<string, string>): Storage {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

async function loadApi(webToken?: string) {
  vi.resetModules();
  const localStorage = storage(webToken ? { 'vai-platform-session-token': webToken } : undefined);
  vi.stubGlobal('window', {
    __TAURI_INTERNALS__: {},
    location: { port: '', host: 'tauri.localhost', hostname: 'tauri.localhost', search: '' },
    localStorage,
  });
  return {
    api: await import('./api.js'),
    localStorage,
  };
}

describe('desktop auth persistence', () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.unstubAllGlobals();
  });

  it('restores the Windows-protected token before authenticated requests', async () => {
    invoke.mockResolvedValueOnce('native-session');
    const { api, localStorage } = await loadApi('stale-web-session');

    await expect(api.hydrateApiSessionToken()).resolves.toBe('native-session');
    expect(api.getApiSessionToken()).toBe('native-session');
    expect(localStorage.getItem('vai-platform-session-token')).toBe('native-session');
    expect(invoke).toHaveBeenCalledWith('load_desktop_session_token');
  });

  it('migrates an existing WebView-only session into native protected storage', async () => {
    invoke.mockResolvedValueOnce(null).mockResolvedValueOnce(undefined);
    const { api } = await loadApi('legacy-web-session');

    await expect(api.hydrateApiSessionToken()).resolves.toBe('legacy-web-session');
    expect(invoke).toHaveBeenNthCalledWith(2, 'save_desktop_session_token', {
      token: 'legacy-web-session',
    });
  });

  it('awaits native removal on explicit logout semantics', async () => {
    invoke.mockResolvedValue(undefined);
    const { api, localStorage } = await loadApi('active-session');

    await api.persistApiSessionToken(null);
    expect(api.getApiSessionToken()).toBeNull();
    expect(localStorage.getItem('vai-platform-session-token')).toBeNull();
    expect(invoke).toHaveBeenCalledWith('save_desktop_session_token', { token: null });
  });

  it('does not silently claim logout persistence when native removal fails', async () => {
    invoke.mockRejectedValueOnce(new Error('vault locked'));
    const { api, localStorage } = await loadApi('active-session');

    await expect(api.persistApiSessionToken(null)).rejects.toThrow('vault locked');
    expect(localStorage.getItem('vai-platform-session-token')).toBeNull();
  });

  it('keeps desktop WebSocket credentials out of the URL', async () => {
    const { api } = await loadApi('secret-session-token');

    expect(api.buildChatWebSocketUrl()).not.toContain('secret-session-token');
    expect(api.buildChatWebSocketUrl()).not.toContain('access_token');
    const [protocol] = api.buildChatWebSocketProtocols();
    expect(protocol).toMatch(/^vai\.auth\.[A-Za-z0-9_-]+$/);
    const encoded = protocol.slice('vai.auth.'.length);
    expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe('secret-session-token');
  });

  it('refreshes all live API base consumers when an environment is selected', async () => {
    const { api, localStorage } = await loadApi();
    localStorage.setItem('vai-active-environment-record', JSON.stringify({ endpoint: 'https://remote.example.test/' }));

    api.refreshApiConnectionBase();

    expect(api.API_BASE).toBe('https://remote.example.test');
    expect(api.WS_BASE).toBe('wss://remote.example.test');
  });
});
