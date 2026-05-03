import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@components': path.resolve(__dirname, 'components'),
      '@lib': path.resolve(__dirname, 'lib'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test-setup.ts'],
    globals: true,
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'e2e/**'],
    css: false,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: '../../test/.coverage/web',
      include: ['components/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/**',
        '.next/**',
        'e2e/**',
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        'test-setup.ts',
        'test-fixtures/**',
      ],
    },
  },
});
