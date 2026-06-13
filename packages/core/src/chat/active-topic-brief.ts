import type { Message } from '../models/adapter.js';

/**
 * Compact, deterministic summary of what the conversation is currently
 * about. Built once per turn and threaded through the pipeline so the
 * engine, retrievers, and quality validators all agree on "topic".
 *
 * This is intentionally narrower than `ConversationGrounding` from
 * `conversation-grounding.ts`: it is a small, public, pure-data brief
 * that any router can consume without depending on engine internals.
 *
 * - `topicWords`         — content tokens drawn from the last user turn
 *                          AND the last assistant turn. Stop-words and
 *                          tokens shorter than 3 chars are removed.
 * - `lastAssistantHead`  — first ~240 chars of the last assistant turn,
 *                          for previews / heading lines.
 * - `lastUserHead`       — first ~160 chars of the last user turn.
 * - `selectedFiles`      — workspace file paths the user attached or
 *                          mentioned. Empty when chat mode has none.
 * - `hasPriorAssistant`  — quick boolean so callers don't re-scan
 *                          history.
 */
export interface ActiveTopicBrief {
  readonly topicWords: readonly string[];
  readonly lastAssistantHead: string;
  readonly lastUserHead: string;
  readonly selectedFiles: readonly string[];
  readonly hasPriorAssistant: boolean;
}

const DEFAULT_STOP = new Set([
  'the','and','but','for','with','that','this','from','into','your','our','their','they','them','these','those','about','what','when','where','which','while','should','would','could','have','been','being','will','just','also','more','than','then','very','some','such','only','most','make','made','want','need','like','able','onto','over','under','here','there','it\'s','its','it','is','are','was','were','do','does','did','can','may','might','let','let\'s','lets','yes','no','ok','okay','please','one','two','three','first','next','last','prev','prior','again','still','any','all','i','i\'m','i\'d','i\'ll','you','you\'re','we','we\'re','vs','etc',
]);

function tokenize(value: string, stop: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const raw of value.toLowerCase().split(/[^a-z0-9+#.-]+/i)) {
    const cleaned = raw.replace(/^[-.+#]+|[-.+#]+$/g, '');
    if (cleaned.length < 3) continue;
    if (stop.has(cleaned)) continue;
    out.add(cleaned);
  }
  return [...out];
}

function lastByRole(history: readonly Message[], role: 'user' | 'assistant'): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m.role === role && m.content.trim().length > 0) return m.content.trim();
  }
  return '';
}

function head(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastBoundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return lastBoundary > max * 0.6 ? cut.slice(0, lastBoundary) + '…' : cut + '…';
}

export interface ExtractActiveTopicBriefOptions {
  /** Workspace files the user has explicitly attached or referenced. */
  readonly selectedFiles?: readonly string[];
  /** Override the default stop-word set (mostly for tests). */
  readonly stopWords?: ReadonlySet<string>;
  /** Max number of topic words to keep. */
  readonly maxTopicWords?: number;
}

/**
 * Build the compact active-topic brief. Always returns something — even
 * for the very first turn — so callers don't need null-checks. When the
 * conversation is empty, `topicWords` simply contains the user's own
 * content tokens.
 */
export function extractActiveTopicBrief(
  input: string,
  history: readonly Message[],
  options: ExtractActiveTopicBriefOptions = {},
): ActiveTopicBrief {
  const stop = options.stopWords ?? DEFAULT_STOP;
  const max = options.maxTopicWords ?? 16;

  const lastUser = lastByRole(history, 'user');
  const lastAssistant = lastByRole(history, 'assistant');

  // Weight the LAST assistant turn first (it's what "it" / "that" refers
  // to), then the LAST user turn, then the current input. We dedupe via
  // the Set inside `tokenize`.
  const merged: string[] = [];
  for (const tok of tokenize(lastAssistant, stop)) merged.push(tok);
  for (const tok of tokenize(lastUser, stop)) if (!merged.includes(tok)) merged.push(tok);
  for (const tok of tokenize(input, stop)) if (!merged.includes(tok)) merged.push(tok);

  return {
    topicWords: merged.slice(0, max),
    lastAssistantHead: head(lastAssistant, 240),
    lastUserHead: head(lastUser, 160),
    selectedFiles: options.selectedFiles ?? [],
    hasPriorAssistant: lastAssistant.length > 0,
  };
}

/**
 * Generic topic-overlap gate. Returns true when the input shares at
 * least one content token with the brief, OR when the input contains an
 * anaphoric marker that implicitly refers back ("it", "this", "more").
 *
 * Use this to gate fuzzy retrieval: if a learned snippet's keywords
 * don't overlap the active topic AND the input has no anaphora, the
 * snippet is almost certainly a coincidence and should not win.
 */
const ANAPHORIC_GATE_RE =
  /\b(?:it|this|that|these|those|them|his|her|their|same|continue|more|deeper|expand|further|again|keep\s+going)\b/i;

export function hasTopicOverlap(
  input: string,
  brief: ActiveTopicBrief,
  options: { readonly stopWords?: ReadonlySet<string> } = {},
): boolean {
  if (ANAPHORIC_GATE_RE.test(input)) return true;
  if (brief.topicWords.length === 0) return false;
  const inputTokens = tokenize(input, options.stopWords ?? DEFAULT_STOP);
  if (inputTokens.length === 0) return false;
  const topicSet = new Set(brief.topicWords);
  for (const tok of inputTokens) if (topicSet.has(tok)) return true;
  return false;
}
