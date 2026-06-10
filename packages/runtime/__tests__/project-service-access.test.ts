import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, schema, type VaiDatabase } from '@vai/core';
import { ProjectService } from '../src/projects/service.js';

describe('ProjectService sandbox access', () => {
  let db: VaiDatabase;
  let projects: ProjectService;

  beforeEach(() => {
    db = createDb(':memory:');
    projects = new ProjectService(db);
  });

  it('default-denies sandbox access when no platform project row exists', () => {
    expect(projects.canReadSandbox('missing-sandbox', null)).toBe(false);
    expect(projects.canWriteSandbox('missing-sandbox', null)).toBe(false);
    expect(projects.canReadSandbox('missing-sandbox', 'user-1')).toBe(false);
    expect(projects.canWriteSandbox('missing-sandbox', 'user-1')).toBe(false);
  });

  it('allows the synced owner to read and write a sandbox', () => {
    const now = new Date();
    db.insert(schema.platformUsers).values({
      id: 'user-1',
      email: 'owner@example.com',
      name: 'Owner',
      avatarUrl: null,
      emailVerifiedAt: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    projects.syncSandboxProject({
      id: 'sandbox-1',
      name: 'Owned Sandbox',
      rootDir: '/tmp/sandbox-1',
      ownerUserId: 'user-1',
      files: {},
      logs: [],
      devStderr: [],
      devProcess: null,
      devPort: null,
      status: 'idle',
      version: 0,
      createdAt: new Date(),
    });

    expect(projects.canReadSandbox('sandbox-1', 'user-1')).toBe(true);
    expect(projects.canWriteSandbox('sandbox-1', 'user-1')).toBe(true);
    expect(projects.canReadSandbox('sandbox-1', 'user-2')).toBe(false);
    expect(projects.canWriteSandbox('sandbox-1', 'user-2')).toBe(false);
  });

  it('records and lists sandbox revisions with file snapshots', () => {
    const revision = projects.recordSandboxRevision({
      sandboxProjectId: 'sandbox-1',
      actorUserId: null,
      baseVersion: 0,
      version: 1,
      summary: 'Initial write',
      files: [
        { path: 'src/App.tsx', beforeContent: null, afterContent: 'export default function App() { return null; }' },
      ],
    });

    expect(revision?.version).toBe(1);
    expect(revision?.files[0]).toMatchObject({
      path: 'src/App.tsx',
      changeType: 'create',
      beforeContent: null,
      afterContent: 'export default function App() { return null; }',
    });

    const revisions = projects.listSandboxRevisions('sandbox-1');
    expect(revisions).toHaveLength(1);
    expect(revisions[0].id).toBe(revision?.id);
  });

  it('caps share-link roles and supports revocation', () => {
    const now = new Date();
    for (const user of [
      { id: 'owner-1', email: 'owner@example.com' },
      { id: 'member-1', email: 'member@example.com' },
    ]) {
      db.insert(schema.platformUsers).values({
        id: user.id,
        email: user.email,
        name: null,
        avatarUrl: null,
        emailVerifiedAt: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      }).run();
    }

    const project = projects.syncSandboxProject({
      id: 'sandbox-share',
      name: 'Share Sandbox',
      rootDir: '/tmp/sandbox-share',
      ownerUserId: 'owner-1',
      files: {},
      logs: [],
      devStderr: [],
      devProcess: null,
      devPort: null,
      status: 'idle',
      version: 0,
      createdAt: now,
    });

    expect(project).toBeTruthy();
    const link = projects.createShareLink(project!.id, 'owner-1', 'owner', undefined, 1);
    expect(link.role).toBe('viewer');

    projects.redeemShareLink(link.token, 'member-1');
    expect(projects.getProjectRole(project!.id, 'member-1')).toBe('viewer');
    expect(projects.revokeShareLink(project!.id, link.id)).toBe(true);
    expect(projects.getShareLinkPreview(link.token)).toBeNull();
  });

  it('keeps repeated invite redemption idempotent when it would not grant a stronger role', () => {
    const now = new Date();
    for (const user of [
      { id: 'owner-1', email: 'owner@example.com' },
      { id: 'editor-1', email: 'editor@example.com' },
      { id: 'viewer-1', email: 'viewer@example.com' },
    ]) {
      db.insert(schema.platformUsers).values({
        id: user.id,
        email: user.email,
        name: null,
        avatarUrl: null,
        emailVerifiedAt: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      }).run();
    }

    const project = projects.syncSandboxProject({
      id: 'sandbox-idempotent-share',
      name: 'Idempotent Share',
      rootDir: '/tmp/idempotent-share',
      ownerUserId: 'owner-1',
      files: {},
      logs: [],
      devStderr: [],
      devProcess: null,
      devPort: null,
      status: 'idle',
      version: 0,
      createdAt: now,
    })!;
    db.insert(schema.platformProjectMembers).values({
      id: 'editor-member',
      projectId: project.id,
      userId: 'editor-1',
      role: 'editor',
      invitedByUserId: 'owner-1',
      createdAt: now,
      updatedAt: now,
    }).run();

    const link = projects.createShareLink(project.id, 'owner-1', 'viewer', undefined, 1);
    projects.redeemShareLink(link.token, 'editor-1');

    expect(projects.getProjectRole(project.id, 'editor-1')).toBe('editor');
    expect(projects.getShareLinkPreview(link.token)?.remainingUses).toBe(1);

    projects.redeemShareLink(link.token, 'viewer-1');
    expect(projects.getProjectRole(project.id, 'viewer-1')).toBe('viewer');
    expect(projects.getShareLinkPreview(link.token)).toBeNull();
  });

  it('rejects authenticated IDE handoff claims from users outside the project', () => {
    const now = new Date();
    for (const user of [
      { id: 'owner-1', email: 'owner@example.com' },
      { id: 'outsider-1', email: 'outsider@example.com' },
    ]) {
      db.insert(schema.platformUsers).values({
        id: user.id,
        email: user.email,
        name: null,
        avatarUrl: null,
        emailVerifiedAt: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      }).run();
    }

    const project = projects.syncSandboxProject({
      id: 'sandbox-handoff',
      name: 'Handoff',
      rootDir: '/tmp/handoff',
      ownerUserId: 'owner-1',
      files: {},
      logs: [],
      devStderr: [],
      devProcess: null,
      devPort: null,
      status: 'idle',
      version: 0,
      createdAt: now,
    })!;
    const handoff = projects.createHandoffIntent(project.id, 'owner-1', 'vscode');

    expect(() => projects.consumeHandoffIntent(handoff.token, 'vscode', 'outsider-1'))
      .toThrow('Handoff intent belongs to a project this user cannot access');
    expect(projects.consumeHandoffIntent(handoff.token, 'vscode', null).project.id).toBe(project.id);
  });

  it('rejects preferred companion clients outside project membership', () => {
    const now = new Date();
    for (const user of [
      { id: 'owner-1', email: 'owner@example.com' },
      { id: 'outsider-1', email: 'outsider@example.com' },
    ]) {
      db.insert(schema.platformUsers).values({
        id: user.id,
        email: user.email,
        name: null,
        avatarUrl: null,
        emailVerifiedAt: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      }).run();
    }

    const project = projects.syncSandboxProject({
      id: 'sandbox-peer-client',
      name: 'Peer Client',
      rootDir: '/tmp/peer-client',
      ownerUserId: 'owner-1',
      files: {},
      logs: [],
      devStderr: [],
      devProcess: null,
      devPort: null,
      status: 'idle',
      version: 0,
      createdAt: now,
    })!;
    db.insert(schema.platformCompanionClients).values({
      id: 'outsider-client',
      userId: 'outsider-1',
      installationKey: 'outsider-installation',
      clientName: 'Outsider Desktop',
      clientType: 'desktop',
      launchTarget: 'vscode',
      capabilities: null,
      availableModels: null,
      availableChatInfo: null,
      lastSeenAt: now,
      lastPolledAt: null,
      createdViaDeviceCodeId: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    expect(() => projects.replacePeers(project.id, 'owner-1', [{
      displayName: 'Review Peer',
      ide: 'vscode',
      model: 'local:model',
      preferredClientId: 'outsider-client',
    }])).toThrow('Preferred companion client is not available to this project');
  });

  it('rejects audit results from peers that were not invited to the request', () => {
    const now = new Date();
    db.insert(schema.platformUsers).values({
      id: 'owner-1',
      email: 'owner@example.com',
      name: null,
      avatarUrl: null,
      emailVerifiedAt: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    }).run();
    const project = projects.syncSandboxProject({
      id: 'sandbox-audit-peer',
      name: 'Audit Peer',
      rootDir: '/tmp/audit-peer',
      ownerUserId: 'owner-1',
      files: {},
      logs: [],
      devStderr: [],
      devProcess: null,
      devPort: null,
      status: 'idle',
      version: 0,
      createdAt: now,
    })!;
    projects.replacePeers(project.id, 'owner-1', [{
      peerKey: 'reviewer',
      displayName: 'Reviewer',
      ide: 'vscode',
      model: 'local:model',
    }]);
    const audit = projects.createAuditRequest(project.id, 'owner-1', 'Review this project', undefined, ['reviewer'])!;

    expect(() => projects.submitAuditResult(project.id, audit.id, {
      peerKey: 'uninvited',
      verdict: 'Looks good',
    })).toThrow('Audit peer was not invited to this request');
  });

  it('lists only owned and shared projects with their SQL-resolved roles', () => {
    const now = new Date();
    for (const user of [
      { id: 'owner-1', email: 'owner@example.com' },
      { id: 'owner-2', email: 'other-owner@example.com' },
      { id: 'member-1', email: 'member@example.com' },
    ]) {
      db.insert(schema.platformUsers).values({
        id: user.id,
        email: user.email,
        name: null,
        avatarUrl: null,
        emailVerifiedAt: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      }).run();
    }

    const owned = projects.syncSandboxProject({
      id: 'owned-sandbox',
      name: 'Owned',
      rootDir: '/tmp/owned',
      ownerUserId: 'member-1',
      files: {},
      logs: [],
      devStderr: [],
      devProcess: null,
      devPort: null,
      status: 'idle',
      version: 0,
      createdAt: now,
    })!;
    const shared = projects.syncSandboxProject({
      id: 'shared-sandbox',
      name: 'Shared',
      rootDir: '/tmp/shared',
      ownerUserId: 'owner-1',
      files: {},
      logs: [],
      devStderr: [],
      devProcess: null,
      devPort: null,
      status: 'idle',
      version: 0,
      createdAt: now,
    })!;
    projects.syncSandboxProject({
      id: 'private-sandbox',
      name: 'Private',
      rootDir: '/tmp/private',
      ownerUserId: 'owner-2',
      files: {},
      logs: [],
      devStderr: [],
      devProcess: null,
      devPort: null,
      status: 'idle',
      version: 0,
      createdAt: now,
    });

    db.insert(schema.platformProjectMembers).values({
      id: 'member-row-1',
      projectId: shared.id,
      userId: 'member-1',
      role: 'viewer',
      invitedByUserId: 'owner-1',
      createdAt: now,
      updatedAt: now,
    }).run();

    expect(projects.listProjectsForUser('member-1').map(({ id, role }) => ({ id, role })))
      .toEqual([
        { id: owned.id, role: 'owner' },
        { id: shared.id, role: 'viewer' },
      ]);
  });

  it('does not rewrite unchanged project and membership rows inside the sync heartbeat', () => {
    const now = new Date();
    db.insert(schema.platformUsers).values({
      id: 'owner-1',
      email: 'owner@example.com',
      name: null,
      avatarUrl: null,
      emailVerifiedAt: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    const sandboxProject = {
      id: 'stable-sandbox',
      name: 'Stable',
      rootDir: '/tmp/stable',
      ownerUserId: 'owner-1',
      files: {},
      logs: [],
      devStderr: [],
      devProcess: null,
      devPort: null,
      status: 'idle' as const,
      version: 0,
      createdAt: now,
    };
    const project = projects.syncSandboxProject(sandboxProject)!;
    const stableUpdatedAt = new Date('2024-01-01T00:00:00.000Z');

    db.update(schema.platformProjects)
      .set({ updatedAt: stableUpdatedAt, lastSyncedAt: now })
      .where(eq(schema.platformProjects.id, project.id))
      .run();
    db.update(schema.platformProjectMembers)
      .set({ updatedAt: stableUpdatedAt })
      .where(eq(schema.platformProjectMembers.projectId, project.id))
      .run();

    projects.syncSandboxProject(sandboxProject);

    const storedProject = db.select().from(schema.platformProjects)
      .where(eq(schema.platformProjects.id, project.id))
      .get();
    const storedMember = db.select().from(schema.platformProjectMembers)
      .where(eq(schema.platformProjectMembers.projectId, project.id))
      .get();

    expect(storedProject?.updatedAt.getTime()).toBe(stableUpdatedAt.getTime());
    expect(storedMember?.updatedAt.getTime()).toBe(stableUpdatedAt.getTime());
  });
});
