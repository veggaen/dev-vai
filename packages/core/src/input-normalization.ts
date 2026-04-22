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
  [/\bnextj\b/gi, 'nextjs'],
  [/\bnxtjs\b/gi, 'nextjs'],
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

  out = out.replace(/\s+comma\b/gi, ',');
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