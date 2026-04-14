/**
 * VeggaAI Model Profiles — Known Model Catalog
 *
 * Pre-defined profiles for every model Vai knows about. When a new provider
 * is configured, these profiles tell the system what each model can do,
 * how fast it is, and what it costs.
 *
 * These are reference data — they don't create adapters. Adapters use these
 * profiles to advertise their capabilities to the routing layer.
 *
 * Updated: March 2026
 */

import type { ModelProfile } from './types.js';

// ── Anthropic Models ──

const CLAUDE_OPUS_4: ModelProfile = {
  id: 'anthropic:claude-opus-4-20250514',
  provider: 'anthropic',
  modelName: 'claude-opus-4-20250514',
  displayName: 'Claude Opus 4',
  description: 'Most capable model. Deep reasoning, complex analysis, creative writing.',
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  capabilities: {
    streaming: true,
    toolUse: true,
    vision: true,
    extendedThinking: true,
    embeddings: false,
    structuredOutput: true,
    systemPrompts: true,
    multiTurn: true,
  },
  cost: { inputPer1M: 15, outputPer1M: 75, cachedInputPer1M: 1.5 },
  speedTier: 'slow',
  qualityTier: 'flagship',
};

const CLAUDE_SONNET_4: ModelProfile = {
  id: 'anthropic:claude-sonnet-4-20250514',
  provider: 'anthropic',
  modelName: 'claude-sonnet-4-20250514',
  displayName: 'Claude Sonnet 4',
  description: 'Best balance of intelligence and speed. Strong at code and reasoning.',
  contextWindow: 200_000,
  maxOutputTokens: 16_000,
  capabilities: {
    streaming: true,
    toolUse: true,
    vision: true,
    extendedThinking: true,
    embeddings: false,
    structuredOutput: true,
    systemPrompts: true,
    multiTurn: true,
  },
  cost: { inputPer1M: 3, outputPer1M: 15, cachedInputPer1M: 0.3 },
  speedTier: 'medium',
  qualityTier: 'balanced',
};

const CLAUDE_HAIKU_35: ModelProfile = {
  id: 'anthropic:claude-3-5-haiku-20241022',
  provider: 'anthropic',
  modelName: 'claude-3-5-haiku-20241022',
  displayName: 'Claude 3.5 Haiku',
  description: 'Fastest Claude model. Great for simple tasks, tool dispatch, and high-volume.',
  contextWindow: 200_000,
  maxOutputTokens: 8_192,
  capabilities: {
    streaming: true,
    toolUse: true,
    vision: true,
    extendedThinking: false,
    embeddings: false,
    structuredOutput: true,
    systemPrompts: true,
    multiTurn: true,
  },
  cost: { inputPer1M: 0.8, outputPer1M: 4, cachedInputPer1M: 0.08 },
  speedTier: 'fast',
  qualityTier: 'fast',
};

// ── OpenAI Models ──

const GPT_4O: ModelProfile = {
  id: 'openai:gpt-4o',
  provider: 'openai',
  modelName: 'gpt-4o',
  displayName: 'GPT-4o',
  description: 'OpenAI flagship. Multimodal, fast, strong at code.',
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  capabilities: {
    streaming: true,
    toolUse: true,
    vision: true,
    extendedThinking: false,
    embeddings: false,
    structuredOutput: true,
    systemPrompts: true,
    multiTurn: true,
  },
  cost: { inputPer1M: 2.5, outputPer1M: 10, cachedInputPer1M: 1.25 },
  speedTier: 'fast',
  qualityTier: 'balanced',
};

const GPT_4O_MINI: ModelProfile = {
  id: 'openai:gpt-4o-mini',
  provider: 'openai',
  modelName: 'gpt-4o-mini',
  displayName: 'GPT-4o Mini',
  description: 'Lightweight and fast. Good for simple tasks.',
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  capabilities: {
    streaming: true,
    toolUse: true,
    vision: true,
    extendedThinking: false,
    embeddings: false,
    structuredOutput: true,
    systemPrompts: true,
    multiTurn: true,
  },
  cost: { inputPer1M: 0.15, outputPer1M: 0.6, cachedInputPer1M: 0.075 },
  speedTier: 'fast',
  qualityTier: 'fast',
};

const O3: ModelProfile = {
  id: 'openai:o3',
  provider: 'openai',
  modelName: 'o3',
  displayName: 'o3',
  description: 'OpenAI reasoning model. Strong at math, science, code.',
  contextWindow: 200_000,
  maxOutputTokens: 100_000,
  capabilities: {
    streaming: true,
    toolUse: true,
    vision: true,
    extendedThinking: true,
    embeddings: false,
    structuredOutput: true,
    systemPrompts: true,
    multiTurn: true,
  },
  cost: { inputPer1M: 2, outputPer1M: 8, cachedInputPer1M: 0.5 },
  speedTier: 'slow',
  qualityTier: 'flagship',
};

// ── Google Models ──

const GEMINI_25_PRO: ModelProfile = {
  id: 'google:gemini-2.5-pro',
  provider: 'google',
  modelName: 'gemini-2.5-pro',
  displayName: 'Gemini 2.5 Pro',
  description: 'Google flagship. Large context, reasoning, multimodal.',
  contextWindow: 1_000_000,
  maxOutputTokens: 65_536,
  capabilities: {
    streaming: true,
    toolUse: true,
    vision: true,
    extendedThinking: true,
    embeddings: false,
    structuredOutput: true,
    systemPrompts: true,
    multiTurn: true,
  },
  cost: { inputPer1M: 1.25, outputPer1M: 10 },
  speedTier: 'medium',
  qualityTier: 'balanced',
};

const GEMINI_25_FLASH: ModelProfile = {
  id: 'google:gemini-2.5-flash',
  provider: 'google',
  modelName: 'gemini-2.5-flash',
  displayName: 'Gemini 2.5 Flash',
  description: 'Fast and cheap. Thinking optional. Good for volume.',
  contextWindow: 1_000_000,
  maxOutputTokens: 65_536,
  capabilities: {
    streaming: true,
    toolUse: true,
    vision: true,
    extendedThinking: true,
    embeddings: false,
    structuredOutput: true,
    systemPrompts: true,
    multiTurn: true,
  },
  cost: { inputPer1M: 0.15, outputPer1M: 0.6 },
  speedTier: 'fast',
  qualityTier: 'fast',
};

// ── VeggaAI Local ──

const VAI_V0: ModelProfile = {
  id: 'vai:v0',
  provider: 'vai',
  modelName: 'v0',
  displayName: 'VeggaAI v0',
  description: 'Vai\'s own engine. N-gram + pattern matching. Zero-cost, instant, offline.',
  contextWindow: 4_096,
  maxOutputTokens: 2_048,
  capabilities: {
    streaming: true,
    toolUse: false,
    vision: false,
    extendedThinking: false,
    embeddings: false,
    structuredOutput: false,
    systemPrompts: false,
    multiTurn: true,
  },
  cost: { inputPer1M: 0, outputPer1M: 0 },
  speedTier: 'fast',
  qualityTier: 'local',
};

// ── Full Catalog ──

export const MODEL_PROFILES: ReadonlyMap<string, ModelProfile> = new Map([
  // Anthropic
  [CLAUDE_OPUS_4.id, CLAUDE_OPUS_4],
  [CLAUDE_SONNET_4.id, CLAUDE_SONNET_4],
  [CLAUDE_HAIKU_35.id, CLAUDE_HAIKU_35],
  // OpenAI
  [GPT_4O.id, GPT_4O],
  [GPT_4O_MINI.id, GPT_4O_MINI],
  [O3.id, O3],
  // Google
  [GEMINI_25_PRO.id, GEMINI_25_PRO],
  [GEMINI_25_FLASH.id, GEMINI_25_FLASH],
  // VeggaAI
  [VAI_V0.id, VAI_V0],
]);

/** Get all profiles for a given provider */
export function getProviderProfiles(provider: string): ModelProfile[] {
  return Array.from(MODEL_PROFILES.values()).filter((p) => p.provider === provider);
}

/** Get a specific model profile by ID, or undefined */
export function getModelProfile(id: string): ModelProfile | undefined {
  return MODEL_PROFILES.get(id);
}

/** List all available model IDs */
export function listModelIds(): string[] {
  return Array.from(MODEL_PROFILES.keys());
}
