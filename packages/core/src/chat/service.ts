import { eq, desc, or, isNull } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { VaiDatabase } from '../db/client.js';
import type {
  ChatPromptRewriteConfig,
  ChatPromptRewriteProfile,
  ChatPromptRewriteResponseDepth,
} from '../config/types.js';
import { conversations, messages, images } from '../db/schema.js';
import type { ModelRegistry, ChatChunk, Message } from '../models/adapter.js';
import { SkillRouter } from '../models/skill-router.js';
import type { ThorsenAdaptiveController } from '../thorsen/types.js';
import {
  buildChatTurnQualitySystemHint,
  buildTemporaryModeOverrideSystemHint,
  CHAT_STRUCTURE_SYSTEM_HINT,
  KNOWLEDGE_RETRIEVAL_SCORE_MIN,
  isGenerationIntent,
  resolveTemporaryTurnMode,
  shouldInjectChatStructureHint,
} from './chat-quality.js';
import { CONVERSATION_MODE_SYSTEM_PROMPTS, DEFAULT_CONVERSATION_MODE, type ConversationMode, isConversationMode } from './modes.js';
import { tryHandleChatMeta } from './meta-router.js';
import { resolveChatPromptRewriteConfig, rewriteChatPrompt } from './prompt-rewrite.js';
import { decideVaiFallback, pickFallbackModelId } from './vai-fallback.js';

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

export interface ChatServiceOptions {
  readonly promptRewrite?: Partial<ChatPromptRewriteConfig>;
  /** Optional knowledge retrieval function for enriching external model prompts */
  readonly retrieveKnowledge?: (query: string, topK?: number) => Array<{ text: string; source: string; score: number }>;
  /**
   * Ordered model ids to try when vai:v0 produces a low-confidence or
   * "no knowledge" response. The chat service will pick the first registered
   * non-`vai:v0` adapter from this list and re-dispatch the turn against it,
   * streaming a `fallback_notice` chunk first so the UI can badge the answer.
   * When unset or empty, vai:v0 responses are streamed as-is.
   */
  readonly vaiFallbackChain?: readonly string[];
}

export interface ChatPromptRewriteOverrides {
  readonly profile?: ChatPromptRewriteProfile;
  readonly responseDepth?: ChatPromptRewriteResponseDepth;
  /** When false, skip ambiguous-query hardening for this turn (eval / smoke harness). */
  readonly enabled?: boolean;
}

function isChatServiceOptions(value: unknown): value is ChatServiceOptions {
  return !!value
    && typeof value === 'object'
    && (
      'promptRewrite' in value
      || 'retrieveKnowledge' in value
      || 'vaiFallbackChain' in value
    );
}

const ACTIVE_SANDBOX_EXECUTION_HINT = [
  'An active sandbox project is already attached to this conversation.',
  'Default to targeted edits for that live app, not a fresh scaffold and not abstract product advice.',
  'Exception: if this is the first substantive build/create request and no current file snapshots or prior assistant file blocks exist, treat it as the first runnable build for the auto-created sandbox.',
  'When the user asks for a feature, polish pass, or fix, emit the concrete changed files needed to update the current app.',
  'Prefer the smallest working diff that preserves the current preview.',
  'Do not switch into research notes, citations, or generic troubleshooting unless the user explicitly asks for them or you are blocked on a specific missing fact.',
].join(' ');

export class ChatService {
  private readonly promptRewriteConfig: ChatPromptRewriteConfig;
  private readonly controller?: ThorsenAdaptiveController;
  private readonly retrieveKnowledge?: (query: string, topK?: number) => Array<{ text: string; source: string; score: number }>;
  private readonly skillRouter = new SkillRouter();
  private readonly vaiFallbackChain: readonly string[];

  constructor(
    private db: VaiDatabase,
    private models: ModelRegistry,
    controllerOrOptions?: ThorsenAdaptiveController | ChatServiceOptions,
    options?: ChatServiceOptions,
  ) {
    const resolvedOptions = isChatServiceOptions(controllerOrOptions) ? controllerOrOptions : options;
    this.controller = isChatServiceOptions(controllerOrOptions) ? undefined : controllerOrOptions;
    this.promptRewriteConfig = resolveChatPromptRewriteConfig(resolvedOptions?.promptRewrite);
    this.retrieveKnowledge = resolvedOptions?.retrieveKnowledge;
    this.vaiFallbackChain = resolvedOptions?.vaiFallbackChain ?? [];
  }

  createConversation(modelId: string, title?: string, mode: ConversationMode = DEFAULT_CONVERSATION_MODE, ownerUserId?: string | null): string {
    const id = ulid();
    const now = new Date();
    this.db.insert(conversations).values({
      id,
      title: title ?? 'New Chat',
      modelId,
      ownerUserId: ownerUserId ?? null,
      sandboxProjectId: null,
      mode,
      visibility: 'private',
      createdAt: now,
      updatedAt: now,
    }).run();
    return id;
  }

  getConversation(conversationId: string) {
    return this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();
  }

  updateConversationMode(conversationId: string, mode: ConversationMode) {
    this.db.update(conversations)
      .set({ mode, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .run();

    return this.getConversation(conversationId);
  }

  updateConversationSandbox(conversationId: string, sandboxProjectId: string | null) {
    this.db.update(conversations)
      .set({ sandboxProjectId, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .run();

    return this.getConversation(conversationId);
  }

  updateConversationVisibility(conversationId: string, visibility: 'private' | 'unlisted' | 'public') {
    const updates: Record<string, unknown> = { visibility, updatedAt: new Date() };

    // Generate a share slug for unlisted/public if none exists
    if (visibility !== 'private') {
      const conv = this.getConversation(conversationId);
      if (conv && !conv.shareSlug) {
        updates.shareSlug = this.generateShareSlug();
      }
    }

    this.db.update(conversations)
      .set(updates)
      .where(eq(conversations.id, conversationId))
      .run();

    return this.getConversation(conversationId);
  }

  getConversationByShareSlug(slug: string) {
    return this.db
      .select()
      .from(conversations)
      .where(eq(conversations.shareSlug, slug))
      .get();
  }

  private generateShareSlug(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let slug = '';
    for (let i = 0; i < 8; i++) {
      slug += chars[Math.floor(Math.random() * chars.length)];
    }
    return slug;
  }

  listConversations(limit = 50, offset = 0, ownerUserId?: string | null) {
    const query = this.db
      .select()
      .from(conversations);

    if (ownerUserId) {
      // Show user's own + public conversations
      return query
        .where(
          or(
            eq(conversations.ownerUserId, ownerUserId),
            eq(conversations.visibility, 'public'),
            isNull(conversations.ownerUserId),
          ),
        )
        .orderBy(desc(conversations.updatedAt))
        .limit(limit)
        .offset(offset)
        .all();
    }

    return query
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset)
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

  appendAssistantMessage(conversationId: string, content: string) {
    const conv = this.getConversation(conversationId);
    if (!conv) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const createdAt = new Date();
    const id = ulid();

    this.db.insert(messages).values({
      id,
      conversationId,
      role: 'assistant',
      content,
      modelId: conv.modelId,
      createdAt,
    }).run();

    this.db.update(conversations)
      .set({ updatedAt: createdAt })
      .where(eq(conversations.id, conversationId))
      .run();

    return {
      id,
      conversationId,
      role: 'assistant' as const,
      content,
      modelId: conv.modelId,
      createdAt,
    };
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
    conversationIdParam: string,
    content: string,
    image?: ImageInput,
    systemPrompt?: string,
    noLearn?: boolean,
    promptRewriteOverrides?: ChatPromptRewriteOverrides,
    autoCreateOptions?: { fallbackModelId?: string; fallbackMode?: ConversationMode },
  ): AsyncGenerator<ChatChunk> {
    // Auto-create on missing conversation: covers the well-known race where
    // the desktop client opens a WebSocket and sends a message before the
    // newly-created conversation row has been persisted (or after a stale
    // local id survives a wipe). We log, create with the caller's hinted
    // model + mode (or sensible defaults), and emit a `conversation_resolved`
    // chunk so the client can swap its store id before the next turn.
    let conversationId = conversationIdParam;
    let conv = this.getConversation(conversationId);

    if (!conv) {
      const fallbackModel = autoCreateOptions?.fallbackModelId ?? 'vai:v0';
      const fallbackMode = autoCreateOptions?.fallbackMode ?? DEFAULT_CONVERSATION_MODE;
      // eslint-disable-next-line no-console
      console.warn(
        `[chat-service] conversation ${conversationIdParam} not found — auto-creating with model=${fallbackModel} mode=${fallbackMode}`,
      );
      conversationId = this.createConversation(fallbackModel, undefined, fallbackMode);
      conv = this.getConversation(conversationId);
      if (!conv) {
        throw new Error(`Failed to auto-create conversation for missing id ${conversationIdParam}`);
      }
      yield { type: 'conversation_resolved', conversationId } as ChatChunk;
    }

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

    // Get conversation history — cap to last 40 messages to avoid runaway context.
    // Always keep at least the most recent pair so the model stays coherent.
    const MAX_HISTORY_MESSAGES = 40;
    const history = this.getMessages(conversationId);

    // Chat-meta intent short-circuit: questions *about* the conversation itself
    // ("what was my first message", "summarize this chat") are answered
    // deterministically from persisted history and bypass model dispatch.
    // Only applies when the user sent text (image-only turns fall through).
    if (!image && content.trim().length > 0) {
      const metaResult = tryHandleChatMeta(
        content,
        history.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system' | 'tool', content: m.content })),
      );
      if (metaResult) {
        const startedAt = Date.now();
        yield { type: 'text_delta', textDelta: metaResult.reply } as ChatChunk;
        const metaDurationMs = Date.now() - startedAt;
        yield {
          type: 'done',
          usage: { promptTokens: 0, completionTokens: 0 },
          durationMs: metaDurationMs,
        } as ChatChunk;

        // Persist the deterministic assistant reply so subsequent turns see it.
        const metaAssistantId = ulid();
        this.db.insert(messages).values({
          id: metaAssistantId,
          conversationId,
          role: 'assistant',
          content: metaResult.reply,
          modelId: `chat-meta:${metaResult.intent}`,
          durationMs: metaDurationMs,
          createdAt: new Date(),
        }).run();

        const metaUpdates: { updatedAt: Date; title?: string } = { updatedAt: new Date() };
        if (conv.title === 'New Chat' && content.length > 0) {
          metaUpdates.title = this.generateTitle(content);
        }
        this.db.update(conversations)
          .set(metaUpdates)
          .where(eq(conversations.id, conversationId))
          .run();
        return;
      }
    }

    const trimmedHistory = history.length > MAX_HISTORY_MESSAGES
      ? history.slice(history.length - MAX_HISTORY_MESSAGES)
      : history;
    const chatMessages: Message[] = trimmedHistory.map((m) => ({
      role: m.role as Message['role'],
      content: m.content,
      toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
      toolCallId: m.toolCallId ?? undefined,
    }));

    const resolvedMode = isConversationMode(conv.mode) ? conv.mode : DEFAULT_CONVERSATION_MODE;
    const isTerminalHarness = Boolean(systemPrompt?.includes('TERMINAL_HARNESS_V1'));
    const modePrompt = isTerminalHarness ? null : CONVERSATION_MODE_SYSTEM_PROMPTS[resolvedMode];
    const systemMessages: Message[] = [];
    if (modePrompt) {
      systemMessages.push({ role: 'system', content: modePrompt });
    }
    const temporaryTurnMode = isTerminalHarness ? null : resolveTemporaryTurnMode(resolvedMode, content);
    if (temporaryTurnMode) {
      systemMessages.push({
        role: 'system',
        content: buildTemporaryModeOverrideSystemHint(temporaryTurnMode),
      });
    }
    const hasActiveSandbox = Boolean(conv.sandboxProjectId);
    if (hasActiveSandbox) {
      systemMessages.push({ role: 'system', content: ACTIVE_SANDBOX_EXECUTION_HINT });
    }
    const shouldInjectSkillContext = !isTerminalHarness && !hasActiveSandbox && resolvedMode !== 'builder';
    const skillMatch = shouldInjectSkillContext ? this.skillRouter.getBestMatch(content) : null;
    if (skillMatch && !this.skillRouter.isExplicitScaffoldRequest(content)) {
      systemMessages.push({
        role: 'system',
        content: this.skillRouter.buildContext(skillMatch),
      });
    }
    if (systemPrompt?.trim()) {
      systemMessages.push({ role: 'system', content: systemPrompt.trim() });
    }
    const rewrite = isTerminalHarness
      ? null
      : rewriteChatPrompt({
        userContent: content,
        mode: resolvedMode,
        config: promptRewriteOverrides
          ? resolveChatPromptRewriteConfig({
            ...this.promptRewriteConfig,
            ...promptRewriteOverrides,
          })
          : this.promptRewriteConfig,
      });
    if (rewrite?.systemMessage) {
      systemMessages.push({ role: 'system', content: rewrite.systemMessage });
    }

    if (!isTerminalHarness && shouldInjectChatStructureHint(resolvedMode, content)) {
      systemMessages.push({ role: 'system', content: CHAT_STRUCTURE_SYSTEM_HINT });
    }

    if (!isTerminalHarness) {
      const turnQualityHint = buildChatTurnQualitySystemHint(resolvedMode, content, chatMessages);
      if (turnQualityHint) {
        systemMessages.push({ role: 'system', content: turnQualityHint });
      }
    }

    const buildMessagesForModel = (modelId: string): Message[] => {
      const requestSystemMessages = [...systemMessages];

      // Knowledge augmentation for external models:
      // Skip entirely for generation intents (build/scaffold/create requests) — retrieved
      // web captures won't help and will inject noise into the model's context.
      // Also skip for vai:v0 which uses its own knowledge store directly.
      if (modelId !== 'vai:v0' && this.retrieveKnowledge && !isGenerationIntent(content)) {
        const relevant = this.retrieveKnowledge(content, 8);
        const useful = relevant.filter((r) => r.score > KNOWLEDGE_RETRIEVAL_SCORE_MIN);
        if (useful.length > 0) {
          const knowledgeSnippets = useful
            .slice(0, 4)
            .map((r) => {
              const excerpt =
                r.text.length > 420 ? `${r.text.slice(0, 420).trim()}…` : r.text.trim();
              const src = r.source ? String(r.source).slice(0, 140) : 'knowledge';
              return `- [${src}] ${excerpt}`;
            })
            .join('\n');
          requestSystemMessages.push({
            role: 'system',
            content: [
              "Potentially relevant excerpts from Vai's local knowledge store (may be incomplete or dated—verify important facts).",
              'Use only what fits the question; do not invent citations. If you rely on a specific claim, note it came from retrieved context.',
              knowledgeSnippets,
            ].join('\n'),
          });
        }
      }

      return requestSystemMessages.length > 0
        ? [...requestSystemMessages, ...chatMessages]
        : chatMessages;
    };

    const primaryModelId = conv.modelId;
    const primaryMessages = buildMessagesForModel(primaryModelId);
    const fallbackModelId = primaryModelId === 'vai:v0'
      ? pickFallbackModelId(
        this.vaiFallbackChain,
        (modelId) => this.models.has(modelId),
        { content, mode: resolvedMode },
      )
      : null;

    // Stream from model
    const adapter = this.models.get(primaryModelId);
    let fullText = '';
    let totalUsage = { promptTokens: 0, completionTokens: 0 };
    let durationMs: number | undefined;
    let responseModelId = primaryModelId;

    if (primaryModelId === 'vai:v0' && fallbackModelId) {
      const bufferedChunks: ChatChunk[] = [];
      let bufferedText = '';
      let bufferedUsage = { promptTokens: 0, completionTokens: 0 };
      let bufferedDurationMs: number | undefined;
      let bufferedModelId = primaryModelId;
      let latestConfidence: number | undefined;

      for await (const chunk of adapter.chatStream({ messages: primaryMessages, noLearn })) {
        if (chunk.modelId) bufferedModelId = chunk.modelId;
        if (chunk.type === 'sources') {
          if (typeof chunk.confidence === 'number') latestConfidence = chunk.confidence;
          yield chunk;
          continue;
        }
        bufferedChunks.push(chunk);
        if (chunk.type === 'text_delta' && chunk.textDelta) {
          bufferedText += chunk.textDelta;
        }
        if (chunk.type === 'done') {
          if (chunk.usage) bufferedUsage = chunk.usage;
          if (chunk.durationMs !== undefined) bufferedDurationMs = chunk.durationMs;
        }
      }

      const hasPrimaryBuilderFileOutput = (resolvedMode === 'builder' || resolvedMode === 'agent')
        && /```[^\r\n`]*\b(?:title|path|file|filename)=["'][^"']+["']/i.test(bufferedText);
      const fallbackDecision = hasPrimaryBuilderFileOutput
        ? { shouldFallback: false as const, reason: null }
        : decideVaiFallback({ text: bufferedText, confidence: latestConfidence });
      if (!fallbackDecision.shouldFallback || !fallbackDecision.reason) {
        fullText = bufferedText;
        totalUsage = bufferedUsage;
        durationMs = bufferedDurationMs;
        responseModelId = bufferedModelId;
        for (const chunk of bufferedChunks) {
          yield chunk;
        }
      } else {
        yield {
          type: 'fallback_notice',
          fallback: {
            fromModelId: primaryModelId,
            toModelId: fallbackModelId,
            reason: fallbackDecision.reason,
          },
        };

        const fallbackAdapter = this.models.get(fallbackModelId);
        const fallbackMessages = buildMessagesForModel(fallbackModelId);
        let fallbackDurationMs: number | undefined;
        responseModelId = fallbackModelId;

        for await (const chunk of fallbackAdapter.chatStream({ messages: fallbackMessages, noLearn })) {
          if (chunk.modelId) responseModelId = chunk.modelId;
          if (chunk.type === 'text_delta' && chunk.textDelta) {
            fullText += chunk.textDelta;
          }
          if (chunk.type === 'done') {
            if (chunk.usage) totalUsage = chunk.usage;
            if (chunk.durationMs !== undefined) {
              fallbackDurationMs = chunk.durationMs;
            }
          }
          yield chunk;
        }

        if (bufferedDurationMs !== undefined && fallbackDurationMs !== undefined) {
          durationMs = bufferedDurationMs + fallbackDurationMs;
        } else {
          durationMs = fallbackDurationMs ?? bufferedDurationMs;
        }
      }
    } else {
      for await (const chunk of adapter.chatStream({ messages: primaryMessages, noLearn })) {
        if (chunk.modelId) responseModelId = chunk.modelId;
        if (chunk.type === 'text_delta' && chunk.textDelta) {
          fullText += chunk.textDelta;
        }
        if (chunk.type === 'done') {
          if (chunk.usage) totalUsage = chunk.usage;
          if (chunk.durationMs !== undefined) durationMs = chunk.durationMs;
        }
        yield chunk;
      }
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
      modelId: responseModelId,
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
