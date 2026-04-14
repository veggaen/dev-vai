import type { ConversationMode } from '../chat/modes.js';

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

// ── Platform Auth ──

export interface PlatformAuthProviderConfig {
  readonly enabled: boolean;
}

export interface GoogleOAuthConfig extends PlatformAuthProviderConfig {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly scopes: readonly string[];
}

export interface PlatformAuthConfig {
  /** Whether platform user auth is enabled at all */
  readonly enabled: boolean;
  /** Public runtime URL used for OAuth callback construction */
  readonly publicUrl: string;
  /** Preferred app URL used for post-login redirects */
  readonly appUrl?: string;
  /** Cookie name for platform sessions */
  readonly sessionCookieName: string;
  /** Session lifetime in hours */
  readonly sessionTtlHours: number;
  /** Secret used for session token hashing and auth state integrity */
  readonly sessionSecret: string;
  /** Enabled platform auth providers */
  readonly providers: {
    readonly google: GoogleOAuthConfig;
  };
}

export interface ChatPromptRewriteRulesConfig {
  /** Disambiguate repository context from frontend Context/provider concepts */
  readonly disambiguateRepoContext: boolean;
  /** Ground predictive prefetch asks in repository signals and fallback retrieval */
  readonly groundPredictivePrefetch: boolean;
  /** Ground abstract answer-engine asks in retrieval/indexing architecture */
  readonly groundAnswerEngine: boolean;
  /** Ask for concrete architecture sections instead of vague slogans */
  readonly hardenArchitectureSketches: boolean;
}

export type ChatPromptRewriteProfile = 'light' | 'standard' | 'strict';

export type ChatPromptRewriteResponseDepth = 'standard' | 'deep-design-memo';

export interface ChatPromptRewriteConfig {
  /** Enable conservative prompt hardening for ambiguous repo-native asks */
  readonly enabled: boolean;
  /** Current implementation strategy — kept explicit for future expansion */
  readonly strategy: 'system-message';
  /** Named hardening profile so operators can tune how forcefully ambiguity is corrected */
  readonly profile: ChatPromptRewriteProfile;
  /** Requested response depth for repo-native architecture answers */
  readonly responseDepth: ChatPromptRewriteResponseDepth;
  /** Conversation modes where hardening may run */
  readonly applyToModes: readonly ConversationMode[];
  /** Skip rewriting very large messages to avoid over-processing long prompts */
  readonly maxUserMessageChars: number;
  /** Fine-grained rule toggles */
  readonly rules: ChatPromptRewriteRulesConfig;
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
  /** Platform owner email — gates owner-only features (e.g. allowLearn). Env: VAI_OWNER_EMAIL */
  readonly ownerEmail: string;
  /** API keys that grant access (empty = open / local-only) */
  readonly apiKeys: readonly string[];
  /** Whether API-key auth is enforced (auto-enabled when apiKeys is non-empty) */
  readonly authEnabled: boolean;
  /** Per-key rate limit (requests per minute), 0 = unlimited */
  readonly rateLimitPerMinute: number;
  /** Platform user auth and OAuth settings */
  readonly platformAuth: PlatformAuthConfig;

  /** Conservative prompt hardening for ambiguous repo-native questions */
  readonly chatPromptRewrite: ChatPromptRewriteConfig;

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
