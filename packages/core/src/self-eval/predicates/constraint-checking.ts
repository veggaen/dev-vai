/**
 * Constraint-checking predicates — the only sub-capability registered this turn.
 *
 * See docs/capabilities/self-evaluation.md §6.
 *
 * Four predicates:
 *   1. format-line-count   — "in N lines/bullets/points"
 *   2. word-count-exact    — "exactly N words" (soft variants deferred)
 *   3. char-ban            — "no letter X" / "without using X" / "do not use ..."
 *   4. topic-presence      — gated firing on explicit topic-anchor phrases (option (b))
 *
 * Each predicate ships derive(input) (cheap parser) and check(candidate)
 * (verifier). `derive` returns null when the predicate doesn't apply.
 */

import type { Message } from '../../models/adapter.js';
import { extractTopicFromQuery } from '../../input-normalization.js';
import type { CompiledPredicate, ResponsePredicate } from '../types.js';

// ───────────────────────────── Helpers ─────────────────────────────

const WORDS_TO_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};

function parseCount(token: string): number | null {
  const lower = token.toLowerCase();
  if (lower in WORDS_TO_NUM) return WORDS_TO_NUM[lower];
  const n = Number(lower);
  return Number.isFinite(n) && n > 0 && n < 10000 ? n : null;
}

/** Strip leading/trailing whitespace, collapse internal whitespace, count words. */
function countWords(s: string): number {
  const trimmed = s.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/** Strip a trailing terminal punctuation token if it stands alone after a word. */
function stripTrailingPunctTokens(s: string): string {
  return s.replace(/\s*[.!?,;:]\s*$/g, '');
}

// ───────────────────── 1. format-line-count ─────────────────────

const LINE_COUNT_PATTERNS: ReadonlyArray<{ re: RegExp; unit: 'line' | 'bullet' | 'sentence' }> = [
  { re: /\b(?:in|using|with|exactly|just|only)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+lines?\b/i, unit: 'line' },
  { re: /\b(?:in|using|with|exactly|just|only)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+bullets?(?:\s+points?)?\b/i, unit: 'bullet' },
  { re: /\b(?:in|using|with|exactly|just|only)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+bullet\s+points?\b/i, unit: 'bullet' },
  { re: /\b(?:in|using|with|exactly|just|only)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+sentences?\b/i, unit: 'sentence' },
];

export const formatLineCount: ResponsePredicate = {
  id: 'format-line-count',
  derive(input: string): CompiledPredicate | null {
    for (const { re, unit } of LINE_COUNT_PATTERNS) {
      const m = re.exec(input);
      if (!m) continue;
      const n = parseCount(m[1]);
      if (n === null) continue;
      return {
        id: 'format-line-count',
        description: `Response must contain exactly ${n} ${unit}${n === 1 ? '' : 's'}.`,
        check(candidate: string) {
          const trimmed = candidate.trim();
          let actual: number;
          if (unit === 'line') {
            actual = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
          } else if (unit === 'bullet') {
            actual = (trimmed.match(/^\s*[-*•]\s+\S/gm) ?? []).length;
            // If the response is plainly numbered ("1. ...", "2. ..."), count those too.
            if (actual === 0) {
              actual = (trimmed.match(/^\s*\d+[.)]\s+\S/gm) ?? []).length;
            }
          } else {
            // sentence — naive: terminal punctuation counts.
            actual = (trimmed.match(/[.!?](?:\s|$)/g) ?? []).length;
          }
          if (actual === n) return { ok: true };
          return {
            ok: false,
            hint: `Response must contain exactly ${n} ${unit}${n === 1 ? '' : 's'} (got ${actual}).`,
          };
        },
      };
    }
    return null;
  },
};

// ───────────────────── 2. word-count-exact ─────────────────────

const WORD_COUNT_EXACT_RE =
  /\bexactly\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+words?\b/i;
const WORD_COUNT_IN_N_RE =
  /\bin\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+words?\b/i;
// Soft markers we deliberately do NOT register this turn.
// Match only when the marker IS adjacent to the count (so "exactly 5 words about cats"
// is NOT swallowed by the literal word "about" elsewhere in the prompt).
const SOFT_MARKER_NEAR_COUNT_RE =
  /\b(?:about|around|roughly|approximately|near(?:ly)?)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+words?\b/i;

export const wordCountExact: ResponsePredicate = {
  id: 'word-count-exact',
  derive(input: string): CompiledPredicate | null {
    const m = WORD_COUNT_EXACT_RE.exec(input) ?? WORD_COUNT_IN_N_RE.exec(input);
    if (!m) return null;
    // Soft-constraint phrasing → defer (per design §6 — soft variants deferred this turn).
    if (SOFT_MARKER_NEAR_COUNT_RE.test(input)) return null;
    const n = parseCount(m[1]);
    if (n === null) return null;
    return {
      id: 'word-count-exact',
      description: `Response must contain exactly ${n} words.`,
      check(candidate: string) {
        const stripped = stripTrailingPunctTokens(candidate.trim());
        const actual = countWords(stripped);
        if (actual === n) return { ok: true };
        return {
          ok: false,
          hint: `Response must contain exactly ${n} words (got ${actual}).`,
        };
      },
    };
  },
};

// ───────────────────── 3. char-ban ─────────────────────

const NO_LETTER_RE = /\bno\s+letter\s+([A-Za-z])\b/i;
const WITHOUT_LETTER_RE = /\bwithout\s+(?:using\s+)?(?:the\s+)?letter\s+([A-Za-z])\b/i;
const NO_WORD_RE = /\bdo\s+not\s+use\s+(?:the\s+words?|the\s+terms?)\s+((?:[a-z][a-z'-]*(?:\s*,\s*|\s+(?:and|or)\s+|\s+))+[a-z][a-z'-]*)\b/i;
const WITHOUT_WORDS_RE = /\bwithout\s+(?:using\s+)?(?:the\s+)?words?\s+((?:[a-z][a-z'-]*(?:\s*,\s*|\s+(?:and|or)\s+|\s+))+[a-z][a-z'-]*)\b/i;
const NEVER_USE_RE = /\bnever\s+(?:use|say)\s+the\s+words?\s+((?:[a-z][a-z'-]*(?:\s*,\s*|\s+(?:and|or)\s+|\s+))+[a-z][a-z'-]*)\b/i;

function parseWordBanList(raw: string): string[] {
  return raw
    .split(/\s*,\s*|\s+(?:and|or)\s+|\s+/i)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0 && /^[a-z][a-z'-]*$/.test(w));
}

export const charBan: ResponsePredicate = {
  id: 'char-ban',
  derive(input: string): CompiledPredicate | null {
    const letterMatch = NO_LETTER_RE.exec(input) ?? WITHOUT_LETTER_RE.exec(input);
    if (letterMatch) {
      const letter = letterMatch[1];
      const re = new RegExp(letter, 'i');
      return {
        id: 'char-ban',
        description: `Response must not contain the letter '${letter}'.`,
        check(candidate: string) {
          if (!re.test(candidate)) return { ok: true };
          return { ok: false, hint: `Response must not contain the letter '${letter}'.` };
        },
      };
    }
    const wordMatch =
      NO_WORD_RE.exec(input) ?? WITHOUT_WORDS_RE.exec(input) ?? NEVER_USE_RE.exec(input);
    if (wordMatch) {
      const banned = parseWordBanList(wordMatch[1]);
      if (banned.length === 0) return null;
      const banRes = banned.map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i'));
      return {
        id: 'char-ban',
        description: `Response must not contain banned words: ${banned.join(', ')}.`,
        check(candidate: string) {
          for (let i = 0; i < banRes.length; i++) {
            if (banRes[i].test(candidate)) {
              return { ok: false, hint: `Response must not contain the word "${banned[i]}".` };
            }
          }
          return { ok: true };
        },
      };
    }
    return null;
  },
};

// ───────────────────── 4. topic-presence (gated firing — option b) ─────────────────────

/**
 * Per design §6 final approach: derive returns non-null ONLY when the prompt
 * contains an explicit topic-anchor phrase. Otherwise no-op. This is the
 * narrow path; synonym-map (option a) is the future expansion.
 */
const TOPIC_ANCHOR_RE =
  /\b(?:stay\s+on\s+(?:topic|subject)|only\s+about|strictly\s+about|must\s+be\s+about|do\s+not\s+deviate|don'?t\s+(?:deviate|change\s+(?:topic|subject))|focus\s+(?:on|only\s+on)|the\s+topic\s+is|topic[:\s]+is|stay\s+focused\s+on|just\s+about|exclusively\s+about|regarding\s+only|about\s+(?:only|just))\b/i;

/** Tokens to ignore when picking the topic head. */
const TOPIC_STOP = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'i', 'you', 'we', 'they', 'it', 'on',
  'in', 'at', 'of', 'for', 'and', 'or', 'but', 'topic', 'subject',
  'only', 'just', 'about', 'please', 'tell', 'me', 'us', 'must',
  // anchor verbs (so "Stay on topic: hammers" picks 'hammers', not 'stay')
  'stay', 'focus', 'focused', 'deviate', 'change', 'regarding',
  'strictly', 'exclusively', 'must', 'should', 'shall', 'topic',
]);

function pickTopicHead(extracted: string): string | null {
  if (!extracted) return null;
  const tokens = extracted.toLowerCase().match(/[a-z][a-z'-]+/g) ?? [];
  for (const tok of tokens) {
    if (tok.length >= 4 && !TOPIC_STOP.has(tok)) return tok;
  }
  // Fallback: longest token.
  let longest = '';
  for (const tok of tokens) {
    if (tok.length > longest.length && !TOPIC_STOP.has(tok)) longest = tok;
  }
  return longest.length >= 3 ? longest : null;
}

export const topicPresence: ResponsePredicate = {
  id: 'topic-presence',
  derive(input: string): CompiledPredicate | null {
    if (!TOPIC_ANCHOR_RE.test(input)) return null;
    const extracted = extractTopicFromQuery(input);
    const head = pickTopicHead(extracted);
    if (!head) return null;
    const re = new RegExp(`\\b${head.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`, 'i');
    return {
      id: 'topic-presence',
      description: `Response must mention the topic '${head}'.`,
      check(candidate: string) {
        if (re.test(candidate)) return { ok: true };
        return {
          ok: false,
          hint: `Response must mention the prompt topic '${head}'.`,
        };
      },
    };
  },
};

// ───────────────────── 5. quote-wrap (mustBeWithinQuotes) ─────────────────────

const QUOTE_WRAP_RE =
  /\b(?:within|inside|in|wrapped\s+in)\s+(?:single|double|back-?tick)?\s*["'`]?\s*quotes?\b/i;

export const quoteWrap: ResponsePredicate = {
  id: 'quote-wrap',
  derive(input: string): CompiledPredicate | null {
    if (!QUOTE_WRAP_RE.test(input)) return null;
    const wantsSingle = /\bsingle\s+quotes?\b/i.test(input);
    const wantsBacktick = /\bback-?tick/i.test(input);
    const open = wantsBacktick ? '`' : wantsSingle ? "'" : '"';
    return {
      id: 'quote-wrap',
      description: `Response must be wrapped in ${open} quotes.`,
      check(candidate: string) {
        const t = candidate.trim();
        if (t.length < 2) return { ok: false, hint: 'Response too short to be quoted.' };
        const first = t[0];
        const last = t[t.length - 1];
        const ok = (first === open || first === '“' || first === "'" || first === '"' || first === '`')
          && (last === open || last === '”' || last === "'" || last === '"' || last === '`');
        if (ok) return { ok: true };
        return { ok: false, hint: `Response must be wrapped in ${open}…${open} quotes.` };
      },
    };
  },
};

// ───────────────────── 6. case-style (all-caps / lowercase) ─────────────────────

const ALL_CAPS_RE = /\b(?:in\s+)?(?:all\s+caps|upper\s*case|capital\s+letters)\b/i;
const ALL_LOWER_RE = /\b(?:in\s+)?(?:all\s+)?lower\s*case\b/i;

export const caseStyle: ResponsePredicate = {
  id: 'case-style',
  derive(input: string): CompiledPredicate | null {
    const wantsUpper = ALL_CAPS_RE.test(input);
    const wantsLower = !wantsUpper && ALL_LOWER_RE.test(input);
    if (!wantsUpper && !wantsLower) return null;
    return {
      id: 'case-style',
      description: wantsUpper ? 'Response must be in UPPERCASE.' : 'Response must be in lowercase.',
      check(candidate: string) {
        // Compare against letters only — ignore digits/punctuation.
        const letters = candidate.replace(/[^A-Za-z]+/g, '');
        if (letters.length === 0) return { ok: true };
        if (wantsUpper && letters === letters.toUpperCase()) return { ok: true };
        if (wantsLower && letters === letters.toLowerCase()) return { ok: true };
        return {
          ok: false,
          hint: wantsUpper
            ? 'Response must be in UPPERCASE letters only.'
            : 'Response must be in lowercase letters only.',
        };
      },
    };
  },
};

// ───────────────────── 7. char-pattern (e.g. "LL:LL") ─────────────────────

const CHAR_PATTERN_RE =
  /(\d+)\s+letters?\s*\+?\s*(?:the\s+)?(semicolon|colon|comma|dash|hyphen|period|dot|space|slash)\s*([:;,.\-/])?\s*[:;,.\-/\s]*\s+(?:in\s+between|between|in\s+the\s+middle)/i;

const SEP_NAME_TO_SYM: Record<string, string> = {
  semicolon: ';', colon: ':', comma: ',', dash: '-', hyphen: '-',
  period: '.', dot: '.', space: ' ', slash: '/',
};

export const charPattern: ResponsePredicate = {
  id: 'char-pattern',
  derive(input: string): CompiledPredicate | null {
    const m = CHAR_PATTERN_RE.exec(input);
    if (!m) return null;
    const count = Number(m[1]);
    const sep = m[3] ?? SEP_NAME_TO_SYM[m[2].toLowerCase()];
    if (!count || !sep) return null;
    const half = Math.floor(count / 2);
    const rest = count - half;
    const expectedLen = count + sep.length;
    return {
      id: 'char-pattern',
      description: `Response must be exactly ${expectedLen} chars: ${half} chars + '${sep}' + ${rest} chars.`,
      check(candidate: string) {
        const t = candidate.trim();
        if (t.length !== expectedLen) {
          return { ok: false, hint: `Expected ${expectedLen} characters, got ${t.length}.` };
        }
        if (t[half] !== sep) {
          return { ok: false, hint: `Expected separator '${sep}' at position ${half + 1}.` };
        }
        return { ok: true };
      },
    };
  },
};

// ───────────────────── Bundle ─────────────────────

export const CONSTRAINT_CHECKING_PREDICATES: readonly ResponsePredicate[] = [
  formatLineCount,
  wordCountExact,
  charBan,
  topicPresence,
  quoteWrap,
  caseStyle,
  charPattern,
];
