import type { FastifyInstance } from 'fastify';
import type { ChatService, ChatPromptRewriteOverrides } from '@vai/core';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import { chatWebSocketInboundSchema } from '@vai/api-types/chat-ws';

export interface RegisterChatRoutesOptions {
  /** Email that may use owner-only features (e.g. allowLearn). Set via VAI_OWNER_EMAIL. */
  ownerEmail: string;
}

export function registerChatRoutes(
  app: FastifyInstance,
  chatService: ChatService,
  auth: PlatformAuthService,
  options: RegisterChatRoutesOptions,
) {
  const ownerNorm = options.ownerEmail.trim().toLowerCase();

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
            socket.send(JSON.stringify({ type: 'error', error: 'Invalid JSON', code: 'validation' }));
            return;
          }

          const validated = chatWebSocketInboundSchema.safeParse(parsed);
          if (!validated.success) {
            socket.send(
              JSON.stringify({
                type: 'error',
                error: 'Invalid message format',
                code: 'validation',
              }),
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

          let noLearn = true;
          if (!auth.isEnabled()) {
            noLearn = data.allowLearn !== true;
          } else {
            const viewer = await auth.getViewer(request);
            const ownerMayTeach = Boolean(viewer.authenticated && isOwnerEmail(viewer.user?.email) && data.allowLearn === true);
            noLearn = !ownerMayTeach;
          }

          for await (const chunk of chatService.sendMessage(
            data.conversationId,
            data.content,
            image,
            data.systemPrompt,
            noLearn,
            promptRewriteOverrides,
          )) {
            socket.send(JSON.stringify(chunk));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          socket.send(JSON.stringify({ type: 'error', error: message, code: 'unknown' }));
        }
      });
    });
  });
}
