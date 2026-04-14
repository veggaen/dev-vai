import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import path from 'node:path';
import {
  createDb,
  ModelRegistry,
  ChatService,
  VaiEngine,
  IngestPipeline,
  schema,
  SessionService,
  loadConfig,
  printConfigDiagnostic,
  ToolRegistry,
  ToolExecutor,
  UsageService,
  ThorsenAdaptiveController,
  EvalRunner,
  SearchPipeline,
} from '@vai/core';
import { registerChatRoutes } from './routes/chat.js';
import { registerConversationRoutes } from './routes/conversations.js';
import { registerModelRoutes } from './routes/models.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerImageRoutes } from './routes/images.js';
import { registerSandboxRoutes } from './routes/sandbox.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerDockerRoutes } from './routes/docker.js';
import { registerVaiGymRoutes } from './routes/vai-gym.js';
import { registerThorsenRoutes } from './routes/thorsen.js';
import { registerEvalRoutes } from './routes/eval.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerBroadcastRoutes } from './routes/broadcast.js';
import { seedVaiEvalTasks } from './eval/vai-tasks.js';
import { SandboxManager } from './sandbox/manager.js';
import { warmPnpmStore } from './sandbox/store-warmer.js';
import { registerAuthHook } from './middleware/auth.js';
import { registerConfiguredModels } from './models/register-configured-models.js';
import { PlatformAuthService } from './auth/platform-auth.js';
import { registerPlatformAuthRoutes } from './routes/platform-auth.js';
import { ProjectService } from './projects/service.js';
import { registerProjectRoutes } from './routes/projects.js';

export interface ServerOptions {
  port?: number;
  dbPath?: string;
}

export async function createServer(options?: ServerOptions) {
  const config = loadConfig();
  printConfigDiagnostic(config);

  const port = options?.port ?? config.port;
  const dbPath = options?.dbPath ?? config.dbPath;

  const db = createDb(dbPath);
  const models = new ModelRegistry();
  const tools = new ToolRegistry();

  const vaiEngine = new VaiEngine({
    persistPath: path.resolve(dbPath, '..', 'vai-knowledge.json'),
  });
  models.register(vaiEngine);

  const externalModels = registerConfiguredModels(config, models);
  if (externalModels.length > 0) {
    console.log(`[VAI] External adapters registered: ${externalModels.join(', ')}`);
  }

  const registeredModels = models.list().map((model) => model.id);
  console.log(`[VAI] Registered models: ${registeredModels.join(', ')}`);
  console.log(`[VAI] Default model: ${config.defaultModelId}`);

  const usageService = new UsageService(db);
  const adaptiveController = new ThorsenAdaptiveController();

  const toolExecutor = new ToolExecutor(
    tools,
    {
      maxIterations: config.maxToolIterations,
    },
    adaptiveController,
  );

  const pipeline = new IngestPipeline(db, vaiEngine);

  const hydrated = pipeline.hydrate();
  console.log(
    `[VAI] Hydrated: ${hydrated.sourcesLoaded} sources, ${hydrated.chunksLoaded} chunks, ${hydrated.imagesLoaded} images loaded into engine`,
  );

  try {
    const rows = db.select().from(schema.taughtEntries).all();
    let taughtCount = 0;
    for (const row of rows) {
      vaiEngine.knowledge.addEntry(
        row.pattern,
        row.response,
        row.source,
        row.language as 'en' | 'no' | 'code' | 'mixed',
      );
      taughtCount += 1;
    }
    if (taughtCount > 0) {
      console.log(`[VAI] Loaded ${taughtCount} taught entries from database`);
    }
  } catch {
    // Table may not exist yet.
  }

  console.log('[VAI] VeggaAI engine initialized');
  const stats = vaiEngine.getStats();
  console.log(
    `[VAI] Vocab: ${stats.vocabSize} | Knowledge: ${stats.knowledgeEntries} entries | Docs: ${stats.documentsIndexed} | Concepts: ${stats.conceptsExtracted} | N-grams: ${stats.ngramContexts}`,
  );

  const chatService = new ChatService(db, models, adaptiveController, {
    promptRewrite: config.chatPromptRewrite,
    retrieveKnowledge: (query: string, limit?: number) => vaiEngine.retrieveRelevant(query, limit),
  });
  const sandboxManager = new SandboxManager();
  const platformAuth = new PlatformAuthService(db, config.platformAuth);
  const projectService = new ProjectService(db);
  projectService.hydrateSandboxs(sandboxManager);

  warmPnpmStore();

  const app = Fastify({ logger: false, bodyLimit: 15 * 1024 * 1024 });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(websocket);

  const authConfig = {
    enabled: config.authEnabled,
    keys: config.apiKeys,
    rateLimitPerMinute: config.rateLimitPerMinute,
  };
  registerAuthHook(app, authConfig);

  app.get('/', async () => ({
    name: 'VeggaAI',
    version: '0.1.0',
    engine: 'vai:v0',
    docs: {
      health: '/health',
      train: 'POST /api/train',
      chat: '/api/chat',
      capture: 'POST /api/capture',
      diagnose: 'GET /api/vai/diagnose',
    },
  }));

  app.get('/health', async () => ({
    status: 'ok',
    engine: 'vai:v0',
    stats: vaiEngine.getStats(),
    adaptive: adaptiveController.snapshot(),
  }));

  app.get('/api/vai/diagnose', async () => vaiEngine.diagnose());

  app.post<{ Body: { text: string; source: string; language?: string } }>(
    '/api/train',
    async (request) => {
      const { text, source, language } = request.body;
      vaiEngine.train(text, source, (language as 'en' | 'no' | 'code' | 'mixed') ?? 'en');
      return { ok: true, stats: vaiEngine.getStats() };
    },
  );

  app.post<{ Body: { entries: Array<{ pattern: string; response: string; source?: string }> } }>(
    '/api/teach',
    async (request) => {
      const { entries } = request.body;
      let added = 0;

      for (const entry of entries) {
        const source = entry.source ?? 'vcus-teaching';
        const pattern = entry.pattern.toLowerCase();
        vaiEngine.knowledge.addEntry(pattern, entry.response, source, 'en');

        try {
          const id = `teach-${Buffer.from(pattern + source).toString('base64url').slice(0, 40)}`;
          db.insert(schema.taughtEntries)
            .values({
              id,
              pattern,
              response: entry.response,
              source,
              language: 'en',
              createdAt: new Date(),
            })
            .onConflictDoUpdate({
              target: schema.taughtEntries.id,
              set: { response: entry.response, pattern },
            })
            .run();
        } catch {
          // In-memory teach still works if persistence fails.
        }

        added += 1;
      }

      return { ok: true, added, stats: vaiEngine.getStats() };
    },
  );

  app.delete('/api/teach', async () => {
    try {
      db.delete(schema.taughtEntries).run();
      vaiEngine.knowledge.clearTaughtEntries();
    } catch {
      // Best-effort cleanup.
    }
    return { ok: true, cleared: true };
  });

  registerPlatformAuthRoutes(app, platformAuth);
  registerConversationRoutes(app, chatService, config.defaultModelId, platformAuth, sandboxManager, projectService);
  registerModelRoutes(app, models);
  registerPlatformRoutes(app, config, models, sandboxManager, platformAuth);
  registerChatRoutes(app, chatService, platformAuth, { ownerEmail: config.ownerEmail });
  registerIngestRoutes(app, pipeline);
  registerImageRoutes(app, pipeline, chatService);
  registerSandboxRoutes(app, sandboxManager, platformAuth, projectService);
  registerProjectRoutes(app, platformAuth, projectService, sandboxManager);
  registerBroadcastRoutes(app, platformAuth, projectService);
  registerDockerRoutes(app);
  registerVaiGymRoutes(app);
  registerThorsenRoutes(app);

  seedVaiEvalTasks();
  const evalRunner = new EvalRunner(db, models);
  registerEvalRoutes(app, evalRunner);

  const searchPipeline = new SearchPipeline({
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY || undefined,
    searxngUrl: process.env.VAI_SEARXNG_URL || undefined,
  });
  registerSearchRoutes(app, searchPipeline);

  registerSkillRoutes(app);
  registerFeedbackRoutes(app, db);

  app.get('/api/usage', async (request) => {
    const query = request.query as { from?: string; to?: string };
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    return usageService.getSummary(from, to);
  });

  app.get('/api/usage/budget', async () => usageService.checkBudget(config.maxMonthlySpend));

  app.get('/api/config', async () => ({
    defaultModelId: config.defaultModelId,
    fallbackChain: config.fallbackChain,
    enableToolCalling: config.enableToolCalling,
    maxToolIterations: config.maxToolIterations,
    enableUsageTracking: config.enableUsageTracking,
    enableEval: config.enableEval,
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([id, provider]) => [
        id,
        { id: provider.id, enabled: provider.enabled, defaultModel: provider.defaultModel },
      ]),
    ),
  }));

  const sessionService = new SessionService(db);
  sessionService.ensureTables();
  registerSessionRoutes(app, sessionService);

  try {
    db.run(/* sql */ `CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      conversation_id TEXT REFERENCES conversations(id),
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      finish_reason TEXT NOT NULL DEFAULT 'stop',
      created_at INTEGER NOT NULL
    )`);
  } catch {
    // Table may already exist.
  }

  // eslint-disable-next-line no-empty
  try { db.run(/* sql */ `ALTER TABLE platform_companion_clients ADD COLUMN available_models TEXT`); } catch { /* column already exists */ }
  // eslint-disable-next-line no-empty
  try { db.run(/* sql */ `ALTER TABLE platform_companion_clients ADD COLUMN available_chat_info TEXT`); } catch { /* column already exists */ }
  // eslint-disable-next-line no-empty
  try { db.run(/* sql */ `ALTER TABLE conversations ADD COLUMN sandbox_project_id TEXT`); } catch { /* column already exists */ }

  try {
    db.run(/* sql */ `CREATE TABLE IF NOT EXISTS platform_broadcast_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES platform_projects(id),
      sender_user_id TEXT NOT NULL REFERENCES platform_users(id),
      content TEXT NOT NULL,
      meta TEXT,
      target_mode TEXT NOT NULL DEFAULT 'all',
      target_client_ids TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    // eslint-disable-next-line no-empty
    try { db.run(/* sql */ `ALTER TABLE platform_broadcast_messages ADD COLUMN meta TEXT`); } catch { /* column already exists */ }
    db.run(/* sql */ `CREATE TABLE IF NOT EXISTS platform_broadcast_deliveries (
      id TEXT PRIMARY KEY,
      broadcast_id TEXT NOT NULL REFERENCES platform_broadcast_messages(id),
      target_client_id TEXT NOT NULL REFERENCES platform_companion_clients(id),
      status TEXT NOT NULL DEFAULT 'pending',
      claimed_at INTEGER,
      responded_at INTEGER,
      response_content TEXT,
      response_meta TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    db.run(/* sql */ `CREATE INDEX IF NOT EXISTS idx_platform_broadcast_messages_sender ON platform_broadcast_messages(sender_user_id)`);
    db.run(/* sql */ `CREATE INDEX IF NOT EXISTS idx_platform_broadcast_deliveries_broadcast ON platform_broadcast_deliveries(broadcast_id)`);
    db.run(/* sql */ `CREATE INDEX IF NOT EXISTS idx_platform_broadcast_deliveries_target ON platform_broadcast_deliveries(target_client_id)`);
    db.run(/* sql */ `CREATE INDEX IF NOT EXISTS idx_platform_broadcast_deliveries_status ON platform_broadcast_deliveries(status)`);
    db.run(/* sql */ `CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_broadcast_deliveries_unique ON platform_broadcast_deliveries(broadcast_id, target_client_id)`);
  } catch {
    // Tables may already exist.
  }

  app.get('/api/intelligence/stats', async () => {
    const intelligenceStats = vaiEngine.intelligence.getStats();
    return {
      ...intelligenceStats,
      knowledgeEntries: vaiEngine.knowledge.entryCount,
      ngramCount: vaiEngine.knowledge.ngramCount,
      documentCount: vaiEngine.knowledge.documentCount,
    };
  });

  app.get('/api/intelligence/hygiene', async () => {
    const { report, duplicateGroups, lowQuality } = vaiEngine.intelligence.analyzeHygiene();
    return { report, duplicateGroups: duplicateGroups.length, lowQualityEntries: lowQuality.length };
  });

  app.get('/api/intelligence/patterns', async (request) => {
    const { limit } = request.query as { limit?: string };
    if (!vaiEngine.intelligence.getStats().built) {
      vaiEngine.intelligence.build();
    }
    const topPatterns = vaiEngine.intelligence.decomposer.getTopPatterns(Number(limit) || 20);
    return topPatterns.map((pattern) => ({
      key: pattern.key,
      frequency: pattern.frequency,
      entries: pattern.entryIndices.length,
    }));
  });

  return {
    app,
    port,
    db,
    config,
    models,
    chatService,
    vaiEngine,
    pipeline,
    sandboxManager,
    sessionService,
    usageService,
    toolExecutor,
    tools,
  };
}