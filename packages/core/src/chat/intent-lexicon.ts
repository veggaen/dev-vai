import { STOP_WORDS } from '../models/stop-words.js';

const CHAT_FILLER_STOP_WORDS = [
  'actually', 'again', 'already', 'anyway', 'around', 'basically', 'bit',
  'called', 'currently', 'else', 'enough', 'exactly', 'feel', 'fine',
  'first', 'got', 'guess', 'honest', 'honestly', 'kind', 'kinda', 'lot',
  'lots', 'maybe', 'mean', 'much', 'okay', 'ok', 'one', 'perhaps', 'please',
  'pretty', 'probably', 'quick', 'really', 'right', 'said', 'say',
  'something', 'sort', 'sorta', 'stuff', 'sure', 'thing', 'things', 'think',
  'though', 'today', 'try', 'usualy', 'usually', 'want', 'way', 'well',
] as const;

export const CHAT_STOP_WORDS: ReadonlySet<string> = new Set([
  ...STOP_WORDS,
  ...CHAT_FILLER_STOP_WORDS,
]);

export const REQUEST_START_WORDS: ReadonlySet<string> = new Set([
  'add', 'adjust', 'analyze', 'assess', 'build', 'can', 'change', 'clean',
  'could', 'create', 'design', 'develop', 'document', 'edit', 'evaluate',
  'extend', 'fix', 'generate', 'go', 'harden', 'help', 'implement',
  'improve', 'investigate', 'kindly', 'launch', 'make', 'measure', 'patch',
  'please', 'polish', 'prototype', 'record', 'refactor', 'research',
  'rewrite', 'ship', 'start', 'structure', 'trace', 'update', 'upgrade',
  'validate', 'will', 'wire', 'would',
]);

export const INTENT_ACTION_WORDS: ReadonlySet<string> = new Set([
  'analyze', 'answer', 'assess', 'audit', 'build', 'check', 'classify',
  'clone', 'compare', 'debug', 'decide', 'diagnose', 'document', 'evaluate',
  'explain', 'fix', 'grade', 'harden', 'inspect', 'investigate', 'measure',
  'merge', 'monitor', 'observe', 'plan', 'prove', 'refactor', 'repair',
  'reproduce', 'research', 'review', 'route', 'search', 'ship', 'summarize',
  'test', 'trace', 'validate', 'verify',
]);

export const UNIQUENESS_HINT_WORDS: ReadonlySet<string> = new Set([
  'angle', 'bespoke', 'custom', 'defensible', 'different',
  'differentiator', 'distinct', 'distinctive', 'edge', 'individual',
  'moat', 'novel', 'novelty', 'original', 'ownable', 'proprietary',
  'rare', 'signature', 'singular', 'standout', 'tailored', 'uncommon',
  'unique', 'unrepeatable', 'unusual',
]);

export const INTENTIONALITY_HINT_WORDS: ReadonlySet<string> = new Set([
  'aim', 'aimed', 'deliberate', 'deliberately', 'goal', 'goals',
  'intended', 'intention', 'intentions', 'intentional', 'meaning', 'meant',
  'purpose', 'purposeful', 'purposely', 'target', 'targeted',
]);

export const SPECIFICITY_HINT_WORDS: ReadonlySet<string> = new Set([
  'concrete', 'exact', 'exactly', 'literal', 'literally', 'named',
  'particular', 'precise', 'precisely', 'specific', 'specifically',
  'targeted',
]);

export const SOURCE_REFERENCE_WORDS: ReadonlySet<string> = new Set([
  'bibliography', 'cite', 'cited', 'cites', 'citation', 'citations',
  'doi', 'evidence', 'footnote', 'footnotes', 'link', 'links', 'paper',
  'papers', 'provenance', 'reference', 'references', 'source', 'sources',
  'studies', 'study', 'url', 'urls',
]);

const PRESERVED_SHORT_TOKENS = new Set([
  'ai', 'c#', 'c++', 'db', 'f#', 'io', 'js', 'ml', 'os', 'ts', 'ui', 'ux',
]);

const TOKEN_RE = /[a-z0-9][a-z0-9+#.]*/gi;
const SOURCE_REFERENCE_FALSE_FRIEND_RE =
  /\bsource\s+(?:code|map|maps|file|files|tree|control|branch|directory|folder)\b/i;
const SOURCE_REFERENCE_INTENT_PATTERNS = [
  /\b(?:cite|cites|cited|citation|citations|footnote|footnotes|bibliography)\b/i,
  /\b(?:include|with|using|show|give|provide|add)\s+(?:credible\s+|primary\s+|official\s+)?(?:sources?|references?|links?)\b/i,
  /\b(?:sources?|references?)\s+(?:please|pls|for|on|about|included|attached)\b/i,
  /\baccording\s+to\s+(?:sources?|official|the\s+docs?|the\s+paper|(?:the\s+)?research)\b/i,
] as const;

interface PhraseHint {
  readonly hint: string;
  readonly pattern: RegExp;
}

const UNIQUENESS_PHRASE_HINTS: readonly PhraseHint[] = [
  { hint: 'one-of-a-kind', pattern: /\bone[-\s]+of[-\s]+a[-\s]+kind\b/i },
  { hint: 'not-generic', pattern: /\bnot\s+(?:generic|boilerplate|template|cookie[-\s]?cutter)\b/i },
  { hint: 'signature-features', pattern: /\bsignature\s+(?:features?|look|feel|style|identity)\b/i },
  { hint: 'stand-out', pattern: /\bstand\s+out\b/i },
];

const INTENTIONALITY_PHRASE_HINTS: readonly PhraseHint[] = [
  { hint: 'my-intention', pattern: /\bmy\s+intent(?:ion)?\b/i },
  { hint: 'what-i-meant', pattern: /\bwhat\s+i\s+meant\b/i },
  { hint: 'not-my-intent', pattern: /\bnot\s+(?:my|the)\s+intent(?:ion)?\b/i },
  { hint: 'intended-answer', pattern: /\bintended\s+(?:answer|meaning|direction|result|outcome)\b/i },
];

const SPECIFICITY_PHRASE_HINTS: readonly PhraseHint[] = [
  { hint: 'be-specific', pattern: /\bbe\s+specific\b/i },
  { hint: 'exactly-what', pattern: /\bexactly\s+what\b/i },
  { hint: 'specific-to', pattern: /\bspecific\s+to\b/i },
  { hint: 'concrete-example', pattern: /\bconcrete\s+(?:example|steps?|details?)\b/i },
];

export interface LexicalSignalSummary {
  readonly tokens: readonly string[];
  readonly startWords: readonly string[];
  readonly intentWords: readonly string[];
  readonly uniquenessHints: readonly string[];
  readonly intentionalityHints: readonly string[];
  readonly specificityHints: readonly string[];
  readonly sourceReferenceHints: readonly string[];
  readonly startsWithRequestAction: boolean;
  readonly hasUniquenessHint: boolean;
  readonly hasIntentionalityHint: boolean;
  readonly hasSpecificityHint: boolean;
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

function collectWordHints(tokens: readonly string[], lexicon: ReadonlySet<string>): string[] {
  return unique(tokens.filter((token) => lexicon.has(token)));
}

function collectPhraseHints(text: string, hints: readonly PhraseHint[]): string[] {
  return hints
    .filter(({ pattern }) => pattern.test(text))
    .map(({ hint }) => hint);
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
    ...collectWordHints(rawTokens, UNIQUENESS_HINT_WORDS),
    ...collectPhraseHints(text, UNIQUENESS_PHRASE_HINTS),
  ]);
  const intentionalityHints = unique([
    ...collectWordHints(rawTokens, INTENTIONALITY_HINT_WORDS),
    ...collectPhraseHints(text, INTENTIONALITY_PHRASE_HINTS),
  ]);
  const specificityHints = unique([
    ...collectWordHints(rawTokens, SPECIFICITY_HINT_WORDS),
    ...collectPhraseHints(text, SPECIFICITY_PHRASE_HINTS),
  ]);
  const hasSourceReferenceRequest = wantsExplicitSourceReferences(text);
  const sourceReferenceHints = hasSourceReferenceRequest
    ? collectWordHints(rawTokens, SOURCE_REFERENCE_WORDS)
    : [];

  return {
    tokens,
    startWords,
    intentWords,
    uniquenessHints,
    intentionalityHints,
    specificityHints,
    sourceReferenceHints,
    startsWithRequestAction: startWords.length > 0,
    hasUniquenessHint: uniquenessHints.length > 0,
    hasIntentionalityHint: intentionalityHints.length > 0,
    hasSpecificityHint: specificityHints.length > 0,
    hasSourceReferenceRequest,
  };
}
