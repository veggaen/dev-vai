import type { ModelCapabilities, ModelCost, ModelProfile, ProviderId } from '../config/types.js';

// ── Messages ──

export interface Message {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly toolCallId?: string;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

// ── Requests & Responses ──

export interface ChatRequest {
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
  /** Optional: force a specific model for this request (overrides adapter default) */
  readonly modelOverride?: string;
  /** When true, Vai will NOT learn from this exchange (protective parenting mode) */
  readonly noLearn?: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  /** Tokens served from cache (Anthropic prompt caching, etc.) */
  cachedTokens?: number;
}

export interface ChatResponse {
  readonly message: Message;
  readonly usage: TokenUsage;
  readonly finishReason: 'stop' | 'tool_calls' | 'length';
  readonly durationMs?: number;
  /** Which specific model handled this request (for multi-model providers) */
  readonly modelId?: string;
}

export interface SearchSource {
  readonly url: string;
  readonly title: string;
  readonly domain: string;
  readonly snippet: string;
  readonly favicon: string;
  readonly trustTier: 'high' | 'medium' | 'low' | 'untrusted';
  readonly trustScore: number;
}

export interface GroundedBuildBrief {
  readonly intent: 'build' | 'edit';
  readonly focusLabel: string;
  readonly summary: string;
  readonly recommendation: string;
  readonly nextStep: string;
  readonly reasons: readonly string[];
  readonly sourceDomains: readonly string[];
  readonly sourceCount: number;
  readonly confidence: number;
}

export interface ChatChunk {
  readonly type:
    | 'text_delta'
    | 'reasoning_delta'
    | 'tool_call_delta'
    | 'sources'
    | 'done'
    | 'conversation_resolved'
    | 'fallback_notice';
  readonly textDelta?: string;
  readonly reasoningDelta?: string;
  readonly toolCallDelta?: { readonly id: string; readonly name: string; readonly argumentsDelta: string };
  /** Search sources — sent before text when a web search was performed */
  readonly sources?: readonly SearchSource[];
  /** Suggested follow-up questions (Perplexity-style) */
  readonly followUps?: readonly string[];
  /** Confidence score (0-1) for the search results */
  readonly confidence?: number;
  /** Structured evidence-to-build handoff for build-oriented grounded replies */
  readonly groundedBrief?: GroundedBuildBrief;
  readonly usage?: TokenUsage;
  readonly durationMs?: number;
  /** Which specific model handled this request */
  readonly modelId?: string;
  /**
   * Set on `conversation_resolved` chunks when the chat service auto-created
   * a conversation for an unknown id (race recovery). Clients should swap
   * their local `activeConversationId` to this value before further turns.
   */
  readonly conversationId?: string;
  /**
   * Populated on `fallback_notice` chunks when the chat service transparently
   * promotes a low-confidence vai:v0 turn to an external provider. The UI
   * surfaces a small badge ("Answered by gpt-4o-mini") so the user knows
   * which model produced the streamed text that follows.
   */
  readonly fallback?: {
    readonly fromModelId: string;
    readonly toModelId: string;
    readonly reason: 'low-confidence' | 'no-knowledge';
  };
}

// ── Model Adapter Interface ──

export interface ModelAdapter {
  /** Unique adapter ID (e.g., "vai:v0", "anthropic:claude-sonnet-4-20250514") */
  readonly id: string;
  /** Human-readable name */
  readonly displayName: string;
  /** Which provider this adapter belongs to */
  readonly provider?: ProviderId;

  // ── Core Capabilities (backward compat — these remain required) ──
  readonly supportsStreaming: boolean;
  readonly supportsToolUse: boolean;

  // ── Extended Metadata (optional — new adapters should populate these) ──

  /** Full capability matrix */
  readonly capabilities?: ModelCapabilities;
  /** Pricing information */
  readonly cost?: ModelCost;
  /** Context window size in tokens */
  readonly contextWindow?: number;
  /** Maximum output tokens */
  readonly maxOutputTokens?: number;
  /** Speed tier for routing decisions */
  readonly speedTier?: 'fast' | 'medium' | 'slow';
  /** Quality tier for routing decisions */
  readonly qualityTier?: 'flagship' | 'balanced' | 'fast' | 'local';

  // ── Core Methods ──

  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): AsyncIterable<ChatChunk>;

  // ── Optional Lifecycle ──

  /** Called on server shutdown — clean up connections, flush buffers */
  dispose?(): Promise<void>;
  /** Health check — returns true if the adapter can serve requests */
  healthCheck?(): Promise<boolean>;
}

// ── Model Registry ──

export class ModelRegistry {
  private adapters = new Map<string, ModelAdapter>();
  /** Track which providers have at least one registered adapter */
  private _providers = new Set<string>();

  register(adapter: ModelAdapter): void {
    this.adapters.set(adapter.id, adapter);
    if (adapter.provider) this._providers.add(adapter.provider);
  }

  unregister(id: string): boolean {
    return this.adapters.delete(id);
  }

  get(id: string): ModelAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Model adapter not found: ${id}`);
    }
    return adapter;
  }

  /** Get adapter or undefined (no throw) */
  tryGet(id: string): ModelAdapter | undefined {
    return this.adapters.get(id);
  }

  /** Get the first available adapter from a list of IDs (fallback chain) */
  getFirstAvailable(ids: string[]): ModelAdapter | undefined {
    for (const id of ids) {
      const adapter = this.adapters.get(id);
      if (adapter) return adapter;
    }
    return undefined;
  }

  list(): ModelAdapter[] {
    return Array.from(this.adapters.values());
  }

  /** List adapters filtered by provider */
  listByProvider(provider: string): ModelAdapter[] {
    return this.list().filter((a) => a.provider === provider);
  }

  /** List adapters that support a specific capability */
  listWithCapability(capability: keyof ModelCapabilities): ModelAdapter[] {
    return this.list().filter((a) => a.capabilities?.[capability]);
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }

  /** Which providers have registered adapters */
  get providers(): string[] {
    return Array.from(this._providers);
  }

  /** Total number of registered adapters */
  get size(): number {
    return this.adapters.size;
  }

  /** Dispose all adapters (call on server shutdown) */
  async disposeAll(): Promise<void> {
    const disposals = this.list()
      .filter((a) => a.dispose)
      .map((a) => a.dispose!());
    await Promise.allSettled(disposals);
  }
}
