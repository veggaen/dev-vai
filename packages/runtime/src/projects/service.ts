import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { and, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { schema, type VaiDatabase } from '@vai/core';
import type { SandboxManager, SandboxProject } from '../sandbox/manager.js';

export type ProjectRole = 'owner' | 'admin' | 'editor' | 'viewer' | 'tester';
export type HandoffTarget = 'desktop' | 'vscode' | 'cursor' | 'antigravity';
export type ProjectPeerStatus = 'idle' | 'invited' | 'ready' | 'active';
export type AuditRequestStatus = 'pending' | 'collecting' | 'completed';
export type AuditResultStatus = 'pending' | 'claimed' | 'submitted';

export interface ProjectPeerInput {
  peerKey?: string;
  displayName: string;
  ide: string;
  model: string;
  status?: ProjectPeerStatus;
  launchTarget?: HandoffTarget;
  preferredClientId?: string | null;
  instructions?: string | null;
}

export interface AuditResultInput {
  peerKey: string;
  verdict: string;
  confidence?: number | null;
  rationale?: string | null;
  claimedByUserId?: string | null;
  claimedByClientId?: string | null;
}

export interface PollAuditWorkOptions {
  target?: HandoffTarget;
  peerKey?: string;
  clientId?: string | null;
}

export const HANDOFF_TARGETS: readonly HandoffTarget[] = ['desktop', 'vscode', 'cursor', 'antigravity'];

const WRITE_ROLES = new Set<ProjectRole>(['owner', 'admin', 'editor']);
const READ_ROLES = new Set<ProjectRole>(['owner', 'admin', 'editor', 'viewer', 'tester']);
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const AUDIT_CLAIM_TTL_MS = 10 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function createToken(): string {
  return randomBytes(32).toString('base64url');
}

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'project';
}

function normalizeRole(role?: string): ProjectRole {
  switch (role) {
    case 'owner':
    case 'admin':
    case 'editor':
    case 'viewer':
    case 'tester':
      return role;
    default:
      return 'viewer';
  }
}

function normalizeHandoffTarget(target?: string | null): HandoffTarget {
  switch (target) {
    case 'desktop':
    case 'vscode':
    case 'cursor':
    case 'antigravity':
      return target;
    default:
      return 'desktop';
  }
}

function normalizePeerIde(ide?: string | null): string {
  const value = ide?.trim().toLowerCase() ?? '';
  const normalized = value
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'desktop';
}

function resolvePeerLaunchTarget(launchTarget: string | null | undefined, ide?: string | null): HandoffTarget {
  if (launchTarget) return normalizeHandoffTarget(launchTarget);
  const normalizedIde = normalizePeerIde(ide);
  return HANDOFF_TARGETS.includes(normalizedIde as HandoffTarget)
    ? normalizedIde as HandoffTarget
    : 'desktop';
}

function toPeerKey(input: ProjectPeerInput): string {
  const explicit = input.peerKey?.trim().toLowerCase();
  if (explicit) return explicit.replace(/[^a-z0-9:-]+/g, '-');
  return `${input.ide}:${input.model}`.toLowerCase().replace(/[^a-z0-9:-]+/g, '-');
}

function clampConfidence(value?: number | null): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

type CompanionClientSummary = {
  id: string;
  clientName: string;
  clientType: string;
  launchTarget: string;
  lastSeenAt: Date | null;
  lastPolledAt: Date | null;
};

type ClaimedByUserSummary = {
  id: string;
  name: string | null;
  email: string;
};

export class ProjectService {
  constructor(private readonly db: VaiDatabase) {}

  hydrateSandboxs(sandbox: SandboxManager): void {
    const rows = this.db.select().from(schema.platformProjects).all();
    for (const row of rows) {
      if (!existsSync(row.rootDir)) continue;
      sandbox.rehydrate({
        id: row.sandboxProjectId,
        name: row.name,
        rootDir: row.rootDir,
        ownerUserId: row.ownerUserId,
        status: 'idle',
      });
      this.db.update(schema.platformProjects)
        .set({ status: 'idle', updatedAt: new Date() })
        .where(eq(schema.platformProjects.id, row.id))
        .run();
    }
  }

  syncSandboxProject(project: SandboxProject) {
    const now = new Date();
    const existing = this.getProjectBySandboxId(project.id);
    const projectId = existing?.id ?? randomUUID();
    const slug = existing?.slug ?? `${slugify(project.name)}-${project.id}`;

    if (existing) {
      this.db.update(schema.platformProjects)
        .set({
          ownerUserId: project.ownerUserId,
          name: project.name,
          rootDir: project.rootDir,
          status: project.status,
          lastSyncedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.platformProjects.id, projectId))
        .run();
    } else {
      this.db.insert(schema.platformProjects)
        .values({
          id: projectId,
          sandboxProjectId: project.id,
          ownerUserId: project.ownerUserId,
          name: project.name,
          slug,
          rootDir: project.rootDir,
          status: project.status,
          visibility: 'private',
          lastOpenedAt: null,
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    if (project.ownerUserId) {
      this.upsertMember(projectId, project.ownerUserId, 'owner', project.ownerUserId);
    }

    return this.getProject(projectId);
  }

  removeProjectForSandbox(sandboxProjectId: string): void {
    const existing = this.getProjectBySandboxId(sandboxProjectId);
    if (!existing) return;

    this.db.delete(schema.platformProjectMembers)
      .where(eq(schema.platformProjectMembers.projectId, existing.id))
      .run();
    this.db.delete(schema.platformProjectShareLinks)
      .where(eq(schema.platformProjectShareLinks.projectId, existing.id))
      .run();
    this.db.delete(schema.platformProjectHandoffIntents)
      .where(eq(schema.platformProjectHandoffIntents.projectId, existing.id))
      .run();
    this.db.delete(schema.platformProjects)
      .where(eq(schema.platformProjects.id, existing.id))
      .run();
  }

  listProjectsForUser(userId: string | null) {
    const rows = this.db.select().from(schema.platformProjects).all();
    return rows.filter((row) => this.canReadProject(row.id, userId)).map((row) => ({
      ...row,
      role: this.getProjectRole(row.id, userId),
    }));
  }

  getProject(projectId: string) {
    return this.db.select().from(schema.platformProjects)
      .where(eq(schema.platformProjects.id, projectId))
      .get() ?? null;
  }

  getProjectBySandboxId(sandboxProjectId: string) {
    return this.db.select().from(schema.platformProjects)
      .where(eq(schema.platformProjects.sandboxProjectId, sandboxProjectId))
      .get() ?? null;
  }

  getProjectRole(projectId: string, userId: string | null): ProjectRole | null {
    const project = this.getProject(projectId);
    if (!project) return null;
    // null-owner means the project was created anonymously (e.g. local dev with no auth).
    // Only grant owner access to callers who are also anonymous; otherwise require a real user match.
    if (project.ownerUserId === null) {
      return userId === null ? 'owner' : null;
    }
    if (!userId) return null;
    if (project.ownerUserId === userId) return 'owner';
    const member = this.db.select().from(schema.platformProjectMembers)
      .where(and(
        eq(schema.platformProjectMembers.projectId, projectId),
        eq(schema.platformProjectMembers.userId, userId),
      ))
      .get();
    return member ? normalizeRole(member.role) : null;
  }

  canReadProject(projectId: string, userId: string | null): boolean {
    const role = this.getProjectRole(projectId, userId);
    return role ? READ_ROLES.has(role) : false;
  }

  canWriteProject(projectId: string, userId: string | null): boolean {
    const role = this.getProjectRole(projectId, userId);
    return role ? WRITE_ROLES.has(role) : false;
  }

  canReadSandbox(sandboxProjectId: string, userId: string | null): boolean {
    const project = this.getProjectBySandboxId(sandboxProjectId);
    if (!project) return true;
    return this.canReadProject(project.id, userId);
  }

  canWriteSandbox(sandboxProjectId: string, userId: string | null): boolean {
    const project = this.getProjectBySandboxId(sandboxProjectId);
    if (!project) return true;
    return this.canWriteProject(project.id, userId);
  }

  getProjectForSandboxWithRole(sandboxProjectId: string, userId: string | null) {
    const project = this.getProjectBySandboxId(sandboxProjectId);
    if (!project) return null;
    return {
      ...project,
      role: this.getProjectRole(project.id, userId),
    };
  }

  listMembers(projectId: string) {
    return this.db.select({
      id: schema.platformProjectMembers.id,
      userId: schema.platformUsers.id,
      email: schema.platformUsers.email,
      name: schema.platformUsers.name,
      avatarUrl: schema.platformUsers.avatarUrl,
      role: schema.platformProjectMembers.role,
      createdAt: schema.platformProjectMembers.createdAt,
    })
      .from(schema.platformProjectMembers)
      .innerJoin(schema.platformUsers, eq(schema.platformProjectMembers.userId, schema.platformUsers.id))
      .where(eq(schema.platformProjectMembers.projectId, projectId))
      .all();
  }

  listPeers(projectId: string) {
    const peers = this.db.select().from(schema.platformProjectPeers)
      .where(eq(schema.platformProjectPeers.projectId, projectId))
      .all()
      .sort((left, right) => left.displayName.localeCompare(right.displayName));

    const preferredClientMap = this.getCompanionClientMap(
      peers
        .map((peer) => peer.preferredClientId)
        .filter((clientId): clientId is string => Boolean(clientId)),
    );

    return peers.map((peer) => ({
      ...peer,
      preferredClient: peer.preferredClientId ? preferredClientMap.get(peer.preferredClientId) ?? null : null,
    }));
  }

  listCompanionClients(projectId: string) {
    const project = this.getProject(projectId);
    if (!project) return [];

    const memberIds = new Set<string>();
    if (project.ownerUserId) memberIds.add(project.ownerUserId);

    const members = this.db.select({ userId: schema.platformProjectMembers.userId })
      .from(schema.platformProjectMembers)
      .where(eq(schema.platformProjectMembers.projectId, projectId))
      .all();

    for (const member of members) {
      if (member.userId) memberIds.add(member.userId);
    }

    const userIds = [...memberIds];
    if (userIds.length === 0) return [];

    return this.db.select({
      id: schema.platformCompanionClients.id,
      clientName: schema.platformCompanionClients.clientName,
      clientType: schema.platformCompanionClients.clientType,
      launchTarget: schema.platformCompanionClients.launchTarget,
      lastSeenAt: schema.platformCompanionClients.lastSeenAt,
      lastPolledAt: schema.platformCompanionClients.lastPolledAt,
    })
      .from(schema.platformCompanionClients)
      .where(inArray(schema.platformCompanionClients.userId, userIds))
      .all()
      .sort((left, right) => {
        const leftActivity = Math.max(left.lastPolledAt?.getTime() ?? 0, left.lastSeenAt?.getTime() ?? 0);
        const rightActivity = Math.max(right.lastPolledAt?.getTime() ?? 0, right.lastSeenAt?.getTime() ?? 0);
        return rightActivity - leftActivity || left.clientName.localeCompare(right.clientName);
      });
  }

  /** List all companion clients registered by a specific user (no project needed).
   *  Deduplicates by launchTarget — keeps only the most recently active client per IDE type. */
  listUserCompanionClients(userId: string) {
    const all = this.db.select({
      id: schema.platformCompanionClients.id,
      clientName: schema.platformCompanionClients.clientName,
      clientType: schema.platformCompanionClients.clientType,
      launchTarget: schema.platformCompanionClients.launchTarget,
      availableModels: schema.platformCompanionClients.availableModels,
      availableChatInfo: schema.platformCompanionClients.availableChatInfo,
      lastSeenAt: schema.platformCompanionClients.lastSeenAt,
      lastPolledAt: schema.platformCompanionClients.lastPolledAt,
    })
      .from(schema.platformCompanionClients)
      .where(eq(schema.platformCompanionClients.userId, userId))
      .all();

    // Deduplicate: keep the most recently active client per launchTarget
    const byTarget = new Map<string, typeof all[number]>();
    for (const c of all) {
      const target = c.launchTarget || 'unknown';
      const activity = Math.max(c.lastPolledAt?.getTime() ?? 0, c.lastSeenAt?.getTime() ?? 0);
      const existing = byTarget.get(target);
      if (!existing) {
        byTarget.set(target, c);
        continue;
      }
      const existingActivity = Math.max(existing.lastPolledAt?.getTime() ?? 0, existing.lastSeenAt?.getTime() ?? 0);
      if (activity > existingActivity) {
        byTarget.set(target, c);
      }
    }

    return Array.from(byTarget.values())
      .sort((left, right) => {
        const leftActivity = Math.max(left.lastPolledAt?.getTime() ?? 0, left.lastSeenAt?.getTime() ?? 0);
        const rightActivity = Math.max(right.lastPolledAt?.getTime() ?? 0, right.lastSeenAt?.getTime() ?? 0);
        return rightActivity - leftActivity || left.clientName.localeCompare(right.clientName);
      });
  }

  /** List all companion clients regardless of owner (for local dev without auth).
   *  Deduplicates by launchTarget — keeps only the most recently active client per IDE type,
   *  so the picker shows one "VS Code", one "Cursor", etc. instead of many duplicates. */
  listAllCompanionClients() {
    const all = this.db.select({
      id: schema.platformCompanionClients.id,
      clientName: schema.platformCompanionClients.clientName,
      clientType: schema.platformCompanionClients.clientType,
      launchTarget: schema.platformCompanionClients.launchTarget,
      availableModels: schema.platformCompanionClients.availableModels,
      availableChatInfo: schema.platformCompanionClients.availableChatInfo,
      lastSeenAt: schema.platformCompanionClients.lastSeenAt,
      lastPolledAt: schema.platformCompanionClients.lastPolledAt,
    })
      .from(schema.platformCompanionClients)
      .all();

    // Deduplicate: keep the most recently active client per launchTarget
    const byTarget = new Map<string, typeof all[number]>();
    for (const c of all) {
      const target = c.launchTarget || 'unknown';
      const activity = Math.max(c.lastPolledAt?.getTime() ?? 0, c.lastSeenAt?.getTime() ?? 0);
      const existing = byTarget.get(target);
      if (!existing) {
        byTarget.set(target, c);
        continue;
      }
      const existingActivity = Math.max(existing.lastPolledAt?.getTime() ?? 0, existing.lastSeenAt?.getTime() ?? 0);
      if (activity > existingActivity) {
        byTarget.set(target, c);
      }
    }

    return Array.from(byTarget.values())
      .sort((left, right) => {
        const leftActivity = Math.max(left.lastPolledAt?.getTime() ?? 0, left.lastSeenAt?.getTime() ?? 0);
        const rightActivity = Math.max(right.lastPolledAt?.getTime() ?? 0, right.lastSeenAt?.getTime() ?? 0);
        return rightActivity - leftActivity || left.clientName.localeCompare(right.clientName);
      });
  }

  /** Delete a single companion client by ID, clearing FK references first */
  deleteCompanionClient(clientId: string) {
    // Clear FK references
    this.db.delete(schema.platformBroadcastDeliveries)
      .where(eq(schema.platformBroadcastDeliveries.targetClientId, clientId))
      .run();
    this.db.update(schema.platformProjectPeers)
      .set({ preferredClientId: null })
      .where(eq(schema.platformProjectPeers.preferredClientId, clientId))
      .run();
    this.db.update(schema.platformProjectAuditResults)
      .set({ claimedByClientId: null })
      .where(eq(schema.platformProjectAuditResults.claimedByClientId, clientId))
      .run();
    // Delete the client
    this.db.delete(schema.platformCompanionClients)
      .where(eq(schema.platformCompanionClients.id, clientId))
      .run();
  }

  /** Delete companion clients whose installationKey matches a prefix (for test cleanup) */
  deleteCompanionClientsByKeyPrefix(prefix: string) {
    const all = this.db.select({ id: schema.platformCompanionClients.id, installationKey: schema.platformCompanionClients.installationKey })
      .from(schema.platformCompanionClients)
      .all();
    let deleted = 0;
    for (const c of all) {
      if (c.installationKey.startsWith(prefix)) {
        this.deleteCompanionClient(c.id);
        deleted++;
      }
    }
    return deleted;
  }

  replacePeers(projectId: string, createdByUserId: string | null, peers: ProjectPeerInput[]) {
    const now = new Date();
    const existing = this.listPeers(projectId);
    const existingMap = new Map(existing.map((peer) => [peer.peerKey, peer]));
    const nextKeys = new Set<string>();

    for (const input of peers) {
      const peerKey = toPeerKey(input);
      nextKeys.add(peerKey);
      const current = existingMap.get(peerKey);
      const values = {
        projectId,
        peerKey,
        displayName: input.displayName.trim(),
        ide: normalizePeerIde(input.ide),
        model: input.model.trim(),
        status: input.status ?? 'invited',
        launchTarget: resolvePeerLaunchTarget(input.launchTarget, input.ide),
        preferredClientId: input.preferredClientId?.trim() || null,
        instructions: input.instructions?.trim() || null,
        createdByUserId,
        updatedAt: now,
      } as const;

      if (current) {
        this.db.update(schema.platformProjectPeers)
          .set(values)
          .where(eq(schema.platformProjectPeers.id, current.id))
          .run();
      } else {
        this.db.insert(schema.platformProjectPeers)
          .values({
            id: randomUUID(),
            ...values,
            createdAt: now,
          })
          .run();
      }
    }

    for (const peer of existing) {
      if (nextKeys.has(peer.peerKey)) continue;
      this.db.delete(schema.platformProjectPeers)
        .where(eq(schema.platformProjectPeers.id, peer.id))
        .run();
    }

    return this.listPeers(projectId);
  }

  listAuditRequests(projectId: string) {
    const requests = this.db.select().from(schema.platformProjectAuditRequests)
      .where(eq(schema.platformProjectAuditRequests.projectId, projectId))
      .all()
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    return requests.map((request) => ({
      ...request,
      results: this.listAuditResults(request.id),
    }));
  }

  createAuditRequest(projectId: string, createdByUserId: string | null, prompt: string, scope?: string, peerKeys?: string[]) {
    const now = new Date();
    const requestId = randomUUID();
    const peers = this.listPeers(projectId)
      .filter((peer) => !peerKeys?.length || peerKeys.includes(peer.peerKey));

    this.db.insert(schema.platformProjectAuditRequests)
      .values({
        id: requestId,
        projectId,
        createdByUserId,
        prompt: prompt.trim(),
        scope: scope?.trim() || 'project',
        status: peers.length > 0 ? 'collecting' : 'pending',
        consensusSummary: peers.length > 0 ? `Waiting for ${peers.length} peer verdict${peers.length === 1 ? '' : 's'}.` : 'No peers invited yet.',
        winningPeerKey: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    for (const peer of peers) {
      this.db.insert(schema.platformProjectAuditResults)
        .values({
          id: randomUUID(),
          auditRequestId: requestId,
          projectId,
          peerKey: peer.peerKey,
          status: 'pending',
          verdict: null,
          confidence: null,
          rationale: null,
          submittedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    return this.getAuditRequest(projectId, requestId);
  }

  pollPendingAuditWork(userId: string, options: PollAuditWorkOptions) {
    const target = options.peerKey ? null : normalizeHandoffTarget(options.target ?? 'vscode');
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + AUDIT_CLAIM_TTL_MS);

    const rows = this.db.select({
      result: schema.platformProjectAuditResults,
      request: schema.platformProjectAuditRequests,
      peer: schema.platformProjectPeers,
      project: schema.platformProjects,
    })
      .from(schema.platformProjectAuditResults)
      .innerJoin(
        schema.platformProjectAuditRequests,
        eq(schema.platformProjectAuditResults.auditRequestId, schema.platformProjectAuditRequests.id),
      )
      .innerJoin(
        schema.platformProjectPeers,
        and(
          eq(schema.platformProjectAuditResults.projectId, schema.platformProjectPeers.projectId),
          eq(schema.platformProjectAuditResults.peerKey, schema.platformProjectPeers.peerKey),
        ),
      )
      .innerJoin(schema.platformProjects, eq(schema.platformProjectAuditResults.projectId, schema.platformProjects.id))
      .all()
      .filter(({ project, result, peer }) => {
        if (!this.canReadProject(project.id, userId)) return false;
        if (options.peerKey && result.peerKey !== options.peerKey) return false;
        if (!options.peerKey && target && peer.launchTarget !== target) return false;
        if (peer.preferredClientId && peer.preferredClientId !== (options.clientId ?? null)) return false;
        if (result.status === 'submitted') return false;
        if (result.status === 'claimed' && result.claimExpiresAt && result.claimExpiresAt > now) return false;
        return true;
      })
      .sort((left, right) => left.request.createdAt.getTime() - right.request.createdAt.getTime());

    const next = rows[0];
    if (!next) return null;

    this.db.update(schema.platformProjectAuditResults)
      .set({
        status: 'claimed',
        claimedByUserId: userId,
        claimedByClientId: options.clientId ?? null,
        claimedAt: now,
        claimExpiresAt,
        updatedAt: now,
      })
      .where(eq(schema.platformProjectAuditResults.id, next.result.id))
      .run();

    return {
      auditRequestId: next.request.id,
      projectId: next.project.id,
      sandboxProjectId: next.project.sandboxProjectId,
      projectName: next.project.name,
      projectRootDir: next.project.rootDir,
      prompt: next.request.prompt,
      scope: next.request.scope,
      createdAt: next.request.createdAt,
      peerKey: next.peer.peerKey,
      peerDisplayName: next.peer.displayName,
      peerIde: next.peer.ide,
      peerModel: next.peer.model,
      launchTarget: next.peer.launchTarget,
      preferredClientId: next.peer.preferredClientId,
      instructions: next.peer.instructions,
    };
  }

  submitAuditResult(projectId: string, auditRequestId: string, input: AuditResultInput) {
    const request = this.db.select().from(schema.platformProjectAuditRequests)
      .where(and(
        eq(schema.platformProjectAuditRequests.id, auditRequestId),
        eq(schema.platformProjectAuditRequests.projectId, projectId),
      ))
      .get();
    if (!request) throw new Error('Audit request not found');

    const now = new Date();
    const confidence = clampConfidence(input.confidence);
    const result = this.db.select().from(schema.platformProjectAuditResults)
      .where(and(
        eq(schema.platformProjectAuditResults.auditRequestId, auditRequestId),
        eq(schema.platformProjectAuditResults.peerKey, input.peerKey),
      ))
      .get();

    if (result?.status === 'claimed') {
      if (result.claimedByUserId && result.claimedByUserId !== (input.claimedByUserId ?? null)) {
        throw new Error('This audit claim belongs to a different user');
      }
      if (result.claimedByClientId && result.claimedByClientId !== (input.claimedByClientId ?? null)) {
        throw new Error('This audit claim belongs to a different client');
      }
      if (result.claimExpiresAt && result.claimExpiresAt.getTime() <= now.getTime()) {
        throw new Error('This audit claim expired; poll again before submitting');
      }
    }

    if (result) {
      this.db.update(schema.platformProjectAuditResults)
        .set({
          status: 'submitted',
          claimedByUserId: result.claimedByUserId ?? input.claimedByUserId ?? null,
          claimedByClientId: result.claimedByClientId ?? input.claimedByClientId ?? null,
          claimedAt: result.claimedAt ?? now,
          claimExpiresAt: null,
          verdict: input.verdict.trim(),
          confidence,
          rationale: input.rationale?.trim() || null,
          submittedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.platformProjectAuditResults.id, result.id))
        .run();
    } else {
      this.db.insert(schema.platformProjectAuditResults)
        .values({
          id: randomUUID(),
          auditRequestId,
          projectId,
          peerKey: input.peerKey,
          status: 'submitted',
          claimedByUserId: input.claimedByUserId ?? null,
          claimedByClientId: input.claimedByClientId ?? null,
          claimedAt: input.claimedByUserId || input.claimedByClientId ? now : null,
          claimExpiresAt: null,
          verdict: input.verdict.trim(),
          confidence,
          rationale: input.rationale?.trim() || null,
          submittedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const results = this.listAuditResults(auditRequestId);
    const submitted = results.filter((item) => item.status === 'submitted' && item.verdict);
    const pending = results.filter((item) => item.status !== 'submitted').length;
    const winner = submitted
      .slice()
      .sort((left, right) => (right.confidence ?? -1) - (left.confidence ?? -1))[0] ?? null;

    this.db.update(schema.platformProjectAuditRequests)
      .set({
        status: pending === 0 && results.length > 0 ? 'completed' : 'collecting',
        winningPeerKey: winner?.peerKey ?? null,
        consensusSummary: winner
          ? `${winner.peerKey} is currently leading with confidence ${winner.confidence ?? 'n/a'}.`
          : 'Waiting for the first peer verdict.',
        updatedAt: now,
      })
      .where(eq(schema.platformProjectAuditRequests.id, auditRequestId))
      .run();

    return this.getAuditRequest(projectId, auditRequestId);
  }

  createShareLink(projectId: string, creatorUserId: string | null, role: string | undefined, expiresInHours: number | undefined, maxUses: number | undefined) {
    const token = createToken();
    const now = new Date();
    const expiresAt = typeof expiresInHours === 'number' && expiresInHours > 0
      ? new Date(now.getTime() + expiresInHours * 60 * 60 * 1000)
      : new Date(now.getTime() + 72 * 60 * 60 * 1000);
    const resolvedRole = normalizeRole(role);

    this.db.insert(schema.platformProjectShareLinks)
      .values({
        id: randomUUID(),
        projectId,
        tokenHash: hashToken(token),
        role: resolvedRole,
        maxUses: Math.max(1, maxUses ?? 1),
        useCount: 0,
        expiresAt,
        revokedAt: null,
        createdByUserId: creatorUserId,
        createdAt: now,
      })
      .run();

    return {
      token,
      role: resolvedRole,
      expiresAt: expiresAt.toISOString(),
      maxUses: Math.max(1, maxUses ?? 1),
    };
  }

  getShareLinkPreview(token: string) {
    this.purgeExpiredHandoffs();
    const row = this.db.select()
      .from(schema.platformProjectShareLinks)
      .where(eq(schema.platformProjectShareLinks.tokenHash, hashToken(token)))
      .get();
    if (!row || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
    if (row.useCount >= row.maxUses) return null;

    const project = this.getProject(row.projectId);
    if (!project) return null;
    return {
      projectId: project.id,
      projectName: project.name,
      role: normalizeRole(row.role),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      remainingUses: Math.max(0, row.maxUses - row.useCount),
    };
  }

  redeemShareLink(token: string, userId: string) {
    const row = this.db.select()
      .from(schema.platformProjectShareLinks)
      .where(eq(schema.platformProjectShareLinks.tokenHash, hashToken(token)))
      .get();
    if (!row || row.revokedAt) throw new Error('Share link is invalid');
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) throw new Error('Share link expired');
    if (row.useCount >= row.maxUses) throw new Error('Share link has no remaining uses');

    this.upsertMember(row.projectId, userId, normalizeRole(row.role), row.createdByUserId ?? userId);
    this.db.update(schema.platformProjectShareLinks)
      .set({ useCount: row.useCount + 1 })
      .where(eq(schema.platformProjectShareLinks.id, row.id))
      .run();

    return this.getProject(row.projectId);
  }

  createHandoffIntent(projectId: string, creatorUserId: string | null, target: HandoffTarget, clientInfo?: string) {
    const token = createToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + HANDOFF_TTL_MS);

    this.db.insert(schema.platformProjectHandoffIntents)
      .values({
        id: randomUUID(),
        projectId,
        tokenHash: hashToken(token),
        target,
        status: 'pending',
        createdByUserId: creatorUserId,
        claimedByUserId: null,
        clientInfo: clientInfo ?? null,
        expiresAt,
        claimedAt: null,
        createdAt: now,
      })
      .run();

    return {
      token,
      target,
      expiresAt: expiresAt.toISOString(),
      launchUrl: target === 'vscode'
        ? `vscode://v3gga.vai-devlogs/openSandbox?intent=${encodeURIComponent(token)}`
        : null,
    };
  }

  consumeHandoffIntent(token: string, target?: HandoffTarget, claimedByUserId?: string | null) {
    this.purgeExpiredHandoffs();
    const row = this.db.select()
      .from(schema.platformProjectHandoffIntents)
      .where(eq(schema.platformProjectHandoffIntents.tokenHash, hashToken(token)))
      .get();
    if (!row) throw new Error('Handoff intent is invalid or expired');
    if (target && row.target !== target) throw new Error('Handoff target mismatch');
    if (row.status !== 'pending') throw new Error('Handoff intent has already been used');
    if (row.expiresAt.getTime() <= Date.now()) throw new Error('Handoff intent expired');

    this.db.update(schema.platformProjectHandoffIntents)
      .set({
        status: 'claimed',
        claimedByUserId: claimedByUserId ?? null,
        claimedAt: new Date(),
      })
      .where(eq(schema.platformProjectHandoffIntents.id, row.id))
      .run();

    const project = this.getProject(row.projectId);
    if (!project) throw new Error('Project no longer exists');

    this.db.update(schema.platformProjects)
      .set({ lastOpenedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.platformProjects.id, project.id))
      .run();

    return {
      project,
      target: row.target as HandoffTarget,
      role: this.getProjectRole(project.id, claimedByUserId ?? null),
    };
  }

  pollPendingHandoff(userId: string, target: HandoffTarget) {
    this.purgeExpiredHandoffs();
    const row = this.db.select()
      .from(schema.platformProjectHandoffIntents)
      .where(and(
        eq(schema.platformProjectHandoffIntents.target, target),
        eq(schema.platformProjectHandoffIntents.status, 'pending'),
        eq(schema.platformProjectHandoffIntents.createdByUserId, userId),
        gt(schema.platformProjectHandoffIntents.expiresAt, new Date()),
      ))
      .get();
    if (!row) return null;

    this.db.update(schema.platformProjectHandoffIntents)
      .set({
        status: 'claimed',
        claimedByUserId: userId,
        claimedAt: new Date(),
      })
      .where(eq(schema.platformProjectHandoffIntents.id, row.id))
      .run();

    const project = this.getProject(row.projectId);
    if (!project) return null;

    this.db.update(schema.platformProjects)
      .set({ lastOpenedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.platformProjects.id, project.id))
      .run();

    return {
      project,
      target,
      role: this.getProjectRole(project.id, userId),
    };
  }

  getAuditRequest(projectId: string, auditRequestId: string) {
    const request = this.db.select().from(schema.platformProjectAuditRequests)
      .where(and(
        eq(schema.platformProjectAuditRequests.id, auditRequestId),
        eq(schema.platformProjectAuditRequests.projectId, projectId),
      ))
      .get();
    if (!request) return null;
    return {
      ...request,
      results: this.listAuditResults(auditRequestId),
    };
  }

  private listAuditResults(auditRequestId: string) {
    const results = this.db.select().from(schema.platformProjectAuditResults)
      .where(eq(schema.platformProjectAuditResults.auditRequestId, auditRequestId))
      .all()
      .sort((left, right) => left.peerKey.localeCompare(right.peerKey));

    const claimedByClientMap = this.getCompanionClientMap(
      results
        .map((result) => result.claimedByClientId)
        .filter((clientId): clientId is string => Boolean(clientId)),
    );

    const claimedByUserMap = this.getClaimedByUserMap(
      results
        .map((result) => result.claimedByUserId)
        .filter((userId): userId is string => Boolean(userId)),
    );

    const now = Date.now();

    return results.map((result) => ({
      ...result,
      claimIsStale: result.status === 'claimed' && result.claimExpiresAt !== null
        ? result.claimExpiresAt.getTime() <= now
        : false,
      claimedByUser: result.claimedByUserId ? claimedByUserMap.get(result.claimedByUserId) ?? null : null,
      claimedByClient: result.claimedByClientId ? claimedByClientMap.get(result.claimedByClientId) ?? null : null,
    }));
  }

  private getCompanionClientMap(clientIds: string[]): Map<string, CompanionClientSummary> {
    if (clientIds.length === 0) return new Map();

    const clients = this.db.select({
      id: schema.platformCompanionClients.id,
      clientName: schema.platformCompanionClients.clientName,
      clientType: schema.platformCompanionClients.clientType,
      launchTarget: schema.platformCompanionClients.launchTarget,
      lastSeenAt: schema.platformCompanionClients.lastSeenAt,
      lastPolledAt: schema.platformCompanionClients.lastPolledAt,
    })
      .from(schema.platformCompanionClients)
      .where(inArray(schema.platformCompanionClients.id, clientIds))
      .all();

    return new Map(clients.map((client) => [client.id, client]));
  }

  private getClaimedByUserMap(userIds: string[]): Map<string, ClaimedByUserSummary> {
    if (userIds.length === 0) return new Map();

    const users = this.db.select({
      id: schema.platformUsers.id,
      name: schema.platformUsers.name,
      email: schema.platformUsers.email,
    })
      .from(schema.platformUsers)
      .where(inArray(schema.platformUsers.id, userIds))
      .all();

    return new Map(users.map((user) => [user.id, user]));
  }

  private upsertMember(projectId: string, userId: string, role: ProjectRole, invitedByUserId: string) {
    const now = new Date();
    const existing = this.db.select().from(schema.platformProjectMembers)
      .where(and(
        eq(schema.platformProjectMembers.projectId, projectId),
        eq(schema.platformProjectMembers.userId, userId),
      ))
      .get();

    if (existing) {
      this.db.update(schema.platformProjectMembers)
        .set({ role, invitedByUserId, updatedAt: now })
        .where(eq(schema.platformProjectMembers.id, existing.id))
        .run();
      return;
    }

    this.db.insert(schema.platformProjectMembers)
      .values({
        id: randomUUID(),
        projectId,
        userId,
        role,
        invitedByUserId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  private purgeExpiredHandoffs() {
    this.db.delete(schema.platformProjectHandoffIntents)
      .where(or(
        and(
          eq(schema.platformProjectHandoffIntents.status, 'pending'),
          lt(schema.platformProjectHandoffIntents.expiresAt, new Date()),
        ),
        and(
          eq(schema.platformProjectHandoffIntents.status, 'claimed'),
          lt(schema.platformProjectHandoffIntents.expiresAt, new Date()),
        ),
      ))
      .run();
  }

  // ── Broadcast (IDE Orchestra) ────────────────────────────────

  private static BROADCAST_TTL_MS = 5 * 60 * 1000; // 5 min default TTL
  private static BROADCAST_CLAIM_TTL_MS = 3 * 60 * 1000; // 3 min claim window

  createBroadcast(
    senderUserId: string,
    content: string,
    options: { projectId?: string; targetClientIds?: string[]; ttlMs?: number; meta?: { preferredModel?: string } },
  ) {
    const now = new Date();
    const ttl = options.ttlMs ?? ProjectService.BROADCAST_TTL_MS;
    const expiresAt = new Date(now.getTime() + ttl);
    const broadcastId = randomUUID();
    const targetMode = options.targetClientIds?.length ? 'selected' : 'all';

    this.db.insert(schema.platformBroadcastMessages)
      .values({
        id: broadcastId,
        projectId: options.projectId ?? null,
        senderUserId,
        content,
        meta: options.meta ? JSON.stringify(options.meta) : null,
        targetMode,
        targetClientIds: options.targetClientIds?.length ? JSON.stringify(options.targetClientIds) : null,
        status: 'pending',
        createdAt: now,
        expiresAt,
      })
      .run();

    // Resolve target clients
    let clientIds: string[];
    if (options.targetClientIds?.length) {
      clientIds = options.targetClientIds;
    } else if (options.projectId) {
      clientIds = this.listCompanionClients(options.projectId).map((c) => c.id);
    } else {
      // All companion clients for this user
      clientIds = this.db.select({ id: schema.platformCompanionClients.id })
        .from(schema.platformCompanionClients)
        .where(eq(schema.platformCompanionClients.userId, senderUserId))
        .all()
        .map((c) => c.id);
    }

    // Create delivery rows
    for (const clientId of clientIds) {
      this.db.insert(schema.platformBroadcastDeliveries)
        .values({
          id: randomUUID(),
          broadcastId,
          targetClientId: clientId,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    return {
      id: broadcastId,
      targetMode,
      deliveryCount: clientIds.length,
      expiresAt,
    };
  }

  touchCompanionClientPoll(clientId: string) {
    this.db.update(schema.platformCompanionClients)
      .set({ lastPolledAt: new Date() })
      .where(eq(schema.platformCompanionClients.id, clientId))
      .run();
  }

  updateCompanionClientModels(clientId: string, models: Array<{ id: string; family: string; name: string; vendor: string }>) {
    this.db.update(schema.platformCompanionClients)
      .set({ availableModels: JSON.stringify(models), updatedAt: new Date() })
      .where(eq(schema.platformCompanionClients.id, clientId))
      .run();
  }

  updateCompanionClientChatInfo(clientId: string, chatInfo: { chatApps: Array<{ id: string; label: string }>; sessions: Array<{ sessionId: string; title: string; lastModified: number; chatApp: string }> }) {
    this.db.update(schema.platformCompanionClients)
      .set({ availableChatInfo: JSON.stringify(chatInfo), updatedAt: new Date() })
      .where(eq(schema.platformCompanionClients.id, clientId))
      .run();
  }

  pollBroadcastWork(clientId: string) {
    const now = new Date();

    // Find the oldest pending delivery for this client where broadcast hasn't expired
    const rows = this.db.select({
      delivery: schema.platformBroadcastDeliveries,
      broadcast: schema.platformBroadcastMessages,
    })
      .from(schema.platformBroadcastDeliveries)
      .innerJoin(
        schema.platformBroadcastMessages,
        eq(schema.platformBroadcastDeliveries.broadcastId, schema.platformBroadcastMessages.id),
      )
      .where(
        and(
          eq(schema.platformBroadcastDeliveries.targetClientId, clientId),
          eq(schema.platformBroadcastDeliveries.status, 'pending'),
        ),
      )
      .all()
      .filter(({ broadcast }) => broadcast.expiresAt > now)
      .sort((a, b) => a.broadcast.createdAt.getTime() - b.broadcast.createdAt.getTime());

    const next = rows[0];
    if (!next) return null;

    // Claim it
    this.db.update(schema.platformBroadcastDeliveries)
      .set({ status: 'claimed', claimedAt: now, updatedAt: now })
      .where(eq(schema.platformBroadcastDeliveries.id, next.delivery.id))
      .run();

    return {
      deliveryId: next.delivery.id,
      broadcastId: next.broadcast.id,
      projectId: next.broadcast.projectId,
      content: next.broadcast.content,
      meta: next.broadcast.meta ? JSON.parse(next.broadcast.meta) : null,
      senderUserId: next.broadcast.senderUserId,
      createdAt: next.broadcast.createdAt,
      expiresAt: next.broadcast.expiresAt,
    };
  }

  submitBroadcastResponse(deliveryId: string, clientId: string, responseContent: string, meta?: { model?: string; tokensIn?: number; tokensOut?: number; durationMs?: number }) {
    const now = new Date();
    const delivery = this.db.select().from(schema.platformBroadcastDeliveries)
      .where(and(
        eq(schema.platformBroadcastDeliveries.id, deliveryId),
        eq(schema.platformBroadcastDeliveries.targetClientId, clientId),
      ))
      .get();

    if (!delivery) throw new Error('Delivery not found');
    // Allow updating a response (auto-ack → real reply)

    this.db.update(schema.platformBroadcastDeliveries)
      .set({
        status: 'responded',
        respondedAt: now,
        responseContent,
        responseMeta: meta ? JSON.stringify(meta) : null,
        updatedAt: now,
      })
      .where(eq(schema.platformBroadcastDeliveries.id, deliveryId))
      .run();

    // Check if all deliveries for this broadcast are done
    const broadcastId = delivery.broadcastId;
    const allDeliveries = this.db.select().from(schema.platformBroadcastDeliveries)
      .where(eq(schema.platformBroadcastDeliveries.broadcastId, broadcastId))
      .all();
    const allDone = allDeliveries.every((d) => d.status === 'responded' || d.status === 'expired');
    const anyResponded = allDeliveries.some((d) => d.status === 'responded');

    this.db.update(schema.platformBroadcastMessages)
      .set({
        status: allDone ? 'completed' : (anyResponded ? 'partial' : 'pending'),
      })
      .where(eq(schema.platformBroadcastMessages.id, broadcastId))
      .run();

    return { ok: true, broadcastStatus: allDone ? 'completed' : 'partial' };
  }

  getBroadcastWithResponses(broadcastId: string) {
    const broadcast = this.db.select().from(schema.platformBroadcastMessages)
      .where(eq(schema.platformBroadcastMessages.id, broadcastId))
      .get();
    if (!broadcast) return null;

    const deliveries = this.db.select({
      delivery: schema.platformBroadcastDeliveries,
      client: {
        id: schema.platformCompanionClients.id,
        clientName: schema.platformCompanionClients.clientName,
        clientType: schema.platformCompanionClients.clientType,
        launchTarget: schema.platformCompanionClients.launchTarget,
      },
    })
      .from(schema.platformBroadcastDeliveries)
      .innerJoin(
        schema.platformCompanionClients,
        eq(schema.platformBroadcastDeliveries.targetClientId, schema.platformCompanionClients.id),
      )
      .where(eq(schema.platformBroadcastDeliveries.broadcastId, broadcastId))
      .all();

    return {
      ...broadcast,
      deliveries: deliveries.map(({ delivery, client }) => ({
        id: delivery.id,
        client,
        status: delivery.status,
        claimedAt: delivery.claimedAt,
        respondedAt: delivery.respondedAt,
        responseContent: delivery.responseContent,
        responseMeta: delivery.responseMeta ? JSON.parse(delivery.responseMeta) : null,
      })),
    };
  }

  listBroadcasts(userId: string, options?: { projectId?: string; limit?: number }) {
    const limit = Math.min(options?.limit ?? 20, 100);
    let rows = this.db.select().from(schema.platformBroadcastMessages)
      .where(eq(schema.platformBroadcastMessages.senderUserId, userId))
      .all()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (options?.projectId) {
      rows = rows.filter((r) => r.projectId === options.projectId);
    }

    return rows.slice(0, limit).map((row) => {
      const deliveries = this.db.select().from(schema.platformBroadcastDeliveries)
        .where(eq(schema.platformBroadcastDeliveries.broadcastId, row.id))
        .all();

      return {
        ...row,
        deliveryCount: deliveries.length,
        respondedCount: deliveries.filter((d) => d.status === 'responded').length,
      };
    });
  }

  purgeExpiredBroadcasts() {
    const now = new Date();
    const expired = this.db.select({ id: schema.platformBroadcastMessages.id })
      .from(schema.platformBroadcastMessages)
      .where(and(
        lt(schema.platformBroadcastMessages.expiresAt, now),
        or(
          eq(schema.platformBroadcastMessages.status, 'pending'),
          eq(schema.platformBroadcastMessages.status, 'partial'),
        ),
      ))
      .all();

    for (const row of expired) {
      this.db.update(schema.platformBroadcastDeliveries)
        .set({ status: 'expired', updatedAt: now })
        .where(and(
          eq(schema.platformBroadcastDeliveries.broadcastId, row.id),
          or(
            eq(schema.platformBroadcastDeliveries.status, 'pending'),
            eq(schema.platformBroadcastDeliveries.status, 'claimed'),
          ),
        ))
        .run();

      this.db.update(schema.platformBroadcastMessages)
        .set({ status: 'expired' })
        .where(eq(schema.platformBroadcastMessages.id, row.id))
        .run();
    }

    return expired.length;
  }
}