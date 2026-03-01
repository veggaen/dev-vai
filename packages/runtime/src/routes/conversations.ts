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

  // HTTP chat endpoint — send a message and get the full response (non-streaming).
  // Used by VCUS test runner, scripts, and any client that doesn't want WebSocket.
  app.post<{ Params: { id: string }; Body: { content: string } }>(
    '/api/conversations/:id/messages',
    async (request) => {
      const { id } = request.params;
      const { content } = request.body;

      let fullText = '';
      let usage = { promptTokens: 0, completionTokens: 0 };

      for await (const chunk of chatService.sendMessage(id, content)) {
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

  app.delete<{ Params: { id: string } }>(
    '/api/conversations/:id',
    async (request) => {
      chatService.deleteConversation(request.params.id);
      return { ok: true };
    },
  );
}
