import type { Message } from '../models/adapter.js';
import { isPureConversationalTurn } from '../models/web-conclude-policy.js';

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

// Imperative / fragment follow-ups that still refer back ("got a link to his profiles").
const FOLLOW_UP_FRAGMENT = /^(?:got|any|share|show|give|look|link)\b/i;
const PROFILE_LINK_CUE = /\b(?:profile|profiles|link|links|url|website|social|linkedin|twitter|instagram|facebook)\b/i;

// Place referents → "in <topic>"; thing referents → "<topic>"; "one" → "a <topic>".
const PLACE_REF = /\bthere\b/i;
const THING_REF = /\b(?:it|its|it's|that|this|they|them|those|these)\b/i;
const ONE_REF = /\bone\b/i;
const POSSESSIVE_REF = /\b(?:his|her|their)\b/i;
// A REFINEMENT of the prior answer ("make that simpler", "can you make it clearer", "explain that
// more simply") — uses make/keep/rewrite + a refinement adjective. These read like build imperatives
// but carry NO buildable target; they ask to redo the LAST answer differently, so the referent must
// be resolved to the topic (not handed to the builder). This was the followup/context-carry miss.
const REFINEMENT_REQUEST =
  /\b(?:simpler|clearer|shorter|longer|briefer|more\s+(?:simply|clearly|concise(?:ly)?|detail(?:ed)?|thorough(?:ly)?)|less\s+technical|in\s+plain\s+(?:english|terms)|eli5|dumb(?:ed)?\s+down|tl;?dr)\b/i;

const PRIOR_ENTITY_PATTERNS = [
  /\bwho\s+(?:is|are|was|were)\s+(.+?)\??\s*$/i,
  /\bwhat\s+(?:do\s+you\s+know\s+about|is)\s+(.+?)\??\s*$/i,
  /\btell\s+me\s+about\s+(.+?)\??\s*$/i,
] as const;

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

export interface AssistantContactDetail {
  readonly entity: string;
  readonly phone: string;
}

const CONTACT_QUERY_NOISE = new Set([
  'what', 'was', 'is', 'the', 'phone', 'number', 'telephone', 'contact', 'to', 'for',
  'of', 'at', 'from', 'please', 'tell', 'give', 'me', 'again', 'online', 'web', 'find',
  'look', 'search', 'check', 'verify', 'it', 'that', 'this', 'you', 'should',
]);

function normalizeLookupText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function orderedSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function extractPhone(value: string): string | null {
  const match = value.match(/(?:\+?\d[\d ()-]{5,}\d)/);
  if (!match) return null;
  const phone = match[0].replace(/\s+/g, ' ').trim();
  return (phone.match(/\d/g)?.length ?? 0) >= 7 ? phone : null;
}

function extractAssistantContactDetails(history: readonly Message[]): AssistantContactDetail[] {
  const details: AssistantContactDetail[] = [];
  const seen = new Set<string>();

  const add = (entity: string, phoneCandidate: string): void => {
    const cleanedEntity = cleanTopic(entity);
    const phone = extractPhone(phoneCandidate);
    if (!cleanedEntity || !phone) return;
    const key = `${normalizeLookupText(cleanedEntity)}:${phone.replace(/\D/g, '')}`;
    if (seen.has(key)) return;
    seen.add(key);
    details.push({ entity: cleanedEntity, phone });
  };

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message.role !== 'assistant' || typeof message.content !== 'string' || !message.content.trim()) continue;

    for (const line of message.content.split(/\n+/)) {
      const boldEntity = /\*\*([^*\n]{2,100})\*\*/.exec(line);
      const phoneLabel = /\bPhone:\s*((?:\+?\d[\d ()-]{5,}\d))/i.exec(line);
      if (boldEntity?.[1] && phoneLabel?.[1]) {
        add(boldEntity[1], phoneLabel[1]);
      }

      const prose = /\bphone\s+number\s+for\s+(.{2,100}?)\s+is\s+((?:\+?\d[\d ()-]{5,}\d))/i.exec(line);
      if (prose?.[1] && prose?.[2]) {
        add(prose[1], prose[2]);
      }
    }
  }

  return details;
}

function matchAssistantContactDetail(
  input: string,
  details: readonly AssistantContactDetail[],
): AssistantContactDetail | null {
  if (details.length === 0) return null;
  const normalizedInput = normalizeLookupText(input);
  const compactInput = normalizedInput.replace(/\s+/g, '');
  const queryTokens = normalizedInput
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !CONTACT_QUERY_NOISE.has(token));

  if (queryTokens.length === 0) {
    return details.length === 1 ? details[0] : null;
  }

  const ranked = details.map((detail) => {
    const normalizedEntity = normalizeLookupText(detail.entity);
    const compactEntity = normalizedEntity.replace(/\s+/g, '');
    const entityTokens = normalizedEntity.split(/\s+/);
    let score = compactInput.includes(compactEntity) || compactEntity.includes(compactInput) ? 8 : 0;

    for (const token of queryTokens) {
      if (entityTokens.includes(token)) {
        score += 3;
      } else if (token.length >= 4 && compactEntity.includes(token)) {
        score += 2;
      } else if (token.length <= 4 && orderedSubsequence(token, compactEntity)) {
        score += 1;
      }
    }
    return { detail, score };
  }).sort((a, b) => b.score - a.score);

  if ((ranked[0]?.score ?? 0) < 3) return null;
  if (ranked[1] && ranked[1].score === ranked[0].score) return null;
  return ranked[0].detail;
}

/** Recall a public business phone number that was already shown in this chat. */
export function recallAssistantContactDetail(
  input: string,
  history: readonly Message[],
): AssistantContactDetail | null {
  if (!/\b(?:phone|telephone|contact)\b[\s\S]{0,24}\b(?:number|details?)?\b|\bnumber\b[\s\S]{0,20}\b(?:phone|contact)\b/i.test(input)) {
    return null;
  }
  return matchAssistantContactDetail(input, extractAssistantContactDetails(history));
}

/**
 * Carry the requested contact field into an explicit online correction:
 * "find it online pizza bakeren hommersak" after a phone-number question
 * becomes "find the phone number online for Pizzabakeren Hommersak".
 */
export function rewriteBusinessContactLookupFollowUp(
  input: string,
  history: readonly Message[],
): string | null {
  const trimmed = input.trim();
  const explicitOnlineLookup =
    /\b(?:find|look\s+up|search|check|verify)\b[\s\S]{0,35}\b(?:online|web|google)\b/i.test(trimmed)
    || /\b(?:online|web|google)\b[\s\S]{0,35}\b(?:find|look\s+up|search|check|verify)\b/i.test(trimmed);
  if (!explicitOnlineLookup) return null;

  const userMessages = history.filter((message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim());
  let previousUser = '';
  for (let i = userMessages.length - 1; i >= 0; i -= 1) {
    if (normalizeLookupText(userMessages[i].content) === normalizeLookupText(trimmed)) continue;
    previousUser = userMessages[i].content;
    break;
  }
  if (!/\b(?:phone|telephone|contact)\b[\s\S]{0,24}\b(?:number|details?)?\b|\bnumber\b[\s\S]{0,20}\b(?:phone|contact)\b/i.test(previousUser)) {
    return null;
  }

  const subject = trimmed
    .replace(/^(?:yes[,.]?\s*)?(?:you\s+should\s+|please\s+|can\s+you\s+)?/i, '')
    .replace(/^(?:find|look\s+up|search(?:\s+for)?|check|verify)\s+(?:it|that|this)?\s*(?:online|on\s+the\s+web|the\s+web|google)\s*(?:for\s+)?/i, '')
    .replace(/^(?:online|on\s+the\s+web|the\s+web|google)\s*/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();
  if (!subject) return null;

  const canonical = matchAssistantContactDetail(subject, extractAssistantContactDetails(history));
  return `find the phone number online for ${canonical?.entity ?? subject}`;
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
  const hasReferential = PLACE_REF.test(trimmed) || THING_REF.test(trimmed) || ONE_REF.test(trimmed) || POSSESSIVE_REF.test(trimmed);
  // A refinement of the prior answer ("make that simpler") is a contextual follow-up even though it
  // starts with an imperative verb — allow it through alongside questions/possessives/fragments.
  const isRefinement = REFINEMENT_REQUEST.test(trimmed) && hasReferential;
  const allowsRewrite =
    QUESTION_START.test(trimmed)
    || POSSESSIVE_REF.test(trimmed)
    || isRefinement
    || (FOLLOW_UP_FRAGMENT.test(trimmed) && PROFILE_LINK_CUE.test(trimmed));
  if (!allowsRewrite) return null;
  // Imperative build/action requests ("can you make it for me?", "build it now",
  // "do it") use "it" to mean "the thing we're building" — the builder handles
  // those directly, so don't rewrite them into a factual question. EXCEPT a refinement
  // ("make that simpler/clearer/shorter") which redoes the LAST answer, not a build.
  if (!isRefinement && /^(?:can|could|would|will|please)\s+(?:you\s+)?(?:please\s+)?(?:make|build|create|do|show|give|write|generate|design|add|fix|help|set\s*up|scaffold|deploy|run|ship|render)\b|^(?:make|build|create|do|show|give|write|generate|design|add|fix|run|ship|render|please)\b/i.test(trimmed)) {
    return null;
  }
  if (new RegExp(`\\b${escapeRegex(cleanedTopic)}\\b`, 'i').test(trimmed)) return null; // already named

  const topicRe = new RegExp(`\\b${escapeRegex(cleanedTopic)}\\b`, 'i');
  const restHasOtherProperNoun = /\b[A-Z][a-z]{2,}\b/.test(trimmed.replace(/^[A-Z]/, '')); // keep for callers; not used to block

  // Possessive + profile/link follow-ups ("got a link to his profiles?" -> searchable entity query).
  if (POSSESSIVE_REF.test(trimmed) && (PROFILE_LINK_CUE.test(trimmed) || FOLLOW_UP_FRAGMENT.test(trimmed))) {
    return `${cleanedTopic} public profile links social media`;
  }
  if (POSSESSIVE_REF.test(trimmed)) {
    return trimmed.replace(/\b(?:his|her|their)\b/gi, cleanedTopic);
  }
  if (!QUESTION_START.test(trimmed) && !hasReferential) return null;

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

  // Bare follow-up with no pronoun but clearly missing a subject -> attach
  // topic. Do not treat every short lowercase question as contextual:
  // "does spotify have podcasts?" is a complete standalone question.
  if (
    words.length <= 6
    && !restHasOtherProperNoun
    && /^(?:(?:and\s+)?(?:why|when|where|how\s+(?:many|much|big|large|small|old|long|high|tall|far|fast|deep|wide))|(?:what|anything)\s+else)[?.!]*$/i.test(trimmed)
  ) {
    return `${trimmed.replace(/[?.!]+$/, '')} (about ${cleanedTopic})?`;
  }
  return null;
}

const NAME_NON_NAMES = /^(?:asking|here|not|sure|good|fine|fuzzy|unclear|trying|looking|wondering|just|going|done|back|okay|ok|sorry|curious|happy|glad|new|overwhelmed|frustrated|anxious|stressed|exhausted|worried|panicking|struggling|debugging|blocked|stuck|confused|lost|unsure|the|a|an)$/i;

function isCredibleNameMatch(content: string, hit: RegExpMatchArray): boolean {
  const matchedText = hit[0] ?? '';
  if (/\b(?:my\s+name\s+is|my\s+name's|call\s+me|this\s+is)\b/i.test(matchedText)) {
    return true;
  }

  const rawName = hit[1] ?? '';
  const matchEnd = (hit.index ?? 0) + matchedText.length;
  const remainder = content.slice(matchEnd).trim();
  if (!remainder || /^[.!?]+$/.test(remainder)) {
    return true;
  }

  return /^[A-Z]/.test(rawName)
    && /^(?:[,;.!?-]\s*|\b(?:and|but)\b)/i.test(remainder);
}

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
    if (hit && isCredibleNameMatch(m.content, hit)) {
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

/**
 * True when the input is EPISODIC — about this chat or this user (greetings,
 * "i'm X", "my name is", "i'm building Y", small talk) rather than a durable
 * world fact. The learning flywheel uses this to avoid writing conversational
 * content into semantic knowledge, which otherwise pollutes recall over time.
 */
export function isEpisodicOrPersonalInput(input: string): boolean {
  if (typeof input !== 'string') return true;
  const t = input.trim().toLowerCase();
  if (!t) return true;
  // A genuine interrogative or question mark → it's a real question; learn its answer.
  if (/\b(?:who|what|where|when|why|how|which|whose|whom)\b/.test(t) || /\?/.test(t)) return false;
  if (isPureConversationalTurn(input)) return true;
  // Personal self-description (no question) — name, what they're doing, prefs.
  if (/\b(?:i'?m|i\s+am|my\s+name|call\s+me|i'?m\s+building|i'?m\s+working|i\s+(?:like|love|want|need|prefer|have|own|use|hate|enjoy|live|study|build))\b/.test(t)) return true;
  return false;
}

/** Convenience: resolve a follow-up using the topic inferred from the last assistant turn's bold entity. */
export function inferBoldTopic(history: readonly Message[]): string | null {
  const text = lastAssistantText(history);
  const m = /\*\*([^*]{2,60})\*\*/.exec(text);
  if (!m) return null;
  const t = cleanTopic(m[1]);
  return t.length >= 2 ? t : null;
}

/** Infer the entity from the most recent prior user turn ("who is Kristian Salte"). */
export function inferPersonFromPriorTurn(history: readonly Message[]): string | null {
  let skippedCurrentUser = false;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message.role !== 'user' || typeof message.content !== 'string' || !message.content.trim()) continue;
    if (!skippedCurrentUser) {
      skippedCurrentUser = true;
      continue;
    }
    for (const pattern of PRIOR_ENTITY_PATTERNS) {
      const hit = message.content.trim().match(pattern);
      if (hit?.[1]) {
        const topic = cleanTopic(hit[1]);
        if (topic.length >= 2) return topic;
      }
    }
    break;
  }
  return null;
}

/** Best-effort active topic: bold entity from the last answer, else prior who-is ask. */
export function inferActiveTopic(history: readonly Message[]): string | null {
  return inferBoldTopic(history) ?? inferPersonFromPriorTurn(history);
}

/** Rewrite a short contextual follow-up using conversation history. */
export function resolveContextualFollowUp(input: string, history: readonly Message[]): string | null {
  const topic = inferActiveTopic(history);
  if (!topic) return null;
  return rewritePronounFollowUp(input, topic);
}
