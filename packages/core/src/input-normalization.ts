// ── Closed-class words that should never count as "topical content" when
// ranking retrieval results. Kept inline (rather than imported from
// stop-words.ts) so input-normalization stays leaf-level — no module cycles.
const TOPIC_NOISE_WORDS = new Set<string>([
  // English articles / determiners / conjunctions / pronouns / prepositions
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'and', 'or', 'but', 'so', 'if', 'because', 'as', 'than',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him',
  'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their',
  'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'not', 'only', 'own', 'same', 'too', 'very', 'just', 'about',
  'of', 'at', 'by', 'for', 'with', 'against', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'over', 'under', 'in',
  'on', 'off', 'to', 'from', 'up', 'down', 'out', 'again', 'further',
  'then', 'once', 'here', 'there',
  // Q&A action verbs that are framing, not content
  'explain', 'describe', 'define', 'compare', 'tell', 'show', 'give', 'list',
  'know', 'knows', 'knew', 'remember', 'recall', 'understand',
  // Norwegian closed-class
  'og', 'eller', 'men', 'om', 'hvis', 'da', 'er', 'var', 'som', 'med',
  'av', 'til', 'fra', 'på', 'kan', 'vil', 'skal', 'jeg', 'du', 'vi',
  'hva', 'kva', 'hvor', 'hvordan', 'forklar', 'fortell',
]);

/**
 * Returns the lowercased "content tokens" of a topic phrase: tokens with at
 * least 2 chars that are not closed-class words. Used by retrieval guards to
 * verify a candidate document actually concerns the asked topic before its
 * text is surfaced as an answer.
 *
 * Example: topicContentTokens("react server components")
 *          → ["react", "server", "components"]
 */
export function topicContentTokens(topic: string): string[] {
  if (typeof topic !== 'string' || topic.length === 0) return [];
  return topic
    .toLowerCase()
    .split(/[^a-z0-9æøå]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !TOPIC_NOISE_WORDS.has(t));
}

/**
 * TopicGuard: returns true when `text` plausibly concerns `topic`. The
 * heuristic requires at least one content token from the topic to appear as
 * a whole-word match in the text (case-insensitive). Returns true vacuously
 * when the topic has no content tokens (e.g. pure stopwords) so callers
 * don't accidentally filter everything out.
 */
export function textConcernsTopic(text: string, topic: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  const tokens = topicContentTokens(topic);
  if (tokens.length === 0) return true;
  const lower = text.toLowerCase();
  for (const token of tokens) {
    // Whole-word match — escape regex metachars defensively.
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(lower)) return true;
  }
  return false;
}

const NORMALIZATION_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bwhats\b/gi, 'what is'],
  [/\bwats\b/gi, 'what is'],
  [/\bwaht\b/gi, 'what'],
  [/\bwhta\b/gi, 'what'],
  [/\bhwo\b/gi, 'how'],
  [/\bhoww\b/gi, 'how'],
  [/\bwyh\b/gi, 'why'],
  [/\bcna\b/gi, 'can'],
  [/\bcan\s+u\b/gi, 'can you'],
  [/\balsi\b/gi, 'also'],
  [/\bpls\b/gi, 'please'],
  [/\bplz\b/gi, 'please'],
  [/\bplis\b/gi, 'please'],
  [/\bseamles\b/gi, 'seamless'],
  [/\bseamlesly\b/gi, 'seamlessly'],
  [/\bneatles\b/gi, 'neatly'],
  [/\bitterate\b/gi, 'iterate'],
  [/\bitterating\b/gi, 'iterating'],
  [/\bitteration\b/gi, 'iteration'],
  [/\bupgaades\b/gi, 'upgrades'],
  [/\bupgades\b/gi, 'upgrades'],
  [/\baps\b/gi, 'apps'],
  [/\brepliceate\b/gi, 'replicate'],
  [/\bwebstie\b/gi, 'website'],
  [/\bwebiste\b/gi, 'website'],
  [/\bscrenshot\b/gi, 'screenshot'],
  [/\bsceenshot\b/gi, 'screenshot'],
  [/\btwiter\b/gi, 'twitter'],
  [/\btwitterr\b/gi, 'twitter'],
  [/\bcloen\b/gi, 'clone'],
  [/\bexsplain\b/gi, 'explain'],
  [/\bexplian\b/gi, 'explain'],
  [/\bexpalin\b/gi, 'explain'],
  [/\bexpain\b/gi, 'explain'],
  [/\bexplaine\b/gi, 'explain'],
  [/\bexplane\b/gi, 'explain'],
  [/\bdesribe\b/gi, 'describe'],
  [/\bdescrbie\b/gi, 'describe'],
  [/\bdefintion\b/gi, 'definition'],
  [/\bcomparision\b/gi, 'comparison'],
  [/\bcomparsion\b/gi, 'comparison'],
  [/\bcompair\b/gi, 'compare'],
  [/\bcomapre\b/gi, 'compare'],
  [/\breccomend\b/gi, 'recommend'],
  [/\bdiffernce\b/gi, 'difference'],
  [/\bundrestand\b/gi, 'understand'],
  [/\bunderstad\b/gi, 'understand'],
  [/\bhvaa\b/gi, 'hva'],
  [/\bhvae\b/gi, 'hva'],
  [/\bvha\b/gi, 'hva'],
  [/\bka\s+(?:er|e)\b/gi, 'hva er'],
  [/\bkva\s+er\b/gi, 'hva er'],
  [/\bhvodan\b/gi, 'hvordan'],
  [/\bhvordna\b/gi, 'hvordan'],
  [/\bhvoran\b/gi, 'hvordan'],
  [/\bkordan\b/gi, 'hvordan'],
  [/\bkossen\b/gi, 'hvordan'],
  [/\bforkalr\b/gi, 'forklar'],
  [/\bfoklar\b/gi, 'forklar'],
  [/\bforklr\b/gi, 'forklar'],
  [/\bforklare\b/gi, 'forklar'],
  [/\bfunke\b/gi, 'fungerer'],
  [/\bfunker\b/gi, 'fungerer'],
  [/\bpyhton\b/gi, 'python'],
  [/\bphyton\b/gi, 'python'],
  [/\btypescirpt\b/gi, 'typescript'],
  [/\btypsecript\b/gi, 'typescript'],
  [/\btypscript\b/gi, 'typescript'],
  [/\btypecript\b/gi, 'typescript'],
  [/\bjavascripts\b/gi, 'javascript'],
  [/\bjavascritp\b/gi, 'javascript'],
  [/\bjavscript\b/gi, 'javascript'],
  [/\bjavascipt\b/gi, 'javascript'],
  [/\bdockre\b/gi, 'docker'],
  [/\bdokcer\b/gi, 'docker'],
  [/\bwebsokcet\b/gi, 'websocket'],
  [/\bwebscoket\b/gi, 'websocket'],
  [/\bwebsockett\b/gi, 'websocket'],
  [/\bdatabse\b/gi, 'database'],
  [/\bdatabaes\b/gi, 'database'],
  [/\brecusrion\b/gi, 'recursion'],
  [/\brecusion\b/gi, 'recursion'],
  [/\blatancy\b/gi, 'latency'],
  [/\blatecny\b/gi, 'latency'],
  [/\bqeue\b/gi, 'queue'],
  [/\bprsima\b/gi, 'prisma'],
  [/\bpostgress\b/gi, 'postgres'],
  [/\bpostrges\b/gi, 'postgres'],
  [/\brecat\b/gi, 'react'],
  [/\breactt\b/gi, 'react'],
  [/\braect\b/gi, 'react'],
  [/\brract\b/gi, 'react'],
  [/\breactjs\b/gi, 'react'],
  [/\bnextj\b/gi, 'nextjs'],
  [/\bnxtjs\b/gi, 'nextjs'],
  [/\bnextjs\b/gi, 'nextjs'],
  [/\bnetxjs\b/gi, 'nextjs'],
  [/\btialwind\b/gi, 'tailwind'],
  [/\btailwnd\b/gi, 'tailwind'],
  [/\btaiwind\b/gi, 'tailwind'],
  [/\bsvetle\b/gi, 'svelte'],
  [/\bsvelt\b/gi, 'svelte'],
  [/\bvuejs\b/gi, 'vue'],
  [/\bvuee\b/gi, 'vue'],
  [/\bfastapy\b/gi, 'fastapi'],
  [/\bfasapi\b/gi, 'fastapi'],
  [/\bdjnago\b/gi, 'django'],
  [/\bdjagno\b/gi, 'django'],
  [/\bnodejs\b/gi, 'node'],
  [/\bnodjs\b/gi, 'node'],
  [/\bvietst\b/gi, 'vitest'],
  [/\bvitset\b/gi, 'vitest'],
  [/\btyepscript\b/gi, 'typescript'],
  [/\bmeanng\b/gi, 'meaning'],
  [/\bmeanig\b/gi, 'meaning'],
  [/\bprograming\b/gi, 'programming'],
  [/\bprgramming\b/gi, 'programming'],
];

// ── Voice / dictation disfluency handling ───────────────────────────────
// Applied BEFORE the typo rules so that restarts strip off the discarded
// portion and fillers don't survive into routing signals. Skipped when the
// input contains code fences (handled by the main entry point).

// "no, I mean X" is preserved here — the engine's corrective-follow-up
// extractor depends on that literal prefix to reframe the prior topic.
// Note: bare "actually" in mid-sentence is NOT a restart (e.g. "when do they
// actually hit the database?") — restart forms require "wait actually" or
// "actually, no/make/let/I mean …".
const RESTART_MARKER_RE = /\b(?:wait(?:,?\s+actually)?|scratch that|actually,?\s+(?:no|make|let|i\s+mean)|no,?\s+wait|hmm,?\s+no|let me rephrase)\b/gi;

function applyRestartMarkers(input: string): string {
  let lastIdx = -1;
  let lastLen = 0;
  RESTART_MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RESTART_MARKER_RE.exec(input)) !== null) {
    lastIdx = match.index;
    lastLen = match[0].length;
  }
  if (lastIdx < 0) return input;
  const after = input.slice(lastIdx + lastLen).replace(/^[\s,.:;]+/, '');
  if (after.length < 8) return input;
  return after;
}

function stripDisfluencies(input: string): string {
  let out = input;

  out = applyRestartMarkers(out);

  // Filler tokens — standalone "mm" is excluded because it clobbers valid
  // uppercase tokens like "MM" in date formats (YYYY-MM-DD).
  out = out.replace(/\b(?:um+|uh+|erm+|ah+|hmm+)\b[,.\s]*/gi, ' ');
  // "you know" as a discourse filler — only when comma-bounded or trailing,
  // never when it's the main verb ("what do you know about X?").
  out = out.replace(/,\s*you\s+know\s*,\s*/gi, ', ');
  out = out.replace(/,\s*you\s+know\s*[.?!]?\s*$/gi, '');
  out = out.replace(/\b(?:sort of|kind of|kinda|sorta)\b[,.\s]*/gi, ' ');
  out = out.replace(/\bso\s+like\b[,\s]*/gi, ' ');
  out = out.replace(/,\s*like,\s*/gi, ', ');
  out = out.replace(/,\s*like\s+/gi, ' ');

  // "comma" as spoken punctuation → "," but NOT when part of "comma-separated" / "comma-delimited"
  out = out.replace(/\s+comma(?![\s]*[-—])\b/gi, ',');
  out = out.replace(/\s+(?:period|full\s+stop)\b/gi, '.');
  out = out.replace(/\s+question\s+mark\b/gi, '?');
  out = out.replace(/\s+exclamation(?:\s+(?:point|mark))?\b/gi, '!');

  out = out.replace(/\b([a-z]{2,})\s+([a-z]{1,3})\s+\1\s+\2\b/gi, '$1 $2');
  out = out.replace(/\b([a-z]{2,})\s+\1\b/gi, '$1');

  out = out.replace(/[\s,.]+(?:yeah\s+)?(?:that'?s it|i think that'?s it|you know what i mean|if that makes sense)\s*\??\s*$/gi, '');

  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Exposed for unit tests. Runs only the disfluency pass (no typo normalization).
 */
export function stripDictationDisfluencies(input: string): string {
  if (typeof input !== 'string') return input;
  const trimmed = input.trim();
  if (trimmed.length === 0) return input;
  if (/```/.test(trimmed)) return input;
  return stripDisfluencies(trimmed);
}

export function normalizeInputForUnderstanding(input: string): string {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (trimmed.length === 0) return input;
  if (/```/.test(trimmed)) return input;

  let normalized = stripDisfluencies(trimmed);
  for (const [pattern, replacement] of NORMALIZATION_RULES) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.replace(/\s+/g, ' ').trim();
}

// ── Topic extraction ─────────────────────────────────────────────────────
// Strips conversational/question framing from a user query and returns the
// bare topic phrase. Used by knowledge lookups so retrieval is not polluted
// by closed-class words ("of", "about") or interrogative scaffolding
// ("what do you know", "tell me about", "have you heard of"). Centralized
// so every entry point that needs a topic uses identical rules.

const QUERY_FRAMING_PATTERNS: ReadonlyArray<RegExp> = [
  // Multi-word interrogative framings (English) — most specific first.
  /^what\s+do\s+you\s+know(?:\s+(?:about|of|on|regarding|around|concerning|re))?\s+/i,
  /^do\s+you\s+know(?:\s+(?:about|of|on|regarding|around|concerning|re))?\s+/i,
  /^have\s+you\s+(?:ever\s+)?heard(?:\s+(?:about|of|on))?\s+/i,
  /^(?:can|could)\s+you\s+(?:tell\s+me|explain|describe|define|summari[sz]e)\s+(?:about|of|on|regarding|me\s+about)?\s*/i,
  /^tell\s+me\s+(?:more\s+)?(?:about|of|regarding|on)\s+/i,
  /^(?:please\s+)?(?:explain|describe|define|summari[sz]e)\s+(?:to\s+me\s+)?(?:about|how|what|of|on|regarding)?\s*/i,
  /^(?:i\s+(?:want|need|would\s+like)\s+to\s+(?:know|learn|hear)(?:\s+(?:about|of|on|regarding))?)\s+/i,
  /^(?:give\s+me\s+(?:a\s+)?(?:brief|overview|summary|rundown|quick\s+intro)\s+(?:of|about|on)?)\s+/i,
  /^what(?:'s|\s+is|\s+are|\s+was|\s+were)\s+/i,
  /^who(?:'s|\s+is|\s+are|\s+was|\s+were)\s+/i,
  /^how\s+(?:does|do|can|should|would|is|are)\s+/i,
  /^why\s+(?:does|do|is|are|would|should|did|was|were)\s+/i,
  /^when\s+(?:does|do|is|are|did|was|were|will)\s+/i,
  /^where\s+(?:does|do|is|are|did|was|were|will)\s+/i,
  // Norwegian (Bokmål + Nynorsk)
  /^hva\s+(?:er|var)\s+/i,
  /^kva\s+(?:er|var)\s+/i,
  /^fortell\s+meg\s+(?:om|kva)\s+/i,
  /^hvordan\s+(?:fungerer|virker)\s+/i,
  /^korleis\s+(?:fungerer|verkar)\s+/i,
];

// Residual prepositions that survive the framing strip (e.g. user typed
// "tell me about of redbull" or just "of redbull"). Run repeatedly until
// no further reduction occurs.
const RESIDUAL_LEADING_PREPOSITION = /^(?:about|of|on|regarding|around|concerning|re|with|for|against|toward|towards)\s+/i;

const TRAILING_FILLERS = /\s+(?:please|for\s+me|in\s+simple\s+(?:words?|terms?|english)|simply|in\s+a\s+nutshell|tl;?dr|for\s+beginners|like\s+i'?m\s+(?:5|five)|eli5|kort\s+fortalt|med\s+enkle\s+ord)$/i;
const TRAILING_QUALIFIER = /\s+(?:and\s+(?:why|how|when|where)|right\s+now|today|exactly|btw|by\s+the\s+way)$/i;
const WRAPPING_NOISE = /^[\s"'`([{<]+|[\s"'`\])}>.?!,:;]+$/g;

/**
 * Extracts the topic phrase from a conversational query by stripping leading
 * question framing, residual prepositions, and trailing fillers.
 *
 * Examples:
 *   "what do you know of redbull?"        → "redbull"
 *   "tell me about of typescript please"  → "typescript"
 *   "do you know about react hooks?"      → "react hooks"
 *   "explain docker simply"               → "docker"
 *   "what is kubernetes"                  → "kubernetes"
 *   "have you heard of vinext?"           → "vinext"
 *
 * Returns an empty string only when the input is empty/whitespace. If the
 * full input is framing words (e.g. "what do you know"), returns the trimmed
 * original so callers can fall back gracefully.
 */
export function extractTopicFromQuery(query: string): string {
  if (typeof query !== 'string') return '';
  const original = query.trim();
  if (original.length === 0) return '';

  // Strip wrapping quotes/punctuation first so the framing regex anchors (^)
  // can see the actual leading word ("what do you know …").
  let topic = original.replace(WRAPPING_NOISE, '').trim();
  if (topic.length === 0) return '';

  // Strip leading interrogative framing — loop because patterns can chain
  // ("can you tell me about ..." → "about ..." → "...").
  let prev = '';
  while (prev !== topic) {
    prev = topic;
    for (const pattern of QUERY_FRAMING_PATTERNS) {
      const next = topic.replace(pattern, '');
      if (next !== topic) {
        topic = next.trimStart();
        break;
      }
    }
  }

  // Strip residual leading prepositions repeatedly ("tell me about of X").
  prev = '';
  while (prev !== topic) {
    prev = topic;
    topic = topic.replace(RESIDUAL_LEADING_PREPOSITION, '');
  }

  // Strip trailing fillers and qualifiers (also looped — they can stack).
  prev = '';
  while (prev !== topic) {
    prev = topic;
    topic = topic.replace(TRAILING_FILLERS, '').replace(TRAILING_QUALIFIER, '');
  }

  topic = topic.replace(WRAPPING_NOISE, '').replace(/\s+/g, ' ').trim();

  // If stripping consumed everything, fall back to the trimmed original
  // minus wrapping punctuation so the caller still has something to work with.
  if (topic.length === 0) {
    return original.replace(WRAPPING_NOISE, '').replace(/\s+/g, ' ').trim();
  }
  return topic;
}

export type InputRegister = 'formal' | 'casual' | 'terse' | 'teach-me' | 'neutral';

/**
 * Heuristic register detection. Surfaces the user's tone so downstream
 * composers can match it — formal contracts get formal answers, terse pings
 * get short ones, "teach me" requests get stepwise explanations. Cheap and
 * regex-based on purpose; does not touch response routing.
 */
export function detectRegister(input: string): InputRegister {
  if (typeof input !== 'string') return 'neutral';
  const raw = input.trim();
  if (raw.length === 0) return 'neutral';
  const lower = raw.toLowerCase();
  const words = raw.split(/\s+/).filter(Boolean);

  const teachSignals = /\b(?:teach\s+me|explain(?:\s+(?:in\s+detail|step[-\s]?by[-\s]?step|like\s+i['’]?m|to\s+me))|walk\s+me\s+through|break\s+(?:it|this)\s+down|from\s+scratch|step[-\s]?by[-\s]?step|eli5|deep\s+dive)\b/i.test(lower);
  if (teachSignals) return 'teach-me';

  const formalSignals = /\b(?:kindly|furthermore|moreover|therefore|regarding|per\s+your|with\s+reference\s+to|i\s+would\s+appreciate|could\s+you\s+please|would\s+you\s+be\s+so\s+kind)\b/i.test(lower);
  const casualSignals = /\b(?:yo|hey|dude|bro|sup|lol|lmao|omg|kinda|gonna|wanna|gotta|tbh|ngl|fr|rn|af|idk|imo|thx|thanks?!?)\b/i.test(lower);
  const emojis = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}]/u.test(raw);

  if (formalSignals && !casualSignals) return 'formal';
  if (casualSignals || emojis) return 'casual';

  const wordCount = words.length;
  const hasPunctuation = /[.?!]/.test(raw);
  if (wordCount <= 4 && !hasPunctuation) return 'terse';

  return 'neutral';
}