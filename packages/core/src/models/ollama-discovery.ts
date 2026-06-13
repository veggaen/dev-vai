/**
 * Ollama model auto-discovery (future-proof local model registration).
 *
 * Instead of hardcoding one model name + invented capabilities, ask the local
 * Ollama daemon what is actually installed (`/api/tags`) and what each model
 * can really do (`/api/show` → context length, thinking/tools/vision flags).
 * New models then Just Work after `ollama pull` + restart — no code changes —
 * and the registry never advertises a model that is not installed.
 *
 * Pure parsing/ranking helpers are separated from the fetch layer so they can
 * be unit-tested without a live daemon.
 */

import type { ModelProfile } from '../config/types.js';

export interface DiscoveredOllamaModel {
  /** Ollama model name as pullable/runnable, e.g. "qwen3:8b". */
  readonly name: string;
  readonly sizeBytes: number;
  /** Parameter count in billions parsed from details (e.g. "8.2B" → 8.2). */
  readonly parameterB: number | null;
  /** Real context window from model metadata, when reported. */
  readonly contextWindow: number | null;
  /** Capability flags reported by `/api/show` (newer Ollama daemons). */
  readonly thinking: boolean;
  readonly toolUse: boolean;
  readonly vision: boolean;
  readonly embedding: boolean;
}

interface OllamaTagsPayload {
  models?: ReadonlyArray<{
    name?: string;
    size?: number;
    details?: { parameter_size?: string };
  }>;
}

interface OllamaShowPayload {
  capabilities?: readonly string[];
  model_info?: Record<string, unknown>;
  details?: { parameter_size?: string };
}

/** "8.2B" / "3B" / "7.6b" → billions as a number; null when unparseable. */
export function parseParameterSize(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = /^([\d.]+)\s*([bm])$/i.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return match[2].toLowerCase() === 'm' ? value / 1000 : value;
}

/**
 * Extract the real context window from `/api/show` model_info, which keys it
 * by architecture (e.g. "qwen3.context_length"). Architecture-agnostic scan so
 * future model families need no code change.
 */
export function extractContextWindow(modelInfo: Record<string, unknown> | undefined): number | null {
  if (!modelInfo) return null;
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) {
      return value;
    }
  }
  return null;
}

export function parseDiscoveredModel(
  tag: { name?: string; size?: number; details?: { parameter_size?: string } },
  show: OllamaShowPayload | null,
): DiscoveredOllamaModel | null {
  const name = tag.name?.trim();
  if (!name) return null;
  const capabilities = show?.capabilities ?? [];
  return {
    name,
    sizeBytes: tag.size ?? 0,
    parameterB: parseParameterSize(show?.details?.parameter_size ?? tag.details?.parameter_size),
    contextWindow: extractContextWindow(show?.model_info),
    thinking: capabilities.includes('thinking'),
    toolUse: capabilities.includes('tools'),
    vision: capabilities.includes('vision'),
    embedding: capabilities.includes('embedding'),
  };
}

/**
 * Rank chat-capable models best-first for "which installed model should answer
 * when the configured one is missing": more parameters wins (capability), then
 * larger on-disk size as a tiebreaker. Embedding-only models are excluded.
 */
export function rankDiscoveredModels(models: readonly DiscoveredOllamaModel[]): DiscoveredOllamaModel[] {
  return models
    .filter((m) => !m.embedding)
    .slice()
    .sort((a, b) => (b.parameterB ?? 0) - (a.parameterB ?? 0) || b.sizeBytes - a.sizeBytes);
}

/** Build a registry profile from a discovered model's real metadata. */
export function buildDiscoveredModelProfile(model: DiscoveredOllamaModel): ModelProfile {
  return {
    id: `local:${model.name}`,
    provider: 'local',
    modelName: model.name,
    displayName: `Local ${model.name}`,
    description: 'Ollama local model (auto-discovered)',
    contextWindow: model.contextWindow ?? 32768,
    maxOutputTokens: 8192,
    capabilities: {
      streaming: false,
      toolUse: model.toolUse,
      vision: model.vision,
      extendedThinking: model.thinking,
      embeddings: model.embedding,
      structuredOutput: false,
      systemPrompts: true,
      multiTurn: true,
    },
    cost: { inputPer1M: 0, outputPer1M: 0 },
    speedTier: (model.parameterB ?? 8) <= 4 ? 'fast' : 'medium',
    qualityTier: 'local',
  };
}

/**
 * Patch the configured fallback chain against what is actually registered:
 * configured-but-uninstalled `local:*` entries are replaced by the best
 * installed local model (rank order), so escalation still reaches a real
 * generative backend instead of silently degrading to vai:v0-only.
 */
export function resolveEffectiveLocalChain(
  chain: readonly string[],
  rankedLocalIds: readonly string[],
): string[] {
  const installed = new Set(rankedLocalIds);
  const out: string[] = [];
  let replaced = false;
  for (const id of chain) {
    if (id.startsWith('local:') && !installed.has(id)) {
      if (!replaced && rankedLocalIds.length > 0 && !chain.includes(rankedLocalIds[0])) {
        out.push(rankedLocalIds[0]);
      }
      replaced = true;
      continue;
    }
    out.push(id);
  }
  return out.filter((id, index) => out.indexOf(id) === index);
}

export interface DiscoverOllamaOptions {
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Query the Ollama daemon for installed models + per-model capabilities.
 * Returns null when the daemon is unreachable (caller falls back to static
 * registration); per-model `/api/show` failures degrade to tag-only metadata.
 */
export async function discoverOllamaModels(
  baseUrl: string,
  options?: DiscoverOllamaOptions,
): Promise<DiscoveredOllamaModel[] | null> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 3_000;
  const base = baseUrl.replace(/\/$/, '');
  try {
    const tagsRes = await fetchImpl(`${base}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!tagsRes.ok) return null;
    const tags = await tagsRes.json() as OllamaTagsPayload;
    const entries = tags.models ?? [];
    const discovered: DiscoveredOllamaModel[] = [];
    for (const tag of entries) {
      let show: OllamaShowPayload | null = null;
      try {
        const showRes = await fetchImpl(`${base}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: tag.name }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (showRes.ok) show = await showRes.json() as OllamaShowPayload;
      } catch {
        // tag-only metadata is still useful
      }
      const model = parseDiscoveredModel(tag, show);
      if (model) discovered.push(model);
    }
    return discovered;
  } catch {
    return null;
  }
}
