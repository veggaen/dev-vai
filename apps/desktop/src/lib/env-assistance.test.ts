import { describe, expect, it } from 'vitest';
import { getEnvGuide, groupEnvGuides } from './env-assistance.js';

describe('environment assistance', () => {
  it('groups core setup ahead of feature integrations', () => {
    const groups = groupEnvGuides([
      'STRIPE_SECRET_KEY',
      'VITE_CLERK_PUBLISHABLE_KEY',
      'VITE_CONVEX_URL',
      'MUX_TOKEN_ID',
      'VITE_CONVEX_URL',
    ]);

    expect(groups.map(({ group }) => group)).toEqual([
      'Core runtime',
      'Authentication',
      'Billing',
      'Video',
    ]);
    expect(groups[0]?.guides).toHaveLength(1);
  });

  it('identifies generated, public, and server-only values', () => {
    expect(getEnvGuide('VITE_CONVEX_URL')).toMatchObject({ generated: true });
    expect(getEnvGuide('VITE_CONVEX_URL')).toMatchObject({ requiredToBoot: true });
    expect(getEnvGuide('VITE_CONVEX_URL').serverOnly).toBeUndefined();
    expect(getEnvGuide('VITE_CLERK_PUBLISHABLE_KEY').serverOnly).toBeUndefined();
    expect(getEnvGuide('CLERK_SECRET_KEY')).toMatchObject({ serverOnly: true });
  });

  it('puts the actionable client values before generated and server-only companions', () => {
    const groups = groupEnvGuides([
      'CLERK_SECRET_KEY',
      'CONVEX_DEPLOYMENT',
      'VITE_CLERK_PUBLISHABLE_KEY',
      'VITE_CONVEX_SITE_URL',
      'VITE_CONVEX_URL',
    ]);

    expect(groups[0]?.guides.map(({ name }) => name)).toEqual([
      'VITE_CONVEX_URL',
      'CONVEX_DEPLOYMENT',
      'VITE_CONVEX_SITE_URL',
    ]);
    expect(groups[1]?.guides[0]?.name).toBe('VITE_CLERK_PUBLISHABLE_KEY');
  });

  it('gives unknown backend values a safe fallback', () => {
    expect(getEnvGuide('PRIVATE_VENDOR_TOKEN')).toMatchObject({
      group: 'Other',
      service: 'Project',
      serverOnly: true,
    });
  });
});
