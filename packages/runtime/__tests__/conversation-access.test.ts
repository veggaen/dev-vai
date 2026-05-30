import { describe, expect, it } from 'vitest';
import { authorizeConversationAccess } from '../src/access/conversations.js';
import type { PlatformViewer } from '../src/auth/platform-auth.js';

const anonymousViewer: PlatformViewer = {
  authenticated: false,
  user: null,
  companionClient: null,
};

const aliceViewer: PlatformViewer = {
  authenticated: true,
  user: {
    id: 'user-alice',
    email: 'alice@example.com',
    name: 'Alice',
    avatarUrl: null,
  },
  companionClient: null,
};

const projects = {
  canReadSandbox: () => false,
  canWriteSandbox: () => false,
};

describe('authorizeConversationAccess', () => {
  it('preserves local-first access when platform auth is disabled', () => {
    const decision = authorizeConversationAccess({
      conversation: { ownerUserId: null, visibility: 'private' },
      viewer: anonymousViewer,
      projects,
      access: 'write',
      authEnabled: false,
    });

    expect(decision.allowed).toBe(true);
  });

  it('denies legacy null-owner conversations when platform auth is enabled', () => {
    const decision = authorizeConversationAccess({
      conversation: { ownerUserId: null, visibility: 'private' },
      viewer: aliceViewer,
      projects,
      access: 'write',
      authEnabled: true,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.statusCode).toBe(403);
  });

  it('allows the owner to write', () => {
    const decision = authorizeConversationAccess({
      conversation: { ownerUserId: 'user-alice', visibility: 'private' },
      viewer: aliceViewer,
      projects,
      access: 'write',
      authEnabled: true,
    });

    expect(decision.allowed).toBe(true);
  });

  it('allows a project member to write through sandbox membership', () => {
    const decision = authorizeConversationAccess({
      conversation: {
        ownerUserId: 'user-bob',
        sandboxProjectId: 'sandbox-1',
        visibility: 'private',
      },
      viewer: aliceViewer,
      projects: {
        canReadSandbox: () => true,
        canWriteSandbox: () => true,
      },
      access: 'write',
      authEnabled: true,
    });

    expect(decision.allowed).toBe(true);
  });

  it('allows public read without allowing public write', () => {
    const readable = authorizeConversationAccess({
      conversation: { ownerUserId: 'user-bob', visibility: 'public' },
      viewer: anonymousViewer,
      projects,
      access: 'read',
      authEnabled: true,
    });
    const writable = authorizeConversationAccess({
      conversation: { ownerUserId: 'user-bob', visibility: 'public' },
      viewer: anonymousViewer,
      projects,
      access: 'write',
      authEnabled: true,
    });

    expect(readable.allowed).toBe(true);
    expect(writable.allowed).toBe(false);
    expect(writable.statusCode).toBe(401);
  });
});
