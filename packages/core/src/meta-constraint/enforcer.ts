/**
 * Format Enforcer
 * ───────────────
 * Given a `ConstraintSpec` and a raw answer string, shape the answer so it
 * obeys the spec — or return null to signal "I couldn't satisfy this without
 * lying, ask the caller to fall back".
 *
 * Pure functions, no I/O. The engine wires this in through
 * `tryStrictFormatEnforcer()`.
 */

import type { ConstraintSpec, FormatConstraints } from './parser.js';

const QUOTE_OPEN: Record<string, string> = { single: "'", double: '"', backtick: '`' };
const QUOTE_CLOSE: Record<string, string> = { single: "'", double: '"', backtick: '`' };

const MORSE: Record<string, string> = {
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.',
  h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.',
  o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-',
  v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
};

function toMorse(s: string): string {
  return s
    .toLowerCase()
    .split('')
    .map(ch => (ch === ' ' ? '/' : MORSE[ch] ?? ''))
    .filter(Boolean)
    .join(' ');
}

function applyCase(s: string, style: FormatConstraints['caseStyle']): string {
  if (!style) return s;
  switch (style) {
    case 'upper': return s.toUpperCase();
    case 'lower': return s.toLowerCase();
    case 'title':
      return s.replace(/\b\w/g, ch => ch.toUpperCase());
    case 'sentence':
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
}

function stripPunctuation(s: string): string {
  return s.replace(/[.,;:!?"'`(){}\[\]]/g, '').replace(/\s+/g, ' ').trim();
}

function digitsOnly(s: string): string {
  return s.replace(/\D+/g, '');
}

function quoteWrap(s: string, style: FormatConstraints['quoteStyle']): string {
  const o = QUOTE_OPEN[style ?? 'double'] ?? '"';
  const c = QUOTE_CLOSE[style ?? 'double'] ?? '"';
  // Strip pre-existing wrapping quotes to avoid doubling
  const inner = s.replace(/^["'`“”]+|["'`“”]+$/g, '');
  return `${o}${inner}${c}`;
}

function trimToWords(s: string, n: number): string {
  const words = s.split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(' ');
}

function asDottedList(items: string[]): string {
  return items.map(i => `• ${i.trim()}`).join('\n');
}

function asNumberedList(items: string[]): string {
  return items.map((i, idx) => `${idx + 1}. ${i.trim()}`).join('\n');
}

function asCommaList(items: string[]): string {
  return items.map(i => i.trim()).filter(Boolean).join(', ');
}

/** Split a multi-sentence/paragraph answer into list-friendly items. */
function splitIntoItems(answer: string): string[] {
  // Prefer existing bullet/dash/numbered markers
  const lines = answer.split(/\r?\n+/).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  if (lines.length >= 2) return lines;
  // Sentence split next
  const sentences = answer.split(/(?<=[.!?;])\s+/).map(s => s.trim()).filter(Boolean);
  if (sentences.length >= 2) return sentences;
  // Fall back to comma split — useful for raw answers like "red, white, blue"
  const commas = answer.split(/,\s*|\s+(?:and|or)\s+/i).map(s => s.trim()).filter(Boolean);
  if (commas.length >= 2) return commas;
  return [answer.trim()];
}

/** Apply only "shape" transforms (case, quotes, structure, punctuation). */
function applyShape(answer: string, spec: ConstraintSpec): string {
  let out = answer.trim();
  const f = spec.format;

  if (f.structure === 'reverse') {
    out = out.split('').reverse().join('');
  } else if (f.structure === 'morse') {
    out = toMorse(out);
  } else if (f.structure === 'dotted-list') {
    out = asDottedList(splitIntoItems(out));
  } else if (f.structure === 'numbered-list') {
    out = asNumberedList(splitIntoItems(out));
  } else if (f.structure === 'comma-list') {
    out = asCommaList(splitIntoItems(out));
  } else if (f.structure === 'single-line') {
    out = out.replace(/\s*\n+\s*/g, ' ').trim();
  }

  if (f.noPunctuation) out = stripPunctuation(out);
  if (f.digitsOnly) out = digitsOnly(out);
  if (f.caseStyle) out = applyCase(out, f.caseStyle);

  if (f.exactWordCount !== undefined && f.exactWordCount > 0) {
    out = trimToWords(out, f.exactWordCount);
  } else if (f.maxWordCount !== undefined) {
    out = trimToWords(out, f.maxWordCount);
  }

  if (f.exactCharacterCount !== undefined && f.exactCharacterCount > 0 && out.length > f.exactCharacterCount) {
    out = out.slice(0, f.exactCharacterCount);
  }

  if (f.mustBeWithinQuotes) {
    out = quoteWrap(out, f.quoteStyle);
  }

  if (f.mustStartWith && !out.startsWith(f.mustStartWith)) out = f.mustStartWith + out;
  if (f.mustEndWith && !out.endsWith(f.mustEndWith)) out = out + f.mustEndWith;

  return out;
}

/** Format a Date according to a custom character pattern like "LL:LL". */
export function formatTimeForPattern(now: Date, pattern: string | undefined, exactChars?: number): string {
  // Default HH:MM
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  if (!pattern) {
    if (exactChars === 5) return `${hh}:${mm}`;
    if (exactChars === 8) return `${hh}:${mm}:${ss}`;
    if (exactChars === 4) return `${hh}${mm}`;
    return `${hh}:${mm}`;
  }
  // Pattern uses L = letter/digit slot, separators are passed through.
  // For time we always emit digits regardless of L vs other.
  let out = '';
  let digitIdx = 0;
  const digits = `${hh}${mm}${ss}`;
  for (const ch of pattern) {
    if (ch === 'L') {
      out += digits[digitIdx] ?? '0';
      digitIdx++;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Public entry: shape `rawAnswer` to satisfy `spec`.
 *
 * If `rawAnswer` is null/empty AND the spec has no synthesizable shape (e.g.
 * "reply only with the time" with no answer to shape), the caller should
 * provide one before invoking this. Returns null only when the spec is
 * impossible/conflicting.
 */
export function applyFormatSpec(rawAnswer: string, spec: ConstraintSpec): string | null {
  if (spec.conflicts.length > 0 && spec.confidence >= 0.7) {
    // Caller may choose to surface this as a clarifying message instead.
    // We still attempt a best-effort shape so the engine can decide.
  }
  if (typeof rawAnswer !== 'string') return null;
  if (rawAnswer.length === 0) return null;
  try {
    return applyShape(rawAnswer, spec);
  } catch {
    return null;
  }
}

/** Build a short clarifying note for impossible / conflicting specs. */
export function buildConflictMessage(spec: ConstraintSpec): string {
  const lines = ['Your request has conflicting constraints I cannot satisfy at the same time:'];
  for (const c of spec.conflicts) lines.push(`• ${c}`);
  lines.push('Tell me which constraint to keep and I will follow it strictly.');
  return lines.join('\n');
}
