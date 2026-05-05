/**
 * Trick-Question Detector
 * ───────────────────────
 * A small library of pure detectors for the viral riddles that LLMs
 * famously bungle. Vai is local-deterministic, so it can answer these
 * with precision instead of pattern-matching to nearby knowledge chunks.
 *
 * Each detector returns either `null` (does not apply) or a structured
 * answer with the deterministic value, a short justification, and a
 * confidence score. The engine wires this in BEFORE retrieval / web
 * research so a confidently-detected riddle short-circuits the chain.
 *
 * Pure functions only — no I/O, no engine state. Easy to unit-test.
 *
 * Coverage:
 *   1. letter-count        — "how many R's in strawberry"
 *   2. equal-weight        — "what weighs more, a pound of X or a pound of Y"
 *   3. sister-brother      — Mary has N brothers and M sisters, how many sisters does her brother have
 *   4. mary-daughters      — "Mary's father has 5 daughters … Nana, Nene, Nini, Nono and ___"
 *   5. crossing-bridge     — meta-detection only (don't auto-answer; we flag it as a known riddle so the engine doesn't hallucinate)
 *
 * NOTE: When confidence < 0.8 the engine should NOT short-circuit;
 * instead it can use the detection as a SIGNAL that the prompt is a
 * riddle, suppressing low-quality README/SEO drift.
 */

export type TrickKind =
  | 'letter-count'
  | 'equal-weight'
  | 'sister-brother'
  | 'mary-daughters'
  | 'crossing-bridge';

export interface TrickAnswer {
  kind: TrickKind;
  /** The literal answer text Vai should emit. */
  answer: string;
  /** One-line justification — useful for trace, ignored unless engine wants it. */
  reasoning: string;
  /** 0–1 — how confident we are this is the riddle we think it is. */
  confidence: number;
}

// ─────────────────────────── 1. letter-count ────────────────────────────

const LETTER_COUNT_RE =
  /\bhow\s+many\s+(?:letters?\s+)?["']?([a-z])["']?(?:'?s)?\s+(?:are\s+|appear\s+|do\s+(?:we\s+)?see\s+)?(?:there\s+)?(?:in|inside)\s+(?:the\s+(?:word\s+)?)?["']?([a-z][a-z'-]{1,40})["']?/i;
const LETTER_COUNT_ALT_RE =
  /\bhow\s+many\s+["']?([a-z])["']?\s+letters?\s+(?:are\s+)?(?:there\s+)?(?:in|inside)\s+["']?([a-z][a-z'-]{1,40})["']?/i;

export function detectLetterCount(input: string): TrickAnswer | null {
  const m = LETTER_COUNT_RE.exec(input) ?? LETTER_COUNT_ALT_RE.exec(input);
  if (!m) return null;
  const letter = m[1].toLowerCase();
  const word = m[2].toLowerCase().replace(/[^a-z]/g, '');
  if (word.length === 0) return null;
  let count = 0;
  for (const ch of word) if (ch === letter) count++;
  return {
    kind: 'letter-count',
    answer: `There ${count === 1 ? 'is' : 'are'} ${count} "${letter.toUpperCase()}" in "${m[2]}".`,
    reasoning: `Counted occurrences of '${letter}' in '${word}'.`,
    confidence: 0.95,
  };
}

// ─────────────────────────── 2. equal-weight ────────────────────────────

const EQUAL_WEIGHT_RE =
  /\bwhat\s+(?:weighs|is)\s+(?:more|heavier|less|lighter)\b[\s\S]{0,80}\b(?:a|one)\s+(pound|kg|kilogram|kilo|ton|gram|ounce|oz|lb|lbs?)\s+of\s+([a-z][a-z\s'-]{2,30})\s+or\s+(?:a|one)\s+(pound|kg|kilogram|kilo|ton|gram|ounce|oz|lb|lbs?)\s+of\s+([a-z][a-z\s'-]{2,30})/i;

export function detectEqualWeight(input: string): TrickAnswer | null {
  const m = EQUAL_WEIGHT_RE.exec(input);
  if (!m) return null;
  const unitA = m[1].toLowerCase();
  const stuffA = m[2].trim().toLowerCase();
  const unitB = m[3].toLowerCase();
  const stuffB = m[4].trim().toLowerCase();
  if (unitA !== unitB) return null; // Different units — not the riddle.
  if (stuffA === stuffB) return null;
  return {
    kind: 'equal-weight',
    answer: `They weigh the same — one ${unitA} of ${stuffA} weighs exactly the same as one ${unitB} of ${stuffB}: one ${unitA}.`,
    reasoning: `Equal-mass riddle: equal units cancel regardless of material density.`,
    confidence: 0.95,
  };
}

// ─────────────────────────── 3. sister-brother ────────────────────────────

const WORD_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10,
};
function num(tok: string): number | null {
  if (!tok) return null;
  const lower = tok.toLowerCase();
  if (lower in WORD_NUM) return WORD_NUM[lower];
  const n = Number(lower);
  return Number.isFinite(n) ? n : null;
}

const SISTER_BROTHER_RE =
  /\b([a-z]+)\s+has\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(brothers?|sisters?)\s+and\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(brothers?|sisters?)\b[\s\S]{0,120}\bhow\s+many\s+(brothers?|sisters?)\s+does\s+(?:her|his)\s+(brother|sister)\s+have/i;

export function detectSisterBrother(input: string): TrickAnswer | null {
  const m = SISTER_BROTHER_RE.exec(input);
  if (!m) return null;
  const subjectName = m[1];
  const n1 = num(m[2]);
  const k1 = m[3].toLowerCase().replace(/s$/, '');
  const n2 = num(m[4]);
  const k2 = m[5].toLowerCase().replace(/s$/, '');
  const askAbout = m[6].toLowerCase().replace(/s$/, ''); // "sisters" → "sister"
  const sibKind = m[7].toLowerCase(); // "brother" | "sister"
  if (n1 === null || n2 === null) return null;

  // Build counts from the SUBJECT's perspective.
  // The subject's gender is unknown from the prompt; the riddle works
  // because the asker counts the *subject* as a sibling of her brother.
  let totalBrothers = 0, totalSisters = 0;
  if (k1 === 'brother') totalBrothers += n1;
  if (k1 === 'sister') totalSisters += n1;
  if (k2 === 'brother') totalBrothers += n2;
  if (k2 === 'sister') totalSisters += n2;

  // Now answer from the perspective of one of the SIBLINGS (her brother / her sister).
  // From their perspective, the subject counts as a sibling too.
  // Gender of subject inferred from "her"/"his" pronoun → opposite-gender pronoun
  // tells us the subject's gender. The regex captured the pronoun via "(?:her|his)".
  const pronounMatch = input.match(/\bdoes\s+(her|his)\s+(?:brother|sister)\s+have/i);
  const subjectIsFemale = pronounMatch?.[1].toLowerCase() === 'her';

  // From the sibling's perspective:
  //   - their brothers = totalBrothers minus themselves if they ARE a brother, plus subject if subject is male
  //   - their sisters  = totalSisters  minus themselves if they ARE a sister,  plus subject if subject is female
  let brothersFromSibling = totalBrothers + (subjectIsFemale ? 0 : 1);
  let sistersFromSibling = totalSisters + (subjectIsFemale ? 1 : 0);
  if (sibKind === 'brother') brothersFromSibling -= 1;
  else sistersFromSibling -= 1;

  const result = askAbout === 'brother' ? brothersFromSibling : sistersFromSibling;
  if (result < 0) return null;

  return {
    kind: 'sister-brother',
    answer: `${result}.`,
    reasoning: `${subjectName} has ${totalBrothers} brothers + ${totalSisters} sisters total. From a ${sibKind}'s view, ${subjectName} also counts as a sibling.`,
    confidence: 0.9,
  };
}

// ─────────────────────────── 4. mary-daughters ────────────────────────────

const MARY_DAUGHTERS_RE =
  /\b([a-z]+)(?:'s|s')?\s+(?:mother|father|mom|dad|parent)s?\s+(?:has|have|got)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(daughters?|children|kids|sons?)\b[\s\S]{0,200}\bwhat(?:'s|\s+is)\s+the\s+(?:name\s+of\s+the\s+)?(?:fifth|last|other|missing)/i;

export function detectMaryDaughters(input: string): TrickAnswer | null {
  const m = MARY_DAUGHTERS_RE.exec(input);
  if (!m) return null;
  const subjectName = m[1];
  return {
    kind: 'mary-daughters',
    answer: `${subjectName.charAt(0).toUpperCase()}${subjectName.slice(1)}.`,
    reasoning: `Classic riddle: the missing daughter is the subject of the question itself.`,
    confidence: 0.85,
  };
}

// ─────────────────────────── 5. crossing-bridge (signal only) ────────────────────────────

const CROSSING_BRIDGE_RE =
  /\b(?:cross(?:ing)?\s+(?:the\s+|a\s+)?(?:bridge|river)|river\s+crossing)\b[\s\S]{0,120}\b(?:goat|wolf|cabbage|fox|chicken|torch|flashlight)\b/i;

/** Detect the river-crossing class of riddles. Returns a SIGNAL only — no auto-answer. */
export function detectCrossingBridge(input: string): TrickAnswer | null {
  if (!CROSSING_BRIDGE_RE.test(input)) return null;
  return {
    kind: 'crossing-bridge',
    answer: '',
    reasoning: 'River-crossing riddle detected; engine should reason carefully or admit uncertainty.',
    confidence: 0.7,
  };
}

// ─────────────────────────── Public dispatcher ────────────────────────────

const ALL: ReadonlyArray<(input: string) => TrickAnswer | null> = [
  detectLetterCount,
  detectEqualWeight,
  detectSisterBrother,
  detectMaryDaughters,
  detectCrossingBridge,
];

/**
 * Run every detector and return the highest-confidence answer (if any).
 * Tie-broken by detector order.
 */
export function detectTrickQuestion(input: string): TrickAnswer | null {
  if (typeof input !== 'string' || input.trim().length === 0) return null;
  let best: TrickAnswer | null = null;
  for (const d of ALL) {
    const r = d(input);
    if (!r) continue;
    if (!best || r.confidence > best.confidence) best = r;
  }
  return best;
}
