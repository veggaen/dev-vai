/**
 * VeggaAI Configuration Loader
 *
 * Reads environment variables and produces a typed, validated VaiConfig.
 * Every value has a sane default so Vai works out of the box with zero config.
 * External providers activate automatically when their API key is set.
 *
 * Usage:
 *   import { loadConfig } from './config/index.js';
 *   const config = loadConfig();  // reads process.env
 */

import { isConversationMode } from '../chat/modes.js';
import type { VaiConfig, ProviderConfig, ProviderId, PlatformAuthConfig, ChatPromptRewriteConfig } from './types.js';

export type { VaiConfig, ProviderConfig, ProviderId, ModelProfile, ModelCapabilities, ModelCost, RoutingRule, FallbackChain, PlatformAuthConfig, PlatformAuthProviderConfig, GoogleOAuthConfig, ChatPromptRewriteConfig, ChatPromptRewriteProfile, ChatPromptRewriteResponseDepth, ChatPromptRewriteRulesConfig } from './types.js';
export { MODEL_PROFILES, getModelProfile, getProviderProfiles, listModelIds } from './model-profiles.js';

// ── Helpers ──

function envStr(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return env[key]?.trim() || fallback;
}

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function envBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim()?.toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function envCsv(env: NodeJS.ProcessEnv, key: string, fallback: readonly string[]): string[] {
  const raw = env[key]?.trim();
  if (!raw) return [...fallback];
  return raw.split(',').map((value) => value.trim()).filter(Boolean);
}

function envEnum<T extends string>(
  env: NodeJS.ProcessEnv,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function firstEnv(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

// ── Provider Detection ──

function buildProvider(id: ProviderId, env: NodeJS.ProcessEnv): ProviderConfig {
  switch (id) {
    case 'vai':
      return { id: 'vai', enabled: true }; // always available

    case 'anthropic': {
      const apiKey = env.ANTHROPIC_API_KEY?.trim();
      return {
        id: 'anthropic',
        apiKey,
        baseUrl: env.ANTHROPIC_BASE_URL?.trim(),
        defaultModel: env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-20250514',
        enabled: !!apiKey,
      };
    }

    case 'openai': {
      const apiKey = env.OPENAI_API_KEY?.trim();
      return {
        id: 'openai',
        apiKey,
        baseUrl: env.OPENAI_BASE_URL?.trim(),
        defaultModel: env.OPENAI_MODEL?.trim() || 'gpt-4o',
        enabled: !!apiKey,
      };
    }

    case 'google': {
      const apiKey = env.GOOGLE_API_KEY?.trim();
      return {
        id: 'google',
        apiKey,
        baseUrl: env.GOOGLE_BASE_URL?.trim(),
        defaultModel: env.GOOGLE_MODEL?.trim() || 'gemini-2.5-flash',
        enabled: !!apiKey,
      };
    }

    case 'local':
      return {
        id: 'local',
        baseUrl: env.LOCAL_MODEL_URL?.trim() || 'http://localhost:11434',
        defaultModel: env.LOCAL_MODEL?.trim(),
        enabled: !!env.LOCAL_MODEL_URL?.trim(),
      };
  }
}

// ── Default Routing ──

function buildDefaultModel(providers: Record<ProviderId, ProviderConfig>, env: NodeJS.ProcessEnv): string {
  // User override
  const explicit = env.VAI_DEFAULT_MODEL?.trim();
  if (explicit) return explicit;

  // Smart default: prefer Anthropic > OpenAI > Google > vai:v0
  if (providers.anthropic.enabled) {
    return `anthropic:${providers.anthropic.defaultModel}`;
  }
  if (providers.openai.enabled) {
    return `openai:${providers.openai.defaultModel}`;
  }
  if (providers.google.enabled) {
    return `google:${providers.google.defaultModel}`;
  }
  return 'vai:v0';
}

function buildFallbackChain(providers: Record<ProviderId, ProviderConfig>): string[] {
  const chain: string[] = [];
  // Add enabled provider defaults in quality order
  if (providers.anthropic.enabled) chain.push(`anthropic:${providers.anthropic.defaultModel}`);
  if (providers.openai.enabled) chain.push(`openai:${providers.openai.defaultModel}`);
  if (providers.google.enabled) chain.push(`google:${providers.google.defaultModel}`);
  // vai:v0 is always the last resort
  chain.push('vai:v0');
  return chain;
}

function buildPlatformAuthConfig(env: NodeJS.ProcessEnv): PlatformAuthConfig {
  const port = envInt(env, 'VAI_PORT', 3006);
  const publicUrl = envStr(env, 'VAI_PUBLIC_URL', `http://localhost:${port}`);
  const appUrl = env.VAI_APP_URL?.trim() || undefined;
  const googleClientId = firstEnv(env, ['GOOGLE_WEB_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID']);
  const googleClientSecret = firstEnv(env, ['GOOGLE_WEB_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_SECRET']);
  const googleEnabled = !!(googleClientId && googleClientSecret);
  const enabled = envBool(env, 'VAI_PLATFORM_AUTH_ENABLED', googleEnabled);

  return {
    enabled,
    publicUrl,
    appUrl,
    sessionCookieName: envStr(env, 'VAI_SESSION_COOKIE_NAME', 'vai_session'),
    sessionTtlHours: envInt(env, 'VAI_SESSION_TTL_HOURS', 24 * 30),
    sessionSecret: envStr(env, 'VAI_SESSION_SECRET', 'vai-dev-session-secret-change-me'),
    providers: {
      google: {
        enabled: googleEnabled,
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        scopes: (env.GOOGLE_OAUTH_SCOPES?.trim() || 'openid,email,profile')
          .split(',')
          .map((scope) => scope.trim())
          .filter(Boolean),
      },
    },
  };
}

function buildChatPromptRewriteConfig(env: NodeJS.ProcessEnv): ChatPromptRewriteConfig {
  const fallbackModes = ['chat', 'agent', 'builder', 'plan', 'debate'];
  const applyToModes = envCsv(env, 'VAI_CHAT_PROMPT_REWRITE_MODES', fallbackModes).filter(isConversationMode);

  return {
    enabled: envBool(env, 'VAI_ENABLE_CHAT_PROMPT_REWRITE', true),
    strategy: 'system-message',
    profile: envEnum(env, 'VAI_CHAT_PROMPT_REWRITE_PROFILE', ['light', 'standard', 'strict'] as const, 'standard'),
    responseDepth: envEnum(env, 'VAI_CHAT_PROMPT_REWRITE_RESPONSE_DEPTH', ['standard', 'deep-design-memo'] as const, 'standard'),
    applyToModes: applyToModes.length > 0 ? applyToModes : fallbackModes.filter(isConversationMode),
    maxUserMessageChars: Math.max(200, envInt(env, 'VAI_CHAT_PROMPT_REWRITE_MAX_USER_MESSAGE_CHARS', 2_200)),
    rules: {
      disambiguateRepoContext: envBool(env, 'VAI_CHAT_PROMPT_REWRITE_RULE_REPO_CONTEXT', true),
      groundPredictivePrefetch: envBool(env, 'VAI_CHAT_PROMPT_REWRITE_RULE_PREDICTIVE_PREFETCH', true),
      groundAnswerEngine: envBool(env, 'VAI_CHAT_PROMPT_REWRITE_RULE_ANSWER_ENGINE', true),
      hardenArchitectureSketches: envBool(env, 'VAI_CHAT_PROMPT_REWRITE_RULE_ARCHITECTURE', true),
    },
  };
}

// ── Main Loader ──

export function loadConfig(env: NodeJS.ProcessEnv = process.env): VaiConfig {
  const providers: Record<ProviderId, ProviderConfig> = {
    vai: buildProvider('vai', env),
    anthropic: buildProvider('anthropic', env),
    openai: buildProvider('openai', env),
    google: buildProvider('google', env),
    local: buildProvider('local', env),
  };

  const platformAuth = buildPlatformAuthConfig(env);
  const chatPromptRewrite = buildChatPromptRewriteConfig(env);

  return {
    // Server
    port: envInt(env, 'VAI_PORT', 3006),
    dbPath: envStr(env, 'VAI_DB_PATH', './vai.db'),
    dbDriver: envStr(env, 'VAI_DB_DRIVER', 'sqlite') as 'sqlite' | 'postgres',
    databaseUrl: env.DATABASE_URL?.trim(),

    // Providers
    providers,

    // Model Selection
    defaultModelId: buildDefaultModel(providers, env),
    fallbackChain: { models: buildFallbackChain(providers) },
    routingRules: [
      // Default routing — can be overridden by VAI_ROUTING_RULES env (future)
      { condition: 'default', modelId: buildDefaultModel(providers, env) },
    ],

    // Limits
    maxMonthlySpend: envInt(env, 'VAI_MAX_MONTHLY_SPEND', 0),
    maxTokensPerRequest: envInt(env, 'VAI_MAX_TOKENS_PER_REQUEST', 16_000),
    maxConcurrentRequests: envInt(env, 'VAI_MAX_CONCURRENT_REQUESTS', 5),

    // Sandbox
    maxSandboxes: envInt(env, 'VAI_MAX_SANDBOXES', 5),
    sandboxDocker: envBool(env, 'VAI_SANDBOX_DOCKER', false),

    // Auth
    ownerEmail: envStr(env, 'VAI_OWNER_EMAIL', 'v3ggat@gmail.com'),
    apiKeys: (env.VAI_API_KEYS?.trim() || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
    authEnabled: envBool(env, 'VAI_AUTH_ENABLED', !!(env.VAI_API_KEYS?.trim())),
    rateLimitPerMinute: envInt(env, 'VAI_RATE_LIMIT_PER_MINUTE', 60),
    platformAuth,
    allowedOrigins: env.VAI_ALLOWED_ORIGINS?.trim()
      ? env.VAI_ALLOWED_ORIGINS.trim().split(',').map((o) => o.trim()).filter(Boolean)
      : undefined,
    chatPromptRewrite,

    // Features
    enableToolCalling: envBool(env, 'VAI_ENABLE_TOOL_CALLING', true),
    maxToolIterations: envInt(env, 'VAI_MAX_TOOL_ITERATIONS', 10),
    enableUsageTracking: envBool(env, 'VAI_ENABLE_USAGE_TRACKING', true),
    enableEval: envBool(env, 'VAI_ENABLE_EVAL', false),

    // Quality Gate
    qualityGate: {
      enabled: envBool(env, 'VAI_QUALITY_GATE', false),
      confidenceThreshold: parseFloat(env.VAI_QUALITY_GATE_THRESHOLD || '0.5'),
      provider: (env.VAI_QUALITY_GATE_PROVIDER?.trim() as ProviderId | undefined) || undefined,
      model: env.VAI_QUALITY_GATE_MODEL?.trim() || undefined,
      timeoutMs: envInt(env, 'VAI_QUALITY_GATE_TIMEOUT', 5000),
      skipStrategies: (env.VAI_QUALITY_GATE_SKIP || 'empty,gibberish,keyboard-noise,math,binary,conversational,scaffold,url-request').split(',').map(s => s.trim()),
    },
  };
}

/**
 * Print a human-readable diagnostic of the loaded config.
 * Called at server startup so the operator knows what's active.
 */
export function printConfigDiagnostic(config: VaiConfig): void {
  const lines: string[] = ['[VAI] Configuration:'];

  // Providers
  const providerIds: ProviderId[] = ['vai', 'anthropic', 'openai', 'google', 'local'];
  for (const id of providerIds) {
    const p = config.providers[id];
    const status = p.enabled ? '✓ enabled' : '✗ disabled';
    const detail = p.enabled && p.defaultModel ? ` (${p.defaultModel})` : '';
    const keyInfo = p.apiKey ? ' [key set]' : '';
    lines.push(`  ${id.padEnd(10)} ${status}${detail}${keyInfo}`);
  }

  // Routing
  lines.push(`  default model: ${config.defaultModelId}`);
  lines.push(`  fallback chain: ${config.fallbackChain.models.join(' → ')}`);

  // Features
  lines.push(`  tool calling: ${config.enableToolCalling ? 'ON' : 'OFF'} (max ${config.maxToolIterations} iterations)`);
  lines.push(`  usage tracking: ${config.enableUsageTracking ? 'ON' : 'OFF'}`);
  lines.push(`  chat prompt rewrite: ${config.chatPromptRewrite.enabled ? `ON (${config.chatPromptRewrite.profile}, ${config.chatPromptRewrite.responseDepth}, ${config.chatPromptRewrite.applyToModes.join(', ')})` : 'OFF'}`);
  lines.push(`  auth: ${config.authEnabled ? `ON (${config.apiKeys.length} key${config.apiKeys.length !== 1 ? 's' : ''}, ${config.rateLimitPerMinute}/min)` : 'OFF (local-only)'}`);
  lines.push('  owner gate: VAI_OWNER_EMAIL (set in env; default if unset)');
  lines.push(`  platform auth: ${config.platformAuth.enabled ? `ON (${Object.entries(config.platformAuth.providers).filter(([, provider]) => provider.enabled).map(([id]) => id).join(', ') || 'configured providers pending'})` : 'OFF'}`);
  if (config.maxMonthlySpend > 0) {
    lines.push(`  monthly spend cap: $${config.maxMonthlySpend}`);
  }

  // Quality Gate
  const qg = config.qualityGate;
  if (qg.enabled) {
    lines.push(`  quality gate: ON (threshold: ${qg.confidenceThreshold}, timeout: ${qg.timeoutMs}ms${qg.provider ? `, provider: ${qg.provider}` : ', auto-detect'})`);
  } else {
    lines.push('  quality gate: OFF');
  }

  console.log(lines.join('\n'));
}
