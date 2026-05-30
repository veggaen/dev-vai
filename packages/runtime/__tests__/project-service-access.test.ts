import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type VaiDatabase } from '@vai/core';
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
});
