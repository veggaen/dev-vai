import { describe, expect, it } from 'vitest';
import {
  hasTrustedCaptureAccess,
  isLocalDevMutationAllowed,
  isLocalRequest,
} from '../src/security/request-trust.js';

function request(ip: string, headers: Record<string, string> = {}) {
  return {
    ip,
    headers,
  } as any;
}

describe('request trust helpers', () => {
  it('treats localhost variants as local requests', () => {
    expect(isLocalRequest(request('127.0.0.1'))).toBe(true);
    expect(isLocalRequest(request('::1'))).toBe(true);
    expect(isLocalRequest(request('::ffff:127.0.0.1'))).toBe(true);
    expect(isLocalRequest(request('8.8.8.8'))).toBe(false);
  });

  it('allows local-dev mutations only for local non-production requests', () => {
    expect(isLocalDevMutationAllowed(request('127.0.0.1'), { NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isLocalDevMutationAllowed(request('127.0.0.1'), { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isLocalDevMutationAllowed(request('8.8.8.8'), { NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('requires a shared capture key for remote capture access', () => {
    expect(hasTrustedCaptureAccess(request('127.0.0.1'))).toBe(true);
    expect(
      hasTrustedCaptureAccess(
        request('8.8.8.8', { 'x-vai-capture-key': 'secret-key' }),
        { VAI_CAPTURE_API_KEY: 'secret-key' } as NodeJS.ProcessEnv,
      ),
    ).toBe(true);
    expect(
      hasTrustedCaptureAccess(
        request('8.8.8.8', { authorization: 'Bearer secret-key' }),
        { VAI_CAPTURE_API_KEY: 'secret-key' } as NodeJS.ProcessEnv,
      ),
    ).toBe(true);
    expect(
      hasTrustedCaptureAccess(
        request('8.8.8.8'),
        { VAI_CAPTURE_API_KEY: 'secret-key' } as NodeJS.ProcessEnv,
      ),
    ).toBe(false);
  });
});
