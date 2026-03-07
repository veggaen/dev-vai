import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import path from 'node:path';
import {
  createDb, ModelRegistry, ChatService, VaiEngine, IngestPipeline, schema, SessionService,
  loadConfig, printConfigDiagnostic, ToolRegistry, ToolExecutor, UsageService,
  ThorsenAdaptiveController, EvalRunner, SearchPipeline,
  type VaiConfig,
} from '@vai/core';
import { eq } from 'drizzle-orm';
import { registerChatRoutes } from './routes/chat.js';
import { registerConversationRoutes } from './routes/conversations.js';
import { registerModelRoutes } from './routes/models.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerImageRoutes } from './routes/images.js';
import { registerSandboxRoutes } from './routes/sandbox.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerDockerRoutes } from './routes/docker.js';
import { registerVaiGymRoutes } from './routes/vai-gym.js';
import { registerThorsenRoutes } from './routes/thorsen.js';
import { registerEvalRoutes } from './routes/eval.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { seedVaiEvalTasks } from './eval/vai-tasks.js';
import { SandboxManager } from './sandbox/manager.js';
import { registerAuthHook } from './middleware/auth.js';

export interface ServerOptions {
  port?: number;
  dbPath?: string;
}

export async function createServer(options?: ServerOptions) {
  // ── Config ──
  const config = loadConfig();
  printConfigDiagnostic(config);

  const port = options?.port ?? config.port;
  const dbPath = options?.dbPath ?? config.dbPath;

  const db = createDb(dbPath);
  const models = new ModelRegistry();
  const tools = new ToolRegistry();

  // ── VAI's own engine — always available, no external APIs ──
  const vaiEngine = new VaiEngine({
    persistPath: path.resolve(dbPath, '..', 'vai-knowledge.json'),
  });
  models.register(vaiEngine);

  // ── Auto-register external providers ──
  // Each provider adapter will be a separate file that implements ModelAdapter.
  // When you create packages/core/src/models/anthropic-adapter.ts (or similar),
  // import and register it here based on config.providers[provider].enabled.
  //
  // Example (uncomment when adapter exists):
  //
  // if (config.providers.anthropic.enabled) {
  //   const { AnthropicAdapter } = await import('@vai/core/models/anthropic-adapter.js');
  //   const anthropic = new AnthropicAdapter({
  //     apiKey: config.providers.anthropic.apiKey!,
  //     defaultModel: config.providers.anthropic.defaultModel,
  //     baseUrl: config.providers.anthropic.baseUrl,
  //   });
  //   models.register(anthropic);
  //   console.log(`[VAI] Anthropic adapter registered: ${anthropic.displayName}`);
  // }
  //
  // if (config.providers.openai.enabled) {
  //   const { OpenAIAdapter } = await import('@vai/core/models/openai-adapter.js');
  //   const openai = new OpenAIAdapter({ ... });
  //   models.register(openai);
  // }

  // Log what models are available
  const registeredModels = models.list().map((m) => m.id);
  console.log(`[VAI] Registered models: ${registeredModels.join(', ')}`);
  console.log(`[VAI] Default model: ${config.defaultModelId}`);

  // ── Usage Tracking ──
  const usageService = new UsageService(db);

  // ── Thorsen Adaptive Controller (shared across executor + chat) ──
  const adaptiveController = new ThorsenAdaptiveController();

  // ── Tool Executor ──
  const toolExecutor = new ToolExecutor(tools, {
    maxIterations: config.maxToolIterations,
  }, adaptiveController);

  // ── Ingestion pipeline — how VAI learns from the world ──
  const pipeline = new IngestPipeline(db, vaiEngine);

  // Hydrate engine from persisted sources in DB
  const hydrated = pipeline.hydrate();
  console.log(`[VAI] Hydrated: ${hydrated.sourcesLoaded} sources, ${hydrated.chunksLoaded} chunks, ${hydrated.imagesLoaded} images loaded into engine`);

  // Load persisted taught entries (VCUS teaching) into knowledge store
  try {
    const rows = db.select().from(schema.taughtEntries).all();
    let taughtCount = 0;
    for (const row of rows) {
      vaiEngine.knowledge.addEntry(row.pattern, row.response, row.source, row.language as 'en' | 'no' | 'code' | 'mixed');
      taughtCount++;
    }
    if (taughtCount > 0) console.log(`[VAI] Loaded ${taughtCount} taught entries from database`);
  } catch {
    // Table may not exist yet — will be created on first teach
  }

  console.log('[VAI] VeggaAI engine initialized');
  const stats = vaiEngine.getStats();
  console.log(`[VAI] Vocab: ${stats.vocabSize} | Knowledge: ${stats.knowledgeEntries} entries | Docs: ${stats.documentsIndexed} | Concepts: ${stats.conceptsExtracted} | N-grams: ${stats.ngramContexts}`);

  const chatService = new ChatService(db, models, adaptiveController);
  const sandboxManager = new SandboxManager();

  const app = Fastify({ logger: false, bodyLimit: 15 * 1024 * 1024 }); // 15MB for image uploads

  await app.register(cors, { origin: true });
  await app.register(websocket);

  // ── Auth — gates external access, local requests bypass ──
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
    docs: { health: '/health', train: 'POST /api/train', chat: '/api/chat', capture: 'POST /api/capture', diagnose: 'GET /api/vai/diagnose' },
  }));

  app.get('/health', async () => ({
    status: 'ok',
    engine: 'vai:v0',
    stats: vaiEngine.getStats(),
    adaptive: adaptiveController.snapshot(),
  }));

  // Self-awareness diagnostic — what Vai knows, where it's weak, what to teach next
  app.get('/api/vai/diagnose', async () => vaiEngine.diagnose());

  // Training endpoint — feed raw text to VAI
  app.post<{ Body: { text: string; source: string; language?: string } }>(
    '/api/train',
    async (request) => {
      const { text, source, language } = request.body;
      vaiEngine.train(text, source, (language as 'en' | 'no' | 'code' | 'mixed') ?? 'en');
      return { ok: true, stats: vaiEngine.getStats() };
    },
  );

  // Teach endpoint — add pattern-response knowledge entries directly
  // These are used by findBestTaughtMatch (Strategy 1.515) and bypass TF-IDF noise
  // Entries are persisted to SQLite so they survive server restarts
  app.post<{ Body: { entries: Array<{ pattern: string; response: string; source?: string }> } }>(
    '/api/teach',
    async (request) => {
      const { entries } = request.body;
      let added = 0;
      for (const entry of entries) {
        const source = entry.source ?? 'vcus-teaching';
        const pattern = entry.pattern.toLowerCase();
        vaiEngine.knowledge.addEntry(pattern, entry.response, source, 'en');

        // Persist to DB — upsert by ID (pattern+source hash)
        try {
          const id = `teach-${Buffer.from(pattern + source).toString('base64url').slice(0, 40)}`;
          db.insert(schema.taughtEntries)
            .values({ id, pattern, response: entry.response, source, language: 'en', createdAt: new Date() })
            .onConflictDoUpdate({
              target: schema.taughtEntries.id,
              set: { response: entry.response, pattern },
            })
            .run();
        } catch { /* persistence failure — in-memory still works */ }
        added++;
      }
      return { ok: true, added, stats: vaiEngine.getStats() };
    },
  );

  // Clear all taught entries (useful for re-teaching from scratch)
  app.delete('/api/teach', async () => {
    try {
      db.delete(schema.taughtEntries).run();
      // Also clear from in-memory knowledge store
      vaiEngine.knowledge.clearTaughtEntries();
    } catch { /* ok */ }
    return { ok: true, cleared: true };
  });

  registerConversationRoutes(app, chatService);
  registerModelRoutes(app, models);
  registerChatRoutes(app, chatService);
  registerIngestRoutes(app, pipeline);
  registerImageRoutes(app, pipeline, chatService);
  registerSandboxRoutes(app, sandboxManager);
  registerDockerRoutes(app);
  registerVaiGymRoutes(app);
  registerThorsenRoutes(app);

  // ── Eval Framework ──
  seedVaiEvalTasks();
  const evalRunner = new EvalRunner(db, models);
  registerEvalRoutes(app, evalRunner);

  // ── Search Pipeline (Perplexity-style) ──
  const searchPipeline = new SearchPipeline();
  registerSearchRoutes(app, searchPipeline);

  // ── Feedback (thumbs up/down on messages) ──
  registerFeedbackRoutes(app, db);

  // ── Usage endpoint ──
  app.get('/api/usage', async (request) => {
    const query = request.query as { from?: string; to?: string };
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    return usageService.getSummary(from, to);
  });

  app.get('/api/usage/budget', async () => {
    return usageService.checkBudget(config.maxMonthlySpend);
  });

  // ── Config endpoint (public-safe subset) ──
  app.get('/api/config', async () => ({
    defaultModelId: config.defaultModelId,
    fallbackChain: config.fallbackChain,
    enableToolCalling: config.enableToolCalling,
    maxToolIterations: config.maxToolIterations,
    enableUsageTracking: config.enableUsageTracking,
    enableEval: config.enableEval,
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([id, p]) => [
        id,
        { id: p.id, enabled: p.enabled, defaultModel: p.defaultModel },
      ]),
    ),
  }));

  // Agent session logger
  const sessionService = new SessionService(db);
  sessionService.ensureTables();
  registerSessionRoutes(app, sessionService);

  // ── Ensure new tables exist ──
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
  } catch { /* table may already exist */ }

  // ── Knowledge Intelligence endpoints ──
  app.get('/api/intelligence/stats', async () => {
    const stats = vaiEngine.intelligence.getStats();
    return {
      ...stats,
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
    if (!vaiEngine.intelligence.getStats().built) vaiEngine.intelligence.build();
    const top = vaiEngine.intelligence.decomposer.getTopPatterns(Number(limit) || 20);
    return top.map(p => ({ key: p.key, frequency: p.frequency, entries: p.entryIndices.length }));
  });

  return {
    app, port, db, config, models, chatService, vaiEngine, pipeline,
    sandboxManager, sessionService, usageService, toolExecutor, tools,
  };
}
