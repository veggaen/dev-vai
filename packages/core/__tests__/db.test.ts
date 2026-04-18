import { existsSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, getRawDb, resetDbInstance } from '../src/db/client.js';
import { conversations, evalRuns, messages } from '../src/db/schema.js';
import type { VaiDatabase } from '../src/db/client.js';
import { ulid } from 'ulid';

describe('Database', () => {
  let db: VaiDatabase;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('creates conversations', () => {
    const id = ulid();
    const now = new Date();

    db.insert(conversations).values({
      id,
      title: 'Test Conversation',
      modelId: 'openai:gpt-4o',
      createdAt: now,
      updatedAt: now,
    }).run();

    const result = db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .get();

    expect(result).toBeDefined();
    expect(result!.title).toBe('Test Conversation');
    expect(result!.modelId).toBe('openai:gpt-4o');
  });

  it('creates messages linked to conversations', () => {
    const convId = ulid();
    const msgId = ulid();
    const now = new Date();

    db.insert(conversations).values({
      id: convId,
      title: 'Test',
      modelId: 'test',
      createdAt: now,
      updatedAt: now,
    }).run();

    db.insert(messages).values({
      id: msgId,
      conversationId: convId,
      role: 'user',
      content: 'Hello VAI',
      createdAt: now,
    }).run();

    const msgs = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .all();

    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Hello VAI');
    expect(msgs[0].role).toBe('user');
  });

  it('stores and retrieves tool calls as JSON', () => {
    const convId = ulid();
    const msgId = ulid();
    const now = new Date();

    db.insert(conversations).values({
      id: convId,
      title: 'Test',
      modelId: 'test',
      createdAt: now,
      updatedAt: now,
    }).run();

    const toolCalls = JSON.stringify([
      { id: 'tc1', name: 'file_read', arguments: '{"path": "/test.ts"}' },
    ]);

    db.insert(messages).values({
      id: msgId,
      conversationId: convId,
      role: 'assistant',
      content: 'Let me read that file.',
      toolCalls,
      createdAt: now,
    }).run();

    const msg = db.select().from(messages).where(eq(messages.id, msgId)).get();
    expect(msg).toBeDefined();
    expect(msg!.toolCalls).toBe(toolCalls);

    const parsed = JSON.parse(msg!.toolCalls!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('file_read');
  });

  it('lists conversations ordered by updatedAt', () => {
    const now = new Date();

    db.insert(conversations).values({
      id: ulid(),
      title: 'Older',
      modelId: 'test',
      createdAt: new Date(now.getTime() - 10000),
      updatedAt: new Date(now.getTime() - 10000),
    }).run();

    db.insert(conversations).values({
      id: ulid(),
      title: 'Newer',
      modelId: 'test',
      createdAt: now,
      updatedAt: now,
    }).run();

    const all = db.select().from(conversations).all();
    expect(all).toHaveLength(2);
  });

  it('deletes messages when conversation is deleted', () => {
    const convId = ulid();
    const now = new Date();

    db.insert(conversations).values({
      id: convId,
      title: 'To Delete',
      modelId: 'test',
      createdAt: now,
      updatedAt: now,
    }).run();

    db.insert(messages).values({
      id: ulid(),
      conversationId: convId,
      role: 'user',
      content: 'will be deleted',
      createdAt: now,
    }).run();

    // Delete messages first (FK constraint), then conversation
    db.delete(messages).where(eq(messages.conversationId, convId)).run();
    db.delete(conversations).where(eq(conversations.id, convId)).run();

    const conv = db.select().from(conversations).where(eq(conversations.id, convId)).get();
    expect(conv).toBeUndefined();

    const msgs = db.select().from(messages).where(eq(messages.conversationId, convId)).all();
    expect(msgs).toHaveLength(0);
  });

  it('migrates older eval_runs tables so newer casual, creative, and complex tracks can be stored', () => {
    const dbPath = join(tmpdir(), `vai-eval-migration-${ulid()}.sqlite`);
    const oldDb = new Database(dbPath);

    oldDb.exec(`
      CREATE TABLE eval_runs (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        track TEXT NOT NULL CHECK(track IN ('comprehension', 'navigation', 'bugfix', 'feature')),
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        config TEXT
      );
    `);
    oldDb.close();

    try {
      const migratedDb = createDb(dbPath);
      const rawDb = getRawDb();
      const tableSql = rawDb
        ?.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'eval_runs'")
        .get() as { sql: string } | undefined;

      expect(tableSql?.sql).toContain("'casual'");
      expect(tableSql?.sql).toContain("'creative'");
      expect(tableSql?.sql).toContain("'complex'");

      migratedDb.insert(evalRuns).values({
        id: ulid(),
        modelId: 'test:mock',
        track: 'casual',
        startedAt: new Date(),
        config: '{}',
      }).run();
    } finally {
      getRawDb()?.close();
      resetDbInstance();
      unlinkSync(dbPath);
    }
  });

  it('creates parent directories for file-backed databases automatically', () => {
    const dbDir = join(tmpdir(), `vai-db-parent-${ulid()}`);
    const dbPath = join(dbDir, 'nested', 'vai.sqlite');

    try {
      const fileDb = createDb(dbPath);
      fileDb.insert(conversations).values({
        id: ulid(),
        title: 'Nested DB',
        modelId: 'test',
        createdAt: new Date(),
        updatedAt: new Date(),
      }).run();

      expect(existsSync(dbPath)).toBe(true);
    } finally {
      getRawDb()?.close();
      resetDbInstance();
      rmSync(dbDir, { recursive: true, force: true });
    }
  });
});
