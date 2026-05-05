/**
 * Meta-Constraint Parser
 * ──────────────────────
 * First-pass extraction of *output-shape* constraints from a user prompt,
 * BEFORE any retrieval or skill routing runs. The point is to give every
 * downstream strategy a structured `ConstraintSpec` it must respect, so
 * "reply only with the name", "exactly 5 tokens", "as a dotted list with
 * the father at the top", "within quotes", "in all caps" etc. stop being
 * silently ignored.
 *
 * Pure functions only — no I/O, no engine state. Easy to unit-test.
 *
 * Design notes:
 *   - We intentionally over-extract `coreQuestion` (the input minus the
 *     instruction tail). Downstream strategies still do their own intent
 *     detection on the core; we just hand them a cleaner string.
 *   - We never invent constraints the user did not state. Confidence drops
 *     fast when patterns are ambiguous so callers can choose to bail.
 *   - Conflicts (e.g. "reply only with YES but explain why") are flagged
 *     rather than silently resolved. Engine decides whether to ask for
 *     clarification or pick the stricter constraint.
 */

export type CaseStyle = 'upper' | 'lower' | 'title' | 'sentence';
export type QuoteStyle = 'single' | 'double' | 'backtick';
export type StructureStyle =
  | 'plain'
  | 'dotted-list'
  | 'numbered-list'
  | 'comma-list'
  | 'json'
  | 'single-line'
  | 'haiku'
  | 'morse'
  | 'reverse'
  | 'emoji-only';

export interface FormatConstraints {
  exactCharacterCount?: number;
  maxCharacterCount?: number;
  exactWordCount?: number;
  maxWordCount?: number;
  exactTokenCount?: number;
  exactLineCount?: number;
  mustBeWithinQuotes?: boolean;
  quoteStyle?: QuoteStyle;
  structure?: StructureStyle;
  customStructureDescription?: string;
  mustStartWith?: string;
  mustEndWith?: string;
  caseStyle?: CaseStyle;
  // e.g. "4 letters + the semicolon : in between" → pattern "LL:LL"
  characterPattern?: string;
  digitsOnly?: boolean;
  noPunctuation?: boolean;
}

export interface StyleConstraints {
  role?: string;
  tone?: string;
  language?: 'en' | 'no' | string;
  mustBeConcise?: boolean;
  mustBePoetic?: boolean;
}

export interface MetaConstraints {
  ignorePreviousInstructions?: boolean;
  mustAskAQuestion?: boolean;
  mustNotExplain?: boolean;
  forbiddenWords?: string[];
  requiredWords?: string[];
}

export interface ConstraintSpec {
  coreQuestion: string;
  format: FormatConstraints;
  style: StyleConstraints;
  meta: MetaConstraints;
  conflicts: string[];
  /** 0–1 — how confident we are the user actually meant a strict shape. */
  confidence: number;
  /** True when at least one *strict output-shape* constraint was detected. */
  hasStrictFormat: boolean;
  originalInput: string;
}

const WORD_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

function parseNumberToken(tok: string | undefined | null): number | null {
  if (!tok) return null;
  const lower = tok.toLowerCase();
  if (lower in WORD_NUM) return WORD_NUM[lower];
  const n = Number(lower);
  return Number.isFinite(n) && n > 0 && n < 10_000 ? n : null;
}

/** Strip trailing punctuation (?, !, ., ;) so core-question heuristics line up. */
function trimEnd(s: string): string {
  return s.replace(/[\s?!.,;:]+$/u, '').trim();
}

/**
 * Identify the instruction tail at the end of `input` (the "reply only with…",
 * "answer with exactly N words", "in all caps", "as a dotted list" portion)
 * and return both the tail and the remaining core. We anchor on a small set of
 * verbs the user typically uses to give an output instruction.
 */
const INSTRUCTION_TAIL_RE =
  /(?:[,.;]?\s*(?:and|but|,)?\s*)?\b(?:reply|respond|answer|give|tell|say|format|present|return|render|output|write)\b[\s\S]*$/i;

function splitCoreAndInstruction(input: string): { core: string; instruction: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { core: '', instruction: '' };

  // Find the LAST occurrence of an instruction verb so we keep as much
  // factual core as possible. Walk right-to-left.
  const lower = trimmed.toLowerCase();
  const verbs = ['reply', 'respond', 'answer', 'give me', 'tell me only', 'tell me just', 'format', 'present', 'output', 'render', 'return'];
  let bestIdx = -1;
  for (const v of verbs) {
    const idx = lower.lastIndexOf(v);
    if (idx > bestIdx) bestIdx = idx;
  }

  if (bestIdx <= 0) {
    // Try the regex tail catch as fallback
    const m = trimmed.match(INSTRUCTION_TAIL_RE);
    if (!m || m.index === undefined || m.index === 0) {
      return { core: trimmed, instruction: '' };
    }
    return {
      core: trimEnd(trimmed.slice(0, m.index)),
      instruction: trimmed.slice(m.index),
    };
  }

  // Walk back to a clause boundary (comma/period/" and ")
  const before = trimmed.slice(0, bestIdx);
  const boundary = Math.max(
    before.lastIndexOf(','),
    before.lastIndexOf(';'),
    before.lastIndexOf('. '),
    before.lastIndexOf(' and '),
    before.lastIndexOf(' but '),
  );
  const splitAt = boundary > 0 ? boundary : bestIdx;
  return {
    core: trimEnd(trimmed.slice(0, splitAt)),
    instruction: trimmed.slice(splitAt),
  };
}

// ── Format detectors ────────────────────────────────────────────────────────

function detectFormat(text: string, fullInput: string): FormatConstraints {
  const out: FormatConstraints = {};
  const lower = text.toLowerCase();
  const fullLower = fullInput.toLowerCase();

  // Exact character count
  let m = lower.match(/\bexactly\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+characters?\b/);
  if (m) {
    const n = parseNumberToken(m[1]);
    if (n !== null) out.exactCharacterCount = n;
  }
  m = lower.match(/\b(?:in|with|using)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+characters?\b/);
  if (m && out.exactCharacterCount === undefined) {
    const n = parseNumberToken(m[1]);
    if (n !== null) out.exactCharacterCount = n;
  }

  // Exact word count
  m = lower.match(/\bexactly\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+words?\b/);
  if (m) {
    const n = parseNumberToken(m[1]);
    if (n !== null) out.exactWordCount = n;
  }
  m = lower.match(/\b(?:in|with|using)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+words?\b/);
  if (m && out.exactWordCount === undefined) {
    const n = parseNumberToken(m[1]);
    if (n !== null) out.exactWordCount = n;
  }
  // "no more than N words"
  m = lower.match(/\bno\s+more\s+than\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\s+words?\b/);
  if (m) {
    const n = parseNumberToken(m[1]);
    if (n !== null) out.maxWordCount = n;
  }

  // Exact token count
  m = lower.match(/\b(?:exactly|like|with|using)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+tokens?\b/);
  if (m) {
    const n = parseNumberToken(m[1]);
    if (n !== null) out.exactTokenCount = n;
  }

  // Single word
  if (/\b(?:in|as|with|just|only)\s+(?:a\s+)?(?:single|one)\s+word\b/.test(lower)) {
    out.exactWordCount = 1;
  }

  // Within quotes
  if (/\bwithin\s+["'`]?\s*quotes?\b/.test(lower) || /\binside\s+(?:double\s+)?quotes?\b/.test(lower) || /\b(?:in|inside|within)\s+(?:single|double|back-?tick)\s+quotes?\b/.test(lower)) {
    out.mustBeWithinQuotes = true;
    if (/\bsingle\s+quotes?\b/.test(lower)) out.quoteStyle = 'single';
    else if (/\bback-?tick/.test(lower)) out.quoteStyle = 'backtick';
    else out.quoteStyle = 'double';
  }
  // "within " quotes" with stray double-quote (user typo from real conversation)
  if (!out.mustBeWithinQuotes && /\bwithin\s+["”]\s*quotes?\b/.test(fullLower)) {
    out.mustBeWithinQuotes = true;
    out.quoteStyle = 'double';
  }

  // Case style
  if (/\b(?:in\s+)?all\s+caps\b/.test(lower) || /\b(?:in\s+)?upper\s*case\b/.test(lower) || /\bcapital(?:s|\s+letters)\b/.test(lower)) {
    out.caseStyle = 'upper';
  } else if (/\b(?:in\s+)?(?:all\s+)?lower\s*case\b/.test(lower)) {
    out.caseStyle = 'lower';
  } else if (/\btitle\s*case\b/.test(lower)) {
    out.caseStyle = 'title';
  }

  // Structure
  if (/\bdotted\s+list\b|\bbullet(?:ed)?\s+list\b|\bbullet\s+points?\b/.test(lower)) {
    out.structure = 'dotted-list';
  } else if (/\bnumbered\s+list\b|\bordered\s+list\b/.test(lower)) {
    out.structure = 'numbered-list';
  } else if (/\bcomma[\s-]*separated\b|\bcomma\s+list\b/.test(lower)) {
    out.structure = 'comma-list';
  } else if (/\bas\s+(?:a\s+)?json\b|\bin\s+json\b|\bjson\s+(?:object|format)\b/.test(lower)) {
    out.structure = 'json';
  } else if (/\bsingle\s+line\b|\bone\s+line\b/.test(lower)) {
    out.structure = 'single-line';
  } else if (/\bhaiku\b/.test(lower)) {
    out.structure = 'haiku';
  } else if (/\bemoji\s+only\b|\bonly\s+emoji\b|\busing\s+only\s+emoji\b/.test(lower)) {
    out.structure = 'emoji-only';
  } else if (/\bspelled?\s+backwards?\b|\bin\s+reverse\b/.test(lower)) {
    out.structure = 'reverse';
  } else if (/\bmorse\s+code\b/.test(lower)) {
    out.structure = 'morse';
  }

  // Free-form custom structure description (e.g. "with the father name at top")
  const customDesc = text.match(/\bas\s+a?\s+([^.,;]{6,160})/i)?.[1]?.trim();
  if (customDesc && !out.customStructureDescription && (out.structure || /\b(?:list|table|format)\b/i.test(customDesc))) {
    out.customStructureDescription = customDesc;
  }

  // Custom character pattern: "4 letters + the semicolon : in between"
  // (the user often types the symbol *after* naming it, e.g. "semicolon :".
  // When name and symbol disagree we trust the *typed symbol*, since that is
  // the visible literal the user expects to see in the output.)
  const charPat = lower.match(/(\d+)\s+letters?\s*\+?\s*(?:the\s+)?(semicolon|colon|comma|dash|hyphen|period|dot|space|slash)\s*([:;,.\-/])?\s*[:;,.\-/\s]*\s+(?:in\s+between|between|in\s+the\s+middle)/);
  if (charPat) {
    const count = Number(charPat[1]);
    const named = ({
      semicolon: ';',
      colon: ':',
      comma: ',',
      dash: '-',
      hyphen: '-',
      period: '.',
      dot: '.',
      space: ' ',
      slash: '/',
    } as Record<string, string>)[charPat[2]];
    const literal = charPat[3]; // user-typed symbol — wins over the name
    const sep = literal ?? named;
    if (count > 0 && sep) {
      const half = Math.floor(count / 2);
      const rest = count - half;
      out.characterPattern = `${'L'.repeat(half)}${sep}${'L'.repeat(rest)}`;
      out.exactCharacterCount = count + sep.length;
    }
  }

  // Digits only / numbers only
  if (/\bonly\s+(?:the\s+)?numbers?\b|\bjust\s+(?:the\s+)?numbers?\b|\bdigits?\s+only\b/.test(lower)) {
    out.digitsOnly = true;
  }
  if (/\bno\s+punctuation\b|\bwithout\s+punctuation\b/.test(lower)) {
    out.noPunctuation = true;
  }

  return out;
}

// ── Style detectors ─────────────────────────────────────────────────────────

function detectStyle(text: string, fullInput: string): StyleConstraints {
  const out: StyleConstraints = {};
  const lower = text.toLowerCase();
  const full = fullInput.toLowerCase();

  // Role
  const roleMatch = lower.match(/\b(?:as\s+(?:if\s+you\s+(?:were|are)\s+)?|in\s+the\s+(?:voice|style)\s+of\s+)(?:a\s+)?([a-z][a-z\s'-]{2,40})\b/);
  if (roleMatch) {
    const candidate = roleMatch[1].trim();
    // Filter common non-role tail words
    if (!/^(?:dotted|numbered|comma|json|list|sentence|paragraph|haiku|table)$/.test(candidate)) {
      out.role = candidate.split(/\s+/).slice(0, 4).join(' ');
    }
  }

  // Concise / brief
  if (/\b(?:be\s+)?(?:concise|brief|short|terse|minimal)\b/.test(lower)) {
    out.mustBeConcise = true;
  }

  // Language hint
  if (/\bsvar\s+(?:bare\s+)?p[åa]\s+norsk\b|\bp[åa]\s+norsk\b|\bin\s+norwegian\b/.test(full)) {
    out.language = 'no';
  } else if (/\bin\s+english\b|\bp[åa]\s+engelsk\b/.test(full)) {
    out.language = 'en';
  }

  // Poetic
  if (/\bhaiku\b|\bpoem\b|\briddle\b|\bverse\b/.test(lower)) {
    out.mustBePoetic = true;
  }

  return out;
}

// ── Meta detectors ──────────────────────────────────────────────────────────

function detectMeta(text: string, fullInput: string): MetaConstraints {
  const out: MetaConstraints = {};
  const lower = text.toLowerCase();
  const full = fullInput.toLowerCase();

  if (/\bignore\s+(?:all\s+)?previous\s+instructions?\b/.test(full) || /\bdisregard\s+(?:all\s+)?(?:prior|previous)\s+instructions?\b/.test(full)) {
    out.ignorePreviousInstructions = true;
  }
  if (/\bask\s+(?:me\s+)?a\s+question\b|\breply\s+with\s+a\s+question\b|\brespond\s+with\s+a\s+question\b/.test(full)) {
    out.mustAskAQuestion = true;
  }
  if (/\bno\s+explanation\b|\bdo\s+not\s+explain\b|\bdon'?t\s+explain\b|\bwithout\s+explanation\b|\bno\s+(?:extra|additional)\s+text\b/.test(lower)) {
    out.mustNotExplain = true;
  }

  // "do not use the word X"
  const banWords = full.match(/\bdo\s+not\s+(?:use|say)\s+(?:the\s+(?:words?|terms?))?\s*([a-z][a-z\s,'-]{2,80})/);
  if (banWords) {
    const list = banWords[1]
      .split(/[,\s]+(?:and|or|nor)?[,\s]*/)
      .map(w => w.trim())
      .filter(w => /^[a-z][a-z'-]{0,30}$/i.test(w));
    if (list.length > 0) out.forbiddenWords = list.slice(0, 8);
  }

  return out;
}

// ── Strict-format detection (does the user demand a *constrained* output?) ──

const STRICT_TRIGGERS_RE =
  /\b(?:reply|respond|answer|tell\s+me|give\s+me)\s+(?:with\s+)?(?:only|just)\b/i;
const STRICT_TRIGGERS_FRONT_RE =
  /^(?:only|just)\s+(?:reply|respond|answer|tell|give|say)\b/i;

function isStrictFormat(input: string, format: FormatConstraints): boolean {
  // Require at least one CONCRETE shape constraint. The "reply only with…"
  // trigger alone isn't enough — natural sentences contain it constantly
  // ("respond with only the name of the king" is a request to short-list,
  // not a strict output-shape specification). The enforcer should only
  // intercept when the user actually constrains the *form* of the answer.
  if (
    format.exactCharacterCount !== undefined ||
    format.exactWordCount !== undefined ||
    format.exactTokenCount !== undefined ||
    format.exactLineCount !== undefined ||
    format.maxWordCount !== undefined ||
    format.mustBeWithinQuotes ||
    format.characterPattern ||
    format.digitsOnly ||
    format.caseStyle ||
    format.structure === 'haiku' ||
    format.structure === 'morse' ||
    format.structure === 'reverse' ||
    format.structure === 'emoji-only' ||
    format.structure === 'dotted-list' ||
    format.structure === 'numbered-list' ||
    format.structure === 'comma-list' ||
    format.structure === 'json'
  ) return true;
  return false;
}

// ── Conflict detection ──────────────────────────────────────────────────────

function detectConflicts(spec: ConstraintSpec): string[] {
  const out: string[] = [];

  // "reply only with YES but explain why"
  const lower = spec.originalInput.toLowerCase();
  const hasReplyOnly = STRICT_TRIGGERS_RE.test(spec.originalInput) || STRICT_TRIGGERS_FRONT_RE.test(spec.originalInput.trim());
  const wantsExplanation = /\b(?:explain|tell\s+me\s+why|describe\s+(?:why|how)|give\s+(?:reasoning|reasons))\b/.test(lower);
  if (hasReplyOnly && wantsExplanation && !spec.meta.mustNotExplain) {
    out.push('User asked for an "only" reply AND for an explanation — these conflict.');
  }

  // "exactly 0 tokens/words/characters"
  if (spec.format.exactWordCount === 0 || spec.format.exactCharacterCount === 0 || spec.format.exactTokenCount === 0) {
    out.push('Requested zero-length output is unsatisfiable.');
  }

  // word count vs structure that needs more than that
  if (spec.format.exactWordCount !== undefined && spec.format.structure === 'haiku' && spec.format.exactWordCount < 5) {
    out.push('Word count too small for a haiku.');
  }

  // exact word count + "as a full sentence" both stated
  if (spec.format.exactWordCount !== undefined && /\bfull\s+sentence\b/.test(lower) && spec.format.exactWordCount < 4) {
    out.push('Exact word count is too small to form a full sentence.');
  }

  return out;
}

/**
 * Public entry point.
 *
 * Returns `null` ONLY when the input is empty. For every non-empty input we
 * return a spec — `hasStrictFormat` tells the caller whether to short-circuit
 * the strategy chain through the format enforcer.
 */
export function parseConstraintSpec(input: string): ConstraintSpec | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const { core, instruction } = splitCoreAndInstruction(trimmed);
  const haystack = instruction.length > 0 ? instruction : trimmed;

  const format = detectFormat(haystack, trimmed);
  const style = detectStyle(haystack, trimmed);
  const meta = detectMeta(haystack, trimmed);

  // confidence: count signals
  let signals = 0;
  if (format.exactCharacterCount !== undefined) signals++;
  if (format.exactWordCount !== undefined) signals++;
  if (format.exactTokenCount !== undefined) signals++;
  if (format.mustBeWithinQuotes) signals++;
  if (format.caseStyle) signals++;
  if (format.structure) signals++;
  if (format.characterPattern) signals++;
  if (style.role) signals++;
  if (meta.mustNotExplain) signals++;
  if (STRICT_TRIGGERS_RE.test(trimmed) || STRICT_TRIGGERS_FRONT_RE.test(trimmed)) signals++;

  const confidence = Math.min(1, signals / 3);

  const spec: ConstraintSpec = {
    coreQuestion: core.length > 0 ? core : trimmed,
    format,
    style,
    meta,
    conflicts: [],
    confidence,
    hasStrictFormat: isStrictFormat(trimmed, format),
    originalInput: trimmed,
  };

  spec.conflicts = detectConflicts(spec);
  return spec;
}
