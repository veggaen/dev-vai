import type { FastifyInstance } from 'fastify';
import type { ChatService } from '@vai/core';

export function registerChatRoutes(app: FastifyInstance, chatService: ChatService) {
  app.register(async (fastify) => {
    fastify.get('/api/chat', { websocket: true }, (socket, _request) => {
      socket.on('message', async (raw: Buffer) => {
        try {
          const data = JSON.parse(raw.toString()) as {
            conversationId: string;
            content: string;
          };

          for await (const chunk of chatService.sendMessage(
            data.conversationId,
            data.content,
          )) {
            socket.send(JSON.stringify(chunk));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          socket.send(JSON.stringify({ type: 'error', error: message }));
        }
      });
    });
  });
}
