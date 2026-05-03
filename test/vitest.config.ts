import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'smoke/**/*.test.ts',
      'security/**/*.test.ts',
      'contract/**/*.test.ts',
      'migration/**/*.test.ts',
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    reporters: ['default', 'json'],
    outputFile: { json: './results/vitest.json' },
    watch: false,
  },
});
