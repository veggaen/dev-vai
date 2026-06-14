import type { ModelCapabilities, ModelCost, ModelProfile, ProviderId } from '../config/types.js';
import type { ChatTurnKind } from '../chat/turn-kind.js';
import type { CouncilThinking } from '../consensus/types.js';

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
  /** Deliberate complexity tier decided for this build (minimal | standard | advanced). */
  readonly qualityTier?: 'minimal' | 'standard' | 'advanced';
  /**
   * Rendered quality contract (tier summary + must-haves + deliberate avoids).
   * Carried on the brief so the full contract — not just a scope note — reaches
   * the build composition / execution prompt downstream.
   */
  readonly qualityBrief?: string;
}

export type SourcePresentation = 'research' | 'supporting';

export interface ResearchTraceStage {
  readonly step: 'clarify' | 'fan-out' | 'fetch' | 'rank' | 'read' | 'cross-check' | 'conclude';
  readonly label: string;
  readonly detail: string;
  readonly durationMs: number;
}

/** Structured provenance for one web-search run, suitable for UI inspection. */
export interface ResearchTrace {
  readonly mode: 'linear' | 'parallel' | 'wormhole';
  readonly latencyMs: number;
  readonly recommendedConcurrency: number;
  readonly rawResultCount: number;
  readonly sourceCount: number;
  readonly intent: string;
  readonly entities: readonly string[];
  readonly fanOutQueries: readonly string[];
  readonly stages: readonly ResearchTraceStage[];
}

export interface ChatChunk {
  readonly type:
    | 'text_delta'
    | 'reasoning_delta'
    | 'tool_call_delta'
    | 'progress'
    | 'turn_kind'
    | 'sources'
    | 'done'
    | 'conversation_resolved'
    | 'fallback_notice'
    | 'verification'
    | 'image_progress'
    | 'image_result';
  readonly textDelta?: string;
  readonly reasoningDelta?: string;
  readonly toolCallDelta?: { readonly id: string; readonly name: string; readonly argumentsDelta: string };
  /** User-visible activity/progress for long-running research, analysis, and builder turns. */
  readonly progress?: {
    readonly stage: string;
    readonly label: string;
    readonly detail?: string;
    readonly status: 'running' | 'done';
  };
  /** High-level routing classification for the current assistant turn. */
  readonly turnKind?: ChatTurnKind;
  /** Search sources — sent before text when a web search was performed */
  readonly sources?: readonly SearchSource[];
  /** Tells the UI whether citations should render as full research chrome or quieter supporting references. */
  readonly sourcePresentation?: SourcePresentation;
  /** Suggested follow-up questions (Perplexity-style) */
  readonly followUps?: readonly string[];
  /** Confidence score (0-1) for the search results */
  readonly confidence?: number;
  /** Structured evidence-to-build handoff for build-oriented grounded replies */
  readonly groundedBrief?: GroundedBuildBrief;
  /** Inspectable search execution trace for research turns, including empty-result searches. */
  readonly researchTrace?: ResearchTrace;
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
  /**
   * Populated on `verification` chunks emitted by the post-generation
   * verification arm (Master.md §12.5.3). Lets the UI badge a calibrated turn
   * and lets audits score the exit gate (sanitize / calibrate / decline).
   */
  readonly verification?: {
    readonly action: 'pass' | 'sanitize' | 'calibrate' | 'decline';
    /** Typed-grounding classification: grounded / ungrounded / contradicted / complementary. */
    readonly grounding?: 'grounded' | 'ungrounded' | 'contradicted' | 'complementary';
    readonly reasons: readonly string[];
    readonly calibrationNote?: string;
  };
  /**
   * Vai-native "thinking" trace for the turn (Vai is a deterministic engine, not
   * an LLM — this is the strategy chain it actually walked, not token reasoning).
   * Attached to the `done` chunk so the UI can render an expandable panel and
   * flag intent/strategy mismatches (misroutes).
   */
  readonly thinking?: TurnThinking;
  /**
   * Image-generation activity for an image-output turn. `image_progress` streams the
   * produce→verify→regenerate steps so the UI shows real work (not a spinner); `image_result`
   * carries the final image. Fields are only set on those chunk types.
   */
  readonly image?: {
    /** 'produce' | 'verify' | 'regenerate' | 'final' | 'declined' */
    readonly phase: string;
    /** Human label for the step ("Generating…", "Auditing image (attempt 2)…"). */
    readonly label?: string;
    /** Current attempt number (1-based). */
    readonly attempt?: number;
    /** Verifier match score 0..1, when known. */
    readonly matchScore?: number;
    /** Flaws the verifier flagged on this attempt. */
    readonly flaws?: readonly string[];
    /** Final image as a data URL (set on image_result). */
    readonly dataUrl?: string;
    readonly width?: number;
    readonly height?: number;
    /** Whether the final image met the accept threshold. */
    readonly accepted?: boolean;
  };
}

/**
 * The observable decision trace for one Vai turn. Canonical shape shared by the
 * WS protocol and (future) HTTP/gRPC/agent-JSON skins — the "one structured
 * turn, many transports" contract.
 */
export interface TurnThinking {
  /** Classified question intent (action-yesno | definition | factual-lookup | build | meta | other). */
  readonly intent: string;
  /** Winning strategy; may be a teacher-loop chain like "a->b->c". */
  readonly strategy: string;
  /** `strategy` split into ordered steps — the chain Vai walked. */
  readonly strategyChain: readonly string[];
  /** Provenance/trust badge for the answer. */
  readonly trustBadge?: string;
  /** 0–1 confidence in the answer. */
  readonly confidence?: number;
  /** Primary topic Vai detected. */
  readonly topic?: string;
  /** How deep Vai's knowledge is on this topic. */
  readonly knowledgeDepth?: 'deep' | 'shallow' | 'none';
  /** Detected conversational register of the user's input. */
  readonly register?: string;
  /** Turn latency in milliseconds. */
  readonly durationMs?: number;
  /** Cumulative deterministic process checkpoints for this turn. */
  readonly processTrace?: readonly TurnProcessTraceStage[];
  /**
   * The scored routing decision for this turn — surfaced so friends (human
   * and AI) can SEE why Vai answered the way it did, and steer it. Present on
   * deterministic dispatched turns.
   */
  readonly routePlan?: TurnRoutePlan;
  /**
   * The SCIS consensus council's ephemeral view of this turn — who reviewed the
   * draft, the consensus (ship/act/escalate), the read intent, and what method
   * was missing. Present when a council convened. Carries no member-authored
   * facts (see docs/capabilities/scis-consensus-council.md).
   */
  readonly council?: CouncilThinking;
}

export interface TurnProcessTraceStage {
  readonly stage: string;
  readonly durationMs: number;
  /** Authentic per-step fact (e.g. "single question", "deep knowledge · matched \"greeting\""). */
  readonly detail?: string;
}

/** A friend-readable record of how the scored dispatcher chose its answer. */
export interface TurnRoutePlan {
  /** Winning handler, or null when nothing cleared the confidence floor. */
  readonly chosen: string | null;
  /** True when no candidate cleared the floor — an honest "I don't know". */
  readonly belowFloor: boolean;
  /** Candidates ranked best→worst, each with its fit and outcome. */
  readonly candidates: readonly TurnRouteCandidate[];
}

export interface TurnRouteCandidate {
  readonly name: string;
  /** Fit 0..1 after any friend guidance was applied. */
  readonly score: number;
  /** Fit 0..1 before friend guidance — shows how a hint moved the value. */
  readonly baseScore?: number;
  /** This candidate won the turn. */
  readonly chosen: boolean;
  /** Scored high enough but declined — couldn't ground its answer. */
  readonly declined: boolean;
  /** Friend guidance note that moved this candidate's score, if any. */
  readonly guidance?: string;
  /** Why this handler valued the turn as it did — the reviewable rationale. */
  readonly reason?: string;
  /**
   * A shadow candidate is SCORED and shown for comparison but never decides the
   * turn — it is a Capability-Kernel candidate running alongside the live
   * handlers so its scoring can be observed on real turns before it is trusted
   * to route. The live decision is unaffected.
   */
  readonly shadow?: boolean;
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
