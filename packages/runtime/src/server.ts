import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { createDb, ModelRegistry, ChatService, VaiEngine, IngestPipeline } from '@vai/core';
import { registerChatRoutes } from './routes/chat.js';
import { registerConversationRoutes } from './routes/conversations.js';
import { registerModelRoutes } from './routes/models.js';
import { registerIngestRoutes } from './routes/ingest.js';

export interface ServerOptions {
  port?: number;
  dbPath?: string;
}

export async function createServer(options?: ServerOptions) {
  const port = options?.port ?? (process.env.VAI_PORT ? Number(process.env.VAI_PORT) : 3006);
  const dbPath = options?.dbPath ?? process.env.VAI_DB_PATH ?? './vai.db';

  const db = createDb(dbPath);
  const models = new ModelRegistry();

  // VAI's own engine — no external APIs, no dependencies on other AI
  const vaiEngine = new VaiEngine();
  models.register(vaiEngine);

  // Ingestion pipeline — how VAI learns from the world
  const pipeline = new IngestPipeline(db, vaiEngine);

  console.log('[VAI] VeggaAI engine initialized');
  const stats = vaiEngine.getStats();
  console.log(`[VAI] Vocab: ${stats.vocabSize} | Knowledge: ${stats.knowledgeEntries} entries | Docs: ${stats.documentsIndexed} | N-grams: ${stats.ngramContexts}`);

  const chatService = new ChatService(db, models);

  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get('/health', async () => ({
    status: 'ok',
    engine: 'vai:v0',
    stats: vaiEngine.getStats(),
  }));

  // Training endpoint — feed raw text to VAI
  app.post<{ Body: { text: string; source: string; language?: string } }>(
    '/api/train',
    async (request) => {
      const { text, source, language } = request.body;
      vaiEngine.train(text, source, (language as 'en' | 'no' | 'code' | 'mixed') ?? 'en');
      return { ok: true, stats: vaiEngine.getStats() };
    },
  );

  registerConversationRoutes(app, chatService);
  registerModelRoutes(app, models);
  registerChatRoutes(app, chatService);
  registerIngestRoutes(app, pipeline);

  return { app, port, db, models, chatService, vaiEngine, pipeline };
}
