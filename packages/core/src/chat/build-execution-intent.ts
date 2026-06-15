import type { ConversationMode } from './modes.js';
import { isProductEngineeringPlanningPrompt } from './product-engineering-intent.js';

const EXPLICIT_BUILD_REQUEST =
  /^(?:now\s+)?(?:(?:can|could|would|will)\s+you\s+|please\s+|let['']s\s+)?(?:make|build|create|generate|design|develop|scaffold|start|spin\s*up|launch|ship|prototype)\b|\b(?:i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to)\s+(?:make|build|create|generate|design|develop|scaffold|start|spin\s*up|launch|ship|prototype)\b/i;

const EXPLICIT_BUILD_TARGET =
  /\b(?:app|application|project|site|website|dashboard|tool|mvp|workspace|shell|preview|page|landing|portfolio|gallery|blog|clone|files?|runnable)\b/i;

const SHIP_RUNNABLE =
  /\b(?:ship\s+complete|runnable\s+files?|complete\s+runnable|install\s+dependencies|title=["'][^"']+["']|```[\s\S]*title=)\b/i;

const NAMED_PRODUCT_CLONE =
  /\b(?:tinder|twitter|x\.com|instagram|facebook|spotify|netflix|airbnb|uber|youtube|tiktok|reddit|discord|slack|notion|trello|pinterest|whatsapp|telegram|snapchat|twitch|ebay|etsy|duolingo|strava|hinge|bumble)\b|\bclone\b/i;

export function isBuildExecutionMode(mode: ConversationMode): boolean {
  return mode === 'builder' || mode === 'agent';
}

/** User asked to ship runnable output now — not planning/advice. */
export function isExplicitBuildExecutionRequest(content: string): boolean {
  const text = (content || '').trim();
  if (!text || isProductEngineeringPlanningPrompt(text)) return false;
  if (SHIP_RUNNABLE.test(text)) return true;
  if (!EXPLICIT_BUILD_REQUEST.test(text)) return false;
  return EXPLICIT_BUILD_TARGET.test(text) || NAMED_PRODUCT_CLONE.test(text);
}

/**
 * A short, information-seeking question — "what is the price of btc", "who is the PM of
 * Norway", "when was X founded", "how much is Y", "what's the latest version of Z". These
 * are FACTUAL/ANALYSIS turns that must be ANSWERED, never turned into a code build, even in
 * builder/agent mode. This is the anti-hijack guard for the failure where a price question
 * became a 260-second HTML-widget build: a factual ask + no explicit build verb means the
 * builder lane is off-limits for this turn, regardless of mode.
 *
 * Deliberately scoped: it only fires on clearly interrogative, information-seeking phrasing
 * AND requires the absence of any explicit build request, so "build me a dashboard that
 * shows what the price of btc is" (a real build) is NOT caught.
 */
const FACTUAL_QUESTION_LEAD =
  /^\s*(?:what(?:'s| is| are| was| were)?|who(?:'s| is| are| was| were)?|when(?:'s| is| was| did)?|where(?:'s| is| are)?|which|how (?:much|many|old|far|long|tall|big)|how (?:do(?:es)?|did|to)\b(?!\s+(?:i|we|you)?\s*(?:make|build|create|generate))|why|whose|is|are|was|were|does|do|did|can|could|will|would)\b/i;
/** Short, fresh/real-time data asks — price, score, weather, latest, current value. */
const FRESH_DATA_LEAD =
  /\b(?:price|cost|worth|value|rate|exchange\s+rate|score|weather|temperature|forecast|latest|current(?:ly)?|right\s+now|today|this\s+(?:week|month|year)|how\s+much\s+(?:is|does|are)|stock\s+price|market\s+cap)\b/i;

/** Any build/make/create verb anywhere — catches "how do I build X", "help me make Y". */
const BUILD_VERB_ANYWHERE = /\b(?:build|make|create|generate|scaffold|develop|implement|code|design|spin\s*up|set\s*up|add|write)\b/i;

export function looksLikeFactualQuestion(content: string): boolean {
  const text = (content || '').trim();
  if (!text) return false;
  // An explicit build request is never "just a question".
  if (isExplicitBuildExecutionRequest(text)) return false;
  // Any build/make/create verb anywhere disqualifies it (so "how do I build a price
  // widget" is a build question, not a fresh-data lookup, despite containing "price").
  if (EXPLICIT_BUILD_REQUEST.test(text) || BUILD_VERB_ANYWHERE.test(text)) return false;
  // Interrogative lead OR a fresh-data ask, AND reasonably short (real questions are).
  const wordCount = text.split(/\s+/).length;
  const interrogative = FACTUAL_QUESTION_LEAD.test(text) || text.endsWith('?');
  const freshData = FRESH_DATA_LEAD.test(text);
  return (interrogative || freshData) && wordCount <= 40;
}
