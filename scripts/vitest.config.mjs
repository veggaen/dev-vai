import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/lib/vai-competition-v4-*.test.mjs'],
    maxWorkers: 1,
  },
});
