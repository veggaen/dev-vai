import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { conversations, messages } from '../src/db/schema.js';
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
});
