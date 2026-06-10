/**
 * Topic router — decides which niche a turn belongs to, so the council convenes
 * the members trusted for that subject (RouteLLM / NVIDIA-llm-router style).
 *
 * Deliberately lightweight and deterministic: a fast signal pass, no model call.
 * The roster maps each topic to its members; a model-backed router can replace
 * `routeTopic` later without touching `selectMembers` or the council.
 */

import type { CouncilMember, CouncilTopic } from './types.js';

const CODE_PATTERN =
  /\b(?:code|function|bug|error|stack\s?trace|compile|typescript|javascript|python|rust|api|regex|async|null\s?pointer|segfault|npm|git|docker|sql)\b|```/i;

const LOCAL_PATTERN =
  /\b(?:near\s?me|nearby|open\s?now|phone\s?number|number\s+for|call|contact|address|opening\s?hours|restaurants?|caf[eé]s?|pizza|hotels?|shops?|bars?|in\s+[A-Z][\p{L}]+)\b/iu;

const FACTUAL_PATTERN =
  /\b(?:who|what|when|where|which|how\s+many|capital\s+of|population|price|latest|current|today|news|weather|score|release\s?date)\b/i;

const REASONING_PATTERN =
  /\b(?:why|explain|compare|difference\s+between|pros?\s+and\s+cons?|trade[\s-]?offs?|should\s+i|prove|derive|reason|step\s+by\s+step)\b/i;

const CREATIVE_PATTERN =
  /\b(?:write|draft|compose|poem|story|tagline|name\s+ideas|brainstorm|rewrite|make\s+it\s+sound)\b/i;

const CHITCHAT_PATTERN =
  /^\s*(?:hi|hey|hello|yo|sup|thanks?|thank\s+you|lol|ok(?:ay)?|cool|nice|good\s?(?:morning|night|evening))\b|^\s*\S{1,3}\s*$/i;

/** Classify a turn into a council topic. Conservative: falls back to `other`. */
export function routeTopic(input: string): CouncilTopic {
  const text = (input ?? '').trim();
  if (!text) return 'other';
  // Order matters: code and local intents are specific and should win over the
  // broad factual/reasoning patterns that their words also trip.
  if (CODE_PATTERN.test(text)) return 'code';
  if (LOCAL_PATTERN.test(text)) return 'local';
  if (CREATIVE_PATTERN.test(text)) return 'creative';
  if (REASONING_PATTERN.test(text)) return 'reasoning';
  if (FACTUAL_PATTERN.test(text)) return 'factual';
  if (CHITCHAT_PATTERN.test(text)) return 'chitchat';
  return 'other';
}

/** Per-topic member rosters, with a default applied when a topic has no roster. */
export interface CouncilRoster {
  readonly byTopic?: Partial<Record<CouncilTopic, readonly CouncilMember[]>>;
  /** Members convened when the topic has no specific roster (or to always include). */
  readonly default: readonly CouncilMember[];
}

/**
 * Pick the members for a topic: the topic-specific roster if present, else the
 * default. De-dupes by id so an always-on member listed in both isn't doubled.
 */
export function selectMembers(topic: CouncilTopic, roster: CouncilRoster): CouncilMember[] {
  const specific = roster.byTopic?.[topic] ?? [];
  const merged = [...specific, ...roster.default];
  const seen = new Set<string>();
  const out: CouncilMember[] = [];
  for (const member of merged) {
    if (seen.has(member.id)) continue;
    seen.add(member.id);
    out.push(member);
  }
  return out;
}
