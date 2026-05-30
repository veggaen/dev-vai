import type { Message } from '../models/adapter.js';

/**
 * Contextual follow-up resolver.
 *
 * The engine routes each turn as if it were standalone, so a follow-up with a
 * referential pronoun ("how many people live THERE?", "is IT bigger than X?",
 * "would you recommend using ONE?") loses its antecedent and gets web-searched
 * literally — producing confident, irrelevant garbage. This rewrites such turns
 * against the active topic BEFORE routing, e.g.:
 *   "how many people live there?"  + topic "Oslo" -> "how many people live in Oslo?"
 *   "would you recommend using one?" + topic "VPN" -> "would you recommend using a VPN?"
 *
 * Pure + conservative: only fires on short follow-ups with a clear referential
 * pronoun and a known topic, and never when the topic is already present.
 */

const QUESTION_START = /^(?:how|what|which|when|where|why|who|whom|whose|is|are|was|were|does|do|did|can|could|will|would|should|has|have|had|tell|give|explain|and)\b/i;

// Place referents → "in <topic>"; thing referents → "<topic>"; "one" → "a <topic>".
const PLACE_REF = /\bthere\b/i;
const THING_REF = /\b(?:it|its|it's|that|this|they|them|those|these)\b/i;
const ONE_REF = /\bone\b/i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lastAssistantText(history: readonly Message[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) return m.content.trim();
  }
  return '';
}

/** Clean a bolded entity for substitution: "VPN (Virtual Private Network)" -> "VPN". */
export function cleanTopic(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[*_`]/g, '')
    .replace(/[:.,!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rewrite a short pronoun follow-up against `topic`. Returns the rewritten
 * standalone question, or null when it should be left alone.
 */
export function rewritePronounFollowUp(input: string, topic: string): string | null {
  if (typeof input !== 'string' || typeof topic !== 'string') return null;
  const trimmed = input.trim();
  const cleanedTopic = cleanTopic(topic);
  if (!trimmed || !cleanedTopic || cleanedTopic.length < 2) return null;

  const words = trimmed.split(/\s+/);
  if (words.length > 14) return null;                 // long turns are standalone
  if (!QUESTION_START.test(trimmed)) return null;     // must look like a follow-up question
  // Imperative build/action requests ("can you make it for me?", "build it now",
  // "do it") use "it" to mean "the thing we're building" — the builder handles
  // those directly, so don't rewrite them into a factual question.
  if (/^(?:can|could|would|will|please)\s+(?:you\s+)?(?:please\s+)?(?:make|build|create|do|show|give|write|generate|design|add|fix|help|set\s*up|scaffold|deploy|run|ship|render)\b|^(?:make|build|create|do|show|give|write|generate|design|add|fix|run|ship|render|please)\b/i.test(trimmed)) {
    return null;
  }
  if (new RegExp(`\\b${escapeRegex(cleanedTopic)}\\b`, 'i').test(trimmed)) return null; // already named

  const topicRe = new RegExp(`\\b${escapeRegex(cleanedTopic)}\\b`, 'i');
  const restHasOtherProperNoun = /\b[A-Z][a-z]{2,}\b/.test(trimmed.replace(/^[A-Z]/, '')); // keep for callers; not used to block

  // "there" (place) -> "in <topic>"  ("how many people live there?" -> "... in Oslo?")
  if (PLACE_REF.test(trimmed)) {
    const out = trimmed.replace(PLACE_REF, `in ${cleanedTopic}`);
    return topicRe.test(out) ? out : `${out.replace(/[?.!]+$/, '')} (about ${cleanedTopic})?`;
  }
  // "one" -> "a <topic>"  ("would you recommend using one?" -> "... using a VPN?")
  if (ONE_REF.test(trimmed)) {
    return trimmed.replace(ONE_REF, `a ${cleanedTopic}`);
  }
  // it/that/this/they/them -> "<topic>"  ("is it bigger than X?" -> "is <topic> bigger than X?")
  if (THING_REF.test(trimmed)) {
    return trimmed.replace(THING_REF, cleanedTopic);
  }

  // Bare follow-up with no pronoun but clearly partial (very short) -> attach topic.
  if (words.length <= 6 && !restHasOtherProperNoun) {
    return `${trimmed.replace(/[?.!]+$/, '')} (about ${cleanedTopic})?`;
  }
  return null;
}

const NAME_NON_NAMES = /^(?:asking|here|not|sure|good|fine|trying|looking|wondering|just|going|done|back|okay|ok|sorry|curious|happy|glad|new|the|a|an)$/i;

/**
 * The user's stated name. Scans user turns for "i'm X" / "i am X" /
 * "my name is X" / "call me X".
 */
export function detectUserName(history: readonly Message[]): string | null {
  const NAME = /\b(?:i'?m|i am|my name is|my name's|call me|this is|it'?s)\s+([A-Z][a-z]{1,20})(?:\b|$)/;
  const NAME_LOOSE = /\b(?:i'?m|i am|my name is|call me)\s+([a-z][a-z]{1,20})\b/i;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m.role !== 'user' || typeof m.content !== 'string' || !m.content.trim()) continue;
    const hit = m.content.match(NAME) || m.content.match(NAME_LOOSE);
    if (hit) {
      const name = hit[1].trim();
      if (NAME_NON_NAMES.test(name)) continue;
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  return null;
}

/**
 * Detect a "recall what I told you" question and the attribute being recalled.
 * Dynamic, not name-only: "what was my name", "what's my job", "what is my
 * favorite color", "who am i" (→ name), "remind me my X", "do you remember my X".
 */
export function detectRecallQuestion(input: string): { attribute: string } | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (/\bwho\s+am\s+i\b/i.test(text)) return { attribute: 'name' };
  const m = text.match(
    /\b(?:what(?:'s| is| was| were)?|remind\s+me(?:\s+of)?|do\s+you\s+(?:remember|know|recall)|tell\s+me)\s+(?:what\s+)?(?:is\s+|was\s+)?my\s+([a-z][a-z'\s-]{1,30}?)(?:\s+again)?\s*\??\s*$/i,
  );
  if (m) {
    const attribute = m[1].toLowerCase().replace(/\s+/g, ' ').trim();
    if (attribute) return { attribute };
  }
  return null;
}

/** Find a value the user stated for `attribute` ("my <attribute> is <value>"). */
export function recallUserAttribute(history: readonly Message[], attribute: string): string | null {
  const attr = attribute.toLowerCase().trim();
  if (attr === 'name') return detectUserName(history);

  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\bmy\\s+${escaped}\\s+(?:is|was|'s)\\s+([^.?!,;]{1,40})`, 'i');
  // Also "i'm a <role>" / "i work as a <role>" when asking about job/role/work.
  // Require the article so "i'm a teacher" matches but "i'm Vetle" (a name)
  // does not get mistaken for a role.
  const isRoleAttr = /\b(job|role|work|profession|occupation|title)\b/.test(attr);
  const roleRe = /\bi(?:'?m| am)\s+an?\s+([a-z][a-z\s-]{2,30}?)(?:[.?!,;]|$)|\bi\s+work\s+as\s+an?\s+([a-z][a-z\s-]{2,30}?)(?:[.?!,;]|$)/i;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m.role !== 'user' || typeof m.content !== 'string' || !m.content.trim()) continue;
    const hit = m.content.match(re) || (isRoleAttr ? m.content.match(roleRe) : null);
    if (hit) {
      const value = (hit[1] ?? hit[2] ?? '').trim().replace(/\s+/g, ' ');
      if (value && !NAME_NON_NAMES.test(value)) return value;
    }
  }
  return null;
}

/**
 * Answer a conversation-recall question from history, or honestly say it wasn't
 * shared. Returns null when the input is not a recall question.
 */
export function recallFromConversation(input: string, history: readonly Message[]): string | null {
  const q = detectRecallQuestion(input);
  if (!q) return null;
  const value = recallUserAttribute(history, q.attribute);
  return value
    ? `Your ${q.attribute} is **${value}**.`
    : `You haven't told me your ${q.attribute} yet — tell me and I'll remember it for this chat.`;
}

/** Convenience: resolve a follow-up using the topic inferred from the last assistant turn's bold entity. */
export function inferBoldTopic(history: readonly Message[]): string | null {
  const text = lastAssistantText(history);
  const m = /\*\*([^*]{2,60})\*\*/.exec(text);
  if (!m) return null;
  const t = cleanTopic(m[1]);
  return t.length >= 2 ? t : null;
}
