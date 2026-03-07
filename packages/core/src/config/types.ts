/**
 * VeggaAI Configuration Types
 *
 * Typed configuration for the entire Vai system. Environment variables are
 * parsed and validated into these structures at startup. Provider configs
 * determine which model adapters get auto-registered.
 *
 * Design: every field has a sane default so Vai works out of the box.
 * API keys are the only truly required values for external providers.
 */

// ── Provider Identity ──

export type ProviderId = 'vai' | 'anthropic' | 'openai' | 'google' | 'local';

export interface ProviderConfig {
  /** Which provider this config is for */
  readonly id: ProviderId;
  /** API key (required for cloud providers, ignored for vai/local) */
  readonly apiKey?: string;
  /** Override the default API base URL (for proxies, Azure, etc.) */
  readonly baseUrl?: string;
  /** Default model ID to use for this provider */
  readonly defaultModel?: string;
  /** Whether this provider is enabled (has valid config) */
  readonly enabled: boolean;
}

// ── Model Capabilities ──

export interface ModelCapabilities {
  /** Supports streaming chat responses */
  streaming: boolean;
  /** Supports tool/function calling */
  toolUse: boolean;
  /** Supports image/vision input */
  vision: boolean;
  /** Supports extended thinking / chain-of-thought */
  extendedThinking: boolean;
  /** Supports text embeddings generation */
  embeddings: boolean;
  /** Supports JSON mode / structured output */
  structuredOutput: boolean;
  /** Supports system prompts */
  systemPrompts: boolean;
  /** Supports multi-turn conversations */
  multiTurn: boolean;
}

// ── Model Cost ──

export interface ModelCost {
  /** Cost per 1M input tokens (USD) */
  inputPer1M: number;
  /** Cost per 1M output tokens (USD) */
  outputPer1M: number;
  /** Cost per 1M tokens for cached input (USD), if supported */
  cachedInputPer1M?: number;
}

// ── Model Profile ──

export interface ModelProfile {
  /** Unique identifier: "provider:model" (e.g., "anthropic:claude-sonnet-4-20250514") */
  readonly id: string;
  /** Provider this model belongs to */
  readonly provider: ProviderId;
  /** Provider-specific model name (e.g., "claude-sonnet-4-20250514") */
  readonly modelName: string;
  /** Human-readable display name */
  readonly displayName: string;
  /** Short description of the model's strengths */
  readonly description: string;
  /** Context window size in tokens */
  readonly contextWindow: number;
  /** Maximum output tokens */
  readonly maxOutputTokens: number;
  /** What this model can do */
  readonly capabilities: ModelCapabilities;
  /** Pricing information */
  readonly cost: ModelCost;
  /** Speed tier: fast (< 20 tok/s), medium (20-60), fast (60+) */
  readonly speedTier: 'fast' | 'medium' | 'slow';
  /** Quality tier for routing decisions */
  readonly qualityTier: 'flagship' | 'balanced' | 'fast' | 'local';
}

// ── Routing ──

export interface RoutingRule {
  /** When to use this model */
  readonly condition: 'default' | 'complex' | 'simple' | 'code' | 'creative' | 'tool-heavy';
  /** Model profile ID to route to */
  readonly modelId: string;
}

export interface FallbackChain {
  /** Ordered list of model IDs to try. First available wins. */
  readonly models: string[];
}

// ── Main Config ──

export interface VaiConfig {
  // ── Server ──
  readonly port: number;
  readonly dbPath: string;
  readonly dbDriver: 'sqlite' | 'postgres';
  readonly databaseUrl?: string;

  // ── Providers ──
  readonly providers: Record<ProviderId, ProviderConfig>;

  // ── Model Selection ──
  /** The default model for new conversations */
  readonly defaultModelId: string;
  /** Fallback chain: if primary model fails, try these in order */
  readonly fallbackChain: FallbackChain;
  /** Routing rules for smart model selection */
  readonly routingRules: RoutingRule[];

  // ── Limits & Safety ──
  /** Maximum monthly spend (USD) — 0 = unlimited */
  readonly maxMonthlySpend: number;
  /** Maximum tokens per single request */
  readonly maxTokensPerRequest: number;
  /** Maximum concurrent requests per provider */
  readonly maxConcurrentRequests: number;

  // ── Sandbox ──
  readonly maxSandboxes: number;
  readonly sandboxDocker: boolean;

  // ── Auth ──
  /** API keys that grant access (empty = open / local-only) */
  readonly apiKeys: readonly string[];
  /** Whether API-key auth is enforced (auto-enabled when apiKeys is non-empty) */
  readonly authEnabled: boolean;
  /** Per-key rate limit (requests per minute), 0 = unlimited */
  readonly rateLimitPerMinute: number;

  // ── Features ──
  /** Enable tool calling in chat (requires capable model) */
  readonly enableToolCalling: boolean;
  /** Maximum tool-call iterations per message (prevents infinite loops) */
  readonly maxToolIterations: number;
  /** Enable usage/cost tracking */
  readonly enableUsageTracking: boolean;
  /** Enable eval framework */
  readonly enableEval: boolean;
}
