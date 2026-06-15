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
  | 'crossing-bridge'
  | 'implicit-constraint'
  | 'false-premise'
  | 'anchoring-trap';

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

// ─────────────────────────── 6. implicit-constraint (car-wash class) ────────────────────────────

/**
 * STRUCTURAL implicit-constraint detector.
 *
 * Instead of hardcoding phrasings, we detect THREE independent signals and
 * check their RELATIONSHIP:
 *
 *   1. ITEM — a physical object mentioned in the question (car, piano, boat, etc.)
 *   2. SERVICE — an action/destination that requires that item physically present
 *      (wash, repair, tune, ship, deliver, park, etc.)
 *   3. TRANSPORT Q — the user asks about how to GET THERE (walk vs drive, carry vs ship)
 *
 * The trick fires when: the ITEM is itself the TRANSPORT MEANS. "Should I walk
 * or drive my car to the car wash?" → the car IS both the service subject AND
 * the way you'd drive there. Walking defeats the purpose.
 *
 * This generalizes beyond cars:
 *   - "Should I walk or ride to the bike shop to fix my bike?" (bike = transport)
 *   - "Should I carry or ship this piano?" (piano can't be carried)
 *   - "Should I walk or sail to get my boat repaired?" (boat = transport)
 */

/** Items that are ALSO a mode of transport when you "drive/ride/sail" them. */
const SELF_TRANSPORT_ITEMS: ReadonlyArray<{ item: RegExp; transportVerb: string }> = [
  { item: /\b(?:car|vehicle|truck|van|suv|automobile|sedan|coupe|hatchback|pickup)\b/i, transportVerb: 'drive' },
  { item: /\b(?:motorcycle|motorbike|scooter|moped|vespa)\b/i, transportVerb: 'ride' },
  { item: /\b(?:bicycle|bike|e-?bike|cycle)\b/i, transportVerb: 'ride' },
  { item: /\b(?:boat|yacht|ship|sailboat|kayak|canoe|jet\s*ski)\b/i, transportVerb: 'sail' },
];

/** Services/actions that require the item to be PHYSICALLY PRESENT. Matches inflected forms (repaired, inspected, cleaning, etc.) via word-start anchoring. */
const REQUIRES_ITEM_PRESENT_RE =
  /\b(?:wash|clean|repair|fix|servic|inspect|detail|tune[\s-]?up|maintain|oil\s+change|paint|wrap|tint|polish|wax|dent|scratch|brak|tire|tyre|align|diagnostic|smog|mot\b|check|deliver|return|drop\s*off|pick\s*up|apprais|valet)/i;

/** Service DESTINATIONS (places where the service happens). */
const SERVICE_DESTINATION_RE =
  /\b(?:car\s*wash|mechanic|garage|auto\s*shop|body\s*shop|service\s*(?:center|station|centre)|repair\s*shop|tire\s*shop|tyre\s*shop|dealership|workshop|detailer|marina|dock|harbor|harbour|bike\s*shop|cycle\s*shop)\b/i;

/** The user is asking a transport-mode question. */
const TRANSPORT_QUESTION_RE =
  /\b(?:walk|drive|ride|cycle|sail|take\s+(?:the\s+)?(?:bus|taxi|uber|lyft)|on\s+foot|carry|go\s+(?:by\s+foot|there))\b|\b(?:walk|ride|drive|sail)\s+there\b/i;

export function detectImplicitConstraint(input: string): TrickAnswer | null {
  const lower = input.toLowerCase();

  // Step 1: Is there a transport-mode question?
  if (!TRANSPORT_QUESTION_RE.test(lower)) return null;

  // Step 2: Is there an item that is ALSO a mode of transport?
  let detectedItem: (typeof SELF_TRANSPORT_ITEMS)[number] | null = null;
  for (const entry of SELF_TRANSPORT_ITEMS) {
    if (entry.item.test(lower)) {
      detectedItem = entry;
      break;
    }
  }
  if (!detectedItem) return null;

  // Step 3: Is there a service or destination that needs the item present?
  const hasService = REQUIRES_ITEM_PRESENT_RE.test(lower);
  const hasDestination = SERVICE_DESTINATION_RE.test(lower);
  if (!hasService && !hasDestination) return null;

  // Step 4: Does the transport question include a NON-ITEM option (walk/bus/foot)?
  // If they only ask "should I drive or take an uber", there's no trick —
  // the trick is when one option (walk) would leave the item behind.
  const hasNonItemTransport = /\b(?:walk|on\s+foot|take\s+(?:the\s+)?(?:bus|taxi|uber|lyft)|carry|go\s+by\s+foot|uber|lyft|taxi|cab)\b/i.test(lower);
  if (!hasNonItemTransport) return null;

  // Extract the item name for a natural answer
  const itemMatch = lower.match(detectedItem.item);
  const itemName = itemMatch ? itemMatch[0] : 'the item';

  return {
    kind: 'implicit-constraint',
    answer: `${detectedItem.transportVerb.charAt(0).toUpperCase()}${detectedItem.transportVerb.slice(1)}. The ${itemName} needs to physically be at the destination to be worked on — walking (or any non-${itemName} transport) would leave it behind.`,
    reasoning: `Implicit-constraint: the ${itemName} is both the SUBJECT of the service AND the MEANS of ${detectedItem.transportVerb === 'drive' ? 'driving' : detectedItem.transportVerb + 'ing'} — using non-item transport defeats the purpose.`,
    confidence: 0.92,
  };
}


// ─────────────────────────── 7. false-premise ────────────────────────────

/**
 * Detect questions built on a provably false assumption. When a question
 * embeds a factual claim that is widely known to be wrong, Vai should
 * correct the premise rather than answer within the false frame.
 *
 * Examples:
 *   "Since the Earth is flat, how far is the horizon?" — premise is false
 *   "Why did Einstein fail math?" — he didn't
 *   "What country does the Great Wall of China separate it from?" — ambiguous/misleading
 *
 * NOTE: Only fires on WELL-KNOWN false premises that Vai can deterministically
 * verify (hardcoded corrections). This is NOT a general fact-checker — it's
 * a guard against the most common trick framings.
 */
const FALSE_PREMISES: ReadonlyArray<{ pattern: RegExp; correction: string }> = [
  { pattern: /\b(?:since|because|given\s+that|as\s+we\s+know)\s+(?:the\s+)?earth\s+is\s+flat\b/i,
    correction: 'The premise is false — the Earth is not flat. It is an oblate spheroid, confirmed by centuries of evidence including satellite imagery, circumnavigation, and physics.' },
  { pattern: /\bwhy\s+did\s+einstein\s+fail\s+(?:math|school|his\s+exams?)\b/i,
    correction: 'The premise is false — Einstein did NOT fail math. He excelled at mathematics from a young age; this is a persistent urban legend.' },
  { pattern: /\bhow\s+many\s+(?:states|countries)\s+(?:are|does)\s+(?:there\s+)?in\s+(?:the\s+)?(?:european\s+union|eu)\b[\s\S]{0,40}\b(?:28|29|30)\b/i,
    correction: 'The premise may be outdated — the EU had 28 members until the UK left (Brexit, 2020). As of 2024, there are 27 EU member states.' },
  { pattern: /\b(?:since|because|given)\s+(?:humans?|we|people)\s+only\s+use\s+(?:10|ten)\s*%?\s+(?:of\s+)?(?:our|their|the)\s+brain/i,
    correction: 'The premise is false — the "10% of the brain" claim is a myth. Neuroimaging shows that virtually all parts of the brain are active, just not all simultaneously.' },
  { pattern: /\b(?:since|because|given)\s+(?:the\s+)?great\s+wall\s+(?:of\s+china\s+)?(?:is|can\s+be)\s+(?:seen|visible)\s+from\s+(?:space|the\s+moon)\b/i,
    correction: 'The premise is false — the Great Wall of China is NOT visible from space with the naked eye. It is too narrow (~5-8 meters wide). This is a common myth.' },
];

export function detectFalsePremise(input: string): TrickAnswer | null {
  for (const { pattern, correction } of FALSE_PREMISES) {
    if (pattern.test(input)) {
      return {
        kind: 'false-premise',
        answer: correction,
        reasoning: 'Question contains a provably false premise; correcting before answering.',
        confidence: 0.88,
      };
    }
  }
  return null;
}

// ─────────────────────────── 8. anchoring-trap ────────────────────────────

/**
 * Detect anchoring-trap questions: the question leads with an irrelevant
 * number or detail designed to bias the answer.
 *
 * Classic example: "A bat and a ball cost $1.10 in total. The bat costs
 * $1.00 more than the ball. How much does the ball cost?" — The intuitive
 * (wrong) answer is $0.10; the correct answer is $0.05.
 *
 * This is one of the most famous cognitive biases (Kahneman's CRT).
 */
const BAT_BALL_RE =
  /\bbat\s+and\s+(?:a\s+)?ball\b[\s\S]{0,120}\bcosts?\s+\$?1[.,]?(?:00)?\s+more\b[\s\S]{0,80}\bhow\s+much\b/i;

const BAT_BALL_ALT_RE =
  /\bcosts?\s+\$?1[.,]?(?:10|1\.10)\b[\s\S]{0,120}\b(?:bat|racket|paddle)\b[\s\S]{0,80}\bmore\s+than\b[\s\S]{0,80}\bhow\s+much\b/i;

/** Lily pad doubling problem: "covers the lake in 48 days, on what day is it half covered?" */
const LILY_PAD_RE =
  /\b(?:lily\s*pad|algae|bacteria|weed)s?\b[\s\S]{0,200}\bdoubles?\b[\s\S]{0,200}\b(?:half|50\s*%)\b/i;

export function detectAnchoringTrap(input: string): TrickAnswer | null {
  if (BAT_BALL_RE.test(input) || BAT_BALL_ALT_RE.test(input)) {
    return {
      kind: 'anchoring-trap',
      answer: 'The ball costs $0.05 (5 cents). If the ball costs $0.05, the bat costs $1.05 ($1.00 more), totaling $1.10.',
      reasoning: 'Bat-and-ball problem (Kahneman CRT): the intuitive $0.10 answer is wrong because $1.10 - $0.10 = $1.00 (not "$1.00 MORE").',
      confidence: 0.95,
    };
  }
  if (LILY_PAD_RE.test(input)) {
    // Extract the total number of days from the question for a precise answer
    const daysMatch = input.match(/(\d+)\s*days?/);
    const totalDays = daysMatch ? Number(daysMatch[1]) : 48;
    const halfDay = totalDays - 1;
    return {
      kind: 'anchoring-trap',
      answer: `Day ${halfDay}. If it doubles every day and covers the whole lake on day ${totalDays}, then it was half-covered the day before — day ${halfDay}.`,
      reasoning: `Exponential-growth intuition trap: doubling means half-coverage is always one day before full coverage (day ${totalDays} - 1 = ${halfDay}).`,
      confidence: 0.93,
    };
  }
  return null;
}

// ─────────────────────────── Public dispatcher ────────────────────────────

const ALL: ReadonlyArray<(input: string) => TrickAnswer | null> = [
  detectLetterCount,
  detectEqualWeight,
  detectSisterBrother,
  detectMaryDaughters,
  detectCrossingBridge,
  detectImplicitConstraint,
  detectFalsePremise,
  detectAnchoringTrap,
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
