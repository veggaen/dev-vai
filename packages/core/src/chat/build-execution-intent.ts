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
 * Three-band build intent for AGENT mode. The old binary "build verb + target word → scaffold an
 * app" silently hijacked plain asks ("can you make this more useful", "tell me a story about X")
 * into 260-second builds. This grades the intent so agent mode can CONFIRM before building when it
 * is unsure, instead of guessing:
 *
 *  - 'build'     → ship-now phrasing or a clear new-app/clone request. Go straight to the builder.
 *  - 'ambiguous' → a build-ish verb but no clear app target, OR a question wrapper around a verb.
 *                  Agent mode should ask one short confirm ("answer this, or build an app for it?").
 *  - 'answer'    → a question / discussion / fresh-fact lookup. Never build.
 *
 * This is intent classification only — no side effects. The confirm UX lives in the desktop layer.
 */
export type AgentBuildIntent = 'build' | 'ambiguous' | 'answer';

/** Verbs that, on their own, only HINT at a build (improve/update/change/add) vs. ship a new app. */
const SOFT_BUILD_VERB = /\b(?:improve|update|change|tweak|adjust|enhance|refine|fix|edit|modify|extend|refactor|polish|add|implement|wire|hook\s+up)\b/i;
/** Clearly conversational / non-build asks even if they contain a stray verb. */
const CONVERSATIONAL_LEAD = /^\s*(?:tell me|write me|explain|describe|summari[sz]e|what|who|when|where|why|which|how (?:much|many|do|does|did|to)|is|are|was|were|can you (?:explain|tell|help|describe)|help me understand|i('?m| am) (?:asking|wondering|curious)|just (?:asking|wondering|curious))\b/i;

export function classifyAgentBuildIntent(content: string): AgentBuildIntent {
  const text = (content || '').trim();
  if (!text) return 'answer';
  // Strongest signal: explicit ship-now / new-app / clone request. Always build.
  if (isExplicitBuildExecutionRequest(text)) return 'build';
  // Planning/advice and fresh-fact questions are never builds (reuse existing guards).
  if (isProductEngineeringPlanningPrompt(text)) return 'answer';
  if (looksLikeFactualQuestion(text)) return 'answer';

  const hasHardBuildVerb = EXPLICIT_BUILD_REQUEST.test(text);
  const hasSoftBuildVerb = SOFT_BUILD_VERB.test(text);
  const hasTarget = EXPLICIT_BUILD_TARGET.test(text) || NAMED_PRODUCT_CLONE.test(text);
  const isQuestion = text.endsWith('?');

  // A clear build verb AND a clear app target, phrased as a request (not a question) → build.
  if (hasHardBuildVerb && hasTarget && !isQuestion) return 'build';
  // A build verb wrapped in a QUESTION or clearly conversational lead is a discussion *about*
  // building ("explain how I would build a price widget"), not a build → answer.
  if (isQuestion && hasSoftBuildVerb) return 'answer';
  // A build-ish verb that is neither a clean build request nor conversational is the real hijack
  // case: a verb without a target ("improve the timeline ui", "can you make this more useful") →
  // ambiguous, so agent mode confirms before building.
  if ((hasHardBuildVerb || hasSoftBuildVerb) && !isQuestion) return 'ambiguous';
  // No build verb at all (plain prose/discussion, even if it doesn't start with a lead word) → answer.
  return 'answer';
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
  /\b(?:price|cost|worth|value|rate|exchange\s+rate|score|weather|temperature|forecast|latest|current(?:ly)?|right\s+now|now|tonight|today|this\s+(?:week|month|year)|this\s+(?:morning|afternoon|evening)|how\s+much\s+(?:is|does|are)|stock\s+price|market\s+cap|up[\s-]to[\s-]date)\b/i;

/** Any build/make/create verb anywhere — catches "how do I build X", "help me make Y". */
const BUILD_VERB_ANYWHERE = /\b(?:build|make|create|generate|scaffold|develop|implement|code|design|spin\s*up|set\s*up|add|write)\b/i;

export function looksLikeFactualQuestion(content: string): boolean {
  const text = (content || '').trim();
  if (!text) return false;
  // An explicit build request is never "just a question".
  if (isExplicitBuildExecutionRequest(text)) return false;
  // Interrogative lead OR a fresh-data ask, AND reasonably short (real questions are).
  const wordCount = text.split(/\s+/).length;
  const interrogative = FACTUAL_QUESTION_LEAD.test(text) || text.endsWith('?');
  // A build/make/create verb anywhere disqualifies it (so "how do I build a price widget"
  // is a build question, not a fresh-data lookup) — EXCEPT when the text is a clean
  // interrogative that merely *mentions* a build gerund ("what's a great idea when CREATING
  // a company in Norway?"). Imperative build asks ("how do I build X") are caught by
  // EXPLICIT_BUILD_REQUEST / FACTUAL exclusion below, so the question form stays factual.
  // This is the fix for the Norway opportunity question that "creating" wrongly disqualified.
  if (EXPLICIT_BUILD_REQUEST.test(text)) return false;
  if (BUILD_VERB_ANYWHERE.test(text) && !interrogative) return false;
  const freshData = FRESH_DATA_LEAD.test(text);
  return (interrogative || freshData) && wordCount <= 40;
}
