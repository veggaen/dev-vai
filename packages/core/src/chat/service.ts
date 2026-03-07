import { eq, desc } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { VaiDatabase } from '../db/client.js';
import { conversations, messages, images } from '../db/schema.js';
import type { ModelRegistry, ChatChunk, Message } from '../models/adapter.js';
import type { ThorsenAdaptiveController } from '../thorsen/types.js';

export interface ImageInput {
  data: string;      // base64
  mimeType: string;
  filename?: string;
  description: string;  // required human description
  question?: string;    // optional question
  width?: number;
  height?: number;
  sizeBytes?: number;
}

export class ChatService {
  constructor(
    private db: VaiDatabase,
    private models: ModelRegistry,
    private controller?: ThorsenAdaptiveController,
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

  getImage(imageId: string) {
    return this.db
      .select()
      .from(images)
      .where(eq(images.id, imageId))
      .get();
  }

  /**
   * Store an image and return its ID. The description is required — humans always provide
   * at least one true fact about what's in the image.
   */
  storeImage(input: ImageInput, conversationId?: string): string {
    const id = ulid();
    this.db.insert(images).values({
      id,
      conversationId: conversationId ?? null,
      filename: input.filename ?? `image-${id}.png`,
      mimeType: input.mimeType,
      data: input.data,
      description: input.description,
      question: input.question ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      sizeBytes: input.sizeBytes ?? null,
      createdAt: new Date(),
    }).run();
    return id;
  }

  /**
   * List all images, optionally filtered by conversation.
   */
  listImages(conversationId?: string) {
    if (conversationId) {
      return this.db.select({
        id: images.id,
        filename: images.filename,
        mimeType: images.mimeType,
        description: images.description,
        question: images.question,
        width: images.width,
        height: images.height,
        sizeBytes: images.sizeBytes,
        createdAt: images.createdAt,
      }).from(images)
        .where(eq(images.conversationId, conversationId))
        .all();
    }
    return this.db.select({
      id: images.id,
      filename: images.filename,
      mimeType: images.mimeType,
      description: images.description,
      question: images.question,
      width: images.width,
      height: images.height,
      sizeBytes: images.sizeBytes,
      createdAt: images.createdAt,
    }).from(images).all();
  }

  async *sendMessage(
    conversationId: string,
    content: string,
    image?: ImageInput,
    systemPrompt?: string,
    noLearn?: boolean,
  ): AsyncGenerator<ChatChunk> {
    const conv = this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();

    if (!conv) throw new Error(`Conversation not found: ${conversationId}`);

    // If there's an image, store it and build enriched content
    let imageId: string | null = null;
    let enrichedContent = content;
    if (image) {
      imageId = this.storeImage(image, conversationId);
      // Prepend the image description + question to the message content for the AI
      const imageParts = [`[Image: ${image.description}]`];
      if (image.question) imageParts.push(`[Question about image: ${image.question}]`);
      enrichedContent = imageParts.join('\n') + (content ? '\n' + content : '');
    }

    // Persist user message
    const userMsgId = ulid();
    this.db.insert(messages).values({
      id: userMsgId,
      conversationId,
      role: 'user',
      content: enrichedContent,
      imageId,
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

    // Prepend system prompt if provided (from mode selection)
    const finalMessages: Message[] = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...chatMessages]
      : chatMessages;

    // Stream from model
    const adapter = this.models.get(conv.modelId);
    let fullText = '';
    let totalUsage = { promptTokens: 0, completionTokens: 0 };
    let durationMs: number | undefined;

    for await (const chunk of adapter.chatStream({ messages: finalMessages, noLearn })) {
      if (chunk.type === 'text_delta' && chunk.textDelta) {
        fullText += chunk.textDelta;
      }
      if (chunk.type === 'done') {
        if (chunk.usage) totalUsage = chunk.usage;
        if (chunk.durationMs !== undefined) durationMs = chunk.durationMs;
      }
      yield chunk;
    }

    // Feed streaming latency back to the adaptive controller
    if (durationMs !== undefined && this.controller) {
      this.controller.observe(durationMs);
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
      durationMs: durationMs ?? undefined,
      createdAt: new Date(),
    }).run();

    // Update conversation timestamp + auto-title on first message
    const updates: { updatedAt: Date; title?: string } = { updatedAt: new Date() };
    if (conv.title === 'New Chat' && content.length > 0) {
      updates.title = this.generateTitle(image ? `🖼 ${content || image.description}` : content);
    }
    this.db.update(conversations)
      .set(updates)
      .where(eq(conversations.id, conversationId))
      .run();
  }

  private generateTitle(firstMessage: string): string {
    // Clean up and truncate the first user message into a chat title
    const cleaned = firstMessage
      .replace(/\n+/g, ' ')      // flatten newlines
      .replace(/\s+/g, ' ')       // collapse whitespace
      .trim();

    if (cleaned.length <= 40) return cleaned;

    // Cut at word boundary
    const truncated = cleaned.slice(0, 40);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...';
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
