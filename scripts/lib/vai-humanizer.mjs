/**
 * Natural-conversation humanizer for audit prompts.
 *
 * The audit waves emit task-shaped prompts: a `CANARY-123-1:` ticket prefix
 * glued onto every turn plus stiff "reply only with a JSON dictionary.
 * properties: ..." contract phrasing. A real person texting an engineering
 * partner does NOT type either of those. This module rewrites a prompt into the
 * way an actual human would send it:
 *   1. strip the glued canary prefix (weave it in naturally on the FIRST turn
 *      of a thread only, the way an engineer references a ticket once);
 *   2. paraphrase the stiff contract sentences into natural requests;
 *   3. apply a light texting register (lowercase, a few abbreviations, dropped
 *      terminal punctuation, occasional opener) WITHOUT the awkward 2/4/b
 *      number-homophone swaps that made earlier output read like a test.
 *
 * CRITICAL: never destroy a token the rubric scores the REPLY against, or a
 * "fail" would be a broken test, not a model gap. Protected spans are masked
 * before mutation and restored afterward (paths, hosts, snake_case keys, the
 * word "json", integers, backtick code, language names). Paraphrases re-emit
 * the captured key list verbatim so JSON-contract grading still holds.
 */

const PROTECT_PATTERNS = [
  // JSON key list emitted by a paraphrase ("...json with a, b, c?") — the comma
  // separators are gradeable, so mask the whole clause before mutation.
  /\b(?:with|keys|for me,)\s+[a-z_]+(?:,\s*[a-z_]+)+\??/gi,
  /`[^`]*`/g, // inline code spans
  /\b[A-Z]{3,}-\d+(?:-\d+)?\b/g, // canary markers (when kept inline)
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/g, // IPv4
  /::1\b|(?<![\w:])::(?![\w:])/g, // IPv6 loopback / unspecified
  /\/[\w./-]+/g, // unix paths
  /\b[a-z]+(?:_[a-z]+)+\b/gi, // snake_case identifiers / json keys
  /\bjson\b/gi, // the literal word json (contract keyword)
  /\b\d+\b/g, // standalone integers (arithmetic / counts)
];

const LANGUAGE_NAMES = [
  'TypeScript', 'JavaScript', 'Python', 'Rust', 'Golang', 'Go', 'C\\+\\+', 'C#', 'Java', 'Kotlin', 'Swift', 'Ruby', 'PHP',
];
const LANGUAGE_RE = new RegExp(`\\b(?:${LANGUAGE_NAMES.join('|')})\\b`, 'g');
const CANARY_RE = /\b[A-Z]{3,}-\d+(?:-\d+)?\b/;

// Whole-word casual substitutions. None of these are tokens any rubric scores
// against. The number-homophone swaps (to->2, for->4, be->b) are deliberately
// excluded: they read awkwardly ("ok 2 go live") and added no realism.
const WORD_SUBS = new Map([
  ['you', 'u'], ['your', 'ur'], ["you're", 'ur'], ['youre', 'ur'],
  ['are', 'r'], ['please', 'pls'], ['because', 'bc'], ['about', 'abt'],
  ['tomorrow', 'tmrw'], ['with', 'w/'], ['without', 'w/o'],
  ['through', 'thru'], ['though', 'tho'], ['and', 'n'],
]);
const RISKY_SUBS = new Set(['and', 'are']); // fire only sometimes

const OPENERS = ['', '', '', 'hey ', 'ok so ', 'ngl ', 'lowkey ', 'sooo '];
const TYPO_MAP = new Map([
  ['what', 'wat'], ['just', 'jsut'], ['want', 'wnat'],
  ['make', 'mkae'], ['change', 'chnage'], ['help', 'hepl'],
]);

function makeRandom(seedString) {
  let h = 2166136261 >>> 0;
  for (const ch of seedString) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function choose(random, values) {
  return values[Math.floor(random() * values.length)];
}

/**
 * Natural paraphrases for the stiff, contract-shaped sentences in the audit
 * corpus. Each entry captures any gradeable fragment (key list, etc.) and
 * re-emits it so grading still holds. Applied on raw text before masking.
 */
const PHRASE_REWRITES = [
  {
    re: /\breply only with a json dictionary\.?\s*properties:\s*([^.?!]+?)\s*\.?\s*$/i,
    variants: (keys) => [
      `can u give that back as json with ${keys}?`,
      `just hit me back w/ json — keys ${keys}`,
      `put it in json for me, ${keys}`,
    ],
  },
  {
    re: /\btell me you understand\.?/i,
    variants: () => ['u follow?', 'u got that?', 'that make sense?'],
  },
  {
    re: /\breflect that back\.?/i,
    variants: () => ['can u say that back to me?', 'just repeat that back so im sure we agree'],
  },
  {
    re: /\bsuggest the safer node check\.?/i,
    variants: () => ['whats the safer node check?', 'how would u check it safer in node?'],
  },
  {
    re: /\bwhat would u ask first before diagnosing\?\s*ask one question\.?/i,
    variants: () => ['whats the first thing youd ask before digging in?', 'if u could ask one thing first whats it gonna be?'],
  },
  {
    re: /\bin 2 bullets,?\s*what changes from a security standpoint\?/i,
    variants: () => ['whats the security tradeoff here? couple quick points', 'how does that change things security-wise, like 2 bullets?'],
  },
  {
    re: /\bwalk me through the top suspect and three checks\.?/i,
    variants: () => ['whats ur top suspect n like 3 things youd check?', 'gimme the main suspect plus 3 checks'],
  },
  {
    re: /\bwhen i name a project later, keep its language straight\.?/i,
    variants: () => ['when i mention one later just keep the languages straight', 'keep track of which one is which for me'],
  },
  {
    re: /\bkeep that in mind pls\.?/i,
    variants: () => ['keep that in mind', 'remember that for me'],
  },
  {
    re: /\bstick to my updated preference\.?/i,
    variants: () => ['use what i just said', 'go with the new one'],
  },
];

function maskProtected(text) {
  const tokens = [];
  let masked = text;
  const mask = (pattern) => {
    masked = masked.replace(pattern, (match) => {
      const id = `\uF8FF${String.fromCodePoint(0xe000 + tokens.length)}\uF8FF`;
      tokens.push(match);
      return id;
    });
  };
  mask(LANGUAGE_RE);
  for (const pattern of PROTECT_PATTERNS) mask(pattern);
  return { masked, tokens };
}

function restoreProtected(text, tokens) {
  return text.replace(/\uF8FF([\uE000-\uF7FF])\uF8FF/g, (_match, ch) => tokens[ch.codePointAt(0) - 0xe000] ?? '');
}

function applyPhraseRewrites(text, random) {
  let out = text;
  for (const { re, variants } of PHRASE_REWRITES) {
    out = out.replace(re, (...args) => {
      const groups = args.slice(1, -2); // drop offset + whole string
      const list = variants(...groups.map((g) => (g ?? '').trim()));
      return choose(random, list);
    });
  }
  return out;
}

function tokenMutate(masked, random) {
  const words = masked.split(/(\s+)/);
  const out = words.map((token) => {
    if (/^\s+$/.test(token) || token.includes('\uF8FF')) return token;
    const leadMatch = token.match(/^[^A-Za-z]*/)[0];
    const tailMatch = token.match(/[^A-Za-z]*$/)[0];
    const core = token.slice(leadMatch.length, token.length - tailMatch.length);
    const lower = core.toLowerCase();
    if (!lower) return token;

    let replacement = lower;
    if (WORD_SUBS.has(lower)) {
      if (!RISKY_SUBS.has(lower) || random() < 0.4) replacement = WORD_SUBS.get(lower);
    } else if (TYPO_MAP.has(lower) && random() < 0.18) {
      replacement = TYPO_MAP.get(lower);
    }

    // Occasionally drop a leading article (omission of function words).
    if ((lower === 'the' || lower === 'a') && random() < 0.3) return '\u0001';

    let tail = tailMatch;
    if (/[.,]$/.test(tail) && random() < 0.7) tail = tail.replace(/[.,]+$/, '');
    return `${leadMatch}${replacement}${tail}`;
  });
  return out.join('').replace(/\s*\u0001\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Humanize a single prompt into natural texting register deterministically.
 * @param {string} prompt raw audit prompt (may carry a glued canary prefix)
 * @param {string} seedString stable per-turn seed so runs are reproducible
 * @param {{ isFirstTurn?: boolean }} [options]
 * @returns {string}
 */
export function humanizeText(prompt, seedString = 'humanize', options = {}) {
  const random = makeRandom(`${seedString}:${prompt}`);
  const isFirstTurn = options.isFirstTurn !== false;

  // 1. Pull off any leading wave opener ("hey - ", "quick q: ", ...) and the
  //    glued canary prefix so we control the natural phrasing ourselves.
  let body = prompt.trim();
  body = body.replace(/^(?:hey\s*-\s*|quick q:\s*|sorry for the messy wording:\s*|one sec,\s*)/i, '');
  let canary = null;
  const prefixMatch = body.match(new RegExp(`^(${CANARY_RE.source}):\\s*`));
  if (prefixMatch) {
    canary = prefixMatch[1];
    body = body.slice(prefixMatch[0].length);
  }

  // 2. Natural paraphrases for the stiff contract sentences.
  body = applyPhraseRewrites(body, random);

  // 3. Light texting register over the body (protected tokens masked).
  const { masked, tokens } = maskProtected(body);
  let result = tokenMutate(masked, random);

  // 4. Natural opener; reference the ticket once, on the first turn only, the
  //    way a person actually opens a thread ("re GATE-352-1 — ...").
  const opener = choose(random, OPENERS);
  result = opener + result;
  result = result.charAt(0).toLowerCase() + result.slice(1);
  if (canary && isFirstTurn && random() < 0.7) {
    const lead = choose(random, [`re ${canary} — `, `re: ${canary}, `, `${canary}: `, `quick one on ${canary} — `]);
    result = lead + result;
  }

  // 5. Occasional trailing reactive token.
  if (random() < 0.12) result += random() < 0.5 ? ' lol' : ' tbh';

  // Collapse an accidental doubled opener word ("hey hey ...").
  result = result.replace(/\b(hey|yo|ok so)\s+\1\b/i, '$1');

  return restoreProtected(result, tokens);
}

export default { humanizeText };
