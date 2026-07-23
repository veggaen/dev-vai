import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 1,
    // The process pool can time out while reporting this large suite on Windows.
    // Threads keep the single-worker resource ceiling without the flaky IPC hop.
    pool: 'threads',
    projects: [
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
    ],
  },
});
