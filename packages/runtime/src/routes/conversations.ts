import type { FastifyInstance } from 'fastify';
import type { ChatService } from '@vai/core';

export function registerConversationRoutes(app: FastifyInstance, chatService: ChatService) {
  app.get('/api/conversations', async () => {
    return chatService.listConversations();
  });

  app.post<{ Body: { modelId: string; title?: string } }>(
    '/api/conversations',
    async (request) => {
      const { modelId, title } = request.body;
      const id = chatService.createConversation(modelId, title);
      return { id };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/conversations/:id/messages',
    async (request) => {
      return chatService.getMessages(request.params.id);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/conversations/:id',
    async (request) => {
      chatService.deleteConversation(request.params.id);
      return { ok: true };
    },
  );
}
