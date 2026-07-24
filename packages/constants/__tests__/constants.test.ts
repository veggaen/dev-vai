import { describe, expect, it } from 'vitest';
import { LIMITS, PERSISTED_NAMES, PLATFORM_VALUES, PORTS, loopbackHttpUrl } from '../src/index.js';

describe('platform constants', () => {
  it('publishes the operational source-of-truth values', () => {
    expect(PORTS.runtime).toBe(3006);
    expect(PORTS.selfImprovementWatch).toBe(4123);
    expect(PERSISTED_NAMES.database).toBe('vai.db');
    expect(LIMITS.toolIterations).toBeGreaterThan(0);
    expect(loopbackHttpUrl()).toBe('http://127.0.0.1:3006');
  });

  it('freezes every manifest section', () => {
    expect(Object.isFrozen(PLATFORM_VALUES)).toBe(true);
    expect(Object.values(PLATFORM_VALUES).every(Object.isFrozen)).toBe(true);
  });
});
