import { describe, expect, it } from 'vitest';
import { parseWebSocketProtocolSessionToken } from './platform-auth.js';

describe('WebSocket desktop authentication transport', () => {
  it('decodes the private subprotocol token among other protocols', () => {
    const encoded = Buffer.from('desktop-secret', 'utf8').toString('base64url');
    expect(parseWebSocketProtocolSessionToken(`chat.v1, vai.auth.${encoded}`)).toBe('desktop-secret');
  });

  it('rejects malformed and absent protocol values', () => {
    expect(parseWebSocketProtocolSessionToken('vai.auth.%%%')).toBeNull();
    expect(parseWebSocketProtocolSessionToken(undefined)).toBeNull();
  });
});
