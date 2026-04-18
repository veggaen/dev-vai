import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_CONVERSATION_MODE, type ChatPromptRewriteOverrides, type ChatService, type ConversationMode } from '@vai/core';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import type { SandboxManager } from '../sandbox/manager.js';
import type { ProjectService } from '../projects/service.js';
import {
  assistantNoteBodySchema,
  createConversationBodySchema,
  patchConversationBodySchema,
  postConversationMessageBodySchema,
} from '@vai/api-types/conversations';
import { invalidRequestBody } from '../validation/http-validation.js';

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

function canMutateConversation(
  conversation: { ownerUserId?: string | null },
  viewer: Awaited<ReturnType<PlatformAuthService['getViewer']>>,
) {
  if (!conversation.ownerUserId) {
    return true;
  }

  return Boolean(viewer.authenticated && viewer.user && conversation.ownerUserId === viewer.user.id);
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
      const { modelId, title, mode, sandboxProjectId: requestedSandboxProjectId } = parsed.data;
      const resolvedMode: ConversationMode = mode ?? DEFAULT_CONVERSATION_MODE;

      const viewer = await auth.getViewer(request);
      const ownerUserId = viewer.user?.id ?? null;

      let sandboxProjectId: string | null = null;
      if (requestedSandboxProjectId) {
        const existingSandbox = getSandboxProject(projects, sandbox, requestedSandboxProjectId);
        if (!existingSandbox) {
          reply.code(404);
          return { error: 'Sandbox project not found' };
        }

        if (!canReadSandbox(projects, requestedSandboxProjectId, ownerUserId)) {
          reply.code(viewer.authenticated ? 403 : 401);
          return { error: viewer.authenticated ? 'You do not have access to this sandbox project' : 'Sign in to attach this sandbox project' };
        }

        syncSandboxProject(projects, existingSandbox);
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
      } else if (resolvedMode === 'builder') {
        // Auto-create a sandbox project for builder conversations
        const projectName = title || 'builder-app';
        const project = await sandbox.create(projectName, ownerUserId);
        syncSandboxProject(projects, project);
        chatService.updateConversationSandbox(id, project.id);
        sandboxProjectId = project.id;
      }

      return { id, sandboxProjectId };
    },
  );

  /** Update conversation mode/sandbox */
  app.patch<{ Params: { id: string }; Body: { mode?: string; sandboxProjectId?: string | null; visibility?: string } }>(
    '/api/conversations/:id',
    async (request, reply) => {
      const parsed = patchConversationBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const { mode, sandboxProjectId, visibility } = parsed.data;

      let conversation = chatService.getConversation(request.params.id);
      if (!conversation) {
        reply.code(404);
        return { error: 'Conversation not found' };
      }

      // Verify ownership for writes
      const viewer = await auth.getViewer(request);
      const userId = viewer.user?.id ?? null;
      if (!canMutateConversation(conversation, viewer)) {
        reply.code(viewer.authenticated ? 403 : 401);
        return { error: viewer.authenticated ? 'Not your conversation' : 'Sign in to update this conversation' };
      }

      if (mode !== undefined) {
        conversation = chatService.updateConversationMode(request.params.id, mode);

        // If switching to builder and no sandbox exists, create one
        if (mode === 'builder' && !conversation?.sandboxProjectId) {
          const project = await sandbox.create(conversation?.title || 'builder-app', userId);
          syncSandboxProject(projects, project);
          chatService.updateConversationSandbox(request.params.id, project.id);
          conversation = chatService.getConversation(request.params.id);
        }
      }

      if (sandboxProjectId !== undefined) {
        if (sandboxProjectId) {
          const existingSandbox = getSandboxProject(projects, sandbox, sandboxProjectId);
          if (!existingSandbox) {
            reply.code(404);
            return { error: 'Sandbox project not found' };
          }

          if (!canReadSandbox(projects, sandboxProjectId, userId)) {
            reply.code(viewer.authenticated ? 403 : 401);
            return { error: viewer.authenticated ? 'You do not have access to this sandbox project' : 'Sign in to attach this sandbox project' };
          }

          syncSandboxProject(projects, existingSandbox);
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

  /** Get messages for a conversation */
  app.get<{ Params: { id: string } }>(
    '/api/conversations/:id/messages',
    async (request) => {
      return chatService.getMessages(request.params.id);
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
      if (!canMutateConversation(conversation, viewer)) {
        reply.code(viewer.authenticated ? 403 : 401);
        return { error: viewer.authenticated ? 'Not your conversation' : 'Sign in to update this conversation' };
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
      if (!canMutateConversation(conversation, viewer)) {
        reply.code(viewer.authenticated ? 403 : 401);
        return { error: viewer.authenticated ? 'Not your conversation' : 'Sign in to delete this conversation' };
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
