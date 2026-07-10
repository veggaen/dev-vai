import { describe, expect, it } from 'vitest';
import { reusableLocalProjectPort } from './sandboxStore.js';

describe('reusableLocalProjectPort', () => {
  it('reuses the live production server when the same local folder is reopened', () => {
    expect(reusableLocalProjectPort({
      id: 'mpm',
      live: true,
      status: 'running',
      devPort: 4102,
      envLane: 'production',
    })).toBe(4102);
  });

  it('does not trust a stale running status without a tracked live process', () => {
    expect(reusableLocalProjectPort({
      id: 'mpm',
      live: false,
      status: 'running',
      devPort: 4102,
    })).toBeNull();
  });

  it('does not reuse an invalid port', () => {
    expect(reusableLocalProjectPort({ live: true, devPort: null })).toBeNull();
  });
});
