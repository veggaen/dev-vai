/**
 * Image-generation intent detection.
 *
 * Decides whether a chat turn wants an IMAGE back (vs text). Two inputs:
 *  1. An explicit user signal (the "Image" input-mode toggle) — when set, it is authoritative:
 *     the response is 100% an image, no detection needed.
 *  2. Otherwise, auto-detect from the message in chat/agent mode via regex/heuristics
 *     ("draw me…", "generate an image of…", "make a picture of…").
 *
 * Pure + deterministic — no model, no I/O — so it unit-tests fully and runs per turn.
 * The explicit toggle ALWAYS wins over auto-detection (per project decision).
 */

export interface ImageIntent {
  /** This turn should be answered with a generated image. */
  readonly wantsImage: boolean;
  /** How we decided: the explicit toggle, an auto-detected phrase, or not at all. */
  readonly source: 'explicit' | 'detected' | 'none';
  /** The extracted subject/description to feed the image generator (best-effort). */
  readonly subject: string;
  /** Confidence in an AUTO-detected intent (1 for explicit). */
  readonly confidence: number;
}

// Strong verbs that, directed at an image noun, clearly request generation.
const GEN_VERB = '(?:draw|generate|create|make|paint|render|design|illustrate|sketch|produce|give me|show me)';
const IMG_NOUN = '(?:an?\\s+)?(?:image|picture|photo|drawing|illustration|art(?:work)?|logo|icon|wallpaper|poster|render|painting|sketch|graphic|portrait|scene)';

// Verbs that ALONE mean "produce an image" even without an image noun ("draw me a cat").
const DRAW_VERB_RE = /\b(?:draw|paint|sketch|illustrate)\s+(?:me\s+)?(?:a|an|the|some|my)\b/i;
// "generate an image of X", "make a picture of Y", "create a logo for Z" (verb + image noun).
const STRONG_RE = new RegExp(`\\b${GEN_VERB}\\b[^.?!]*?\\b${IMG_NOUN}\\b`, 'i');
// "an image of a sunset", "a picture of my dog" — noun-led, slightly weaker.
const NOUN_LED_RE = new RegExp(`\\b${IMG_NOUN}\\s+of\\b`, 'i');
// Explicit imperative shorthand: "imagine a …", "visualize …" used as a draw request.
const IMAGINE_RE = /\b(?:visuali[sz]e|imagine a picture of)\b/i;

// Phrases that look image-y but are NOT generation requests — guard against false positives.
const NEGATIVE_RE = /\b(?:look at|read|analy[sz]e|describe|what'?s in|in this|the attached|my screenshot|explain) (?:the |this |my )?(?:image|picture|photo|screenshot)\b/i;

/** Strip the leading request verb/noun to recover the actual subject to draw. */
function extractSubject(message: string): string {
  let s = message.trim();
  // Remove a leading "<verb> [me] [a/an] [image|picture] [of]" preamble.
  s = s.replace(new RegExp(`^\\s*(?:please\\s+)?${GEN_VERB}\\s+(?:me\\s+)?(?:${IMG_NOUN}\\s+)?(?:of\\s+|that\\s+(?:shows?|depicts?)\\s+)?`, 'i'), '');
  // Or a leading "a picture of" form.
  s = s.replace(new RegExp(`^\\s*${IMG_NOUN}\\s+of\\s+`, 'i'), '');
  s = s.replace(/^\s*(?:please\s+)?(?:visuali[sz]e|imagine a picture of)\s+/i, '');
  return s.trim() || message.trim();
}

/**
 * Resolve image intent. `explicitImageMode` is the input toggle (authoritative when true).
 * `mode` gates auto-detection to chat/agent (not, say, builder). Auto-detect is skipped when a
 * negative phrase ("look at the image") shows the user wants Vai to READ an image, not make one.
 */
export function detectImageIntent(
  message: string,
  options: { explicitImageMode?: boolean; mode?: string } = {},
): ImageIntent {
  if (options.explicitImageMode) {
    return { wantsImage: true, source: 'explicit', subject: message.trim(), confidence: 1 };
  }
  const mode = options.mode ?? 'chat';
  const autoDetectAllowed = mode === 'chat' || mode === 'agent';
  if (!autoDetectAllowed || !message.trim()) {
    return { wantsImage: false, source: 'none', subject: '', confidence: 0 };
  }
  if (NEGATIVE_RE.test(message)) {
    return { wantsImage: false, source: 'none', subject: '', confidence: 0 };
  }
  if (STRONG_RE.test(message) || DRAW_VERB_RE.test(message) || IMAGINE_RE.test(message)) {
    return { wantsImage: true, source: 'detected', subject: extractSubject(message), confidence: 0.85 };
  }
  if (NOUN_LED_RE.test(message)) {
    return { wantsImage: true, source: 'detected', subject: extractSubject(message), confidence: 0.65 };
  }
  return { wantsImage: false, source: 'none', subject: '', confidence: 0 };
}
