import { eq, desc } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { VaiDatabase } from '../db/client.js';
import { conversations, messages } from '../db/schema.js';
import type { ModelRegistry, ChatChunk, Message } from '../models/adapter.js';

export class ChatService {
  constructor(
    private db: VaiDatabase,
    private models: ModelRegistry,
  ) {}

  createConversation(modelId: string, title?: string): string {
    const id = ulid();
    const now = new Date();
    this.db.insert(conversations).values({
      id,
      title: title ?? 'New Chat',
      modelId,
      createdAt: now,
      updatedAt: now,
    }).run();
    return id;
  }

  listConversations() {
    return this.db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .all();
  }

  getMessages(conversationId: string) {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt)
      .all();
  }

  async *sendMessage(
    conversationId: string,
    content: string,
  ): AsyncGenerator<ChatChunk> {
    const conv = this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();

    if (!conv) throw new Error(`Conversation not found: ${conversationId}`);

    // Persist user message
    const userMsgId = ulid();
    this.db.insert(messages).values({
      id: userMsgId,
      conversationId,
      role: 'user',
      content,
      createdAt: new Date(),
    }).run();

    // Get conversation history
    const history = this.getMessages(conversationId);
    const chatMessages: Message[] = history.map((m) => ({
      role: m.role as Message['role'],
      content: m.content,
      toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
      toolCallId: m.toolCallId ?? undefined,
    }));

    // Stream from model
    const adapter = this.models.get(conv.modelId);
    let fullText = '';
    let totalUsage = { promptTokens: 0, completionTokens: 0 };

    for await (const chunk of adapter.chatStream({ messages: chatMessages })) {
      if (chunk.type === 'text_delta' && chunk.textDelta) {
        fullText += chunk.textDelta;
      }
      if (chunk.type === 'done' && chunk.usage) {
        totalUsage = chunk.usage;
      }
      yield chunk;
    }

    // Persist assistant message
    const assistantMsgId = ulid();
    this.db.insert(messages).values({
      id: assistantMsgId,
      conversationId,
      role: 'assistant',
      content: fullText,
      tokenCount: totalUsage.completionTokens || undefined,
      modelId: conv.modelId,
      createdAt: new Date(),
    }).run();

    // Update conversation timestamp and title
    this.db.update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .run();
  }

  deleteConversation(conversationId: string): void {
    this.db.delete(messages)
      .where(eq(messages.conversationId, conversationId))
      .run();
    this.db.delete(conversations)
      .where(eq(conversations.id, conversationId))
      .run();
  }
}
