import { STOP_WORDS } from '../models/stop-words.js';

const CHAT_FILLER_STOP_WORDS = [
  'actually', 'again', 'already', 'around', 'basically', 'bit', 'called',
  'currently', 'else', 'enough', 'exactly', 'feel', 'fine', 'first', 'got',
  'guess', 'honest', 'honestly', 'kind', 'maybe', 'mean', 'much', 'okay',
  'ok', 'one', 'please', 'quick', 'really', 'right', 'said', 'say',
  'something', 'stuff', 'sure', 'thing', 'things', 'think', 'though',
  'today', 'try', 'want', 'way', 'well',
] as const;

export const CHAT_STOP_WORDS: ReadonlySet<string> = new Set([
  ...STOP_WORDS,
  ...CHAT_FILLER_STOP_WORDS,
]);

export const REQUEST_START_WORDS: ReadonlySet<string> = new Set([
  'add', 'adjust', 'build', 'can', 'change', 'clean', 'could', 'create',
  'design', 'develop', 'edit', 'extend', 'fix', 'generate', 'go', 'harden',
  'help', 'implement', 'improve', 'kindly', 'launch', 'make', 'patch',
  'please', 'polish', 'prototype', 'refactor', 'rewrite', 'ship', 'start',
  'update', 'upgrade', 'will', 'wire', 'would',
]);

export const INTENT_ACTION_WORDS: ReadonlySet<string> = new Set([
  'answer', 'audit', 'build', 'check', 'clone', 'compare', 'debug',
  'decide', 'diagnose', 'explain', 'fix', 'grade', 'harden', 'inspect',
  'merge', 'plan', 'prove', 'refactor', 'repair', 'review', 'route',
  'search', 'ship', 'summarize', 'test', 'verify',
]);

export const UNIQUENESS_HINT_WORDS: ReadonlySet<string> = new Set([
  'angle', 'defensible', 'different', 'differentiator', 'distinct',
  'distinctive', 'edge', 'moat', 'novel', 'original', 'proprietary',
  'rare', 'singular', 'standout', 'uncommon', 'unique', 'unusual',
]);

export const SOURCE_REFERENCE_WORDS: ReadonlySet<string> = new Set([
  'bibliography', 'cite', 'cited', 'cites', 'citation', 'citations',
  'evidence', 'footnote', 'footnotes', 'link', 'links', 'provenance',
  'reference', 'references', 'source', 'sources',
]);

const PRESERVED_SHORT_TOKENS = new Set([
  'ai', 'c#', 'c++', 'db', 'f#', 'io', 'js', 'ml', 'os', 'ts', 'ui', 'ux',
]);

const TOKEN_RE = /[a-z0-9][a-z0-9+#.]*/gi;
const ONE_OF_A_KIND_RE = /\bone[-\s]+of[-\s]+a[-\s]+kind\b/i;
const SOURCE_REFERENCE_FALSE_FRIEND_RE =
  /\bsource\s+(?:code|map|maps|file|files|tree|control|branch|directory|folder)\b/i;
const SOURCE_REFERENCE_INTENT_PATTERNS = [
  /\b(?:cite|cites|cited|citation|citations|footnote|footnotes|bibliography)\b/i,
  /\b(?:include|with|using|show|give|provide|add)\s+(?:credible\s+|primary\s+|official\s+)?(?:sources?|references?|links?)\b/i,
  /\b(?:sources?|references?)\s+(?:please|pls|for|on|about|included|attached)\b/i,
  /\baccording\s+to\s+(?:sources?|official|the\s+docs?|the\s+paper|(?:the\s+)?research)\b/i,
] as const;

export interface LexicalSignalSummary {
  readonly tokens: readonly string[];
  readonly startWords: readonly string[];
  readonly intentWords: readonly string[];
  readonly uniquenessHints: readonly string[];
  readonly sourceReferenceHints: readonly string[];
  readonly startsWithRequestAction: boolean;
  readonly hasUniquenessHint: boolean;
  readonly hasSourceReferenceRequest: boolean;
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function normalizeLexicalToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[.]+|[.]+$/g, '')
    .trim();
}

export function extractLexicalTokens(text: string): string[] {
  const matches = (text || '').match(TOKEN_RE) ?? [];
  return matches
    .map(normalizeLexicalToken)
    .filter(Boolean);
}

export function salientLexicalTokens(
  text: string,
  options: {
    readonly stopWords?: ReadonlySet<string>;
    readonly minLength?: number;
  } = {},
): string[] {
  const stopWords = options.stopWords ?? CHAT_STOP_WORDS;
  const minLength = options.minLength ?? 3;
  return unique(extractLexicalTokens(text).filter((token) =>
    (token.length >= minLength || PRESERVED_SHORT_TOKENS.has(token))
    && !stopWords.has(token)
    && !/^\d+$/.test(token),
  ));
}

export function wantsExplicitSourceReferences(input: string): boolean {
  const normalized = (input || '').toLowerCase().trim();
  if (!normalized) return false;
  if (SOURCE_REFERENCE_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  if (SOURCE_REFERENCE_FALSE_FRIEND_RE.test(normalized)) return false;
  return /\b(?:sources?|references?)\b/i.test(normalized);
}

export function summarizeLexicalSignals(text: string): LexicalSignalSummary {
  const tokens = salientLexicalTokens(text);
  const rawTokens = extractLexicalTokens(text);
  const leading = rawTokens.slice(0, 5);
  const startWords = unique(leading.filter((token) => REQUEST_START_WORDS.has(token)));
  const intentWords = unique(tokens.filter((token) => INTENT_ACTION_WORDS.has(token)));
  const uniquenessHints = unique([
    ...tokens.filter((token) => UNIQUENESS_HINT_WORDS.has(token)),
    ...(ONE_OF_A_KIND_RE.test(text) ? ['one-of-a-kind'] : []),
  ]);
  const hasSourceReferenceRequest = wantsExplicitSourceReferences(text);
  const sourceReferenceHints = hasSourceReferenceRequest
    ? unique(rawTokens.filter((token) => SOURCE_REFERENCE_WORDS.has(token)))
    : [];

  return {
    tokens,
    startWords,
    intentWords,
    uniquenessHints,
    sourceReferenceHints,
    startsWithRequestAction: startWords.length > 0,
    hasUniquenessHint: uniquenessHints.length > 0,
    hasSourceReferenceRequest,
  };
}
