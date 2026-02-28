// Database
export { getDb, createDb, resetDbInstance } from './db/client.js';
export type { VaiDatabase } from './db/client.js';
export * as schema from './db/schema.js';

// Models
export {
  ModelRegistry,
  type ModelAdapter,
  type ChatRequest,
  type ChatResponse,
  type ChatChunk,
  type Message,
  type ToolCall,
  type ToolDefinition,
} from './models/adapter.js';
export { VaiEngine, VaiTokenizer, KnowledgeStore } from './models/vai-engine.js';
export type { KnowledgeEntry } from './models/vai-engine.js';

// Chat
export { ChatService } from './chat/service.js';
export type { ImageInput } from './chat/service.js';
export type { ConversationRecord, MessageRecord, ImageRecord } from './chat/types.js';

// Ingestion
export { IngestPipeline } from './ingest/pipeline.js';
export type { IngestResult, RawCapture } from './ingest/pipeline.js';
export { scrapeWebPage, extractLinks } from './ingest/web.js';
export { fetchYouTubeTranscript, extractVideoId, createYouTubeCapture } from './ingest/youtube.js';
export { fetchGitHubRepo, parseGitHubUrl, createGitHubCapture } from './ingest/github.js';

// Tools
export { ToolRegistry } from './tools/registry.js';
export type { Tool, ToolContext, ToolResult } from './tools/interface.js';
