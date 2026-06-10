import { describe, expect, it } from 'vitest';
import {
  assertSecureRuntimeExposure,
  isLoopbackBindHost,
  resolveRuntimeHost,
} from '../src/security/runtime-exposure.js';

describe('runtime exposure policy', () => {
  it('binds to loopback by default', () => {
    expect(resolveRuntimeHost({})).toBe('127.0.0.1');
    expect(isLoopbackBindHost('127.0.0.1')).toBe(true);
    expect(isLoopbackBindHost('::1')).toBe(true);
  });

  it('accepts an explicit host override', () => {
    expect(resolveRuntimeHost({ VAI_HOST: ' 192.168.1.5 ' })).toBe('192.168.1.5');
  });

  it('refuses non-loopback exposure without API authentication', () => {
    expect(() => assertSecureRuntimeExposure('0.0.0.0', false)).toThrow(
      'Refusing to bind runtime',
    );
  });

  it('permits authenticated non-loopback exposure', () => {
    expect(() => assertSecureRuntimeExposure('0.0.0.0', true)).not.toThrow();
  });
});
