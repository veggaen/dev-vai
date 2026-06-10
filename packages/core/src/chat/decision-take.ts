/**
 * Engaged decision/opinion responder.
 *
 * Decision questions ("is it dumb to write my own ORM instead of Prisma?",
 * "is it worth adding Redis?") need an honest, reasoned take — not the generic
 * "I don't have a confident answer" fallback. vai:v0 can't reason freely, but
 * these questions follow a small number of recognizable SHAPES with a
 * well-established engineering answer. This responder detects the shape, extracts
 * the subject(s), and returns a grounded take parameterized by them.
 *
 * Self-adjusting in the sense that matters here: one responder serves the whole
 * class for ANY tool/library/feature — no per-topic table. Returns null unless a
 * shape is clearly recognized with an extractable subject, so it never emits a
 * vague "it depends" filler answer (anti-slop).
 */

export type DecisionTakeKind = 'diy-vs-tool' | 'adopt-or-not';

export interface DecisionTake {
  reply: string;
  kind: DecisionTakeKind;
}

// Opinion/judgment framing — required so a plain build request ("write my own
// parser") is never mistaken for a decision question.
const OPINION_CUE_RE =
  /\b(is\s+it\s+(?:really\s+)?(?:dumb|worth|bad|good|ok|okay|fine|wise|smart|a\s+(?:bad|good)\s+idea|overkill|pointless|stupid|silly)|worth\s+it|should\s+i|good\s+idea|bad\s+idea|makes?\s+sense|overkill|reinvent)\b/i;

function clean(phrase: string): string {
  return phrase
    .trim()
    .replace(/^(?:a|an|the|just|my|your|our|their)\s+/i, '')
    .replace(/[?.!,;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract the established tool named as the alternative, if any. */
function extractAlternative(content: string): string | null {
  const m = content.match(
    /\b(?:instead\s+of|rather\s+than|over|vs\.?|versus)\s+(?:just\s+)?(?:using\s+|reaching\s+for\s+|going\s+with\s+|adopting\s+)?([a-z0-9][\w.+#-]*(?:\s+[a-z0-9][\w.+#-]*){0,2})/i,
  );
  if (!m) return null;
  const alt = clean(m[1]);
  return alt.length >= 2 ? alt : null;
}

function tryDiyVsTool(content: string): DecisionTake | null {
  // "build / write / roll / implement / hand-roll my own <X>"
  const m = content.match(
    /\b(?:writ\w*|build\w*|roll\w*|implement\w*|cod\w*|mak\w*|creat\w*|hand[\s-]?roll\w*|reinvent\w*)\s+(?:my|your|our|their|a|an)\s+own\s+([a-z0-9][\w +./#-]*?)(?=\s*(?:\binstead\b|\brather\b|\bover\b|\bvs\b|\bversus\b|\busing\b|\bfrom\s+scratch\b|[?.!,;]|$))/i,
  );
  if (!m) return null;
  const x = clean(m[1]);
  if (x.length < 2) return null;
  const y = extractAlternative(content);
  const tool = y ?? 'the established tool';

  const reply =
`**Honest take — building your own ${x}${y ? ` vs reaching for ${y}` : ''}.**

For anything that has to run in production, lean toward ${tool}. Not because your version would be bad — because a mature tool has already paid for the edge cases, security hardening, and ergonomics you'd otherwise rediscover one bug at a time, on your own schedule, forever. The dependency you're avoiding is usually cheaper than the maintenance you'd be signing up for.

Roll your own ${x} only when one of these is genuinely true:
- You're doing it to **learn how ${x} works** — a great reason, just don't make it your system of record.
- Your needs are **narrow enough** that ${tool} is more weight than the problem (a handful of cases, no growth expected).
- ${y ? `${y}'s` : "The tool's"} design **actively fights your use case** — and you've hit the wall for real, not in theory.

If none of those hold, ship with ${y ?? 'the established option'} and spend the saved time on the part of the product only you can build.`;

  return { reply, kind: 'diy-vs-tool' };
}

function tryAdoptOrNot(content: string): DecisionTake | null {
  // "is it worth (it) adding/using/adopting/introducing/bringing in <X>"
  const m = content.match(
    /\b(?:worth(?:\s+it)?|should\s+i|makes?\s+sense\s+to)\b[^?.!]*?\b(?:add\w*|adopt\w*|introduc\w*|bring\w*\s+in|switch\w*\s+to|mov\w*\s+to|migrat\w*\s+to|pull\w*\s+in)\s+([a-z0-9][\w.+#-]*(?:\s+[a-z0-9][\w.+#-]*){0,2})/i,
  );
  if (!m) return null;
  const x = clean(m[1]);
  if (x.length < 2) return null;

  const reply =
`**Honest take — is ${x} worth it?**

Default to "not yet" until ${x} removes a **specific pain you can name today**. New tools look free in the demo and bill you later in build complexity, onboarding, and one more thing to upgrade and debug. The question isn't whether ${x} is good — it's whether the pain it removes is bigger than the complexity it adds *at your current scale*.

Add ${x} when:
- It kills a **real, recurring** problem you're hitting now — not one you might hit at 100× the traffic.
- The team can **explain what it does** and own it.
- You could **rip it out later** without a rewrite.

Hold off when it's mostly resume-driven, hype-driven, or "might need it someday." You can almost always adopt it the day the pain becomes real — and you'll choose better with that evidence in hand.`;

  return { reply, kind: 'adopt-or-not' };
}

/**
 * Return an engaged decision take, or null when the prompt isn't a recognized
 * decision shape. Requires an opinion cue AND an extractable subject.
 */
export function tryEmitDecisionTake(content: string): DecisionTake | null {
  const text = (content || '').trim();
  if (!text) return null;
  if (!OPINION_CUE_RE.test(text)) return null;
  return tryDiyVsTool(text) ?? tryAdoptOrNot(text);
}

export default { tryEmitDecisionTake };
