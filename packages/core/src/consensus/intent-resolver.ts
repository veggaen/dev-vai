/**
 * Stage A — Intent resolution.
 *
 * Before deciding HOW to verify a draft, we must know WHAT the user actually asked for.
 * The old cross-check looked only at Vai's draft and asked "is there a number in it?".
 * That misses the two facts that matter: (1) a "price/cost/worth" question implicitly
 * wants TODAY's value (so a screenshot's stale number is the wrong source), and (2) the
 * SUBJECT of the ask (ETH) is what every candidate number must be anchored to.
 *
 * This module is PURE and deterministic — no model call, no I/O — so it unit-tests fully
 * and runs in microseconds on every turn. Its output drives Stage B (subject-anchored
 * grounding) and Stage C (image path selection).
 */
import { buildEntityMatcher, type EntityMatcher } from '../chat/entity-matcher.js';

/** What kind of value the user is after — drives the comparison strategy in Stage B. */
export type ValueKind = 'price' | 'count' | 'date' | 'entity' | 'none';

/** The resolved reading of a turn's intent. */
export interface ResolvedIntent {
  /** The user wants a CURRENT value (price/now/today) — a stale screenshot is the wrong source. */
  readonly wantsCurrentValue: boolean;
  /** The kind of value the question targets. */
  readonly valueKind: ValueKind;
  /** The primary subject the value is about ("ETH"), or null. Anchors search + matching. */
  readonly subject: string | null;
  /** Lowercased aliases for the subject ("eth","ethereum","ether") — used to filter snippets. */
  readonly subjectAliases: readonly string[];
  /** The user referred to an attached image ("my screenshot", "this picture"). */
  readonly referencesImage: boolean;
  /** referencesImage AND the question needs the image's pixel content to answer. */
  readonly asksToReadImage: boolean;
  /** A specific past date/time was named, so "current value" does NOT apply. */
  readonly hasExplicitPastDate: boolean;
}

// "price of X", "how much is X", "X worth", "cost of X" — value-shaped asks.
const PRICE_RE = /\b(price|cost|worth|how much|market\s?cap|trading at|exchange rate|value of)\b/i;
const COUNT_RE = /\b(how many|number of|count of|population of|total)\b/i;
const DATE_RE = /\b(when|what year|what date|release date|founded|born)\b/i;
const ENTITY_RE = /\b(who is|who's|what is the name|which (?:company|person|tool|model|database))\b/i;

// "now/today/current/latest" — explicit currentness. Price questions are current by default.
const CURRENT_RE = /\b(now|today|currently|current|latest|right now|at the moment|live|as of now)\b/i;

// A specific past time anchor that overrides "current" ("in 2021", "last year", "yesterday").
const PAST_DATE_RE = /\b(in\s+(?:19|20)\d{2}|last\s+(?:year|month|week)|yesterday|back in|(?:19|20)\d{2})\b/i;

// References to an attached image.
const IMAGE_REF_RE = /\b(screenshot|screen\s?shot|this image|the image|my image|this picture|the picture|my picture|this photo|the photo|attached|in the (?:screenshot|image|picture|photo))\b/i;

// Image questions that genuinely need pixel content (read the text / describe / what does it show).
const READ_IMAGE_RE = /\b(what (?:does|is) (?:it|this|that|the (?:image|screenshot|picture|photo)) (?:say|show|contain|display)|read (?:the|this|my|it)|what'?s? in (?:the|this|my)|describe (?:the|this|my|it)|look at (?:the|this|my)|see (?:the|this|my)|(?:image|screenshot|picture|photo) (?:say|show)s?)\b/i;

/** Common crypto/asset aliases so a "price of eth" turn anchors on the whole family. */
const ALIAS_GROUPS: ReadonlyArray<readonly string[]> = [
  ['eth', 'ethereum', 'ether'],
  ['btc', 'bitcoin'],
  ['sol', 'solana'],
  ['doge', 'dogecoin'],
  ['xrp', 'ripple'],
  ['ada', 'cardano'],
  ['bnb', 'binance coin'],
  ['usd', 'dollar', 'dollars'],
];

// One compiled matcher per alias group, built once (was: a fresh `\b…\b` RegExp per
// alias on every extractSubject call — nested over groups × aliases, found by
// scripts/hotpath-scan.mjs). Each group's matcher reports which of its aliases the
// text contains, longest-first, in one pass.
const ALIAS_GROUP_MATCHERS: ReadonlyArray<{ group: readonly string[]; matcher: EntityMatcher }> =
  ALIAS_GROUPS.map((group) => ({ group, matcher: buildEntityMatcher(group) }));

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'you', 'are', 'was', 'has',
  'have', 'can', 'will', 'use', 'using', 'about', 'which', 'what', 'when', 'how', 'why',
  'who', 'price', 'cost', 'worth', 'much', 'many', 'value', 'current', 'today', 'now',
  'screenshot', 'image', 'picture', 'photo', 'look', 'see', 'read', 'tell',
]);

/** Expand a token to its known alias group (lowercased, deduped), or just itself. */
function aliasesFor(token: string): string[] {
  const lower = token.toLowerCase();
  for (const group of ALIAS_GROUPS) {
    if (group.includes(lower)) return [...group];
  }
  return [lower];
}

function classifyValueKind(prompt: string): ValueKind {
  if (PRICE_RE.test(prompt)) return 'price';
  if (COUNT_RE.test(prompt)) return 'count';
  if (DATE_RE.test(prompt)) return 'date';
  if (ENTITY_RE.test(prompt)) return 'entity';
  return 'none';
}

/**
 * Pull the most likely SUBJECT from the prompt: a known asset alias if present (anchored
 * to its whole family), else the first distinctive non-stopword token. Falls back to the
 * draft only when the prompt is pronoun-only ("what is its price?" + an image).
 */
function extractSubject(prompt: string, draft: string): { subject: string | null; aliases: string[] } {
  const text = `${prompt} ${draft}`;
  // 1) Known asset alias anywhere → anchor on the canonical family. One pass per
  // group via the precompiled matcher; matchAll is already longest-first.
  for (const { group, matcher } of ALIAS_GROUP_MATCHERS) {
    const present = matcher.matchAll(text);
    if (present.length === 0) continue;
    // Skip pure currency groups as a subject (USD is the unit, not the subject).
    if (group.includes('usd')) continue;
    const display = present[0] ?? group[0]; // longest present alias (eth → "ETH")
    return { subject: display.toUpperCase().length <= 5 ? display.toUpperCase() : titleCase(display), aliases: [...group] };
  }
  // 2) First distinctive token in the prompt.
  const promptToken = (prompt.match(/\b[A-Za-z][A-Za-z0-9.+-]{1,}\b/g) ?? [])
    .find((w) => !STOPWORDS.has(w.toLowerCase()));
  if (promptToken) return { subject: titleCase(promptToken), aliases: aliasesFor(promptToken) };
  // 3) Pronoun-only prompt — fall back to a distinctive token in the draft.
  const draftToken = (draft.match(/\b[A-Z][A-Za-z0-9.+-]{2,}\b/g) ?? [])
    .find((w) => !STOPWORDS.has(w.toLowerCase()));
  if (draftToken) return { subject: draftToken, aliases: aliasesFor(draftToken) };
  return { subject: null, aliases: [] };
}

function titleCase(s: string): string {
  return s.length <= 4 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Resolve a turn's intent from the user prompt, Vai's draft, and whether an image is attached.
 * Pure; safe to call on every turn.
 */
export function resolveIntent(prompt: string, draft: string, hasImage = false): ResolvedIntent {
  const valueKind = classifyValueKind(prompt);
  const hasExplicitPastDate = PAST_DATE_RE.test(prompt);
  // A price/cost ask is implicitly "today" unless a past date is named; "now/current"
  // makes any value-kind current too.
  const wantsCurrentValue =
    !hasExplicitPastDate &&
    (valueKind === 'price' || ((valueKind === 'count' || valueKind === 'entity') && CURRENT_RE.test(prompt)));

  const referencesImage = hasImage || IMAGE_REF_RE.test(prompt);
  const asksToReadImage = referencesImage && (READ_IMAGE_RE.test(prompt) || valueKind !== 'none');

  const { subject, aliases } = extractSubject(prompt, draft);

  return {
    wantsCurrentValue,
    valueKind,
    subject,
    subjectAliases: aliases,
    referencesImage,
    asksToReadImage,
    hasExplicitPastDate,
  };
}
