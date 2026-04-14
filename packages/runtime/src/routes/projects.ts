import type { FastifyInstance } from 'fastify';
import { PlatformAuthService, type PlatformViewer } from '../auth/platform-auth.js';
import { type HandoffTarget, ProjectService } from '../projects/service.js';
import type { SandboxManager } from '../sandbox/manager.js';

type AuthenticatedViewer = PlatformViewer & {
  authenticated: true;
  user: NonNullable<PlatformViewer['user']>;
};

function normalizeHandoffTarget(target?: string): HandoffTarget {
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

function normalizePeerStatus(status?: string): 'idle' | 'invited' | 'ready' | 'active' {
  switch (status) {
    case 'idle':
    case 'ready':
    case 'active':
    case 'invited':
      return status;
    default:
      return 'invited';
  }
}

function normalizePeerIde(ide?: string): string {
  const value = ide?.trim().toLowerCase() ?? '';
  const normalized = value
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'desktop';
}

function resolvePeerLaunchTarget(launchTarget?: string, ide?: string): HandoffTarget {
  if (launchTarget?.trim()) return normalizeHandoffTarget(launchTarget);
  const normalizedIde = normalizePeerIde(ide);
  return normalizedIde === 'vscode' || normalizedIde === 'cursor' || normalizedIde === 'antigravity'
    ? normalizedIde
    : 'desktop';
}

async function requireViewer(
  auth: PlatformAuthService,
  request: Parameters<FastifyInstance['get']>[1] extends never ? never : any,
  reply: Parameters<FastifyInstance['get']>[1] extends never ? never : any,
): Promise<AuthenticatedViewer | null> {
  const viewer = await auth.getViewer(request);
  if (!viewer.authenticated || !viewer.user) {
    reply.code(401);
    return null;
  }
  return viewer as AuthenticatedViewer;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  auth: PlatformAuthService,
  projects: ProjectService,
  sandbox: SandboxManager,
) {
  app.get('/api/projects', async (request, reply) => {
    const viewer = await requireViewer(auth, request, reply);
    if (!viewer) return { error: 'Sign in to view projects' };

    return projects.listProjectsForUser(viewer.user.id).map((project) => ({
      id: project.id,
      sandboxProjectId: project.sandboxProjectId,
      name: project.name,
      slug: project.slug,
      status: project.status,
      visibility: project.visibility,
      role: project.role,
      updatedAt: project.updatedAt,
    }));
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const viewer = await requireViewer(auth, request, reply);
    if (!viewer) return { error: 'Sign in to view this project' };
    if (!projects.canReadProject(request.params.id, viewer.user.id)) {
      reply.code(403);
      return { error: 'You do not have access to this project' };
    }

    const project = projects.getProject(request.params.id);
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }

    const liveSandbox = sandbox.get(project.sandboxProjectId);
    return {
      ...project,
      role: projects.getProjectRole(project.id, viewer.user.id),
      devPort: liveSandbox?.devPort ?? null,
      devUrl: liveSandbox?.devPort ? `http://localhost:${liveSandbox.devPort}` : null,
    };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/members', async (request, reply) => {
    const viewer = await requireViewer(auth, request, reply);
    if (!viewer) return { error: 'Sign in to view project members' };
    if (!projects.canReadProject(request.params.id, viewer.user.id)) {
      reply.code(403);
      return { error: 'You do not have access to this project' };
    }
    return projects.listMembers(request.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/peers', async (request, reply) => {
    const viewer = await requireViewer(auth, request, reply);
    if (!viewer) return { error: 'Sign in to view project peers' };
    if (!projects.canReadProject(request.params.id, viewer.user.id)) {
      reply.code(403);
      return { error: 'You do not have access to this project' };
    }
    return projects.listPeers(request.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/companion-clients', async (request, reply) => {
    const viewer = await requireViewer(auth, request, reply);
    if (!viewer) return { error: 'Sign in to view companion clients' };
    if (!projects.canReadProject(request.params.id, viewer.user.id)) {
      reply.code(403);
      return { error: 'You do not have access to this project' };
    }
    return projects.listCompanionClients(request.params.id);
  });

  app.put<{ Params: { id: string }; Body: { peers?: Array<{ peerKey?: string; displayName?: string; ide?: string; model?: string; status?: string; launchTarget?: string; preferredClientId?: string | null; instructions?: string | null }> } }>(
    '/api/projects/:id/peers',
    async (request, reply) => {
      const viewer = await requireViewer(auth, request, reply);
      if (!viewer) return { error: 'Sign in to update project peers' };
      if (!projects.canWriteProject(request.params.id, viewer.user.id)) {
        reply.code(403);
        return { error: 'You do not have permission to manage project peers' };
      }

      const peers = (request.body?.peers ?? [])
        .filter((peer) => peer.displayName?.trim() && peer.ide?.trim() && peer.model?.trim())
        .map((peer) => ({
          peerKey: peer.peerKey,
          displayName: peer.displayName!.trim(),
          ide: normalizePeerIde(peer.ide),
          model: peer.model!.trim(),
          status: normalizePeerStatus(peer.status),
          launchTarget: resolvePeerLaunchTarget(peer.launchTarget, peer.ide),
          preferredClientId: peer.preferredClientId?.trim() || null,
          instructions: peer.instructions ?? null,
        }));

      return projects.replacePeers(request.params.id, viewer.user.id, peers);
    },
  );

  app.get<{ Params: { id: string } }>('/api/projects/:id/audits', async (request, reply) => {
    const viewer = await requireViewer(auth, request, reply);
    if (!viewer) return { error: 'Sign in to view audits' };
    if (!projects.canReadProject(request.params.id, viewer.user.id)) {
      reply.code(403);
      return { error: 'You do not have access to this project' };
    }
    return projects.listAuditRequests(request.params.id);
  });

  app.post<{ Params: { id: string }; Body: { prompt?: string; scope?: string; peerKeys?: string[] } }>(
    '/api/projects/:id/audits',
    async (request, reply) => {
      const viewer = await requireViewer(auth, request, reply);
      if (!viewer) return { error: 'Sign in to request an audit' };
      if (!projects.canReadProject(request.params.id, viewer.user.id)) {
        reply.code(403);
        return { error: 'You do not have access to this project' };
      }

      const prompt = request.body?.prompt?.trim();
      if (!prompt) {
        reply.code(400);
        return { error: 'Audit prompt is required' };
      }

      return projects.createAuditRequest(request.params.id, viewer.user.id, prompt, request.body?.scope, request.body?.peerKeys);
    },
  );

  app.post<{ Params: { id: string; auditId: string }; Body: { peerKey?: string; verdict?: string; confidence?: number; rationale?: string | null } }>(
    '/api/projects/:id/audits/:auditId/results',
    async (request, reply) => {
      const viewer = await requireViewer(auth, request, reply);
      if (!viewer) return { error: 'Sign in to submit an audit result' };
      if (!projects.canReadProject(request.params.id, viewer.user.id)) {
        reply.code(403);
        return { error: 'You do not have access to this project' };
      }

      const peerKey = request.body?.peerKey?.trim();
      const verdict = request.body?.verdict?.trim();
      if (!peerKey || !verdict) {
        reply.code(400);
        return { error: 'peerKey and verdict are required' };
      }

      try {
        return projects.submitAuditResult(request.params.id, request.params.auditId, {
          peerKey,
          verdict,
          confidence: request.body?.confidence,
          rationale: request.body?.rationale ?? null,
          claimedByUserId: viewer.user.id,
          claimedByClientId: viewer.companionClient?.id ?? null,
        });
      } catch (error) {
        reply.code(400);
        return { error: error instanceof Error ? error.message : 'Unable to submit audit result' };
      }
    },
  );

  app.post<{ Body: { target?: HandoffTarget; peerKey?: string } }>('/api/projects/audits/poll-consume', async (request, reply) => {
    const viewer = await requireViewer(auth, request, reply);
    if (!viewer) return { error: 'Sign in to claim audit work' };

    const workItem = projects.pollPendingAuditWork(viewer.user.id, {
      target: request.body?.target ? normalizeHandoffTarget(request.body.target) : 'vscode',
      peerKey: request.body?.peerKey?.trim() || undefined,
      clientId: viewer.companionClient?.id ?? null,
    });

    if (!workItem) {
      reply.code(204);
      return null;
    }

    const liveSandbox = sandbox.get(workItem.sandboxProjectId);
    return {
      ...workItem,
      devPort: liveSandbox?.devPort ?? null,
      devUrl: liveSandbox?.devPort ? `http://localhost:${liveSandbox.devPort}` : null,
    };
  });

  app.post<{ Params: { id: string }; Body: { role?: string; expiresInHours?: number; maxUses?: number } }>(
    '/api/projects/:id/share-links',
    async (request, reply) => {
      const viewer = await requireViewer(auth, request, reply);
      if (!viewer) return { error: 'Sign in to create share links' };
      if (!projects.canWriteProject(request.params.id, viewer.user.id)) {
        reply.code(403);
        return { error: 'You do not have permission to share this project' };
      }

      const link = projects.createShareLink(
        request.params.id,
        viewer.user.id,
        request.body?.role,
        request.body?.expiresInHours,
        request.body?.maxUses,
      );

      return {
        role: link.role,
        expiresAt: link.expiresAt,
        maxUses: link.maxUses,
        token: link.token,
        redeemUrl: `/api/projects/share/${encodeURIComponent(link.token)}`,
      };
    },
  );

  app.get<{ Params: { token: string } }>('/api/projects/share/:token', async (request, reply) => {
    const preview = projects.getShareLinkPreview(request.params.token);
    if (!preview) {
      reply.code(404);
      return { error: 'Share link is invalid or expired' };
    }
    return preview;
  });

  app.post<{ Params: { token: string } }>('/api/projects/share/:token/redeem', async (request, reply) => {
    const viewer = await requireViewer(auth, request, reply);
    if (!viewer) return { error: 'Sign in to redeem this share link' };

    try {
      const project = projects.redeemShareLink(request.params.token, viewer.user.id);
      return {
        ok: true,
        projectId: project?.id,
        sandboxProjectId: project?.sandboxProjectId,
        role: project ? projects.getProjectRole(project.id, viewer.user.id) : null,
      };
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Unable to redeem share link' };
    }
  });

  app.post<{ Params: { id: string }; Body: { target?: HandoffTarget; clientInfo?: string } }>(
    '/api/projects/:id/handoff-intents',
    async (request, reply) => {
      const viewer = await requireViewer(auth, request, reply);
      if (!viewer) return { error: 'Sign in to create handoff intents' };
      if (!projects.canReadProject(request.params.id, viewer.user.id)) {
        reply.code(403);
        return { error: 'You do not have access to this project' };
      }

      const target = normalizeHandoffTarget(request.body?.target);
      const handoff = projects.createHandoffIntent(request.params.id, viewer.user.id, target, request.body?.clientInfo);
      return handoff;
    },
  );

  app.post<{ Body: { intentToken?: string; target?: HandoffTarget } }>('/api/projects/handoff/consume', async (request, reply) => {
    const intentToken = request.body?.intentToken?.trim();
    if (!intentToken) {
      reply.code(400);
      return { error: 'Missing handoff intent token' };
    }

    const viewer = await auth.getViewer(request);

    try {
      const handoff = projects.consumeHandoffIntent(intentToken, request.body?.target ? normalizeHandoffTarget(request.body.target) : undefined, viewer.user?.id ?? null);
      const liveSandbox = sandbox.get(handoff.project.sandboxProjectId);
      return {
        projectId: handoff.project.id,
        sandboxProjectId: handoff.project.sandboxProjectId,
        name: handoff.project.name,
        rootDir: handoff.project.rootDir,
        role: handoff.role,
        target: handoff.target,
        devPort: liveSandbox?.devPort ?? null,
        devUrl: liveSandbox?.devPort ? `http://localhost:${liveSandbox.devPort}` : null,
      };
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Unable to consume handoff intent' };
    }
  });

  app.post<{ Body: { target?: HandoffTarget } }>('/api/projects/handoff/poll-consume', async (request, reply) => {
    const viewer = await requireViewer(auth, request, reply);
    if (!viewer) return { error: 'Sign in to poll handoff intents' };

    const target = normalizeHandoffTarget(request.body?.target);
    const handoff = projects.pollPendingHandoff(viewer.user.id, target);
    if (!handoff) {
      reply.code(204);
      return null;
    }

    const liveSandbox = sandbox.get(handoff.project.sandboxProjectId);
    return {
      projectId: handoff.project.id,
      sandboxProjectId: handoff.project.sandboxProjectId,
      name: handoff.project.name,
      rootDir: handoff.project.rootDir,
      role: handoff.role,
      target: handoff.target,
      devPort: liveSandbox?.devPort ?? null,
      devUrl: liveSandbox?.devPort ? `http://localhost:${liveSandbox.devPort}` : null,
    };
  });
}