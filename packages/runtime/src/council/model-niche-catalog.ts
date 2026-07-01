/**
 * model-niche-catalog — map a local model's id/name to the council topic it is STRONGEST at.
 *
 * The roster used to assign specialist topics positionally (member index 2 → 'factual',
 * member 3 → 'reasoning'), ignoring what the model actually is — so a coding model could be
 * seated as the factual specialist. This catalog fixes that: when a niche model is present
 * (DeepSeek-R1 for reasoning, a Qwen/DeepSeek-Coder for code, etc.), it auto-seats on its
 * strength. Generic models fall back to the positional spread. Pure + data-driven so adding a
 * model later is a one-line catalog entry, not a code change.
 *
 * Nothing here pulls or requires a model — it only classifies the ones already registered in
 * Ollama. The actual `ollama pull` of a specialist is a deliberate (large, VRAM-heavy) user
 * action; this just ensures it lands in the right seat the moment it exists.
 */

import type { CouncilTopic } from '@vai/core';

/** A catalog entry: a name pattern → the topic that model is trusted for, with a short why. */
interface NicheEntry {
  readonly test: RegExp;
  readonly topic: CouncilTopic;
  readonly note: string;
}

/**
 * Ordered most-specific-first. The first matching entry wins, so put precise model families
 * before broad ones. Patterns match against the lowercased adapter id (e.g. "local:deepseek-r1:8b").
 */
const CATALOG: readonly NicheEntry[] = [
  { test: /deepseek-?r1|deepseek-?reason/, topic: 'reasoning', note: 'DeepSeek-R1 — first-principles + edge-case reasoning' },
  { test: /devstral|codestral|coder|code-?(?:llama|gemma|qwen|stral)|starcoder/, topic: 'code', note: 'Code-specialist model — repo/code reasoning' },
  { test: /qwen.*coder|qwen2\.5-coder|qwen3-coder/, topic: 'code', note: 'Qwen coder variant — code specialist' },
  { test: /qwq|magistral|mistral-?small|mixtral|mistral-?nemo/, topic: 'reasoning', note: 'Reasoning-specialist local model — structured critique / tradeoffs' },
  { test: /dolphin|abliterat|uncensored/, topic: 'reasoning', note: 'Uncensored model — edge-case explorer (still fact-quarantined)' },
  { test: /gemma/, topic: 'factual', note: 'Gemma — dense factual/summary reasoning' },
  { test: /llava|bakllava|vision|moondream|minicpm-?v/, topic: 'factual', note: 'Vision model — image/factual verification' },
];

/**
 * The best council topic for a model id, or null when it has no known niche (a generalist;
 * the caller then uses its positional fallback). `null` is intentional — not every model is a
 * specialist.
 */
export function nicheTopicForModel(modelId: string): { topic: CouncilTopic; note: string } | null {
  const id = (modelId || '').toLowerCase();
  for (const entry of CATALOG) {
    if (entry.test.test(id)) return { topic: entry.topic, note: entry.note };
  }
  return null;
}

/** True when the model id is a recognized niche specialist (has a catalog entry). */
export function isNicheSpecialist(modelId: string): boolean {
  return nicheTopicForModel(modelId) !== null;
}
