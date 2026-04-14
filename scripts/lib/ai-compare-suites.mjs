/**
 * Named prompt suites for the visible AI comparison harness.
 * Keep the suites small and high-signal so visible runs remain practical.
 */

/**
 * @typedef {{
 *   id: string,
 *   prompt: string,
 *   expect: string[],
 *   notes?: string,
 * }} ComparisonPrompt
 */

/** @returns {Record<string, { id: string, label: string, prompts: ComparisonPrompt[] }>} */
export function getComparisonSuites() {
  return {
    basics: {
      id: 'basics',
      label: 'Core concept basics',
      prompts: [
        { id: 'docker', prompt: 'What is Docker?', expect: ['docker', 'container'] },
        { id: 'typescript', prompt: 'What is TypeScript?', expect: ['typescript', 'javascript'] },
        { id: 'websocket', prompt: 'What is WebSocket?', expect: ['websocket', 'connection'] },
      ],
    },
    devtools: {
      id: 'devtools',
      label: 'Developer tooling basics',
      prompts: [
        { id: 'playwright', prompt: 'What is Playwright?', expect: ['playwright', 'browser'] },
        { id: 'vitest', prompt: 'What is Vitest?', expect: ['vitest', 'test'] },
        { id: 'prisma', prompt: 'What is Prisma?', expect: ['prisma', 'database'] },
      ],
    },
    'short-tech': {
      id: 'short-tech',
      label: 'Short technical explainers',
      prompts: [
        { id: 'docker-short', prompt: 'Explain Docker in simple words.', expect: ['docker', 'container'] },
        { id: 'cache-short', prompt: 'Explain cache in simple words.', expect: ['cache', 'data'] },
        { id: 'latency-short', prompt: 'Explain latency in simple words.', expect: ['latency', 'delay'] },
      ],
    },
  };
}

export function resolveSuite(name) {
  const suites = getComparisonSuites();
  const suite = suites[name.trim().toLowerCase()];
  if (!suite) {
    throw new Error(`Unknown suite '${name}'. Available: ${Object.keys(suites).join(', ')}`);
  }
  return suite;
}