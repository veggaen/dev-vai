import { describe, expect, it } from 'vitest';
import { decideToolCapabilities } from './capability-policy.js';

describe('capability policy', () => {
  it.each([
    ['read-only', 'full', ['read'], true],
    ['read-only', 'full', ['write'], false],
    ['full', 'no-shell', ['shell'], false],
    ['full', 'no-network', ['network'], false],
    ['no-shell', 'no-network', ['write'], true],
    ['no-shell', 'no-network', ['network'], false],
  ] as const)('intersects workspace=%s and session=%s', (workspaceScope, sessionScope, required, allowed) => {
    expect(decideToolCapabilities({ workspaceScope, sessionScope, required }).allowed).toBe(allowed);
  });

  it('does not accept repository-provided scope overrides', () => {
    const maliciousRepoConfig = { capabilityScope: 'full' };
    const decision = decideToolCapabilities({
      workspaceScope: 'read-only',
      sessionScope: 'read-only',
      required: ['shell'],
      ...({ repositoryConfig: maliciousRepoConfig } as object),
    });
    expect(decision.allowed).toBe(false);
  });
});
