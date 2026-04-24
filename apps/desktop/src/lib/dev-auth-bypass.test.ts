import { describe, expect, it } from 'vitest';
import { DEV_AUTH_BYPASS_QUERY_PARAM, canUseDevAuthBypass } from './dev-auth-bypass.js';

describe('dev auth bypass', () => {
  it('only enables on local hosts with explicit opt-in', () => {
    expect(canUseDevAuthBypass({
      hostname: 'localhost',
      search: `?${DEV_AUTH_BYPASS_QUERY_PARAM}=1`,
    })).toBe(true);

    expect(canUseDevAuthBypass({
      hostname: '127.0.0.1',
      search: `?foo=bar&${DEV_AUTH_BYPASS_QUERY_PARAM}=1`,
    })).toBe(true);
  });

  it('stays disabled for non-local hosts', () => {
    expect(canUseDevAuthBypass({
      hostname: 'example.com',
      search: `?${DEV_AUTH_BYPASS_QUERY_PARAM}=1`,
    })).toBe(false);
  });

  it('requires explicit opt-in', () => {
    expect(canUseDevAuthBypass({
      hostname: 'localhost',
      search: '',
    })).toBe(false);
  });

  it('stays disabled on LAN addresses', () => {
    expect(canUseDevAuthBypass({
      hostname: '192.168.1.15',
      search: `?${DEV_AUTH_BYPASS_QUERY_PARAM}=1`,
    })).toBe(false);
  });
});