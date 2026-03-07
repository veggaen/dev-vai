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

import type { VaiConfig, ProviderConfig, ProviderId } from './types.js';

export type { VaiConfig, ProviderConfig, ProviderId, ModelProfile, ModelCapabilities, ModelCost, RoutingRule, FallbackChain } from './types.js';
export { MODEL_PROFILES, getModelProfile, getProviderProfiles, listModelIds } from './model-profiles.js';

// ── Helpers ──

function envStr(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim()?.toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
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

function buildDefaultModel(providers: Record<ProviderId, ProviderConfig>): string {
  // User override
  const explicit = process.env.VAI_DEFAULT_MODEL?.trim();
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

// ── Main Loader ──

export function loadConfig(env: NodeJS.ProcessEnv = process.env): VaiConfig {
  const providers: Record<ProviderId, ProviderConfig> = {
    vai: buildProvider('vai', env),
    anthropic: buildProvider('anthropic', env),
    openai: buildProvider('openai', env),
    google: buildProvider('google', env),
    local: buildProvider('local', env),
  };

  const enabledProviders = Object.values(providers).filter((p) => p.enabled);

  return {
    // Server
    port: envInt('VAI_PORT', 3006),
    dbPath: envStr('VAI_DB_PATH', './vai.db'),
    dbDriver: envStr('VAI_DB_DRIVER', 'sqlite') as 'sqlite' | 'postgres',
    databaseUrl: env.DATABASE_URL?.trim(),

    // Providers
    providers,

    // Model Selection
    defaultModelId: buildDefaultModel(providers),
    fallbackChain: { models: buildFallbackChain(providers) },
    routingRules: [
      // Default routing — can be overridden by VAI_ROUTING_RULES env (future)
      { condition: 'default', modelId: buildDefaultModel(providers) },
    ],

    // Limits
    maxMonthlySpend: envInt('VAI_MAX_MONTHLY_SPEND', 0),
    maxTokensPerRequest: envInt('VAI_MAX_TOKENS_PER_REQUEST', 16_000),
    maxConcurrentRequests: envInt('VAI_MAX_CONCURRENT_REQUESTS', 5),

    // Sandbox
    maxSandboxes: envInt('VAI_MAX_SANDBOXES', 5),
    sandboxDocker: envBool('VAI_SANDBOX_DOCKER', false),

    // Auth
    apiKeys: (env.VAI_API_KEYS?.trim() || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
    authEnabled: envBool('VAI_AUTH_ENABLED', !!(env.VAI_API_KEYS?.trim())),
    rateLimitPerMinute: envInt('VAI_RATE_LIMIT_PER_MINUTE', 60),

    // Features
    enableToolCalling: envBool('VAI_ENABLE_TOOL_CALLING', true),
    maxToolIterations: envInt('VAI_MAX_TOOL_ITERATIONS', 10),
    enableUsageTracking: envBool('VAI_ENABLE_USAGE_TRACKING', true),
    enableEval: envBool('VAI_ENABLE_EVAL', false),
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
  lines.push(`  auth: ${config.authEnabled ? `ON (${config.apiKeys.length} key${config.apiKeys.length !== 1 ? 's' : ''}, ${config.rateLimitPerMinute}/min)` : 'OFF (local-only)'}`);
  if (config.maxMonthlySpend > 0) {
    lines.push(`  monthly spend cap: $${config.maxMonthlySpend}`);
  }

  console.log(lines.join('\n'));
}
