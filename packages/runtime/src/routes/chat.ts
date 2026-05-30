import type { FastifyInstance } from 'fastify';
import { DEFAULT_CONVERSATION_MODE, type ChatService, type ChatPromptRewriteOverrides } from '@vai/core';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import type { ProjectService } from '../projects/service.js';
import { authorizeConversationAccess } from '../access/conversations.js';
import { chatWebSocketInboundSchema } from '@vai/api-types/chat-ws';

export interface RegisterChatRoutesOptions {
  /** Email that may use owner-only features (e.g. allowLearn). Set via VAI_OWNER_EMAIL. */
  ownerEmail: string;
}

const SOCKET_OPEN = 1;
const MAX_SOCKET_BUFFERED_BYTES = 1_000_000;

async function sendJson(socket: { readyState: number; bufferedAmount: number; send: (data: string) => void }, payload: unknown): Promise<boolean> {
  if (socket.readyState !== SOCKET_OPEN) {
    return false;
  }

  while (socket.bufferedAmount > MAX_SOCKET_BUFFERED_BYTES) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (socket.readyState !== SOCKET_OPEN) {
      return false;
    }
  }

  socket.send(JSON.stringify(payload));
  return true;
}

export function registerChatRoutes(
  app: FastifyInstance,
  chatService: ChatService,
  auth: PlatformAuthService,
  projects: ProjectService,
  options: RegisterChatRoutesOptions,
) {
  const ownerNorm = options.ownerEmail.trim().toLowerCase();
  const activeConversationTurns = new Set<string>();

  function isOwnerEmail(email: string | null | undefined): boolean {
    return email?.trim().toLowerCase() === ownerNorm;
  }

  app.register(async (fastify) => {
    fastify.get('/api/chat', { websocket: true }, (socket, request) => {
      socket.on('message', async (raw: Buffer) => {
        try {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            await sendJson(socket, { type: 'error', error: 'Invalid JSON', code: 'validation' });
            return;
          }

          const validated = chatWebSocketInboundSchema.safeParse(parsed);
          if (!validated.success) {
            await sendJson(
              socket,
              {
                type: 'error',
                error: 'Invalid message format',
                code: 'validation',
              },
            );
            return;
          }

          const data = validated.data;
          const promptRewriteOverrides: ChatPromptRewriteOverrides | undefined =
            data.profile || data.responseDepth !== undefined || data.enabled !== undefined
              ? {
                  profile: data.profile,
                  responseDepth: data.responseDepth,
                  enabled: data.enabled,
                }
              : undefined;

          const image = data.image;
          const viewer = await auth.getViewer(request);

          let noLearn = true;
          if (!auth.isEnabled()) {
            noLearn = data.allowLearn !== true;
          } else {
            const ownerMayTeach = Boolean(viewer.authenticated && isOwnerEmail(viewer.user?.email) && data.allowLearn === true);
            noLearn = !ownerMayTeach;
          }

          let conversationId = data.conversationId;
          let conversation = chatService.getConversation(conversationId);
          if (!conversation) {
            if (auth.isEnabled() && !viewer.authenticated) {
              await sendJson(socket, { type: 'error', error: 'Sign in to create a conversation', code: 'unauthorized' });
              return;
            }

            const fallbackModel = data.modelId ?? 'vai:v0';
            const fallbackMode = data.mode ?? DEFAULT_CONVERSATION_MODE;
            conversationId = chatService.createConversation(
              fallbackModel,
              undefined,
              fallbackMode,
              viewer.user?.id ?? null,
            );
            conversation = chatService.getConversation(conversationId);
            fastify.log.warn(
              { requested: data.conversationId, resolved: conversationId },
              'chat: route-created conversation for missing id',
            );
            await sendJson(socket, { type: 'conversation_resolved', conversationId });
          }

          const access = authorizeConversationAccess({
            conversation,
            viewer,
            projects,
            access: 'write',
            authEnabled: auth.isEnabled(),
          });
          if (!access.allowed) {
            await sendJson(socket, {
              type: 'error',
              error: access.error ?? 'Not your conversation',
              code: access.statusCode === 401 ? 'unauthorized' : 'forbidden',
            });
            return;
          }

          if (activeConversationTurns.has(conversationId)) {
            await sendJson(socket, {
              type: 'error',
              error: 'A response is already in progress for this conversation',
              code: 'conflict',
            });
            return;
          }

          activeConversationTurns.add(conversationId);
          try {
            for await (const chunk of chatService.sendMessage(
              conversationId,
              data.content,
              image,
              data.systemPrompt,
              noLearn,
              promptRewriteOverrides,
            )) {
              if (chunk.type === 'conversation_resolved' && chunk.conversationId) {
                fastify.log.warn(
                  { requested: data.conversationId, resolved: chunk.conversationId },
                  'chat: auto-created conversation for missing id',
                );
              }
              const sent = await sendJson(socket, chunk);
              if (!sent) break;
            }
          } finally {
            activeConversationTurns.delete(conversationId);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          await sendJson(socket, { type: 'error', error: message, code: 'unknown' });
        }
      });
    });
  });
}
