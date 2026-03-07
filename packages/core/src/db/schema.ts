import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// ---- Chat ----

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  modelId: text('model_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// ---- Images / Training Data ----

export const images = sqliteTable('images', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').references(() => conversations.id),
  sourceId: text('source_id').references(() => sources.id),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  data: text('data').notNull(), // base64 encoded
  description: text('description').notNull(), // human-provided fact/description (required)
  question: text('question'), // optional question about the image
  width: integer('width'),
  height: integer('height'),
  sizeBytes: integer('size_bytes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ---- Chat Messages ----

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id),
  role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
  content: text('content').notNull(),
  imageId: text('image_id').references(() => images.id),
  toolCalls: text('tool_calls'),
  toolCallId: text('tool_call_id'),
  tokenCount: integer('token_count'),
  modelId: text('model_id'),
  durationMs: integer('duration_ms'),
  /** User feedback: 1 = helpful, 0 = not helpful, null = no feedback yet */
  feedback: integer('feedback'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ---- Source Ingestion ----

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  sourceType: text('source_type', { enum: ['web', 'youtube', 'file'] }).notNull(),
  url: text('url'),
  title: text('title').notNull(),
  capturedAt: integer('captured_at', { mode: 'timestamp' }).notNull(),
  qualityScore: real('quality_score'),
  lastValidated: integer('last_validated', { mode: 'timestamp' }),
  meta: text('meta'),
});

export const chunks = sqliteTable('chunks', {
  id: text('id').primaryKey(),
  sourceId: text('source_id')
    .notNull()
    .references(() => sources.id),
  level: integer('level').notNull(),
  ordinal: integer('ordinal').notNull(),
  content: text('content').notNull(),
  meta: text('meta'),
});

// ---- VCUS Taught Knowledge ----

export const taughtEntries = sqliteTable('taught_entries', {
  id: text('id').primaryKey(),
  pattern: text('pattern').notNull(),
  response: text('response').notNull(),
  source: text('source').notNull().default('vcus-teaching'),
  language: text('language').notNull().default('en'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ---- VCUS Eval ----

export const evalRuns = sqliteTable('eval_runs', {
  id: text('id').primaryKey(),
  modelId: text('model_id').notNull(),
  track: text('track', {
    enum: ['comprehension', 'navigation', 'bugfix', 'feature', 'thorsen', 'gym'],
  }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
  config: text('config'),
});

export const evalScores = sqliteTable('eval_scores', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => evalRuns.id),
  taskId: text('task_id').notNull(),
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  score: real('score'),
  attempts: integer('attempts').notNull(),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  wallTime: integer('wall_time'),
  detail: text('detail'),
});

// ---- Usage Tracking ----

export const usageRecords = sqliteTable('usage_records', {
  id: text('id').primaryKey(),
  modelId: text('model_id').notNull(),
  provider: text('provider').notNull(),
  conversationId: text('conversation_id').references(() => conversations.id),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  finishReason: text('finish_reason').notNull().default('stop'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
