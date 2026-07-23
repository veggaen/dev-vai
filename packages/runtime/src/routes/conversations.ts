import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_CONVERSATION_MODE, type ChatPromptRewriteOverrides, type ChatService, type ConversationMode } from '@vai/core';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import type { SandboxManager } from '../sandbox/manager.js';
import type { ProjectService } from '../projects/service.js';
import { authorizeConversationAccess } from '../access/conversations.js';
import {
  assistantNoteBodySchema,
  createConversationBodySchema,
  patchConversationBodySchema,
  postConversationMessageBodySchema,
} from '@vai/contracts/conversations';
import { invalidRequestBody } from '../validation/http-validation.js';

/**
 * Build a unique sandbox project name for a conversation.
 * One conversation = one project; a shared default name ('builder-app')
 * made distinct projects indistinguishable in the projects list.
 */
function uniqueSandboxName(title: string | undefined | null, conversationId: string): string {
  const base = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    || 'builder-app';
  return `${base}-${conversationId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)}`;
}

function getProjectBySandboxId(projects: ProjectService, sandboxProjectId: string) {
  return typeof projects.getProjectBySandboxId === 'function'
    ? projects.getProjectBySandboxId(sandboxProjectId)
    : null;
}

function canReadProject(projects: ProjectService, projectId: string, viewerId: string | null) {
  return typeof projects.canReadProject === 'function'
    ? projects.canReadProject(projectId, viewerId)
    : true;
}

function canReadSandbox(projects: ProjectService, sandboxProjectId: string, viewerId: string | null) {
  return typeof projects.canReadSandbox === 'function'
    ? projects.canReadSandbox(sandboxProjectId, viewerId)
    : true;
}

function syncSandboxProject(projects: ProjectService, project: unknown) {
  if (typeof projects.syncSandboxProject === 'function') {
    projects.syncSandboxProject(project as Parameters<ProjectService['syncSandboxProject']>[0]);
  }
}

function getSandboxProject(projects: ProjectService, sandbox: SandboxManager, sandboxProjectId: string) {
  if (typeof sandbox.get !== 'function') {
    return { id: sandboxProjectId };
  }

  const liveProject = sandbox.get(sandboxProjectId);
  if (liveProject) {
    return liveProject;
  }

  const persistedProject = getProjectBySandboxId(projects, sandboxProjectId);
  if (
    !persistedProject
    || !persistedProject.rootDir
    || !existsSync(persistedProject.rootDir)
    || typeof sandbox.rehydrate !== 'function'
  ) {
    return null;
  }

  return sandbox.rehydrate({
    id: persistedProject.sandboxProjectId,
    name: persistedProject.name,
    rootDir: persistedProject.rootDir,
    ownerUserId: persistedProject.ownerUserId,
    status: 'idle',
  });
}

function isPlatformAuthEnabled(auth: PlatformAuthService): boolean {
  return typeof auth.isEnabled === 'function' ? auth.isEnabled() : true;
}

function decorateConversation(
  conversation: Record<string, unknown> | null | undefined,
  viewerId: string | null,
  projects: ProjectService,
) {
  if (!conversation) return conversation;

  const sandboxProjectId = typeof conversation.sandboxProjectId === 'string'
    ? conversation.sandboxProjectId
    : null;

  if (!sandboxProjectId) {
    return {
      ...conversation,
      projectId: null,
      projectName: null,
    };
  }

  const project = getProjectBySandboxId(projects, sandboxProjectId);
  if (!project || !canReadProject(projects, project.id, viewerId)) {
    return {
      ...conversation,
      projectId: null,
      projectName: null,
    };
  }

  return {
    ...conversation,
    projectId: project.id,
    projectName: project.name,
  };
}

export function registerConversationRoutes(
  app: FastifyInstance,
  chatService: ChatService,
  defaultModelId: string,
  auth: PlatformAuthService,
  sandbox: SandboxManager,
  projects: ProjectService,
) {
  /** List conversations — scoped to the current user */
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/api/conversations',
    async (request) => {
      const limit = Math.min(Number(request.query.limit) || 50, 200);
      const offset = Number(request.query.offset) || 0;
      const viewer = await auth.getViewer(request);
      if (isPlatformAuthEnabled(auth) && !viewer.authenticated) {
        return [];
      }
      const userId = viewer.user?.id ?? null;
      const conversations = chatService.listConversations(limit, offset, userId);
      return conversations.map((conversation) => decorateConversation(conversation, userId, projects));
    },
  );

  /** Create a new conversation — auto-creates sandbox for builder mode */
  app.post<{ Body: { modelId?: string; title?: string; mode?: string; sandboxProjectId?: string | null } }>(
    '/api/conversations',
    async (request, reply) => {
      const parsed = createConversationBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const { modelId, title, mode, sandboxProjectId: requestedSandboxProjectId, workspaceRoot } = parsed.data;
      const resolvedMode: ConversationMode = mode ?? DEFAULT_CONVERSATION_MODE;

      const viewer = await auth.getViewer(request);
      if (isPlatformAuthEnabled(auth) && !viewer.authenticated) {
        reply.code(401);
        return { error: 'Sign in to create a conversation' };
      }
      const ownerUserId = viewer.user?.id ?? null;

      let sandboxProjectId: string | null = null;
      if (requestedSandboxProjectId) {
        const existingSandbox = getSandboxProject(projects, sandbox, requestedSandboxProjectId);
        if (!existingSandbox) {
          reply.code(404);
          return { error: 'Sandbox project not found' };
        }

        syncSandboxProject(projects, existingSandbox);
        if (!canReadSandbox(projects, requestedSandboxProjectId, ownerUserId)) {
          reply.code(viewer.authenticated ? 403 : 401);
          return { error: viewer.authenticated ? 'You do not have access to this sandbox project' : 'Sign in to attach this sandbox project' };
        }

        sandboxProjectId = requestedSandboxProjectId;
      }

      const id = chatService.createConversation(
        modelId ?? defaultModelId,
        title,
        resolvedMode,
        ownerUserId,
      );

      if (sandboxProjectId) {
        chatService.updateConversationSandbox(id, sandboxProjectId);
      } else if (resolvedMode === 'builder' && !workspaceRoot) {
        // Auto-create a sandbox project for builder conversations — unless the
        // chat is bound to a LOCAL folder, which IS its workspace.
        const projectName = uniqueSandboxName(title, id);
        const project = await sandbox.create(projectName, ownerUserId);
        syncSandboxProject(projects, project);
        chatService.updateConversationSandbox(id, project.id);
        sandboxProjectId = project.id;
      }

      if (workspaceRoot) {
        chatService.updateConversationWorkspaceRoot(id, workspaceRoot);
      }

      return { id, sandboxProjectId };
    },
  );

  /** Update conversation mode/sandbox */
  app.patch<{ Params: { id: string }; Body: { title?: string; mode?: string; sandboxProjectId?: string | null; visibility?: string } }>(
    '/api/conversations/:id',
    async (request, reply) => {
      const parsed = patchConversationBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const { title, mode, sandboxProjectId, visibility, workspaceRoot } = parsed.data;

      let conversation = chatService.getConversation(request.params.id);
      if (!conversation) {
        reply.code(404);
        return { error: 'Conversation not found' };
      }

      // Verify ownership for writes
      const viewer = await auth.getViewer(request);
      const userId = viewer.user?.id ?? null;

      // Claim legacy convos for the signed-in user (same as chat WS path)
      if (isPlatformAuthEnabled(auth) && viewer.authenticated && userId && conversation && !conversation.ownerUserId) {
        chatService.assignOwnerIfLegacy(request.params.id, userId);
        conversation = chatService.getConversation(request.params.id)!;
      }

      const access = authorizeConversationAccess({
        conversation,
        viewer,
        projects,
        access: 'write',
        authEnabled: isPlatformAuthEnabled(auth),
      });
      if (!access.allowed) {
        reply.code(access.statusCode ?? 403);
        return { error: access.error ?? 'Not your conversation' };
      }

      if (title !== undefined) {
        conversation = chatService.updateConversationTitle(request.params.id, title);
      }

      if (mode !== undefined) {
        conversation = chatService.updateConversationMode(request.params.id, mode);

        // If switching to builder and no workspace of ANY kind exists, create a sandbox.
        if (mode === 'builder' && !conversation?.sandboxProjectId && !conversation?.workspaceRoot && workspaceRoot === undefined) {
          const project = await sandbox.create(uniqueSandboxName(conversation?.title, request.params.id), userId);
          syncSandboxProject(projects, project);
          chatService.updateConversationSandbox(request.params.id, project.id);
          conversation = chatService.getConversation(request.params.id);
        }
      }

      if (workspaceRoot !== undefined) {
        conversation = chatService.updateConversationWorkspaceRoot(request.params.id, workspaceRoot);
      }

      if (sandboxProjectId !== undefined) {
        if (sandboxProjectId) {
          const existingSandbox = getSandboxProject(projects, sandbox, sandboxProjectId);
          if (!existingSandbox) {
            reply.code(404);
            return { error: 'Sandbox project not found' };
          }

          syncSandboxProject(projects, existingSandbox);
          if (!canReadSandbox(projects, sandboxProjectId, userId)) {
            reply.code(viewer.authenticated ? 403 : 401);
            return { error: viewer.authenticated ? 'You do not have access to this sandbox project' : 'Sign in to attach this sandbox project' };
          }
        }

        conversation = chatService.updateConversationSandbox(request.params.id, sandboxProjectId);
        if (sandboxProjectId && conversation?.mode === 'chat') {
          conversation = chatService.updateConversationMode(request.params.id, 'builder');
        }
      }

      if (visibility !== undefined) {
        const validVisibility = ['private', 'unlisted', 'public'] as const;
        if (!validVisibility.includes(visibility as typeof validVisibility[number])) {
          reply.code(400);
          return { error: 'Invalid visibility. Must be: private, unlisted, or public' };
        }
        conversation = chatService.updateConversationVisibility(
          request.params.id,
          visibility as 'private' | 'unlisted' | 'public',
        );
      }

      if (!conversation) {
        reply.code(404);
        return { error: 'Conversation not found' };
      }

      return decorateConversation(conversation, userId, projects);
    },
  );

  /** Get inspectable Council work artifacts without returning generated source bodies. */
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/conversations/:id/work-artifacts',
    async (request, reply) => {
      const conversation = chatService.getConversation(request.params.id);
      const viewer = await auth.getViewer(request);
      const access = authorizeConversationAccess({
        conversation,
        viewer,
        projects,
        access: 'read',
        authEnabled: isPlatformAuthEnabled(auth),
      });
      if (!access.allowed) {
        reply.code(access.statusCode ?? 403);
        return { error: access.error ?? 'You do not have access to this conversation' };
      }
      const limit = Math.max(1, Math.min(Number(request.query.limit) || 5, 20));
      return { artifacts: chatService.listCouncilWorkArtifacts(request.params.id, limit) };
    },
  );

  /** Get messages for a conversation */
  app.get<{ Params: { id: string } }>(
    '/api/conversations/:id/messages',
    async (request, reply) => {
      const conversation = chatService.getConversation(request.params.id);
      const viewer = await auth.getViewer(request);
      const access = authorizeConversationAccess({
        conversation,
        viewer,
        projects,
        access: 'read',
        authEnabled: isPlatformAuthEnabled(auth),
      });
      if (!access.allowed) {
        reply.code(access.statusCode ?? 403);
        return { error: access.error ?? 'You do not have access to this conversation' };
      }
      return chatService.getMessages(request.params.id);
    },
  );

  /**
   * Machine-readable process trace for a turn — the same stages, durations,
   * tools, and council verdicts the desktop Timeline renders, exposed so an
   * agent in a WebSocket chat (or any API client) can investigate and VERIFY
   * what the UI claims happened. `messageId` targets one turn; default = the
   * latest assistant turn that carries a trace.
   */
  app.get<{ Params: { id: string }; Querystring: { messageId?: string } }>(
    '/api/conversations/:id/process-trace',
    async (request, reply) => {
      const conversation = chatService.getConversation(request.params.id);
      const viewer = await auth.getViewer(request);
      const access = authorizeConversationAccess({
        conversation,
        viewer,
        projects,
        access: 'read',
        authEnabled: isPlatformAuthEnabled(auth),
      });
      if (!access.allowed) {
        reply.code(access.statusCode ?? 403);
        return { error: access.error ?? 'You do not have access to this conversation' };
      }

      interface TraceStep {
        stage: string; label: string; status: string; durationMs?: number; detail?: string;
        toolRuns?: Array<{ name: string; status: string; success?: boolean; durationMs?: number }>;
        councilMembers?: Array<{ name: string; verdict: string; confidence: number; note?: string }>;
      }
      const rows = chatService.getMessages(request.params.id) as Array<{ id: string; role: string; progressSteps?: TraceStep[] }>;
      const target = [...rows].reverse().find((m) => m.role === 'assistant'
        && (!request.query.messageId || m.id === request.query.messageId)
        && Array.isArray(m.progressSteps) && m.progressSteps.length > 0);
      if (!target) {
        reply.code(404);
        return { error: 'No process trace found (turn may predate trace persistence or is still streaming)' };
      }

      const steps = target.progressSteps ?? [];
      const totalDurationMs = steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
      const fmt = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? ` ${Math.round(ms)}ms` : ` ${(ms / 1000).toFixed(1)}s`);
      // Compact agent-quotable rendering — one line per stage, indented detail.
      const text = steps.map((s) => {
        const lines = [`[${s.status}] ${s.stage}: ${s.label}${fmt(s.durationMs)}`];
        for (const t of s.toolRuns ?? []) lines.push(`  tool ${t.name} → ${t.success === false ? 'failed' : t.status}${fmt(t.durationMs)}`);
        for (const m of s.councilMembers ?? []) lines.push(`  council ${m.name}: ${m.verdict} (${Math.round((m.confidence ?? 0) * 100)}%)`);
        return lines.join('\n');
      }).join('\n');

      return {
        conversationId: request.params.id,
        messageId: target.id,
        stepCount: steps.length,
        totalDurationMs,
        steps,
        text,
      };
    },
  );

  /** Persist an assistant-authored project update note in the conversation thread */
  app.post<{ Params: { id: string }; Body: { content?: string } }>(
    '/api/conversations/:id/assistant-note',
    async (request, reply) => {
      const parsed = assistantNoteBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }

      const conversation = chatService.getConversation(request.params.id);
      if (!conversation) {
        reply.code(404);
        return { error: 'Conversation not found' };
      }

      const viewer = await auth.getViewer(request);
      const access = authorizeConversationAccess({
        conversation,
        viewer,
        projects,
        access: 'write',
        authEnabled: isPlatformAuthEnabled(auth),
      });
      if (!access.allowed) {
        reply.code(access.statusCode ?? 403);
        return { error: access.error ?? 'Not your conversation' };
      }

      const content = parsed.data.content.trim();

      return chatService.appendAssistantMessage(request.params.id, content);
    },
  );

  /** HTTP chat endpoint — send a message and get the full response (non-streaming) */
  app.post<{
    Params: { id: string };
    Body: { content: string; skipPromptRewrite?: boolean } & ChatPromptRewriteOverrides;
  }>(
    '/api/conversations/:id/messages',
    async (request, reply) => {
      const parsed = postConversationMessageBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const { id } = request.params;
      const { content, profile, responseDepth, skipPromptRewrite } = parsed.data;
      const conversation = chatService.getConversation(id);
      const viewer = await auth.getViewer(request);
      const access = authorizeConversationAccess({
        conversation,
        viewer,
        projects,
        access: 'write',
        authEnabled: isPlatformAuthEnabled(auth),
      });
      if (!access.allowed) {
        reply.code(access.statusCode ?? 403);
        return { error: access.error ?? 'Not your conversation' };
      }
      const promptRewriteOverrides =
        profile !== undefined || responseDepth !== undefined || skipPromptRewrite === true
          ? {
              ...(profile !== undefined ? { profile } : {}),
              ...(responseDepth !== undefined ? { responseDepth } : {}),
              ...(skipPromptRewrite === true ? { enabled: false } : {}),
            }
          : undefined;

      let fullText = '';
      let usage = { promptTokens: 0, completionTokens: 0 };

      for await (const chunk of chatService.sendMessage(id, content, undefined, undefined, undefined, promptRewriteOverrides)) {
        if (chunk.type === 'text_delta' && chunk.textDelta) {
          fullText += chunk.textDelta;
        }
        if (chunk.type === 'done' && chunk.usage) {
          usage = chunk.usage;
        }
      }

      return {
        role: 'assistant',
        content: fullText,
        usage,
      };
    },
  );

  /** Delete a conversation (and its sandbox if any) */
  app.delete<{ Params: { id: string } }>(
    '/api/conversations/:id',
    async (request, reply) => {
      const conversation = chatService.getConversation(request.params.id);
      if (!conversation) {
        reply.code(404);
        return { error: 'Conversation not found' };
      }

      // Verify ownership
      const viewer = await auth.getViewer(request);
      const access = authorizeConversationAccess({
        conversation,
        viewer,
        projects,
        access: 'write',
        authEnabled: isPlatformAuthEnabled(auth),
      });
      if (!access.allowed) {
        reply.code(access.statusCode ?? 403);
        return { error: access.error ?? 'Not your conversation' };
      }

      // Clean up linked sandbox
      if (conversation.sandboxProjectId) {
        try {
          await sandbox.destroy(conversation.sandboxProjectId);
          projects.removeProjectForSandbox(conversation.sandboxProjectId);
        } catch { /* sandbox may already be gone */ }
      }

      chatService.deleteConversation(request.params.id);
      return { ok: true };
    },
  );

  /* ── Sharing ─────────────────────────────────────────────── */

  /** Get a shared conversation by its slug (public access) */
  app.get<{ Params: { slug: string } }>(
    '/api/shared/:slug',
    async (request, reply) => {
      const conversation = chatService.getConversationByShareSlug(request.params.slug);
      if (!conversation) {
        reply.code(404);
        return { error: 'Shared conversation not found' };
      }

      if (conversation.visibility === 'private') {
        reply.code(403);
        return { error: 'This conversation is private' };
      }

      const messages = chatService.getMessages(conversation.id);

      return {
        conversation: {
          id: conversation.id,
          title: conversation.title,
          mode: conversation.mode,
          visibility: conversation.visibility,
          shareSlug: conversation.shareSlug,
          sandboxProjectId: conversation.sandboxProjectId,
          createdAt: conversation.createdAt,
        },
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        })),
      };
    },
  );
}
