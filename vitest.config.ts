import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import swc from 'unplugin-swc';

// NestJS resolves dependencies from `design:paramtypes`, which esbuild does not emit.
// SWC compiles the API sources with decorator metadata so the container behaves in tests
// exactly as it does in the shipped build.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  resolve: {
    alias: {
      '@ai-footprint/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@ai-footprint/config': resolve(__dirname, 'packages/config/src/index.ts'),
      '@ai-footprint/database': resolve(__dirname, 'packages/database/src/index.ts'),
      '@ai-footprint/analytics': resolve(__dirname, 'packages/analytics/src/index.ts'),
      '@ai-footprint/collectors': resolve(__dirname, 'packages/collectors/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/api/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/web/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/*.d.ts'],
    },
  },
});
