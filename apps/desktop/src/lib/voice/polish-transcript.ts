import { shouldAcceptPolishedTranscript } from '@vai/core/browser';
import { apiFetch } from '../api.js';
import { loadVocabulary, candidateRestoredVocabTerm } from './stt-vocabulary.js';

const POLISH_TIMEOUT_MS = 7_000;

export interface PolishedTranscript {
  readonly text: string;
  readonly engine: string;
  readonly changed: boolean;
  readonly error?: string;
}

export async function polishTranscript(text: string): Promise<PolishedTranscript> {
  const trimmed = text.trim();
  if (!trimmed) return { text: '', engine: 'none', changed: false };

  const vocabulary = loadVocabulary();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), POLISH_TIMEOUT_MS);
  try {
    const response = await apiFetch('/api/stt/polish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, vocabulary: vocabulary.length ? vocabulary : undefined }),
      signal: controller.signal,
    });
    if (!response.ok) return { text: trimmed, engine: 'local-unavailable', changed: false };

    const body = await response.json() as Partial<PolishedTranscript>;
    const candidate = typeof body.text === 'string' && body.text.trim() ? body.text.trim() : trimmed;
    // Accept the cleanup if it passes the anti-rewrite guard OR if it legitimately
    // restored one of the user's custom words (a larger but correct change the guard
    // would otherwise reject).
    const accept = shouldAcceptPolishedTranscript(trimmed, candidate)
      || candidateRestoredVocabTerm(trimmed, candidate, vocabulary);
    const polished = accept ? candidate : trimmed;
    return {
      text: polished,
      engine: typeof body.engine === 'string' ? body.engine : 'local',
      changed: typeof body.changed === 'boolean' ? body.changed : polished !== trimmed,
      error: typeof body.error === 'string' ? body.error : undefined,
    };
  } catch (error) {
    return {
      text: trimmed,
      engine: 'local-unavailable',
      changed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    window.clearTimeout(timer);
  }
}
