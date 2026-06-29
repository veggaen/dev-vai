/**
 * Scenario context for corpus rows whose meaning depends on prior turns.
 *
 * A prompt like "what about the second one?" is not a standalone evaluation.
 * Running it in an empty conversation measures guesswork, not context carry. Keep
 * these preludes small and deterministic so observe mode and acceptance checks
 * grade the same behavior.
 */

export function preludeForPromptClass(klass, prompt) {
  if (klass !== 'followup/context-carry') return [];
  const text = String(prompt ?? '').toLowerCase();

  if (/\bsecond\s+one\b|\b2nd\b|\bsecond\b/.test(text)) {
    return [
      'Compare Next.js and Vite for a small local-first desktop companion app. Give a short verdict on both.',
    ];
  }

  if (/\bsimpler|clearer|plain\s+english|eli5|shorter\b/.test(text)) {
    return [
      'Explain recursion with a tiny TypeScript example and one practical analogy.',
    ];
  }

  if (/\balternative\b|\bbetter\s+than\b|\bwhy\s+is\s+it\s+better\b/.test(text)) {
    return [
      'Should I use SQLite or Postgres for a local-first desktop app? Give a clear recommendation and mention the alternative.',
    ];
  }

  if (/\bchange\s+about\s+it\b|\bchange\b/.test(text)) {
    return [
      'Review this plan: Vai observes chat turns, records failures, queues fixes, and applies verified consensus patches. Give a concise critique.',
    ];
  }

  return [
    'Compare two implementation options for a small app and recommend one with trade-offs.',
  ];
}

export function hasScenarioPrelude(klass, prompt) {
  return preludeForPromptClass(klass, prompt).length > 0;
}
