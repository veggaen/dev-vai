/**
 * Bench runtime for conv-loop — online (live search) vs offline (local only).
 */

import { VaiEngine } from '../src/models/vai-engine.js';

export type ConvLoopBenchMode = 'online' | 'offline';

export function resolveBenchMode(argv: string[]): ConvLoopBenchMode {
  if (argv.some((a) => a === '--offline')) return 'offline';
  return 'online';
}

export function applyBenchMode(mode: ConvLoopBenchMode): void {
  if (mode === 'online') {
    delete process.env.CONV_LOOP_OFFLINE;
    delete process.env.VAI_TEST_MODE;
  } else {
    process.env.CONV_LOOP_OFFLINE = '1';
    process.env.VAI_TEST_MODE = '1';
  }
}

const DEFAULT_ONLINE_SEARCH_BUDGET_MS = 12_000;

export function createBenchEngine(mode: ConvLoopBenchMode): VaiEngine {
  const online = mode === 'online';
  const engine = new VaiEngine({
    testMode: !online,
  });
  if (online) {
    const fromEnv = Number(process.env.VAI_CONV_LOOP_SEARCH_BUDGET_MS);
    (engine as { chatSearchBudgetMs: number }).chatSearchBudgetMs =
      Number.isFinite(fromEnv) && fromEnv > 2000 ? fromEnv : DEFAULT_ONLINE_SEARCH_BUDGET_MS;
  }
  return engine;
}

export function describeSearchConfig(): string {
  const parts: string[] = ['duckduckgo'];
  if (process.env.BRAVE_SEARCH_API_KEY) parts.push('brave');
  if (process.env.VAI_SEARXNG_URL) parts.push(`searxng(${process.env.VAI_SEARXNG_URL})`);
  return parts.join(' + ');
}
