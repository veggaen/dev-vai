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
